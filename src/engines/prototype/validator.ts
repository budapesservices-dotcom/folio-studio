/**
 * Folio Node Logic v1 — Semantic Graph Validator & Project Integrity Auditor.
 *
 * Separates strict `.flop` v2 structural persistence (which preserves unknown
 * or reserved future node types) from semantic execution validation (port types,
 * dataflow DAG acyclicity, AST node/variant/theme/route cross-references, and
 * CSS/URL injection guards).
 */

import { isSafeCssColorValue } from '../../core/document/tokens';
import type {
  ComponentDefinition,
  DesignNode,
  FolioProject,
  LogicGraph,
  LogicVariableDefinition,
} from '../../core/document/types';
import { sanitizeHref } from '../codegen/sanitize';
import {
  LOGIC_COMPARE_OPERATORS,
  areLogicPortTypesCompatible,
  getLogicNodeDefinition,
  getLogicNodePort,
  isBuiltInLogicNodeType,
} from './catalog';
import {
  PIPELINE_REF_DATA_KEYS,
  getNodeTargetMode,
  getUpstreamNodes,
  getUpstreamPipelineOrigins,
  parsePipelineRef,
  resolveAstNodeById,
  type PipelineOriginRef,
} from './pipeline';
import {
  containsRawSecretPattern,
  detectInlineSecretHeaders,
  hasEmbeddedUrlCredentials,
  isSafeSecretRef,
} from './networkSecrets';

export type LogicDiagnosticSeverity = 'error' | 'warning';

export interface LogicDiagnostic {
  readonly severity: LogicDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly graphId: string;
  readonly nodeId?: string;
  readonly connectionId?: string;
  readonly frameId?: string;
}

export interface LogicValidationReport {
  readonly ok: boolean;
  readonly diagnostics: readonly LogicDiagnostic[];
  readonly errors: readonly LogicDiagnostic[];
  readonly warnings: readonly LogicDiagnostic[];
}

function collectScopedDocumentsNodes(
  graph: LogicGraph,
  project: FolioProject,
): { scopeValid: boolean; nodesById: Map<string, DesignNode>; componentsById: Map<string, ComponentDefinition> } {
  const nodesById = new Map<string, DesignNode>();
  const componentsById = new Map<string, ComponentDefinition>(
    project.components.map((component) => [component.id, component]),
  );

  if (graph.scope === 'project') {
    for (const page of project.pages) {
      for (const node of page.document.nodes) {
        nodesById.set(node.id, node);
      }
    }
    return { scopeValid: graph.targetId === null, nodesById, componentsById };
  }

  if (graph.scope === 'page') {
    const page = project.pages.find((item) => item.id === graph.targetId);
    if (!page) return { scopeValid: false, nodesById, componentsById };
    for (const node of page.document.nodes) {
      nodesById.set(node.id, node);
    }
    return { scopeValid: true, nodesById, componentsById };
  }

  const component = project.components.find((item) => item.id === graph.targetId);
  if (!component) return { scopeValid: false, nodesById, componentsById };
  for (const node of component.document.nodes) {
    nodesById.set(node.id, node);
  }
  return { scopeValid: true, nodesById, componentsById };
}

function collectAvailableVariables(
  graph: LogicGraph,
  project: FolioProject,
): Map<string, LogicVariableDefinition> {
  const variables = new Map<string, LogicVariableDefinition>();
  for (const other of project.logicGraphs) {
    if (other.scope === 'project' && other.id !== graph.id) {
      for (const variable of other.variables ?? []) {
        variables.set(variable.id, variable);
      }
    }
  }
  for (const variable of graph.variables ?? []) {
    variables.set(variable.id, variable);
  }
  return variables;
}

/**
 * Validates one `LogicGraph` semantically against the Unified Project Model.
 * Unknown/reserved node types emit a non-fatal `UNSUPPORTED_NODE_TYPE` warning
 * so forward-compatible `.flop` v2 graphs never lose data.
 */
