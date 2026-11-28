import {
  FONT_BODY,
  FONT_DISPLAY,
  FONT_EDITORIAL,
  FONT_MONO,
  FONT_SANS,
  LogicGraphBuilder,
  TemplateBuilder,
  makeDropShadow,
  makeFrame,
  makeLinearGradient,
  makeRect,
  makeText,
  type StudioTemplateDefinition,
  type TemplateBuiltBundle,
  type TemplateIdFactory,
  type TemplateOrigin,
} from './templatesHelpers';

function buildSectionDef(
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

export const SECTION_TEMPLATES: readonly StudioTemplateDefinition[] = [
  // 1. Editorial SaaS Hero with Interactive Mode Switcher
  buildSectionDef(
    {
      id: 'section-hero-studio',
      name: 'Interactive Product Hero Section',
      category: 'sections',
      summary: 'Asymmetric dark SaaS hero with live Design/Logic/Motion stage tabs, headline hierarchy, and wired CTA buttons.',
      keywords: ['hero', 'saas', 'landing', 'header', 'tabs', 'interactive', 'section'],
      width: 1200,
      height: 580,
      previewSurface: 'dark',
      logicHighlights: ['3-mode live stage tabs', 'CTA toast & status', 'Dynamic preview readout'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('hero-root'), 'Interactive Product Hero', x, y, 1200, 580, {
          fill: '#0A0F1A',
          fills: [
            makeLinearGradient(makeId('bg-grad'), 140, [
              { offset: 0, color: '#0A0F1A' },
              { offset: 0.6, color: '#0F172A' },
              { offset: 1, color: '#111827' },
            ]),
          ],
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 20,
          isSection: true,
          semanticTag: 'section',
          clipContent: true,
        }),
      );

      b.add('eyebrow', makeText(makeId('hero-eye'), 'Eyebrow', 'VISUAL FULL-STACK STUDIO · V2.4', x + 64, y + 68, 340, 18, {
        parentId: root.id,
        fill: '#38BDF8',
        fontSize: 11.5,
        fontWeight: 700,
        fontFamily: FONT_MONO,
        letterSpacing: 1.2,
      }));

      b.add('headline', makeText(makeId('hero-h1'), 'Hero Headline', 'Design visually.\nShip real logic.', x + 64, y + 102, 520, 134, {
        parentId: root.id,
        fill: '#F8FAFC',
        fontSize: 56,
        fontWeight: 700,
        fontFamily: FONT_DISPLAY,
        lineHeight: 1.06,
        letterSpacing: -1.4,
        semanticTag: 'h1',
      }));

      b.add('subcopy', makeText(
        makeId('hero-sub'),
        'Hero Subcopy',
        'Author responsive layouts, wire interactive state graphs, and export production React & CSS from one unified source of truth.',
        x + 64,
        y + 252,
        492,
        74,
        {
          parentId: root.id,
          fill: '#94A3B8',
          fontSize: 16.5,
          fontWeight: 400,
          fontFamily: FONT_BODY,
          lineHeight: 1.55,
        },
      ));

      const primaryCta = b.add(
        'primaryCta',
        makeRect(makeId('hero-cta-1'), 'Primary CTA Button', x + 64, y + 356, 188, 50, {
          parentId: root.id,
          fill: '#2563EB',
          radius: 12,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#1D4ED8',
          effects: [makeDropShadow(makeId('sh-cta'), 10, 26, 'rgba(37, 99, 235, 0.35)')],
        }),
      );
      b.add('primaryTxt', makeText(makeId('hero-cta-1-t'), 'Primary CTA Label', 'Start Building Free', x + 64, y + 371, 188, 20, {
        parentId: root.id,
        fill: '#FFFFFF',
        fontSize: 14.5,
        fontWeight: 700,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const secondaryCta = b.add(
        'secondaryCta',
        makeRect(makeId('hero-cta-2'), 'Secondary CTA Button', x + 266, y + 356, 168, 50, {
          parentId: root.id,
          fill: '#111827',
          stroke: '#334155',
          strokeWidth: 1,
          radius: 12,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#1E293B',
        }),
      );
      b.add('secondaryTxt', makeText(makeId('hero-cta-2-t'), 'Secondary CTA Label', 'Book Live Demo', x + 266, y + 371, 168, 20, {
        parentId: root.id,
        fill: '#E2E8F0',
        fontSize: 14.5,
        fontWeight: 600,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const ctaStatus = b.add(
        'ctaStatus',
        makeText(makeId('hero-status'), 'Hero Status Line', 'No credit card required · Free forever for personal projects', x + 64, y + 430, 460, 20, {
          parentId: root.id,
          fill: '#64748B',
          fontSize: 12.5,
          fontWeight: 500,
          fontFamily: FONT_BODY,
        }),
      );

      // Right column: Interactive Stage Preview Card
      const stageCard = b.add(
        'stageCard',
        makeFrame(makeId('hero-stage'), 'Interactive Stage Window', x + 616, y + 64, 520, 452, {
          parentId: root.id,
          fill: '#111827',
          stroke: '#334155',
          strokeWidth: 1,
          radius: 18,
          effects: [makeDropShadow(makeId('sh-stage'), 22, 48, 'rgba(2, 6, 23, 0.65)')],
        }),
      );

      // Mode switcher buttons inside stage header
      const modeDesign = b.add(
        'modeDesign',
        makeRect(makeId('hero-m1'), 'Mode Design Tab', x + 640, y + 88, 148, 36, {
          parentId: stageCard.id,
          fill: '#2563EB',
          radius: 9,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add('modeDesignTxt', makeText(makeId('hero-m1-t'), 'Design Tab Label', '01 · Design', x + 640, y + 97, 148, 18, {
        parentId: stageCard.id,
        fill: '#FFFFFF',
        fontSize: 12.5,
        fontWeight: 700,
        fontFamily: FONT_MONO,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const modeLogic = b.add(
        'modeLogic',
        makeRect(makeId('hero-m2'), 'Mode Logic Tab', x + 800, y + 88, 148, 36, {
          parentId: stageCard.id,
          fill: '#1E293B',
          radius: 9,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add('modeLogicTxt', makeText(makeId('hero-m2-t'), 'Logic Tab Label', '02 · Logic', x + 800, y + 97, 148, 18, {
        parentId: stageCard.id,
        fill: '#CBD5E1',
        fontSize: 12.5,
        fontWeight: 700,
        fontFamily: FONT_MONO,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const modeMotion = b.add(
        'modeMotion',
        makeRect(makeId('hero-m3'), 'Mode Motion Tab', x + 960, y + 88, 152, 36, {
          parentId: stageCard.id,
          fill: '#1E293B',
          radius: 9,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add('modeMotionTxt', makeText(makeId('hero-m3-t'), 'Motion Tab Label', '03 · Motion', x + 960, y + 97, 152, 18, {
        parentId: stageCard.id,
        fill: '#CBD5E1',
        fontSize: 12.5,
        fontWeight: 700,
        fontFamily: FONT_MONO,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const stageAccentBar = b.add(
        'stageAccentBar',
        makeRect(makeId('hero-accent'), 'Stage Accent Strip', x + 640, y + 148, 472, 6, {
          parentId: stageCard.id,
          fill: '#38BDF8',
          radius: 3,
        }),
      );

      const stageTitle = b.add(
        'stageTitle',
        makeText(makeId('hero-st-title'), 'Stage Title', 'Auto-Layout & Native Tokens', x + 640, y + 178, 472, 32, {
          parentId: stageCard.id,
          fill: '#F8FAFC',
          fontSize: 24,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );

      const stageDesc = b.add(
        'stageDesc',
        makeText(
          makeId('hero-st-desc'),
          'Stage Description',
          'Compose pixel-accurate grids, multi-fill surfaces, and responsive breakpoints that map 1:1 to semantic CSS variables.',
          x + 640,
          y + 220,
          472,
          72,
          {
            parentId: stageCard.id,
            fill: '#94A3B8',
            fontSize: 14.5,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.6,
          },
        ),
      );

      b.add('stageMetricBox', makeRect(makeId('hero-mbox'), 'Metric Readout Box', x + 640, y + 322, 472, 86, {
        parentId: stageCard.id,
        fill: '#0B1120',
        stroke: '#1E293B',
        strokeWidth: 1,
        radius: 12,
      }));

      const stageMetricVal = b.add(
        'stageMetricVal',
        makeText(makeId('hero-mval'), 'Stage Metric Value', '100% Native AST Parity', x + 660, y + 338, 432, 26, {
          parentId: stageCard.id,
          fill: '#38BDF8',
          fontSize: 18,
          fontWeight: 700,
          fontFamily: FONT_MONO,
        }),
      );

      const stageMetricSub = b.add(
        'stageMetricSub',
        makeText(makeId('hero-msub'), 'Stage Metric Detail', 'Click the tabs above to inspect Logic & Motion workflows live.', x + 660, y + 370, 432, 20, {
          parentId: stageCard.id,
          fill: '#64748B',
          fontSize: 12.5,
          fontWeight: 500,
        }),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Hero Section Interactive Logic', logicTarget.scope, logicTarget.targetId);
        const modeVar = g.variable('mode', 'heroStageMode', 'string', 'design');

        const modes = [
          {
            key: 'design',
            btnId: modeDesign.id,
            row: 0,
            accent: '#38BDF8',
            title: 'Auto-Layout & Native Tokens',
            desc: 'Compose pixel-accurate grids, multi-fill surfaces, and responsive breakpoints that map 1:1 to semantic CSS variables.',
            val: '100% Native AST Parity',
            sub: 'Zero wrapper divs · Clean CSS Grid & Flex output',
            fills: ['#2563EB', '#1E293B', '#1E293B'],
          },
          {
            key: 'logic',
            btnId: modeLogic.id,
            row: 1,
            accent: '#A855F7',
            title: 'Visual Node Logic Engine',
            desc: 'Wire real click events, typed state variables, conditional branches, math expressions, and live toasts visually.',
            val: '31 Built-In Logic Nodes',
            sub: 'Deterministic runtime · Compiles to clean React hooks',
            fills: ['#1E293B', '#7C3AED', '#1E293B'],
          },
          {
            key: 'motion',
            btnId: modeMotion.id,
            row: 2,
            accent: '#10B981',
            title: '68-Curve Motion & Physics',
            desc: 'Choreograph multi-track keyframes with tuned spring physics, Bezier handles, and hardware-accelerated CSS export.',
            val: '60fps Keyframe Timeline',
            sub: 'Spring, Elastic, Bounce & Multi-Point graph editor',
            fills: ['#1E293B', '#1E293B', '#059669'],
          },
        ] as const;

        for (const m of modes) {
          const ev = g.node(`ev-${m.key}`, 'event.on-click', 0, m.row, { targetNodeId: m.btnId }, `Select ${m.key}`);
          const sv = g.node(`sv-${m.key}`, 'state.update', 1, m.row, { variableId: modeVar, operation: 'set', value: m.key });
          const f1 = g.node(`f1-${m.key}`, 'action.set-layer', 2, m.row, { targetNodeId: modeDesign.id, property: 'fill', fill: m.fills[0] });
          const f2 = g.node(`f2-${m.key}`, 'action.set-layer', 3, m.row, { targetNodeId: modeLogic.id, property: 'fill', fill: m.fills[1] });
          const f3 = g.node(`f3-${m.key}`, 'action.set-layer', 4, m.row, { targetNodeId: modeMotion.id, property: 'fill', fill: m.fills[2] });
          const ac = g.node(`ac-${m.key}`, 'action.set-layer', 5, m.row, { targetNodeId: stageAccentBar.id, property: 'fill', fill: m.accent });
          const st = g.node(`st-${m.key}`, 'action.set-layer', 6, m.row, { targetNodeId: stageTitle.id, property: 'text', text: m.title });
          const sd = g.node(`sd-${m.key}`, 'action.set-layer', 7, m.row, { targetNodeId: stageDesc.id, property: 'text', text: m.desc });
          const smv = g.node(`smv-${m.key}`, 'action.set-layer', 8, m.row, { targetNodeId: stageMetricVal.id, property: 'text', text: m.val });
          const sms = g.node(`sms-${m.key}`, 'action.set-layer', 9, m.row, { targetNodeId: stageMetricSub.id, property: 'text', text: m.sub });
          g.chain([ev, sv, f1, f2, f3, ac, st, sd, smv, sms]);
        }

        const onStart = g.node('on-start', 'event.on-click', 0, 3, { targetNodeId: primaryCta.id }, 'Click Primary CTA');
        const updStatus1 = g.node('upd-s1', 'action.set-layer', 1, 3, { targetNodeId: ctaStatus.id, property: 'text', text: '✓ Workspace ready — redirecting to Studio onboarding…' });
        const toastStart = g.node('toast-start', 'action.overlay-toast', 2, 3, { mode: 'show-toast', tone: 'success', message: 'Free Studio workspace provisioned!' });
        g.chain([onStart, updStatus1, toastStart]);

        const onDemo = g.node('on-demo', 'event.on-click', 0, 4, { targetNodeId: secondaryCta.id }, 'Click Demo CTA');
        const updStatus2 = g.node('upd-s2', 'action.set-layer', 1, 4, { targetNodeId: ctaStatus.id, property: 'text', text: 'Demo request received — our solutions engineer will reach out.' });
        const toastDemo = g.node('toast-demo', 'action.overlay-toast', 2, 4, { mode: 'show-toast', tone: 'info', message: 'Live demo slot requested.' });
        g.chain([onDemo, updStatus2, toastDemo]);

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 2. 3-Tier Interactive Pricing Section (Monthly/Annual toggle updating all 3 cards + Plan selector)
  buildSectionDef(
    {
      id: 'section-pricing-tiers',
      name: 'Interactive 3-Tier Pricing Section',
      category: 'sections',
      summary: 'Complete 3-plan pricing section with Monthly/Annual switcher updating all tiers dynamically and wired selection CTAs.',
      keywords: ['pricing', 'plans', 'tiers', 'billing', 'annual', 'monthly', 'saas', 'section'],
      width: 1200,
      height: 640,
      previewSurface: 'light',
      logicHighlights: ['Global Monthly/Annual toggle', 'Updates all 3 plan prices', 'Plan selection & toast'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('prcs-root'), '3-Tier Pricing Section', x, y, 1200, 640, {
          fill: '#F8FAFC',
          stroke: '#E2E8F0',
          strokeWidth: 1,
          radius: 20,
          isSection: true,
          semanticTag: 'section',
        }),
      );

      b.add('heading', makeText(makeId('prcs-h2'), 'Section Title', 'Simple, transparent pricing', x + 200, y + 40, 800, 44, {
        parentId: root.id,
        fill: '#0F172A',
        fontSize: 38,
        fontWeight: 700,
        fontFamily: FONT_DISPLAY,
        textAlign: 'center',
        semanticTag: 'h2',
      }));

      const billingBanner = b.add(
        'billingBanner',
        makeText(makeId('prcs-sub'), 'Billing Status Subtitle', 'Currently viewing Monthly billing — switch to Annual to save 20%.', x + 220, y + 90, 760, 22, {
          parentId: root.id,
          fill: '#475569',
          fontSize: 14.5,
          fontWeight: 500,
          fontFamily: FONT_BODY,
          textAlign: 'center',
        }),
      );

      // Billing toggle bar
      b.add('tglWrap', makeRect(makeId('prcs-tgl-wrap'), 'Billing Switch Bar', x + 464, y + 126, 272, 42, {
        parentId: root.id,
        fill: '#E2E8F0',
        radius: 11,
      }));

      const monthlyBtn = b.add(
        'monthlyBtn',
        makeRect(makeId('prcs-m-btn'), 'Monthly Button', x + 468, y + 130, 130, 34, {
          parentId: root.id,
          fill: '#0F172A',
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add('monthlyTxt', makeText(makeId('prcs-m-txt'), 'Monthly Label', 'Monthly', x + 468, y + 138, 130, 18, {
        parentId: root.id,
        fill: '#FFFFFF',
        fontSize: 12.5,
        fontWeight: 700,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const annualBtn = b.add(
        'annualBtn',
        makeRect(makeId('prcs-a-btn'), 'Annual Button', x + 602, y + 130, 130, 34, {
          parentId: root.id,
          fill: '#CBD5E1',
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add('annualTxt', makeText(makeId('prcs-a-txt'), 'Annual Label', 'Annual (−20%)', x + 602, y + 138, 130, 18, {
        parentId: root.id,
        fill: '#0F172A',
        fontSize: 12.5,
        fontWeight: 700,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const plans = [
        {
          key: 'starter',
          name: 'Starter',
          monthly: '$19',
          annual: '$15',
          desc: 'For solo creators shipping landing pages & portfolios.',
          perks: ['5 active projects', '74+ curated & custom fonts', 'HTML/CSS static export'],
          featured: false,
        },
        {
          key: 'pro',
          name: 'Pro Studio',
          monthly: '$49',
          annual: '$39',
          desc: 'For product teams building interactive full-stack UIs.',
          perks: ['Unlimited projects & components', 'Full Node Logic & live preview', 'Clean React + TypeScript export'],
          featured: true,
        },
        {
          key: 'enterprise',
          name: 'Enterprise',
          monthly: '$149',
          annual: '$119',
          desc: 'For design engineering orgs needing governance & SLA.',
          perks: ['Shared design token governance', 'Dedicated SSO & audit logs', '99.99% uptime SLA & support'],
          featured: false,
        },
      ] as const;

      const priceNodes: Record<string, string> = {};
      const ctaNodes: Record<string, string> = {};

      plans.forEach((plan, idx) => {
        const cx = x + 64 + idx * 366;
        const cy = y + 194;
        const card = b.add(
          `card-${plan.key}`,
          makeFrame(makeId(`prcs-c-${plan.key}`), `${plan.name} Card`, cx, cy, 340, 386, {
            parentId: root.id,
            fill: plan.featured ? '#0F172A' : '#FFFFFF',
            stroke: plan.featured ? '#3B82F6' : '#E2E8F0',
            strokeWidth: plan.featured ? 2 : 1,
            radius: 18,
            effects: [
              makeDropShadow(
                makeId(`sh-${plan.key}`),
                plan.featured ? 18 : 10,
                plan.featured ? 40 : 24,
                plan.featured ? 'rgba(37, 99, 235, 0.22)' : 'rgba(15, 23, 42, 0.06)',
              ),
            ],
          }),
        );

        b.add(`name-${plan.key}`, makeText(makeId(`prcs-n-${plan.key}`), `${plan.name} Title`, plan.name, cx + 26, cy + 26, 200, 26, {
          parentId: card.id,
          fill: plan.featured ? '#F8FAFC' : '#0F172A',
          fontSize: 20,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }));

        if (plan.featured) {
          b.add('popular', makeText(makeId('prcs-pop'), 'Featured Tag', 'RECOMMENDED', cx + 206, cy + 31, 108, 16, {
            parentId: card.id,
            fill: '#38BDF8',
            fontSize: 10.5,
            fontWeight: 700,
            fontFamily: FONT_MONO,
            textAlign: 'right',
          }));
        }

        const pNode = b.add(`price-${plan.key}`, makeText(makeId(`prcs-p-${plan.key}`), `${plan.name} Price`, plan.monthly, cx + 26, cy + 68, 160, 48, {
          parentId: card.id,
          fill: plan.featured ? '#FFFFFF' : '#0F172A',
          fontSize: 42,
          fontWeight: 800,
          fontFamily: FONT_DISPLAY,
          letterSpacing: -1,
        }));
        priceNodes[plan.key] = pNode.id;

        b.add(`per-${plan.key}`, makeText(makeId(`prcs-per-${plan.key}`), 'Unit', '/ seat / mo', cx + 128, cy + 88, 120, 20, {
          parentId: card.id,
          fill: plan.featured ? '#94A3B8' : '#64748B',
          fontSize: 13,
          fontWeight: 500,
        }));

        b.add(`desc-${plan.key}`, makeText(makeId(`prcs-d-${plan.key}`), `${plan.name} Desc`, plan.desc, cx + 26, cy + 128, 288, 42, {
          parentId: card.id,
          fill: plan.featured ? '#CBD5E1' : '#475569',
          fontSize: 13.5,
          fontWeight: 400,
          fontFamily: FONT_BODY,
          lineHeight: 1.45,
        }));

        plan.perks.forEach((perk, pIdx) => {
          b.add(`pk-${plan.key}-${pIdx}`, makeText(makeId(`prcs-pk-${plan.key}-${pIdx}`), `Perk ${pIdx + 1}`, `✓  ${perk}`, cx + 26, cy + 188 + pIdx * 32, 288, 22, {
            parentId: card.id,
            fill: plan.featured ? '#E2E8F0' : '#334155',
            fontSize: 13,
            fontWeight: 500,
            fontFamily: FONT_BODY,
          }));
        });

        const cta = b.add(
          `cta-${plan.key}`,
          makeRect(makeId(`prcs-cta-${plan.key}`), `Select ${plan.name}`, cx + 26, cy + 314, 288, 46, {
            parentId: card.id,
            fill: plan.featured ? '#2563EB' : '#0F172A',
            radius: 11,
            semanticTag: 'button',
            cursor: 'pointer',
            hoverFill: plan.featured ? '#1D4ED8' : '#1E293B',
          }),
        );
        ctaNodes[plan.key] = cta.id;

        b.add(`cta-t-${plan.key}`, makeText(makeId(`prcs-ctat-${plan.key}`), `${plan.name} CTA Label`, `Choose ${plan.name}`, cx + 26, cy + 328, 288, 20, {
          parentId: card.id,
          fill: '#FFFFFF',
          fontSize: 14,
          fontWeight: 700,
          textAlign: 'center',
          cursor: 'pointer',
        }));
      });

      const selectionFoot = b.add(
        'selectionFoot',
        makeText(makeId('prcs-foot'), 'Selected Plan Status', 'Selected plan: Pro Studio · Click any plan to switch.', x + 64, y + 598, 1072, 22, {
          parentId: root.id,
          fill: '#475569',
          fontSize: 13,
          fontWeight: 600,
          textAlign: 'center',
        }),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, '3-Tier Pricing Section Logic', logicTarget.scope, logicTarget.targetId);
        const annualVar = g.variable('annual', 'billingAnnual', 'boolean', false);
        const planVar = g.variable('plan', 'selectedPlan', 'string', 'Pro Studio');

        // Monthly click
        const evMon = g.node('ev-mon', 'event.on-click', 0, 0, { targetNodeId: monthlyBtn.id }, 'Click Monthly');
        const svMon = g.node('sv-mon', 'state.update', 1, 0, { variableId: annualVar, operation: 'set', value: false });
        const fm1 = g.node('fm1', 'action.set-layer', 2, 0, { targetNodeId: monthlyBtn.id, property: 'fill', fill: '#0F172A' });
        const fm2 = g.node('fm2', 'action.set-layer', 3, 0, { targetNodeId: annualBtn.id, property: 'fill', fill: '#CBD5E1' });
        const pm1 = g.node('pm1', 'action.set-layer', 4, 0, { targetNodeId: priceNodes.starter, property: 'text', text: '$19' });
        const pm2 = g.node('pm2', 'action.set-layer', 5, 0, { targetNodeId: priceNodes.pro, property: 'text', text: '$49' });
        const pm3 = g.node('pm3', 'action.set-layer', 6, 0, { targetNodeId: priceNodes.enterprise, property: 'text', text: '$149' });
        const bm = g.node('bm', 'action.set-layer', 7, 0, { targetNodeId: billingBanner.id, property: 'text', text: 'Currently viewing Monthly billing — switch to Annual to save 20%.' });
        g.chain([evMon, svMon, fm1, fm2, pm1, pm2, pm3, bm]);

        // Annual click
        const evAnn = g.node('ev-ann', 'event.on-click', 0, 1, { targetNodeId: annualBtn.id }, 'Click Annual');
        const svAnn = g.node('sv-ann', 'state.update', 1, 1, { variableId: annualVar, operation: 'set', value: true });
        const fa1 = g.node('fa1', 'action.set-layer', 2, 1, { targetNodeId: monthlyBtn.id, property: 'fill', fill: '#CBD5E1' });
        const fa2 = g.node('fa2', 'action.set-layer', 3, 1, { targetNodeId: annualBtn.id, property: 'fill', fill: '#0F172A' });
        const pa1 = g.node('pa1', 'action.set-layer', 4, 1, { targetNodeId: priceNodes.starter, property: 'text', text: '$15' });
        const pa2 = g.node('pa2', 'action.set-layer', 5, 1, { targetNodeId: priceNodes.pro, property: 'text', text: '$39' });
        const pa3 = g.node('pa3', 'action.set-layer', 6, 1, { targetNodeId: priceNodes.enterprise, property: 'text', text: '$119' });
        const ba = g.node('ba', 'action.set-layer', 7, 1, { targetNodeId: billingBanner.id, property: 'text', text: 'Annual billing active — 20% discount applied across all tiers!' });
        g.chain([evAnn, svAnn, fa1, fa2, pa1, pa2, pa3, ba]);

        // Plan selection buttons
        plans.forEach((plan, idx) => {
          const ev = g.node(`sel-${plan.key}`, 'event.on-click', 0, 2 + idx, { targetNodeId: ctaNodes[plan.key] }, `Choose ${plan.name}`);
          const sv = g.node(`svp-${plan.key}`, 'state.update', 1, 2 + idx, { variableId: planVar, operation: 'set', value: plan.name });
          const foot = g.node(`ft-${plan.key}`, 'action.set-layer', 2, 2 + idx, { targetNodeId: selectionFoot.id, property: 'text', text: `✓ Selected plan: ${plan.name} — ready for checkout.` });
          const tst = g.node(`tst-${plan.key}`, 'action.overlay-toast', 3, 2 + idx, { mode: 'show-toast', tone: 'success', message: `${plan.name} plan selected!` });
          g.chain([ev, sv, foot, tst]);
        });

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 3. Asymmetric Interactive Bento Showcase
  buildSectionDef(
    {
      id: 'section-bento-features',
      name: 'Interactive Bento Capabilities',
      category: 'sections',
      summary: 'Dark asymmetric bento grid where clicking any capability card updates the live architectural spotlight panel.',
      keywords: ['bento', 'features', 'grid', 'capabilities', 'spotlight', 'interactive', 'section'],
      width: 1200,
      height: 540,
      previewSurface: 'dark',
      logicHighlights: ['Clickable bento cards', 'Live spotlight panel', 'Active card highlight'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('bnt-root'), 'Interactive Bento Showcase', x, y, 1200, 540, {
          fill: '#0B1120',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 20,
          isSection: true,
          semanticTag: 'section',
        }),
      );

      b.add('heading', makeText(makeId('bnt-h2'), 'Section Heading', 'Engineered for every stage of the product lifecycle', x + 56, y + 40, 720, 38, {
        parentId: root.id,
        fill: '#F8FAFC',
        fontSize: 30,
        fontWeight: 700,
        fontFamily: FONT_DISPLAY,
        semanticTag: 'h2',
      }));

      b.add('hint', makeText(makeId('bnt-hint'), 'Interaction Hint', 'Click any module on the left to inspect its runtime architecture.', x + 56, y + 82, 540, 20, {
        parentId: root.id,
        fill: '#64748B',
        fontSize: 13.5,
        fontWeight: 500,
      }));

      const items = [
        {
          key: 'ast',
          num: '01',
          title: 'Unified Native AST',
          short: 'Single semantic tree powering canvas, tokens & codegen.',
          detail: 'Every frame, text layer, vector path, and component instance shares stable immutable IDs so visual edits and code stays permanently in sync.',
          stat: '0.4ms avg tree diff · .flop v2 schema',
          accent: '#38BDF8',
        },
        {
          key: 'logic',
          num: '02',
          title: 'Visual Node Logic',
          short: 'Event-driven state graphs compiled cleanly to runtime JS.',
          detail: 'Build real toggles, steppers, tab switchers, form validation, and overlays without leaving the studio — verified by static graph diagnostics.',
          stat: '31 primary nodes · deterministic runtime',
          accent: '#A855F7',
        },
        {
          key: 'motion',
          num: '03',
          title: 'Physics & Easing Curves',
          short: '68 studio curves with spring, bounce, and Bezier handles.',
          detail: 'Preview every keyframe at 60fps, shape custom cubic-bezier or multi-point curves, and export clean CSS @keyframes with reduced-motion safety.',
          stat: '68 curated easings · prefers-reduced-motion',
          accent: '#10B981',
        },
      ] as const;

      const cardIds: Record<string, string> = {};

      items.forEach((item, idx) => {
        const cy = y + 124 + idx * 124;
        const card = b.add(
          `card-${item.key}`,
          makeFrame(makeId(`bnt-c-${item.key}`), `Bento Card — ${item.title}`, x + 56, cy, 464, 108, {
            parentId: root.id,
            fill: idx === 0 ? '#172554' : '#111827',
            stroke: idx === 0 ? '#38BDF8' : '#1E293B',
            strokeWidth: 1.5,
            radius: 14,
            semanticTag: 'button',
            cursor: 'pointer',
            hoverFill: '#1E293B',
          }),
        );
        cardIds[item.key] = card.id;

        b.add(`num-${item.key}`, makeText(makeId(`bnt-n-${item.key}`), 'Number', item.num, x + 76, cy + 20, 44, 20, {
          parentId: card.id,
          fill: item.accent,
          fontSize: 12,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          cursor: 'pointer',
        }));

        b.add(`t-${item.key}`, makeText(makeId(`bnt-t-${item.key}`), 'Card Title', item.title, x + 76, cy + 42, 412, 24, {
          parentId: card.id,
          fill: '#F8FAFC',
          fontSize: 17,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
          cursor: 'pointer',
        }));

        b.add(`s-${item.key}`, makeText(makeId(`bnt-s-${item.key}`), 'Card Summary', item.short, x + 76, cy + 70, 412, 20, {
          parentId: card.id,
          fill: '#94A3B8',
          fontSize: 12.5,
          fontWeight: 400,
          fontFamily: FONT_BODY,
          cursor: 'pointer',
        }));
      });

      // Right Spotlight Panel
      const spotlight = b.add(
        'spotlight',
        makeFrame(makeId('bnt-spot'), 'Spotlight Detail Panel', x + 548, y + 124, 596, 356, {
          parentId: root.id,
          fill: '#111827',
          stroke: '#334155',
          strokeWidth: 1,
          radius: 18,
          effects: [makeDropShadow(makeId('sh-spot'), 18, 40, 'rgba(2, 6, 23, 0.55)')],
        }),
      );

      const spotBar = b.add('spotBar', makeRect(makeId('bnt-sbar'), 'Spotlight Accent Bar', x + 584, y + 160, 72, 6, {
        parentId: spotlight.id,
        fill: '#38BDF8',
        radius: 3,
      }));

      const spotTitle = b.add('spotTitle', makeText(makeId('bnt-st'), 'Spotlight Title', items[0].title, x + 584, y + 186, 524, 38, {
        parentId: spotlight.id,
        fill: '#F8FAFC',
        fontSize: 30,
        fontWeight: 700,
        fontFamily: FONT_DISPLAY,
      }));

      const spotDesc = b.add('spotDesc', makeText(makeId('bnt-sd'), 'Spotlight Description', items[0].detail, x + 584, y + 240, 524, 110, {
        parentId: spotlight.id,
        fill: '#CBD5E1',
        fontSize: 16,
        fontWeight: 400,
        fontFamily: FONT_BODY,
        lineHeight: 1.65,
      }));

      b.add('spotStatBox', makeRect(makeId('bnt-sbx'), 'Benchmark Strip', x + 584, y + 382, 524, 62, {
        parentId: spotlight.id,
        fill: '#0B1120',
        stroke: '#1E293B',
        strokeWidth: 1,
        radius: 12,
      }));

      const spotStat = b.add('spotStat', makeText(makeId('bnt-stat'), 'Benchmark Stat', items[0].stat, x + 606, y + 403, 480, 22, {
        parentId: spotlight.id,
        fill: '#38BDF8',
        fontSize: 13.5,
        fontWeight: 700,
        fontFamily: FONT_MONO,
      }));

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Bento Spotlight Logic', logicTarget.scope, logicTarget.targetId);
        const activeVar = g.variable('active', 'activeCapability', 'string', 'ast');

        items.forEach((item, idx) => {
          const fills = [
            idx === 0 ? '#172554' : '#111827',
            idx === 1 ? '#2E1065' : '#111827',
            idx === 2 ? '#064E3B' : '#111827',
          ];
          const ev = g.node(`ev-${item.key}`, 'event.on-click', 0, idx, { targetNodeId: cardIds[item.key] }, `Select ${item.title}`);
          const sv = g.node(`sv-${item.key}`, 'state.update', 1, idx, { variableId: activeVar, operation: 'set', value: item.key });
          const c0 = g.node(`c0-${item.key}`, 'action.set-layer', 2, idx, { targetNodeId: cardIds.ast, property: 'fill', fill: fills[0] });
          const c1 = g.node(`c1-${item.key}`, 'action.set-layer', 3, idx, { targetNodeId: cardIds.logic, property: 'fill', fill: fills[1] });
          const c2 = g.node(`c2-${item.key}`, 'action.set-layer', 4, idx, { targetNodeId: cardIds.motion, property: 'fill', fill: fills[2] });
          const sb = g.node(`sb-${item.key}`, 'action.set-layer', 5, idx, { targetNodeId: spotBar.id, property: 'fill', fill: item.accent });
          const st = g.node(`st-${item.key}`, 'action.set-layer', 6, idx, { targetNodeId: spotTitle.id, property: 'text', text: item.title });
          const sd = g.node(`sd-${item.key}`, 'action.set-layer', 7, idx, { targetNodeId: spotDesc.id, property: 'text', text: item.detail });
          const ss = g.node(`ss-${item.key}`, 'action.set-layer', 8, idx, { targetNodeId: spotStat.id, property: 'text', text: item.stat });
          g.chain([ev, sv, c0, c1, c2, sb, st, sd, ss]);
        });

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 4. Interactive 3-Item FAQ Accordion Section
  buildSectionDef(
    {
      id: 'section-faq-accordion',
      name: 'Interactive FAQ Section',
      category: 'sections',
      summary: 'Two-column FAQ section with 3 independently expandable accordion items and a wired support CTA button.',
      keywords: ['faq', 'questions', 'accordion', 'help', 'support', 'interactive', 'section'],
      width: 1120,
      height: 540,
      previewSurface: 'light',
      logicHighlights: ['3 independent accordions', 'Visibility + +/- state', 'Support CTA toast'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('faq-root'), 'Interactive FAQ Section', x, y, 1120, 540, {
          fill: '#FAFAF9',
          stroke: '#E7E5E4',
          strokeWidth: 1,
          radius: 20,
          isSection: true,
          semanticTag: 'section',
        }),
      );

      // Left column intro
      b.add('kicker', makeText(makeId('faq-kick'), 'Kicker', 'FREQUENTLY ASKED', x + 56, y + 60, 260, 18, {
        parentId: root.id,
        fill: '#4F46E5',
        fontSize: 11.5,
        fontWeight: 700,
        fontFamily: FONT_MONO,
        letterSpacing: 1.1,
      }));

      b.add('title', makeText(makeId('faq-h2'), 'Section Headline', 'Answers before you ship.', x + 56, y + 88, 340, 88, {
        parentId: root.id,
        fill: '#1C1917',
        fontSize: 38,
        fontWeight: 700,
        fontFamily: FONT_DISPLAY,
        lineHeight: 1.12,
        semanticTag: 'h2',
      }));

      b.add('desc', makeText(
        makeId('faq-desc'),
        'Intro Copy',
        'Everything your design and engineering team needs to know about licensing, code ownership, and custom typography.',
        x + 56,
        y + 188,
        332,
        74,
        {
          parentId: root.id,
          fill: '#57534E',
          fontSize: 14.5,
          fontWeight: 400,
          fontFamily: FONT_BODY,
          lineHeight: 1.55,
        },
      ));

      const contactBtn = b.add(
        'contactBtn',
        makeRect(makeId('faq-cta'), 'Contact Support Button', x + 56, y + 286, 200, 46, {
          parentId: root.id,
          fill: '#1C1917',
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#292524',
        }),
      );
      b.add('contactTxt', makeText(makeId('faq-cta-t'), 'Contact Button Label', 'Talk to Engineering →', x + 56, y + 299, 200, 20, {
        parentId: root.id,
        fill: '#FFFFFF',
        fontSize: 13.5,
        fontWeight: 600,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const faqs = [
        {
          key: 'q1',
          q: 'Do we own 100% of the exported React & CSS code?',
          a: 'Yes. Exports contain zero proprietary runtime dependencies — standard semantic HTML, CSS custom properties, and clean TypeScript components.',
          openInitially: true,
        },
        {
          key: 'q2',
          q: 'Can we upload our own licensed brand fonts?',
          a: 'Yes. Upload .woff2, .woff, .ttf, or .otf font files directly in the Typography Inspector. They embed cleanly in preview and exports.',
          openInitially: false,
        },
        {
          key: 'q3',
          q: 'How does Node Logic interact with components?',
          a: 'Every UI widget and page template ships with typed variables, event triggers, and actions that run deterministically in Live Preview.',
          openInitially: false,
        },
      ] as const;

      const faqRefs: { key: string; hdrId: string; ansId: string; iconId: string; openInitially: boolean }[] = [];

      faqs.forEach((item, idx) => {
        const fy = y + 54 + idx * 150;
        const card = b.add(
          `card-${item.key}`,
          makeFrame(makeId(`faq-c-${item.key}`), `FAQ Item ${idx + 1}`, x + 440, fy, 624, 134, {
            parentId: root.id,
            fill: '#FFFFFF',
            stroke: '#E7E5E4',
            strokeWidth: 1,
            radius: 14,
          }),
        );

        const hdr = b.add(
          `hdr-${item.key}`,
          makeRect(makeId(`faq-h-${item.key}`), `FAQ ${idx + 1} Header`, x + 452, fy + 10, 600, 44, {
            parentId: card.id,
            fill: item.openInitially ? '#EEF2FF' : '#FAFAF9',
            radius: 9,
            semanticTag: 'button',
            cursor: 'pointer',
            hoverFill: '#F1F5F9',
          }),
        );

        b.add(`qt-${item.key}`, makeText(makeId(`faq-qt-${item.key}`), `FAQ ${idx + 1} Question`, item.q, x + 468, fy + 22, 520, 22, {
          parentId: card.id,
          fill: '#1C1917',
          fontSize: 14.5,
          fontWeight: 700,
          fontFamily: FONT_SANS,
          cursor: 'pointer',
        }));

        const icon = b.add(`ic-${item.key}`, makeText(makeId(`faq-ic-${item.key}`), `FAQ ${idx + 1} Icon`, item.openInitially ? '−' : '+', x + 1012, fy + 20, 28, 24, {
          parentId: card.id,
          fill: '#4F46E5',
          fontSize: 19,
          fontWeight: 700,
          textAlign: 'center',
          cursor: 'pointer',
        }));

        const ans = b.add(`an-${item.key}`, makeText(makeId(`faq-an-${item.key}`), `FAQ ${idx + 1} Answer`, item.a, x + 468, fy + 64, 568, 56, {
          parentId: card.id,
          fill: '#57534E',
          fontSize: 13.5,
          fontWeight: 400,
          fontFamily: FONT_BODY,
          lineHeight: 1.5,
          visible: item.openInitially,
        }));

        faqRefs.push({ key: item.key, hdrId: hdr.id, ansId: ans.id, iconId: icon.id, openInitially: item.openInitially });
      });

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'FAQ Accordion Section Logic', logicTarget.scope, logicTarget.targetId);

        faqRefs.forEach((ref, idx) => {
          const baseRow = idx * 2;
          const v = g.variable(ref.key, `faq${idx + 1}Open`, 'boolean', ref.openInitially);
          const ev = g.node(`ev-${ref.key}`, 'event.on-click', 0, baseRow, { targetNodeId: ref.hdrId }, `Click FAQ ${idx + 1}`);
          const tgl = g.node(`tgl-${ref.key}`, 'state.toggle', 1, baseRow, { variableId: v });
          const br = g.node(`br-${ref.key}`, 'logic.branch', 2, baseRow, { mode: 'if-else' });

          const show = g.node(`sh-${ref.key}`, 'action.set-layer', 3, baseRow, { targetNodeId: ref.ansId, property: 'visible', visibleMode: 'show' });
          const icO = g.node(`io-${ref.key}`, 'action.set-layer', 4, baseRow, { targetNodeId: ref.iconId, property: 'text', text: '−' });
          const bgO = g.node(`bo-${ref.key}`, 'action.set-layer', 5, baseRow, { targetNodeId: ref.hdrId, property: 'fill', fill: '#EEF2FF' });

          const hide = g.node(`hd-${ref.key}`, 'action.set-layer', 3, baseRow + 1, { targetNodeId: ref.ansId, property: 'visible', visibleMode: 'hide' });
          const icC = g.node(`ic-${ref.key}`, 'action.set-layer', 4, baseRow + 1, { targetNodeId: ref.iconId, property: 'text', text: '+' });
          const bgC = g.node(`bc-${ref.key}`, 'action.set-layer', 5, baseRow + 1, { targetNodeId: ref.hdrId, property: 'fill', fill: '#FAFAF9' });

          g.chain([ev, tgl, br]);
          g.connect(tgl, 'result', br, 'condition');

          g.connect(br, 'true', show, 'exec');
          g.chain([show, icO, bgO], 'next');

          g.connect(br, 'false', hide, 'exec');
          g.chain([hide, icC, bgC], 'next');
        });

        const onContact = g.node('on-contact', 'event.on-click', 0, 6, { targetNodeId: contactBtn.id }, 'Click Support CTA');
        const contactToast = g.node('contact-toast', 'action.overlay-toast', 1, 6, { mode: 'show-toast', tone: 'info', message: 'Engineering support channel opened.' });
        g.connect(onContact, 'exec', contactToast, 'exec');

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 5. Interactive Editorial Testimonial Switcher
  buildSectionDef(
    {
      id: 'section-testimonial-switcher',
      name: 'Interactive Customer Proof Switcher',
      category: 'sections',
      summary: 'Warm editorial testimonial section with 3 company selectors dynamically switching quote, author, and verified metric.',
      keywords: ['testimonial', 'reviews', 'proof', 'quote', 'customers', 'switcher', 'section'],
      width: 1120,
      height: 430,
      previewSurface: 'light',
      logicHighlights: ['3 customer story tabs', 'Dynamic serif quote', 'Live author & metric'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('tst-root'), 'Customer Proof Section', x, y, 1120, 430, {
          fill: '#F7F5F0',
          stroke: '#E5E0D8',
          strokeWidth: 1,
          radius: 20,
          isSection: true,
          semanticTag: 'section',
        }),
      );

      b.add('kicker', makeText(makeId('tst-k'), 'Eyebrow', 'VERIFIED CUSTOMER OUTCOMES', x + 64, y + 48, 300, 18, {
        parentId: root.id,
        fill: '#B45309',
        fontSize: 11.5,
        fontWeight: 700,
        fontFamily: FONT_MONO,
        letterSpacing: 1.1,
      }));

      const stories = [
        {
          key: 'linearis',
          company: 'Linearis',
          quote: '“We cut design-to-production handoff from three weeks down to a single afternoon without sacrificing a pixel of craft.”',
          author: 'Maya Lin · VP of Design Engineering, Linearis',
          metric: '4.6× faster release velocity',
        },
        {
          key: 'veloce',
          company: 'Veloce Labs',
          quote: '“Having visual layouts, custom brand typography, and real Node Logic in one file transformed how our team prototypes.”',
          author: 'Henrik Solberg · Principal Product Designer, Veloce Labs',
          metric: '68% fewer front-end regressions',
        },
        {
          key: 'northstar',
          company: 'Northstar Pay',
          quote: '“Our marketing and core product teams now ship interactive pricing and checkout flows directly from shared master components.”',
          author: 'Amina Osei · Head of Web Experience, Northstar Pay',
          metric: '+31% self-serve conversion lift',
        },
      ] as const;

      const quoteTxt = b.add('quoteTxt', makeText(makeId('tst-q'), 'Customer Quote', stories[0].quote, x + 64, y + 84, 992, 132, {
        parentId: root.id,
        fill: '#1C1917',
        fontSize: 34,
        fontWeight: 400,
        fontFamily: FONT_EDITORIAL,
        lineHeight: 1.24,
      }));

      const authorTxt = b.add('authorTxt', makeText(makeId('tst-a'), 'Author Attribution', stories[0].author, x + 64, y + 236, 620, 24, {
        parentId: root.id,
        fill: '#44403C',
        fontSize: 15,
        fontWeight: 600,
        fontFamily: FONT_SANS,
      }));

      const metricTxt = b.add('metricTxt', makeText(makeId('tst-m'), 'Impact Metric', stories[0].metric, x + 700, y + 236, 356, 24, {
        parentId: root.id,
        fill: '#0F766E',
        fontSize: 14,
        fontWeight: 700,
        fontFamily: FONT_MONO,
        textAlign: 'right',
      }));

      b.add('rule', makeRect(makeId('tst-rule'), 'Divider Rule', x + 64, y + 286, 992, 1, {
        parentId: root.id,
        fill: '#DDD6CA',
        radius: 0,
      }));

      const btnIds: Record<string, string> = {};
      stories.forEach((story, idx) => {
        const bx = x + 64 + idx * 340;
        const btn = b.add(
          `btn-${story.key}`,
          makeRect(makeId(`tst-b-${story.key}`), `Select ${story.company}`, bx, y + 314, 312, 62, {
            parentId: root.id,
            fill: idx === 0 ? '#1C1917' : '#ECE8DF',
            radius: 12,
            semanticTag: 'button',
            cursor: 'pointer',
            hoverFill: idx === 0 ? '#1C1917' : '#E2DDD2',
          }),
        );
        btnIds[story.key] = btn.id;

        b.add(`bt-${story.key}`, makeText(makeId(`tst-bt-${story.key}`), `${story.company} Label`, story.company, bx + 20, y + 334, 272, 22, {
          parentId: root.id,
          fill: idx === 0 ? '#FFFFFF' : '#292524',
          fontSize: 15,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
          textAlign: 'center',
          cursor: 'pointer',
        }));
      });

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Testimonial Switcher Logic', logicTarget.scope, logicTarget.targetId);
        const storyVar = g.variable('story', 'activeCustomerStory', 'string', 'linearis');

        stories.forEach((story, idx) => {
          const fills = [
            idx === 0 ? '#1C1917' : '#ECE8DF',
            idx === 1 ? '#1C1917' : '#ECE8DF',
            idx === 2 ? '#1C1917' : '#ECE8DF',
          ];
          const ev = g.node(`ev-${story.key}`, 'event.on-click', 0, idx, { targetNodeId: btnIds[story.key] }, `Story: ${story.company}`);
          const sv = g.node(`sv-${story.key}`, 'state.update', 1, idx, { variableId: storyVar, operation: 'set', value: story.key });
          const b0 = g.node(`b0-${story.key}`, 'action.set-layer', 2, idx, { targetNodeId: btnIds.linearis, property: 'fill', fill: fills[0] });
          const b1 = g.node(`b1-${story.key}`, 'action.set-layer', 3, idx, { targetNodeId: btnIds.veloce, property: 'fill', fill: fills[1] });
          const b2 = g.node(`b2-${story.key}`, 'action.set-layer', 4, idx, { targetNodeId: btnIds.northstar, property: 'fill', fill: fills[2] });
          const sq = g.node(`sq-${story.key}`, 'action.set-layer', 5, idx, { targetNodeId: quoteTxt.id, property: 'text', text: story.quote });
          const sa = g.node(`sa-${story.key}`, 'action.set-layer', 6, idx, { targetNodeId: authorTxt.id, property: 'text', text: story.author });
          const sm = g.node(`sm-${story.key}`, 'action.set-layer', 7, idx, { targetNodeId: metricTxt.id, property: 'text', text: story.metric });
          g.chain([ev, sv, b0, b1, b2, sq, sa, sm]);
        });

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 6. Interactive Conversion CTA Banner with Team Tier Selector & Email Validation
  buildSectionDef(
    {
      id: 'section-cta-lead-capture',
      name: 'Interactive Lead Capture Banner',
      category: 'sections',
      summary: 'High-contrast conversion section with team-size selector tabs, real email input, validation logic, and toast.',
      keywords: ['cta', 'banner', 'lead', 'capture', 'signup', 'form', 'conversion', 'section'],
      width: 1120,
      height: 360,
      previewSurface: 'dark',
      logicHighlights: ['Team tier selector', 'Live email input & validation', 'Tailored confirmation & toast'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('cta-root'), 'Lead Capture CTA Banner', x, y, 1120, 360, {
          fill: '#0F172A',
          fills: [
            makeLinearGradient(makeId('bg'), 135, [
              { offset: 0, color: '#0F172A' },
              { offset: 0.55, color: '#1E1B4B' },
              { offset: 1, color: '#0F172A' },
            ]),
          ],
          stroke: '#312E81',
          strokeWidth: 1,
          radius: 22,
          isSection: true,
          semanticTag: 'section',
        }),
      );

      b.add('h2', makeText(makeId('cta-h2'), 'Banner Headline', 'Ready to unify design, logic, and production code?', x + 64, y + 48, 680, 44, {
        parentId: root.id,
        fill: '#FFFFFF',
        fontSize: 32,
        fontWeight: 700,
        fontFamily: FONT_DISPLAY,
        semanticTag: 'h2',
      }));

      const tierNote = b.add('tierNote', makeText(makeId('cta-note'), 'Recommendation Note', 'Team (5–25 seats) · Includes shared design tokens & review links.', x + 64, y + 100, 740, 22, {
        parentId: root.id,
        fill: '#A5B4FC',
        fontSize: 14.5,
        fontWeight: 500,
        fontFamily: FONT_BODY,
      }));

      const tiers = [
        { key: 'solo', label: 'Solo Creator', note: 'Solo · Free personal workspace with unlimited static exports.' },
        { key: 'team', label: 'Team (5–25)', note: 'Team (5–25 seats) · Includes shared design tokens & review links.' },
        { key: 'org', label: 'Enterprise 25+', note: 'Enterprise · Dedicated SSO, audit logs & 99.99% uptime SLA.' },
      ] as const;

      const tierBtnIds: Record<string, string> = {};
      tiers.forEach((tier, idx) => {
        const bx = x + 64 + idx * 172;
        const btn = b.add(
          `tb-${tier.key}`,
          makeRect(makeId(`cta-tb-${tier.key}`), `Tier ${tier.label}`, bx, y + 146, 158, 38, {
            parentId: root.id,
            fill: idx === 1 ? '#4F46E5' : '#1E293B',
            stroke: '#475569',
            strokeWidth: 1,
            radius: 10,
            semanticTag: 'button',
            cursor: 'pointer',
          }),
        );
        tierBtnIds[tier.key] = btn.id;
        b.add(`tbt-${tier.key}`, makeText(makeId(`cta-tbt-${tier.key}`), `${tier.label} Text`, tier.label, bx, y + 156, 158, 18, {
          parentId: root.id,
          fill: '#F8FAFC',
          fontSize: 12.5,
          fontWeight: 600,
          textAlign: 'center',
          cursor: 'pointer',
        }));
      });

      const emailInput = b.add(
        'emailInput',
        makeRect(makeId('cta-email'), 'Work Email Input', x + 64, y + 214, 412, 50, {
          parentId: root.id,
          fill: '#0B1120',
          stroke: '#475569',
          strokeWidth: 1,
          radius: 12,
          semanticTag: 'input',
        }),
      );

      const submitBtn = b.add(
        'submitBtn',
        makeRect(makeId('cta-sub'), 'Request Access CTA', x + 490, y + 214, 210, 50, {
          parentId: root.id,
          fill: '#38BDF8',
          radius: 12,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#0EA5E9',
        }),
      );
      b.add('submitTxt', makeText(makeId('cta-sub-t'), 'Request Access Label', 'Request Early Access', x + 490, y + 229, 210, 20, {
        parentId: root.id,
        fill: '#082F49',
        fontSize: 14,
        fontWeight: 700,
        textAlign: 'center',
        cursor: 'pointer',
      }));

      const formFeedback = b.add('formFeedback', makeText(makeId('cta-fb'), 'Form Feedback', 'Enter your work email above to receive instant sandbox credentials.', x + 64, y + 284, 720, 20, {
        parentId: root.id,
        fill: '#94A3B8',
        fontSize: 12.5,
        fontWeight: 500,
      }));

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Lead Capture Banner Logic', logicTarget.scope, logicTarget.targetId);
        const tierVar = g.variable('tier', 'teamTier', 'string', 'Team (5–25)');
        const emailVar = g.variable('email', 'workEmail', 'string', '');

        tiers.forEach((tier, idx) => {
          const fills = [
            idx === 0 ? '#4F46E5' : '#1E293B',
            idx === 1 ? '#4F46E5' : '#1E293B',
            idx === 2 ? '#4F46E5' : '#1E293B',
          ];
          const ev = g.node(`ev-${tier.key}`, 'event.on-click', 0, idx, { targetNodeId: tierBtnIds[tier.key] }, `Select ${tier.label}`);
          const sv = g.node(`sv-${tier.key}`, 'state.update', 1, idx, { variableId: tierVar, operation: 'set', value: tier.label });
          const b0 = g.node(`b0-${tier.key}`, 'action.set-layer', 2, idx, { targetNodeId: tierBtnIds.solo, property: 'fill', fill: fills[0] });
          const b1 = g.node(`b1-${tier.key}`, 'action.set-layer', 3, idx, { targetNodeId: tierBtnIds.team, property: 'fill', fill: fills[1] });
          const b2 = g.node(`b2-${tier.key}`, 'action.set-layer', 4, idx, { targetNodeId: tierBtnIds.org, property: 'fill', fill: fills[2] });
          const sn = g.node(`sn-${tier.key}`, 'action.set-layer', 5, idx, { targetNodeId: tierNote.id, property: 'text', text: tier.note });
          g.chain([ev, sv, b0, b1, b2, sn]);
        });

        const onIn = g.node('on-in', 'event.on-input', 0, 3, { targetNodeId: emailInput.id }, 'Type Work Email');
        const saveIn = g.node('save-in', 'state.update', 1, 3, { variableId: emailVar, operation: 'set' });
        g.connect(onIn, 'exec', saveIn, 'exec');
        g.connect(onIn, 'value', saveIn, 'value');

        const onSub = g.node('on-sub', 'event.on-click', 0, 4, { targetNodeId: submitBtn.id }, 'Submit Access');
        const getEm = g.node('get-em', 'state.get', 1, 5, { variableId: emailVar });
        const checkEmpty = g.node('chk-em', 'logic.condition', 2, 5, { mode: 'is-empty' });
        const br = g.node('br-em', 'logic.branch', 2, 4, { mode: 'if-else' });

        const errFb = g.node('err-fb', 'action.set-layer', 3, 4, { targetNodeId: formFeedback.id, property: 'text', text: 'Please enter a valid work email before requesting access.' });
        const errTst = g.node('err-tst', 'action.overlay-toast', 4, 4, { mode: 'show-toast', tone: 'warning', message: 'Work email required.' });

        const fmtOk = g.node('fmt-ok', 'logic.text', 3, 5, { mode: 'template', template: '✓ Access invite sent to {{workEmail}} for {{teamTier}}.' });
        const okFb = g.node('ok-fb', 'action.set-layer', 4, 5, { targetNodeId: formFeedback.id, property: 'text', text: 'Access invite sent!' });
        const okTst = g.node('ok-tst', 'action.overlay-toast', 5, 5, { mode: 'show-toast', tone: 'success', message: 'Access invite dispatched!' });

        g.connect(onSub, 'exec', br, 'exec');
        g.connect(getEm, 'value', checkEmpty, 'left');
        g.connect(checkEmpty, 'result', br, 'condition');

        g.connect(br, 'true', errFb, 'exec');
        g.connect(errFb, 'next', errTst, 'exec');

        g.connect(br, 'false', okFb, 'exec');
        g.connect(fmtOk, 'text', okFb, 'value');
        g.connect(okFb, 'next', okTst, 'exec');

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),
];
