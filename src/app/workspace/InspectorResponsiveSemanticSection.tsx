import { useMemo, useState } from 'preact/hooks';
import { isSafeHtmlClassName, isSafeHtmlId } from '../../core/document/cssUnits';
import type {
  BreakpointId,
  DesignNode,
  FolioProject,
  ResponsiveNodeOverride,
  SemanticHtmlTag,
} from '../../core/document/types';
import { applyA11yQuickFixToNode, auditPageAccessibility } from '../../engines/codegen/a11yAudit';
import { resolveSemanticTag } from '../../engines/codegen/htmlCssCompiler';

export interface InspectorResponsiveSemanticSectionProps {
  selectedNode: DesignNode;
  activeBreakpoint: BreakpointId;
  project?: FolioProject;
  activePageId?: string;
  onSwitchBreakpoint?: (bp: BreakpointId) => void;
  onUpdateSelected: (patch: Partial<DesignNode>) => void;
  onCommitEdit: () => void;
}

const SEMANTIC_TAGS: ReadonlyArray<{ value: SemanticHtmlTag; label: string }> = [
  { value: 'div', label: '<div> Container' },
  { value: 'section', label: '<section> Section' },
  { value: 'header', label: '<header> Header' },
  { value: 'nav', label: '<nav> Navigation' },
  { value: 'main', label: '<main> Main' },
  { value: 'article', label: '<article> Article' },
  { value: 'aside', label: '<aside> Aside' },
  { value: 'footer', label: '<footer> Footer' },
  { value: 'button', label: '<button> Button' },
  { value: 'a', label: '<a> Link' },
  { value: 'h1', label: '<h1> Heading 1' },
  { value: 'h2', label: '<h2> Heading 2' },
  { value: 'h3', label: '<h3> Heading 3' },
  { value: 'h4', label: '<h4> Heading 4' },
  { value: 'h5', label: '<h5> Heading 5' },
  { value: 'h6', label: '<h6> Heading 6' },
  { value: 'p', label: '<p> Paragraph' },
  { value: 'span', label: '<span> Inline' },
  { value: 'ul', label: '<ul> List' },
  { value: 'li', label: '<li> List Item' },
  { value: 'form', label: '<form> Form' },
];

const BREAKPOINTS: ReadonlyArray<{ id: BreakpointId; label: string }> = [
  { id: 'desktop', label: 'Desktop' },
  { id: 'tablet', label: 'Tablet' },
  { id: 'mobile', label: 'Mobile' },
];

