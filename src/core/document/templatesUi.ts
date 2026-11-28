import {
  FONT_BODY,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_SANS,
  LogicGraphBuilder,
  TemplateBuilder,
  makeDropShadow,
  makeEllipse,
  makeFrame,
  makeLinearGradient,
  makeRect,
  makeText,
  type StudioTemplateDefinition,
  type TemplateBuiltBundle,
  type TemplateIdFactory,
  type TemplateOrigin,
} from './templatesHelpers';

function buildTemplateDef(
  meta: Omit<StudioTemplateDefinition, 'buildNodes' | 'buildBundle'>,
  builder: (
    origin: TemplateOrigin,
    makeId: TemplateIdFactory,
    logicTarget?: { scope: 'page' | 'component'; targetId: string },
  ) => TemplateBuiltBundle,
): StudioTemplateDefinition {
  return {
    ...meta,
    buildNodes: (origin, makeId) => builder(origin, makeId).nodes,
    buildBundle: builder,
  };
}

export const UI_COMPONENT_TEMPLATES: readonly StudioTemplateDefinition[] = [
  // 1. Interactive Launch Button (click counter + dynamic label + toast)
  buildTemplateDef(
    {
      id: 'ui-action-button',
      name: 'Interactive Action Button',
      category: 'ui',
      summary: 'Gradient CTA button wired with click counter state, dynamic label formatting, and toast feedback.',
      keywords: ['button', 'cta', 'primary', 'action', 'click', 'counter', 'interactive', 'ui'],
      width: 248,
      height: 54,
      previewSurface: 'dark',
      logicHighlights: ['Click counter state', 'Live label formatting', 'Success toast'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('btn-root'), 'Interactive Action Button', x, y, 248, 54, {
          fill: '#2563EB',
          fills: [
            makeLinearGradient(makeId('grad'), 135, [
              { offset: 0, color: '#2563EB' },
              { offset: 1, color: '#4F46E5' },
            ]),
          ],
          stroke: '#60A5FA',
          strokeWidth: 1,
          radius: 12,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#1D4ED8',
          hoverStroke: '#93C5FD',
          transition: 'all 180ms cubic-bezier(0.22, 1, 0.36, 1)',
          effects: [makeDropShadow(makeId('sh'), 10, 24, 'rgba(37, 99, 235, 0.35)')],
        }),
      );

      const label = b.add(
        'label',
        makeText(makeId('btn-label'), 'Button Label', 'Deploy Release', x + 22, y + 16, 152, 22, {
          parentId: root.id,
          fill: '#FFFFFF',
          fontSize: 15,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          cursor: 'pointer',
        }),
      );

      const badgeBg = b.add(
        'badgeBg',
        makeRect(makeId('btn-badge-bg'), 'Count Chip', x + 184, y + 13, 48, 28, {
          parentId: root.id,
          fill: '#1E3A8A',
          stroke: '#60A5FA',
          strokeWidth: 1,
          radius: 8,
          cursor: 'pointer',
        }),
      );

      const badgeText = b.add(
        'badgeText',
        makeText(makeId('btn-badge-txt'), 'Count Readout', '0×', x + 184, y + 18, 48, 18, {
          parentId: root.id,
          fill: '#E0F2FE',
          fontSize: 12,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Action Button Logic', logicTarget.scope, logicTarget.targetId);
        const clicksVar = g.variable('clicks', 'deployCount', 'number', 0);

        const onClick = g.node('click', 'event.on-click', 0, 0, { targetNodeId: root.id }, 'Click Button');
        const inc = g.node(
          'inc',
          'state.update',
          1,
          0,
          { variableId: clicksVar, operation: 'increment', step: 1, min: 0, max: 99 },
          'Increment Count',
        );
        const fmtChip = g.node('fmt-chip', 'logic.text', 1, 1, { mode: 'template', template: '{{deployCount}}×' }, 'Format Chip');
        const fmtToast = g.node(
          'fmt-toast',
          'logic.text',
          2,
          1,
          { mode: 'template', template: 'Deployment #{{deployCount}} queued cleanly.' },
          'Format Toast',
        );
        const setBadge = g.node(
          'set-badge',
          'action.set-layer',
          2,
          0,
          { targetNodeId: badgeText.id, property: 'text', text: '1×' },
          'Update Count Chip',
        );
        const setLabel = g.node(
          'set-label',
          'action.set-layer',
          3,
          0,
          { targetNodeId: label.id, property: 'text', text: 'Deployed ✓' },
          'Confirm Label',
        );
        const setChipFill = g.node(
          'set-chip-fill',
          'action.set-layer',
          4,
          0,
          { targetNodeId: badgeBg.id, property: 'fill', fill: '#0F766E' },
          'Highlight Chip',
        );
        const toast = g.node(
          'toast',
          'action.overlay-toast',
          5,
          0,
          { mode: 'show-toast', tone: 'success', message: 'Deployment queued.' },
          'Show Toast',
        );

        g.chain([onClick, inc, setBadge, setLabel, setChipFill, toast]);
        g.connect(fmtChip, 'text', setBadge, 'value');
        g.connect(fmtToast, 'text', toast, 'message');
        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 2. Interactive Toggle Switch Card (boolean state + sliding knob + live status)
  buildTemplateDef(
    {
      id: 'ui-smart-toggle',
      name: 'Smart Toggle Switch Card',
      category: 'ui',
      summary: 'Interactive setting card with animated switch knob, live ON/OFF state readout, and toast notification.',
      keywords: ['toggle', 'switch', 'boolean', 'settings', 'preference', 'interactive', 'ui'],
      width: 344,
      height: 86,
      previewSurface: 'light',
      logicHighlights: ['Boolean state toggle', 'Animated knob slide', 'Live status & toast'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('tgl-root'), 'Smart Toggle Card', x, y, 344, 86, {
          fill: '#FFFFFF',
          stroke: '#E2E8F0',
          strokeWidth: 1,
          radius: 14,
          effects: [makeDropShadow(makeId('sh'), 8, 24, 'rgba(15, 23, 42, 0.08)')],
        }),
      );

      b.add(
        'title',
        makeText(makeId('tgl-title'), 'Setting Title', 'Auto-Sync Edge Cache', x + 20, y + 18, 210, 22, {
          parentId: root.id,
          fill: '#0F172A',
          fontSize: 15,
          fontWeight: 700,
          fontFamily: FONT_SANS,
        }),
      );

      const status = b.add(
        'status',
        makeText(makeId('tgl-status'), 'Status Subtitle', 'Active · Revalidates every 30s', x + 20, y + 44, 224, 20, {
          parentId: root.id,
          fill: '#0F766E',
          fontSize: 12.5,
          fontWeight: 500,
          fontFamily: FONT_BODY,
        }),
      );

      const track = b.add(
        'track',
        makeRect(makeId('tgl-track'), 'Switch Track', x + 268, y + 28, 56, 30, {
          parentId: root.id,
          fill: '#0D9488',
          radius: 15,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'background-color 200ms cubic-bezier(0.22, 1, 0.36, 1)',
        }),
      );

      const knob = b.add(
        'knob',
        makeEllipse(makeId('tgl-knob'), 'Switch Knob', x + 296, y + 31, 24, 24, {
          parentId: root.id,
          fill: '#FFFFFF',
          cursor: 'pointer',
          transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
          effects: [makeDropShadow(makeId('ksh'), 2, 6, 'rgba(15, 23, 42, 0.2)')],
        }),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Smart Toggle Logic', logicTarget.scope, logicTarget.targetId);
        const enabledVar = g.variable('enabled', 'autoSyncEnabled', 'boolean', true);

        const onClick = g.node('click', 'event.on-click', 0, 0, { targetNodeId: track.id }, 'Click Switch');
        const toggle = g.node('toggle', 'state.toggle', 1, 0, { variableId: enabledVar }, 'Toggle State');
        const branch = g.node('branch', 'logic.branch', 2, 0, { mode: 'if-else' }, 'If Enabled');

        // TRUE branch
        const trackOn = g.node('track-on', 'action.set-layer', 3, 0, { targetNodeId: track.id, property: 'fill', fill: '#0D9488' }, 'Track ON');
        const knobOn = g.node('knob-on', 'action.set-layer', 4, 0, { targetNodeId: knob.id, property: 'transform', transform: 'translateX(0px)' }, 'Knob Right');
        const txtOn = g.node('txt-on', 'action.set-layer', 5, 0, { targetNodeId: status.id, property: 'text', text: 'Active · Revalidates every 30s' }, 'Status ON');
        const toastOn = g.node('toast-on', 'action.overlay-toast', 6, 0, { mode: 'show-toast', tone: 'success', message: 'Edge cache auto-sync enabled.' }, 'Toast ON');

        // FALSE branch
        const trackOff = g.node('track-off', 'action.set-layer', 3, 1, { targetNodeId: track.id, property: 'fill', fill: '#CBD5E1' }, 'Track OFF');
        const knobOff = g.node('knob-off', 'action.set-layer', 4, 1, { targetNodeId: knob.id, property: 'transform', transform: 'translateX(-24px)' }, 'Knob Left');
        const txtOff = g.node('txt-off', 'action.set-layer', 5, 1, { targetNodeId: status.id, property: 'text', text: 'Paused · Manual deploy only' }, 'Status OFF');
        const toastOff = g.node('toast-off', 'action.overlay-toast', 6, 1, { mode: 'show-toast', tone: 'info', message: 'Edge cache auto-sync paused.' }, 'Toast OFF');

        g.chain([onClick, toggle, branch]);
        g.connect(toggle, 'result', branch, 'condition');

        g.connect(branch, 'true', trackOn, 'exec');
        g.chain([trackOn, knobOn, txtOn, toastOn], 'next');

        g.connect(branch, 'false', trackOff, 'exec');
        g.chain([trackOff, knobOff, txtOff, toastOff], 'next');
        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 3. Live Quantity & Price Stepper (clamped +/- math + live USD currency format + reset)
  buildTemplateDef(
    {
      id: 'ui-quantity-stepper',
      name: 'Live Quantity & Total Stepper',
      category: 'ui',
      summary: 'Seat/cart quantity stepper with clamped +/- controls, real-time multiplication, and formatted currency total.',
      keywords: ['stepper', 'counter', 'quantity', 'cart', 'price', 'math', 'currency', 'ui'],
      width: 344,
      height: 144,
      previewSurface: 'light',
      logicHighlights: ['Clamped +/- state', 'Live subtotal math', 'Currency formatting & Reset'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('stp-root'), 'Quantity Stepper Card', x, y, 344, 144, {
          fill: '#FFFFFF',
          stroke: '#E2E8F0',
          strokeWidth: 1,
          radius: 16,
          effects: [makeDropShadow(makeId('sh'), 10, 28, 'rgba(15, 23, 42, 0.08)')],
        }),
      );

      b.add(
        'title',
        makeText(makeId('stp-title'), 'Item Title', 'Team Editor Seats', x + 20, y + 18, 200, 22, {
          parentId: root.id,
          fill: '#0F172A',
          fontSize: 15,
          fontWeight: 700,
          fontFamily: FONT_SANS,
        }),
      );

      b.add(
        'unitPrice',
        makeText(makeId('stp-unit'), 'Unit Price', '$49 / seat / month', x + 20, y + 40, 180, 18, {
          parentId: root.id,
          fill: '#64748B',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: FONT_BODY,
        }),
      );

      const resetBtn = b.add(
        'resetBtn',
        makeText(makeId('stp-reset'), 'Reset Button', 'Reset', x + 276, y + 20, 48, 20, {
          parentId: root.id,
          fill: '#4F46E5',
          fontSize: 12,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'right',
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );

      // Stepper row
      const minusBtn = b.add(
        'minusBtn',
        makeRect(makeId('stp-minus'), 'Decrease Button', x + 20, y + 80, 40, 40, {
          parentId: root.id,
          fill: '#F1F5F9',
          stroke: '#CBD5E1',
          strokeWidth: 1,
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#E2E8F0',
        }),
      );
      b.add(
        'minusTxt',
        makeText(makeId('stp-minus-txt'), 'Minus Symbol', '−', x + 20, y + 88, 40, 24, {
          parentId: root.id,
          fill: '#0F172A',
          fontSize: 18,
          fontWeight: 700,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const qtyText = b.add(
        'qtyText',
        makeText(makeId('stp-qty'), 'Quantity Readout', '2', x + 68, y + 88, 48, 26, {
          parentId: root.id,
          fill: '#0F172A',
          fontSize: 18,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          textAlign: 'center',
        }),
      );

      const plusBtn = b.add(
        'plusBtn',
        makeRect(makeId('stp-plus'), 'Increase Button', x + 124, y + 80, 40, 40, {
          parentId: root.id,
          fill: '#0F172A',
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#1E293B',
        }),
      );
      b.add(
        'plusTxt',
        makeText(makeId('stp-plus-txt'), 'Plus Symbol', '+', x + 124, y + 88, 40, 24, {
          parentId: root.id,
          fill: '#FFFFFF',
          fontSize: 18,
          fontWeight: 700,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      b.add(
        'totalLabel',
        makeText(makeId('stp-total-lbl'), 'Total Label', 'Subtotal', x + 204, y + 76, 120, 16, {
          parentId: root.id,
          fill: '#64748B',
          fontSize: 11,
          fontWeight: 600,
          textAlign: 'right',
        }),
      );

      const totalText = b.add(
        'totalText',
        makeText(makeId('stp-total'), 'Subtotal Amount', '$98.00', x + 194, y + 94, 130, 28, {
          parentId: root.id,
          fill: '#0F172A',
          fontSize: 21,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          textAlign: 'right',
        }),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Quantity Stepper Logic', logicTarget.scope, logicTarget.targetId);
        const qtyVar = g.variable('qty', 'seatCount', 'number', 2);

        const onPlus = g.node('on-plus', 'event.on-click', 0, 0, { targetNodeId: plusBtn.id }, 'Click +');
        const inc = g.node('inc', 'state.update', 1, 0, { variableId: qtyVar, operation: 'increment', step: 1, min: 1, max: 25 }, 'Increment Seat');

        const onMinus = g.node('on-minus', 'event.on-click', 0, 1, { targetNodeId: minusBtn.id }, 'Click -');
        const dec = g.node('dec', 'state.update', 1, 1, { variableId: qtyVar, operation: 'increment', step: -1, min: 1, max: 25 }, 'Decrement Seat');

        const onReset = g.node('on-reset', 'event.on-click', 0, 2, { targetNodeId: resetBtn.id }, 'Click Reset');
        const rst = g.node('rst', 'state.update', 1, 2, { variableId: qtyVar, operation: 'reset' }, 'Reset Seats');

        const getQty = g.node('get-qty', 'state.get', 2, 2, { variableId: qtyVar }, 'Read seatCount');
        const fmtQty = g.node('fmt-qty', 'logic.text', 2, 1, { mode: 'template', template: '{{seatCount}}' }, 'Format Qty');
        const mult = g.node('mult', 'logic.math', 3, 2, { operation: '*', b: 49 }, 'Seats × $49');
        const fmtUsd = g.node('fmt-usd', 'logic.text', 4, 2, { mode: 'format-currency', currency: 'USD', decimals: 2 }, 'Format USD');

        const setQty = g.node('set-qty', 'action.set-layer', 3, 0, { targetNodeId: qtyText.id, property: 'text', text: '2' }, 'Update Qty Display');
        const setTotal = g.node('set-total', 'action.set-layer', 4, 0, { targetNodeId: totalText.id, property: 'text', text: '$98.00' }, 'Update Subtotal');

        g.connect(onPlus, 'exec', inc, 'exec');
        g.connect(onMinus, 'exec', dec, 'exec');
        g.connect(onReset, 'exec', rst, 'exec');

        g.connect(inc, 'next', setQty, 'exec');
        g.connect(dec, 'next', setQty, 'exec');
        g.connect(rst, 'next', setQty, 'exec');

        g.connect(fmtQty, 'text', setQty, 'value');
        g.connect(setQty, 'next', setTotal, 'exec');
        g.connect(getQty, 'value', mult, 'a');
        g.connect(mult, 'result', fmtUsd, 'value');
        g.connect(fmtUsd, 'text', setTotal, 'value');

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 4. Interactive 3-Tab Switcher Card (3 tabs updating active indicator, heading, body, and metric)
  buildTemplateDef(
    {
      id: 'ui-segmented-tabs',
      name: 'Interactive 3-Tab Switcher Card',
      category: 'ui',
      summary: 'Segmented 3-tab panel that switches active tab styling, headline, body copy, and metric spec via Node Logic.',
      keywords: ['tabs', 'segmented', 'switcher', 'panel', 'navigation', 'interactive', 'ui'],
      width: 448,
      height: 220,
      previewSurface: 'light',
      logicHighlights: ['3-tab state switching', 'Active tab highlight', 'Dynamic content panel'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('tab-root'), 'Segmented Tabs Card', x, y, 448, 220, {
          fill: '#FFFFFF',
          stroke: '#E2E8F0',
          strokeWidth: 1,
          radius: 16,
          effects: [makeDropShadow(makeId('sh'), 12, 30, 'rgba(15, 23, 42, 0.08)')],
        }),
      );

      // Tab rail
      b.add(
        'rail',
        makeRect(makeId('tab-rail'), 'Tab Bar Track', x + 20, y + 20, 408, 42, {
          parentId: root.id,
          fill: '#F1F5F9',
          radius: 10,
        }),
      );

      const tab1Bg = b.add(
        'tab1Bg',
        makeRect(makeId('tab-1-bg'), 'Tab 1 (Overview)', x + 24, y + 24, 130, 34, {
          parentId: root.id,
          fill: '#0F172A',
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add(
        'tab1Txt',
        makeText(makeId('tab-1-txt'), 'Tab 1 Label', 'Overview', x + 24, y + 32, 130, 18, {
          parentId: root.id,
          fill: '#F8FAFC',
          fontSize: 12.5,
          fontWeight: 600,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const tab2Bg = b.add(
        'tab2Bg',
        makeRect(makeId('tab-2-bg'), 'Tab 2 (Specs)', x + 159, y + 24, 130, 34, {
          parentId: root.id,
          fill: '#E2E8F0',
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add(
        'tab2Txt',
        makeText(makeId('tab-2-txt'), 'Tab 2 Label', 'Architecture', x + 159, y + 32, 130, 18, {
          parentId: root.id,
          fill: '#334155',
          fontSize: 12.5,
          fontWeight: 600,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const tab3Bg = b.add(
        'tab3Bg',
        makeRect(makeId('tab-3-bg'), 'Tab 3 (SLA)', x + 294, y + 24, 130, 34, {
          parentId: root.id,
          fill: '#E2E8F0',
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add(
        'tab3Txt',
        makeText(makeId('tab-3-txt'), 'Tab 3 Label', 'Reliability', x + 294, y + 32, 130, 18, {
          parentId: root.id,
          fill: '#334155',
          fontSize: 12.5,
          fontWeight: 600,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const panelTitle = b.add(
        'panelTitle',
        makeText(makeId('tab-title'), 'Panel Headline', 'Zero-Config Visual Sync', x + 24, y + 82, 400, 26, {
          parentId: root.id,
          fill: '#0F172A',
          fontSize: 18,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );

      const panelBody = b.add(
        'panelBody',
        makeText(
          makeId('tab-body'),
          'Panel Description',
          'Design tokens, visual layers, and interactive logic stay synchronized in one unified project graph.',
          x + 24,
          y + 112,
          400,
          46,
          {
            parentId: root.id,
            fill: '#475569',
            fontSize: 13.5,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.5,
          },
        ),
      );

      const panelMeta = b.add(
        'panelMeta',
        makeText(makeId('tab-meta'), 'Panel Spec Metric', 'SYNC LATENCY · < 12ms · UNIFIED AST', x + 24, y + 178, 400, 20, {
          parentId: root.id,
          fill: '#4F46E5',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 0.4,
        }),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Segmented Tabs Logic', logicTarget.scope, logicTarget.targetId);
        const tabVar = g.variable('tab', 'activeTab', 'string', 'overview');

        const tabs = [
          {
            key: 'overview',
            triggerId: tab1Bg.id,
            row: 0,
            title: 'Zero-Config Visual Sync',
            body: 'Design tokens, visual layers, and interactive logic stay synchronized in one unified project graph.',
            meta: 'SYNC LATENCY · < 12ms · UNIFIED AST',
            fills: ['#0F172A', '#E2E8F0', '#E2E8F0'],
          },
          {
            key: 'architecture',
            triggerId: tab2Bg.id,
            row: 1,
            title: 'Deterministic Native AST Engine',
            body: 'Every canvas mutation routes through typed commands with atomic Undo/Redo and clean React/HTML output.',
            meta: 'SCHEMA · .FLOP V2 · ZERO DRIFT',
            fills: ['#E2E8F0', '#0F172A', '#E2E8F0'],
          },
          {
            key: 'reliability',
            triggerId: tab3Bg.id,
            row: 2,
            title: 'Production-Ready Edge Delivery',
            body: 'Automated a11y checks, static asset hashing, and zero-runtime CSS bundles built for global scale.',
            meta: 'UPTIME SLA · 99.99% · GLOBAL CDN',
            fills: ['#E2E8F0', '#E2E8F0', '#0F172A'],
          },
        ] as const;

        for (const item of tabs) {
          const ev = g.node(`ev-${item.key}`, 'event.on-click', 0, item.row, { targetNodeId: item.triggerId }, `Click ${item.key}`);
          const setVar = g.node(`sv-${item.key}`, 'state.update', 1, item.row, { variableId: tabVar, operation: 'set', value: item.key }, `Set ${item.key}`);
          const f1 = g.node(`f1-${item.key}`, 'action.set-layer', 2, item.row, { targetNodeId: tab1Bg.id, property: 'fill', fill: item.fills[0] });
          const f2 = g.node(`f2-${item.key}`, 'action.set-layer', 3, item.row, { targetNodeId: tab2Bg.id, property: 'fill', fill: item.fills[1] });
          const f3 = g.node(`f3-${item.key}`, 'action.set-layer', 4, item.row, { targetNodeId: tab3Bg.id, property: 'fill', fill: item.fills[2] });
          const st = g.node(`st-${item.key}`, 'action.set-layer', 5, item.row, { targetNodeId: panelTitle.id, property: 'text', text: item.title });
          const sb = g.node(`sb-${item.key}`, 'action.set-layer', 6, item.row, { targetNodeId: panelBody.id, property: 'text', text: item.body });
          const sm = g.node(`sm-${item.key}`, 'action.set-layer', 7, item.row, { targetNodeId: panelMeta.id, property: 'text', text: item.meta });
          g.chain([ev, setVar, f1, f2, f3, st, sb, sm]);
        }

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 5. Expandable FAQ Accordion Card
  buildTemplateDef(
    {
      id: 'ui-accordion-item',
      name: 'Expandable FAQ Accordion',
      category: 'ui',
      summary: 'Interactive disclosure card that toggles answer panel visibility and +/- indicator on header click.',
      keywords: ['accordion', 'faq', 'collapse', 'expand', 'disclosure', 'toggle', 'ui'],
      width: 468,
      height: 168,
      previewSurface: 'light',
      logicHighlights: ['Expand/collapse toggle', 'Visibility control', 'Live +/- indicator'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('acc-root'), 'Accordion Card', x, y, 468, 168, {
          fill: '#FFFFFF',
          stroke: '#E2E8F0',
          strokeWidth: 1,
          radius: 14,
          effects: [makeDropShadow(makeId('sh'), 8, 22, 'rgba(15, 23, 42, 0.06)')],
        }),
      );

      const header = b.add(
        'header',
        makeRect(makeId('acc-hdr'), 'Accordion Header', x + 12, y + 12, 444, 52, {
          parentId: root.id,
          fill: '#F8FAFC',
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#F1F5F9',
        }),
      );

      b.add(
        'question',
        makeText(makeId('acc-q'), 'Question Text', 'Can we export clean React & CSS without lock-in?', x + 28, y + 27, 368, 22, {
          parentId: root.id,
          fill: '#0F172A',
          fontSize: 14.5,
          fontWeight: 700,
          fontFamily: FONT_SANS,
          cursor: 'pointer',
        }),
      );

      const icon = b.add(
        'icon',
        makeText(makeId('acc-icon'), 'Toggle Indicator', '−', x + 412, y + 24, 30, 26, {
          parentId: root.id,
          fill: '#4F46E5',
          fontSize: 20,
          fontWeight: 700,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const answer = b.add(
        'answer',
        makeText(
          makeId('acc-a'),
          'Answer Body',
          'Yes. Every page, component, custom font, and interaction compiles to standard semantic HTML, CSS tokens, and TypeScript React files.',
          x + 28,
          y + 82,
          412,
          68,
          {
            parentId: root.id,
            fill: '#475569',
            fontSize: 13.5,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.55,
          },
        ),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Accordion Toggle Logic', logicTarget.scope, logicTarget.targetId);
        const openVar = g.variable('open', 'isExpanded', 'boolean', true);

        const onClick = g.node('click', 'event.on-click', 0, 0, { targetNodeId: header.id }, 'Click Header');
        const toggle = g.node('toggle', 'state.toggle', 1, 0, { variableId: openVar }, 'Toggle Expanded');
        const branch = g.node('branch', 'logic.branch', 2, 0, { mode: 'if-else' }, 'If Open');

        const showAns = g.node('show', 'action.set-layer', 3, 0, { targetNodeId: answer.id, property: 'visible', visibleMode: 'show' }, 'Show Answer');
        const iconMinus = g.node('icon-open', 'action.set-layer', 4, 0, { targetNodeId: icon.id, property: 'text', text: '−' }, 'Set Minus');
        const hdrOpen = g.node('hdr-open', 'action.set-layer', 5, 0, { targetNodeId: header.id, property: 'fill', fill: '#EEF2FF' }, 'Tint Header');

        const hideAns = g.node('hide', 'action.set-layer', 3, 1, { targetNodeId: answer.id, property: 'visible', visibleMode: 'hide' }, 'Hide Answer');
        const iconPlus = g.node('icon-closed', 'action.set-layer', 4, 1, { targetNodeId: icon.id, property: 'text', text: '+' }, 'Set Plus');
        const hdrClosed = g.node('hdr-closed', 'action.set-layer', 5, 1, { targetNodeId: header.id, property: 'fill', fill: '#F8FAFC' }, 'Reset Header');

        g.chain([onClick, toggle, branch]);
        g.connect(toggle, 'result', branch, 'condition');

        g.connect(branch, 'true', showAns, 'exec');
        g.chain([showAns, iconMinus, hdrOpen], 'next');

        g.connect(branch, 'false', hideAns, 'exec');
        g.chain([hideAns, iconPlus, hdrClosed], 'next');
        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 6. Live Revenue KPI Widget (7D / 30D / 1Y timeframe switcher)
  buildTemplateDef(
    {
      id: 'ui-kpi-switcher',
      name: 'Live Revenue KPI Widget',
      category: 'ui',
      summary: 'Dark executive KPI card with 7D/30D/1Y range buttons that dynamically switch revenue figure and trend delta.',
      keywords: ['kpi', 'metric', 'revenue', 'analytics', 'dashboard', 'stats', 'card', 'ui'],
      width: 356,
      height: 196,
      previewSurface: 'dark',
      logicHighlights: ['7D / 30D / 1Y range tabs', 'Dynamic KPI figure', 'Live trend delta update'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('kpi-root'), 'Revenue KPI Widget', x, y, 356, 196, {
          fill: '#0F172A',
          fills: [
            makeLinearGradient(makeId('grad'), 155, [
              { offset: 0, color: '#111827' },
              { offset: 1, color: '#0B1120' },
            ]),
          ],
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 16,
          effects: [makeDropShadow(makeId('sh'), 14, 34, 'rgba(2, 6, 23, 0.45)')],
        }),
      );

      b.add(
        'kicker',
        makeText(makeId('kpi-kicker'), 'KPI Label', 'NET RECURRING REVENUE', x + 22, y + 22, 180, 16, {
          parentId: root.id,
          fill: '#94A3B8',
          fontSize: 10.5,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 0.7,
        }),
      );

      const btn7d = b.add(
        'btn7d',
        makeRect(makeId('kpi-7d'), 'Range 7D Button', x + 216, y + 16, 36, 26, {
          parentId: root.id,
          fill: '#1E293B',
          radius: 6,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add('txt7d', makeText(makeId('kpi-7d-t'), '7D Label', '7D', x + 216, y + 22, 36, 16, {
        parentId: root.id,
        fill: '#CBD5E1',
        fontSize: 11,
        fontWeight: 700,
        fontFamily: FONT_MONO,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const btn30d = b.add(
        'btn30d',
        makeRect(makeId('kpi-30d'), 'Range 30D Button', x + 256, y + 16, 40, 26, {
          parentId: root.id,
          fill: '#2563EB',
          radius: 6,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add('txt30d', makeText(makeId('kpi-30d-t'), '30D Label', '30D', x + 256, y + 22, 40, 16, {
        parentId: root.id,
        fill: '#FFFFFF',
        fontSize: 11,
        fontWeight: 700,
        fontFamily: FONT_MONO,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const btn1y = b.add(
        'btn1y',
        makeRect(makeId('kpi-1y'), 'Range 1Y Button', x + 300, y + 16, 36, 26, {
          parentId: root.id,
          fill: '#1E293B',
          radius: 6,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add('txt1y', makeText(makeId('kpi-1y-t'), '1Y Label', '1Y', x + 300, y + 22, 36, 16, {
        parentId: root.id,
        fill: '#CBD5E1',
        fontSize: 11,
        fontWeight: 700,
        fontFamily: FONT_MONO,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const valueTxt = b.add(
        'valueTxt',
        makeText(makeId('kpi-val'), 'Revenue Value', '$142,840', x + 22, y + 66, 312, 46, {
          parentId: root.id,
          fill: '#F8FAFC',
          fontSize: 38,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
          letterSpacing: -0.8,
        }),
      );

      const deltaTxt = b.add(
        'deltaTxt',
        makeText(makeId('kpi-delta'), 'Growth Delta', '+18.4% vs prior 30 days', x + 22, y + 124, 312, 20, {
          parentId: root.id,
          fill: '#34D399',
          fontSize: 13.5,
          fontWeight: 600,
          fontFamily: FONT_SANS,
        }),
      );

      const captionTxt = b.add(
        'captionTxt',
        makeText(makeId('kpi-cap'), 'Benchmark Caption', '312 active paid workspaces · 1.2% churn', x + 22, y + 154, 312, 18, {
          parentId: root.id,
          fill: '#64748B',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: FONT_BODY,
        }),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'KPI Timeframe Switcher Logic', logicTarget.scope, logicTarget.targetId);
        const rangeVar = g.variable('range', 'kpiRange', 'string', '30D');

        const ranges = [
          {
            key: '7D',
            btnId: btn7d.id,
            row: 0,
            val: '$36,420',
            delta: '+6.8% vs prior 7 days',
            cap: '89 new paid activations this week',
            fills: ['#2563EB', '#1E293B', '#1E293B'],
          },
          {
            key: '30D',
            btnId: btn30d.id,
            row: 1,
            val: '$142,840',
            delta: '+18.4% vs prior 30 days',
            cap: '312 active paid workspaces · 1.2% churn',
            fills: ['#1E293B', '#2563EB', '#1E293B'],
          },
          {
            key: '1Y',
            btnId: btn1y.id,
            row: 2,
            val: '$1.71M',
            delta: '+124.0% YoY expansion',
            cap: '1,480 seats · 132% net dollar retention',
            fills: ['#1E293B', '#1E293B', '#2563EB'],
          },
        ] as const;

        for (const r of ranges) {
          const ev = g.node(`ev-${r.key}`, 'event.on-click', 0, r.row, { targetNodeId: r.btnId }, `Select ${r.key}`);
          const sv = g.node(`sv-${r.key}`, 'state.update', 1, r.row, { variableId: rangeVar, operation: 'set', value: r.key });
          const f1 = g.node(`f1-${r.key}`, 'action.set-layer', 2, r.row, { targetNodeId: btn7d.id, property: 'fill', fill: r.fills[0] });
          const f2 = g.node(`f2-${r.key}`, 'action.set-layer', 3, r.row, { targetNodeId: btn30d.id, property: 'fill', fill: r.fills[1] });
          const f3 = g.node(`f3-${r.key}`, 'action.set-layer', 4, r.row, { targetNodeId: btn1y.id, property: 'fill', fill: r.fills[2] });
          const sVal = g.node(`val-${r.key}`, 'action.set-layer', 5, r.row, { targetNodeId: valueTxt.id, property: 'text', text: r.val });
          const sDel = g.node(`del-${r.key}`, 'action.set-layer', 6, r.row, { targetNodeId: deltaTxt.id, property: 'text', text: r.delta });
          const sCap = g.node(`cap-${r.key}`, 'action.set-layer', 7, r.row, { targetNodeId: captionTxt.id, property: 'text', text: r.cap });
          g.chain([ev, sv, f1, f2, f3, sVal, sDel, sCap]);
        }

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 7. Interactive Billing Plan Card (Monthly/Annual switch + CTA toast)
  buildTemplateDef(
    {
      id: 'ui-pricing-card',
      name: 'Interactive Plan Pricing Card',
      category: 'ui',
      summary: 'Pro plan card with built-in Monthly/Yearly billing toggle updating price, savings banner, and checkout CTA toast.',
      keywords: ['pricing', 'plan', 'card', 'billing', 'toggle', 'annual', 'subscription', 'ui'],
      width: 348,
      height: 412,
      previewSurface: 'light',
      logicHighlights: ['Monthly/Annual toggle', 'Dynamic price & savings', 'CTA checkout toast'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('prc-root'), 'Pro Pricing Card', x, y, 348, 412, {
          fill: '#FFFFFF',
          stroke: '#CBD5E1',
          strokeWidth: 1,
          radius: 18,
          effects: [makeDropShadow(makeId('sh'), 16, 36, 'rgba(15, 23, 42, 0.1)')],
        }),
      );

      b.add('tier', makeText(makeId('prc-tier'), 'Tier Name', 'Studio Pro', x + 26, y + 26, 170, 26, {
        parentId: root.id,
        fill: '#0F172A',
        fontSize: 20,
        fontWeight: 700,
        fontFamily: FONT_DISPLAY,
      }));

      const toggleBtn = b.add(
        'toggleBtn',
        makeRect(makeId('prc-toggle'), 'Billing Toggle Button', x + 216, y + 24, 106, 30, {
          parentId: root.id,
          fill: '#EEF2FF',
          stroke: '#C7D2FE',
          strokeWidth: 1,
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#E0E7FF',
        }),
      );
      const toggleLabel = b.add(
        'toggleLabel',
        makeText(makeId('prc-toggle-txt'), 'Billing Mode Label', 'Monthly ⇄', x + 216, y + 31, 106, 16, {
          parentId: root.id,
          fill: '#4338CA',
          fontSize: 11.5,
          fontWeight: 700,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const priceTxt = b.add(
        'priceTxt',
        makeText(makeId('prc-price'), 'Plan Price', '$29', x + 26, y + 72, 140, 50, {
          parentId: root.id,
          fill: '#0F172A',
          fontSize: 44,
          fontWeight: 800,
          fontFamily: FONT_DISPLAY,
          letterSpacing: -1,
        }),
      );

      const billingSub = b.add(
        'billingSub',
        makeText(makeId('prc-sub'), 'Billing Cadence', 'per seat / mo · billed monthly', x + 26, y + 126, 296, 20, {
          parentId: root.id,
          fill: '#64748B',
          fontSize: 13,
          fontWeight: 500,
          fontFamily: FONT_BODY,
        }),
      );

      const saveNote = b.add(
        'saveNote',
        makeText(makeId('prc-save'), 'Annual Savings Note', '✓ Saving $72/seat per year (20% off)', x + 26, y + 150, 296, 18, {
          parentId: root.id,
          fill: '#0F766E',
          fontSize: 12,
          fontWeight: 700,
          visible: false,
        }),
      );

      b.add('divider', makeRect(makeId('prc-div'), 'Divider', x + 26, y + 180, 296, 1, {
        parentId: root.id,
        fill: '#E2E8F0',
        radius: 0,
      }));

      const perks = [
        'Unlimited pages, components & AST sync',
        'Visual Node Logic + interactive preview',
        'Custom font upload & clean React export',
        '60fps motion timeline & video export',
      ];
      perks.forEach((perk, idx) => {
        b.add(
          `perk-${idx}`,
          makeText(makeId(`prc-p-${idx}`), `Feature ${idx + 1}`, `✓  ${perk}`, x + 26, y + 198 + idx * 30, 296, 22, {
            parentId: root.id,
            fill: '#334155',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: FONT_BODY,
          }),
        );
      });

      const ctaBtn = b.add(
        'ctaBtn',
        makeRect(makeId('prc-cta'), 'Upgrade CTA Button', x + 26, y + 338, 296, 48, {
          parentId: root.id,
          fill: '#0F172A',
          radius: 11,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#1E293B',
        }),
      );
      b.add('ctaTxt', makeText(makeId('prc-cta-txt'), 'Upgrade CTA Label', 'Start 14-Day Free Trial', x + 26, y + 352, 296, 20, {
        parentId: root.id,
        fill: '#FFFFFF',
        fontSize: 14.5,
        fontWeight: 600,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Pricing Plan Card Logic', logicTarget.scope, logicTarget.targetId);
        const annualVar = g.variable('annual', 'isAnnualBilling', 'boolean', false);

        const onToggle = g.node('on-tgl', 'event.on-click', 0, 0, { targetNodeId: toggleBtn.id }, 'Toggle Billing');
        const toggle = g.node('tgl', 'state.toggle', 1, 0, { variableId: annualVar }, 'Flip Annual');
        const br = g.node('br', 'logic.branch', 2, 0, { mode: 'if-else' }, 'If Annual');

        const pAnn = g.node('p-ann', 'action.set-layer', 3, 0, { targetNodeId: priceTxt.id, property: 'text', text: '$23' });
        const sAnn = g.node('s-ann', 'action.set-layer', 4, 0, { targetNodeId: billingSub.id, property: 'text', text: 'per seat / mo · billed annually' });
        const lAnn = g.node('l-ann', 'action.set-layer', 5, 0, { targetNodeId: toggleLabel.id, property: 'text', text: 'Annual (-20%)' });
        const vAnn = g.node('v-ann', 'action.set-layer', 6, 0, { targetNodeId: saveNote.id, property: 'visible', visibleMode: 'show' });

        const pMon = g.node('p-mon', 'action.set-layer', 3, 1, { targetNodeId: priceTxt.id, property: 'text', text: '$29' });
        const sMon = g.node('s-mon', 'action.set-layer', 4, 1, { targetNodeId: billingSub.id, property: 'text', text: 'per seat / mo · billed monthly' });
        const lMon = g.node('l-mon', 'action.set-layer', 5, 1, { targetNodeId: toggleLabel.id, property: 'text', text: 'Monthly ⇄' });
        const vMon = g.node('v-mon', 'action.set-layer', 6, 1, { targetNodeId: saveNote.id, property: 'visible', visibleMode: 'hide' });

        const onCta = g.node('on-cta', 'event.on-click', 0, 2, { targetNodeId: ctaBtn.id }, 'Click Trial CTA');
        const ctaToast = g.node('cta-toast', 'action.overlay-toast', 1, 2, { mode: 'show-toast', tone: 'success', message: 'Studio Pro 14-day trial activated!' }, 'Confirm Trial');

        g.chain([onToggle, toggle, br]);
        g.connect(toggle, 'result', br, 'condition');

        g.connect(br, 'true', pAnn, 'exec');
        g.chain([pAnn, sAnn, lAnn, vAnn], 'next');

        g.connect(br, 'false', pMon, 'exec');
        g.chain([pMon, sMon, lMon, vMon], 'next');

        g.connect(onCta, 'exec', ctaToast, 'exec');
        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 8. Interactive Email Capture Card (live input state + empty check + validation feedback)
  buildTemplateDef(
    {
      id: 'ui-newsletter-bar',
      name: 'Interactive Email Capture Card',
      category: 'ui',
      summary: 'Dark newsletter bar with real email input binding, empty-field validation branch, inline status, and toast.',
      keywords: ['newsletter', 'input', 'email', 'form', 'subscribe', 'validation', 'interactive', 'ui'],
      width: 472,
      height: 174,
      previewSurface: 'dark',
      logicHighlights: ['Live input binding', 'Empty-field validation', 'Dynamic confirmation & toast'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('nl-root'), 'Email Capture Card', x, y, 472, 174, {
          fill: '#0F172A',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 16,
          effects: [makeDropShadow(makeId('sh'), 14, 34, 'rgba(2, 6, 23, 0.45)')],
        }),
      );

      b.add('title', makeText(makeId('nl-title'), 'Headline', 'Weekly Product Release Notes', x + 24, y + 22, 424, 24, {
        parentId: root.id,
        fill: '#F8FAFC',
        fontSize: 17,
        fontWeight: 700,
        fontFamily: FONT_DISPLAY,
      }));

      b.add('desc', makeText(makeId('nl-desc'), 'Description', 'Ship notes, new motion curves, and AST updates — zero fluff.', x + 24, y + 48, 424, 18, {
        parentId: root.id,
        fill: '#94A3B8',
        fontSize: 12.5,
        fontWeight: 400,
        fontFamily: FONT_BODY,
      }));

      const emailInput = b.add(
        'emailInput',
        makeRect(makeId('nl-input'), 'Work Email Input', x + 24, y + 82, 294, 44, {
          parentId: root.id,
          fill: '#1E293B',
          stroke: '#334155',
          strokeWidth: 1,
          radius: 10,
          semanticTag: 'input',
        }),
      );

      const submitBtn = b.add(
        'submitBtn',
        makeRect(makeId('nl-submit'), 'Subscribe Button', x + 328, y + 82, 120, 44, {
          parentId: root.id,
          fill: '#06B6D4',
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#0891B2',
        }),
      );
      b.add('submitTxt', makeText(makeId('nl-submit-t'), 'Subscribe Label', 'Subscribe', x + 328, y + 94, 120, 20, {
        parentId: root.id,
        fill: '#042F2E',
        fontSize: 13.5,
        fontWeight: 700,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const feedback = b.add(
        'feedback',
        makeText(makeId('nl-fb'), 'Status Feedback', 'Enter your email and click Subscribe to test live validation.', x + 24, y + 138, 424, 18, {
          parentId: root.id,
          fill: '#64748B',
          fontSize: 12,
          fontWeight: 500,
          fontFamily: FONT_BODY,
        }),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Email Capture Logic', logicTarget.scope, logicTarget.targetId);
        const emailVar = g.variable('email', 'subscriberEmail', 'string', '');

        const onInput = g.node('on-in', 'event.on-input', 0, 0, { targetNodeId: emailInput.id }, 'On Email Input');
        const saveEmail = g.node('save-email', 'state.update', 1, 0, { variableId: emailVar, operation: 'set' }, 'Save Email');

        const onSubmit = g.node('on-sub', 'event.on-click', 0, 1, { targetNodeId: submitBtn.id }, 'Click Subscribe');
        const getEmail = g.node('get-email', 'state.get', 1, 2, { variableId: emailVar }, 'Read Email');
        const isEmpty = g.node('is-empty', 'logic.condition', 2, 2, { mode: 'is-empty' }, 'Is Empty?');
        const br = g.node('br', 'logic.branch', 2, 1, { mode: 'if-else' }, 'Validate Email');

        const warnMsg = g.node('warn-msg', 'action.set-layer', 3, 1, { targetNodeId: feedback.id, property: 'text', text: 'Please enter an email address first.' }, 'Show Warning');
        const warnToast = g.node('warn-toast', 'action.overlay-toast', 4, 1, { mode: 'show-toast', tone: 'warning', message: 'Email address is required.' }, 'Warn Toast');

        const fmtOk = g.node('fmt-ok', 'logic.text', 3, 2, { mode: 'template', template: 'Subscribed {{subscriberEmail}} — welcome aboard!' }, 'Format Success');
        const okMsg = g.node('ok-msg', 'action.set-layer', 4, 2, { targetNodeId: feedback.id, property: 'text', text: 'Subscribed!' }, 'Show Confirmation');
        const okToast = g.node('ok-toast', 'action.overlay-toast', 5, 2, { mode: 'show-toast', tone: 'success', message: 'Subscription confirmed!' }, 'Success Toast');

        g.connect(onInput, 'exec', saveEmail, 'exec');
        g.connect(onInput, 'value', saveEmail, 'value');

        g.connect(onSubmit, 'exec', br, 'exec');
        g.connect(getEmail, 'value', isEmpty, 'left');
        g.connect(isEmpty, 'result', br, 'condition');

        g.connect(br, 'true', warnMsg, 'exec');
        g.connect(warnMsg, 'next', warnToast, 'exec');

        g.connect(br, 'false', okMsg, 'exec');
        g.connect(fmtOk, 'text', okMsg, 'value');
        g.connect(okMsg, 'next', okToast, 'exec');
        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),
];
