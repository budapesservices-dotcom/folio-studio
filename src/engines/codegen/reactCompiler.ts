import { sanitizeProjectNetworkSecrets } from '../../core/document/networkSecrets';
import { getActivePage } from '../../core/document/project';
import { getProjectDesignTokens } from '../../core/document/tokens';
import type {
  AssetReference,
  ComponentDefinition,
  ComponentInstanceNode,
  DesignNode,
  DesignTokenCollection,
  FolioPage,
  FolioProject,
  PathNode,
} from '../../core/document/types';
import { isSafeHtmlClassName, isSafeHtmlId } from '../../core/document/cssUnits';
import { serializePathPointsToSvgD } from '../../core/document/vector';
import { getAssetBundlePath } from '../../core/persistence/assetStore';
import {
  buildArrowheadPoints,
  buildChildrenMap,
  buildNodeCssDeclarations,
  buildNodePseudoStateCssRules,
  buildVectorMaskDefsLines,
  getNodeBorderInset,
  isVoidHtmlTag,
  resolveSemanticTag,
  resolveTokenCssVar,
  roundCss,
} from './htmlCssCompiler';
import { applyAutoLayoutToNodes } from '../layout/autoLayout';
import {
  sanitizeCommentLabel,
  sanitizeCssValue,
  sanitizeHref,
  sanitizeRelativeModulePath,
  toCamelCase,
  toCssClassName,
  toKebabCase,
  toPageFileSlug,
  toPascalCase,
} from './sanitize';
import type { CodeMappingEntry, CompiledCodeFile } from './types';
import { isBuiltInLogicNodeType } from '../prototype/catalog';
import { buildReactPageLogicPlan, type ReactPageLogicPlan } from '../prototype/codegen';

function escapeJsxText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;');
}

function escapeTsString(value: string): string {
  return JSON.stringify(value);
}

function escapeCssAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ');
}

function createUniqueIdentifierMap<T extends { id: string }>(
  items: readonly T[],
  toBaseName: (item: T) => string,
): Map<string, string> {
  const used = new Set<string>();
  const map = new Map<string, string>();
  for (const item of items) {
    const base = toBaseName(item);
    let candidate = base;
    let index = 2;
    while (used.has(candidate)) {
      candidate = `${base}${index}`;
      index += 1;
    }
    used.add(candidate);
    map.set(item.id, candidate);
  }
  return map;
}

function buildInlineJsxSvgLines(
  node: PathNode,
  tokens: DesignTokenCollection,
  indent: string,
  dynamicFillExpr?: string,
): string[] {
  const d = serializePathPointsToSvgD(node.points, node.closed, node.subpaths);
  const w = Math.max(1, roundCss(node.width));
  const h = Math.max(1, roundCss(node.height));
  const fillVar = resolveTokenCssVar(tokens, node.tokenBindings?.fill);
  const strokeVar = resolveTokenCssVar(tokens, node.tokenBindings?.stroke);
  const baseFill = fillVar ?? sanitizeCssValue(node.style.fill || 'none', 'none');
  const baseStroke = strokeVar ?? sanitizeCssValue(node.style.stroke || 'none', 'none');
  const strokeWidth = Math.max(0, roundCss(node.style.strokeWidth));
  const effectiveDynamicFill = fillVar ? undefined : dynamicFillExpr;

  const pathAttrs: string[] = [
    `d=${escapeTsString(d)}`,
    effectiveDynamicFill
      ? `fill={${effectiveDynamicFill} ?? ${escapeTsString(baseFill)}}`
      : `fill=${escapeTsString(baseFill)}`,
    `stroke=${escapeTsString(baseStroke)}`,
    `strokeWidth={${strokeWidth}}`,
    `strokeLinecap=${escapeTsString(node.style.strokeLinecap ?? 'round')}`,
    `strokeLinejoin=${escapeTsString(node.style.strokeLinejoin ?? 'round')}`,
  ];
  if (node.style.fillRule === 'evenodd') {
    pathAttrs.push('fillRule="evenodd"');
  }
  if (node.style.strokeDasharray) {
    pathAttrs.push(`strokeDasharray=${escapeTsString(node.style.strokeDasharray)}`);
  }

  const svgLines: string[] = [
    `${indent}<svg width={${w}} height={${h}} viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" fill="none" overflow="visible" style={{ display: "block", width: "100%", height: "100%" }} aria-hidden="true">`,
    `${indent}  <path ${pathAttrs.join(' ')} />`,
  ];

  if (!node.closed && node.points.length >= 2 && (node.style.arrowStart || node.style.arrowEnd)) {
    const arrowColor =
      baseStroke !== 'none' && baseStroke !== '#00000000' ? baseStroke : baseFill;
    if (arrowColor && arrowColor !== 'none') {
      const size = Math.max(10, Math.min(28, (node.style.strokeWidth || 2) * 3.8));
      if (node.style.arrowEnd) {
        const tip = node.points[node.points.length - 1];
        const prev = tip.handleIn ?? node.points[node.points.length - 2];
        const pts = buildArrowheadPoints(tip, prev, size);
        if (pts) svgLines.push(`${indent}  <polygon points=${escapeTsString(pts)} fill=${escapeTsString(arrowColor)} />`);
      }
      if (node.style.arrowStart) {
        const tip = node.points[0];
        const next = tip.handleOut ?? node.points[1];
        const pts = buildArrowheadPoints(tip, next, size);
        if (pts) svgLines.push(`${indent}  <polygon points=${escapeTsString(pts)} fill=${escapeTsString(arrowColor)} />`);
      }
    }
  }

  svgLines.push(`${indent}</svg>`);
  return svgLines;
}

interface VariantAxisMeta {
  id: string;
  name: string;
  propName: string;
  dataAttr: string;
  defaultLabel: string;
  options: Array<{ id: string; label: string }>;
}

interface SlotMeta {
  id: string;
  name: string;
  targetNodeId: string;
  contentProp: string;
  visibleProp: string;
  fillProp: string;
  defaultText?: string;
}