export function InspectorResponsiveSemanticSection({
  selectedNode,
  activeBreakpoint,
  project,
  activePageId,
  onSwitchBreakpoint,
  onUpdateSelected,
  onCommitEdit,
}: InspectorResponsiveSemanticSectionProps) {
  const [idDraft, setIdDraft] = useState<string | null>(null);
  const [classDraft, setClassDraft] = useState<string | null>(null);
  const [hrefDraft, setHrefDraft] = useState<string | null>(null);
  const [ariaDraft, setAriaDraft] = useState<string | null>(null);

  const effectiveTag = selectedNode.semanticTag ?? resolveSemanticTag(selectedNode);

  const nodeA11yIssues = useMemo(() => {
    if (!project || !activePageId) return [];
    const page = project.pages.find((p) => p.id === activePageId);
    if (!page) return [];
    const report = auditPageAccessibility(project, page);
    return report.issues.filter((issue) => issue.nodeId === selectedNode.id);
  }, [project, activePageId, selectedNode]);

  const toggleBreakpointVisibility = (bp: BreakpointId) => {
    if (bp === 'desktop') {
      onUpdateSelected({ visible: !selectedNode.visible });
      onCommitEdit();
      return;
    }
    const prevAll = selectedNode.responsive ?? {};
    const prevBp: ResponsiveNodeOverride = prevAll[bp] ?? {};
    const currentVisible = prevBp.visible ?? selectedNode.visible;
    const nextBp: ResponsiveNodeOverride = { ...prevBp, visible: !currentVisible };
    onUpdateSelected({
      responsive: {
        ...prevAll,
        [bp]: nextBp,
      },
    });
    onCommitEdit();
  };

  const hasResponsiveOverride = (bp: BreakpointId): boolean => {
    if (bp === 'desktop') return false;
    const ov = selectedNode.responsive?.[bp];
    return Boolean(ov && Object.keys(ov).length > 0);
  };

  return (
    <div class="folio-responsive-semantic-stack">
      {/* BREAKPOINT VISIBILITY & OVERRIDE INDICATORS */}
      <div class="folio-prop-group">
        <div class="folio-prop-header-row">
          <span class="folio-prop-label">Responsive Visibility</span>
          {selectedNode.responsive && (
            <button
              type="button"
              class="folio-chip-btn"
              onClick={() => {
                onUpdateSelected({ responsive: undefined });
                onCommitEdit();
              }}
            >
              Reset All
            </button>
          )}
        </div>
        <div class="folio-bp-grid" role="group" aria-label="Breakpoint visibility toggles">
          {BREAKPOINTS.map((bp) => {
            const isVis =
              bp.id === 'desktop'
                ? selectedNode.visible
                : (selectedNode.responsive?.[bp.id]?.visible ?? selectedNode.visible);
            const hasDot = hasResponsiveOverride(bp.id);
            const isCurrentBp = activeBreakpoint === bp.id;
            return (
              <div key={bp.id} class={`folio-bp-card${isCurrentBp ? ' is-current' : ''}`}>
                <button
                  type="button"
                  class="folio-bp-name-btn"
                  title={`Preview ${bp.label} breakpoint`}
                  onClick={() => onSwitchBreakpoint?.(bp.id)}
                >
                  {hasDot && <span class="folio-override-dot" aria-hidden="true" />}
                  {bp.label}
                </button>
                <button
                  type="button"
                  class={`folio-bp-vis-btn${isVis ? ' is-visible' : ' is-hidden'}`}
                  aria-label={`Toggle ${bp.label} visibility`}
                  onClick={() => toggleBreakpointVisibility(bp.id)}
                >
                  {isVis ? 'Show' : 'Hide'}
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* SEMANTIC HTML TAG */}
      <div class="folio-prop-group">
        <span class="folio-prop-label">Semantic HTML Tag</span>
        <select
          class="select-field"
          aria-label="Semantic HTML tag"
          value={effectiveTag}
          onChange={(e) => {
            onUpdateSelected({ semanticTag: e.currentTarget.value as SemanticHtmlTag });
            onCommitEdit();
          }}
        >
          {SEMANTIC_TAGS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      {/* LINK HREF + OPEN IN NEW TAB */}
      {effectiveTag === 'a' && (
        <div class="folio-prop-group">
          <span class="folio-prop-label">Link Destination (href)</span>
          <input
            class="folio-web-attr-input"
            type="text"
            aria-label="Link href"
            placeholder="https://example.com or /about"
            value={hrefDraft ?? selectedNode.href ?? ''}
            onFocus={(e) => setHrefDraft(e.currentTarget.value)}
            onInput={(e) => setHrefDraft(e.currentTarget.value)}
            onBlur={(e) => {
              const val = e.currentTarget.value.trim();
              setHrefDraft(null);
              onUpdateSelected({ href: val || undefined });
              onCommitEdit();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <label class="folio-checkbox-row">
            <input
              type="checkbox"
              aria-label="Open link in new tab"
              checked={selectedNode.linkTarget === '_blank'}
              onChange={(e) => {
                onUpdateSelected({ linkTarget: e.currentTarget.checked ? '_blank' : undefined });
                onCommitEdit();
              }}
            />
            <span>Open in New Tab (noopener noreferrer)</span>
          </label>
        </div>
      )}

      {/* WEB ATTRIBUTES: id, className, aria-label */}
      <div class="folio-prop-group">
        <span class="folio-prop-label">HTML Attributes</span>
        <div class="folio-two-col">
          <input
            class="folio-web-attr-input"
            type="text"
            aria-label="HTML id attribute"
            placeholder="id (e.g. hero-cta)"
            value={idDraft ?? selectedNode.htmlId ?? ''}
            onFocus={(e) => setIdDraft(e.currentTarget.value)}
            onInput={(e) => setIdDraft(e.currentTarget.value)}
            onBlur={(e) => {
              const val = e.currentTarget.value.trim();
              setIdDraft(null);
              if (isSafeHtmlId(val)) {
                onUpdateSelected({ htmlId: val || undefined });
                onCommitEdit();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          <input
            class="folio-web-attr-input"
            type="text"
            aria-label="CSS className attribute"
            placeholder="className"
            value={classDraft ?? selectedNode.className ?? ''}
            onFocus={(e) => setClassDraft(e.currentTarget.value)}
            onInput={(e) => setClassDraft(e.currentTarget.value)}
            onBlur={(e) => {
              const val = e.currentTarget.value.trim();
              setClassDraft(null);
              if (isSafeHtmlClassName(val)) {
                onUpdateSelected({ className: val || undefined });
                onCommitEdit();
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
        </div>
        <input
          class="folio-web-attr-input"
          type="text"
          aria-label="ARIA accessible label"
          placeholder="aria-label (for screen readers)"
          value={ariaDraft ?? selectedNode.ariaLabel ?? ''}
          onFocus={(e) => setAriaDraft(e.currentTarget.value)}
          onInput={(e) => setAriaDraft(e.currentTarget.value)}
          onBlur={(e) => {
            const val = e.currentTarget.value.trim();
            setAriaDraft(null);
            onUpdateSelected({ ariaLabel: val || undefined });
            onCommitEdit();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
      </div>

      {/* LIVE A11Y / WCAG CONTRAST BADGE */}
      <div class="folio-a11y-status-box" aria-label="Accessibility audit status">
        {nodeA11yIssues.length === 0 ? (
          <div class="folio-a11y-pass">
            <span class="folio-a11y-dot is-pass" aria-hidden="true" />
            <span>WCAG AA &amp; Semantic checks passed</span>
          </div>
        ) : (
          <div class="folio-a11y-issues-list">
            {nodeA11yIssues.map((issue) => (
              <div key={issue.id} class={`folio-a11y-issue-row is-${issue.severity}`}>
                <div class="folio-a11y-issue-text">
                  <strong>{issue.title}</strong>
                  <span>{issue.message}</span>
                </div>
                {issue.fix && (
                  <button
                    type="button"
                    class="folio-chip-btn is-accent"
                    onClick={() => {
                      const fixed = applyA11yQuickFixToNode(selectedNode, issue.fix!);
                      onUpdateSelected(fixed);
                      onCommitEdit();
                    }}
                  >
                    {issue.fix.label}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
