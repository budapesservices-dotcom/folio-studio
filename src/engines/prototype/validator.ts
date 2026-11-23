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

export type LogicDiagnosticSeverity = 'error' | 'warning';

export interface LogicDiagnostic {
  readonly severity: LogicDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly graphId: string;
  readonly nodeId?: string;
  readonly connectionId?: string;
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
    extra?: { nodeId?: string; connectionId?: string },
  ) => {
    diagnostics.push({
      severity,
      code,
      message,
      graphId: graph.id,
      ...(extra?.nodeId ? { nodeId: extra.nodeId } : {}),
      ...(extra?.connectionId ? { connectionId: extra.connectionId } : {}),
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

  const variablesById = collectAvailableVariables(graph, project);
  const pageRoutes = new Set(project.pages.map((page) => page.route));
  const themeIds = new Set((project.designTokens?.themes ?? []).map((theme) => theme.id));
  const logicNodesById = new Map(graph.nodes.map((node) => [node.id, node]));

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

    switch (node.type) {
      case 'event.on-click':
      case 'event.on-hover': {
        if (!targetNodeId || !astNodesById.has(targetNodeId)) {
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
        break;
      }

      case 'event.on-state-change':
      case 'state.get':
      case 'state.set':
      case 'state.toggle':
      case 'state.increment': {
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
        if (node.type === 'state.increment') {
          if (variable.valueType !== 'number') {
            push(
              'error',
              'VARIABLE_TYPE_MISMATCH',
              `Increment State node "${node.id}" requires a number variable, but "${variable.name}" is ${variable.valueType}.`,
              { nodeId: node.id },
            );
          }
          if (node.data.min !== null && node.data.min !== undefined && typeof node.data.min !== 'number') {
            push('error', 'INVALID_NODE_CONFIG', `Increment State node "${node.id}" min bound must be numeric.`, { nodeId: node.id });
          }
          if (node.data.max !== null && node.data.max !== undefined && typeof node.data.max !== 'number') {
            push('error', 'INVALID_NODE_CONFIG', `Increment State node "${node.id}" max bound must be numeric.`, { nodeId: node.id });
          }
          if (typeof node.data.min === 'number' && typeof node.data.max === 'number' && node.data.min > node.data.max) {
            push('error', 'INVALID_NODE_CONFIG', `Increment State node "${node.id}" min bound cannot exceed max bound.`, { nodeId: node.id });
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

      case 'logic.compare': {
        const operator = String(node.data.operator ?? '==');
        if (!LOGIC_COMPARE_OPERATORS.includes(operator as (typeof LOGIC_COMPARE_OPERATORS)[number])) {
          push(
            'error',
            'INVALID_NODE_CONFIG',
            `Compare node "${node.id}" has unsupported operator "${operator}".`,
            { nodeId: node.id },
          );
        }
        break;
      }

      case 'action.set-visible': {
        if (!targetNodeId || !astNodesById.has(targetNodeId)) {
          push(
            'error',
            'MISSING_TARGET_NODE',
            `Set Visible node "${node.id}" references missing AST node "${targetNodeId}".`,
            { nodeId: node.id },
          );
        }
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
        const targetNode = targetNodeId ? astNodesById.get(targetNodeId) : undefined;
        if (!targetNode) {
          push(
            'error',
            'MISSING_TARGET_NODE',
            `Set Text node "${node.id}" references missing AST node "${targetNodeId}".`,
            { nodeId: node.id },
          );
        } else if (targetNode.type !== 'text') {
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
        const targetNode = targetNodeId ? astNodesById.get(targetNodeId) : undefined;
        if (!targetNode) {
          push(
            'error',
            'MISSING_TARGET_NODE',
            `Set Fill node "${node.id}" references missing AST node "${targetNodeId}".`,
            { nodeId: node.id },
          );
        } else if (targetNode.type === 'group' || targetNode.type === 'component-instance') {
          push(
            'error',
            'INCOMPATIBLE_TARGET_NODE',
            `Set Fill node "${node.id}" cannot assign fill color directly to ${targetNode.type} node "${targetNode.name}".`,
            { nodeId: node.id },
          );
        }
        if (!incomingDataPorts.has(`${node.id}:fill`)) {
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
        const targetNode = targetNodeId ? astNodesById.get(targetNodeId) : undefined;
        if (!targetNode) {
          push(
            'error',
            'MISSING_TARGET_NODE',
            `Set Variant node "${node.id}" references missing AST node "${targetNodeId}".`,
            { nodeId: node.id },
          );
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

      case 'event.on-page-load':
      case 'logic.branch':
      case 'logic.template':
        break;
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
    'MISSING_VARIABLE',
    'INVALID_VARIANT_REFERENCE',
    'MISSING_THEME',
    'UNKNOWN_PAGE_ROUTE',
  ]);
  return validateProjectLogicGraphs(project).diagnostics.filter((item) => orphanCodes.has(item.code));
}
