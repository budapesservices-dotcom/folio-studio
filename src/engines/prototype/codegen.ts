/**
 * Folio Node Logic v1 — Live Preview & React Codegen Bridges.
 *
 * Compiles valid Folio Logic Graphs into:
 * 1. A tiny, zero-`eval`, zero-`innerHTML` sandbox-safe micro-runtime script
 *    for Folio's Live Preview (`<iframe sandbox="allow-scripts">`).
 * 2. Clean, typed React hooks (`useState`, `useEffect`, event handlers, and
 *    dynamic text/visibility/fill bindings) for `reactCompiler.ts`.
 */

import { getProjectDesignTokens, toDesignTokenThemeSlug } from '../../core/document/tokens';
import type {
  FolioPage,
  FolioProject,
  LogicGraph,
  LogicVariableValue,
} from '../../core/document/types';
import { sanitizeJsText, toKebabCase } from '../codegen/sanitize';
import { buildLivePreviewAnimationPayload } from '../animation/codegen';
import { isBuiltInLogicNodeType } from './catalog';
import { getApplicableGraphsForPage, MAX_LOGIC_EXECUTION_STEPS } from './runtime';

export function getActiveBuiltInPageLogicGraphs(
  project: FolioProject,
  pageId: string,
): LogicGraph[] {
  return getApplicableGraphsForPage(project, pageId).filter((graph) =>
    graph.nodes.some((node) => isBuiltInLogicNodeType(node.type)),
  );
}

interface CompiledPreviewNodeMeta {
  type: string;
  visible: boolean;
  display: 'flex' | 'grid' | 'block';
  componentId?: string;
}

interface CompiledPreviewVariantPatch {
  fill?: string;
  text?: string;
  visible?: boolean;
}

interface CompiledPreviewVariantMap {
  dataAttr: string;
  options: Record<string, { label: string; overrides: Record<string, CompiledPreviewVariantPatch> }>;
}

/**
 * Compiles active v1 logic graphs for a page into a self-contained,
 * zero-`eval`, zero-`innerHTML` script for Folio's sandboxed Live Preview.
 * Returns `null` when the page has no built-in v1 logic nodes so static pages
 * incur zero script overhead.
 */
