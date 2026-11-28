import type { ComponentChildren } from 'preact';

export interface InspectorAccordionSectionProps {
  id: string;
  title: string;
  badge?: string;
  isOpen: boolean;
  onToggle: (id: string) => void;
  children: ComponentChildren;
}

export function InspectorAccordionSection({
  id,
  title,
  badge,
  isOpen,
  onToggle,
  children,
}: InspectorAccordionSectionProps) {
  return (
    <section
      class={`inspector-accordion${isOpen ? ' is-open' : ''}`}
      data-accordion-id={id}
    >
      <button
        type="button"
        class="inspector-accordion-header"
        aria-expanded={isOpen}
        aria-controls={`inspector-accordion-body-${id}`}
        onClick={() => onToggle(id)}
      >
        <span class="inspector-accordion-title-group">
          <svg
            class={`inspector-accordion-chevron${isOpen ? ' is-open' : ''}`}
            viewBox="0 0 12 12"
            fill="none"
            aria-hidden="true"
          >
            <path
              d="M4.25 2.5L7.75 6L4.25 9.5"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span class="inspector-accordion-title">{title}</span>
        </span>
        {badge && <span class="inspector-accordion-badge">{badge}</span>}
      </button>
      {isOpen && (
        <div
          id={`inspector-accordion-body-${id}`}
          class="inspector-accordion-body"
        >
          {children}
        </div>
      )}
    </section>
  );
}

export interface InspectorAccordionToolbarProps {
  allExpanded: boolean;
  openCount: number;
  totalCount: number;
  onToggleAll: () => void;
}

export function InspectorAccordionToolbar({
  allExpanded,
  openCount,
  totalCount,
  onToggleAll,
}: InspectorAccordionToolbarProps) {
  return (
    <div class="inspector-accordion-toolbar">
      <span class="inspector-accordion-toolbar-meta">
        SECTIONS · {openCount}/{totalCount}
      </span>
      <button
        type="button"
        class="inspector-accordion-toggle-all"
        onClick={onToggleAll}
        title={allExpanded ? 'Collapse all inspector sections' : 'Expand all inspector sections'}
      >
        {allExpanded ? 'Collapse All' : 'Expand All'}
      </button>
    </div>
  );
}
