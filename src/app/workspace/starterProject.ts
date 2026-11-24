/**
 * Lightweight first-launch starter project factory for Folio Studio.
 *
 * Kept separate from `nodeLogicGraphHelpers.ts` (~44 KB) so initial app startup
 * does not pull the full Node Logic graph editor into the critical bundle.
 */

import { createInitialProject } from '../../core/document/factory';
import { getActivePage } from '../../core/document/project';
import type {
  FolioPage,
  FolioProject,
  LogicConnection,
  LogicGraph,
  LogicNode,
} from '../../core/document/types';
import {
  createLogicConnection,
  createLogicGraph,
  createLogicNode,
  createLogicVariable,
} from '../../engines/prototype';
import { createStarterHeroEntranceClip } from '../../engines/animation';

/**
 * Builds the default interactive starter logic graph wired directly to the
 * starter Main Page layers (`Visual card`, `Sun`, and `Card caption`).
 */
export function createStarterMainPageLogicGraph(page: FolioPage): LogicGraph | null {
  const visualCard = page.document.nodes.find((n) => n.name === 'Visual card')
    ?? page.document.nodes.find((n) => n.type === 'rect' || n.type === 'frame');
  const sun = page.document.nodes.find((n) => n.name === 'Sun')
    ?? page.document.nodes.find((n) => n.type === 'ellipse');
  const caption = page.document.nodes.find((n) => n.name === 'Card caption')
    ?? page.document.nodes.find((n) => n.type === 'text');

  if (!visualCard || !caption) return null;

  const varClicks = createLogicVariable({
    id: 'var-starter-clicks',
    name: 'clickCount',
    valueType: 'number',
    initialValue: 0,
    description: 'Tracks clicks on the starter artwork card.',
  });
  const varAccent = createLogicVariable({
    id: 'var-starter-accent',
    name: 'accentActive',
    valueType: 'boolean',
    initialValue: false,
    description: 'Toggles the Sun accent highlight on each click.',
  });

  const onClick = createLogicNode({
    id: 'lnode-starter-click',
    type: 'event.on-click',
    x: 40,
    y: 72,
    data: { targetNodeId: visualCard.id, mode: 'click' },
  });
  const incCount = createLogicNode({
    id: 'lnode-starter-inc',
    type: 'state.update',
    x: 320,
    y: 44,
    data: { variableId: varClicks.id, operation: 'increment', step: 1, min: 0, max: 999 },
  });
  const toggleAccent = createLogicNode({
    id: 'lnode-starter-toggle',
    type: 'state.toggle',
    x: 600,
    y: 44,
    data: { variableId: varAccent.id },
  });
  const template = createLogicNode({
    id: 'lnode-starter-tpl',
    type: 'logic.text',
    x: 600,
    y: 230,
    data: { mode: 'template', template: 'INTERACTIONS  ·  {{clickCount}}' },
  });
  const setCaption = createLogicNode({
    id: 'lnode-starter-text',
    type: 'action.set-layer',
    x: 890,
    y: 72,
    data: { targetNodeId: caption.id, property: 'text', text: '' },
  });

  const nodes: LogicNode[] = [onClick, incCount, toggleAccent, template, setCaption];
  const connections: LogicConnection[] = [
    createLogicConnection({
      id: 'lconn-starter-1',
      sourceNodeId: onClick.id,
      sourcePortId: 'exec',
      targetNodeId: incCount.id,
      targetPortId: 'exec',
    }),
    createLogicConnection({
      id: 'lconn-starter-2',
      sourceNodeId: incCount.id,
      sourcePortId: 'next',
      targetNodeId: toggleAccent.id,
      targetPortId: 'exec',
    }),
    createLogicConnection({
      id: 'lconn-starter-3',
      sourceNodeId: toggleAccent.id,
      sourcePortId: 'next',
      targetNodeId: setCaption.id,
      targetPortId: 'exec',
    }),
    createLogicConnection({
      id: 'lconn-starter-4',
      sourceNodeId: template.id,
      sourcePortId: 'text',
      targetNodeId: setCaption.id,
      targetPortId: 'value',
    }),
  ];

  if (sun) {
    const getAccent = createLogicNode({
      id: 'lnode-starter-get-accent',
      type: 'state.get',
      x: 890,
      y: 248,
      data: { variableId: varAccent.id },
    });
    const branch = createLogicNode({
      id: 'lnode-starter-branch',
      type: 'logic.branch',
      x: 1170,
      y: 72,
      data: { mode: 'if-else', condition: false },
    });
    const fillIndigo = createLogicNode({
      id: 'lnode-starter-fill-indigo',
      type: 'action.set-layer',
      x: 1450,
      y: 20,
      data: { targetNodeId: sun.id, property: 'fill', fill: '#8B7CF6', transitionMs: 240 },
    });
    const fillAmber = createLogicNode({
      id: 'lnode-starter-fill-amber',
      type: 'action.set-layer',
      x: 1450,
      y: 196,
      data: { targetNodeId: sun.id, property: 'fill', fill: '#F4B27D', transitionMs: 240 },
    });

    nodes.push(getAccent, branch, fillIndigo, fillAmber);
    connections.push(
      createLogicConnection({
        id: 'lconn-starter-5',
        sourceNodeId: setCaption.id,
        sourcePortId: 'next',
        targetNodeId: branch.id,
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'lconn-starter-6',
        sourceNodeId: getAccent.id,
        sourcePortId: 'value',
        targetNodeId: branch.id,
        targetPortId: 'condition',
      }),
      createLogicConnection({
        id: 'lconn-starter-7',
        sourceNodeId: branch.id,
        sourcePortId: 'true',
        targetNodeId: fillIndigo.id,
        targetPortId: 'exec',
      }),
      createLogicConnection({
        id: 'lconn-starter-8',
        sourceNodeId: branch.id,
        sourcePortId: 'false',
        targetNodeId: fillAmber.id,
        targetPortId: 'exec',
      }),
    );
  }

  return createLogicGraph({
    id: 'logic-graph-starter-main',
    name: 'Main Page Interactions',
    scope: 'page',
    targetId: page.id,
    variables: [varClicks, varAccent],
    nodes,
    connections,
  });
}

/**
 * Creates the default interactive starter project for first-launch Folio Studio
 * sessions while keeping `createInitialProject()` untouched for unit tests.
 */
export function createInteractiveStarterProject(name = 'First canvas'): FolioProject {
  const project = createInitialProject(name);
  const page = getActivePage(project);
  const starterGraph = createStarterMainPageLogicGraph(page);
  const starterClip = createStarterHeroEntranceClip(page);
  return {
    ...project,
    ...(starterGraph ? { logicGraphs: [starterGraph] } : {}),
    ...(starterClip.tracks.length > 0 ? { animations: [starterClip] } : {}),
  };
}