export function validateLogicGraphSemantics(
  graph: LogicGraph,
  project: FolioProject,
): LogicValidationReport {
  const diagnostics: LogicDiagnostic[] = [];
  const push = (
    severity: LogicDiagnosticSeverity,
    code: string,
    message: string,
    extra?: { nodeId?: string; connectionId?: string; frameId?: string },
  ) => {
    diagnostics.push({
      severity,
      code,
      message,
      graphId: graph.id,
      ...(extra?.nodeId ? { nodeId: extra.nodeId } : {}),
      ...(extra?.connectionId ? { connectionId: extra.connectionId } : {}),
      ...(extra?.frameId ? { frameId: extra.frameId } : {}),
    });
  };

  const { scopeValid, nodesById: astNodesById, componentsById } = collectScopedDocumentsNodes(graph, project);
  if (!scopeValid) {
    push(
      'error',
      'INVALID_GRAPH_SCOPE',
      `Logic graph "${graph.name}" target "${String(graph.targetId)}" does not match an existing ${graph.scope}.`,
    );
  }

  // Network credential security boundary: never allow raw secrets in `.flop` settings
  if (graph.networkSettings) {
    const rawRef = graph.networkSettings.authSecretRef ?? '';
    if (rawRef.trim() && !isSafeSecretRef(rawRef)) {
      push(
        'error',
        'UNSAFE_AUTH_SECRET_REF',
        `Network Auth Secret Ref in "${graph.name}" must be an environment key reference (e.g. API_TOKEN), never a raw token or credential.`,
      );
    }
    const flaggedHeaders = detectInlineSecretHeaders(graph.networkSettings.globalHeaders ?? '');
    if (flaggedHeaders.length > 0) {
      push(
        'error',
        'HARDCODED_SECRET_HEADER',
        `Network Global Headers in "${graph.name}" contain hardcoded credential header(s) (${flaggedHeaders.join(', ')}). Use Auth Secret Ref or a server-side proxy instead.`,
      );
    }
    if (hasEmbeddedUrlCredentials(graph.networkSettings.baseUrl ?? '')) {
      push(
        'error',
        'UNSAFE_NETWORK_URL_CREDENTIALS',
        `Network Base URL in "${graph.name}" must not embed username/password credentials.`,
      );
    }
  }

  const variablesById = collectAvailableVariables(graph, project);
  const pagesById = new Map(project.pages.map((page) => [page.id, page]));
  const pageRoutes = new Set(project.pages.map((page) => page.route));
  const themeIds = new Set((project.designTokens?.themes ?? []).map((theme) => theme.id));
  const animationClipIds = new Set((project.animations ?? []).map((clip) => clip.id));
  const logicNodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const seenSourcePageIds = new Set<string>();
  const seenSourceComponentIds = new Set<string>();
  const seenSourceElementIds = new Set<string>();
  const seenSourceThemeIds = new Set<string>();

  // Track incoming connections per (nodeId, portId) so nodes with wired inputs
  // don't falsely fail literal-required checks.
  const incomingDataPorts = new Set<string>();
  const dataflowEdges = new Map<string, string[]>();
  const seenConnectionKeys = new Set<string>();

  for (const connection of graph.connections) {
    if (connection.sourceNodeId === connection.targetNodeId) {
      push(
        'error',
        'SELF_CONNECTION',
        `Connection "${connection.id}" cannot connect node "${connection.sourceNodeId}" to itself.`,
        { connectionId: connection.id, nodeId: connection.sourceNodeId },
      );
      continue;
    }

    const sourceNode = logicNodesById.get(connection.sourceNodeId);
    const targetNode = logicNodesById.get(connection.targetNodeId);
    if (!sourceNode || !targetNode) {
      push(
        'error',
        'MISSING_CONNECTION_NODE',
        `Connection "${connection.id}" references a missing logic node.`,
        { connectionId: connection.id },
      );
      continue;
    }

    const dedupeKey = `${connection.sourceNodeId}:${connection.sourcePortId}->${connection.targetNodeId}:${connection.targetPortId}`;
    if (seenConnectionKeys.has(dedupeKey)) {
      push(
        'error',
        'DUPLICATE_CONNECTION',
        `Connection "${connection.id}" duplicates an existing wire between the same ports.`,
        { connectionId: connection.id },
      );
      continue;
    }
    seenConnectionKeys.add(dedupeKey);

    const sourceBuiltIn = isBuiltInLogicNodeType(sourceNode.type);
    const targetBuiltIn = isBuiltInLogicNodeType(targetNode.type);
    if (!sourceBuiltIn || !targetBuiltIn) {
      continue;
    }

    const sourcePort = getLogicNodePort(sourceNode.type, connection.sourcePortId);
    if (!sourcePort) {
      push(
        'error',
        'UNKNOWN_PORT',
        `Source port "${connection.sourcePortId}" does not exist on node type "${sourceNode.type}".`,
        { connectionId: connection.id, nodeId: sourceNode.id },
      );
      continue;
    }
    const targetPort = getLogicNodePort(targetNode.type, connection.targetPortId);
    if (!targetPort) {
      push(
        'error',
        'UNKNOWN_PORT',
        `Target port "${connection.targetPortId}" does not exist on node type "${targetNode.type}".`,
        { connectionId: connection.id, nodeId: targetNode.id },
      );
      continue;
    }

    if (sourcePort.direction !== 'out' || targetPort.direction !== 'in') {
      push(
        'error',
        'INVALID_PORT_DIRECTION',
        `Connection "${connection.id}" must flow from an output port to an input port.`,
        { connectionId: connection.id },
      );
      continue;
    }

    if (!areLogicPortTypesCompatible(sourcePort.dataType, targetPort.dataType)) {
      push(
        'error',
        'PORT_TYPE_MISMATCH',
        `Incompatible port types "${sourcePort.dataType}" -> "${targetPort.dataType}" on connection "${connection.id}".`,
        { connectionId: connection.id },
      );
      continue;
    }

    if (targetPort.dataType !== 'exec') {
      incomingDataPorts.add(`${targetNode.id}:${targetPort.id}`);
      const deps = dataflowEdges.get(targetNode.id) ?? [];
      deps.push(sourceNode.id);
      dataflowEdges.set(targetNode.id, deps);
    }
  }

  // Detect dataflow dependency cycles (DFS 3-color traversal).
  const color = new Map<string, 0 | 1 | 2>();
  const detectCycle = (nodeId: string): boolean => {
    color.set(nodeId, 1);
    for (const depId of dataflowEdges.get(nodeId) ?? []) {
      const depColor = color.get(depId) ?? 0;
      if (depColor === 1) return true;
      if (depColor === 0 && detectCycle(depId)) return true;
    }
    color.set(nodeId, 2);
    return false;
  };
  for (const node of graph.nodes) {
    if ((color.get(node.id) ?? 0) === 0 && detectCycle(node.id)) {
      push(
        'error',
        'DATAFLOW_CYCLE',
        `Dataflow cycle detected involving logic node "${node.id}". Pure data ports must form an acyclic graph.`,
        { nodeId: node.id },
      );
      break;
    }
  }

  // Validate individual logic nodes.
  for (const node of graph.nodes) {
    if (!isBuiltInLogicNodeType(node.type)) {
      push(
        'warning',
        'UNSUPPORTED_NODE_TYPE',
        `Logic node "${node.id}" uses non-v1 type "${node.type}" and will be preserved without execution.`,
        { nodeId: node.id },
      );
      continue;
    }

    const def = getLogicNodeDefinition(node.type);
    if (!def) continue;

    const targetNodeId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId.trim() : '';
    const variableId = typeof node.data.variableId === 'string' ? node.data.variableId.trim() : '';

    // Lazily compute upstream graph context for pipeline target & scoped ref checks.
    let cachedUpstreamNodes: readonly (typeof graph.nodes)[number][] | null = null;
    let cachedUpstreamOrigins: readonly PipelineOriginRef[] | null = null;
    const ensureUpstreamNodes = () => {
      if (!cachedUpstreamNodes) {
        cachedUpstreamNodes = getUpstreamNodes(graph.nodes, graph.connections, node.id);
      }
      return cachedUpstreamNodes;
    };
    const ensureUpstreamOrigins = () => {
      if (!cachedUpstreamOrigins) {
        cachedUpstreamOrigins = getUpstreamPipelineOrigins(
          graph.nodes,
          graph.connections,
          node.id,
          astNodesById,
          componentsById,
          project.animations,
        );
      }
      return cachedUpstreamOrigins;
    };

    // Validate any Scoped Data Picker references (pipelineRef, conditionRef, leftRef, rightRef, valueRef).
    const hasScopedRef = new Set<string>();
    for (const refKey of PIPELINE_REF_DATA_KEYS) {
      const rawRef = typeof node.data[refKey] === 'string' ? node.data[refKey].trim() : '';
      if (!rawRef) continue;
      hasScopedRef.add(refKey);
      const parsed = parsePipelineRef(rawRef);
      if (!parsed) {
        push(
          'error',
          'INVALID_PIPELINE_REF',
          `${def.label} node "${node.id}" has an invalid pipeline data reference "${rawRef}".`,
          { nodeId: node.id },
        );
        continue;
      }
      if (parsed.kind === 'origin') {
        if (ensureUpstreamOrigins().length === 0) {
          push(
            'error',
            'DISCONNECTED_PIPELINE_ORIGIN',
            `${def.label} references "origin.${parsed.field}", but no upstream Event or Source with a bound layer is connected.`,
            { nodeId: node.id },
          );
        }
      } else {
        const upstreamIds = new Set(ensureUpstreamNodes().map((item) => item.id));
        if (!upstreamIds.has(parsed.sourceNodeId)) {
          const referencedNode = logicNodesById.get(parsed.sourceNodeId);
          const srcLabel = referencedNode
            ? (getLogicNodeDefinition(referencedNode.type)?.label ?? referencedNode.type)
            : parsed.sourceNodeId;
          push(
            'error',
            'DISCONNECTED_PIPELINE_REF',
            `${def.label} references "${parsed.field}" from disconnected node "${srcLabel}". Reconnect the wire or choose an active upstream output.`,
            { nodeId: node.id },
          );
        }
      }
    }

    const resolveActionTarget = (
      nodeLabel: string,
    ): { readonly targetNode: DesignNode | undefined; readonly failed: boolean } => {
      if (getNodeTargetMode(node) === 'pipeline') {
        const origins = ensureUpstreamOrigins();
        if (origins.length === 0) {
          push(
            'error',
            'DISCONNECTED_PIPELINE_ORIGIN',
            `${nodeLabel} uses "Inherit from Pipeline", but no upstream Event or Element Source with a bound layer is connected.`,
            { nodeId: node.id },
          );
          return { targetNode: undefined, failed: true };
        }
        const pipelineChildId =
          typeof node.data.pipelineChildId === 'string' ? node.data.pipelineChildId.trim() : '';
        if (pipelineChildId) {
          const matchingOrigin = origins.find(
            (orig) =>
              orig.layerId === pipelineChildId
              || (orig.children?.some((child) => child.id === pipelineChildId) ?? false),
          );
          if (!matchingOrigin) {
            push(
              'error',
              'MISSING_PIPELINE_CHILD',
              `${nodeLabel} targets pipeline child "${pipelineChildId}", which is not inside the connected upstream origin.`,
              { nodeId: node.id },
            );
            return { targetNode: undefined, failed: true };
          }
          const resolvedChild = resolveAstNodeById(pipelineChildId, astNodesById, componentsById);
          return { targetNode: resolvedChild, failed: !resolvedChild };
        }
        const primaryOrigin = origins[0];
        const resolvedOrigin = resolveAstNodeById(primaryOrigin.layerId, astNodesById, componentsById);
        return { targetNode: resolvedOrigin, failed: !resolvedOrigin };
      }

      const resolved = targetNodeId ? resolveAstNodeById(targetNodeId, astNodesById, componentsById) : undefined;
      if (!resolved) {
        push(
          'error',
          'MISSING_TARGET_NODE',
          `${nodeLabel} node "${node.id}" references missing AST node "${targetNodeId}".`,
          { nodeId: node.id },
        );
        return { targetNode: undefined, failed: true };
      }
      return { targetNode: resolved, failed: false };
    };

    switch (node.type) {
      case 'source.page': {
        const pageId = typeof node.data.pageId === 'string' ? node.data.pageId.trim() : '';
        if (!pageId || !pagesById.has(pageId)) {
          push(
            'error',
            'MISSING_PAGE_REFERENCE',
            `Page node "${node.id}" must reference an existing page in this project.`,
            { nodeId: node.id },
          );
        } else if (seenSourcePageIds.has(pageId)) {
          push(
            'warning',
            'DUPLICATE_SOURCE_BINDING',
            `Page "${pagesById.get(pageId)?.name ?? pageId}" is already bound to another Page node in this graph.`,
            { nodeId: node.id },
          );
        } else {
          seenSourcePageIds.add(pageId);
        }
        break;
      }

      case 'source.component': {
        const componentId = typeof node.data.componentId === 'string' ? node.data.componentId.trim() : '';
        const component = componentId ? componentsById.get(componentId) : undefined;
        if (!component) {
          push(
            'error',
            'MISSING_COMPONENT_REFERENCE',
            `Component node "${node.id}" must reference an existing component in this project.`,
            { nodeId: node.id },
          );
        } else {
          if (!component.nodeLogicEnabled) {
            push(
              'warning',
              'COMPONENT_NOT_ENABLED_FOR_LOGIC',
              `Component "${component.name}" is not enabled for Node Logic. Use "Send to Node" in Component Rack.`,
              { nodeId: node.id },
            );
          }
          if (seenSourceComponentIds.has(componentId)) {
            push(
              'warning',
              'DUPLICATE_SOURCE_BINDING',
              `Component "${component.name}" is already bound to another Component node in this graph.`,
              { nodeId: node.id },
            );
          } else {
            seenSourceComponentIds.add(componentId);
          }
        }
        break;
      }

      case 'source.element': {
        if (!targetNodeId || !astNodesById.has(targetNodeId)) {
          push(
            'error',
            'MISSING_TARGET_NODE',
            `Canvas Layer node "${node.id}" references missing AST node "${targetNodeId}".`,
            { nodeId: node.id },
          );
        } else if (seenSourceElementIds.has(targetNodeId)) {
          push(
            'warning',
            'DUPLICATE_SOURCE_BINDING',
            `Layer "${astNodesById.get(targetNodeId)?.name ?? targetNodeId}" is already bound to another Canvas Layer node in this graph.`,
            { nodeId: node.id },
          );
        } else {
          seenSourceElementIds.add(targetNodeId);
        }
        break;
      }

      case 'source.theme': {
        const themeId = typeof node.data.themeId === 'string' ? node.data.themeId.trim() : '';
        if (!themeId || (themeIds.size > 0 && !themeIds.has(themeId))) {
          push(
            'error',
            'MISSING_THEME',
            `Theme node "${node.id}" references unknown theme "${themeId}".`,
            { nodeId: node.id },
          );
        } else if (seenSourceThemeIds.has(themeId)) {
          push(
            'warning',
            'DUPLICATE_SOURCE_BINDING',
            `Theme "${themeId}" is already bound to another Theme node in this graph.`,
            { nodeId: node.id },
          );
        } else {
          seenSourceThemeIds.add(themeId);
        }
        break;
      }

      case 'source.context': {
        const contextKind = String(node.data.contextKind ?? 'page');
        if (contextKind === 'page') {
          const pageId = typeof node.data.pageId === 'string' ? node.data.pageId.trim() : '';
          if (pageId && !pagesById.has(pageId)) {
            push('error', 'MISSING_PAGE_REFERENCE', `App / Context node "${node.id}" references missing page "${pageId}".`, { nodeId: node.id });
          }
        } else if (contextKind === 'theme') {
          const themeId = typeof node.data.themeId === 'string' ? node.data.themeId.trim() : '';
          if (themeId && themeIds.size > 0 && !themeIds.has(themeId)) {
            push('error', 'MISSING_THEME', `App / Context node "${node.id}" references unknown theme "${themeId}".`, { nodeId: node.id });
          }
        }
        break;
      }

      case 'source.external': {
        const endpoint = typeof node.data.endpoint === 'string' ? node.data.endpoint.trim() : '';
        if (endpoint && /^(?:javascript|vbscript):/i.test(endpoint)) {
          push('error', 'UNSAFE_NAVIGATE_URL', `External Data node "${node.id}" uses an unsafe endpoint protocol.`, { nodeId: node.id });
        }
        if (endpoint && hasEmbeddedUrlCredentials(endpoint)) {
          push('error', 'UNSAFE_NETWORK_URL_CREDENTIALS', `External Data node "${node.id}" must not embed credentials in its endpoint URL.`, { nodeId: node.id });
        }
        const rawHeaders = typeof node.data.headers === 'string' ? node.data.headers : '';
        const flaggedNodeHeaders = detectInlineSecretHeaders(rawHeaders);
        if (flaggedNodeHeaders.length > 0) {
          push(
            'error',
            'HARDCODED_SECRET_HEADER',
            `External Data node "${node.id}" headers contain hardcoded credential(s) (${flaggedNodeHeaders.join(', ')}).`,
            { nodeId: node.id },
          );
        }
        break;
      }

      case 'event.on-click':
      case 'event.on-hover':
      case 'event.on-input':
      case 'event.on-drag':
      case 'event.on-scroll-view': {
        const isPageScroll = node.type === 'event.on-scroll-view' && node.data.mode === 'page-scroll';
        if (!isPageScroll && (!targetNodeId || !astNodesById.has(targetNodeId))) {
          push(
            'error',
            'MISSING_TARGET_NODE',
            `${def.label} node "${node.id}" references missing AST node "${targetNodeId}".`,
            { nodeId: node.id },
          );
        }
        if (node.type === 'event.on-hover') {
          const phase = node.data.phase;
          if (phase !== undefined && phase !== 'enter' && phase !== 'leave') {
            push(
              'error',
              'INVALID_NODE_CONFIG',
              `On Hover node "${node.id}" phase must be "enter" or "leave".`,
              { nodeId: node.id },
            );
          }
        }
        if (typeof node.data.debounceMs === 'number' && node.data.debounceMs < 0) {
          push('error', 'INVALID_NODE_CONFIG', `${def.label} node "${node.id}" debounceMs must be >= 0.`, { nodeId: node.id });
        }
        if (typeof node.data.throttleMs === 'number' && node.data.throttleMs < 0) {
          push('error', 'INVALID_NODE_CONFIG', `${def.label} node "${node.id}" throttleMs must be >= 0.`, { nodeId: node.id });
        }
        break;
      }

      case 'event.on-key-press': {
        const keyCombo = typeof node.data.keyCombo === 'string' ? node.data.keyCombo.trim() : '';
        if (!keyCombo) {
          push('warning', 'INVALID_NODE_CONFIG', `On Key Press node "${node.id}" has an empty key combo.`, { nodeId: node.id });
        }
        break;
      }

      case 'event.on-lifecycle': {
        const trigger = String(node.data.trigger ?? 'page-load');
        if (trigger === 'animation-end') {
          const clipId = typeof node.data.clipId === 'string' ? node.data.clipId.trim() : '';
          if (clipId && !animationClipIds.has(clipId)) {
            push('error', 'MISSING_ANIMATION_CLIP', `On Lifecycle node "${node.id}" references missing animation clip "${clipId}".`, { nodeId: node.id });
          }
        }
        break;
      }

      case 'event.on-state-change':
      case 'state.get':
      case 'state.set':
      case 'state.toggle':
      case 'state.increment':
      case 'state.update': {
        // Toggle State uses target-bound private boolean memory by default when variableId is empty.
        if (node.type === 'state.toggle' && !variableId) {
          if (node.data.initialValue !== undefined && typeof node.data.initialValue !== 'boolean') {
            push(
              'error',
              'VARIABLE_TYPE_MISMATCH',
              `Toggle State node "${node.id}" only supports boolean values.`,
              { nodeId: node.id },
            );
          }
          break;
        }
        const variable = variableId ? variablesById.get(variableId) : undefined;
        if (!variable) {
          push(
            'error',
            'MISSING_VARIABLE',
            `${def.label} node "${node.id}" references undeclared variable "${variableId}".`,
            { nodeId: node.id },
          );
          break;
        }
        if (node.type === 'state.toggle' && variable.valueType !== 'boolean') {
          push(
            'error',
            'VARIABLE_TYPE_MISMATCH',
            `Toggle State node "${node.id}" requires a boolean variable, but "${variable.name}" is ${variable.valueType}.`,
            { nodeId: node.id },
          );
        }
        if (node.type === 'state.increment' || (node.type === 'state.update' && node.data.operation === 'increment')) {
          if (variable.valueType !== 'number') {
            push(
              'error',
              'VARIABLE_TYPE_MISMATCH',
              `${def.label} node "${node.id}" increment requires a number variable, but "${variable.name}" is ${variable.valueType}.`,
              { nodeId: node.id },
            );
          }
          if (node.data.min !== null && node.data.min !== undefined && typeof node.data.min !== 'number') {
            push('error', 'INVALID_NODE_CONFIG', `${def.label} node "${node.id}" min bound must be numeric.`, { nodeId: node.id });
          }
          if (node.data.max !== null && node.data.max !== undefined && typeof node.data.max !== 'number') {
            push('error', 'INVALID_NODE_CONFIG', `${def.label} node "${node.id}" max bound must be numeric.`, { nodeId: node.id });
          }
          if (typeof node.data.min === 'number' && typeof node.data.max === 'number' && node.data.min > node.data.max) {
            push('error', 'INVALID_NODE_CONFIG', `${def.label} node "${node.id}" min bound cannot exceed max bound.`, { nodeId: node.id });
          }
        }
        if (node.type === 'state.set' && !incomingDataPorts.has(`${node.id}:value`) && node.data.value !== null && node.data.value !== undefined) {
          if (typeof node.data.value !== variable.valueType) {
            push(
              'error',
              'VARIABLE_TYPE_MISMATCH',
              `Set State node "${node.id}" literal value type (${typeof node.data.value}) does not match variable "${variable.name}" (${variable.valueType}).`,
              { nodeId: node.id },
            );
          }
        }
        break;
      }

      case 'logic.compare':
      case 'logic.condition': {
        const mode = node.type === 'logic.condition' ? String(node.data.mode ?? 'compare') : 'compare';
        if (mode === 'compare') {
          const operator = String(node.data.operator ?? '==');
          if (!LOGIC_COMPARE_OPERATORS.includes(operator as (typeof LOGIC_COMPARE_OPERATORS)[number])) {
            push(
              'error',
              'INVALID_NODE_CONFIG',
              `${def.label} node "${node.id}" has unsupported operator "${operator}".`,
              { nodeId: node.id },
            );
          }
        } else if (mode === 'regex') {
          const pattern = typeof node.data.pattern === 'string' ? node.data.pattern : '';
          if (pattern) {
            try {
              // Verify pattern syntax safely
              new RegExp(pattern);
            } catch {
              push('error', 'INVALID_NODE_CONFIG', `Condition node "${node.id}" has an invalid regular expression.`, { nodeId: node.id });
            }
          }
        }
        break;
      }

      case 'logic.math': {
        if (node.data.operation === 'clamp' && typeof node.data.min === 'number' && typeof node.data.max === 'number' && node.data.min > node.data.max) {
          push('error', 'INVALID_NODE_CONFIG', `Math node "${node.id}" clamp min cannot exceed max.`, { nodeId: node.id });
        }
        break;
      }

      case 'action.set-layer': {
        const { targetNode } = resolveActionTarget('Set Layer');
        const property = String(node.data.property ?? 'text');
        const hasDynamicValue = incomingDataPorts.has(`${node.id}:value`) || hasScopedRef.has('pipelineRef');
        if (targetNode && property === 'fill' && (targetNode.type === 'group' || targetNode.type === 'component-instance')) {
          push(
            'warning',
            'INCOMPATIBLE_TARGET_NODE',
            `Set Layer "${node.id}" sets fill on ${targetNode.type} "${targetNode.name}". Select a child shape from the pipeline target instead.`,
            { nodeId: node.id },
          );
        }
        if (property === 'fill' && !hasDynamicValue) {
          const fill = typeof node.data.fill === 'string' ? node.data.fill : '';
          if (!isSafeCssColorValue(fill)) {
            push('error', 'UNSAFE_CSS_VALUE', `Set Layer node "${node.id}" contains an invalid or unsafe CSS color value.`, { nodeId: node.id });
          }
        }
        if (property === 'opacity' && typeof node.data.opacity === 'number' && (node.data.opacity < 0 || node.data.opacity > 1)) {
          push('error', 'INVALID_NODE_CONFIG', `Set Layer node "${node.id}" opacity must be between 0 and 1.`, { nodeId: node.id });
        }
        if (property === 'image' && typeof node.data.imageUrl === 'string' && node.data.imageUrl.trim() && !sanitizeHref(node.data.imageUrl.trim())) {
          push('error', 'UNSAFE_NAVIGATE_URL', `Set Layer node "${node.id}" uses an unsafe image URL.`, { nodeId: node.id });
        }
        break;
      }

      case 'action.set-visible': {
        resolveActionTarget('Set Visible');
        const mode = node.data.mode;
        if (mode !== undefined && mode !== 'show' && mode !== 'hide' && mode !== 'toggle') {
          push(
            'error',
            'INVALID_NODE_CONFIG',
            `Set Visible node "${node.id}" mode must be "show", "hide", or "toggle".`,
            { nodeId: node.id },
          );
        }
        break;
      }

      case 'action.set-text': {
        const { targetNode, failed } = resolveActionTarget('Set Text');
        if (!failed && targetNode && targetNode.type !== 'text') {
          push(
            'error',
            'INCOMPATIBLE_TARGET_NODE',
            `Set Text node "${node.id}" targets ${targetNode.type} node "${targetNode.name}" instead of a text node.`,
            { nodeId: node.id },
          );
        }
        break;
      }

      case 'action.set-fill': {
        const { targetNode, failed } = resolveActionTarget('Set Fill');
        if (!failed && targetNode && (targetNode.type === 'group' || targetNode.type === 'component-instance')) {
          push(
            'error',
            'INCOMPATIBLE_TARGET_NODE',
            `Set Fill node "${node.id}" cannot assign fill color directly to ${targetNode.type} node "${targetNode.name}".`,
            { nodeId: node.id },
          );
        }
        if (!incomingDataPorts.has(`${node.id}:fill`) && !hasScopedRef.has('pipelineRef')) {
          const fill = typeof node.data.fill === 'string' ? node.data.fill : '';
          if (!isSafeCssColorValue(fill)) {
            push(
              'error',
              'UNSAFE_CSS_VALUE',
              `Set Fill node "${node.id}" contains an invalid or unsafe CSS color value.`,
              { nodeId: node.id },
            );
          }
        }
        break;
      }

      case 'action.set-variant': {
        const { targetNode, failed } = resolveActionTarget('Set Variant');
        if (failed || !targetNode) {
          break;
        }
        if (targetNode.type !== 'component-instance') {
          push(
            'error',
            'INCOMPATIBLE_TARGET_NODE',
            `Set Variant node "${node.id}" must target a component instance.`,
            { nodeId: node.id },
          );
          break;
        }
        const master = componentsById.get(targetNode.componentId);
        const axisId = typeof node.data.axisId === 'string' ? node.data.axisId.trim() : '';
        const optionId = typeof node.data.optionId === 'string' ? node.data.optionId.trim() : '';
        const axis = master?.variants?.find((item) => item.id === axisId);
        if (!master || !axis) {
          push(
            'error',
            'INVALID_VARIANT_REFERENCE',
            `Set Variant node "${node.id}" references missing variant axis "${axisId}".`,
            { nodeId: node.id },
          );
          break;
        }
        if (!incomingDataPorts.has(`${node.id}:optionId`) && !axis.options.some((opt) => opt.id === optionId)) {
          push(
            'error',
            'INVALID_VARIANT_REFERENCE',
            `Set Variant node "${node.id}" references unknown variant option "${optionId}" on axis "${axis.name}".`,
            { nodeId: node.id },
          );
        }
        break;
      }

      case 'action.navigate': {
        const navMode = String(node.data.mode ?? 'internal');
        if ((navMode === 'internal' || navMode === 'external') && !incomingDataPorts.has(`${node.id}:route`)) {
          const rawRoute = typeof node.data.route === 'string' ? node.data.route.trim() : '';
          if (!rawRoute) {
            push(
              'error',
              'INVALID_NAVIGATE_TARGET',
              `Navigate node "${node.id}" requires a non-empty route or safe URL.`,
              { nodeId: node.id },
            );
            break;
          }
          const safeHref = sanitizeHref(rawRoute);
          if (!safeHref) {
            push(
              'error',
              'UNSAFE_NAVIGATE_URL',
              `Navigate node "${node.id}" uses a blocked or unsafe URL protocol.`,
              { nodeId: node.id },
            );
            break;
          }
          if (rawRoute.startsWith('/') && !pageRoutes.has(rawRoute)) {
            push(
              'warning',
              'UNKNOWN_PAGE_ROUTE',
              `Navigate node "${node.id}" points to route "${rawRoute}" which does not match any page in this project.`,
              { nodeId: node.id },
            );
          }
        }
        break;
      }

      case 'action.system-form': {
        const sysAction = String(node.data.action ?? 'set-theme');
        if (sysAction === 'set-theme' && !incomingDataPorts.has(`${node.id}:value`)) {
          const themeId = typeof node.data.themeId === 'string' ? node.data.themeId.trim() : '';
          if (!themeId || (themeIds.size > 0 && !themeIds.has(themeId))) {
            push('error', 'MISSING_THEME', `System & Form node "${node.id}" references unknown theme "${themeId}".`, { nodeId: node.id });
          }
        }
        break;
      }

      case 'action.set-theme': {
        if (!incomingDataPorts.has(`${node.id}:themeId`)) {
          const themeId = typeof node.data.themeId === 'string' ? node.data.themeId.trim() : '';
          if (!themeId || (themeIds.size > 0 && !themeIds.has(themeId))) {
            push(
              'error',
              'MISSING_THEME',
              `Set Theme node "${node.id}" references unknown theme "${themeId}".`,
              { nodeId: node.id },
            );
          }
        }
        break;
      }

      case 'action.media-animation': {
        const targetKind = String(node.data.targetKind ?? 'animation');
        if (targetKind === 'animation') {
          const clipId = typeof node.data.clipId === 'string' ? node.data.clipId.trim() : '';
          const inheritedClipId =
            !clipId && getNodeTargetMode(node) === 'pipeline'
              ? (ensureUpstreamOrigins()[0]?.animationIds[0] ?? '')
              : '';
          const effectiveClipId = clipId || inheritedClipId;
          if (!effectiveClipId || !animationClipIds.has(effectiveClipId)) {
            push(
              'error',
              'MISSING_ANIMATION_CLIP',
              `Media & Animation node "${node.id}" references missing animation clip "${clipId}".`,
              { nodeId: node.id },
            );
          }
        } else if (getNodeTargetMode(node) === 'pipeline') {
          resolveActionTarget('Media & Animation');
        }
        break;
      }

      case 'action.play-animation': {
        const clipId = typeof node.data.clipId === 'string' ? node.data.clipId.trim() : '';
        const inheritedClipId =
          !clipId && getNodeTargetMode(node) === 'pipeline'
            ? (ensureUpstreamOrigins()[0]?.animationIds[0] ?? '')
            : '';
        const effectiveClipId = clipId || inheritedClipId;
        if (!effectiveClipId || !animationClipIds.has(effectiveClipId)) {
          push(
            'error',
            'MISSING_ANIMATION_CLIP',
            `Play Animation node "${node.id}" references missing animation clip "${clipId}".`,
            { nodeId: node.id },
          );
        }
        break;
      }

      case 'flow.delay': {
        const dur = Number(node.data.duration ?? 0);
        if (!Number.isFinite(dur) || dur < 0) {
          push('error', 'INVALID_NODE_CONFIG', `Delay node "${node.id}" duration must be a non-negative number.`, { nodeId: node.id });
        }
        break;
      }

      case 'network.http': {
        const rawUrl = typeof node.data.url === 'string' ? node.data.url.trim() : '';
        if (rawUrl && /^(?:javascript|vbscript):/i.test(rawUrl)) {
          push('error', 'UNSAFE_NAVIGATE_URL', `HTTP Request node "${node.id}" uses an unsafe URL protocol.`, { nodeId: node.id });
        }
        if (rawUrl && hasEmbeddedUrlCredentials(rawUrl)) {
          push('error', 'UNSAFE_NETWORK_URL_CREDENTIALS', `HTTP Request node "${node.id}" must not embed credentials in its URL.`, { nodeId: node.id });
        }
        const rawHeaders = typeof node.data.headers === 'string' ? node.data.headers : '';
        const flaggedHttpHeaders = detectInlineSecretHeaders(rawHeaders);
        if (flaggedHttpHeaders.length > 0) {
          push(
            'error',
            'HARDCODED_SECRET_HEADER',
            `HTTP Request node "${node.id}" headers contain hardcoded credential(s) (${flaggedHttpHeaders.join(', ')}).`,
            { nodeId: node.id },
          );
        }
        const rawBody = typeof node.data.body === 'string' ? node.data.body : '';
        if (rawBody && containsRawSecretPattern(rawBody)) {
          push(
            'error',
            'HARDCODED_SECRET_HEADER',
            `HTTP Request node "${node.id}" body contains an inline secret token.`,
            { nodeId: node.id },
          );
        }
        break;
      }

      case 'network.socket': {
        const rawSocketUrl = typeof node.data.url === 'string' ? node.data.url.trim() : '';
        if (rawSocketUrl && hasEmbeddedUrlCredentials(rawSocketUrl)) {
          push('error', 'UNSAFE_NETWORK_URL_CREDENTIALS', `Realtime Socket node "${node.id}" must not embed credentials in its URL.`, { nodeId: node.id });
        }
        const rawSocketHeaders = typeof node.data.headers === 'string' ? node.data.headers : '';
        const flaggedSocketHeaders = detectInlineSecretHeaders(rawSocketHeaders);
        if (flaggedSocketHeaders.length > 0) {
          push(
            'error',
            'HARDCODED_SECRET_HEADER',
            `Realtime Socket node "${node.id}" headers contain hardcoded credential(s) (${flaggedSocketHeaders.join(', ')}).`,
            { nodeId: node.id },
          );
        }
        break;
      }

      case 'event.on-page-load':
      case 'logic.branch':
      case 'logic.template':
      case 'logic.text':
      case 'logic.list':
      case 'action.overlay-toast':
      case 'flow.loop-timer':
      case 'flow.control':
      case 'network.json':
        break;
    }
  }

  // Smart Logic Frame portability & integrity checks
  const frameTargetActionTypes = new Set([
    'action.set-layer',
    'action.set-visible',
    'action.set-text',
    'action.set-fill',
    'action.set-variant',
    'action.media-animation',
    'action.play-animation',
  ]);
  for (const frame of graph.frames ?? []) {
    for (const childId of frame.childNodeIds) {
      const childNode = logicNodesById.get(childId);
      if (!childNode || !frameTargetActionTypes.has(childNode.type)) continue;
      const targetMode = getNodeTargetMode(childNode);
      const staticTarget =
        typeof childNode.data.targetNodeId === 'string' ? childNode.data.targetNodeId.trim() : '';
      if (targetMode !== 'pipeline' && staticTarget.length > 0) {
        const childDef = getLogicNodeDefinition(childNode.type);
        push(
          'warning',
          'HARDCODED_LAYER_IN_FRAME',
          `"${childDef?.label ?? childNode.type}" inside frame "${frame.title}" targets a static layer instead of "Inherit from Pipeline". Switch to Pipeline mode for portable Presets.`,
          { nodeId: childNode.id, frameId: frame.id },
        );
      }
    }
  }

  const errors = diagnostics.filter((item) => item.severity === 'error');
  const warnings = diagnostics.filter((item) => item.severity === 'warning');
  return {
    ok: errors.length === 0,
    diagnostics,
    errors,
    warnings,
  };
}

