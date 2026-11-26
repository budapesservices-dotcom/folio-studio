import {
  FONT_BODY,
  FONT_DISPLAY,
  FONT_EDITORIAL,
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

function buildPageDef(
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

export const PAGE_TEMPLATES: readonly StudioTemplateDefinition[] = [
  // 1. SaaS Product Landing Page (Hero tabs + Monthly/Annual Pricing + FAQ Accordion + Navbar CTAs)
  buildPageDef(
    {
      id: 'page-saas-landing',
      name: 'SaaS Product Landing Page',
      category: 'pages',
      summary: 'Complete dark SaaS landing page with interactive hero stage tabs, live Monthly/Annual pricing switcher, FAQ disclosure, and wired CTAs.',
      keywords: ['page', 'landing', 'saas', 'startup', 'pricing', 'hero', 'faq', 'full page', 'website'],
      width: 1200,
      height: 1560,
      previewSurface: 'dark',
      pageBackground: '#090D16',
      logicHighlights: ['3-tab hero stage switcher', 'Monthly/Annual pricing toggle', 'Expandable FAQ & wired CTAs'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('lp-root'), 'SaaS Landing Page', x, y, 1200, 1560, {
          fill: '#090D16',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 0,
          clipContent: true,
          semanticTag: 'main',
        }),
      );

      // ── Navbar ──────────────────────────────────────────────────────
      const nav = b.add(
        'nav',
        makeFrame(makeId('lp-nav'), 'Top Navigation', x, y, 1200, 76, {
          parentId: root.id,
          fill: '#0B1120',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 0,
          semanticTag: 'header',
        }),
      );

      b.add(
        'brandMark',
        makeRect(makeId('lp-brand-mark'), 'Brand Emblem', x + 56, y + 23, 30, 30, {
          parentId: nav.id,
          fill: '#2563EB',
          fills: [
            makeLinearGradient(makeId('lp-bgrad'), 135, [
              { offset: 0, color: '#3B82F6' },
              { offset: 1, color: '#6366F1' },
            ]),
          ],
          radius: 8,
        }),
      );

      b.add(
        'brandName',
        makeText(makeId('lp-brand-name'), 'Brand Name', 'VERDANT', x + 98, y + 27, 136, 22, {
          parentId: nav.id,
          fill: '#F8FAFC',
          fontSize: 16,
          fontWeight: 800,
          fontFamily: FONT_DISPLAY,
          letterSpacing: 1.4,
        }),
      );

      const navItems = ['Platform', 'Workflow', 'Pricing', 'Docs'];
      navItems.forEach((label, idx) => {
        b.add(
          `navLink${idx}`,
          makeText(makeId(`lp-nav-${idx}`), `Nav Link ${label}`, label, x + 410 + idx * 102, y + 28, 86, 20, {
            parentId: nav.id,
            fill: '#94A3B8',
            fontSize: 14,
            fontWeight: 500,
            fontFamily: FONT_BODY,
          }),
        );
      });

      const navCta = b.add(
        'navCta',
        makeFrame(makeId('lp-nav-cta'), 'Nav Start Free Button', x + 1004, y + 18, 140, 40, {
          parentId: nav.id,
          fill: '#2563EB',
          stroke: '#60A5FA',
          strokeWidth: 1,
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#1D4ED8',
          transition: 'all 180ms ease',
        }),
      );
      b.add(
        'navCtaTxt',
        makeText(makeId('lp-nav-cta-txt'), 'Nav CTA Label', 'Start Free', x + 1004, y + 28, 140, 20, {
          parentId: navCta.id,
          fill: '#FFFFFF',
          fontSize: 13.5,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      // ── Hero Section ────────────────────────────────────────────────
      b.add(
        'heroKicker',
        makeText(makeId('lp-kicker'), 'Hero Kicker', 'VISUAL FULL-STACK STUDIO · V4.2', x + 56, y + 132, 340, 18, {
          parentId: root.id,
          fill: '#60A5FA',
          fontSize: 11.5,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 1.2,
        }),
      );

      b.add(
        'heroH1',
        makeText(makeId('lp-h1'), 'Hero Headline', 'Design, wire logic, and ship real interfaces.', x + 56, y + 162, 510, 174, {
          parentId: root.id,
          fill: '#F8FAFC',
          fontSize: 52,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
          lineHeight: 1.08,
          letterSpacing: -1.4,
          semanticTag: 'h1',
        }),
      );

      b.add(
        'heroCopy',
        makeText(
          makeId('lp-copy'),
          'Hero Description',
          'Craft responsive layouts, connect live state and interactions visually, and export clean React or static production code without leaving your canvas.',
          x + 56,
          y + 354,
          480,
          76,
          {
            parentId: root.id,
            fill: '#94A3B8',
            fontSize: 16,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.58,
          },
        ),
      );

      const heroPrimary = b.add(
        'heroPrimary',
        makeFrame(makeId('lp-hero-pri'), 'Hero Primary CTA', x + 56, y + 456, 198, 48, {
          parentId: root.id,
          fill: '#2563EB',
          fills: [
            makeLinearGradient(makeId('lp-hgrad'), 135, [
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
          effects: [makeDropShadow(makeId('lp-psh'), 12, 28, 'rgba(37, 99, 235, 0.35)')],
        }),
      );
      b.add(
        'heroPrimaryTxt',
        makeText(makeId('lp-hero-pri-txt'), 'Primary CTA Label', 'Create Workspace', x + 56, y + 470, 198, 20, {
          parentId: heroPrimary.id,
          fill: '#FFFFFF',
          fontSize: 14.5,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const heroSecondary = b.add(
        'heroSecondary',
        makeFrame(makeId('lp-hero-sec'), 'Hero Secondary CTA', x + 268, y + 456, 178, 48, {
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
      b.add(
        'heroSecondaryTxt',
        makeText(makeId('lp-hero-sec-txt'), 'Secondary CTA Label', 'Watch 90s Tour', x + 268, y + 470, 178, 20, {
          parentId: heroSecondary.id,
          fill: '#E2E8F0',
          fontSize: 14.5,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      // Right Interactive Stage Panel
      const stageCard = b.add(
        'stageCard',
        makeFrame(makeId('lp-stage'), 'Interactive Stage Panel', x + 604, y + 128, 540, 388, {
          parentId: root.id,
          fill: '#111827',
          stroke: '#1E293B',
          strokeWidth: 1.5,
          radius: 20,
          clipContent: true,
          effects: [makeDropShadow(makeId('lp-ssh'), 20, 48, 'rgba(0, 0, 0, 0.45)')],
        }),
      );

      const tabBar = b.add(
        'tabBar',
        makeFrame(makeId('lp-tabbar'), 'Stage Tab Bar', x + 628, y + 152, 492, 44, {
          parentId: stageCard.id,
          fill: '#090D16',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 12,
        }),
      );

      const tabCanvas = b.add(
        'tabCanvas',
        makeFrame(makeId('lp-tab-canvas'), 'Canvas Mode Tab', x + 634, y + 158, 156, 32, {
          parentId: tabBar.id,
          fill: '#2563EB',
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'background-color 180ms ease',
        }),
      );
      b.add(
        'tabCanvasTxt',
        makeText(makeId('lp-tab-canvas-txt'), 'Canvas Tab Label', '01 · Canvas', x + 634, y + 165, 156, 18, {
          parentId: tabCanvas.id,
          fill: '#FFFFFF',
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: FONT_MONO,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const tabLogic = b.add(
        'tabLogic',
        makeFrame(makeId('lp-tab-logic'), 'Logic Mode Tab', x + 796, y + 158, 156, 32, {
          parentId: tabBar.id,
          fill: 'transparent',
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'background-color 180ms ease',
        }),
      );
      b.add(
        'tabLogicTxt',
        makeText(makeId('lp-tab-logic-txt'), 'Logic Tab Label', '02 · Logic', x + 796, y + 165, 156, 18, {
          parentId: tabLogic.id,
          fill: '#CBD5E1',
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: FONT_MONO,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const tabCode = b.add(
        'tabCode',
        makeFrame(makeId('lp-tab-code'), 'Code Mode Tab', x + 958, y + 158, 156, 32, {
          parentId: tabBar.id,
          fill: 'transparent',
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'background-color 180ms ease',
        }),
      );
      b.add(
        'tabCodeTxt',
        makeText(makeId('lp-tab-code-txt'), 'Code Tab Label', '03 · Code', x + 958, y + 165, 156, 18, {
          parentId: tabCode.id,
          fill: '#CBD5E1',
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: FONT_MONO,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const stageBadge = b.add(
        'stageBadge',
        makeText(makeId('lp-stage-badge'), 'Stage Telemetry', '60 FPS · VECTOR AST ACTIVE', x + 634, y + 224, 340, 18, {
          parentId: stageCard.id,
          fill: '#38BDF8',
          fontSize: 11.5,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 0.9,
        }),
      );

      const stageTitle = b.add(
        'stageTitle',
        makeText(makeId('lp-stage-title'), 'Stage Title', 'Direct Manipulation Canvas', x + 634, y + 252, 468, 34, {
          parentId: stageCard.id,
          fill: '#F8FAFC',
          fontSize: 25,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );

      const stageBody = b.add(
        'stageBody',
        makeText(
          makeId('lp-stage-body'),
          'Stage Body',
          'Precision auto-layout frames, reusable master components, and Bezier vector paths backed by one deterministic document tree.',
          x + 634,
          y + 296,
          468,
          68,
          {
            parentId: stageCard.id,
            fill: '#94A3B8',
            fontSize: 14.5,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.55,
          },
        ),
      );

      const stageMetricBar = b.add(
        'stageMetricBar',
        makeFrame(makeId('lp-stage-mbar'), 'Stage Status Strip', x + 634, y + 392, 480, 96, {
          parentId: stageCard.id,
          fill: '#090D16',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 12,
        }),
      );
      const stageCodeLine = b.add(
        'stageCodeLine',
        makeText(
          makeId('lp-stage-code'),
          'Stage Code Snippet',
          'ast.frame("Hero") -> layout(flex-row, gap: 24) · 0 warnings',
          x + 654,
          y + 428,
          440,
          24,
          {
            parentId: stageMetricBar.id,
            fill: '#A5F3FC',
            fontSize: 12.5,
            fontWeight: 500,
            fontFamily: FONT_MONO,
          },
        ),
      );

      // ── 3-Column Metrics Strip ──────────────────────────────────────
      const metricsStrip = b.add(
        'metricsStrip',
        makeFrame(makeId('lp-metrics'), 'Metrics Strip', x + 56, y + 572, 1088, 120, {
          parentId: root.id,
          fill: '#0F172A',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 16,
        }),
      );

      const metrics = [
        { val: '14.2 ms', lbl: 'Average live preview rebuild time across full multi-page apps' },
        { val: '100%', lbl: 'Native AST fidelity between visual layers and React/HTML export' },
        { val: 'Zero', lbl: 'Runtime vendor lock-in — export standard portable code anytime' },
      ];
      metrics.forEach((m, i) => {
        const mx = x + 92 + i * 356;
        b.add(
          `metricVal${i}`,
          makeText(makeId(`lp-mval-${i}`), `Metric Value ${i + 1}`, m.val, mx, y + 596, 300, 36, {
            parentId: metricsStrip.id,
            fill: '#F8FAFC',
            fontSize: 28,
            fontWeight: 700,
            fontFamily: FONT_DISPLAY,
          }),
        );
        b.add(
          `metricLbl${i}`,
          makeText(makeId(`lp-mlbl-${i}`), `Metric Caption ${i + 1}`, m.lbl, mx, y + 638, 308, 40, {
            parentId: metricsStrip.id,
            fill: '#94A3B8',
            fontSize: 13,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.45,
          }),
        );
      });

      // ── Interactive Pricing Preview Section ─────────────────────────
      b.add(
        'pricingHeading',
        makeText(makeId('lp-pr-h2'), 'Pricing Section Heading', 'Transparent team pricing', x + 56, y + 748, 420, 38, {
          parentId: root.id,
          fill: '#F8FAFC',
          fontSize: 32,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
          semanticTag: 'h2',
        }),
      );

      const pricingNote = b.add(
        'pricingNote',
        makeText(makeId('lp-pr-note'), 'Billing Cadence Note', 'Billed monthly · Switch to annual to save 20%', x + 56, y + 792, 420, 22, {
          parentId: root.id,
          fill: '#94A3B8',
          fontSize: 14,
          fontWeight: 400,
          fontFamily: FONT_BODY,
        }),
      );

      const billingWrap = b.add(
        'billingWrap',
        makeFrame(makeId('lp-bill-wrap'), 'Billing Switcher', x + 884, y + 756, 260, 44, {
          parentId: root.id,
          fill: '#111827',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 12,
        }),
      );

      const billMonthly = b.add(
        'billMonthly',
        makeFrame(makeId('lp-bill-mo'), 'Monthly Billing Button', x + 890, y + 762, 118, 32, {
          parentId: billingWrap.id,
          fill: '#2563EB',
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'background-color 180ms ease',
        }),
      );
      b.add(
        'billMonthlyTxt',
        makeText(makeId('lp-bill-mo-txt'), 'Monthly Label', 'Monthly', x + 890, y + 769, 118, 18, {
          parentId: billMonthly.id,
          fill: '#FFFFFF',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const billAnnual = b.add(
        'billAnnual',
        makeFrame(makeId('lp-bill-yr'), 'Annual Billing Button', x + 1012, y + 762, 126, 32, {
          parentId: billingWrap.id,
          fill: 'transparent',
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'background-color 180ms ease',
        }),
      );
      b.add(
        'billAnnualTxt',
        makeText(makeId('lp-bill-yr-txt'), 'Annual Label', 'Annual -20%', x + 1012, y + 769, 126, 18, {
          parentId: billAnnual.id,
          fill: '#CBD5E1',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      // Starter Card
      const starterCard = b.add(
        'starterCard',
        makeFrame(makeId('lp-plan-starter'), 'Starter Plan Card', x + 56, y + 844, 528, 324, {
          parentId: root.id,
          fill: '#0F172A',
          stroke: '#1E293B',
          strokeWidth: 1.5,
          radius: 18,
        }),
      );
      b.add(
        'starterName',
        makeText(makeId('lp-st-name'), 'Starter Plan Title', 'Creator', x + 88, y + 876, 220, 26, {
          parentId: starterCard.id,
          fill: '#F8FAFC',
          fontSize: 20,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );
      const starterPrice = b.add(
        'starterPrice',
        makeText(makeId('lp-st-price'), 'Starter Plan Price', '$19 / mo', x + 88, y + 914, 240, 48, {
          parentId: starterCard.id,
          fill: '#FFFFFF',
          fontSize: 38,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );
      b.add(
        'starterPerks',
        makeText(
          makeId('lp-st-perks'),
          'Starter Perks',
          '• Unlimited pages & reusable components\n• Complete Node Logic & Motion Timeline\n• Static HTML/CSS and React TSX export',
          x + 88,
          y + 976,
          440,
          82,
          {
            parentId: starterCard.id,
            fill: '#94A3B8',
            fontSize: 14,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.65,
          },
        ),
      );
      const starterCta = b.add(
        'starterCta',
        makeFrame(makeId('lp-st-cta'), 'Choose Creator Button', x + 88, y + 1084, 464, 46, {
          parentId: starterCard.id,
          fill: '#1E293B',
          stroke: '#334155',
          strokeWidth: 1,
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#334155',
        }),
      );
      b.add(
        'starterCtaTxt',
        makeText(makeId('lp-st-cta-txt'), 'Creator CTA Label', 'Start Creator Plan', x + 88, y + 1097, 464, 20, {
          parentId: starterCta.id,
          fill: '#F8FAFC',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      // Studio Pro Card
      const proCard = b.add(
        'proCard',
        makeFrame(makeId('lp-plan-pro'), 'Studio Pro Plan Card', x + 616, y + 844, 528, 324, {
          parentId: root.id,
          fill: '#111A30',
          stroke: '#3B82F6',
          strokeWidth: 2,
          radius: 18,
          effects: [makeDropShadow(makeId('lp-prosh'), 16, 40, 'rgba(37, 99, 235, 0.22)')],
        }),
      );
      b.add(
        'proName',
        makeText(makeId('lp-pr-name'), 'Studio Pro Title', 'Studio Team', x + 648, y + 876, 220, 26, {
          parentId: proCard.id,
          fill: '#F8FAFC',
          fontSize: 20,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );
      const proPrice = b.add(
        'proPrice',
        makeText(makeId('lp-pr-price'), 'Studio Pro Price', '$49 / mo', x + 648, y + 914, 240, 48, {
          parentId: proCard.id,
          fill: '#60A5FA',
          fontSize: 38,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );
      b.add(
        'proPerks',
        makeText(
          makeId('lp-pr-perks'),
          'Studio Pro Perks',
          '• Shared design token libraries & custom fonts\n• Multi-page interactive logic & version snapshots\n• Priority CI bundle deployment & team SSO',
          x + 648,
          y + 976,
          440,
          82,
          {
            parentId: proCard.id,
            fill: '#CBD5E1',
            fontSize: 14,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.65,
          },
        ),
      );
      const proCta = b.add(
        'proCta',
        makeFrame(makeId('lp-pr-cta'), 'Choose Studio Team Button', x + 648, y + 1084, 464, 46, {
          parentId: proCard.id,
          fill: '#2563EB',
          stroke: '#60A5FA',
          strokeWidth: 1,
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#1D4ED8',
        }),
      );
      b.add(
        'proCtaTxt',
        makeText(makeId('lp-pr-cta-txt'), 'Studio Team CTA Label', 'Upgrade to Studio Team', x + 648, y + 1097, 464, 20, {
          parentId: proCta.id,
          fill: '#FFFFFF',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      // ── Interactive FAQ Disclosure ──────────────────────────────────
      const faqHeader = b.add(
        'faqHeader',
        makeFrame(makeId('lp-faq-btn'), 'FAQ Toggle Row', x + 56, y + 1220, 1088, 64, {
          parentId: root.id,
          fill: '#0F172A',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 14,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#152036',
        }),
      );
      b.add(
        'faqQuestion',
        makeText(
          makeId('lp-faq-q'),
          'FAQ Question',
          'Does exported production code preserve interactive Node Logic and custom fonts?',
          x + 84,
          y + 1241,
          960,
          22,
          {
            parentId: faqHeader.id,
            fill: '#F8FAFC',
            fontSize: 15.5,
            fontWeight: 600,
            fontFamily: FONT_SANS,
            cursor: 'pointer',
          },
        ),
      );
      const faqIcon = b.add(
        'faqIcon',
        makeText(makeId('lp-faq-ico'), 'FAQ Indicator', '+', x + 1088, y + 1238, 32, 26, {
          parentId: faqHeader.id,
          fill: '#60A5FA',
          fontSize: 22,
          fontWeight: 600,
          fontFamily: FONT_MONO,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const faqAnswer = b.add(
        'faqAnswer',
        makeFrame(makeId('lp-faq-ans'), 'FAQ Answer Panel', x + 56, y + 1294, 1088, 86, {
          parentId: root.id,
          fill: '#111827',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 12,
          visible: false,
        }),
      );
      b.add(
        'faqAnswerTxt',
        makeText(
          makeId('lp-faq-atxt'),
          'FAQ Answer Copy',
          'Yes. Every state variable, conditional branch, math formula, and custom @font-face declaration compiles cleanly into both Live Preview and standalone HTML/CSS or React exports.',
          x + 84,
          y + 1316,
          1028,
          44,
          {
            parentId: faqAnswer.id,
            fill: '#CBD5E1',
            fontSize: 14,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.55,
          },
        ),
      );

      // ── Footer ──────────────────────────────────────────────────────
      const footer = b.add(
        'footer',
        makeFrame(makeId('lp-footer'), 'Page Footer', x + 56, y + 1444, 1088, 72, {
          parentId: root.id,
          fill: '#0B1120',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 14,
          semanticTag: 'footer',
        }),
      );
      b.add(
        'footerCopy',
        makeText(makeId('lp-fcopy'), 'Footer Copyright', '© 2026 Verdant Systems · Built with Folio Studio', x + 84, y + 1470, 440, 20, {
          parentId: footer.id,
          fill: '#64748B',
          fontSize: 13,
          fontWeight: 400,
          fontFamily: FONT_BODY,
        }),
      );
      b.add(
        'footerStatus',
        makeText(makeId('lp-fstatus'), 'Footer Status', 'All systems operational · 99.99% uptime', x + 760, y + 1470, 356, 20, {
          parentId: footer.id,
          fill: '#34D399',
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: FONT_MONO,
          textAlign: 'right',
        }),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'SaaS Landing Page Logic', logicTarget.scope, logicTarget.targetId);
        const faqOpenVar = g.variable('faqOpen', 'faqExpanded', 'boolean', false);

        // Hero Stage Tab 1: Canvas
        const onCanvas = g.node('on-tab-canvas', 'event.on-click', 0, 0, { targetNodeId: tabCanvas.id }, 'Tab: Canvas');
        const c1 = g.node('c1', 'action.set-layer', 1, 0, { targetNodeId: tabCanvas.id, property: 'fill', fill: '#2563EB' }, 'Active Canvas');
        const c2 = g.node('c2', 'action.set-layer', 2, 0, { targetNodeId: tabLogic.id, property: 'fill', fill: 'transparent' }, 'Reset Logic');
        const c3 = g.node('c3', 'action.set-layer', 3, 0, { targetNodeId: tabCode.id, property: 'fill', fill: 'transparent' }, 'Reset Code');
        const c4 = g.node('c4', 'action.set-layer', 4, 0, { targetNodeId: stageBadge.id, property: 'text', text: '60 FPS · VECTOR AST ACTIVE' }, 'Badge: Canvas');
        const c5 = g.node('c5', 'action.set-layer', 5, 0, { targetNodeId: stageTitle.id, property: 'text', text: 'Direct Manipulation Canvas' }, 'Title: Canvas');
        const c6 = g.node('c6', 'action.set-layer', 6, 0, { targetNodeId: stageBody.id, property: 'text', text: 'Precision auto-layout frames, reusable master components, and Bezier vector paths backed by one deterministic document tree.' }, 'Body: Canvas');
        const c7 = g.node('c7', 'action.set-layer', 7, 0, { targetNodeId: stageCodeLine.id, property: 'text', text: 'ast.frame("Hero") -> layout(flex-row, gap: 24) · 0 warnings' }, 'Line: Canvas');
        g.chain([onCanvas, c1, c2, c3, c4, c5, c6, c7]);

        // Hero Stage Tab 2: Logic
        const onLogic = g.node('on-tab-logic', 'event.on-click', 0, 1, { targetNodeId: tabLogic.id }, 'Tab: Logic');
        const l1 = g.node('l1', 'action.set-layer', 1, 1, { targetNodeId: tabCanvas.id, property: 'fill', fill: 'transparent' }, 'Reset Canvas');
        const l2 = g.node('l2', 'action.set-layer', 2, 1, { targetNodeId: tabLogic.id, property: 'fill', fill: '#2563EB' }, 'Active Logic');
        const l3 = g.node('l3', 'action.set-layer', 3, 1, { targetNodeId: tabCode.id, property: 'fill', fill: 'transparent' }, 'Reset Code');
        const l4 = g.node('l4', 'action.set-layer', 4, 1, { targetNodeId: stageBadge.id, property: 'text', text: 'LIVE GRAPH · ZERO BOILERPLATE' }, 'Badge: Logic');
        const l5 = g.node('l5', 'action.set-layer', 5, 1, { targetNodeId: stageTitle.id, property: 'text', text: 'Visual Node Logic Engine' }, 'Title: Logic');
        const l6 = g.node('l6', 'action.set-layer', 6, 1, { targetNodeId: stageBody.id, property: 'text', text: 'Bind events, state variables, conditional branches, math expressions, and live toasts directly to real canvas layers.' }, 'Body: Logic');
        const l7 = g.node('l7', 'action.set-layer', 7, 1, { targetNodeId: stageCodeLine.id, property: 'text', text: 'onClick(btn) -> state.update(qty) -> formatCurrency(USD)' }, 'Line: Logic');
        g.chain([onLogic, l1, l2, l3, l4, l5, l6, l7]);

        // Hero Stage Tab 3: Code
        const onCode = g.node('on-tab-code', 'event.on-click', 0, 2, { targetNodeId: tabCode.id }, 'Tab: Code');
        const k1 = g.node('k1', 'action.set-layer', 1, 2, { targetNodeId: tabCanvas.id, property: 'fill', fill: 'transparent' }, 'Reset Canvas');
        const k2 = g.node('k2', 'action.set-layer', 2, 2, { targetNodeId: tabLogic.id, property: 'fill', fill: 'transparent' }, 'Reset Logic');
        const k3 = g.node('k3', 'action.set-layer', 3, 2, { targetNodeId: tabCode.id, property: 'fill', fill: '#2563EB' }, 'Active Code');
        const k4 = g.node('k4', 'action.set-layer', 4, 2, { targetNodeId: stageBadge.id, property: 'text', text: 'EXPORT READY · REACT & HTML' }, 'Badge: Code');
        const k5 = g.node('k5', 'action.set-layer', 5, 2, { targetNodeId: stageTitle.id, property: 'text', text: 'Clean Production Codegen' }, 'Title: Code');
        const k6 = g.node('k6', 'action.set-layer', 6, 2, { targetNodeId: stageBody.id, property: 'text', text: 'Generate semantic HTML, scoped CSS, custom font stacks, and interactive TypeScript components with full design parity.' }, 'Body: Code');
        const k7 = g.node('k7', 'action.set-layer', 7, 2, { targetNodeId: stageCodeLine.id, property: 'text', text: 'export default function LandingPage() { /* 100% typed */ }' }, 'Line: Code');
        g.chain([onCode, k1, k2, k3, k4, k5, k6, k7]);

        // Billing Switcher: Monthly vs Annual
        const onMonthly = g.node('on-bill-mo', 'event.on-click', 0, 3, { targetNodeId: billMonthly.id }, 'Click Monthly');
        const m1 = g.node('m1', 'action.set-layer', 1, 3, { targetNodeId: billMonthly.id, property: 'fill', fill: '#2563EB' }, 'Monthly Active');
        const m2 = g.node('m2', 'action.set-layer', 2, 3, { targetNodeId: billAnnual.id, property: 'fill', fill: 'transparent' }, 'Annual Inactive');
        const m3 = g.node('m3', 'action.set-layer', 3, 3, { targetNodeId: starterPrice.id, property: 'text', text: '$19 / mo' }, 'Creator Monthly');
        const m4 = g.node('m4', 'action.set-layer', 4, 3, { targetNodeId: proPrice.id, property: 'text', text: '$49 / mo' }, 'Pro Monthly');
        const m5 = g.node('m5', 'action.set-layer', 5, 3, { targetNodeId: pricingNote.id, property: 'text', text: 'Billed monthly · Switch to annual to save 20%' }, 'Monthly Caption');
        g.chain([onMonthly, m1, m2, m3, m4, m5]);

        const onAnnual = g.node('on-bill-yr', 'event.on-click', 0, 4, { targetNodeId: billAnnual.id }, 'Click Annual');
        const a1 = g.node('a1', 'action.set-layer', 1, 4, { targetNodeId: billMonthly.id, property: 'fill', fill: 'transparent' }, 'Monthly Inactive');
        const a2 = g.node('a2', 'action.set-layer', 2, 4, { targetNodeId: billAnnual.id, property: 'fill', fill: '#2563EB' }, 'Annual Active');
        const a3 = g.node('a3', 'action.set-layer', 3, 4, { targetNodeId: starterPrice.id, property: 'text', text: '$15 / mo' }, 'Creator Annual');
        const a4 = g.node('a4', 'action.set-layer', 4, 4, { targetNodeId: proPrice.id, property: 'text', text: '$39 / mo' }, 'Pro Annual');
        const a5 = g.node('a5', 'action.set-layer', 5, 4, { targetNodeId: pricingNote.id, property: 'text', text: 'Billed annually · 20% discount applied' }, 'Annual Caption');
        g.chain([onAnnual, a1, a2, a3, a4, a5]);

        // FAQ Accordion Toggle
        const onFaq = g.node('on-faq', 'event.on-click', 0, 5, { targetNodeId: faqHeader.id }, 'Toggle FAQ');
        const faqToggle = g.node('faq-tgl', 'state.toggle', 1, 5, { variableId: faqOpenVar }, 'Toggle faqExpanded');
        const faqBranch = g.node('faq-br', 'logic.branch', 2, 5, { mode: 'if-else' }, 'If FAQ Open');
        const faqShow = g.node('faq-show', 'action.set-layer', 3, 5, { targetNodeId: faqAnswer.id, property: 'visible', visibleMode: 'show' }, 'Show Answer');
        const faqMinus = g.node('faq-minus', 'action.set-layer', 4, 5, { targetNodeId: faqIcon.id, property: 'text', text: '−' }, 'Icon Minus');
        const faqHide = g.node('faq-hide', 'action.set-layer', 3, 6, { targetNodeId: faqAnswer.id, property: 'visible', visibleMode: 'hide' }, 'Hide Answer');
        const faqPlus = g.node('faq-plus', 'action.set-layer', 4, 6, { targetNodeId: faqIcon.id, property: 'text', text: '+' }, 'Icon Plus');
        g.chain([onFaq, faqToggle, faqBranch]);
        g.connect(faqToggle, 'result', faqBranch, 'condition');
        g.connect(faqBranch, 'true', faqShow, 'exec');
        g.connect(faqShow, 'next', faqMinus, 'exec');
        g.connect(faqBranch, 'false', faqHide, 'exec');
        g.connect(faqHide, 'next', faqPlus, 'exec');

        // Wired CTA Toasts
        const onNavCta = g.node('on-nav-cta', 'event.on-click', 0, 7, { targetNodeId: navCta.id }, 'Click Nav CTA');
        const tNav = g.node('t-nav', 'action.overlay-toast', 1, 7, { mode: 'show-toast', tone: 'success', message: 'Free workspace ready — welcome to Verdant!' }, 'Toast Nav');
        g.chain([onNavCta, tNav]);

        const onHeroPri = g.node('on-hero-pri', 'event.on-click', 2, 7, { targetNodeId: heroPrimary.id }, 'Click Hero CTA');
        const tPri = g.node('t-pri', 'action.overlay-toast', 3, 7, { mode: 'show-toast', tone: 'success', message: 'Launching new Verdant workspace...' }, 'Toast Hero');
        g.chain([onHeroPri, tPri]);

        const onHeroSec = g.node('on-hero-sec', 'event.on-click', 4, 7, { targetNodeId: heroSecondary.id }, 'Click Tour');
        const tSec = g.node('t-sec', 'action.overlay-toast', 5, 7, { mode: 'show-toast', tone: 'info', message: 'Opening 90-second interactive architecture tour.' }, 'Toast Tour');
        g.chain([onHeroSec, tSec]);

        const onStCta = g.node('on-st-cta', 'event.on-click', 0, 8, { targetNodeId: starterCta.id }, 'Click Creator Plan');
        const tSt = g.node('t-st', 'action.overlay-toast', 1, 8, { mode: 'show-toast', tone: 'success', message: 'Creator plan selected — redirecting to checkout.' }, 'Toast Creator');
        g.chain([onStCta, tSt]);

        const onPrCta = g.node('on-pr-cta', 'event.on-click', 2, 8, { targetNodeId: proCta.id }, 'Click Studio Team');
        const tPr = g.node('t-pr', 'action.overlay-toast', 3, 8, { mode: 'show-toast', tone: 'success', message: 'Studio Team plan selected — 14-day trial activated.' }, 'Toast Team');
        g.chain([onPrCta, tPr]);

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 2. Interactive Analytics Dashboard Page (Sidebar Nav + 7D/30D/90D Live KPI Switcher + Sync & Export)
  buildPageDef(
    {
      id: 'page-analytics-dashboard',
      name: 'Analytics SaaS Dashboard',
      category: 'pages',
      summary: 'Operational dark dashboard with interactive sidebar views, 7D/30D/90D timeframe KPI switcher, live telemetry sync, and report export.',
      keywords: ['page', 'dashboard', 'analytics', 'admin', 'kpi', 'metrics', 'sidebar', 'saas', 'full page'],
      width: 1200,
      height: 900,
      previewSurface: 'dark',
      pageBackground: '#0B1120',
      logicHighlights: ['Sidebar view navigation', '7D / 30D / 90D live KPI update', 'Telemetry sync & export toast'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('db-root'), 'Analytics Dashboard Page', x, y, 1200, 900, {
          fill: '#0B1120',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 0,
          clipContent: true,
          semanticTag: 'main',
        }),
      );

      // Sidebar
      const sidebar = b.add(
        'sidebar',
        makeFrame(makeId('db-sidebar'), 'Dashboard Sidebar', x, y, 236, 900, {
          parentId: root.id,
          fill: '#090E1A',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 0,
          semanticTag: 'aside',
        }),
      );

      b.add(
        'sbLogo',
        makeRect(makeId('db-logo'), 'PulseOps Mark', x + 24, y + 26, 28, 28, {
          parentId: sidebar.id,
          fill: '#10B981',
          radius: 8,
        }),
      );
      b.add(
        'sbTitle',
        makeText(makeId('db-brand'), 'PulseOps Title', 'PulseOps', x + 64, y + 29, 140, 24, {
          parentId: sidebar.id,
          fill: '#F8FAFC',
          fontSize: 17,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );

      b.add(
        'sbSection',
        makeText(makeId('db-sb-sec'), 'Navigation Label', 'WORKSPACE VIEWS', x + 24, y + 88, 180, 16, {
          parentId: sidebar.id,
          fill: '#64748B',
          fontSize: 10.5,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 1,
        }),
      );

      const navOverview = b.add(
        'navOverview',
        makeFrame(makeId('db-nav-ov'), 'Nav: Overview', x + 16, y + 114, 204, 42, {
          parentId: sidebar.id,
          fill: '#1E293B',
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'background-color 160ms ease',
        }),
      );
      b.add(
        'navOverviewTxt',
        makeText(makeId('db-nav-ov-txt'), 'Overview Label', 'Overview', x + 32, y + 125, 168, 20, {
          parentId: navOverview.id,
          fill: '#F8FAFC',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          cursor: 'pointer',
        }),
      );

      const navRevenue = b.add(
        'navRevenue',
        makeFrame(makeId('db-nav-rev'), 'Nav: Revenue', x + 16, y + 164, 204, 42, {
          parentId: sidebar.id,
          fill: 'transparent',
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'background-color 160ms ease',
        }),
      );
      b.add(
        'navRevenueTxt',
        makeText(makeId('db-nav-rev-txt'), 'Revenue Label', 'Revenue', x + 32, y + 175, 168, 20, {
          parentId: navRevenue.id,
          fill: '#94A3B8',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          cursor: 'pointer',
        }),
      );

      const navCustomers = b.add(
        'navCustomers',
        makeFrame(makeId('db-nav-cus'), 'Nav: Customers', x + 16, y + 214, 204, 42, {
          parentId: sidebar.id,
          fill: 'transparent',
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'background-color 160ms ease',
        }),
      );
      b.add(
        'navCustomersTxt',
        makeText(makeId('db-nav-cus-txt'), 'Customers Label', 'Customers', x + 32, y + 225, 168, 20, {
          parentId: navCustomers.id,
          fill: '#94A3B8',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          cursor: 'pointer',
        }),
      );

      const syncBox = b.add(
        'syncBox',
        makeFrame(makeId('db-sync-box'), 'Live Sync Card', x + 16, y + 760, 204, 112, {
          parentId: sidebar.id,
          fill: '#111827',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 12,
        }),
      );
      const syncStatus = b.add(
        'syncStatus',
        makeText(makeId('db-sync-st'), 'Sync Status Text', 'Stream: Connected · 2s ago', x + 30, y + 776, 176, 32, {
          parentId: syncBox.id,
          fill: '#34D399',
          fontSize: 11.5,
          fontWeight: 600,
          fontFamily: FONT_MONO,
          lineHeight: 1.4,
        }),
      );
      const syncBtn = b.add(
        'syncBtn',
        makeFrame(makeId('db-sync-btn'), 'Sync Telemetry Button', x + 30, y + 820, 176, 36, {
          parentId: syncBox.id,
          fill: '#1E293B',
          stroke: '#334155',
          strokeWidth: 1,
          radius: 8,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#334155',
        }),
      );
      b.add(
        'syncBtnTxt',
        makeText(makeId('db-sync-btn-txt'), 'Sync Label', 'Refresh Stream', x + 30, y + 829, 176, 18, {
          parentId: syncBtn.id,
          fill: '#F8FAFC',
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      // Top Header
      const viewHeading = b.add(
        'viewHeading',
        makeText(makeId('db-h1'), 'Active View Title', 'Executive Overview', x + 272, y + 28, 360, 34, {
          parentId: root.id,
          fill: '#F8FAFC',
          fontSize: 26,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
          semanticTag: 'h1',
        }),
      );
      const viewSubtitle = b.add(
        'viewSubtitle',
        makeText(makeId('db-sub'), 'Active View Subtitle', 'Real-time billing velocity and workspace activation metrics.', x + 272, y + 66, 420, 20, {
          parentId: root.id,
          fill: '#94A3B8',
          fontSize: 13.5,
          fontWeight: 400,
          fontFamily: FONT_BODY,
        }),
      );

      // Timeframe Switcher (7D / 30D / 90D)
      const rangeBar = b.add(
        'rangeBar',
        makeFrame(makeId('db-range'), 'Timeframe Selector', x + 784, y + 34, 210, 40, {
          parentId: root.id,
          fill: '#0F172A',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 10,
        }),
      );
      const btn7d = b.add(
        'btn7d',
        makeFrame(makeId('db-7d'), '7D Range Button', x + 790, y + 39, 64, 30, {
          parentId: rangeBar.id,
          fill: 'transparent',
          radius: 7,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add(
        'btn7dTxt',
        makeText(makeId('db-7d-txt'), '7D Label', '7D', x + 790, y + 46, 64, 16, {
          parentId: btn7d.id,
          fill: '#CBD5E1',
          fontSize: 12.5,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const btn30d = b.add(
        'btn30d',
        makeFrame(makeId('db-30d'), '30D Range Button', x + 857, y + 39, 64, 30, {
          parentId: rangeBar.id,
          fill: '#10B981',
          radius: 7,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add(
        'btn30dTxt',
        makeText(makeId('db-30d-txt'), '30D Label', '30D', x + 857, y + 46, 64, 16, {
          parentId: btn30d.id,
          fill: '#FFFFFF',
          fontSize: 12.5,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const btn90d = b.add(
        'btn90d',
        makeFrame(makeId('db-90d'), '90D Range Button', x + 924, y + 39, 64, 30, {
          parentId: rangeBar.id,
          fill: 'transparent',
          radius: 7,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add(
        'btn90dTxt',
        makeText(makeId('db-90d-txt'), '90D Label', '90D', x + 924, y + 46, 64, 16, {
          parentId: btn90d.id,
          fill: '#CBD5E1',
          fontSize: 12.5,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const exportBtn = b.add(
        'exportBtn',
        makeFrame(makeId('db-export'), 'Export Report Button', x + 1010, y + 34, 154, 40, {
          parentId: root.id,
          fill: '#2563EB',
          stroke: '#60A5FA',
          strokeWidth: 1,
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#1D4ED8',
        }),
      );
      b.add(
        'exportBtnTxt',
        makeText(makeId('db-export-txt'), 'Export Label', 'Export CSV', x + 1010, y + 45, 154, 18, {
          parentId: exportBtn.id,
          fill: '#FFFFFF',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      // 3 KPI Cards
      const kpiCard1 = b.add(
        'kpiCard1',
        makeFrame(makeId('db-kpi-1'), 'Net Revenue KPI', x + 272, y + 114, 282, 146, {
          parentId: root.id,
          fill: '#111827',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 16,
        }),
      );
      b.add(
        'kpi1Lbl',
        makeText(makeId('db-kpi1-lbl'), 'KPI 1 Label', 'NET REVENUE', x + 296, y + 136, 220, 16, {
          parentId: kpiCard1.id,
          fill: '#94A3B8',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 0.9,
        }),
      );
      const kpi1Val = b.add(
        'kpi1Val',
        makeText(makeId('db-kpi1-val'), 'KPI 1 Value', '$142,840', x + 296, y + 164, 232, 42, {
          parentId: kpiCard1.id,
          fill: '#F8FAFC',
          fontSize: 34,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );
      const kpi1Delta = b.add(
        'kpi1Delta',
        makeText(makeId('db-kpi1-d'), 'KPI 1 Delta', '+18.4% vs prior 30 days', x + 296, y + 218, 232, 18, {
          parentId: kpiCard1.id,
          fill: '#34D399',
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: FONT_BODY,
        }),
      );

      const kpiCard2 = b.add(
        'kpiCard2',
        makeFrame(makeId('db-kpi-2'), 'Active Workspaces KPI', x + 576, y + 114, 282, 146, {
          parentId: root.id,
          fill: '#111827',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 16,
        }),
      );
      b.add(
        'kpi2Lbl',
        makeText(makeId('db-kpi2-lbl'), 'KPI 2 Label', 'ACTIVE WORKSPACES', x + 600, y + 136, 220, 16, {
          parentId: kpiCard2.id,
          fill: '#94A3B8',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 0.9,
        }),
      );
      const kpi2Val = b.add(
        'kpi2Val',
        makeText(makeId('db-kpi2-val'), 'KPI 2 Value', '4,892', x + 600, y + 164, 232, 42, {
          parentId: kpiCard2.id,
          fill: '#F8FAFC',
          fontSize: 34,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );
      b.add(
        'kpi2Delta',
        makeText(makeId('db-kpi2-d'), 'KPI 2 Delta', '+312 teams onboarded', x + 600, y + 218, 232, 18, {
          parentId: kpiCard2.id,
          fill: '#38BDF8',
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: FONT_BODY,
        }),
      );

      const kpiCard3 = b.add(
        'kpiCard3',
        makeFrame(makeId('db-kpi-3'), 'Conversion Rate KPI', x + 880, y + 114, 284, 146, {
          parentId: root.id,
          fill: '#111827',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 16,
        }),
      );
      b.add(
        'kpi3Lbl',
        makeText(makeId('db-kpi3-lbl'), 'KPI 3 Label', 'TRIAL CONVERSION', x + 904, y + 136, 220, 16, {
          parentId: kpiCard3.id,
          fill: '#94A3B8',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 0.9,
        }),
      );
      const kpi3Val = b.add(
        'kpi3Val',
        makeText(makeId('db-kpi3-val'), 'KPI 3 Value', '6.42%', x + 904, y + 164, 232, 42, {
          parentId: kpiCard3.id,
          fill: '#F8FAFC',
          fontSize: 34,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );
      b.add(
        'kpi3Delta',
        makeText(makeId('db-kpi3-d'), 'KPI 3 Delta', '+0.9 pts above target', x + 904, y + 218, 232, 18, {
          parentId: kpiCard3.id,
          fill: '#34D399',
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: FONT_BODY,
        }),
      );

      // Main Chart Panel
      const chartCard = b.add(
        'chartCard',
        makeFrame(makeId('db-chart'), 'Revenue Trajectory Card', x + 272, y + 284, 586, 584, {
          parentId: root.id,
          fill: '#111827',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 16,
        }),
      );
      b.add(
        'chartTitle',
        makeText(makeId('db-ch-title'), 'Chart Title', 'Growth Trajectory', x + 300, y + 310, 320, 26, {
          parentId: chartCard.id,
          fill: '#F8FAFC',
          fontSize: 18,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );
      const chartCaption = b.add(
        'chartCaption',
        makeText(makeId('db-ch-cap'), 'Chart Summary', '30-day rolling cohort expansion across Studio and Enterprise plans.', x + 300, y + 340, 520, 20, {
          parentId: chartCard.id,
          fill: '#94A3B8',
          fontSize: 13,
          fontWeight: 400,
          fontFamily: FONT_BODY,
        }),
      );

      // Stylized Bars
      const barHeights = [148, 196, 174, 242, 276, 252, 318, 368];
      barHeights.forEach((h, idx) => {
        b.add(
          `chartBar${idx}`,
          makeRect(makeId(`db-bar-${idx}`), `Bar ${idx + 1}`, x + 312 + idx * 66, y + 790 - h, 42, h, {
            parentId: chartCard.id,
            fill: idx === barHeights.length - 1 ? '#10B981' : '#1E3A8A',
            stroke: idx === barHeights.length - 1 ? '#34D399' : '#3B82F6',
            strokeWidth: 1,
            radius: 8,
          }),
        );
      });

      // Right Operational Highlights Panel
      const feedCard = b.add(
        'feedCard',
        makeFrame(makeId('db-feed'), 'Operational Highlights', x + 880, y + 284, 284, 584, {
          parentId: root.id,
          fill: '#111827',
          stroke: '#1E293B',
          strokeWidth: 1,
          radius: 16,
        }),
      );
      b.add(
        'feedTitle',
        makeText(makeId('db-fd-title'), 'Feed Heading', 'Active Summary', x + 904, y + 310, 232, 26, {
          parentId: feedCard.id,
          fill: '#F8FAFC',
          fontSize: 18,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
        }),
      );
      const feedBody = b.add(
        'feedBody',
        makeText(
          makeId('db-fd-body'),
          'Feed Context Body',
          'Viewing consolidated workspace telemetry. All regional ingestion pipelines are operating under 18ms latency with zero dropped events.',
          x + 904,
          y + 348,
          236,
          120,
          {
            parentId: feedCard.id,
            fill: '#CBD5E1',
            fontSize: 13.5,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.6,
          },
        ),
      );
      b.add(
        'feedRows',
        makeText(
          makeId('db-fd-rows'),
          'Event Log',
          '09:42 · Acme Corp upgraded ($490)\n09:18 · Northstar added 12 seats\n08:55 · Edge sync completed\n08:12 · Weekly cohort snapshot',
          x + 904,
          y + 500,
          236,
          150,
          {
            parentId: feedCard.id,
            fill: '#94A3B8',
            fontSize: 12,
            fontWeight: 500,
            fontFamily: FONT_MONO,
            lineHeight: 1.9,
          },
        ),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Analytics Dashboard Logic', logicTarget.scope, logicTarget.targetId);

        // Sidebar Navigation
        const onOv = g.node('on-ov', 'event.on-click', 0, 0, { targetNodeId: navOverview.id }, 'Nav: Overview');
        const ov1 = g.node('ov1', 'action.set-layer', 1, 0, { targetNodeId: navOverview.id, property: 'fill', fill: '#1E293B' }, 'Active Overview');
        const ov2 = g.node('ov2', 'action.set-layer', 2, 0, { targetNodeId: navRevenue.id, property: 'fill', fill: 'transparent' }, 'Reset Revenue');
        const ov3 = g.node('ov3', 'action.set-layer', 3, 0, { targetNodeId: navCustomers.id, property: 'fill', fill: 'transparent' }, 'Reset Customers');
        const ov4 = g.node('ov4', 'action.set-layer', 4, 0, { targetNodeId: viewHeading.id, property: 'text', text: 'Executive Overview' }, 'Heading Overview');
        const ov5 = g.node('ov5', 'action.set-layer', 5, 0, { targetNodeId: viewSubtitle.id, property: 'text', text: 'Real-time billing velocity and workspace activation metrics.' }, 'Sub Overview');
        const ov6 = g.node('ov6', 'action.set-layer', 6, 0, { targetNodeId: feedBody.id, property: 'text', text: 'Viewing consolidated workspace telemetry. All regional ingestion pipelines are operating under 18ms latency.' }, 'Feed Overview');
        g.chain([onOv, ov1, ov2, ov3, ov4, ov5, ov6]);

        const onRev = g.node('on-rev', 'event.on-click', 0, 1, { targetNodeId: navRevenue.id }, 'Nav: Revenue');
        const rv1 = g.node('rv1', 'action.set-layer', 1, 1, { targetNodeId: navOverview.id, property: 'fill', fill: 'transparent' }, 'Reset Overview');
        const rv2 = g.node('rv2', 'action.set-layer', 2, 1, { targetNodeId: navRevenue.id, property: 'fill', fill: '#1E293B' }, 'Active Revenue');
        const rv3 = g.node('rv3', 'action.set-layer', 3, 1, { targetNodeId: navCustomers.id, property: 'fill', fill: 'transparent' }, 'Reset Customers');
        const rv4 = g.node('rv4', 'action.set-layer', 4, 1, { targetNodeId: viewHeading.id, property: 'text', text: 'Revenue & Expansion' }, 'Heading Revenue');
        const rv5 = g.node('rv5', 'action.set-layer', 5, 1, { targetNodeId: viewSubtitle.id, property: 'text', text: 'Net dollar retention, upgrades, and recurring invoice health.' }, 'Sub Revenue');
        const rv6 = g.node('rv6', 'action.set-layer', 6, 1, { targetNodeId: feedBody.id, property: 'text', text: 'Net revenue retention is tracking at 124%. Annual plan upgrades account for 61% of net-new expansion MRR.' }, 'Feed Revenue');
        g.chain([onRev, rv1, rv2, rv3, rv4, rv5, rv6]);

        const onCus = g.node('on-cus', 'event.on-click', 0, 2, { targetNodeId: navCustomers.id }, 'Nav: Customers');
        const cu1 = g.node('cu1', 'action.set-layer', 1, 2, { targetNodeId: navOverview.id, property: 'fill', fill: 'transparent' }, 'Reset Overview');
        const cu2 = g.node('cu2', 'action.set-layer', 2, 2, { targetNodeId: navRevenue.id, property: 'fill', fill: 'transparent' }, 'Reset Revenue');
        const cu3 = g.node('cu3', 'action.set-layer', 3, 2, { targetNodeId: navCustomers.id, property: 'fill', fill: '#1E293B' }, 'Active Customers');
        const cu4 = g.node('cu4', 'action.set-layer', 4, 2, { targetNodeId: viewHeading.id, property: 'text', text: 'Customer Health' }, 'Heading Customers');
        const cu5 = g.node('cu5', 'action.set-layer', 5, 2, { targetNodeId: viewSubtitle.id, property: 'text', text: 'Active seat utilization, onboarding completion, and NPS signals.' }, 'Sub Customers');
        const cu6 = g.node('cu6', 'action.set-layer', 6, 2, { targetNodeId: feedBody.id, property: 'text', text: '94% of new Studio teams publish their first interactive prototype within 48 hours of workspace creation.' }, 'Feed Customers');
        g.chain([onCus, cu1, cu2, cu3, cu4, cu5, cu6]);

        // Timeframe Switcher: 7D / 30D / 90D
        const on7 = g.node('on-7d', 'event.on-click', 0, 3, { targetNodeId: btn7d.id }, 'Range: 7D');
        const r7_1 = g.node('r7-1', 'action.set-layer', 1, 3, { targetNodeId: btn7d.id, property: 'fill', fill: '#10B981' }, '7D Active');
        const r7_2 = g.node('r7-2', 'action.set-layer', 2, 3, { targetNodeId: btn30d.id, property: 'fill', fill: 'transparent' }, '30D Off');
        const r7_3 = g.node('r7-3', 'action.set-layer', 3, 3, { targetNodeId: btn90d.id, property: 'fill', fill: 'transparent' }, '90D Off');
        const r7_4 = g.node('r7-4', 'action.set-layer', 4, 3, { targetNodeId: kpi1Val.id, property: 'text', text: '$38,410' }, 'KPI1 7D');
        const r7_5 = g.node('r7-5', 'action.set-layer', 5, 3, { targetNodeId: kpi2Val.id, property: 'text', text: '1,640' }, 'KPI2 7D');
        const r7_6 = g.node('r7-6', 'action.set-layer', 6, 3, { targetNodeId: kpi3Val.id, property: 'text', text: '6.85%' }, 'KPI3 7D');
        const r7_7 = g.node('r7-7', 'action.set-layer', 7, 3, { targetNodeId: kpi1Delta.id, property: 'text', text: '+9.2% vs prior 7 days' }, 'Delta 7D');
        const r7_8 = g.node('r7-8', 'action.set-layer', 8, 3, { targetNodeId: chartCaption.id, property: 'text', text: '7-day daily intake velocity across active billing cohorts.' }, 'Caption 7D');
        g.chain([on7, r7_1, r7_2, r7_3, r7_4, r7_5, r7_6, r7_7, r7_8]);

        const on30 = g.node('on-30d', 'event.on-click', 0, 4, { targetNodeId: btn30d.id }, 'Range: 30D');
        const r30_1 = g.node('r30-1', 'action.set-layer', 1, 4, { targetNodeId: btn7d.id, property: 'fill', fill: 'transparent' }, '7D Off');
        const r30_2 = g.node('r30-2', 'action.set-layer', 2, 4, { targetNodeId: btn30d.id, property: 'fill', fill: '#10B981' }, '30D Active');
        const r30_3 = g.node('r30-3', 'action.set-layer', 3, 4, { targetNodeId: btn90d.id, property: 'fill', fill: 'transparent' }, '90D Off');
        const r30_4 = g.node('r30-4', 'action.set-layer', 4, 4, { targetNodeId: kpi1Val.id, property: 'text', text: '$142,840' }, 'KPI1 30D');
        const r30_5 = g.node('r30-5', 'action.set-layer', 5, 4, { targetNodeId: kpi2Val.id, property: 'text', text: '4,892' }, 'KPI2 30D');
        const r30_6 = g.node('r30-6', 'action.set-layer', 6, 4, { targetNodeId: kpi3Val.id, property: 'text', text: '6.42%' }, 'KPI3 30D');
        const r30_7 = g.node('r30-7', 'action.set-layer', 7, 4, { targetNodeId: kpi1Delta.id, property: 'text', text: '+18.4% vs prior 30 days' }, 'Delta 30D');
        const r30_8 = g.node('r30-8', 'action.set-layer', 8, 4, { targetNodeId: chartCaption.id, property: 'text', text: '30-day rolling cohort expansion across Studio and Enterprise plans.' }, 'Caption 30D');
        g.chain([on30, r30_1, r30_2, r30_3, r30_4, r30_5, r30_6, r30_7, r30_8]);

        const on90 = g.node('on-90d', 'event.on-click', 0, 5, { targetNodeId: btn90d.id }, 'Range: 90D');
        const r90_1 = g.node('r90-1', 'action.set-layer', 1, 5, { targetNodeId: btn7d.id, property: 'fill', fill: 'transparent' }, '7D Off');
        const r90_2 = g.node('r90-2', 'action.set-layer', 2, 5, { targetNodeId: btn30d.id, property: 'fill', fill: 'transparent' }, '30D Off');
        const r90_3 = g.node('r90-3', 'action.set-layer', 3, 5, { targetNodeId: btn90d.id, property: 'fill', fill: '#10B981' }, '90D Active');
        const r90_4 = g.node('r90-4', 'action.set-layer', 4, 5, { targetNodeId: kpi1Val.id, property: 'text', text: '$418,920' }, 'KPI1 90D');
        const r90_5 = g.node('r90-5', 'action.set-layer', 5, 5, { targetNodeId: kpi2Val.id, property: 'text', text: '11,420' }, 'KPI2 90D');
        const r90_6 = g.node('r90-6', 'action.set-layer', 6, 5, { targetNodeId: kpi3Val.id, property: 'text', text: '7.14%' }, 'KPI3 90D');
        const r90_7 = g.node('r90-7', 'action.set-layer', 7, 5, { targetNodeId: kpi1Delta.id, property: 'text', text: '+42.7% quarter-over-quarter' }, 'Delta 90D');
        const r90_8 = g.node('r90-8', 'action.set-layer', 8, 5, { targetNodeId: chartCaption.id, property: 'text', text: 'Quarterly expansion trajectory showing record enterprise retention.' }, 'Caption 90D');
        g.chain([on90, r90_1, r90_2, r90_3, r90_4, r90_5, r90_6, r90_7, r90_8]);

        // Sync & Export Actions
        const onSync = g.node('on-sync', 'event.on-click', 0, 6, { targetNodeId: syncBtn.id }, 'Click Refresh Stream');
        const setSync = g.node('set-sync', 'action.set-layer', 1, 6, { targetNodeId: syncStatus.id, property: 'text', text: 'Stream: Synced · Just now' }, 'Update Status');
        const toastSync = g.node('toast-sync', 'action.overlay-toast', 2, 6, { mode: 'show-toast', tone: 'success', message: 'Live telemetry stream refreshed.' }, 'Toast Sync');
        g.chain([onSync, setSync, toastSync]);

        const onExport = g.node('on-export', 'event.on-click', 3, 6, { targetNodeId: exportBtn.id }, 'Click Export CSV');
        const toastExport = g.node('toast-export', 'action.overlay-toast', 4, 6, { mode: 'show-toast', tone: 'info', message: 'Analytics report exported to CSV.' }, 'Toast Export');
        g.chain([onExport, toastExport]);

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 3. Editorial Creative Studio Portfolio Page (Warm Ivory Gallery + Interactive Project Filter + Capabilities Drawer)
  buildPageDef(
    {
      id: 'page-creative-studio',
      name: 'Editorial Creative Studio Page',
      category: 'pages',
      summary: 'Warm gallery-grade portfolio page with serif editorial hierarchy, interactive discipline filters, expandable capabilities brief, and commission CTA.',
      keywords: ['page', 'portfolio', 'agency', 'studio', 'editorial', 'creative', 'filter', 'full page', 'light'],
      width: 1200,
      height: 1420,
      previewSurface: 'light',
      pageBackground: '#F7F5F0',
      logicHighlights: ['All / Brand / Digital portfolio filter', 'Expandable capabilities brief', 'Commission booking toast'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('cs-root'), 'Editorial Creative Studio Page', x, y, 1200, 1420, {
          fill: '#F7F5F0',
          stroke: '#E7E2D8',
          strokeWidth: 1,
          radius: 0,
          clipContent: true,
          semanticTag: 'main',
        }),
      );

      // Header
      const header = b.add(
        'header',
        makeFrame(makeId('cs-hdr'), 'Editorial Header', x, y, 1200, 78, {
          parentId: root.id,
          fill: '#F7F5F0',
          stroke: '#E5DFD4',
          strokeWidth: 1,
          radius: 0,
          semanticTag: 'header',
        }),
      );
      b.add(
        'wordmark',
        makeText(makeId('cs-brand'), 'Studio Wordmark', 'KINETA STUDIO', x + 56, y + 29, 200, 22, {
          parentId: header.id,
          fill: '#18181B',
          fontSize: 15,
          fontWeight: 700,
          fontFamily: FONT_SANS,
          letterSpacing: 1.8,
        }),
      );
      b.add(
        'hdrLinks',
        makeText(makeId('cs-links'), 'Header Links', 'Selected Work        Practice        Journal', x + 430, y + 30, 340, 20, {
          parentId: header.id,
          fill: '#52525B',
          fontSize: 14,
          fontWeight: 500,
          fontFamily: FONT_BODY,
        }),
      );
      const bookBtn = b.add(
        'bookBtn',
        makeFrame(makeId('cs-book'), 'Book a Call Button', x + 1004, y + 19, 140, 40, {
          parentId: header.id,
          fill: '#18181B',
          radius: 100,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#27272A',
        }),
      );
      b.add(
        'bookBtnTxt',
        makeText(makeId('cs-book-txt'), 'Book CTA Label', 'Book a Call', x + 1004, y + 29, 140, 20, {
          parentId: bookBtn.id,
          fill: '#FAF8F5',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      // Editorial Hero
      b.add(
        'heroTag',
        makeText(makeId('cs-tag'), 'Studio Location', 'ZÜRICH · TOKYO · INDEPENDENT PRACTICE', x + 56, y + 132, 420, 18, {
          parentId: root.id,
          fill: '#9A6B3F',
          fontSize: 11.5,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 1.3,
        }),
      );

      b.add(
        'heroHeadline',
        makeText(
          makeId('cs-h1'),
          'Editorial Statement',
          'Design systems crafted for enduring digital brands.',
          x + 56,
          y + 162,
          960,
          156,
          {
            parentId: root.id,
            fill: '#18181B',
            fontSize: 66,
            fontWeight: 400,
            fontFamily: FONT_EDITORIAL,
            lineHeight: 1.06,
            letterSpacing: -0.6,
            semanticTag: 'h1',
          },
        ),
      );

      b.add(
        'heroSub',
        makeText(
          makeId('cs-sub'),
          'Editorial Intro',
          'We partner with founders and cultural institutions to shape unmistakable identities, editorial interfaces, and tactile web products.',
          x + 56,
          y + 332,
          560,
          56,
          {
            parentId: root.id,
            fill: '#52525B',
            fontSize: 16,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.55,
          },
        ),
      );

      // Interactive Filter Bar
      const filterAll = b.add(
        'filterAll',
        makeFrame(makeId('cs-f-all'), 'Filter: All Work', x + 56, y + 422, 118, 38, {
          parentId: root.id,
          fill: '#18181B',
          stroke: '#18181B',
          strokeWidth: 1,
          radius: 100,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'all 180ms ease',
        }),
      );
      const filterAllTxt = b.add(
        'filterAllTxt',
        makeText(makeId('cs-f-all-txt'), 'All Work Label', 'All Work', x + 56, y + 431, 118, 20, {
          parentId: filterAll.id,
          fill: '#FAF8F5',
          fontSize: 13.5,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const filterBrand = b.add(
        'filterBrand',
        makeFrame(makeId('cs-f-brand'), 'Filter: Brand', x + 186, y + 422, 108, 38, {
          parentId: root.id,
          fill: '#EFECE5',
          stroke: '#D6D0C4',
          strokeWidth: 1,
          radius: 100,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'all 180ms ease',
        }),
      );
      const filterBrandTxt = b.add(
        'filterBrandTxt',
        makeText(makeId('cs-f-brand-txt'), 'Brand Label', 'Brand', x + 186, y + 431, 108, 20, {
          parentId: filterBrand.id,
          fill: '#27272A',
          fontSize: 13.5,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const filterDigital = b.add(
        'filterDigital',
        makeFrame(makeId('cs-f-dig'), 'Filter: Digital', x + 306, y + 422, 114, 38, {
          parentId: root.id,
          fill: '#EFECE5',
          stroke: '#D6D0C4',
          strokeWidth: 1,
          radius: 100,
          semanticTag: 'button',
          cursor: 'pointer',
          transition: 'all 180ms ease',
        }),
      );
      const filterDigitalTxt = b.add(
        'filterDigitalTxt',
        makeText(makeId('cs-f-dig-txt'), 'Digital Label', 'Digital', x + 306, y + 431, 114, 20, {
          parentId: filterDigital.id,
          fill: '#27272A',
          fontSize: 13.5,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const filterReadout = b.add(
        'filterReadout',
        makeText(makeId('cs-f-read'), 'Filter Count Readout', 'Showing 12 selected works · All disciplines', x + 744, y + 432, 400, 20, {
          parentId: root.id,
          fill: '#71717A',
          fontSize: 13,
          fontWeight: 500,
          fontFamily: FONT_MONO,
          textAlign: 'right',
        }),
      );

      // Portfolio Case Cards (2 large editorial cards)
      const case1Card = b.add(
        'case1Card',
        makeFrame(makeId('cs-case-1'), 'Case Study 1', x + 56, y + 488, 620, 524, {
          parentId: root.id,
          fill: '#FFFFFF',
          stroke: '#E5DFD4',
          strokeWidth: 1,
          radius: 18,
          clipContent: true,
        }),
      );
      const case1Visual = b.add(
        'case1Visual',
        makeRect(makeId('cs-c1-vis'), 'Case 1 Visual Plate', x + 56, y + 488, 620, 356, {
          parentId: case1Card.id,
          fill: '#1F2937',
          radius: 0,
        }),
      );
      b.add(
        'case1Accent',
        makeEllipse(makeId('cs-c1-orb'), 'Editorial Motif', x + 276, y + 576, 180, 180, {
          parentId: case1Card.id,
          fill: '#D4A373',
          opacity: 0.85,
        }),
      );
      b.add(
        'case1Meta',
        makeText(makeId('cs-c1-meta'), 'Case 1 Category', 'BRAND & DIGITAL · 2026', x + 84, y + 868, 300, 18, {
          parentId: case1Card.id,
          fill: '#9A6B3F',
          fontSize: 11.5,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 1,
        }),
      );
      const case1Title = b.add(
        'case1Title',
        makeText(makeId('cs-c1-title'), 'Case 1 Title', 'Aurelia Acoustic Architecture', x + 84, y + 894, 540, 38, {
          parentId: case1Card.id,
          fill: '#18181B',
          fontSize: 30,
          fontWeight: 400,
          fontFamily: FONT_EDITORIAL,
        }),
      );
      b.add(
        'case1Desc',
        makeText(makeId('cs-c1-desc'), 'Case 1 Summary', 'Complete typographic identity and interactive flagship commerce experience.', x + 84, y + 940, 540, 44, {
          parentId: case1Card.id,
          fill: '#52525B',
          fontSize: 14,
          fontWeight: 400,
          fontFamily: FONT_BODY,
        }),
      );

      const case2Card = b.add(
        'case2Card',
        makeFrame(makeId('cs-case-2'), 'Case Study 2', x + 704, y + 488, 440, 524, {
          parentId: root.id,
          fill: '#FFFFFF',
          stroke: '#E5DFD4',
          strokeWidth: 1,
          radius: 18,
          clipContent: true,
        }),
      );
      const case2Visual = b.add(
        'case2Visual',
        makeRect(makeId('cs-c2-vis'), 'Case 2 Visual Plate', x + 704, y + 488, 440, 356, {
          parentId: case2Card.id,
          fill: '#2C3A35',
          radius: 0,
        }),
      );
      b.add(
        'case2Arch',
        makeRect(makeId('cs-c2-arch'), 'Editorial Plate Motif', x + 814, y + 566, 220, 200, {
          parentId: case2Card.id,
          fill: '#E5DFD4',
          radius: 100,
          opacity: 0.9,
        }),
      );
      b.add(
        'case2Meta',
        makeText(makeId('cs-c2-meta'), 'Case 2 Category', 'DIGITAL PRODUCT · 2026', x + 732, y + 868, 280, 18, {
          parentId: case2Card.id,
          fill: '#9A6B3F',
          fontSize: 11.5,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 1,
        }),
      );
      const case2Title = b.add(
        'case2Title',
        makeText(makeId('cs-c2-title'), 'Case 2 Title', 'Norden Botanical Archive', x + 732, y + 894, 384, 38, {
          parentId: case2Card.id,
          fill: '#18181B',
          fontSize: 30,
          fontWeight: 400,
          fontFamily: FONT_EDITORIAL,
        }),
      );
      b.add(
        'case2Desc',
        makeText(makeId('cs-c2-desc'), 'Case 2 Summary', 'Editorial index and design system for a Nordic museum collection.', x + 732, y + 940, 384, 44, {
          parentId: case2Card.id,
          fill: '#52525B',
          fontSize: 14,
          fontWeight: 400,
          fontFamily: FONT_BODY,
        }),
      );

      // Expandable Studio Capabilities Brief
      const capToggle = b.add(
        'capToggle',
        makeFrame(makeId('cs-cap-btn'), 'Capabilities Toggle Row', x + 56, y + 1052, 1088, 62, {
          parentId: root.id,
          fill: '#EFECE5',
          stroke: '#D6D0C4',
          strokeWidth: 1,
          radius: 14,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#E6E1D6',
        }),
      );
      b.add(
        'capTitle',
        makeText(makeId('cs-cap-title'), 'Capabilities Heading', 'Read Studio Capabilities & Retainer Availability', x + 84, y + 1072, 640, 22, {
          parentId: capToggle.id,
          fill: '#18181B',
          fontSize: 15.5,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          cursor: 'pointer',
        }),
      );
      const capIcon = b.add(
        'capIcon',
        makeText(makeId('cs-cap-ico'), 'Capabilities Indicator', '+', x + 1090, y + 1069, 32, 26, {
          parentId: capToggle.id,
          fill: '#18181B',
          fontSize: 22,
          fontWeight: 500,
          fontFamily: FONT_MONO,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const capDrawer = b.add(
        'capDrawer',
        makeFrame(makeId('cs-cap-drawer'), 'Capabilities Drawer', x + 56, y + 1124, 1088, 86, {
          parentId: root.id,
          fill: '#FFFFFF',
          stroke: '#E5DFD4',
          strokeWidth: 1,
          radius: 12,
          visible: false,
        }),
      );
      b.add(
        'capDrawerTxt',
        makeText(
          makeId('cs-cap-dtxt'),
          'Capabilities Copy',
          'Disciplines: Brand Identity · Design Systems · Interactive Prototyping · Art Direction. Currently accepting 2 new commissions for Q2 2026.',
          x + 84,
          y + 1146,
          1028,
          44,
          {
            parentId: capDrawer.id,
            fill: '#3F3F46',
            fontSize: 14.5,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.55,
          },
        ),
      );

      // Inquiry Footer Banner
      const inquiryCard = b.add(
        'inquiryCard',
        makeFrame(makeId('cs-inq'), 'Commission CTA Banner', x + 56, y + 1244, 1088, 128, {
          parentId: root.id,
          fill: '#18181B',
          radius: 18,
          semanticTag: 'footer',
        }),
      );
      b.add(
        'inqTitle',
        makeText(makeId('cs-inq-h2'), 'Commission Heading', 'Have an ambitious product in mind?', x + 92, y + 1278, 560, 44, {
          parentId: inquiryCard.id,
          fill: '#FAF8F5',
          fontSize: 34,
          fontWeight: 400,
          fontFamily: FONT_EDITORIAL,
        }),
      );
      b.add(
        'inqSub',
        makeText(makeId('cs-inq-sub'), 'Commission Subtitle', 'hello@kineta.studio · Response within 24 hours', x + 92, y + 1326, 420, 20, {
          parentId: inquiryCard.id,
          fill: '#A1A1AA',
          fontSize: 13.5,
          fontWeight: 400,
          fontFamily: FONT_MONO,
        }),
      );
      const inqBtn = b.add(
        'inqBtn',
        makeFrame(makeId('cs-inq-btn'), 'Start Commission Button', x + 914, y + 1284, 194, 48, {
          parentId: inquiryCard.id,
          fill: '#FAF8F5',
          radius: 100,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#E7E2D8',
        }),
      );
      b.add(
        'inqBtnTxt',
        makeText(makeId('cs-inq-btn-txt'), 'Commission CTA Label', 'Start a Commission', x + 914, y + 1298, 194, 20, {
          parentId: inqBtn.id,
          fill: '#18181B',
          fontSize: 14,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Creative Studio Page Logic', logicTarget.scope, logicTarget.targetId);
        const capOpenVar = g.variable('capOpen', 'capabilitiesOpen', 'boolean', false);

        // Filter: All Work
        const onAll = g.node('on-all', 'event.on-click', 0, 0, { targetNodeId: filterAll.id }, 'Filter: All');
        const al1 = g.node('al1', 'action.set-layer', 1, 0, { targetNodeId: filterAll.id, property: 'fill', fill: '#18181B' }, 'All Active');
        const al2 = g.node('al2', 'action.set-layer', 2, 0, { targetNodeId: filterAllTxt.id, property: 'fill', fill: '#FAF8F5' }, 'All Txt Light');
        const al3 = g.node('al3', 'action.set-layer', 3, 0, { targetNodeId: filterBrand.id, property: 'fill', fill: '#EFECE5' }, 'Brand Off');
        const al4 = g.node('al4', 'action.set-layer', 4, 0, { targetNodeId: filterBrandTxt.id, property: 'fill', fill: '#27272A' }, 'Brand Txt Dark');
        const al5 = g.node('al5', 'action.set-layer', 5, 0, { targetNodeId: filterDigital.id, property: 'fill', fill: '#EFECE5' }, 'Digital Off');
        const al6 = g.node('al6', 'action.set-layer', 6, 0, { targetNodeId: filterDigitalTxt.id, property: 'fill', fill: '#27272A' }, 'Digital Txt Dark');
        const al7 = g.node('al7', 'action.set-layer', 7, 0, { targetNodeId: filterReadout.id, property: 'text', text: 'Showing 12 selected works · All disciplines' }, 'Count All');
        const al8 = g.node('al8', 'action.set-layer', 8, 0, { targetNodeId: case1Title.id, property: 'text', text: 'Aurelia Acoustic Architecture' }, 'Case 1 All');
        const al9 = g.node('al9', 'action.set-layer', 9, 0, { targetNodeId: case2Title.id, property: 'text', text: 'Norden Botanical Archive' }, 'Case 2 All');
        const al10 = g.node('al10', 'action.set-layer', 10, 0, { targetNodeId: case1Visual.id, property: 'fill', fill: '#1F2937' }, 'Plate 1 All');
        const al11 = g.node('al11', 'action.set-layer', 11, 0, { targetNodeId: case2Visual.id, property: 'fill', fill: '#2C3A35' }, 'Plate 2 All');
        g.chain([onAll, al1, al2, al3, al4, al5, al6, al7, al8, al9, al10, al11]);

        // Filter: Brand
        const onBr = g.node('on-brand', 'event.on-click', 0, 1, { targetNodeId: filterBrand.id }, 'Filter: Brand');
        const br1 = g.node('br1', 'action.set-layer', 1, 1, { targetNodeId: filterAll.id, property: 'fill', fill: '#EFECE5' }, 'All Off');
        const br2 = g.node('br2', 'action.set-layer', 2, 1, { targetNodeId: filterAllTxt.id, property: 'fill', fill: '#27272A' }, 'All Txt Dark');
        const br3 = g.node('br3', 'action.set-layer', 3, 1, { targetNodeId: filterBrand.id, property: 'fill', fill: '#18181B' }, 'Brand Active');
        const br4 = g.node('br4', 'action.set-layer', 4, 1, { targetNodeId: filterBrandTxt.id, property: 'fill', fill: '#FAF8F5' }, 'Brand Txt Light');
        const br5 = g.node('br5', 'action.set-layer', 5, 1, { targetNodeId: filterDigital.id, property: 'fill', fill: '#EFECE5' }, 'Digital Off');
        const br6 = g.node('br6', 'action.set-layer', 6, 1, { targetNodeId: filterDigitalTxt.id, property: 'fill', fill: '#27272A' }, 'Digital Txt Dark');
        const br7 = g.node('br7', 'action.set-layer', 7, 1, { targetNodeId: filterReadout.id, property: 'text', text: 'Showing 5 brand systems · Identity & Print' }, 'Count Brand');
        const br8 = g.node('br8', 'action.set-layer', 8, 1, { targetNodeId: case1Title.id, property: 'text', text: 'Sora Ceramic Monograph' }, 'Case 1 Brand');
        const br9 = g.node('br9', 'action.set-layer', 9, 1, { targetNodeId: case2Title.id, property: 'text', text: 'Atelier Vesper Typography' }, 'Case 2 Brand');
        const br10 = g.node('br10', 'action.set-layer', 10, 1, { targetNodeId: case1Visual.id, property: 'fill', fill: '#4A3728' }, 'Plate 1 Brand');
        const br11 = g.node('br11', 'action.set-layer', 11, 1, { targetNodeId: case2Visual.id, property: 'fill', fill: '#3B2F2F' }, 'Plate 2 Brand');
        g.chain([onBr, br1, br2, br3, br4, br5, br6, br7, br8, br9, br10, br11]);

        // Filter: Digital
        const onDg = g.node('on-dig', 'event.on-click', 0, 2, { targetNodeId: filterDigital.id }, 'Filter: Digital');
        const dg1 = g.node('dg1', 'action.set-layer', 1, 2, { targetNodeId: filterAll.id, property: 'fill', fill: '#EFECE5' }, 'All Off');
        const dg2 = g.node('dg2', 'action.set-layer', 2, 2, { targetNodeId: filterAllTxt.id, property: 'fill', fill: '#27272A' }, 'All Txt Dark');
        const dg3 = g.node('dg3', 'action.set-layer', 3, 2, { targetNodeId: filterBrand.id, property: 'fill', fill: '#EFECE5' }, 'Brand Off');
        const dg4 = g.node('dg4', 'action.set-layer', 4, 2, { targetNodeId: filterBrandTxt.id, property: 'fill', fill: '#27272A' }, 'Brand Txt Dark');
        const dg5 = g.node('dg5', 'action.set-layer', 5, 2, { targetNodeId: filterDigital.id, property: 'fill', fill: '#18181B' }, 'Digital Active');
        const dg6 = g.node('dg6', 'action.set-layer', 6, 2, { targetNodeId: filterDigitalTxt.id, property: 'fill', fill: '#FAF8F5' }, 'Digital Txt Light');
        const dg7 = g.node('dg7', 'action.set-layer', 7, 2, { targetNodeId: filterReadout.id, property: 'text', text: 'Showing 7 digital flagships · Web & Spatial' }, 'Count Digital');
        const dg8 = g.node('dg8', 'action.set-layer', 8, 2, { targetNodeId: case1Title.id, property: 'text', text: 'Kuroda Spatial Audio Web' }, 'Case 1 Digital');
        const dg9 = g.node('dg9', 'action.set-layer', 9, 2, { targetNodeId: case2Title.id, property: 'text', text: 'Forma Interactive Archive' }, 'Case 2 Digital');
        const dg10 = g.node('dg10', 'action.set-layer', 10, 2, { targetNodeId: case1Visual.id, property: 'fill', fill: '#1E293B' }, 'Plate 1 Digital');
        const dg11 = g.node('dg11', 'action.set-layer', 11, 2, { targetNodeId: case2Visual.id, property: 'fill', fill: '#1D3557' }, 'Plate 2 Digital');
        g.chain([onDg, dg1, dg2, dg3, dg4, dg5, dg6, dg7, dg8, dg9, dg10, dg11]);

        // Capabilities Drawer Toggle
        const onCap = g.node('on-cap', 'event.on-click', 0, 3, { targetNodeId: capToggle.id }, 'Toggle Capabilities');
        const capTgl = g.node('cap-tgl', 'state.toggle', 1, 3, { variableId: capOpenVar }, 'Toggle State');
        const capBr = g.node('cap-br', 'logic.branch', 2, 3, { mode: 'if-else' }, 'If Open');
        const capShow = g.node('cap-show', 'action.set-layer', 3, 3, { targetNodeId: capDrawer.id, property: 'visible', visibleMode: 'show' }, 'Show Brief');
        const capMinus = g.node('cap-minus', 'action.set-layer', 4, 3, { targetNodeId: capIcon.id, property: 'text', text: '−' }, 'Minus Icon');
        const capHide = g.node('cap-hide', 'action.set-layer', 3, 4, { targetNodeId: capDrawer.id, property: 'visible', visibleMode: 'hide' }, 'Hide Brief');
        const capPlus = g.node('cap-plus', 'action.set-layer', 4, 4, { targetNodeId: capIcon.id, property: 'text', text: '+' }, 'Plus Icon');
        g.chain([onCap, capTgl, capBr]);
        g.connect(capTgl, 'result', capBr, 'condition');
        g.connect(capBr, 'true', capShow, 'exec');
        g.connect(capShow, 'next', capMinus, 'exec');
        g.connect(capBr, 'false', capHide, 'exec');
        g.connect(capHide, 'next', capPlus, 'exec');

        // Booking & Commission Toasts
        const onBook = g.node('on-book', 'event.on-click', 0, 5, { targetNodeId: bookBtn.id }, 'Click Book Call');
        const tBook = g.node('t-book', 'action.overlay-toast', 1, 5, { mode: 'show-toast', tone: 'info', message: 'Studio discovery calendar opened.' }, 'Toast Book');
        g.chain([onBook, tBook]);

        const onInq = g.node('on-inq', 'event.on-click', 2, 5, { targetNodeId: inqBtn.id }, 'Click Commission');
        const tInq = g.node('t-inq', 'action.overlay-toast', 3, 5, { mode: 'show-toast', tone: 'success', message: 'Commission inquiry received — we will reply within 24h.' }, 'Toast Inquiry');
        g.chain([onInq, tInq]);

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),

  // 4. Interactive E-Commerce Product & Cart Page (Finish Swatches + Live Qty Math + Dynamic Bag Counter)
  buildPageDef(
    {
      id: 'page-product-checkout',
      name: 'Interactive Product & Cart Page',
      category: 'pages',
      summary: 'Minimalist flagship storefront with live color finish switcher, clamped quantity stepper, real-time USD subtotal math, and live Bag counter.',
      keywords: ['page', 'ecommerce', 'shop', 'product', 'checkout', 'cart', 'store', 'swatch', 'math', 'full page'],
      width: 1200,
      height: 920,
      previewSurface: 'light',
      pageBackground: '#FFFFFF',
      logicHighlights: ['Finish swatch color switcher', 'Clamped qty × $189 live subtotal', 'Add to Bag updates header Bag (N)'],
    },
    (origin, makeId, logicTarget) => {
      const b = new TemplateBuilder(origin, makeId);
      const { x, y } = origin;

      const root = b.add(
        'root',
        makeFrame(makeId('ec-root'), 'Product Storefront Page', x, y, 1200, 920, {
          fill: '#FFFFFF',
          stroke: '#E2E8F0',
          strokeWidth: 1,
          radius: 0,
          clipContent: true,
          semanticTag: 'main',
        }),
      );

      // Storefront Header
      const nav = b.add(
        'nav',
        makeFrame(makeId('ec-nav'), 'Storefront Header', x, y, 1200, 72, {
          parentId: root.id,
          fill: '#FFFFFF',
          stroke: '#E2E8F0',
          strokeWidth: 1,
          radius: 0,
          semanticTag: 'header',
        }),
      );
      b.add(
        'storeBrand',
        makeText(makeId('ec-brand'), 'Store Brand', 'MONOLITH AUDIO', x + 48, y + 25, 200, 22, {
          parentId: nav.id,
          fill: '#0F172A',
          fontSize: 15,
          fontWeight: 800,
          fontFamily: FONT_DISPLAY,
          letterSpacing: 1.5,
        }),
      );
      b.add(
        'storeNav',
        makeText(makeId('ec-links'), 'Store Links', 'Monitors        Acoustics        Specifications', x + 410, y + 26, 360, 20, {
          parentId: nav.id,
          fill: '#64748B',
          fontSize: 13.5,
          fontWeight: 500,
          fontFamily: FONT_BODY,
        }),
      );

      const bagChip = b.add(
        'bagChip',
        makeFrame(makeId('ec-bag-chip'), 'Header Bag Indicator', x + 1036, y + 17, 116, 38, {
          parentId: nav.id,
          fill: '#0F172A',
          radius: 100,
        }),
      );
      const bagText = b.add(
        'bagText',
        makeText(makeId('ec-bag-txt'), 'Bag Count Readout', 'Bag (0)', x + 1036, y + 26, 116, 20, {
          parentId: bagChip.id,
          fill: '#FFFFFF',
          fontSize: 13,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          textAlign: 'center',
        }),
      );

      // Left Architectural Product Stage
      const stage = b.add(
        'stage',
        makeFrame(makeId('ec-stage'), 'Product Showcase Stage', x + 48, y + 112, 560, 744, {
          parentId: root.id,
          fill: '#F4F4F5',
          stroke: '#E4E4E7',
          strokeWidth: 1,
          radius: 24,
          clipContent: true,
        }),
      );
      const productBody = b.add(
        'productBody',
        makeRect(makeId('ec-speaker'), 'Monitor Chassis', x + 178, y + 228, 300, 420, {
          parentId: stage.id,
          fill: '#18181B',
          stroke: '#3F3F46',
          strokeWidth: 2,
          radius: 36,
          transition: 'background-color 240ms ease',
          effects: [makeDropShadow(makeId('ec-sh'), 28, 56, 'rgba(15, 23, 42, 0.24)')],
        }),
      );
      b.add(
        'tweeterRing',
        makeEllipse(makeId('ec-tweeter'), 'Tweeter Cone', x + 286, y + 292, 84, 84, {
          parentId: stage.id,
          fill: '#27272A',
          stroke: '#52525B',
          strokeWidth: 2,
        }),
      );
      b.add(
        'wooferRing',
        makeEllipse(makeId('ec-woofer'), 'Acoustic Woofer', x + 240, y + 412, 176, 176, {
          parentId: stage.id,
          fill: '#09090B',
          stroke: '#52525B',
          strokeWidth: 3,
        }),
      );
      const finishCaption = b.add(
        'finishCaption',
        makeText(makeId('ec-fin-cap'), 'Active Finish Caption', 'Anodized Obsidian · Machined Aluminum', x + 88, y + 796, 480, 20, {
          parentId: stage.id,
          fill: '#52525B',
          fontSize: 12.5,
          fontWeight: 600,
          fontFamily: FONT_MONO,
          textAlign: 'center',
        }),
      );

      // Right Product Configuration Column
      b.add(
        'prodKicker',
        makeText(makeId('ec-kicker'), 'Edition Label', 'STUDIO REFERENCE SERIES · IN STOCK', x + 664, y + 132, 360, 18, {
          parentId: root.id,
          fill: '#0F766E',
          fontSize: 11.5,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          letterSpacing: 1.1,
        }),
      );
      b.add(
        'prodTitle',
        makeText(makeId('ec-title'), 'Product Name', 'Monolith One Studio Monitor', x + 664, y + 160, 480, 92, {
          parentId: root.id,
          fill: '#0F172A',
          fontSize: 40,
          fontWeight: 700,
          fontFamily: FONT_DISPLAY,
          lineHeight: 1.12,
          semanticTag: 'h1',
        }),
      );
      b.add(
        'prodPrice',
        makeText(makeId('ec-unit-price'), 'Unit Price', '$189.00', x + 664, y + 266, 200, 34, {
          parentId: root.id,
          fill: '#0F172A',
          fontSize: 28,
          fontWeight: 700,
          fontFamily: FONT_MONO,
        }),
      );
      b.add(
        'prodDesc',
        makeText(
          makeId('ec-desc'),
          'Product Description',
          'Precision near-field reference monitor carved from solid bead-blasted aluminum with DSP room correction and balanced USB-C / TRS inputs.',
          x + 664,
          y + 314,
          472,
          74,
          {
            parentId: root.id,
            fill: '#475569',
            fontSize: 15,
            fontWeight: 400,
            fontFamily: FONT_BODY,
            lineHeight: 1.58,
          },
        ),
      );

      // Finish Swatch Selector
      const finishLabel = b.add(
        'finishLabel',
        makeText(makeId('ec-fin-lbl'), 'Finish Selector Label', 'Finish: Obsidian', x + 664, y + 416, 300, 20, {
          parentId: root.id,
          fill: '#0F172A',
          fontSize: 13.5,
          fontWeight: 700,
          fontFamily: FONT_SANS,
        }),
      );

      const swObsidian = b.add(
        'swObsidian',
        makeFrame(makeId('ec-sw-obs'), 'Swatch: Obsidian', x + 664, y + 448, 138, 46, {
          parentId: root.id,
          fill: '#0F172A',
          stroke: '#0F172A',
          strokeWidth: 2,
          radius: 12,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add(
        'swObsidianTxt',
        makeText(makeId('ec-sw-obs-txt'), 'Obsidian Label', 'Obsidian', x + 664, y + 461, 138, 20, {
          parentId: swObsidian.id,
          fill: '#FFFFFF',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const swSand = b.add(
        'swSand',
        makeFrame(makeId('ec-sw-sand'), 'Swatch: Sandstone', x + 816, y + 448, 146, 46, {
          parentId: root.id,
          fill: '#D6C7B2',
          stroke: '#CBD5E1',
          strokeWidth: 1.5,
          radius: 12,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add(
        'swSandTxt',
        makeText(makeId('ec-sw-sand-txt'), 'Sandstone Label', 'Sandstone', x + 816, y + 461, 146, 20, {
          parentId: swSand.id,
          fill: '#1C1917',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const swSage = b.add(
        'swSage',
        makeFrame(makeId('ec-sw-sage'), 'Swatch: Sage', x + 976, y + 448, 138, 46, {
          parentId: root.id,
          fill: '#4A635D',
          stroke: '#CBD5E1',
          strokeWidth: 1.5,
          radius: 12,
          semanticTag: 'button',
          cursor: 'pointer',
        }),
      );
      b.add(
        'swSageTxt',
        makeText(makeId('ec-sw-sage-txt'), 'Sage Label', 'Sage', x + 976, y + 461, 138, 20, {
          parentId: swSage.id,
          fill: '#FFFFFF',
          fontSize: 13,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      // Quantity Stepper & Live Subtotal Box
      const orderBox = b.add(
        'orderBox',
        makeFrame(makeId('ec-order-box'), 'Order Summary Box', x + 664, y + 528, 450, 118, {
          parentId: root.id,
          fill: '#F8FAFC',
          stroke: '#E2E8F0',
          strokeWidth: 1,
          radius: 16,
        }),
      );
      b.add(
        'qtyLbl',
        makeText(makeId('ec-qty-lbl'), 'Quantity Label', 'QUANTITY', x + 688, y + 548, 120, 16, {
          parentId: orderBox.id,
          fill: '#64748B',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: FONT_MONO,
        }),
      );
      const qtyMinus = b.add(
        'qtyMinus',
        makeFrame(makeId('ec-qty-min'), 'Decrease Quantity', x + 688, y + 576, 42, 42, {
          parentId: orderBox.id,
          fill: '#FFFFFF',
          stroke: '#CBD5E1',
          strokeWidth: 1,
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#F1F5F9',
        }),
      );
      b.add(
        'qtyMinusTxt',
        makeText(makeId('ec-qty-min-txt'), 'Minus Symbol', '−', x + 688, y + 585, 42, 24, {
          parentId: qtyMinus.id,
          fill: '#0F172A',
          fontSize: 18,
          fontWeight: 700,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      const qtyReadout = b.add(
        'qtyReadout',
        makeText(makeId('ec-qty-val'), 'Quantity Value', '1', x + 738, y + 585, 48, 24, {
          parentId: orderBox.id,
          fill: '#0F172A',
          fontSize: 18,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          textAlign: 'center',
        }),
      );

      const qtyPlus = b.add(
        'qtyPlus',
        makeFrame(makeId('ec-qty-pls'), 'Increase Quantity', x + 794, y + 576, 42, 42, {
          parentId: orderBox.id,
          fill: '#0F172A',
          radius: 10,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#1E293B',
        }),
      );
      b.add(
        'qtyPlusTxt',
        makeText(makeId('ec-qty-pls-txt'), 'Plus Symbol', '+', x + 794, y + 585, 42, 24, {
          parentId: qtyPlus.id,
          fill: '#FFFFFF',
          fontSize: 18,
          fontWeight: 700,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      b.add(
        'subLbl',
        makeText(makeId('ec-sub-lbl'), 'Subtotal Label', 'ESTIMATED TOTAL', x + 914, y + 548, 176, 16, {
          parentId: orderBox.id,
          fill: '#64748B',
          fontSize: 11,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          textAlign: 'right',
        }),
      );
      const subtotalVal = b.add(
        'subtotalVal',
        makeText(makeId('ec-sub-val'), 'Subtotal Amount', '$189.00', x + 914, y + 578, 176, 36, {
          parentId: orderBox.id,
          fill: '#0F172A',
          fontSize: 28,
          fontWeight: 700,
          fontFamily: FONT_MONO,
          textAlign: 'right',
        }),
      );

      // Add to Bag Button
      const addToBagBtn = b.add(
        'addToBagBtn',
        makeFrame(makeId('ec-add-btn'), 'Add to Bag Button', x + 664, y + 674, 450, 56, {
          parentId: root.id,
          fill: '#0F172A',
          radius: 14,
          semanticTag: 'button',
          cursor: 'pointer',
          hoverFill: '#1E293B',
          effects: [makeDropShadow(makeId('ec-bsh'), 12, 24, 'rgba(15, 23, 42, 0.18)')],
        }),
      );
      b.add(
        'addToBagTxt',
        makeText(makeId('ec-add-txt'), 'Add to Bag Label', 'Add to Bag', x + 664, y + 691, 450, 22, {
          parentId: addToBagBtn.id,
          fill: '#FFFFFF',
          fontSize: 16,
          fontWeight: 600,
          fontFamily: FONT_SANS,
          textAlign: 'center',
          cursor: 'pointer',
        }),
      );

      b.add(
        'shippingNote',
        makeText(
          makeId('ec-ship'),
          'Warranty Note',
          'Free express shipping · 30-day studio audition · 3-year hardware warranty',
          x + 664,
          y + 752,
          450,
          22,
          {
            parentId: root.id,
            fill: '#64748B',
            fontSize: 12.5,
            fontWeight: 500,
            fontFamily: FONT_BODY,
          },
        ),
      );

      let logicGraph = null;
      if (logicTarget) {
        const g = new LogicGraphBuilder(makeId, 'Product Checkout Logic', logicTarget.scope, logicTarget.targetId);
        const qtyVar = g.variable('qty', 'itemQty', 'number', 1);
        const bagVar = g.variable('bag', 'bagCount', 'number', 0);

        // Finish Swatches
        const onObs = g.node('on-obs', 'event.on-click', 0, 0, { targetNodeId: swObsidian.id }, 'Select Obsidian');
        const ob1 = g.node('ob1', 'action.set-layer', 1, 0, { targetNodeId: productBody.id, property: 'fill', fill: '#18181B' }, 'Fill Obsidian');
        const ob2 = g.node('ob2', 'action.set-layer', 2, 0, { targetNodeId: finishLabel.id, property: 'text', text: 'Finish: Obsidian' }, 'Label Obsidian');
        const ob3 = g.node('ob3', 'action.set-layer', 3, 0, { targetNodeId: finishCaption.id, property: 'text', text: 'Anodized Obsidian · Machined Aluminum' }, 'Caption Obsidian');
        g.chain([onObs, ob1, ob2, ob3]);

        const onSand = g.node('on-sand', 'event.on-click', 0, 1, { targetNodeId: swSand.id }, 'Select Sandstone');
        const sa1 = g.node('sa1', 'action.set-layer', 1, 1, { targetNodeId: productBody.id, property: 'fill', fill: '#D6C7B2' }, 'Fill Sandstone');
        const sa2 = g.node('sa2', 'action.set-layer', 2, 1, { targetNodeId: finishLabel.id, property: 'text', text: 'Finish: Sandstone' }, 'Label Sandstone');
        const sa3 = g.node('sa3', 'action.set-layer', 3, 1, { targetNodeId: finishCaption.id, property: 'text', text: 'Warm Sandstone · Bead-Blasted Ceramic' }, 'Caption Sandstone');
        g.chain([onSand, sa1, sa2, sa3]);

        const onSage = g.node('on-sage', 'event.on-click', 0, 2, { targetNodeId: swSage.id }, 'Select Sage');
        const sg1 = g.node('sg1', 'action.set-layer', 1, 2, { targetNodeId: productBody.id, property: 'fill', fill: '#4A635D' }, 'Fill Sage');
        const sg2 = g.node('sg2', 'action.set-layer', 2, 2, { targetNodeId: finishLabel.id, property: 'text', text: 'Finish: Sage' }, 'Label Sage');
        const sg3 = g.node('sg3', 'action.set-layer', 3, 2, { targetNodeId: finishCaption.id, property: 'text', text: 'Forest Sage · Matte Anodized Alloy' }, 'Caption Sage');
        g.chain([onSage, sg1, sg2, sg3]);

        // Quantity Stepper + Live Math Subtotal
        const onPlus = g.node('on-plus', 'event.on-click', 0, 3, { targetNodeId: qtyPlus.id }, 'Click +');
        const inc = g.node('inc', 'state.update', 1, 3, { variableId: qtyVar, operation: 'increment', step: 1, min: 1, max: 10 }, 'Increment Qty');

        const onMinus = g.node('on-minus', 'event.on-click', 0, 4, { targetNodeId: qtyMinus.id }, 'Click -');
        const dec = g.node('dec', 'state.update', 1, 4, { variableId: qtyVar, operation: 'increment', step: -1, min: 1, max: 10 }, 'Decrement Qty');

        const getQty = g.node('get-qty', 'state.get', 2, 4, { variableId: qtyVar }, 'Read itemQty');
        const fmtQty = g.node('fmt-qty', 'logic.text', 2, 3, { mode: 'template', template: '{{itemQty}}' }, 'Format Qty');
        const mult = g.node('mult', 'logic.math', 3, 4, { operation: '*', b: 189 }, 'Qty × $189');
        const fmtUsd = g.node('fmt-usd', 'logic.text', 4, 4, { mode: 'format-currency', currency: 'USD', decimals: 2 }, 'Format USD');

        const setQty = g.node('set-qty', 'action.set-layer', 3, 3, { targetNodeId: qtyReadout.id, property: 'text', text: '1' }, 'Update Qty');
        const setSub = g.node('set-sub', 'action.set-layer', 4, 3, { targetNodeId: subtotalVal.id, property: 'text', text: '$189.00' }, 'Update Subtotal');

        g.connect(onPlus, 'exec', inc, 'exec');
        g.connect(onMinus, 'exec', dec, 'exec');
        g.connect(inc, 'next', setQty, 'exec');
        g.connect(dec, 'next', setQty, 'exec');
        g.connect(fmtQty, 'text', setQty, 'value');
        g.connect(setQty, 'next', setSub, 'exec');
        g.connect(getQty, 'value', mult, 'a');
        g.connect(mult, 'result', fmtUsd, 'value');
        g.connect(fmtUsd, 'text', setSub, 'value');

        // Add to Bag: bagCount = bagCount + itemQty -> update Bag (N) + toast
        const onAdd = g.node('on-add', 'event.on-click', 0, 5, { targetNodeId: addToBagBtn.id }, 'Click Add to Bag');
        const getBag = g.node('get-bag', 'state.get', 1, 6, { variableId: bagVar }, 'Read bagCount');
        const addMath = g.node('add-bag', 'logic.math', 2, 6, { operation: '+' }, 'bagCount + itemQty');
        const saveBag = g.node('save-bag', 'state.update', 1, 5, { variableId: bagVar, operation: 'set' }, 'Save bagCount');
        const fmtBag = g.node('fmt-bag', 'logic.text', 3, 6, { mode: 'template', template: 'Bag ({{bagCount}})' }, 'Format Bag Label');
        const setBag = g.node('set-bag', 'action.set-layer', 2, 5, { targetNodeId: bagText.id, property: 'text', text: 'Bag (1)' }, 'Update Header Bag');
        const toastBag = g.node('toast-bag', 'action.overlay-toast', 3, 5, { mode: 'show-toast', tone: 'success', message: 'Monolith One added to your bag.' }, 'Bag Toast');

        g.connect(getBag, 'value', addMath, 'a');
        g.connect(getQty, 'value', addMath, 'b');
        g.connect(addMath, 'result', saveBag, 'value');
        g.chain([onAdd, saveBag, setBag, toastBag]);
        g.connect(fmtBag, 'text', setBag, 'value');

        logicGraph = g.build();
      }

      return { nodes: b.getNodes(), nodeByKey: b.getKeyMap(), logicGraph };
    },
  ),
];