function buildComponentStylesheet(
  component: ComponentDefinition,
  componentName: string,
  rootClass: string,
  tokens: DesignTokenCollection,
  variantAxes: readonly VariantAxisMeta[],
): CompiledCodeFile {
  const lines: string[] = [
    `/* Generated by FOLIO Code Engine — Stylesheet for Master Component "${sanitizeCommentLabel(component.name)}" */`,
    '/* Base layout, typography, token var() bindings, and active Variant override rules. */',
    '',
  ];
  const mappings: CodeMappingEntry[] = [];

  const rootDecls: string[] = [
    'position: relative;',
    `width: ${roundCss(Math.max(1, component.document.width))}px;`,
    `height: ${roundCss(Math.max(1, component.document.height))}px;`,
    'box-sizing: border-box;',
  ];
  if (
    component.document.background
    && component.document.background !== '#00000000'
    && component.document.background !== 'transparent'
  ) {
    rootDecls.push(`background: ${sanitizeCssValue(component.document.background, 'transparent')};`);
  }

  lines.push(`.${rootClass} {`);
  for (const decl of rootDecls) lines.push(`  ${decl}`);
  lines.push('}');
  lines.push('');

  const solvedMasterNodes = component.document.nodes.some((n) => n.layout && n.layout.mode !== 'none')
    ? applyAutoLayoutToNodes(component.document.nodes, undefined, tokens)
    : component.document.nodes;
  const { roots, childrenByParent, nodeById } = buildChildrenMap(solvedMasterNodes);
  const classByNodeId = new Map<string, string>();

  const emitMasterCss = (
    node: DesignNode,
    parent: DesignNode | null,
    isChildOfAutoLayout: boolean,
    originOffset: { x: number; y: number },
  ) => {
    const cls = toCssClassName('fc', node.name, node.id);
    classByNodeId.set(node.id, cls);
    const selector = `.${rootClass} .${cls}`;
    const declarations = buildNodeCssDeclarations(node, tokens, {
      parent,
      isChildOfAutoLayout,
      isInstanceChild: true,
      hasRootAutoLayout: false,
      originOffset,
      nodeById,
      maskPrefix: toKebabCase(componentName, 'comp'),
    });
    if (declarations.length > 0) {
      const startLine = lines.length + 1;
      lines.push(`${selector} {`);
      for (const decl of declarations) lines.push(`  ${decl}`);
      lines.push('}');
      const endLine = lines.length;
      lines.push('');
      mappings.push({
        nodeId: node.id,
        nodeName: node.name,
        componentId: component.id,
        category: 'generated',
        startLine,
        endLine,
        selector,
      });
    }

    const pseudoRules = buildNodePseudoStateCssRules(node, selector);
    for (const rule of pseudoRules) {
      lines.push(`${rule.selector} {`);
      for (const decl of rule.declarations) lines.push(`  ${decl}`);
      lines.push('}');
      lines.push('');
    }

    const children = childrenByParent.get(node.id) ?? [];
    const selfIsAutoLayout = Boolean(node.layout && node.layout.mode !== 'none');
    const borderInset = getNodeBorderInset(node);
    for (const child of children) {
      emitMasterCss(child, node, selfIsAutoLayout, { x: node.x + borderInset.left, y: node.y + borderInset.top });
    }
  };

  for (const root of roots) {
    emitMasterCss(root, null, false, { x: 0, y: 0 });
  }

  // Emit Variant CSS override rules in axis order.
  // Canonical precedence: Master -> Variants -> Slots -> Local Overrides -> Tokens.
  // Token-bound fill/stroke properties remain governed by their Design Token CSS custom property.
  for (const axisMeta of variantAxes) {
    const axis = (component.variants ?? []).find((item) => item.id === axisMeta.id);
    if (!axis) continue;
    for (const option of axis.options) {
      const attrSelector = `.${rootClass}[${axisMeta.dataAttr}="${escapeCssAttrValue(option.label)}"]`;
      for (const [targetId, patch] of Object.entries(option.overrides)) {
        const targetNode = nodeById.get(targetId);
        const cls = classByNodeId.get(targetId);
        if (!targetNode || !cls) continue;

        const hasBoundFill = Boolean(resolveTokenCssVar(tokens, targetNode.tokenBindings?.fill));
        const hasBoundStroke = Boolean(resolveTokenCssVar(tokens, targetNode.tokenBindings?.stroke));

        const decls: string[] = [];
        if (patch.visible === false) {
          decls.push('display: none;');
        } else if (patch.visible === true && !targetNode.visible) {
          const shownDisplay =
            targetNode.layout?.mode === 'flex'
              ? 'flex'
              : targetNode.layout?.mode === 'grid'
                ? 'grid'
                : 'block';
          decls.push(`display: ${shownDisplay};`);
        }

        if (patch.fill !== undefined && !hasBoundFill && targetNode.type !== 'path') {
          if (targetNode.type === 'text') {
            decls.push(`color: ${sanitizeCssValue(patch.fill, 'inherit')};`);
          } else {
            decls.push(`background: ${sanitizeCssValue(patch.fill, 'transparent')};`);
          }
        }
        if (patch.stroke !== undefined && !hasBoundStroke && targetNode.type !== 'path' && targetNode.type !== 'text') {
          decls.push(`border-color: ${sanitizeCssValue(patch.stroke, 'transparent')};`);
        }

        if (decls.length > 0) {
          lines.push(`${attrSelector} .${cls} {`);
          for (const decl of decls) lines.push(`  ${decl}`);
          lines.push('}');
          lines.push('');
        }

        if (targetNode.type === 'path' && ((patch.fill !== undefined && !hasBoundFill) || (patch.stroke !== undefined && !hasBoundStroke))) {
          const pathDecls: string[] = [];
          if (patch.fill !== undefined && !hasBoundFill) pathDecls.push(`fill: ${sanitizeCssValue(patch.fill, 'none')};`);
          if (patch.stroke !== undefined && !hasBoundStroke) pathDecls.push(`stroke: ${sanitizeCssValue(patch.stroke, 'none')};`);
          if (pathDecls.length > 0) {
            lines.push(`${attrSelector} .${cls} svg path {`);
            for (const decl of pathDecls) lines.push(`  ${decl}`);
            lines.push('}');
            lines.push('');
          }
        }
      }
    }
  }

  return {
    id: `generated:react:component-css:${component.id}`,
    path: `src/components/${componentName}.css`,
    language: 'css',
    category: 'generated',
    readOnly: true,
    content: `${lines.join('\n').trimEnd()}\n`,
    componentId: component.id,
    description: `Compiled component styles and Variant rules for Master "${component.name}".`,
    mappings,
  };
}

function buildNestedInstancePropsList(
  node: ComponentInstanceNode,
  comp: ComponentDefinition,
  cls: string,
  childSupportsScopedLogic: boolean,
  parentSupportsScopedLogic: boolean,
): { props: string[]; needsScale: boolean } {
  const masterW = Math.max(1, comp.document.width);
  const masterH = Math.max(1, comp.document.height);
  const scaleX = node.width / masterW;
  const scaleY = node.height / masterH;
  const needsScale = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;

  const instanceProps: string[] = needsScale
    ? [`style={{ transform: ${escapeTsString(`scale(${roundCss(scaleX)}, ${roundCss(scaleY)})`)}, transformOrigin: "top left" }}`]
    : [`className=${escapeTsString(cls)}`];

  const usedPropNames = new Set<string>(
    childSupportsScopedLogic
      ? ['className', 'style', 'overrides', 'instanceId', 'logicOverrides', 'onLogicEvent']
      : ['className', 'style', 'overrides'],
  );
  const allocProp = (raw: string, fallback: string): string => {
    const base = toCamelCase(raw, fallback);
    let candidate = base;
    let idx = 2;
    while (usedPropNames.has(candidate)) {
      candidate = `${base}${idx}`;
      idx += 1;
    }
    usedPropNames.add(candidate);
    return candidate;
  };

  for (const axis of comp.variants ?? []) {
    const propName = allocProp(axis.name, 'variant');
    const chosenId = node.variantSelection?.[axis.id] ?? axis.defaultOptionId;
    const opt = axis.options.find((o) => o.id === chosenId) ?? axis.options[0];
    if (opt) {
      if (parentSupportsScopedLogic) {
        const unionType = axis.options.map((o) => escapeTsString(o.label)).join(' | ') || 'string';
        instanceProps.push(
          `${propName}={(logicOverrides?.[scopedId(${escapeTsString(node.id)})]?.variants?.[${escapeTsString(axis.id)}] ?? ${escapeTsString(opt.label)}) as ${unionType}}`,
        );
      } else {
        instanceProps.push(`${propName}=${escapeTsString(opt.label)}`);
      }
    }
  }
  for (const slot of comp.slots ?? []) {
    const contentProp = allocProp(slot.name, 'slot');
    const visibleProp = allocProp(`${slot.name}Visible`, 'slotVisible');
    const fillProp = allocProp(`${slot.name}Fill`, 'slotFill');
    const assignment = node.slotAssignments?.[slot.id];
    if (assignment?.text !== undefined) {
      instanceProps.push(`${contentProp}=${escapeTsString(assignment.text)}`);
    }
    if (assignment?.visible !== undefined) {
      instanceProps.push(`${visibleProp}={${assignment.visible ? 'true' : 'false'}}`);
    }
    if (assignment?.fill !== undefined) {
      instanceProps.push(`${fillProp}=${escapeTsString(sanitizeCssValue(assignment.fill, 'transparent'))}`);
    }
  }
  const cleanedOverrides: Record<string, { fill?: string; text?: string }> = {};
  for (const [childId, ov] of Object.entries(node.overrides)) {
    const entry: { fill?: string; text?: string } = {};
    if (ov.fill !== undefined) entry.fill = sanitizeCssValue(ov.fill, 'transparent');
    if (ov.text !== undefined) entry.text = ov.text;
    if (entry.fill !== undefined || entry.text !== undefined) {
      cleanedOverrides[childId] = entry;
    }
  }
  if (Object.keys(cleanedOverrides).length > 0) {
    instanceProps.push(`overrides={${JSON.stringify(cleanedOverrides)}}`);
  }
  if (parentSupportsScopedLogic && childSupportsScopedLogic) {
    instanceProps.push(`instanceId={scopedId(${escapeTsString(node.id)})}`);
    instanceProps.push('logicOverrides={logicOverrides}');
    instanceProps.push('onLogicEvent={onLogicEvent}');
  }

  return { props: instanceProps, needsScale };
}