export function validateProjectLogicGraphs(project: FolioProject): LogicValidationReport {
  const diagnostics: LogicDiagnostic[] = [];
  for (const graph of project.logicGraphs) {
    const report = validateLogicGraphSemantics(graph, project);
    diagnostics.push(...report.diagnostics);
  }
  const errors = diagnostics.filter((item) => item.severity === 'error');
  const warnings = diagnostics.filter((item) => item.severity === 'warning');
  return {
    ok: errors.length === 0,
    diagnostics,
    errors,
    warnings,
  };
}

/**
 * Removes component-scoped logic graphs targeting a deleted master component so
 * deleting a master never leaves dangling invalid `.flop` v2 graph scopes.
 */
export function pruneLogicGraphsForDeletedComponent(
  logicGraphs: readonly LogicGraph[],
  deletedComponentId: string,
): LogicGraph[] {
  const next = logicGraphs.filter(
    (graph) => !(graph.scope === 'component' && graph.targetId === deletedComponentId),
  );
  return next.length === logicGraphs.length ? (logicGraphs as LogicGraph[]) : next;
}

/**
 * Returns all orphan AST, variable, variant, or theme diagnostics across the
 * project's logic graphs for safe reporting without mutating user graphs.
 */
export function auditOrphanLogicReferences(project: FolioProject): readonly LogicDiagnostic[] {
  const orphanCodes = new Set([
    'INVALID_GRAPH_SCOPE',
    'MISSING_TARGET_NODE',
    'MISSING_PAGE_REFERENCE',
    'MISSING_COMPONENT_REFERENCE',
    'MISSING_VARIABLE',
    'INVALID_VARIANT_REFERENCE',
    'MISSING_THEME',
    'MISSING_ANIMATION_CLIP',
    'UNKNOWN_PAGE_ROUTE',
  ]);
  return validateProjectLogicGraphs(project).diagnostics.filter((item) => orphanCodes.has(item.code));
}
