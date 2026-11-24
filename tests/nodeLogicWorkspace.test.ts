import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import { validateProject } from '../src/core/document/validation';
import {
  createLogicConnection,
  createLogicGraph,
  createPrototypeRuntime,
  validateLogicGraphSemantics,
} from '../src/engines/prototype';
import {
  LOGIC_NODE_WIDTH,
  LOGIC_PRESETS,
  addConnectionToGraph,
  addNodeToGraph,
  addVariableToGraph,
  autoArrangeLogicGraph,
  buildLogicWirePath,
  canConnectLogicPorts,
  computeFitViewTransform,
  createInteractiveStarterProject,
  createLogicPresetGraph,
  findSnapLogicPort,
  getLogicNodeHeight,
  getLogicPortWorldPosition,
  getUsedSourceReferenceIds,
  moveNodeInGraph,
  removeConnectionFromGraph,
  removeNodeFromGraph,
  removeVariableFromGraph,
  repatchConnectionInGraph,
  updateNodeDataInGraph,
  updateVariableInGraph,
} from '../src/app/workspace/nodeLogicGraphHelpers';

describe('Node Logic Workspace Helpers & Starter Experience', () => {
  it('computes deterministic port positions and cubic Bezier paths', () => {
    const graph = createLogicGraph({ id: 'g1', name: 'Test', scope: 'page', targetId: 'page-1' });
    const withEvent = addNodeToGraph(graph, 'event.on-click', { x: 100, y: 200 });
    const withAction = addNodeToGraph(withEvent.graph, 'action.set-text', { x: 420, y: 260 });

    const outPos = getLogicPortWorldPosition(withEvent.node, 'exec');
    const inPos = getLogicPortWorldPosition(withAction.node, 'exec');

    expect(outPos).not.toBeNull();
    expect(inPos).not.toBeNull();
    expect(outPos!.x).toBeGreaterThan(withEvent.node.x);
    expect(inPos!.x).toBe(withAction.node.x);

    const path = buildLogicWirePath(outPos!, inPos!);
    expect(path.startsWith(`M ${outPos!.x} ${outPos!.y} C `)).toBe(true);
    expect(path.endsWith(`${inPos!.x} ${inPos!.y}`)).toBe(true);
  });

  it('validates port connections including direction normalization, types, duplicates, and dataflow cycles', () => {
    let graph = createLogicGraph({ id: 'g-val', name: 'Validation', scope: 'page', targetId: 'page-1' });
    const nClick = addNodeToGraph(graph, 'event.on-click', { x: 40, y: 40 });
    graph = nClick.graph;
    const nSetText = addNodeToGraph(graph, 'action.set-text', { x: 340, y: 40 });
    graph = nSetText.graph;
    const nCmpA = addNodeToGraph(graph, 'logic.compare', { x: 40, y: 220 });
    graph = nCmpA.graph;
    const nCmpB = addNodeToGraph(graph, 'logic.compare', { x: 340, y: 220 });
    graph = nCmpB.graph;
    const nTpl = addNodeToGraph(graph, 'logic.template', { x: 640, y: 220 });
    graph = nTpl.graph;
    const nBranch = addNodeToGraph(graph, 'logic.branch', { x: 920, y: 220 });
    graph = nBranch.graph;

    // Self-connection rejected
    expect(canConnectLogicPorts(graph, nClick.node.id, 'exec', nClick.node.id, 'exec').ok).toBe(false);

    // Reverse drag (input -> output) normalizes cleanly
    const reverseFlow = canConnectLogicPorts(graph, nSetText.node.id, 'exec', nClick.node.id, 'exec');
    expect(reverseFlow.ok).toBe(true);
    expect(reverseFlow.normalized?.sourceNodeId).toBe(nClick.node.id);
    expect(reverseFlow.normalized?.targetNodeId).toBe(nSetText.node.id);

    // String -> String (template -> set-text) is allowed
    const tplToText = canConnectLogicPorts(graph, nTpl.node.id, 'text', nSetText.node.id, 'text');
    expect(tplToText.ok).toBe(true);

    // String -> Boolean mismatch is rejected
    const strToBool = canConnectLogicPorts(graph, nTpl.node.id, 'text', nBranch.node.id, 'condition');
    expect(strToBool.ok).toBe(false);

    // Exec -> Data mismatch is rejected
    const execToData = canConnectLogicPorts(graph, nClick.node.id, 'exec', nSetText.node.id, 'text');
    expect(execToData.ok).toBe(false);

    // Dataflow cycle detection: nCmpA.result -> nCmpB.left, then nCmpB.result -> nCmpA.left must be rejected
    const firstWire = addConnectionToGraph(graph, nCmpA.node.id, 'result', nCmpB.node.id, 'left');
    expect(firstWire.ok).toBe(true);
    if (!firstWire.ok) return;
    graph = firstWire.graph;

    const duplicate = canConnectLogicPorts(graph, nCmpA.node.id, 'result', nCmpB.node.id, 'left');
    expect(duplicate.ok).toBe(false);

    const cycle = canConnectLogicPorts(graph, nCmpB.node.id, 'result', nCmpA.node.id, 'left');
    expect(cycle.ok).toBe(false);
    expect(cycle.reason?.toLowerCase()).toContain('circular');
  });

  it('performs immutable node, connection, and variable mutations', () => {
    let graph = createLogicGraph({ id: 'g-mut', name: 'Mutations', scope: 'page', targetId: 'page-1' });
    const n1 = addNodeToGraph(graph, 'event.on-click', { x: 20, y: 20 });
    const n2 = addNodeToGraph(n1.graph, 'action.set-text', { x: 280, y: 20 });
    graph = n2.graph;

    const wired = addConnectionToGraph(graph, n1.node.id, 'exec', n2.node.id, 'exec');
    expect(wired.ok).toBe(true);
    if (!wired.ok) return;
    expect(wired.graph.connections).toHaveLength(1);

    const moved = moveNodeInGraph(wired.graph, n1.node.id, 96, 120);
    const movedNode = moved.nodes.find((n) => n.id === n1.node.id);
    expect(movedNode?.x).toBe(96);
    expect(movedNode?.y).toBe(120);

    const patched = updateNodeDataInGraph(moved, n2.node.id, { text: 'Updated!' });
    expect(patched.nodes.find((n) => n.id === n2.node.id)?.data.text).toBe('Updated!');

    const withVar = addVariableToGraph(patched, { name: 'score', valueType: 'number', initialValue: 0 });
    expect(withVar.graph.variables).toHaveLength(1);
    const updatedVar = updateVariableInGraph(withVar.graph, withVar.variable.id, { initialValue: 42 });
    expect(updatedVar.variables?.[0].initialValue).toBe(42);
    const withoutVar = removeVariableFromGraph(updatedVar, withVar.variable.id);
    expect(withoutVar.variables).toHaveLength(0);

    const disconnected = removeConnectionFromGraph(withoutVar, wired.connection.id);
    expect(disconnected.connections).toHaveLength(0);

    // Removing a node cascades its connected wires
    const reconnected = addConnectionToGraph(disconnected, n1.node.id, 'exec', n2.node.id, 'exec');
    expect(reconnected.ok).toBe(true);
    if (!reconnected.ok) return;
    const removedNode = removeNodeFromGraph(reconnected.graph, n1.node.id);
    expect(removedNode.nodes).toHaveLength(1);
    expect(removedNode.connections).toHaveLength(0);
  });

  it('computes a bounded fit-view transform for populated and empty graphs', () => {
    const starter = createInteractiveStarterProject('Fit Test');
    const graph = starter.logicGraphs![0];
    const fit = computeFitViewTransform(graph.nodes, 960, 600);
    expect(fit.zoom).toBeGreaterThanOrEqual(0.45);
    expect(fit.zoom).toBeLessThanOrEqual(1.15);
    expect(Number.isFinite(fit.panX)).toBe(true);
    expect(Number.isFinite(fit.panY)).toBe(true);

    const empty = createLogicGraph({ id: 'empty', name: 'Empty', scope: 'page', targetId: 'page-1' });
    expect(computeFitViewTransform(empty.nodes, 960, 600)).toEqual({ panX: 48, panY: 48, zoom: 1 });
  });

  it('creates an interactive starter project that validates cleanly and executes live card interactions', () => {
    const plain = createInitialProject('First canvas');
    const starter = createInteractiveStarterProject('First canvas');

    // Visual starter artboard stays 100% identical to createInitialProject
    expect(starter.pages[0].document.nodes.map((n) => n.name)).toEqual(
      plain.pages[0].document.nodes.map((n) => n.name),
    );
    expect(starter.logicGraphs).toHaveLength(1);
    expect(validateProject(starter).ok).toBe(true);

    const graph = starter.logicGraphs![0];
    const report = validateLogicGraphSemantics(graph, starter);
    expect(report.ok).toBe(true);
    expect(report.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

    // Execute in headless PrototypeRuntime
    const runtime = createPrototypeRuntime(starter, { pageId: starter.activePageId });
    const visualCard = starter.pages[0].document.nodes.find((n) => n.name === 'Visual card')!;
    const caption = starter.pages[0].document.nodes.find((n) => n.name === 'Card caption')!;
    const sun = starter.pages[0].document.nodes.find((n) => n.name === 'Sun')!;

    // First click: clickCount -> 1, accentActive -> true, caption updates, Sun fill -> #8B7CF6
    const click1 = runtime.dispatchNodeEvent(visualCard.id, 'click');
    expect(click1.variables['var-starter-clicks']).toBe(1);
    expect(click1.variables['var-starter-accent']).toBe(true);
    expect(click1.nodeOverrides[caption.id]?.text).toBe('INTERACTIONS  ·  1');
    expect(click1.nodeOverrides[sun.id]?.fill).toBe('#8B7CF6');

    // Second click: clickCount -> 2, accentActive -> false, caption updates, Sun fill -> #F4B27D
    const click2 = runtime.dispatchNodeEvent(visualCard.id, 'click');
    expect(click2.variables['var-starter-clicks']).toBe(2);
    expect(click2.variables['var-starter-accent']).toBe(false);
    expect(click2.nodeOverrides[caption.id]?.text).toBe('INTERACTIONS  ·  2');
    expect(click2.nodeOverrides[sun.id]?.fill).toBe('#F4B27D');
  });

  it('generates valid, executable preset graphs for all built-in Logic Presets', () => {
    const project = createInitialProject('Preset Verification');
    const page = project.pages[0];

    for (const preset of LOGIC_PRESETS) {
      const graph = createLogicPresetGraph(preset.id, project, page);
      const testProject = { ...project, logicGraphs: [graph] };
      expect(validateProject(testProject).ok).toBe(true);

      const report = validateLogicGraphSemantics(graph, testProject);
      expect(report.ok).toBe(true);
      expect(report.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

      const runtime = createPrototypeRuntime(testProject, { pageId: page.id });
      const firstInteractive =
        page.document.nodes.find((n) => n.type === 'rect' || n.type === 'frame' || n.type === 'ellipse')
        ?? page.document.nodes[0];
      const snap = runtime.dispatchNodeEvent(firstInteractive.id, 'click');
      expect(snap.trace.length).toBeGreaterThan(0);
    }
  });

  it('auto-arranges messy connected, branching, and data-provider graphs without overlaps', () => {
    const starter = createInteractiveStarterProject('Arrange Starter');
    const baseGraph = starter.logicGraphs![0];

    // Scramble every node into a messy overlapping pile in reverse order
    const messyGraph = {
      ...baseGraph,
      nodes: baseGraph.nodes.map((node, index) => ({
        ...node,
        x: 500 - index * 12,
        y: 300 + (index % 2) * 8,
      })),
    };

    const arranged = autoArrangeLogicGraph(messyGraph);
    expect(arranged).not.toBe(messyGraph);
    expect(arranged.nodes).toHaveLength(messyGraph.nodes.length);
    expect(arranged.connections).toEqual(messyGraph.connections);

    // Verify zero AABB overlaps between any pair of nodes
    for (let i = 0; i < arranged.nodes.length; i += 1) {
      const a = arranged.nodes[i];
      const aH = getLogicNodeHeight(a);
      for (let j = i + 1; j < arranged.nodes.length; j += 1) {
        const b = arranged.nodes[j];
        const bH = getLogicNodeHeight(b);
        const overlaps =
          a.x < b.x + LOGIC_NODE_WIDTH
          && a.x + LOGIC_NODE_WIDTH > b.x
          && a.y < b.y + bH
          && a.y + aH > b.y;
        expect(overlaps).toBe(false);
      }
    }

    // Verify strictly left-to-right flow for every connection in this DAG
    const nodeMap = new Map(arranged.nodes.map((n) => [n.id, n]));
    for (const conn of arranged.connections) {
      const src = nodeMap.get(conn.sourceNodeId)!;
      const tgt = nodeMap.get(conn.targetNodeId)!;
      expect(src.x + LOGIC_NODE_WIDTH).toBeLessThan(tgt.x);
    }

    // Verify upstream data provider (logic.template) is aligned right before action.set-text
    const tpl = arranged.nodes.find((n) => n.type === 'logic.template')!;
    const setText = arranged.nodes.find((n) => n.type === 'action.set-text')!;
    const evt = arranged.nodes.find((n) => n.type === 'event.on-click')!;
    expect(tpl.x).toBeGreaterThan(evt.x);
    expect(tpl.x).toBeLessThan(setText.x);

    // Verify semantic validity is preserved and second run is idempotent (same reference)
    const arrangedProject = { ...starter, logicGraphs: [arranged] };
    expect(validateLogicGraphSemantics(arranged, arrangedProject).ok).toBe(true);
    expect(autoArrangeLogicGraph(arranged)).toBe(arranged);
  });

  it('auto-arranges disconnected nodes into a non-overlapping grid below connected flows', () => {
    let graph = createLogicGraph({ id: 'g-disc', name: 'Disconnected', scope: 'page', targetId: 'page-1' });
    const nEvt = addNodeToGraph(graph, 'event.on-click', { x: 400, y: 400 });
    const nAct = addNodeToGraph(nEvt.graph, 'action.set-text', { x: 100, y: 400 });
    const wired = addConnectionToGraph(nAct.graph, nEvt.node.id, 'exec', nAct.node.id, 'exec');
    expect(wired.ok).toBe(true);
    if (!wired.ok) return;
    graph = wired.graph;

    // Add 4 disconnected nodes stacked right on top of each other
    const disc1 = addNodeToGraph(graph, 'state.get', { x: 0, y: 0 });
    const disc2 = addNodeToGraph(disc1.graph, 'logic.compare', { x: 0, y: 0 });
    const disc3 = addNodeToGraph(disc2.graph, 'action.set-fill', { x: 0, y: 0 });
    const disc4 = addNodeToGraph(disc3.graph, 'event.on-page-load', { x: 0, y: 0 });
    graph = disc4.graph;

    const arranged = autoArrangeLogicGraph(graph);
    const byId = new Map(arranged.nodes.map((n) => [n.id, n]));
    const connectedBottom = Math.max(
      byId.get(nEvt.node.id)!.y + getLogicNodeHeight(byId.get(nEvt.node.id)!),
      byId.get(nAct.node.id)!.y + getLogicNodeHeight(byId.get(nAct.node.id)!),
    );

    const isolatedIds = [disc1.node.id, disc2.node.id, disc3.node.id, disc4.node.id];
    for (const id of isolatedIds) {
      expect(byId.get(id)!.y).toBeGreaterThan(connectedBottom);
    }

    // Zero overlaps across all 6 nodes
    for (let i = 0; i < arranged.nodes.length; i += 1) {
      const a = arranged.nodes[i];
      const aH = getLogicNodeHeight(a);
      for (let j = i + 1; j < arranged.nodes.length; j += 1) {
        const b = arranged.nodes[j];
        const bH = getLogicNodeHeight(b);
        const overlaps =
          a.x < b.x + LOGIC_NODE_WIDTH
          && a.x + LOGIC_NODE_WIDTH > b.x
          && a.y < b.y + bH
          && a.y + aH > b.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('handles cyclic graphs and empty graphs safely during auto-arrange', () => {
    const empty = createLogicGraph({ id: 'g-empty', name: 'Empty', scope: 'page', targetId: 'page-1' });
    expect(autoArrangeLogicGraph(empty)).toBe(empty);

    let cyclic = createLogicGraph({ id: 'g-cyc', name: 'Cyclic', scope: 'page', targetId: 'page-1' });
    const a = addNodeToGraph(cyclic, 'state.increment', { x: 10, y: 10 });
    const b = addNodeToGraph(a.graph, 'state.toggle', { x: 10, y: 10 });
    const c = addNodeToGraph(b.graph, 'action.set-text', { x: 10, y: 10 });
    cyclic = {
      ...c.graph,
      connections: [
        createLogicConnection({ id: 'c1', sourceNodeId: a.node.id, sourcePortId: 'next', targetNodeId: b.node.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c2', sourceNodeId: b.node.id, sourcePortId: 'next', targetNodeId: c.node.id, targetPortId: 'exec' }),
        createLogicConnection({ id: 'c3', sourceNodeId: c.node.id, sourcePortId: 'next', targetNodeId: a.node.id, targetPortId: 'exec' }),
      ],
    };

    const arranged = autoArrangeLogicGraph(cyclic);
    expect(arranged.connections).toHaveLength(3);
    for (const node of arranged.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    // All 3 nodes occupy distinct non-overlapping positions
    for (let i = 0; i < arranged.nodes.length; i += 1) {
      const n1 = arranged.nodes[i];
      const h1 = getLogicNodeHeight(n1);
      for (let j = i + 1; j < arranged.nodes.length; j += 1) {
        const n2 = arranged.nodes[j];
        const h2 = getLogicNodeHeight(n2);
        const overlaps =
          n1.x < n2.x + LOGIC_NODE_WIDTH
          && n1.x + LOGIC_NODE_WIDTH > n2.x
          && n1.y < n2.y + h2
          && n1.y + h1 > n2.y;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('tracks used source reference IDs per source type and excludes the current node when editing', () => {
    let graph = createLogicGraph({ id: 'g-src', name: 'Sources', scope: 'page', targetId: 'page-1' });
    const p1 = addNodeToGraph(graph, 'source.page', { x: 40, y: 40 }, { pageId: 'page-home' });
    const p2 = addNodeToGraph(p1.graph, 'source.page', { x: 40, y: 220 }, { pageId: 'page-about' });
    const c1 = addNodeToGraph(p2.graph, 'source.component', { x: 40, y: 400 }, { componentId: 'comp-btn' });
    graph = c1.graph;

    expect(Array.from(getUsedSourceReferenceIds(graph, 'source.page'))).toEqual(['page-home', 'page-about']);
    expect(Array.from(getUsedSourceReferenceIds(graph, 'source.page', p1.node.id))).toEqual(['page-about']);
    expect(Array.from(getUsedSourceReferenceIds(graph, 'source.page', p2.node.id))).toEqual(['page-home']);
    expect(Array.from(getUsedSourceReferenceIds(graph, 'source.component'))).toEqual(['comp-btn']);
    expect(Array.from(getUsedSourceReferenceIds(graph, 'source.component', c1.node.id))).toEqual([]);
  });

  it('snaps drag-and-patch wires magnetically to nearest compatible socket and supports clean re-patching', () => {
    let graph = createLogicGraph({ id: 'g-patch', name: 'Patch', scope: 'page', targetId: 'page-1' });
    const srcComp = addNodeToGraph(graph, 'source.component', { x: 40, y: 40 }, { componentId: 'comp-1' });
    const actA = addNodeToGraph(srcComp.graph, 'action.set-text', { x: 360, y: 40 });
    const actB = addNodeToGraph(actA.graph, 'action.navigate', { x: 360, y: 240 });
    graph = actB.graph;

    // Source node uses 34px picker subheader, so port Y accounts for 38 + 34 + 8 + 13 = 93
    const srcOutPos = getLogicPortWorldPosition(srcComp.node, 'onClick');
    expect(srcOutPos).toEqual({ x: 40 + LOGIC_NODE_WIDTH, y: 40 + 38 + 34 + 8 + 13 });

    const actAInPos = getLogicPortWorldPosition(actA.node, 'exec')!;
    const actBInPos = getLogicPortWorldPosition(actB.node, 'exec')!;

    // Drag pointer within 28px of actA.exec snaps onto actA.exec
    const snapA = findSnapLogicPort(
      graph,
      graph.nodes,
      srcComp.node.id,
      'onClick',
      { x: actAInPos.x + 10, y: actAInPos.y - 8 },
      28,
    );
    expect(snapA?.nodeId).toBe(actA.node.id);
    expect(snapA?.portId).toBe('exec');

    // Drag pointer far away returns null
    const snapNone = findSnapLogicPort(graph, graph.nodes, srcComp.node.id, 'onClick', { x: 900, y: 900 }, 28);
    expect(snapNone).toBeNull();

    // Connect srcComp.onClick -> actA.exec
    const wired = addConnectionToGraph(graph, srcComp.node.id, 'onClick', actA.node.id, 'exec');
    expect(wired.ok).toBe(true);
    if (!wired.ok) return;
    graph = wired.graph;

    // While dragging the detached wire, snapping ignores the detached connection and snaps onto actB.exec
    const snapB = findSnapLogicPort(
      graph,
      graph.nodes,
      srcComp.node.id,
      'onClick',
      { x: actBInPos.x - 6, y: actBInPos.y + 4 },
      28,
      wired.connection.id,
    );
    expect(snapB?.nodeId).toBe(actB.node.id);
    expect(snapB?.portId).toBe('exec');

    // Re-patch wire cleanly from actA.exec to actB.exec
    const repatched = repatchConnectionInGraph(graph, wired.connection.id, actB.node.id, 'exec');
    expect(repatched.ok).toBe(true);
    if (!repatched.ok) return;
    expect(repatched.graph.connections).toHaveLength(1);
    expect(repatched.graph.connections[0].targetNodeId).toBe(actB.node.id);
    expect(repatched.graph.connections[0].targetPortId).toBe('exec');

    // Auto-arrange places source node to the left of connected action node
    const arranged = autoArrangeLogicGraph(repatched.graph);
    const arrangedSrc = arranged.nodes.find((n) => n.id === srcComp.node.id)!;
    const arrangedActB = arranged.nodes.find((n) => n.id === actB.node.id)!;
    expect(arrangedSrc.x + LOGIC_NODE_WIDTH).toBeLessThan(arrangedActB.x);
  });
});