function buildComponentFiles(
  component: ComponentDefinition,
  componentName: string,
  tokens: DesignTokenCollection,
  componentsById: ReadonlyMap<string, ComponentDefinition>,
  componentNamesById: ReadonlyMap<string, string>,
  assetsById: ReadonlyMap<string, AssetReference>,
  supportsScopedLogic: boolean,
  componentsWithScopedLogic: ReadonlySet<string>,
): CompiledCodeFile[] {
  const rootClass = `folio-comp-${toKebabCase(component.name, 'component')}`;
  const usedProps = new Set<string>(
    supportsScopedLogic
      ? ['className', 'style', 'overrides', 'instanceId', 'logicOverrides', 'onLogicEvent']
      : ['className', 'style', 'overrides'],
  );

  const allocProp = (raw: string, fallback: string): string => {
    const base = toCamelCase(raw, fallback);
    let candidate = base;
    let index = 2;
    while (usedProps.has(candidate)) {
      candidate = `${base}${index}`;
      index += 1;
    }
    usedProps.add(candidate);
    return candidate;
  };

  const variantAxes: VariantAxisMeta[] = (component.variants ?? []).map((axis) => {
    const defaultOpt = axis.options.find((opt) => opt.id === axis.defaultOptionId) ?? axis.options[0];
    const propName = allocProp(axis.name, 'variant');
    return {
      id: axis.id,
      name: axis.name,
      propName,
      dataAttr: `data-variant-${toKebabCase(axis.name, 'variant')}`,
      defaultLabel: defaultOpt?.label ?? '',
      options: axis.options.map((opt) => ({ id: opt.id, label: opt.label })),
    };
  });

  const slots: SlotMeta[] = (component.slots ?? []).map((slot) => {
    const contentProp = allocProp(slot.name, 'slot');
    const visibleProp = allocProp(`${slot.name}Visible`, 'slotVisible');
    const fillProp = allocProp(`${slot.name}Fill`, 'slotFill');
    return {
      id: slot.id,
      name: slot.name,
      targetNodeId: slot.targetNodeId,
      contentProp,
      visibleProp,
      fillProp,
      defaultText: slot.defaultText,
    };
  });

  const slotByTargetId = new Map<string, SlotMeta>();
  for (const slot of slots) {
    slotByTargetId.set(slot.targetNodeId, slot);
  }

  // Track which master nodes are targeted by any variant override (visibility or text)
  const variantTargetedNodes = new Set<string>();
  const variantTextRulesByNodeId = new Map<string, Array<{ propName: string; optionLabel: string; text: string }>>();
  for (const axisMeta of variantAxes) {
    const axis = (component.variants ?? []).find((item) => item.id === axisMeta.id);
    if (!axis) continue;
    for (const option of axis.options) {
      for (const [targetId, patch] of Object.entries(option.overrides)) {
        variantTargetedNodes.add(targetId);
        if (patch.text !== undefined) {
          const list = variantTextRulesByNodeId.get(targetId) ?? [];
          list.push({ propName: axisMeta.propName, optionLabel: option.label, text: patch.text });
          variantTextRulesByNodeId.set(targetId, list);
        }
      }
    }
  }

  const usedNestedComponents = new Set<string>();
  for (const node of component.document.nodes) {
    if (
      node.type === 'component-instance'
      && node.componentId !== component.id
      && componentsById.has(node.componentId)
    ) {
      usedNestedComponents.add(node.componentId);
    }
  }

  const lines: string[] = [
    '// Generated by FOLIO Code Engine — Component Contract',
    '// Precedence: Master -> Variants -> Slots -> Local Overrides -> Tokens.',
    "import React from 'react';",
  ];
  for (const nestedCompId of usedNestedComponents) {
    const nestedCompName = componentNamesById.get(nestedCompId);
    if (nestedCompName) {
      lines.push(`import { ${nestedCompName} } from './${nestedCompName}';`);
    }
  }
  lines.push(`import './${componentName}.css';`);
  lines.push('');

  const propLines: string[] = [];
  const destructuredProps: string[] = [];

  for (const axisMeta of variantAxes) {
    const unionType = axisMeta.options.map((opt) => escapeTsString(opt.label)).join(' | ') || 'string';
    propLines.push(`  ${axisMeta.propName}?: ${unionType};`);
    destructuredProps.push(
      axisMeta.defaultLabel
        ? `${axisMeta.propName} = ${escapeTsString(axisMeta.defaultLabel)}`
        : axisMeta.propName,
    );
  }

  for (const slot of slots) {
    propLines.push(`  ${slot.contentProp}?: React.ReactNode;`);
    propLines.push(`  ${slot.visibleProp}?: boolean;`);
    propLines.push(`  ${slot.fillProp}?: string;`);
    destructuredProps.push(slot.contentProp, slot.visibleProp, slot.fillProp);
  }

  propLines.push('  overrides?: Record<string, { fill?: string; text?: string }>;');
  if (supportsScopedLogic) {
    propLines.push('  instanceId?: string;');
    propLines.push(
      '  logicOverrides?: Record<string, { visible?: boolean; text?: string; fill?: string; opacity?: number; transform?: string; imageUrl?: string; disabled?: boolean; transitionMs?: number; variants?: Record<string, string> }>;',
    );
    propLines.push(
      '  onLogicEvent?: (kind: "click" | "double-click" | "hover-enter" | "hover-leave" | "input-change" | "input-focus" | "input-blur" | "input-submit" | "drag-start" | "drag-move" | "drag-drop", targetId: string, payload?: Record<string, unknown>) => void;',
    );
  }
  propLines.push('  className?: string;');
  propLines.push('  style?: React.CSSProperties;');
  destructuredProps.push(
    'overrides',
    ...(supportsScopedLogic ? ['instanceId', 'logicOverrides', 'onLogicEvent'] : []),
    'className',
    'style',
  );

  lines.push(`export interface ${componentName}Props {`);
  lines.push(...propLines);
  lines.push('}');
  lines.push('');

  lines.push(`export function ${componentName}({`);
  for (const entry of destructuredProps) {
    lines.push(`  ${entry},`);
  }
  lines.push(`}: ${componentName}Props) {`);
  if (supportsScopedLogic) {
    lines.push('  const scopedId = (localId: string) => (instanceId ? `${instanceId}__${localId}` : localId);');
  }

  // Precompute variant-driven text resolution for any node that has variant text overrides
  const variantTextVarByNodeId = new Map<string, string>();
  let variantTextCounter = 0;
  for (const [targetId, rules] of variantTextRulesByNodeId.entries()) {
    variantTextCounter += 1;
    const varName = `variantText_${variantTextCounter}`;
    variantTextVarByNodeId.set(targetId, varName);
    lines.push(`  let ${varName}: string | undefined;`);
    for (const rule of rules) {
      lines.push(`  if (${rule.propName} === ${escapeTsString(rule.optionLabel)}) ${varName} = ${escapeTsString(rule.text)};`);
    }
  }

  const rootAttrs: string[] = [
    `className={[${escapeTsString(rootClass)}, className].filter(Boolean).join(' ')}`,
    ...(supportsScopedLogic ? ['data-folio-id={instanceId}'] : []),
    `data-folio-component=${escapeTsString(component.id)}`,
  ];
  for (const axisMeta of variantAxes) {
    rootAttrs.push(`${axisMeta.dataAttr}={${axisMeta.propName}}`);
  }
  rootAttrs.push('style={style}');

  lines.push('  return (');
  lines.push(`    <div ${rootAttrs.join(' ')}>`);
  const compMaskDefs = buildVectorMaskDefsLines(
    component.document.nodes,
    toKebabCase(componentName, 'comp'),
    true,
    '      ',
  );
  if (compMaskDefs.length > 0) {
    lines.push(...compMaskDefs);
  }

  const { roots, childrenByParent } = buildChildrenMap(component.document.nodes);
  const mappings: CodeMappingEntry[] = [];

  const emitMasterJsx = (node: DesignNode, depth: number) => {
    const slot = slotByTargetId.get(node.id);
    const hasVariantTarget = variantTargetedNodes.has(node.id);
    if (!node.visible && !slot && !hasVariantTarget && !supportsScopedLogic) return;

    const indent = '  '.repeat(depth);
    const tag = resolveSemanticTag(node);
    const cls = toCssClassName('fc', node.name, node.id);
    const startLine = lines.length + 1;
    const nodeIdLit = escapeTsString(node.id);
    const scopedIdExpr = `scopedId(${nodeIdLit})`;
    const dynOvExpr = `logicOverrides?.[${scopedIdExpr}]`;

    const extraClass =
      node.className?.trim() && isSafeHtmlClassName(node.className.trim())
        ? ` ${node.className.trim()}`
        : '';
    const attrs: string[] = [];
    if (node.htmlId?.trim() && isSafeHtmlId(node.htmlId.trim())) {
      attrs.push(`id=${escapeTsString(node.htmlId.trim())}`);
    }
    attrs.push(
      `className=${escapeTsString(`${cls}${extraClass}`)}`,
      supportsScopedLogic ? `data-folio-id={${scopedIdExpr}}` : `data-folio-id=${nodeIdLit}`,
    );
    if (node.ariaLabel?.trim()) {
      attrs.push(`aria-label=${escapeTsString(node.ariaLabel.trim())}`);
    }
    if (tag === 'a') {
      attrs.push(`href=${escapeTsString(sanitizeHref(node.href) ?? '#')}`);
      if (node.linkTarget === '_blank') {
        attrs.push('target="_blank"');
        attrs.push('rel="noopener noreferrer"');
      }
    }
    if (tag === 'button') {
      attrs.push('type="button"');
    }
    if (supportsScopedLogic) {
      attrs.push(`onClick={onLogicEvent ? () => onLogicEvent("click", ${scopedIdExpr}) : undefined}`);
      attrs.push(`onDoubleClick={onLogicEvent ? () => onLogicEvent("double-click", ${scopedIdExpr}) : undefined}`);
      attrs.push(`onMouseEnter={onLogicEvent ? () => onLogicEvent("hover-enter", ${scopedIdExpr}) : undefined}`);
      attrs.push(`onMouseLeave={onLogicEvent ? () => onLogicEvent("hover-leave", ${scopedIdExpr}) : undefined}`);
      attrs.push(`onChange={onLogicEvent ? (ev) => onLogicEvent("input-change", ${scopedIdExpr}, { value: (ev.currentTarget as unknown as { value?: string }).value ?? ev.currentTarget.textContent ?? "" }) : undefined}`);
      attrs.push(`onFocus={onLogicEvent ? (ev) => onLogicEvent("input-focus", ${scopedIdExpr}, { value: (ev.currentTarget as unknown as { value?: string }).value ?? ev.currentTarget.textContent ?? "" }) : undefined}`);
      attrs.push(`onBlur={onLogicEvent ? (ev) => onLogicEvent("input-blur", ${scopedIdExpr}, { value: (ev.currentTarget as unknown as { value?: string }).value ?? ev.currentTarget.textContent ?? "" }) : undefined}`);
      attrs.push(`onPointerDown={onLogicEvent ? (ev) => onLogicEvent("drag-start", ${scopedIdExpr}, { x: ev.clientX ?? 0, y: ev.clientY ?? 0 }) : undefined}`);
      attrs.push(`onPointerMove={onLogicEvent ? (ev) => onLogicEvent("drag-move", ${scopedIdExpr}, { x: ev.clientX ?? 0, y: ev.clientY ?? 0 }) : undefined}`);
      attrs.push(`onPointerUp={onLogicEvent ? (ev) => onLogicEvent("drag-drop", ${scopedIdExpr}, { x: ev.clientX ?? 0, y: ev.clientY ?? 0 }) : undefined}`);
      attrs.push(`aria-disabled={${dynOvExpr}?.disabled ? "true" : undefined}`);
      if (tag === 'button' || tag === 'input') {
        attrs.push(`disabled={Boolean(${dynOvExpr}?.disabled)}`);
      }
    }

    // Build inline style override expression respecting canonical precedence:
    // Master -> Variants -> Slots -> Local Overrides -> Tokens (+ Runtime Logic Overrides).
    // When fill is bound to a Design Token, the token CSS variable governs final color.
    const hasBoundFill = Boolean(resolveTokenCssVar(tokens, node.tokenBindings?.fill));
    const directFillExpr = `overrides?.[${nodeIdLit}]?.fill`;
    const baseFillExpr = slot
      ? `${directFillExpr} ?? ${slot.fillProp}`
      : directFillExpr;
    const effectiveFillExpr = supportsScopedLogic
      ? `${dynOvExpr}?.fill ?? ${baseFillExpr}`
      : baseFillExpr;

    const shownDisplay = node.layout?.mode === 'flex' ? 'flex' : node.layout?.mode === 'grid' ? 'grid' : 'block';
    const styleParts: string[] = [];
    const runtimeFillExpr = hasBoundFill
      ? (supportsScopedLogic ? `${dynOvExpr}?.fill` : undefined)
      : effectiveFillExpr;
    if (runtimeFillExpr) {
      if (node.type === 'text') {
        styleParts.push(`...(${runtimeFillExpr} ? { color: ${runtimeFillExpr} } : {})`);
      } else if (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse') {
        styleParts.push(`...(${runtimeFillExpr} ? { background: ${runtimeFillExpr} } : {})`);
      }
    }
    if (slot) {
      styleParts.push(
        `...(${slot.visibleProp} === false ? { display: 'none' } : ${slot.visibleProp} === true ? { display: ${escapeTsString(shownDisplay)} } : {})`,
      );
    }
    if (supportsScopedLogic) {
      if (!node.visible && !slot && !hasVariantTarget) {
        styleParts.push(
          `...(${dynOvExpr}?.visible === true ? { display: ${escapeTsString(shownDisplay)} } : { display: 'none' })`,
        );
      } else {
        styleParts.push(
          `...(${dynOvExpr}?.visible === false ? { display: 'none' } : ${dynOvExpr}?.visible === true ? { display: ${escapeTsString(shownDisplay)} } : {})`,
        );
      }
      styleParts.push(
        `...(${dynOvExpr}?.opacity !== undefined ? { opacity: ${dynOvExpr}?.opacity } : {})`,
      );
      styleParts.push(
        `...(${dynOvExpr}?.transform ? { transform: ${dynOvExpr}?.transform } : {})`,
      );
      if (node.type !== 'image') {
        styleParts.push(
          `...(${dynOvExpr}?.imageUrl ? { backgroundImage: \`url(\${JSON.stringify(${dynOvExpr}?.imageUrl)})\` } : {})`,
        );
      }
      styleParts.push(
        `...(${dynOvExpr}?.transitionMs ? { transition: \`all \${${dynOvExpr}?.transitionMs}ms ease\` } : {})`,
      );
      styleParts.push(
        `...(${dynOvExpr}?.disabled ? { pointerEvents: "none" as const, opacity: 0.5 } : {})`,
      );
    }
    if (styleParts.length > 0) {
      attrs.push(`style={{ ${styleParts.join(', ')} }}`);
    }

    if (node.type === 'component-instance') {
      const childComp = node.componentId !== component.id ? componentsById.get(node.componentId) : undefined;
      const childCompName = node.componentId !== component.id ? componentNamesById.get(node.componentId) : undefined;
      if (childComp && childCompName) {
        const childSupportsScoped = componentsWithScopedLogic.has(childComp.id);
        const { props: nestedProps, needsScale } = buildNestedInstancePropsList(
          node,
          childComp,
          cls,
          childSupportsScoped,
          supportsScopedLogic,
        );
        if (needsScale || slot || supportsScopedLogic) {
          const wrapperAttrs = [
            `className=${escapeTsString(cls)}`,
            supportsScopedLogic ? `data-folio-id={${scopedIdExpr}}` : `data-folio-id=${nodeIdLit}`,
            `data-folio-component=${escapeTsString(node.componentId)}`,
          ];
          if (supportsScopedLogic) {
            wrapperAttrs.push(`onClick={onLogicEvent ? () => onLogicEvent("click", ${scopedIdExpr}) : undefined}`);
            wrapperAttrs.push(`onMouseEnter={onLogicEvent ? () => onLogicEvent("hover-enter", ${scopedIdExpr}) : undefined}`);
            wrapperAttrs.push(`onMouseLeave={onLogicEvent ? () => onLogicEvent("hover-leave", ${scopedIdExpr}) : undefined}`);
          }
          if (styleParts.length > 0) {
            wrapperAttrs.push(`style={{ ${styleParts.join(', ')} }}`);
          }
          const innerProps = needsScale
            ? nestedProps
            : nestedProps.filter((prop) => !prop.startsWith('className='));
          lines.push(`${indent}<div ${wrapperAttrs.join(' ')}>`);
          lines.push(`${indent}  <${childCompName}${innerProps.length > 0 ? ` ${innerProps.join(' ')}` : ''} />`);
          lines.push(`${indent}</div>`);
        } else {
          lines.push(`${indent}<${childCompName} ${nestedProps.join(' ')} />`);
        }
      } else {
        lines.push(`${indent}<div ${attrs.join(' ')} />`);
      }
    } else if (node.type === 'image') {
      const asset = assetsById.get(node.assetId);
      const src = asset ? `/${getAssetBundlePath(asset)}` : '';
      const alt = node.alt ?? node.name;
      const srcAttr = supportsScopedLogic
        ? `src={${dynOvExpr}?.imageUrl || ${escapeTsString(src)}}`
        : `src=${escapeTsString(src)}`;
      lines.push(`${indent}<img ${attrs.join(' ')} ${srcAttr} alt=${escapeTsString(alt)} />`);
    } else if (node.type === 'text') {
      const variantTextVar = variantTextVarByNodeId.get(node.id);
      const fallbackText =
        slot?.defaultText !== undefined
          ? escapeTsString(slot.defaultText)
          : escapeTsString(node.text);
      const baseWithVariant = variantTextVar
        ? `${variantTextVar} ?? ${fallbackText}`
        : fallbackText;
      const directTextExpr = `overrides?.[${nodeIdLit}]?.text`;
      const baseContentExpr = slot
        ? `${directTextExpr} ?? (${slot.contentProp} !== undefined ? ${slot.contentProp} : (${baseWithVariant}))`
        : `${directTextExpr} ?? (${baseWithVariant})`;
      const contentExpr = supportsScopedLogic
        ? `${dynOvExpr}?.text ?? (${baseContentExpr})`
        : baseContentExpr;
      if (tag === 'input') {
        lines.push(`${indent}<input ${attrs.join(' ')} type="text" defaultValue={${contentExpr}} />`);
      } else if (tag === 'img') {
        lines.push(`${indent}<img ${attrs.join(' ')} src="" alt={${contentExpr}} />`);
      } else {
        lines.push(`${indent}<${tag} ${attrs.join(' ')}>{${contentExpr}}</${tag}>`);
      }
    } else if (node.type === 'path') {
      const wrapperTag = isVoidHtmlTag(tag) ? 'div' : tag;
      lines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
      lines.push(...buildInlineJsxSvgLines(node, tokens, `${indent}  `, effectiveFillExpr));
      lines.push(`${indent}</${wrapperTag}>`);
    } else {
      const children = childrenByParent.get(node.id) ?? [];
      if (slot && children.length === 0) {
        if (tag === 'input') {
          lines.push(
            `${indent}<input ${attrs.join(' ')} type="text" defaultValue={typeof ${slot.contentProp} === "string" || typeof ${slot.contentProp} === "number" ? String(${slot.contentProp}) : ""} />`,
          );
        } else if (tag === 'img') {
          lines.push(
            `${indent}<img ${attrs.join(' ')} src="" alt={typeof ${slot.contentProp} === "string" ? ${slot.contentProp} : ${escapeTsString(node.ariaLabel ?? node.name)}} />`,
          );
        } else {
          lines.push(`${indent}<${tag} ${attrs.join(' ')}>{${slot.contentProp}}</${tag}>`);
        }
      } else if (children.length === 0) {
        if (tag === 'input') {
          lines.push(`${indent}<input ${attrs.join(' ')} type="text" />`);
        } else if (tag === 'img') {
          lines.push(`${indent}<img ${attrs.join(' ')} src="" alt=${escapeTsString(node.ariaLabel ?? node.name)} />`);
        } else {
          lines.push(`${indent}<${tag} ${attrs.join(' ')} />`);
        }
      } else {
        const wrapperTag = isVoidHtmlTag(tag) ? 'div' : tag;
        lines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
        for (const child of children) {
          emitMasterJsx(child, depth + 1);
        }
        lines.push(`${indent}</${wrapperTag}>`);
      }
    }

    mappings.push({
      nodeId: node.id,
      nodeName: node.name,
      componentId: component.id,
      category: 'generated',
      startLine,
      endLine: lines.length,
      selector: `.${cls}`,
    });
  };

  for (const root of roots) {
    emitMasterJsx(root, 3);
  }

  lines.push('    </div>');
  lines.push('  );');
  lines.push('}');
  lines.push('');

  const tsxFile: CompiledCodeFile = {
    id: `generated:react:component:${component.id}`,
    path: `src/components/${componentName}.tsx`,
    language: 'tsx',
    category: 'generated',
    readOnly: true,
    content: lines.join('\n'),
    componentId: component.id,
    description: `Typed React component generated from Master "${component.name}".`,
    mappings,
  };

  const cssFile = buildComponentStylesheet(component, componentName, rootClass, tokens, variantAxes);
  return [tsxFile, cssFile];
}