export function buildLivePreviewLogicScript(
  project: FolioProject,
  page: FolioPage,
): string | null {
  const graphs = getActiveBuiltInPageLogicGraphs(project, page.id);
  if (graphs.length === 0) return null;

  const tokens = getProjectDesignTokens(project);
  const initialVariables: Record<string, LogicVariableValue> = {};
  const variableTypes: Record<string, string> = {};
  const variableNameToId: Record<string, string> = {};

  for (const graph of graphs) {
    for (const variable of graph.variables ?? []) {
      variableTypes[variable.id] = variable.valueType;
      variableNameToId[variable.name] = variable.id;
      variableNameToId[variable.name.toLowerCase()] = variable.id;
      if (!Object.prototype.hasOwnProperty.call(initialVariables, variable.id)) {
        initialVariables[variable.id] = variable.initialValue;
      }
    }
  }

  const nodeMeta: Record<string, CompiledPreviewNodeMeta> = {};
  for (const node of page.document.nodes) {
    nodeMeta[node.id] = {
      type: node.type,
      visible: node.visible,
      display: node.layout?.mode === 'flex' ? 'flex' : node.layout?.mode === 'grid' ? 'grid' : 'block',
      ...(node.type === 'component-instance' ? { componentId: node.componentId } : {}),
    };
  }

  const themeSlugById: Record<string, string> = {};
  const defaultThemeId = tokens.themes[0]?.id ?? '';
  for (const theme of tokens.themes) {
    themeSlugById[theme.id] = theme.id === defaultThemeId ? '' : toDesignTokenThemeSlug(theme.name);
  }

  const componentVariants: Record<string, Record<string, CompiledPreviewVariantMap>> = {};
  for (const comp of project.components) {
    if (!comp.variants || comp.variants.length === 0) continue;
    const axisMap: Record<string, CompiledPreviewVariantMap> = {};
    for (const axis of comp.variants) {
      const options: CompiledPreviewVariantMap['options'] = {};
      for (const opt of axis.options) {
        const cleanedOverrides: Record<string, CompiledPreviewVariantPatch> = {};
        for (const [childId, patch] of Object.entries(opt.overrides)) {
          cleanedOverrides[childId] = {
            ...(patch.fill !== undefined ? { fill: patch.fill } : {}),
            ...(patch.text !== undefined ? { text: patch.text } : {}),
            ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
          };
        }
        options[opt.id] = { label: opt.label, overrides: cleanedOverrides };
      }
      axisMap[axis.id] = {
        dataAttr: `data-variant-${toKebabCase(axis.name, 'variant')}`,
        options,
      };
    }
    componentVariants[comp.id] = axisMap;
  }

  const compiledGraphs = graphs.map((graph) => ({
    id: graph.id,
    nodes: graph.nodes
      .filter((node) => isBuiltInLogicNodeType(node.type))
      .map((node) => ({ id: node.id, type: node.type, data: node.data })),
    connections: graph.connections.map((conn) => ({
      sourceNodeId: conn.sourceNodeId,
      sourcePortId: conn.sourcePortId,
      targetNodeId: conn.targetNodeId,
      targetPortId: conn.targetPortId,
    })),
  }));

  const animationClassById: Record<string, string> = {};
  for (const desc of buildLivePreviewAnimationPayload(project, page)) {
    animationClassById[desc.id] = desc.className;
  }

  const payload = {
    maxSteps: MAX_LOGIC_EXECUTION_STEPS,
    variables: initialVariables,
    variableTypes,
    variableNameToId,
    nodeMeta,
    themeSlugById,
    componentVariants,
    animationClassById,
    graphs: compiledGraphs,
  };

  const safePayloadJson = sanitizeJsText(JSON.stringify(payload));

  return [
    '/* Generated by FOLIO Node Logic v1 Runtime (zero-eval, sandbox-safe) */',
    '(function () {',
    `  var CONFIG = ${safePayloadJson};`,
    '  var state = Object.assign({}, CONFIG.variables);',
    '  var visibleState = {};',
    '  var SAFE_COLOR = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|transparent|currentcolor|inherit|(?:rgba?|hsla?)\\(\\s*[0-9.%,\\s/+-]+\\s*\\)|[a-z]{3,24})$/i;',
    '  var SAFE_HREF = /^(?:https?:\\/\\/|mailto:|\\/|#)/i;',
    '  function isSafeColor(val) {',
    '    if (typeof val !== "string") return false;',
    '    var t = val.trim();',
    '    if (!t || /[;{}<>()]/.test(t.replace(/^(?:rgba?|hsla?)\\([0-9.%,\\s/+-]+\\)$/i, ""))) return false;',
    '    return SAFE_COLOR.test(t);',
    '  }',
    '  function findEl(id) {',
    '    var list = document.querySelectorAll("[data-folio-id]");',
    '    for (var i = 0; i < list.length; i++) {',
    '      if (list[i].getAttribute("data-folio-id") === id) return list[i];',
    '    }',
    '    return null;',
    '  }',
    '  function interpolate(tpl, connected) {',
    '    return String(tpl || "").replace(/\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}/g, function (_, key) {',
    '      if (key === "value" && connected !== undefined && connected !== null) return String(connected);',
    '      if (Object.prototype.hasOwnProperty.call(state, key)) return String(state[key]);',
    '      var mapped = CONFIG.variableNameToId[key] || CONFIG.variableNameToId[key.toLowerCase()];',
    '      if (mapped && Object.prototype.hasOwnProperty.call(state, mapped)) return String(state[mapped]);',
    '      return "";',
    '    });',
    '  }',
    '  function coerce(raw, expected, fallback) {',
    '    if (expected === "string") return raw == null ? "" : String(raw);',
    '    if (expected === "number") {',
    '      var n = typeof raw === "number" ? raw : Number(raw);',
    '      return Number.isFinite(n) ? n : (typeof fallback === "number" ? fallback : 0);',
    '    }',
    '    if (typeof raw === "boolean") return raw;',
    '    if (typeof raw === "string") { var l = raw.trim().toLowerCase(); return l !== "" && l !== "false" && l !== "0"; }',
    '    return Boolean(raw);',
    '  }',
    '  function compare(op, l, r) {',
    '    if (op === "==") return l === r;',
    '    if (op === "!=") return l !== r;',
    '    if (op === ">") return typeof l === "number" && typeof r === "number" && l > r;',
    '    if (op === ">=") return typeof l === "number" && typeof r === "number" && l >= r;',
    '    if (op === "<") return typeof l === "number" && typeof r === "number" && l < r;',
    '    if (op === "<=") return typeof l === "number" && typeof r === "number" && l <= r;',
    '    return false;',
    '  }',
    '  var indexed = CONFIG.graphs.map(function (g) {',
    '    var byId = {}; var out = {}; var inc = {};',
    '    g.nodes.forEach(function (n) { byId[n.id] = n; });',
    '    g.connections.forEach(function (c) {',
    '      var ok = c.sourceNodeId + ":" + c.sourcePortId;',
    '      (out[ok] = out[ok] || []).push(c);',
    '      var ik = c.targetNodeId + ":" + c.targetPortId;',
    '      (inc[ik] = inc[ik] || []).push(c);',
    '    });',
    '    return { id: g.id, nodes: g.nodes, byId: byId, out: out, inc: inc };',
    '  });',
    '  function runQueue(starters) {',
    '    var queue = starters.slice();',
    '    var steps = 0;',
    '    var ephemeral = {};',
    '    function evalPort(g, nodeId, portId, visiting) {',
    '      var k = g.id + ":" + nodeId + ":" + portId;',
    '      if (Object.prototype.hasOwnProperty.call(ephemeral, k)) return ephemeral[k];',
    '      if (visiting[k]) return null;',
    '      var n = g.byId[nodeId]; if (!n) return null;',
    '      visiting[k] = true;',
    '      var res = null;',
    '      if (n.type === "state.get" || n.type === "state.set" || n.type === "state.toggle" || n.type === "state.increment" || n.type === "event.on-state-change") {',
    '        res = Object.prototype.hasOwnProperty.call(state, n.data.variableId) ? state[n.data.variableId] : null;',
    '      } else if (n.type === "logic.compare") {',
    '        var l = resolveIn(g, n, "left", n.data.left, visiting);',
    '        var r = resolveIn(g, n, "right", n.data.right, visiting);',
    '        res = compare(String(n.data.operator || "=="), l, r);',
    '      } else if (n.type === "logic.template") {',
    '        var cv = resolveIn(g, n, "value", undefined, visiting);',
    '        res = interpolate(n.data.template, cv);',
    '      }',
    '      delete visiting[k];',
    '      return res;',
    '    }',
    '    function resolveIn(g, n, portId, fallback, visiting) {',
    '      var list = g.inc[n.id + ":" + portId];',
    '      if (!list || !list.length) return fallback;',
    '      return evalPort(g, list[0].sourceNodeId, list[0].sourcePortId, visiting);',
    '    }',
    '    function pushOut(g, nodeId, portId) {',
    '      var list = g.out[nodeId + ":" + portId] || [];',
    '      for (var i = 0; i < list.length; i++) queue.push({ g: g, nodeId: list[i].targetNodeId });',
    '    }',
    '    function notifyState(varId, val) {',
    '      for (var i = 0; i < indexed.length; i++) {',
    '        var cg = indexed[i];',
    '        for (var j = 0; j < cg.nodes.length; j++) {',
    '          var cn = cg.nodes[j];',
    '          if (cn.type === "event.on-state-change" && cn.data.variableId === varId) {',
    '            ephemeral[cg.id + ":" + cn.id + ":value"] = val;',
    '            queue.push({ g: cg, nodeId: cn.id });',
    '          }',
    '        }',
    '      }',
    '    }',
    '    while (queue.length > 0 && steps < CONFIG.maxSteps) {',
    '      steps += 1;',
    '      var item = queue.shift();',
    '      var g = item.g; var n = g.byId[item.nodeId]; if (!n) continue;',
    '      var v = {};',
    '      if (n.type === "event.on-click" || n.type === "event.on-hover" || n.type === "event.on-page-load" || n.type === "event.on-state-change") {',
    '        pushOut(g, n.id, "exec");',
    '      } else if (n.type === "state.set") {',
    '        var vid = n.data.variableId; var t = CONFIG.variableTypes[vid];',
    '        if (t) {',
    '          var prev = state[vid];',
    '          var nv = coerce(resolveIn(g, n, "value", n.data.value, v), t, prev);',
    '          state[vid] = nv; ephemeral[g.id + ":" + n.id + ":result"] = nv;',
    '          if (nv !== prev) notifyState(vid, nv);',
    '          pushOut(g, n.id, "next");',
    '        }',
    '      } else if (n.type === "state.toggle") {',
    '        var tvid = n.data.variableId;',
    '        if (CONFIG.variableTypes[tvid] === "boolean") {',
    '          var tv = !Boolean(state[tvid]); state[tvid] = tv;',
    '          ephemeral[g.id + ":" + n.id + ":result"] = tv;',
    '          notifyState(tvid, tv); pushOut(g, n.id, "next");',
    '        }',
    '      } else if (n.type === "state.increment") {',
    '        var ivid = n.data.variableId;',
    '        if (CONFIG.variableTypes[ivid] === "number") {',
    '          var step = resolveIn(g, n, "step", n.data.step, v);',
    '          var incVal = (typeof state[ivid] === "number" ? state[ivid] : 0) + (typeof step === "number" && Number.isFinite(step) ? step : 1);',
    '          if (typeof n.data.min === "number") incVal = Math.max(n.data.min, incVal);',
    '          if (typeof n.data.max === "number") incVal = Math.min(n.data.max, incVal);',
    '          var oldIv = state[ivid]; state[ivid] = incVal;',
    '          ephemeral[g.id + ":" + n.id + ":result"] = incVal;',
    '          if (incVal !== oldIv) notifyState(ivid, incVal);',
    '          pushOut(g, n.id, "next");',
    '        }',
    '      } else if (n.type === "logic.branch") {',
    '        var cond = Boolean(resolveIn(g, n, "condition", Boolean(n.data.condition), v));',
    '        pushOut(g, n.id, cond ? "true" : "false");',
    '      } else if (n.type === "action.set-visible") {',
    '        var visTarget = n.data.targetNodeId; var el = findEl(visTarget); var meta = CONFIG.nodeMeta[visTarget];',
    '        if (el && meta) {',
    '          var hasVisIn = Boolean(g.inc[n.id + ":visible"] && g.inc[n.id + ":visible"].length);',
    '          var curVis = Object.prototype.hasOwnProperty.call(visibleState, visTarget) ? visibleState[visTarget] : meta.visible;',
    '          var nextVis = hasVisIn ? Boolean(resolveIn(g, n, "visible", true, v)) : (n.data.mode === "show" ? true : n.data.mode === "hide" ? false : !curVis);',
    '          visibleState[visTarget] = nextVis;',
    '          el.style.display = nextVis ? meta.display : "none";',
    '          pushOut(g, n.id, "next");',
    '        }',
    '      } else if (n.type === "action.set-text") {',
    '        var txtTarget = n.data.targetNodeId; var txtEl = findEl(txtTarget);',
    '        if (txtEl) {',
    '          var txtVal = resolveIn(g, n, "text", n.data.text, v);',
    '          txtEl.textContent = txtVal == null ? "" : String(txtVal);',
    '          pushOut(g, n.id, "next");',
    '        }',
    '      } else if (n.type === "action.set-fill") {',
    '        var fillTarget = n.data.targetNodeId; var fillEl = findEl(fillTarget); var fMeta = CONFIG.nodeMeta[fillTarget];',
    '        var fillVal = resolveIn(g, n, "fill", n.data.fill, v);',
    '        if (fillEl && fMeta && isSafeColor(fillVal)) {',
    '          if (fMeta.type === "text") fillEl.style.color = fillVal.trim();',
    '          else if (fMeta.type === "path") { var p = fillEl.querySelector("path"); if (p) p.setAttribute("fill", fillVal.trim()); }',
    '          else fillEl.style.background = fillVal.trim();',
    '          pushOut(g, n.id, "next");',
    '        }',
    '      } else if (n.type === "action.set-variant") {',
    '        var varTarget = n.data.targetNodeId; var varEl = findEl(varTarget); var vMeta = CONFIG.nodeMeta[varTarget];',
    '        var optId = resolveIn(g, n, "optionId", n.data.optionId, v);',
    '        var compAxes = vMeta && vMeta.componentId ? CONFIG.componentVariants[vMeta.componentId] : null;',
    '        var axisDef = compAxes ? compAxes[n.data.axisId] : null;',
    '        var optDef = axisDef ? axisDef.options[String(optId || "")] : null;',
    '        if (varEl && axisDef && optDef) {',
    '          varEl.setAttribute(axisDef.dataAttr, optDef.label);',
    '          Object.keys(optDef.overrides).forEach(function (childId) {',
    '            var childEl = findEl(varTarget + "__" + childId);',
    '            var patch = optDef.overrides[childId];',
    '            if (!childEl || !patch) return;',
    '            if (typeof patch.visible === "boolean") childEl.style.display = patch.visible ? "" : "none";',
    '            if (typeof patch.text === "string") childEl.textContent = patch.text;',
    '            if (typeof patch.fill === "string" && isSafeColor(patch.fill)) {',
    '              if (childEl.tagName === "P" || childEl.tagName === "H1" || childEl.tagName === "H2" || childEl.tagName === "H3" || childEl.tagName === "SPAN") childEl.style.color = patch.fill;',
    '              else childEl.style.background = patch.fill;',
    '            }',
    '          });',
    '          pushOut(g, n.id, "next");',
    '        }',
    '      } else if (n.type === "action.set-theme") {',
    '        var tid = String(resolveIn(g, n, "themeId", n.data.themeId, v) || "");',
    '        if (Object.prototype.hasOwnProperty.call(CONFIG.themeSlugById, tid)) {',
    '          var slug = CONFIG.themeSlugById[tid];',
    '          if (slug) document.documentElement.setAttribute("data-theme", slug);',
    '          else document.documentElement.removeAttribute("data-theme");',
    '          pushOut(g, n.id, "next");',
    '        }',
    '      } else if (n.type === "action.navigate") {',
    '        var route = String(n.data.route || "").trim();',
    '        if (SAFE_HREF.test(route)) {',
    '          document.documentElement.setAttribute("data-folio-route", route);',
    '          pushOut(g, n.id, "next");',
    '        }',
    '      } else if (n.type === "action.play-animation") {',
    '        var clipId = String(n.data.clipId || "").trim();',
    '        var animClass = CONFIG.animationClassById && CONFIG.animationClassById[clipId];',
    '        if (animClass) {',
    '          document.documentElement.classList.remove(animClass);',
    '          void document.documentElement.offsetWidth;',
    '          document.documentElement.classList.add(animClass);',
    '          pushOut(g, n.id, "next");',
    '        }',
    '      }',
    '    }',
    '  }',
    '  function triggerNode(nodeId, kind) {',
    '    var starters = [];',
    '    for (var i = 0; i < indexed.length; i++) {',
    '      var g = indexed[i];',
    '      for (var j = 0; j < g.nodes.length; j++) {',
    '        var n = g.nodes[j];',
    '        if (kind === "click" && n.type === "event.on-click" && n.data.targetNodeId === nodeId) starters.push({ g: g, nodeId: n.id });',
    '        else if (kind === "hover-enter" && n.type === "event.on-hover" && n.data.targetNodeId === nodeId && (!n.data.phase || n.data.phase === "enter")) starters.push({ g: g, nodeId: n.id });',
    '        else if (kind === "hover-leave" && n.type === "event.on-hover" && n.data.targetNodeId === nodeId && n.data.phase === "leave") starters.push({ g: g, nodeId: n.id });',
    '      }',
    '    }',
    '    if (starters.length) runQueue(starters);',
    '  }',
    '  function bindEvents() {',
    '    var bound = {};',
    '    indexed.forEach(function (g) {',
    '      g.nodes.forEach(function (n) {',
    '        var tid = n.data && n.data.targetNodeId;',
    '        if (!tid) return;',
    '        if (n.type === "event.on-click" && !bound["click:" + tid]) {',
    '          bound["click:" + tid] = true;',
    '          var el = findEl(tid);',
    '          if (el) {',
    '            el.setAttribute("data-folio-interactive", "true");',
    '            el.style.cursor = "pointer";',
    '            el.addEventListener("click", function () { triggerNode(tid, "click"); });',
    '          }',
    '        } else if (n.type === "event.on-hover") {',
    '          var phase = n.data.phase === "leave" ? "hover-leave" : "hover-enter";',
    '          if (!bound[phase + ":" + tid]) {',
    '            bound[phase + ":" + tid] = true;',
    '            var hel = findEl(tid);',
    '            if (hel) hel.addEventListener(phase === "hover-leave" ? "mouseleave" : "mouseenter", function () { triggerNode(tid, phase); });',
    '          }',
    '        }',
    '      });',
    '    });',
    '    var loadStarters = [];',
    '    indexed.forEach(function (g) {',
    '      g.nodes.forEach(function (n) { if (n.type === "event.on-page-load") loadStarters.push({ g: g, nodeId: n.id }); });',
    '    });',
    '    if (loadStarters.length) runQueue(loadStarters);',
    '  }',
    '  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bindEvents);',
    '  else bindEvents();',
    '})();',
  ].join('\n');
}

