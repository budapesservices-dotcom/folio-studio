import { getPageApplicationId, getProjectApplications } from '../../core/document/applications';
import { sanitizeProjectNetworkSecrets } from '../../core/document/networkSecrets';
import {
  applyMorphGeometryToDesignNode,
  extractMorphSnapshotFromNode,
  parsePathMorphSnapshot,
} from '../../core/document/pathMorph';
import {
  computeContourTrimIntervals,
  getNodeContourLengths,
  getPathNodeContours,
  hasActiveTrimPath,
  intervalsToSvgStrokeDash,
} from '../../core/document/pathStudio';
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
  collectPageInitialMorphSnapshots,
  collectPageMorphNodeIds,
  collectPageTrimNodeIds,
  compilePageMorphClips,
} from '../animation/codegen';
import {
  buildArrowheadPoints,
  buildChildrenMap,
  buildNodeCssDeclarations,
  buildNodePseudoStateCssRules,
  buildShapeContainerClipId,
  buildVectorMaskDefsLines,
  collectDynamicTransformTargets,
  getNodeBorderInset,
  isVoidHtmlTag,
  resolveSemanticTag,
  resolveTokenCssVar,
  roundCss,
  type DynamicTransformTargets,
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
import {
  buildReactPageLogicPlan,
  emitCssTransformToSvgHelperLines,
  type ReactPageLogicPlan,
} from '../prototype/codegen';
import { getApplicableGraphsForPage } from '../prototype/runtime';

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
  options?: {
    readonly isMorphTarget?: boolean;
    readonly isTrimTarget?: boolean;
    readonly asBackdrop?: boolean;
    readonly forceEvenOdd?: boolean;
    readonly containerClipId?: string;
  },
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
  const hasStaticTrim = hasActiveTrimPath(node.style);
  const useTrimContours = Boolean(options?.isTrimTarget) || hasStaticTrim;

  const svgStyle = options?.asBackdrop
    ? '{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%", pointerEvents: "none" }'
    : '{ display: "block", width: "100%", height: "100%" }';

  const svgLines: string[] = [
    `${indent}<svg width={${w}} height={${h}} viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" fill="none" overflow="visible" style={${svgStyle}} aria-hidden="true">`,
  ];

  if (options?.containerClipId) {
    const clipRuleProp =
      node.style.fillRule === 'evenodd' || (node.subpaths && node.subpaths.length > 0)
        ? ' clipRule="evenodd"'
        : '';
    svgLines.push(
      `${indent}  <defs><clipPath id=${escapeTsString(options.containerClipId)} clipPathUnits="userSpaceOnUse"><path d=${escapeTsString(d)}${clipRuleProp} /></clipPath></defs>`,
    );
  }

  if (useTrimContours) {
    const fillAttr = effectiveDynamicFill
      ? `fill={${effectiveDynamicFill} ?? ${escapeTsString(baseFill)}}`
      : `fill=${escapeTsString(baseFill)}`;
    if (baseFill !== 'none' || effectiveDynamicFill) {
      const fillAttrs = [
        `d=${escapeTsString(d)}`,
        fillAttr,
        'stroke="none"',
        ...(options?.forceEvenOdd || node.style.fillRule === 'evenodd' || (node.subpaths && node.subpaths.length > 0)
          ? ['fillRule="evenodd"']
          : []),
        ...(options?.isMorphTarget ? ['data-folio-morph-path="true"'] : []),
      ];
      svgLines.push(`${indent}  <path ${fillAttrs.join(' ')} />`);
    }
    if (strokeWidth > 0 && baseStroke !== 'none') {
      const contours = getPathNodeContours(node);
      const lengths = getNodeContourLengths(node);
      const perContour = hasStaticTrim
        ? computeContourTrimIntervals(
            lengths,
            node.style.trimStart ?? 0,
            node.style.trimEnd ?? 100,
            node.style.trimOffset ?? 0,
            node.style.trimMode ?? 'simultaneous',
          )
        : null;
      contours.forEach((contour, cIdx) => {
        const contourD = serializePathPointsToSvgD(contour.points, contour.closed);
        const sAttrs: string[] = [
          ...(options?.isMorphTarget ? ['data-folio-morph-path="true"'] : []),
          `data-folio-trim-contour="${cIdx}"`,
          `d=${escapeTsString(contourD)}`,
          'fill="none"',
          `stroke=${escapeTsString(baseStroke)}`,
          `strokeWidth={${strokeWidth}}`,
          `strokeLinecap=${escapeTsString(node.style.strokeLinecap ?? 'round')}`,
          `strokeLinejoin=${escapeTsString(node.style.strokeLinejoin ?? 'round')}`,
        ];
        if (perContour) {
          const res = intervalsToSvgStrokeDash(lengths[cIdx] ?? 0, perContour[cIdx] ?? []);
          if (!res.visible) sAttrs.push('strokeOpacity={0}');
          if (!res.full && res.dasharray) {
            sAttrs.push(`strokeDasharray=${escapeTsString(res.dasharray)}`);
            if (res.dashoffset !== undefined) sAttrs.push(`strokeDashoffset={${roundCss(res.dashoffset)}}`);
          }
        } else if (node.style.strokeDasharray) {
          sAttrs.push(`strokeDasharray=${escapeTsString(node.style.strokeDasharray)}`);
        }
        svgLines.push(`${indent}  <path ${sAttrs.join(' ')} />`);
      });
    }
  } else {
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
    if (options?.forceEvenOdd || node.style.fillRule === 'evenodd' || (node.subpaths && node.subpaths.length > 0)) {
      pathAttrs.push('fillRule="evenodd"');
    }
    if (node.style.strokeDasharray) {
      pathAttrs.push(`strokeDasharray=${escapeTsString(node.style.strokeDasharray)}`);
    }
    if (options?.isMorphTarget) {
      pathAttrs.push('data-folio-morph-path="true"');
    }
    svgLines.push(`${indent}  <path ${pathAttrs.join(' ')} />`);
  }

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

function buildShapeTrimOverlayJsxLines(
  node: Extract<DesignNode, { type: 'rect' | 'frame' | 'ellipse' }>,
  tokens: DesignTokenCollection,
  indent: string,
): string[] {
  const sw = Math.max(0, roundCss(node.style.strokeWidth));
  const strokeVar = resolveTokenCssVar(tokens, node.tokenBindings?.stroke);
  const stroke = strokeVar ?? sanitizeCssValue(node.style.stroke || 'none', 'none');
  if (sw <= 0 || !stroke || stroke === 'none') return [];
  const w = Math.max(1, roundCss(node.width));
  const h = Math.max(1, roundCss(node.height));
  const extraAttrs: string[] = [];
  if (hasActiveTrimPath(node.style)) {
    const len = getNodeContourLengths(node)[0] ?? 0;
    const intervals = computeContourTrimIntervals(
      [len],
      node.style.trimStart ?? 0,
      node.style.trimEnd ?? 100,
      node.style.trimOffset ?? 0,
      node.style.trimMode ?? 'simultaneous',
    )[0] ?? [];
    const res = intervalsToSvgStrokeDash(len, intervals);
    if (!res.visible) extraAttrs.push('strokeOpacity={0}');
    if (!res.full && res.dasharray) {
      extraAttrs.push(`strokeDasharray=${escapeTsString(res.dasharray)}`);
      if (res.dashoffset !== undefined) extraAttrs.push(`strokeDashoffset={${roundCss(res.dashoffset)}}`);
    }
  }
  const extraStr = extraAttrs.length > 0 ? ` ${extraAttrs.join(' ')}` : '';
  const shapeEl =
    node.type === 'ellipse'
      ? `<ellipse data-folio-trim-contour="0" cx={${roundCss(w / 2)}} cy={${roundCss(h / 2)}} rx={${roundCss(w / 2)}} ry={${roundCss(h / 2)}} fill="none" stroke=${escapeTsString(stroke)} strokeWidth={${sw}} strokeLinecap="round"${extraStr} />`
      : `<rect data-folio-trim-contour="0" x={0} y={0} width={${w}} height={${h}}${(node.style.radius ?? 0) > 0 ? ` rx={${roundCss(node.style.radius ?? 0)}}` : ''} fill="none" stroke=${escapeTsString(stroke)} strokeWidth={${sw}} strokeLinecap="round"${extraStr} />`;
  return [
    `${indent}<svg width={${w}} height={${h}} viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" fill="none" overflow="visible" style={{ position: "absolute", inset: 0, display: "block", width: "100%", height: "100%", pointerEvents: "none" }} aria-hidden="true">`,
    `${indent}  ${shapeEl}`,
    `${indent}</svg>`,
  ];
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
  dynamicTransformTargets?: DynamicTransformTargets,
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
      allNodes: solvedMasterNodes,
      maskPrefix: toKebabCase(componentName, 'comp'),
      dynamicTransformTargets,
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
        } else if (patch.visible === true) {
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
  dynamicTransformTargets?: DynamicTransformTargets,
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

  let compUsesMaskTransformHelper = false;
  const compMaskDefs = buildVectorMaskDefsLines(
    component.document.nodes,
    toKebabCase(componentName, 'comp'),
    true,
    '      ',
    {
      dynamicTransformTargets,
      jsxMaskBaseIdExpr: supportsScopedLogic
        ? (localId) => `scopedId(${escapeTsString(localId)})`
        : undefined,
      jsxTransformExpr: supportsScopedLogic
        ? ({ localNodeId, cx, cy, width, height, staticTransform }) => {
            const isTargeted = Boolean(
              dynamicTransformTargets?.hasWildcard
              || dynamicTransformTargets?.ids.has(localNodeId),
            );
            if (!isTargeted) return undefined;
            compUsesMaskTransformHelper = true;
            const staticArg = staticTransform ? `, ${escapeTsString(staticTransform)}` : '';
            return `folioCssTransformToSvg(logicOverrides?.[scopedId(${escapeTsString(localNodeId)})]?.transform, ${cx}, ${cy}, ${width}, ${height}${staticArg})`;
          }
        : undefined,
    },
  );
  if (compUsesMaskTransformHelper) {
    lines.push(...emitCssTransformToSvgHelperLines('ts', ''));
    lines.push('');
  }

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
  if (compMaskDefs.length > 0) {
    lines.push(...compMaskDefs);
  }

  const { roots, childrenByParent } = buildChildrenMap(component.document.nodes);
  const compTrimNodeIds = new Set<string>();
  const compMorphNodeIds = new Set<string>();
  const compMultiContourMorphNodeIds = new Set<string>();
  const compInitialMorphSnapshots = new Map<string, string>();
  for (const clip of component.animations ?? []) {
    for (const track of clip.tracks) {
      if (track.keyframes.length === 0) continue;
      if (track.property === 'trimStart' || track.property === 'trimEnd' || track.property === 'trimOffset') {
        compTrimNodeIds.add(track.targetNodeId);
      } else if (track.property === 'pathMorph') {
        compMorphNodeIds.add(track.targetNodeId);
        const sortedKfs = [...track.keyframes].sort((a, b) => a.timeMs - b.timeMs);
        if (!compInitialMorphSnapshots.has(track.targetNodeId) && typeof sortedKfs[0]?.value === 'string') {
          compInitialMorphSnapshots.set(track.targetNodeId, sortedKfs[0].value);
        }
        if (sortedKfs.some((kf) => typeof kf.value === 'string' && parsePathMorphSnapshot(kf.value)?.subpaths?.length)) {
          compMultiContourMorphNodeIds.add(track.targetNodeId);
        }
      }
    }
  }
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
      const children = childrenByParent.get(node.id) ?? [];
      const isMorph = compMorphNodeIds.has(node.id);
      const isTrim = compTrimNodeIds.has(node.id) || hasActiveTrimPath(node.style);
      const containerClipId =
        node.isContainer === true && node.clipContent === true
          ? buildShapeContainerClipId(toKebabCase(componentName, 'comp'), node.id)
          : undefined;
      lines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
      lines.push(
        ...buildInlineJsxSvgLines(node, tokens, `${indent}  `, effectiveFillExpr, {
          isMorphTarget: isMorph,
          isTrimTarget: isTrim,
          asBackdrop: children.length > 0 || node.isContainer === true,
          forceEvenOdd: compMultiContourMorphNodeIds.has(node.id),
          containerClipId,
        }),
      );
      for (const child of children) {
        emitMasterJsx(child, depth + 1);
      }
      lines.push(`${indent}</${wrapperTag}>`);
    } else if (
      (node.type === 'ellipse' || node.type === 'rect' || node.type === 'frame') &&
      compMorphNodeIds.has(node.id)
    ) {
      const wrapperTag = isVoidHtmlTag(tag) ? 'div' : tag;
      const children =
        node.type === 'frame' || ((node.type === 'rect' || node.type === 'ellipse') && node.isContainer === true)
          ? (childrenByParent.get(node.id) ?? [])
          : [];
      const snap = compInitialMorphSnapshots.get(node.id) ?? extractMorphSnapshotFromNode(node);
      const projected = snap ? applyMorphGeometryToDesignNode(node, snap) : null;
      const isTrim = compTrimNodeIds.has(node.id) || hasActiveTrimPath(node.style);
      lines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
      if (projected && projected.type === 'path') {
        lines.push(
          ...buildInlineJsxSvgLines(projected, tokens, `${indent}  `, effectiveFillExpr, {
            isMorphTarget: true,
            isTrimTarget: isTrim,
            asBackdrop: children.length > 0,
            forceEvenOdd: compMultiContourMorphNodeIds.has(node.id),
          }),
        );
      }
      for (const child of children) {
        emitMasterJsx(child, depth + 1);
      }
      lines.push(`${indent}</${wrapperTag}>`);
    } else {
      const children = childrenByParent.get(node.id) ?? [];
      const trimOverlayLines =
        (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse') &&
        (compTrimNodeIds.has(node.id) || hasActiveTrimPath(node.style))
          ? buildShapeTrimOverlayJsxLines(node, tokens, `${indent}  `)
          : [];
      if (slot && children.length === 0 && trimOverlayLines.length === 0) {
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
      } else if (children.length === 0 && trimOverlayLines.length === 0) {
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
        if (trimOverlayLines.length > 0) {
          lines.push(...trimOverlayLines);
        }
        if (slot && children.length === 0) {
          lines.push(`${indent}  {${slot.contentProp}}`);
        }
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

  const cssFile = buildComponentStylesheet(
    component,
    componentName,
    rootClass,
    tokens,
    variantAxes,
    dynamicTransformTargets,
  );
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

  const morphClips = compilePageMorphClips(project, page);
  const morphNodeIds = collectPageMorphNodeIds(project, page);
  const trimNodeIds = collectPageTrimNodeIds(project, page);
  const initialMorphSnapshots = collectPageInitialMorphSnapshots(project, page);
  const multiContourMorphNodeIds = new Set<string>();
  for (const clip of morphClips) {
    for (const tr of clip.tracks) {
      if (tr.segments.some((seg) => seg.subpaths && seg.subpaths.length > 0)) {
        multiContourMorphNodeIds.add(tr.nodeId);
      }
    }
  }
  const hasShapeMorphTracks = morphClips.length > 0;

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

  if (hasShapeMorphTracks) {
    lines.push("import { useFolioShapeMorph, type FolioMorphClip } from '../motion/useFolioShapeMorph';");
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
    for (const mp of clip.motionPaths ?? []) {
      if (mp.points.length >= 2) {
        animatedNodeIds.add(mp.targetNodeId);
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

  if (hasShapeMorphTracks) {
    lines.push('');
    lines.push('// FOLIO Native Shape Morph (`pathMorph`) compiled clip data (single & multi-contour)');
    lines.push(`const FOLIO_MORPH_CLIPS: readonly FolioMorphClip[] = ${JSON.stringify(morphClips)};`);
  }

  const solvedPageNodes = applyAutoLayoutToNodes(page.document.nodes, undefined, tokens);
  const pageDynamicTransformTargets = collectDynamicTransformTargets(
    getApplicableGraphsForPage(project, page.id),
  );
  let pageUsesMaskTransformHelper = false;
  const pageMaskDefs = buildVectorMaskDefsLines(solvedPageNodes, slug, true, '      ', {
    dynamicTransformTargets: pageDynamicTransformTargets,
    jsxTransformExpr: logicPlan.hasLogic
      ? ({ localNodeId, cx, cy, width, height, staticTransform }) => {
          const isTargeted = Boolean(
            logicPlan.hasDynamicTransform(localNodeId)
            || pageDynamicTransformTargets.hasWildcard
            || pageDynamicTransformTargets.ids.has(localNodeId),
          );
          if (!isTargeted) return undefined;
          pageUsesMaskTransformHelper = true;
          const staticArg = staticTransform ? `, ${escapeTsString(staticTransform)}` : '';
          return `folioCssTransformToSvg(logicOverrides[${escapeTsString(localNodeId)}]?.transform, ${cx}, ${cy}, ${width}, ${height}${staticArg})`;
        }
      : undefined,
  });

  if (pageUsesMaskTransformHelper) {
    lines.push('');
    lines.push(...emitCssTransformToSvgHelperLines('ts', ''));
  }

  lines.push('');
  const pageSignature = logicPlan.hasNavigation
    ? `export function ${pageComponentName}({ onNavigate }: { onNavigate?: (route: string) => void } = {}) {`
    : `export function ${pageComponentName}() {`;
  lines.push(pageSignature);
  if (hasShapeMorphTracks) {
    lines.push('  useFolioShapeMorph(FOLIO_MORPH_CLIPS);');
  }
  if (logicPlan.hasLogic) {
    lines.push(...logicPlan.hookLines);
  }
  lines.push('  return (');
  lines.push(`    <main className=${escapeTsString(`folio-page-${slug}`)} data-folio-page=${escapeTsString(page.id)}>`);
  if (pageMaskDefs.length > 0) {
    lines.push(...pageMaskDefs);
  }
  const pushMultilineJsx = (value: string) => {
    if (!value.includes('\n')) {
      lines.push(value);
      return;
    }
    for (const part of value.split('\n')) {
      lines.push(part);
    }
  };

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
        if (supportsScopedForComp) {
          instanceProps.push(`instanceId=${escapeTsString(node.id)}`);
          if (logicPlan.hasLogic) {
            instanceProps.push('logicOverrides={logicOverrides}');
            instanceProps.push('onLogicEvent={runLogicTrigger}');
          }
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
        pushMultilineJsx(`${indent}<input ${attrs.join(' ')} type="text" ${valueProp} />`);
      } else if (tag === 'img') {
        const altProp = logicPlan.hasDynamicText(node.id)
          ? `alt={logicOverrides[${escapeTsString(node.id)}]?.text ?? ${escapeTsString(node.text || node.ariaLabel || node.name)}}`
          : `alt=${escapeTsString(node.text || node.ariaLabel || node.name)}`;
        pushMultilineJsx(`${indent}<img ${attrs.join(' ')} src="" ${altProp} />`);
      } else {
        const textBody = logicPlan.hasDynamicText(node.id)
          ? `{logicOverrides[${escapeTsString(node.id)}]?.text ?? ${escapeTsString(node.text)}}`
          : escapeJsxText(node.text);
        pushMultilineJsx(`${indent}<${tag} ${attrs.join(' ')}>${textBody}</${tag}>`);
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
      const children = childrenByParent.get(node.id) ?? [];
      const dynamicPathFill = logicPlan.hasDynamicFill(node.id)
        ? `logicOverrides[${escapeTsString(node.id)}]?.fill`
        : undefined;
      const isMorph = morphNodeIds.has(node.id);
      const isTrim = trimNodeIds.has(node.id);
      const initialSnap = isMorph ? initialMorphSnapshots.get(node.id) : undefined;
      const renderedNode = initialSnap ? applyMorphGeometryToDesignNode(node, initialSnap) : node;
      const containerClipId =
        node.isContainer === true && node.clipContent === true
          ? buildShapeContainerClipId(slug, node.id)
          : undefined;
      lines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
      lines.push(
        ...buildInlineJsxSvgLines(
          renderedNode.type === 'path' ? renderedNode : node,
          tokens,
          `${indent}  `,
          dynamicPathFill,
          {
            isMorphTarget: isMorph,
            isTrimTarget: isTrim,
            asBackdrop: children.length > 0 || node.isContainer === true,
            forceEvenOdd: multiContourMorphNodeIds.has(node.id),
            containerClipId,
          },
        ),
      );
      for (const child of children) {
        emitJsx(child, depth + 1);
      }
      lines.push(`${indent}</${wrapperTag}>`);
    } else if (
      (node.type === 'ellipse' || node.type === 'rect' || node.type === 'frame') &&
      morphNodeIds.has(node.id)
    ) {
      const wrapperTag = isVoidHtmlTag(tag) ? 'div' : tag;
      const children =
        node.type === 'frame' || ((node.type === 'rect' || node.type === 'ellipse') && node.isContainer === true)
          ? (childrenByParent.get(node.id) ?? [])
          : [];
      const dynamicPathFill = logicPlan.hasDynamicFill(node.id)
        ? `logicOverrides[${escapeTsString(node.id)}]?.fill`
        : undefined;
      const snap = initialMorphSnapshots.get(node.id) ?? extractMorphSnapshotFromNode(node);
      const projected = snap ? applyMorphGeometryToDesignNode(node, snap) : null;
      const isTrim = trimNodeIds.has(node.id);
      lines.push(`${indent}<${wrapperTag} ${attrs.join(' ')}>`);
      if (projected && projected.type === 'path') {
        lines.push(
          ...buildInlineJsxSvgLines(
            projected,
            tokens,
            `${indent}  `,
            dynamicPathFill,
            {
              isMorphTarget: true,
              isTrimTarget: isTrim,
              asBackdrop: children.length > 0,
              forceEvenOdd: multiContourMorphNodeIds.has(node.id),
            },
          ),
        );
      }
      for (const child of children) {
        emitJsx(child, depth + 1);
      }
      lines.push(`${indent}</${wrapperTag}>`);
    } else {
      const children = childrenByParent.get(node.id) ?? [];
      const trimOverlayLines =
        (node.type === 'rect' || node.type === 'frame' || node.type === 'ellipse') &&
        (trimNodeIds.has(node.id) || hasActiveTrimPath(node.style))
          ? buildShapeTrimOverlayJsxLines(node, tokens, `${indent}  `)
          : [];
      if (children.length === 0 && trimOverlayLines.length === 0) {
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
        if (trimOverlayLines.length > 0) {
          lines.push(...trimOverlayLines);
        }
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

function buildFolioShapeMorphHookFile(): CompiledCodeFile {
  const content = [
    '// Generated by FOLIO Code Engine — Native Shape Morph Runtime Hook (Single & Multi-Contour)',
    '// Zero-eval, CSP-safe cubic Bezier morph engine with Web Animations clock sync and prefers-reduced-motion.',
    "import { useEffect } from 'react';",
    '',
    'export type FolioMorphEasing =',
    "  | 'linear'",
    "  | 'spring'",
    "  | 'bounce-out'",
    "  | 'elastic-out'",
    "  | { readonly t: 'cb'; readonly b: readonly [number, number, number, number] }",
    "  | { readonly t: 'lut'; readonly y: readonly number[] };",
    '',
    'export interface FolioMorphContour {',
    '  readonly n: number;',
    '  readonly closed: boolean;',
    '  readonly from: readonly number[];',
    '  readonly to: readonly number[];',
    '}',
    '',
    'export interface FolioMorphSegment {',
    '  readonly t0: number;',
    '  readonly t1: number;',
    '  readonly easing: FolioMorphEasing;',
    '  readonly n: number;',
    '  readonly closed: boolean;',
    '  readonly from: readonly number[];',
    '  readonly to: readonly number[];',
    '  readonly subpaths?: readonly FolioMorphContour[];',
    '}',
    '',
    'export interface FolioMorphTrack {',
    '  readonly nodeId: string;',
    '  readonly kfName: string;',
    '  readonly segments: readonly FolioMorphSegment[];',
    '}',
    '',
    'export interface FolioMorphClip {',
    '  readonly id: string;',
    '  readonly className: string;',
    '  readonly kfPrefix: string;',
    '  readonly durationMs: number;',
    '  readonly loop: boolean;',
    '  readonly autoplay: boolean;',
    '  readonly tracks: readonly FolioMorphTrack[];',
    '}',
    '',
    'function solveBezier(b: readonly [number, number, number, number], x: number): number {',
    '  if (x <= 0) return 0;',
    '  if (x >= 1) return 1;',
    '  const x1 = Math.max(0, Math.min(1, b[0]));',
    '  const y1 = b[1];',
    '  const x2 = Math.max(0, Math.min(1, b[2]));',
    '  const y2 = b[3];',
    '  if (Math.abs(x1 - y1) < 1e-6 && Math.abs(x2 - y2) < 1e-6) return x;',
    '  const cx = 3 * x1;',
    '  const bx = 3 * (x2 - x1) - cx;',
    '  const ax = 1 - cx - bx;',
    '  const cy = 3 * y1;',
    '  const by = 3 * (y2 - y1) - cy;',
    '  const ay = 1 - cy - by;',
    '  let u = x;',
    '  for (let i = 0; i < 8; i += 1) {',
    '    const xe = ((ax * u + bx) * u + cx) * u - x;',
    '    if (Math.abs(xe) < 1e-6) return ((ay * u + by) * u + cy) * u;',
    '    const dx = (3 * ax * u + 2 * bx) * u + cx;',
    '    if (Math.abs(dx) < 1e-6) break;',
    '    u -= xe / dx;',
    '  }',
    '  let lo = 0;',
    '  let hi = 1;',
    '  u = x;',
    '  for (let k = 0; k < 18; k += 1) {',
    '    const xv = ((ax * u + bx) * u + cx) * u;',
    '    if (Math.abs(xv - x) < 1e-6) break;',
    '    if (x > xv) lo = u; else hi = u;',
    '    u = 0.5 * (lo + hi);',
    '  }',
    '  return ((ay * u + by) * u + cy) * u;',
    '}',
    '',
    'function evalEasing(e: FolioMorphEasing, x: number): number {',
    '  if (x <= 0) return 0;',
    '  if (x >= 1) return 1;',
    "  if (e === 'linear') return x;",
    "  if (e === 'spring') return 1 - Math.exp(-6 * x) * Math.cos(x * Math.PI * 2.5);",
    "  if (e === 'elastic-out') return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;",
    "  if (e === 'bounce-out') {",
    '    const n1 = 7.5625;',
    '    const d1 = 2.75;',
    '    let t = x;',
    '    if (t < 1 / d1) return n1 * t * t;',
    '    if (t < 2 / d1) { t -= 1.5 / d1; return n1 * t * t + 0.75; }',
    '    if (t < 2.5 / d1) { t -= 2.25 / d1; return n1 * t * t + 0.9375; }',
    '    t -= 2.625 / d1;',
    '    return n1 * t * t + 0.984375;',
    '  }',
    "  if (e.t === 'cb') return solveBezier(e.b, x);",
    "  if (e.t === 'lut' && e.y.length > 1) {",
    '    const idx = x * (e.y.length - 1);',
    '    const lo = Math.floor(idx);',
    '    const hi = Math.min(e.y.length - 1, lo + 1);',
    '    const frac = idx - lo;',
    '    return e.y[lo] + (e.y[hi] - e.y[lo]) * frac;',
    '  }',
    '  return x;',
    '}',
    '',
    'function appendContourD(',
    '  parts: string[],',
    '  n: number,',
    '  closed: boolean,',
    '  a: readonly number[],',
    '  b: readonly number[],',
    '  t: number,',
    '): void {',
    '  if (n < 2) return;',
    '  const x0 = a[0] + (b[0] - a[0]) * t;',
    '  const y0 = a[1] + (b[1] - a[1]) * t;',
    '  parts.push(`M ${x0.toFixed(2)} ${y0.toFixed(2)}`);',
    '  for (let i = 0; i < n; i += 1) {',
    '    const j = (i + 1) % n;',
    '    if (!closed && j === 0) break;',
    '    const bi = i * 6;',
    '    const bj = j * 6;',
    '    const c1x = a[bi + 4] + (b[bi + 4] - a[bi + 4]) * t;',
    '    const c1y = a[bi + 5] + (b[bi + 5] - a[bi + 5]) * t;',
    '    const c2x = a[bj + 2] + (b[bj + 2] - a[bj + 2]) * t;',
    '    const c2y = a[bj + 3] + (b[bj + 3] - a[bj + 3]) * t;',
    '    const ex = a[bj] + (b[bj] - a[bj]) * t;',
    '    const ey = a[bj + 1] + (b[bj + 1] - a[bj + 1]) * t;',
    '    parts.push(`C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)}`);',
    '  }',
    "  if (closed) parts.push('Z');",
    '}',
    '',
    'export function buildFolioMorphPathD(seg: FolioMorphSegment, t: number): string {',
    '  const parts: string[] = [];',
    '  appendContourD(parts, seg.n, seg.closed, seg.from, seg.to, t);',
    '  if (seg.subpaths && seg.subpaths.length > 0) {',
    '    for (const sp of seg.subpaths) {',
    '      appendContourD(parts, sp.n, sp.closed, sp.from, sp.to, t);',
    '    }',
    '  }',
    "  return parts.join(' ');",
    '}',
    '',
    'export function evaluateFolioMorphTrack(track: FolioMorphTrack, timeMs: number): string | null {',
    '  const segs = track.segments;',
    '  if (segs.length === 0) return null;',
    '  if (timeMs <= segs[0].t0) return buildFolioMorphPathD(segs[0], 0);',
    '  const last = segs[segs.length - 1];',
    '  if (timeMs >= last.t1) return buildFolioMorphPathD(last, 1);',
    '  for (const seg of segs) {',
    '    if (timeMs >= seg.t0 && timeMs <= seg.t1) {',
    '      const span = seg.t1 - seg.t0;',
    '      const raw = span > 0 ? (timeMs - seg.t0) / span : 1;',
    '      return buildFolioMorphPathD(seg, evalEasing(seg.easing, raw));',
    '    }',
    '  }',
    '  return buildFolioMorphPathD(last, 1);',
    '}',
    '',
    'interface MorphClipState {',
    '  clip: FolioMorphClip;',
    '  playing: boolean;',
    '  startAt: number;',
    '  elapsed: number;',
    '  reverse: boolean;',
    '}',
    '',
    'export function useFolioShapeMorph(clips: readonly FolioMorphClip[]): void {',
    '  useEffect(() => {',
    "    if (clips.length === 0 || typeof document === 'undefined' || typeof window === 'undefined') return;",
    "    const reduced = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);",
    '    let rafId = 0;',
    '    let disposed = false;',
    '',
    '    const findWrapEl = (nodeId: string): Element | null => {',
    '      const esc = nodeId.replace(/"/g, \'\\\\"\');',
    '      return document.querySelector(`[data-folio-id="${esc}"]`);',
    '    };',
    '',
    '    const findPathEls = (nodeId: string): Element[] => {',
    '      const wrap = findWrapEl(nodeId);',
    '      if (!wrap) return [];',
    '      const tagged = wrap.querySelectorAll(\'svg path[data-folio-morph-path]\');',
    '      if (tagged.length > 0) return Array.from(tagged);',
    "      const first = wrap.querySelector('svg path');",
    '      return first ? [first] : [];',
    '    };',
    '',
    '    const readSyncedCssTime = (st: MorphClipState): { time: number; state: string } | null => {',
    '      for (const tr of st.clip.tracks) {',
    '        const wrap = findWrapEl(tr.nodeId);',
    "        if (!wrap || typeof wrap.getAnimations !== 'function') continue;",
    '        for (const anim of wrap.getAnimations()) {',
    '          const cssAnim = anim as CSSAnimation;',
    '          if (cssAnim.animationName === tr.kfName && typeof cssAnim.currentTime === \'number\' && Number.isFinite(cssAnim.currentTime)) {',
    '            return { time: cssAnim.currentTime, state: cssAnim.playState };',
    '          }',
    '        }',
    '      }',
    "      if (st.clip.kfPrefix && typeof document.getAnimations === 'function') {",
    '        for (const anim of document.getAnimations()) {',
    '          const cssAnim = anim as CSSAnimation;',
    "          if (typeof cssAnim.animationName === 'string' && cssAnim.animationName.startsWith(st.clip.kfPrefix) && typeof cssAnim.currentTime === 'number' && Number.isFinite(cssAnim.currentTime)) {",
    '            return { time: cssAnim.currentTime, state: cssAnim.playState };',
    '          }',
    '        }',
    '      }',
    '      return null;',
    '    };',
    '',
    '    const states: MorphClipState[] = clips.map((clip) => ({',
    '      clip,',
    '      playing: Boolean(clip.autoplay) && !reduced,',
    '      startAt: 0,',
    '      elapsed: 0,',
    '      reverse: false,',
    '    }));',
    '',
    '    const renderAt = (st: MorphClipState, timeMs: number) => {',
    '      let t = st.reverse ? st.clip.durationMs - timeMs : timeMs;',
    '      if (t < 0) t = 0;',
    '      if (t > st.clip.durationMs) t = st.clip.durationMs;',
    '      for (const tr of st.clip.tracks) {',
    '        const els = findPathEls(tr.nodeId);',
    '        if (els.length === 0) continue;',
    '        const d = evaluateFolioMorphTrack(tr, t);',
    '        const hasSubpaths = tr.segments.some((s) => Boolean(s.subpaths && s.subpaths.length > 0));',
    '        if (d) {',
    '          for (const el of els) {',
    "            el.setAttribute('d', d);",
    "            if (hasSubpaths && !el.getAttribute('fill-rule')) el.setAttribute('fill-rule', 'evenodd');",
    '          }',
    '        }',
    '      }',
    '    };',
    '',
    '    const syncClassState = () => {',
    '      const root = document.documentElement;',
    '      if (!root) return;',
    '      for (const st of states) {',
    '        const cls = st.clip.className;',
    '        const hasPlay = root.classList.contains(cls);',
    '        const hasRev = root.classList.contains(`${cls}--reverse`);',
    '        const hasPause = root.classList.contains(`${cls}--paused`);',
    '        const hasStop = root.classList.contains(`${cls}--stopped`);',
    '        st.reverse = hasRev;',
    '        if (hasStop) { st.playing = false; st.elapsed = 0; renderAt(st, 0); continue; }',
    '        if (hasPause) { st.playing = false; continue; }',
    '        if ((hasPlay || st.clip.autoplay) && !reduced && !st.playing) {',
    '          st.playing = true;',
    '          st.startAt = performance.now() - st.elapsed;',
    '        }',
    '      }',
    '    };',
    '',
    '    const tick = (now: number) => {',
    '      if (disposed) return;',
    '      let anyActive = false;',
    '      for (const st of states) {',
    '        if (!st.playing) continue;',
    '        const synced = readSyncedCssTime(st);',
    '        let elapsed: number;',
    '        if (synced) {',
    '          const ct = synced.time;',
    '          if (st.clip.loop) {',
    '            elapsed = ((ct % st.clip.durationMs) + st.clip.durationMs) % st.clip.durationMs;',
    '            anyActive = true;',
    "          } else if (ct >= st.clip.durationMs || synced.state === 'finished') {",
    '            elapsed = st.clip.durationMs;',
    '            st.playing = false;',
    '          } else {',
    '            elapsed = Math.max(0, ct);',
    '            anyActive = true;',
    '          }',
    '        } else {',
    '          if (!st.startAt) st.startAt = now;',
    '          elapsed = now - st.startAt;',
    '          if (st.clip.loop) {',
    '            elapsed = elapsed % st.clip.durationMs;',
    '            anyActive = true;',
    '          } else if (elapsed >= st.clip.durationMs) {',
    '            elapsed = st.clip.durationMs;',
    '            st.playing = false;',
    '          } else {',
    '            anyActive = true;',
    '          }',
    '        }',
    '        st.elapsed = elapsed;',
    '        renderAt(st, elapsed);',
    '      }',
    '      if (anyActive) {',
    '        rafId = window.requestAnimationFrame(tick);',
    '      }',
    '    };',
    '',
    '    for (const st of states) renderAt(st, 0);',
    '    syncClassState();',
    '    if (!reduced && states.some((s) => s.playing)) {',
    '      rafId = window.requestAnimationFrame(tick);',
    '    }',
    '',
    '    let observer: MutationObserver | null = null;',
    "    if (typeof MutationObserver !== 'undefined' && document.documentElement) {",
    '      observer = new MutationObserver(() => {',
    '        const wasPlaying = states.some((s) => s.playing);',
    '        syncClassState();',
    '        if (!wasPlaying && !reduced && states.some((s) => s.playing)) {',
    '          rafId = window.requestAnimationFrame(tick);',
    '        }',
    '      });',
    "      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });",
    '    }',
    '',
    '    return () => {',
    '      disposed = true;',
    '      if (rafId) window.cancelAnimationFrame(rafId);',
    '      observer?.disconnect();',
    '    };',
    '  }, [clips]);',
    '}',
    '',
  ].join('\n');

  return {
    id: 'generated:react:shape-morph-hook',
    path: 'src/motion/useFolioShapeMorph.ts',
    language: 'ts',
    category: 'generated',
    readOnly: true,
    content,
    description: 'Generated React hook driving single & multi-contour FOLIO Native Shape Morph animations.',
    mappings: [],
  };
}

function buildAppEntryFile(
  project: FolioProject,
  activePage: FolioPage,
  pageNamesById: ReadonlyMap<string, string>,
  pagesWithNavigation: ReadonlySet<string>,
): CompiledCodeFile {
  const applications = getProjectApplications(project);
  const appRoutesManifest = applications.map((app) => ({
    id: app.id,
    name: app.name,
    slug: app.slug,
    basePath: app.basePath,
    pages: project.pages
      .filter((p) => getPageApplicationId(project, p) === app.id)
      .map((p) => ({
        id: p.id,
        name: p.name,
        route: p.route,
      })),
  }));

  const lines: string[] = [
    '// Generated by FOLIO Code Engine — Multi-App SPA Application Entry',
    "import React, { useEffect, useState } from 'react';",
    "import './styles/tokens.css';",
  ];

  for (const page of project.pages) {
    const pageComp = pageNamesById.get(page.id) ?? `${toPascalCase(page.name, 'Page')}Page`;
    lines.push(`import { ${pageComp} } from './pages/${pageComp}';`);
  }

  lines.push('');
  lines.push('export interface FolioAppRouteManifestEntry {');
  lines.push('  readonly id: string;');
  lines.push('  readonly name: string;');
  lines.push('  readonly slug: string;');
  lines.push('  readonly basePath: string;');
  lines.push('  readonly pages: ReadonlyArray<{ readonly id: string; readonly name: string; readonly route: string }>;');
  lines.push('}');
  lines.push('');
  lines.push(`export const FOLIO_APP_ROUTES: readonly FolioAppRouteManifestEntry[] = ${JSON.stringify(appRoutesManifest, null, 2)};`);
  lines.push('');
  lines.push('function readBasePath(): string {');
  lines.push("  if (typeof document === 'undefined') return '';");
  lines.push('  const meta = document.querySelector(\'meta[name="folio-base-path"]\');');
  lines.push("  const raw = meta?.getAttribute('content') ?? '/';");
  lines.push("  if (!raw || raw === '/' || raw === './' || raw.includes('%BASE_URL%')) return '';");
  lines.push("  const trimmed = raw.replace(/\\/+$/, '');");
  lines.push("  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;");
  lines.push('}');
  lines.push('');
  lines.push('function normalizeRoutePath(rawRoute: string): string {');
  lines.push("  const stripped = rawRoute.split('?')[0].split('#')[0].trim() || '/';");
  lines.push("  const withLeading = stripped.startsWith('/') ? stripped : `/${stripped}`;");
  lines.push("  return withLeading.length > 1 ? withLeading.replace(/\\/+$/, '') : '/';");
  lines.push('}');
  lines.push('');
  lines.push('function resolveBrowserRoute(fallbackRoute: string): string {');
  lines.push("  if (typeof window === 'undefined' || !window.location) return normalizeRoutePath(fallbackRoute);");
  lines.push('  const base = readBasePath();');
  lines.push('  let pathname = window.location.pathname || fallbackRoute;');
  lines.push('  if (base && pathname.startsWith(base)) {');
  lines.push("    pathname = pathname.slice(base.length) || '/';");
  lines.push('  }');
  lines.push('  return normalizeRoutePath(pathname);');
  lines.push('}');
  lines.push('');
  lines.push(`export function App({ route }: { route?: string } = {}) {`);
  lines.push(`  const fallbackRoute = ${escapeTsString(activePage.route)};`);
  lines.push('  const [currentRoute, setCurrentRoute] = useState<string>(() =>');
  lines.push('    route !== undefined ? normalizeRoutePath(route) : resolveBrowserRoute(fallbackRoute),');
  lines.push('  );');
  lines.push('');
  lines.push('  useEffect(() => {');
  lines.push('    if (route !== undefined) {');
  lines.push('      setCurrentRoute(normalizeRoutePath(route));');
  lines.push('      return;');
  lines.push('    }');
  lines.push("    if (typeof window === 'undefined') return;");
  lines.push('    const handlePopState = () => setCurrentRoute(resolveBrowserRoute(fallbackRoute));');
  lines.push("    window.addEventListener('popstate', handlePopState);");
  lines.push("    return () => window.removeEventListener('popstate', handlePopState);");
  lines.push('  }, [route, fallbackRoute]);');
  lines.push('');
  lines.push('  const handleNavigate = (nextRoute: string) => {');
  lines.push('    const normalized = normalizeRoutePath(nextRoute);');
  lines.push('    setCurrentRoute(normalized);');
  lines.push("    if (route === undefined && typeof window !== 'undefined' && window.history?.pushState) {");
  lines.push('      const base = readBasePath();');
  lines.push("      const targetUrl = base ? `${base}${normalized === '/' ? '/' : normalized}` : normalized;");
  lines.push('      window.history.pushState({}, "", targetUrl);');
  lines.push('    }');
  lines.push('  };');
  lines.push('');
  lines.push('  const activeRoute = route !== undefined ? normalizeRoutePath(route) : currentRoute;');
  lines.push('  switch (activeRoute) {');

  const seenRoutes = new Set<string>();
  for (const page of project.pages) {
    const normalizedRoute = page.route.length > 1 ? page.route.replace(/\/+$/, '') : (page.route || '/');
    if (seenRoutes.has(normalizedRoute)) continue;
    seenRoutes.add(normalizedRoute);
    const pageComp = pageNamesById.get(page.id) ?? `${toPascalCase(page.name, 'Page')}Page`;
    const navAttr = pagesWithNavigation.has(page.id) ? ' onNavigate={handleNavigate}' : '';
    lines.push(`    case ${escapeTsString(normalizedRoute)}:`);
    lines.push(`      return <${pageComp}${navAttr} />;`);
  }
  const activeComp = pageNamesById.get(activePage.id) ?? `${toPascalCase(activePage.name, 'Page')}Page`;
  const activeNavAttr = pagesWithNavigation.has(activePage.id) ? ' onNavigate={handleNavigate}' : '';
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
    description: 'Generated React multi-application SPA router mapping all Folio applications and page routes.',
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
    const hasEmbeddedAnimation = Boolean(
      comp.animations?.some(
        (clip) =>
          clip.tracks.some((tr) => tr.keyframes.length > 0) ||
          (clip.motionPaths !== undefined && clip.motionPaths.some((mp) => mp.points.length >= 2)),
      ),
    );
    if (
      hasEmbeddedAnimation ||
      (comp.nodeLogicEnabled
      && project.logicGraphs.some(
        (graph) =>
          graph.scope === 'component'
          && graph.targetId === comp.id
          && graph.nodes.some((n) => isBuiltInLogicNodeType(n.type)),
      ))
    ) {
      componentsWithScopedLogic.add(comp.id);
    }
  }

  let hasAnyShapeMorph = false;
  for (const page of project.pages) {
    const plan = buildReactPageLogicPlan(project, page);
    pageLogicPlans.set(page.id, plan);
    if (plan.hasNavigation) {
      pagesWithNavigation.add(page.id);
    }
    if (!hasAnyShapeMorph && compilePageMorphClips(project, page).length > 0) {
      hasAnyShapeMorph = true;
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
    ...(hasAnyShapeMorph ? [buildFolioShapeMorphHookFile()] : []),
    ...pageFiles,
  ];
  const componentsById = new Map(project.components.map((c) => [c.id, c]));
  const assetsById = new Map(project.assets.map((asset) => [asset.id, asset]));
  const pageDynamicTargetsByPageId = new Map<string, DynamicTransformTargets>();
  for (const page of project.pages) {
    pageDynamicTargetsByPageId.set(
      page.id,
      collectDynamicTransformTargets(getApplicableGraphsForPage(project, page.id)),
    );
  }
  for (const component of project.components) {
    const compName = componentNamesById.get(component.id) ?? toPascalCase(component.name, 'FolioComponent');
    const compGraphs = project.logicGraphs.filter(
      (g) => g.scope === 'component' && g.targetId === component.id,
    );
    const baseTargets = collectDynamicTransformTargets(compGraphs);
    const mergedIds = new Set<string>(baseTargets.ids);
    let mergedWildcard = baseTargets.hasWildcard;
    for (const page of project.pages) {
      const pageTargets = pageDynamicTargetsByPageId.get(page.id);
      if (!pageTargets) continue;
      if (pageTargets.hasWildcard) {
        mergedWildcard = true;
      }
      for (const node of page.document.nodes) {
        if (node.type !== 'component-instance' || node.componentId !== component.id) continue;
        const prefix = `${node.id}__`;
        for (const tid of pageTargets.ids) {
          if (tid.startsWith(prefix)) {
            mergedIds.add(tid.slice(prefix.length));
          }
        }
      }
    }
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
        { ids: mergedIds, hasWildcard: mergedWildcard },
      ),
    );
  }
  return files;
}