function buildPageReactFile(
  project: FolioProject,
  page: FolioPage,
  pageComponentName: string,
  componentNamesById: ReadonlyMap<string, string>,
  tokens: DesignTokenCollection,
  logicPlan: ReactPageLogicPlan,
  componentsWithScopedLogic: ReadonlySet<string>,
): CompiledCodeFile {
  const slug = toPageFileSlug(page.route, page.name);
  const componentsById = new Map(project.components.map((c) => [c.id, c]));
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));

  const usedComponents = new Set<string>();
  for (const node of page.document.nodes) {
    if (node.type === 'component-instance' && componentsById.has(node.componentId)) {
      usedComponents.add(node.componentId);
    }
  }

  const reactImport = logicPlan.hasLogic
    ? `import React, { useState${logicPlan.needsUseEffect ? ', useEffect' : ''} } from 'react';`
    : "import React from 'react';";

  const lines: string[] = [
    `// Mapped by FOLIO Code Engine — Page "${sanitizeCommentLabel(page.name)}" (${sanitizeCommentLabel(page.route)})`,
    reactImport,
  ];

  // Import Master Components before the page stylesheet so page layout rules (`.f-*`)
  // can position instances cleanly without colliding with component base positioning.
  for (const compId of usedComponents) {
    const compName = componentNamesById.get(compId);
    if (!compName) continue;
    lines.push(`import { ${compName} } from '../components/${compName}';`);
  }

  lines.push(`import '../styles/${slug}.css';`);

  const animatedNodeIds = new Set<string>();
  for (const clip of project.animations ?? []) {
    if (clip.pageId !== page.id) continue;
    for (const track of clip.tracks) {
      if (track.keyframes.length > 0) {
        animatedNodeIds.add(track.targetNodeId);
      }
    }
  }

  for (const mod of project.codeModules ?? []) {
    if (mod.language === 'css' && (!mod.targetPageId || mod.targetPageId === page.id)) {
      const safePath = sanitizeRelativeModulePath(mod.path);
      if (!safePath) continue;
      lines.push(`import '../../${safePath}';`);
    }
  }

  lines.push('');
  const pageSignature = logicPlan.hasNavigation
    ? `export function ${pageComponentName}({ onNavigate }: { onNavigate?: (route: string) => void } = {}) {`
    : `export function ${pageComponentName}() {`;
  lines.push(pageSignature);
  if (logicPlan.hasLogic) {
    lines.push(...logicPlan.hookLines);
  }
  lines.push('  return (');
  lines.push(`    <main className=${escapeTsString(`folio-page-${slug}`)} data-folio-page=${escapeTsString(page.id)}>`);
  const solvedPageNodes = applyAutoLayoutToNodes(page.document.nodes);
  const pageMaskDefs = buildVectorMaskDefsLines(solvedPageNodes, slug, true, '      ');
  if (pageMaskDefs.length > 0) {
    lines.push(...pageMaskDefs);
  }

  const { roots, childrenByParent } = buildChildrenMap(solvedPageNodes);
  const mappings: CodeMappingEntry[] = [];

  const emitJsx = (node: DesignNode, depth: number) => {
    const indent = '  '.repeat(depth);
    const cls = toCssClassName('f', node.name, node.id);
    const startLine = lines.length + 1;

    if (node.type === 'component-instance') {
      const comp = componentsById.get(node.componentId);
      const compName = componentNamesById.get(node.componentId);
      if (comp && compName) {
        const masterW = Math.max(1, comp.document.width);
        const masterH = Math.max(1, comp.document.height);
        const scaleX = node.width / masterW;
        const scaleY = node.height / masterH;
        const needsScale = Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001;

        const instanceProps: string[] = needsScale
          ? [`style={{ transform: ${escapeTsString(`scale(${roundCss(scaleX)}, ${roundCss(scaleY)})`)}, transformOrigin: "top left" }}`]
          : [`className=${escapeTsString(cls)}`];
        const supportsScopedForComp = componentsWithScopedLogic.has(comp.id);
        const usedPropNames = new Set<string>(
          supportsScopedForComp
            ? ['className', 'style', 'overrides', 'instanceId', 'logicOverrides', 'onLogicEvent']
            : ['className', 'style', 'overrides'],
        );
        const allocProp = (raw: string, fallback: string): string => {
          const base = toCamelCase(raw, fallback);
          let candidate = base;
          let idx = 2;
          while (usedPropNames.has(candidate)) {
            candidate = `${base}${idx}`;
            idx += 1;
          }
          usedPropNames.add(candidate);
          return candidate;
        };

        for (const axis of comp.variants ?? []) {
          const propName = allocProp(axis.name, 'variant');
          const chosenId = node.variantSelection?.[axis.id] ?? axis.defaultOptionId;
          const opt = axis.options.find((o) => o.id === chosenId) ?? axis.options[0];
          if (opt) {
            if (logicPlan.hasDynamicVariant(node.id, axis.id)) {
              const unionType = axis.options.map((o) => escapeTsString(o.label)).join(' | ') || 'string';
              instanceProps.push(
                `${propName}={(logicOverrides[${escapeTsString(node.id)}]?.variants?.[${escapeTsString(axis.id)}] ?? ${escapeTsString(opt.label)}) as ${unionType}}`,
              );
            } else {
              instanceProps.push(`${propName}=${escapeTsString(opt.label)}`);
            }
          }
        }
        for (const slot of comp.slots ?? []) {
          const contentProp = allocProp(slot.name, 'slot');
          const visibleProp = allocProp(`${slot.name}Visible`, 'slotVisible');
          const fillProp = allocProp(`${slot.name}Fill`, 'slotFill');
          const assignment = node.slotAssignments?.[slot.id];
          if (assignment?.text !== undefined) {
            instanceProps.push(`${contentProp}=${escapeTsString(assignment.text)}`);
          }
          if (assignment?.visible !== undefined) {
            instanceProps.push(`${visibleProp}={${assignment.visible ? 'true' : 'false'}}`);
          }
          if (assignment?.fill !== undefined) {
            instanceProps.push(`${fillProp}=${escapeTsString(sanitizeCssValue(assignment.fill, 'transparent'))}`);
          }
        }
        const cleanedOverrides: Record<string, { fill?: string; text?: string }> = {};
        for (const [childId, ov] of Object.entries(node.overrides)) {
          const entry: { fill?: string; text?: string } = {};
          if (ov.fill !== undefined) entry.fill = sanitizeCssValue(ov.fill, 'transparent');
          if (ov.text !== undefined) entry.text = ov.text;
          if (entry.fill !== undefined || entry.text !== undefined) {
            cleanedOverrides[childId] = entry;
          }
        }
        if (Object.keys(cleanedOverrides).length > 0) {
          instanceProps.push(`overrides={${JSON.stringify(cleanedOverrides)}}`);
        }
        if (supportsScopedForComp && logicPlan.hasLogic) {
          instanceProps.push(`instanceId=${escapeTsString(node.id)}`);
          instanceProps.push('logicOverrides={logicOverrides}');
          instanceProps.push('onLogicEvent={runLogicTrigger}');
        }

        const instanceEventAttrs = logicPlan.getNodeEventAttrs(node.id);
        const instanceDynamicVisible = logicPlan.hasDynamicVisible(node.id);
        const instanceDynamicOpacity = logicPlan.hasDynamicOpacity(node.id);
        const instanceDynamicTransform = logicPlan.hasDynamicTransform(node.id);
        const instanceDynamicDisabled = logicPlan.hasDynamicDisabled(node.id);
        const instanceDynamicTransition = logicPlan.hasDynamicTransition(node.id);
        const needsInteractiveWrapper =
          needsScale
          || animatedNodeIds.has(node.id)
          || instanceEventAttrs.length > 0
          || instanceDynamicVisible
          || instanceDynamicOpacity
          || instanceDynamicTransform
          || instanceDynamicDisabled
          || instanceDynamicTransition;

        if (needsInteractiveWrapper) {
          const wrapperAttrs: string[] = [
            `className=${escapeTsString(cls)}`,
            `data-folio-id=${escapeTsString(node.id)}`,
            `data-folio-component=${escapeTsString(node.componentId)}`,
            ...instanceEventAttrs,
          ];
          const wrapperStyles: string[] = [];
          if (instanceDynamicVisible) {
            wrapperStyles.push(
              `...(logicOverrides[${escapeTsString(node.id)}]?.visible === false ? { display: "none" } : logicOverrides[${escapeTsString(node.id)}]?.visible === true ? { display: "block" } : {})`,
            );
          }
          if (instanceDynamicOpacity) {
            wrapperStyles.push(
              `...(logicOverrides[${escapeTsString(node.id)}]?.opacity !== undefined ? { opacity: logicOverrides[${escapeTsString(node.id)}]?.opacity } : {})`,
            );
          }
          if (instanceDynamicTransform) {
            wrapperStyles.push(
              `...(logicOverrides[${escapeTsString(node.id)}]?.transform ? { transform: logicOverrides[${escapeTsString(node.id)}]?.transform } : {})`,
            );
          }
          if (instanceDynamicTransition) {
            wrapperStyles.push(
              `...(logicOverrides[${escapeTsString(node.id)}]?.transitionMs ? { transition: \`all \${logicOverrides[${escapeTsString(node.id)}]?.transitionMs}ms ease\` } : {})`,
            );
          }
          if (instanceDynamicDisabled) {
            wrapperAttrs.push(`aria-disabled={logicOverrides[${escapeTsString(node.id)}]?.disabled ? "true" : undefined}`);
            wrapperStyles.push(
              `...(logicOverrides[${escapeTsString(node.id)}]?.disabled ? { pointerEvents: "none" as const, opacity: 0.5 } : {})`,
            );
          }
          if (wrapperStyles.length > 0) {
            wrapperAttrs.push(`style={{ ${wrapperStyles.join(', ')} }}`);
          }
          const innerProps = needsScale
            ? instanceProps
            : instanceProps.filter((prop) => !prop.startsWith('className='));
          lines.push(`${indent}<div ${wrapperAttrs.join(' ')}>`);
          lines.push(`${indent}  <${compName}${innerProps.length > 0 ? ` ${innerProps.join(' ')}` : ''} />`);
          lines.push(`${indent}</div>`);
        } else {
          lines.push(`${indent}<${compName} ${instanceProps.join(' ')} />`);
        }
        mappings.push({
          nodeId: node.id,
          nodeName: node.name,
          pageId: page.id,
          category: 'mapped',
          startLine,
          endLine: lines.length,
          selector: `.${cls}`,
        });
        return;
      }
    }

    const tag = resolveSemanticTag(node);
    const extraClass =
      node.className?.trim() && isSafeHtmlClassName(node.className.trim())
        ? ` ${node.className.trim()}`
        : '';
    const attrs: string[] = [];
    if (node.htmlId?.trim() && isSafeHtmlId(node.htmlId.trim())) {
      attrs.push(`id=${escapeTsString(node.htmlId.trim())}`);
    }
    attrs.push(
      `className=${escapeTsString(`${cls}${extraClass}`)}`,
      `data-folio-id=${escapeTsString(node.id)}`,
    );
    if (node.ariaLabel?.trim()) {
      attrs.push(`aria-label=${escapeTsString(node.ariaLabel.trim())}`);
    }
    if (tag === 'a') {
      attrs.push(`href=${escapeTsString(sanitizeHref(node.href) ?? '#')}`);
      if (node.linkTarget === '_blank') {
        attrs.push('target="_blank"');
        attrs.push('rel="noopener noreferrer"');
      }
    }
    if (tag === 'button') {
      attrs.push('type="button"');
    }
    attrs.push(...logicPlan.getNodeEventAttrs(node.id));
    if (logicPlan.hasDynamicDisabled(node.id)) {
      if (tag === 'button' || tag === 'input') {
        attrs.push(`disabled={Boolean(logicOverrides[${escapeTsString(node.id)}]?.disabled)}`);
      }
      attrs.push(`aria-disabled={logicOverrides[${escapeTsString(node.id)}]?.disabled ? "true" : undefined}`);
    }

    const logicStyleParts: string[] = [];
    if (logicPlan.hasDynamicVisible(node.id)) {
      const shownDisplay = node.layout?.mode === 'flex' ? 'flex' : node.layout?.mode === 'grid' ? 'grid' : 'block';
      logicStyleParts.push(
        `...(logicOverrides[${escapeTsString(node.id)}]?.visible === false ? { display: "none" } : logicOverrides[${escapeTsString(node.id)}]?.visible === true ? { display: ${escapeTsString(shownDisplay)} } : {})`,
      );
    }
    const hasBoundFill = Boolean(resolveTokenCssVar(tokens, node.tokenBindings?.fill));
    if (logicPlan.hasDynamicFill(node.id) && !hasBoundFill) {
      if (node.type === 'text') {
        logicStyleParts.push(`...(logicOverrides[${escapeTsString(node.id)}]?.fill ? { color: logicOverrides[${escapeTsString(node.id)}]?.fill } : {})`);
      } else if (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse') {
        logicStyleParts.push(`...(logicOverrides[${escapeTsString(node.id)}]?.fill ? { background: logicOverrides[${escapeTsString(node.id)}]?.fill } : {})`);
      }
    }
    if (logicPlan.hasDynamicOpacity(node.id)) {
      logicStyleParts.push(
        `...(logicOverrides[${escapeTsString(node.id)}]?.opacity !== undefined ? { opacity: logicOverrides[${escapeTsString(node.id)}]?.opacity } : {})`,
      );
    }
    if (logicPlan.hasDynamicTransform(node.id)) {
      logicStyleParts.push(
        `...(logicOverrides[${escapeTsString(node.id)}]?.transform ? { transform: logicOverrides[${escapeTsString(node.id)}]?.transform } : {})`,
      );
    }
    if (logicPlan.hasDynamicImage(node.id) && node.type !== 'image') {
      logicStyleParts.push(
        `...(logicOverrides[${escapeTsString(node.id)}]?.imageUrl ? { backgroundImage: \`url(\${JSON.stringify(logicOverrides[${escapeTsString(node.id)}]?.imageUrl)})\` } : {})`,
      );
    }
    if (logicPlan.hasDynamicTransition(node.id)) {
      logicStyleParts.push(
        `...(logicOverrides[${escapeTsString(node.id)}]?.transitionMs ? { transition: \`all \${logicOverrides[${escapeTsString(node.id)}]?.transitionMs}ms ease\` } : {})`,
      );
    }
    if (logicPlan.hasDynamicDisabled(node.id)) {
      logicStyleParts.push(
        `...(logicOverrides[${escapeTsString(node.id)}]?.disabled ? { pointerEvents: "none" as const, opacity: 0.5 } : {})`,
      );
    }
    if (logicStyleParts.length > 0) {
      attrs.push(`style={{ ${logicStyleParts.join(', ')} }}`);
    }

    if (node.type === 'text') {
      if (tag === 'input') {
        const valueProp = logicPlan.hasDynamicText(node.id)
          ? `defaultValue={logicOverrides[${escapeTsString(node.id)}]?.text ?? ${escapeTsString(node.text)}}`
          : `defaultValue=${escapeTsString(node.text)}`;
        lines.push(`${indent}<input ${attrs.join(' ')} type="text" ${valueProp} />`);
      } else if (tag === 'img') {
        const altProp = logicPlan.hasDynamicText(node.id)
          ? `alt={logicOverrides[${escapeTsString(node.id)}]?.text ?? ${escapeTsString(node.text || node.ariaLabel || node.name)}}`
          : `alt=${escapeTsString(node.text || node.ariaLabel || node.name)}`;
        lines.push(`${indent}<img ${attrs.join(' ')} src="" ${altProp} />`);
      } else {
        const textBody = logicPlan.hasDynamicText(node.id)
          ? `{logicOverrides[${escapeTsString(node.id)}]?.text ?? ${escapeTsString(node.text)}}`
          : escapeJsxText(node.text);
        lines.push(`${indent}<${tag} ${attrs.join(' ')}>${textBody}</${tag}>`);
      }
    } else if (node.type === 'image') {
      const asset = assetsById.get(node.assetId);
      const src = asset ? `/${getAssetBundlePath(asset)}` : '';
      const alt = node.alt ?? node.name;
      const srcAttr = logicPlan.hasDynamicImage(node.id)
        ? `src={logicOverrides[${escapeTsString(node.id)}]?.imageUrl || ${escapeTsString(src)}}`
        : `src=${escapeTsString(src)}`;
      lines.push(`${indent}<img ${attrs.join(' ')} ${srcAttr} alt=${escapeTsString(alt)} />`);
    } else if (node.type === 'path') {
      const wrapperTag = isVoidHtmlTag(tag) ? 'div' : tag;
      const dynamicPathFill = logicPlan.hasDynamicFill(node.id)
        ? `logicOverrides[${escapeTsString(node.id)}]?.fill`
        : undefined;
      lines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
      lines.push(...buildInlineJsxSvgLines(node, tokens, `${indent}  `, dynamicPathFill));
      lines.push(`${indent}</${wrapperTag}>`);
    } else {
      const children = childrenByParent.get(node.id) ?? [];
      if (children.length === 0) {
        if (tag === 'input') {
          lines.push(`${indent}<input ${attrs.join(' ')} type="text" />`);
        } else if (tag === 'img') {
          lines.push(`${indent}<img ${attrs.join(' ')} src="" alt=${escapeTsString(node.ariaLabel ?? node.name)} />`);
        } else {
          lines.push(`${indent}<${tag} ${attrs.join(' ')} />`);
        }
      } else {
        const wrapperTag = isVoidHtmlTag(tag) ? 'div' : tag;
        lines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
        for (const child of children) {
          emitJsx(child, depth + 1);
        }
        lines.push(`${indent}</${wrapperTag}>`);
      }
    }

    mappings.push({
      nodeId: node.id,
      nodeName: node.name,
      pageId: page.id,
      category: 'mapped',
      startLine,
      endLine: lines.length,
      selector: `.${cls}`,
    });
  };

  for (const root of roots) {
    emitJsx(root, 3);
  }

  if (logicPlan.hasToastAction) {
    lines.push('      {logicToasts.length > 0 && (');
    lines.push('        <div role="status" aria-live="polite" style={{ position: "fixed", right: 16, bottom: 16, zIndex: 9999, display: "flex", flexDirection: "column", gap: 8 }}>');
    lines.push('          {logicToasts.map((toast) => (');
    lines.push('            <div key={toast.id} data-folio-toast={toast.tone} style={{ padding: "10px 14px", borderRadius: 8, background: toast.tone === "success" ? "#059669" : toast.tone === "warning" ? "#D97706" : toast.tone === "error" ? "#DC2626" : "#1E293B", color: "#FFFFFF", fontSize: 13 }}>');
    lines.push('              {toast.message}');
    lines.push('            </div>');
    lines.push('          ))}');
    lines.push('        </div>');
    lines.push('      )}');
  }

  lines.push('    </main>');
  lines.push('  );');
  lines.push('}');
  lines.push('');

  return {
    id: `mapped:react:page:${page.id}`,
    path: `src/pages/${pageComponentName}.tsx`,
    language: 'tsx',
    category: 'mapped',
    readOnly: false,
    content: lines.join('\n'),
    pageId: page.id,
    description: `React + TypeScript page mapped to Folio AST "${page.name}".`,
    mappings,
  };
}