export interface ReactPageLogicPlan {
  readonly hasLogic: boolean;
  readonly needsUseEffect: boolean;
  readonly hasNavigation: boolean;
  readonly hookLines: readonly string[];
  getNodeEventAttrs(nodeId: string): string[];
  hasDynamicOverride(nodeId: string): boolean;
  hasDynamicVisible(nodeId: string): boolean;
  hasDynamicText(nodeId: string): boolean;
  hasDynamicFill(nodeId: string): boolean;
  hasDynamicVariant(nodeId: string, axisId?: string): boolean;
}

/**
 * Generates clean React `useState`/`useEffect` state bindings and typed event
 * handlers for pages containing active Node Logic v1 graphs, with full 18-node
 * parity matching Folio's headless `PrototypeRuntime` and Live Preview runtime.
 * Returns `hasLogic: false` for static pages so generated TSX stays unchanged.
 */
export function buildReactPageLogicPlan(
  project: FolioProject,
  page: FolioPage,
): ReactPageLogicPlan {
  const graphs = getActiveBuiltInPageLogicGraphs(project, page.id);
  if (graphs.length === 0) {
    return {
      hasLogic: false,
      needsUseEffect: false,
      hasNavigation: false,
      hookLines: [],
      getNodeEventAttrs: () => [],
      hasDynamicOverride: () => false,
      hasDynamicVisible: () => false,
      hasDynamicText: () => false,
      hasDynamicFill: () => false,
      hasDynamicVariant: () => false,
    };
  }

  const clickNodes = new Set<string>();
  const hoverEnterNodes = new Set<string>();
  const hoverLeaveNodes = new Set<string>();
  const visibleTargets = new Set<string>();
  const textTargets = new Set<string>();
  const fillTargets = new Set<string>();
  const variantTargets = new Map<string, Set<string>>();
  let hasPageLoad = false;
  let hasNavigation = false;
  let hasThemeAction = false;
  let hasAnimationAction = false;

  const initialVariables: Record<string, LogicVariableValue> = {};
  const variableTypes: Record<string, string> = {};
  const variableNameToId: Record<string, string> = {};

  for (const graph of graphs) {
    for (const variable of graph.variables ?? []) {
      variableTypes[variable.id] = variable.valueType;
      variableNameToId[variable.name] = variable.id;
      variableNameToId[variable.name.toLowerCase()] = variable.id;
      if (!Object.prototype.hasOwnProperty.call(initialVariables, variable.id)) {
        initialVariables[variable.id] = variable.initialValue;
      }
    }
    for (const node of graph.nodes) {
      const targetId = typeof node.data.targetNodeId === 'string' ? node.data.targetNodeId : '';
      if (node.type === 'event.on-click' && targetId) clickNodes.add(targetId);
      if (node.type === 'event.on-hover' && targetId) {
        if (node.data.phase === 'leave') hoverLeaveNodes.add(targetId);
        else hoverEnterNodes.add(targetId);
      }
      if (node.type === 'event.on-page-load') hasPageLoad = true;
      if (node.type === 'action.set-visible' && targetId) visibleTargets.add(targetId);
      if (node.type === 'action.set-text' && targetId) textTargets.add(targetId);
      if (node.type === 'action.set-fill' && targetId) fillTargets.add(targetId);
      if (node.type === 'action.set-variant' && targetId) {
        const axisId = typeof node.data.axisId === 'string' ? node.data.axisId : '';
        const set = variantTargets.get(targetId) ?? new Set<string>();
        if (axisId) set.add(axisId);
        variantTargets.set(targetId, set);
      }
      if (node.type === 'action.navigate') hasNavigation = true;
      if (node.type === 'action.set-theme') hasThemeAction = true;
      if (node.type === 'action.play-animation') hasAnimationAction = true;
    }
  }

  const nodeInitialVisible: Record<string, boolean> = {};
  const instanceComponentById: Record<string, string> = {};
  for (const node of page.document.nodes) {
    nodeInitialVisible[node.id] = node.visible;
    if (node.type === 'component-instance') {
      instanceComponentById[node.id] = node.componentId;
    }
  }

  const tokens = getProjectDesignTokens(project);
  const themeSlugById: Record<string, string> = {};
  if (hasThemeAction) {
    const defaultThemeId = tokens.themes[0]?.id ?? '';
    for (const theme of tokens.themes) {
      themeSlugById[theme.id] = theme.id === defaultThemeId ? '' : toDesignTokenThemeSlug(theme.name);
    }
  }

  const variantLabels: Record<string, Record<string, Record<string, string>>> = {};
  if (variantTargets.size > 0) {
    for (const comp of project.components) {
      if (!comp.variants || comp.variants.length === 0) continue;
      const axisMap: Record<string, Record<string, string>> = {};
      for (const axis of comp.variants) {
        const optMap: Record<string, string> = {};
        for (const opt of axis.options) {
          optMap[opt.id] = opt.label;
        }
        axisMap[axis.id] = optMap;
      }
      variantLabels[comp.id] = axisMap;
    }
  }

  const animationClassById: Record<string, string> = {};
  if (hasAnimationAction) {
    for (const desc of buildLivePreviewAnimationPayload(project, page)) {
      animationClassById[desc.id] = desc.className;
    }
  }

  const compiledGraphs = graphs.map((graph) => ({
    id: graph.id,
    nodes: graph.nodes
      .filter((node) => isBuiltInLogicNodeType(node.type))
      .map((node) => ({ id: node.id, type: node.type, data: node.data })),
    connections: graph.connections.map((conn) => ({
      sourceNodeId: conn.sourceNodeId,
      sourcePortId: conn.sourcePortId,
      targetNodeId: conn.targetNodeId,
      targetPortId: conn.targetPortId,
    })),
  }));

  const overrideType = '{ visible?: boolean; text?: string; fill?: string; variants?: Record<string, string> }';

  const hookLines: string[] = [
    `  const [logicState, setLogicState] = useState<Record<string, string | number | boolean>>(${JSON.stringify(initialVariables)});`,
    `  const [logicOverrides, setLogicOverrides] = useState<Record<string, ${overrideType}>>({});`,
    `  const logicGraphs = ${JSON.stringify(compiledGraphs)};`,
    `  const logicVarTypes: Record<string, string> = ${JSON.stringify(variableTypes)};`,
    `  const logicVarNameToId: Record<string, string> = ${JSON.stringify(variableNameToId)};`,
    `  const logicInitialVisible: Record<string, boolean> = ${JSON.stringify(nodeInitialVisible)};`,
    ...(variantTargets.size > 0
      ? [
          `  const logicInstanceComponentById: Record<string, string> = ${JSON.stringify(instanceComponentById)};`,
          `  const logicVariantLabels: Record<string, Record<string, Record<string, string>>> = ${JSON.stringify(variantLabels)};`,
        ]
      : []),
    ...(hasThemeAction
      ? [`  const logicThemeSlugById: Record<string, string> = ${JSON.stringify(themeSlugById)};`]
      : []),
    ...(hasAnimationAction
      ? [`  const logicAnimationClassById: Record<string, string> = ${JSON.stringify(animationClassById)};`]
      : []),
    '',
    '  const runLogicTrigger = (triggerKind: "click" | "hover-enter" | "hover-leave" | "page-load", targetNodeId?: string) => {',
    '    const nextVars: Record<string, string | number | boolean> = { ...logicState };',
    `    const nextOverrides: Record<string, ${overrideType}> = { ...logicOverrides };`,
    '    const ephemeral: Record<string, unknown> = {};',
    `    const maxSteps = ${MAX_LOGIC_EXECUTION_STEPS};`,
    '    const queue: Array<{ graph: (typeof logicGraphs)[number]; nodeId: string }> = [];',
    '    for (const graph of logicGraphs) {',
    '      for (const n of graph.nodes) {',
    '        if (triggerKind === "page-load" && n.type === "event.on-page-load") queue.push({ graph, nodeId: n.id });',
    '        else if (triggerKind === "click" && n.type === "event.on-click" && n.data.targetNodeId === targetNodeId) queue.push({ graph, nodeId: n.id });',
    '        else if (triggerKind === "hover-enter" && n.type === "event.on-hover" && n.data.targetNodeId === targetNodeId && (!n.data.phase || n.data.phase === "enter")) queue.push({ graph, nodeId: n.id });',
    '        else if (triggerKind === "hover-leave" && n.type === "event.on-hover" && n.data.targetNodeId === targetNodeId && n.data.phase === "leave") queue.push({ graph, nodeId: n.id });',
    '      }',
    '    }',
    '    let steps = 0;',
    '    const notifyStateChange = (varId: string, val: string | number | boolean) => {',
    '      for (const g of logicGraphs) {',
    '        for (const cn of g.nodes) {',
    '          if (cn.type === "event.on-state-change" && cn.data.variableId === varId) {',
    '            ephemeral[`${g.id}:${cn.id}:value`] = val;',
    '            queue.push({ graph: g, nodeId: cn.id });',
    '          }',
    '        }',
    '      }',
    '    };',
    '    const evalData = (graph: (typeof logicGraphs)[number], nodeId: string, portId: string, seen: Set<string>): unknown => {',
    '      const epKey = `${graph.id}:${nodeId}:${portId}`;',
    '      if (Object.prototype.hasOwnProperty.call(ephemeral, epKey)) return ephemeral[epKey];',
    '      const key = `${graph.id}:${nodeId}`;',
    '      if (seen.has(key)) return null;',
    '      const n = graph.nodes.find((item) => item.id === nodeId);',
    '      if (!n) return null;',
    '      seen.add(key);',
    '      try {',
    '        if (n.type === "state.get" || n.type === "state.set" || n.type === "state.toggle" || n.type === "state.increment" || n.type === "event.on-state-change") {',
    '          return nextVars[String(n.data.variableId ?? "")] ?? null;',
    '        }',
    '        if (n.type === "logic.compare") {',
    '          const leftConn = graph.connections.find((c) => c.targetNodeId === n.id && c.targetPortId === "left");',
    '          const rightConn = graph.connections.find((c) => c.targetNodeId === n.id && c.targetPortId === "right");',
    '          const l = leftConn ? evalData(graph, leftConn.sourceNodeId, leftConn.sourcePortId, seen) : n.data.left;',
    '          const r = rightConn ? evalData(graph, rightConn.sourceNodeId, rightConn.sourcePortId, seen) : n.data.right;',
    '          const op = String(n.data.operator ?? "==");',
    '          if (op === "==") return l === r;',
    '          if (op === "!=") return l !== r;',
    '          if (op === ">") return typeof l === "number" && typeof r === "number" && l > r;',
    '          if (op === ">=") return typeof l === "number" && typeof r === "number" && l >= r;',
    '          if (op === "<") return typeof l === "number" && typeof r === "number" && l < r;',
    '          if (op === "<=") return typeof l === "number" && typeof r === "number" && l <= r;',
    '          return false;',
    '        }',
    '        if (n.type === "logic.template") {',
    '          const valConn = graph.connections.find((c) => c.targetNodeId === n.id && c.targetPortId === "value");',
    '          const connected = valConn ? evalData(graph, valConn.sourceNodeId, valConn.sourcePortId, seen) : undefined;',
    '          return String(n.data.template ?? "").replace(/\\{\\{\\s*([a-zA-Z0-9_.-]+)\\s*\\}\\}/g, (_, k: string) => {',
    '            if (k === "value" && connected !== undefined && connected !== null) return String(connected);',
    '            if (Object.prototype.hasOwnProperty.call(nextVars, k)) return String(nextVars[k]);',
    '            const mapped = logicVarNameToId[k] ?? logicVarNameToId[k.toLowerCase()];',
    '            return mapped && Object.prototype.hasOwnProperty.call(nextVars, mapped) ? String(nextVars[mapped]) : "";',
    '          });',
    '        }',
    '        return null;',
    '      } finally { seen.delete(key); }',
    '    };',
    '    const resolveIn = (graph: (typeof logicGraphs)[number], nodeId: string, portId: string, fallback: unknown): unknown => {',
    '      const conn = graph.connections.find((c) => c.targetNodeId === nodeId && c.targetPortId === portId);',
    '      return conn ? evalData(graph, conn.sourceNodeId, conn.sourcePortId, new Set<string>()) : fallback;',
    '    };',
    '    const enqueueOut = (graph: (typeof logicGraphs)[number], nodeId: string, portId: string) => {',
    '      for (const c of graph.connections) {',
    '        if (c.sourceNodeId === nodeId && c.sourcePortId === portId) queue.push({ graph, nodeId: c.targetNodeId });',
    '      }',
    '    };',
    '    while (queue.length > 0 && steps < maxSteps) {',
    '      steps += 1;',
    '      const step = queue.shift()!;',
    '      const n = step.graph.nodes.find((item) => item.id === step.nodeId);',
    '      if (!n) continue;',
    '      if (n.type === "event.on-click" || n.type === "event.on-hover" || n.type === "event.on-page-load" || n.type === "event.on-state-change") {',
    '        enqueueOut(step.graph, n.id, "exec");',
    '      } else if (n.type === "state.toggle") {',
    '        const vid = String(n.data.variableId ?? "");',
    '        if (logicVarTypes[vid] === "boolean") {',
    '          const nextBool = !Boolean(nextVars[vid]);',
    '          nextVars[vid] = nextBool;',
    '          ephemeral[`${step.graph.id}:${n.id}:result`] = nextBool;',
    '          notifyStateChange(vid, nextBool);',
    '          enqueueOut(step.graph, n.id, "next");',
    '        }',
    '      } else if (n.type === "state.increment") {',
    '        const vid = String(n.data.variableId ?? "");',
    '        if (logicVarTypes[vid] === "number") {',
    '          const prevVal = nextVars[vid];',
    '          const inc = resolveIn(step.graph, n.id, "step", n.data.step ?? 1);',
    '          let val = (typeof prevVal === "number" ? Number(prevVal) : 0) + (typeof inc === "number" && Number.isFinite(inc) ? inc : 1);',
    '          if (typeof n.data.min === "number") val = Math.max(n.data.min, val);',
    '          if (typeof n.data.max === "number") val = Math.min(n.data.max, val);',
    '          nextVars[vid] = val;',
    '          ephemeral[`${step.graph.id}:${n.id}:result`] = val;',
    '          if (val !== prevVal) notifyStateChange(vid, val);',
    '          enqueueOut(step.graph, n.id, "next");',
    '        }',
    '      } else if (n.type === "state.set") {',
    '        const vid = String(n.data.variableId ?? "");',
    '        const t = logicVarTypes[vid];',
    '        if (t) {',
    '          const prevVal = nextVars[vid];',
    '          const raw = resolveIn(step.graph, n.id, "value", n.data.value);',
    '          const coercedVal = t === "number" ? Number(raw ?? 0) : t === "boolean" ? Boolean(raw) : String(raw ?? "");',
    '          nextVars[vid] = coercedVal;',
    '          ephemeral[`${step.graph.id}:${n.id}:result`] = coercedVal;',
    '          if (coercedVal !== prevVal) notifyStateChange(vid, coercedVal);',
    '          enqueueOut(step.graph, n.id, "next");',
    '        }',
    '      } else if (n.type === "logic.branch") {',
    '        const cond = Boolean(resolveIn(step.graph, n.id, "condition", Boolean(n.data.condition)));',
    '        enqueueOut(step.graph, n.id, cond ? "true" : "false");',
    '      } else if (n.type === "action.set-visible") {',
    '        const tid = String(n.data.targetNodeId ?? "");',
    '        const cur = nextOverrides[tid]?.visible ?? logicInitialVisible[tid] ?? true;',
    '        const hasIn = step.graph.connections.some((c) => c.targetNodeId === n.id && c.targetPortId === "visible");',
    '        const nextVis = hasIn ? Boolean(resolveIn(step.graph, n.id, "visible", true)) : n.data.mode === "show" ? true : n.data.mode === "hide" ? false : !cur;',
    '        nextOverrides[tid] = { ...(nextOverrides[tid] ?? {}), visible: nextVis };',
    '        enqueueOut(step.graph, n.id, "next");',
    '      } else if (n.type === "action.set-text") {',
    '        const tid = String(n.data.targetNodeId ?? "");',
    '        const txt = String(resolveIn(step.graph, n.id, "text", n.data.text ?? "") ?? "");',
    '        nextOverrides[tid] = { ...(nextOverrides[tid] ?? {}), text: txt };',
    '        enqueueOut(step.graph, n.id, "next");',
    '      } else if (n.type === "action.set-fill") {',
    '        const tid = String(n.data.targetNodeId ?? "");',
    '        const fill = String(resolveIn(step.graph, n.id, "fill", n.data.fill ?? "") ?? "").trim();',
    '        if (/^(?:#[0-9a-f]{3,8}|transparent|currentcolor|(?:rgba?|hsla?)\\([0-9.%,\\s/+-]+\\)|[a-z]{3,24})$/i.test(fill)) {',
    '          nextOverrides[tid] = { ...(nextOverrides[tid] ?? {}), fill };',
    '          enqueueOut(step.graph, n.id, "next");',
    '        }',
    ...(variantTargets.size > 0
      ? [
          '      } else if (n.type === "action.set-variant") {',
          '        const tid = String(n.data.targetNodeId ?? "");',
          '        const axisId = String(n.data.axisId ?? "");',
          '        const optId = String(resolveIn(step.graph, n.id, "optionId", n.data.optionId ?? "") ?? "");',
          '        const compId = logicInstanceComponentById[tid];',
          '        const label = compId ? logicVariantLabels[compId]?.[axisId]?.[optId] : undefined;',
          '        if (label) {',
          '          nextOverrides[tid] = {',
          '            ...(nextOverrides[tid] ?? {}),',
          '            variants: { ...(nextOverrides[tid]?.variants ?? {}), [axisId]: label },',
          '          };',
          '          enqueueOut(step.graph, n.id, "next");',
          '        }',
        ]
      : []),
    ...(hasThemeAction
      ? [
          '      } else if (n.type === "action.set-theme") {',
          '        const themeId = String(resolveIn(step.graph, n.id, "themeId", n.data.themeId ?? "") ?? "");',
          '        if (Object.prototype.hasOwnProperty.call(logicThemeSlugById, themeId)) {',
          '          if (typeof document !== "undefined") {',
          '            const slug = logicThemeSlugById[themeId];',
          '            if (slug) document.documentElement.setAttribute("data-theme", slug);',
          '            else document.documentElement.removeAttribute("data-theme");',
          '          }',
          '          enqueueOut(step.graph, n.id, "next");',
          '        }',
        ]
      : []),
    ...(hasNavigation
      ? [
          '      } else if (n.type === "action.navigate") {',
          '        const nextRoute = String(n.data.route ?? "").trim();',
          '        if (/^(?:https?:\\/\\/|mailto:|\\/|#)/i.test(nextRoute)) {',
          '          if (typeof document !== "undefined") document.documentElement.setAttribute("data-folio-route", nextRoute);',
          '          onNavigate?.(nextRoute);',
          '          enqueueOut(step.graph, n.id, "next");',
          '        }',
        ]
      : []),
    ...(hasAnimationAction
      ? [
          '      } else if (n.type === "action.play-animation") {',
          '        const clipId = String(n.data.clipId ?? "").trim();',
          '        const animClass = logicAnimationClassById[clipId];',
          '        if (animClass && typeof document !== "undefined") {',
          '          document.documentElement.classList.remove(animClass);',
          '          void document.documentElement.offsetWidth;',
          '          document.documentElement.classList.add(animClass);',
          '          enqueueOut(step.graph, n.id, "next");',
          '        }',
        ]
      : []),
    '      }',
    '    }',
    '    setLogicState(nextVars);',
    '    setLogicOverrides(nextOverrides);',
    '  };',
  ];

  if (hasPageLoad) {
    hookLines.push('  useEffect(() => { runLogicTrigger("page-load"); }, []);');
  }
  hookLines.push('');

  return {
    hasLogic: true,
    needsUseEffect: hasPageLoad,
    hasNavigation,
    hookLines,
    getNodeEventAttrs(nodeId: string): string[] {
      const attrs: string[] = [];
      if (clickNodes.has(nodeId)) {
        attrs.push(`onClick={() => runLogicTrigger("click", ${JSON.stringify(nodeId)})}`);
      }
      if (hoverEnterNodes.has(nodeId)) {
        attrs.push(`onMouseEnter={() => runLogicTrigger("hover-enter", ${JSON.stringify(nodeId)})}`);
      }
      if (hoverLeaveNodes.has(nodeId)) {
        attrs.push(`onMouseLeave={() => runLogicTrigger("hover-leave", ${JSON.stringify(nodeId)})}`);
      }
      return attrs;
    },
    hasDynamicOverride: (nodeId: string) =>
      visibleTargets.has(nodeId)
      || textTargets.has(nodeId)
      || fillTargets.has(nodeId)
      || variantTargets.has(nodeId),
    hasDynamicVisible: (nodeId: string) => visibleTargets.has(nodeId),
    hasDynamicText: (nodeId: string) => textTargets.has(nodeId),
    hasDynamicFill: (nodeId: string) => fillTargets.has(nodeId),
    hasDynamicVariant: (nodeId: string, axisId?: string) => {
      const axes = variantTargets.get(nodeId);
      if (!axes) return false;
      return axisId ? axes.has(axisId) : axes.size > 0;
    },
  };
}