function buildAppEntryFile(
  project: FolioProject,
  activePage: FolioPage,
  pageNamesById: ReadonlyMap<string, string>,
  pagesWithNavigation: ReadonlySet<string>,
): CompiledCodeFile {
  const hasAnyNavigation = pagesWithNavigation.size > 0;
  const lines: string[] = [
    '// Generated by FOLIO Code Engine — Application Entry',
    hasAnyNavigation ? "import React, { useState } from 'react';" : "import React from 'react';",
    "import './styles/tokens.css';",
  ];

  for (const page of project.pages) {
    const pageComp = pageNamesById.get(page.id) ?? `${toPascalCase(page.name, 'Page')}Page`;
    lines.push(`import { ${pageComp} } from './pages/${pageComp}';`);
  }

  lines.push('');
  lines.push('export function App({ route = ' + escapeTsString(activePage.route) + ' }: { route?: string }) {');
  if (hasAnyNavigation) {
    lines.push('  const [currentRoute, setCurrentRoute] = useState(route);');
    lines.push('  switch (currentRoute) {');
  } else {
    lines.push('  switch (route) {');
  }
  for (const page of project.pages) {
    const pageComp = pageNamesById.get(page.id) ?? `${toPascalCase(page.name, 'Page')}Page`;
    const navAttr = pagesWithNavigation.has(page.id) ? ' onNavigate={setCurrentRoute}' : '';
    lines.push(`    case ${escapeTsString(page.route)}:`);
    lines.push(`      return <${pageComp}${navAttr} />;`);
  }
  const activeComp = pageNamesById.get(activePage.id) ?? `${toPascalCase(activePage.name, 'Page')}Page`;
  const activeNavAttr = pagesWithNavigation.has(activePage.id) ? ' onNavigate={setCurrentRoute}' : '';
  lines.push('    default:');
  lines.push(`      return <${activeComp}${activeNavAttr} />;`);
  lines.push('  }');
  lines.push('}');
  lines.push('');

  return {
    id: 'generated:react:app',
    path: 'src/App.tsx',
    language: 'tsx',
    category: 'generated',
    readOnly: true,
    content: lines.join('\n'),
    description: 'Generated React application entry mapping Folio page routes.',
    mappings: [],
  };
}

export function compileReactProjectFiles(
  inputProject: FolioProject,
  activePageId?: string,
): CompiledCodeFile[] {
  const project = sanitizeProjectNetworkSecrets(inputProject);
  const activePage =
    (activePageId ? project.pages.find((p) => p.id === activePageId) : undefined) ??
    getActivePage(project);
  const tokens = getProjectDesignTokens(project);

  const pageNamesById = createUniqueIdentifierMap(
    project.pages,
    (page) => `${toPascalCase(page.name, 'Page')}Page`,
  );
  const componentNamesById = createUniqueIdentifierMap(
    project.components,
    (component) => toPascalCase(component.name, 'FolioComponent'),
  );

  const pageLogicPlans = new Map<string, ReactPageLogicPlan>();
  const pagesWithNavigation = new Set<string>();
  const componentsWithScopedLogic = new Set<string>();

  for (const comp of project.components) {
    if (
      comp.nodeLogicEnabled
      && project.logicGraphs.some(
        (graph) =>
          graph.scope === 'component'
          && graph.targetId === comp.id
          && graph.nodes.some((n) => isBuiltInLogicNodeType(n.type)),
      )
    ) {
      componentsWithScopedLogic.add(comp.id);
    }
  }

  for (const page of project.pages) {
    const plan = buildReactPageLogicPlan(project, page);
    pageLogicPlans.set(page.id, plan);
    if (plan.hasNavigation) {
      pagesWithNavigation.add(page.id);
    }
    for (const node of page.document.nodes) {
      if (node.type === 'component-instance' && plan.hasScopedChildLogic(node.id)) {
        componentsWithScopedLogic.add(node.componentId);
      }
    }
  }

  // Propagate scoped logic support upward through nested component masters
  for (let pass = 0; pass < project.components.length; pass += 1) {
    let added = false;
    for (const comp of project.components) {
      if (componentsWithScopedLogic.has(comp.id)) continue;
      if (
        comp.document.nodes.some(
          (node) => node.type === 'component-instance' && componentsWithScopedLogic.has(node.componentId),
        )
      ) {
        componentsWithScopedLogic.add(comp.id);
        added = true;
      }
    }
    if (!added) break;
  }

  const pageFiles: CompiledCodeFile[] = [];
  for (const page of project.pages) {
    const pageCompName = pageNamesById.get(page.id) ?? `${toPascalCase(page.name, 'Page')}Page`;
    const plan = pageLogicPlans.get(page.id) ?? buildReactPageLogicPlan(project, page);
    pageFiles.push(
      buildPageReactFile(project, page, pageCompName, componentNamesById, tokens, plan, componentsWithScopedLogic),
    );
  }

  const files: CompiledCodeFile[] = [
    buildAppEntryFile(project, activePage, pageNamesById, pagesWithNavigation),
    ...pageFiles,
  ];
  const componentsById = new Map(project.components.map((c) => [c.id, c]));
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  for (const component of project.components) {
    const compName = componentNamesById.get(component.id) ?? toPascalCase(component.name, 'FolioComponent');
    files.push(
      ...buildComponentFiles(
        component,
        compName,
        tokens,
        componentsById,
        componentNamesById,
        assetsById,
        componentsWithScopedLogic.has(component.id),
        componentsWithScopedLogic,
      ),
    );
  }
  return files;
}
