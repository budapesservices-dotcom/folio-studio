import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  BreakpointId,
  DesignThemeDefinition,
  FolioPage,
} from '../../core/document/types';
import { StudioIcon } from './StudioIcon';

export interface LivePreviewPaneProps {
  pages: readonly FolioPage[];
  activePageId: string;
  themes: readonly DesignThemeDefinition[];
  activeThemeId: string;
  breakpoint: BreakpointId;
  previewHtml: string;
  refreshNonce: number;
  onSelectPage: (pageId: string) => void;
  onSelectTheme: (themeId: string) => void;
  onSelectBreakpoint: (breakpoint: BreakpointId) => void;
  onRefresh: () => void;
  onDownloadHtml: () => void;
}

const PREVIEW_BREAKPOINTS: readonly { id: BreakpointId; label: string; widthPx: number | null; icon: string }[] = [
  { id: 'desktop', label: 'Desktop', widthPx: null, icon: 'desktop' },
  { id: 'tablet', label: 'Tablet', widthPx: 768, icon: 'tablet' },
  { id: 'mobile', label: 'Mobile', widthPx: 390, icon: 'mobile' },
];

export function LivePreviewPane({
  pages,
  activePageId,
  themes,
  activeThemeId,
  breakpoint,
  previewHtml,
  refreshNonce,
  onSelectPage,
  onSelectTheme,
  onSelectBreakpoint,
  onRefresh,
  onDownloadHtml,
}: LivePreviewPaneProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stageWidth, setStageWidth] = useState(560);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    let rafId: number | null = null;
    let disposed = false;

    const commitWidth = () => {
      if (disposed) return;
      const measured = el.getBoundingClientRect().width;
      if (!Number.isFinite(measured) || measured <= 0) return;
      const rounded = Math.round(measured);
      setStageWidth((prev) => (Math.abs(prev - rounded) >= 1 ? rounded : prev));
    };

    const scheduleMeasure = () => {
      if (disposed) return;
      if (typeof requestAnimationFrame !== 'function') {
        commitWidth();
        return;
      }
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        commitWidth();
      });
    };

    commitWidth();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', scheduleMeasure);
      return () => {
        disposed = true;
        if (rafId !== null && typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        window.removeEventListener('resize', scheduleMeasure);
      };
    }

    const observer = new ResizeObserver(() => {
      scheduleMeasure();
    });
    observer.observe(el);
    return () => {
      disposed = true;
      if (rafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      observer.disconnect();
    };
  }, []);

  const currentPage = pages.find((page) => page.id === activePageId) ?? pages[0];
  const currentTheme = themes.find((theme) => theme.id === activeThemeId) ?? themes[0];
  const currentPreset =
    PREVIEW_BREAKPOINTS.find((preset) => preset.id === breakpoint) ?? PREVIEW_BREAKPOINTS[0];

  const targetViewportWidth = currentPreset.widthPx ?? Math.max(320, currentPage?.document.width ?? 1440);
  const targetViewportHeight = Math.max(600, currentPage?.document.height ?? 900);
  const availableWidth = Math.max(260, stageWidth - 28);
  const scale = Math.min(1, availableWidth / targetViewportWidth);
  const scaledWidth = Math.round(targetViewportWidth * scale);
  const scaledHeight = Math.round(targetViewportHeight * scale);
  const zoomPercent = Math.round(scale * 100);

  return (
    <section class="live-preview-pane" aria-label="Live Preview">
      <div class="live-preview-toolbar">
        <div class="live-preview-toolbar-left">
          <label class="live-preview-route-picker">
            <span class="sr-only">Preview page</span>
            <select
              class="select-field live-preview-select"
              aria-label="Preview page"
              value={currentPage?.id ?? ''}
              onChange={(event) => onSelectPage(event.currentTarget.value)}
            >
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.name} ({page.route})
                </option>
              ))}
            </select>
          </label>

          <div class="code-segmented" role="group" aria-label="Preview viewport">
            {PREVIEW_BREAKPOINTS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                class={`code-segment-btn ${breakpoint === preset.id ? 'is-active' : ''}`}
                aria-pressed={breakpoint === preset.id}
                title={`${preset.label} preview`}
                onClick={() => onSelectBreakpoint(preset.id)}
              >
                <StudioIcon name={preset.icon} />
                <span>{preset.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div class="live-preview-toolbar-right">
          {themes.length > 0 && (
            <div class="code-segmented" role="group" aria-label="Preview theme">
              {themes.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  class={`code-segment-btn ${activeThemeId === theme.id ? 'is-active' : ''}`}
                  aria-pressed={activeThemeId === theme.id}
                  onClick={() => onSelectTheme(theme.id)}
                >
                  {theme.name}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            class="code-icon-action"
            title="Refresh live preview"
            aria-label="Refresh live preview"
            onClick={onRefresh}
          >
            <StudioIcon name="rotate" />
          </button>
          <button
            type="button"
            class="code-text-action"
            title="Download standalone HTML file"
            onClick={onDownloadHtml}
          >
            Export HTML
          </button>
        </div>
      </div>

      <div class="live-preview-stage" ref={stageRef}>
        <div
          class="live-preview-device"
          style={{ width: `${scaledWidth}px` }}
        >
          <div class="live-preview-chrome">
            <span class="live-preview-url">{currentPage?.route ?? '/'}</span>
            <span class="live-preview-meta">
              {currentPreset.label}
              {' · '}
              {targetViewportWidth}px
              {' · '}
              {zoomPercent}%
              {currentTheme ? ` · ${currentTheme.name}` : ''}
            </span>
          </div>
          <div
            class="live-preview-viewport"
            style={{ width: `${scaledWidth}px`, height: `${scaledHeight}px` }}
          >
            <iframe
              key={refreshNonce}
              class="live-preview-iframe"
              title="FOLIO Live Preview"
              sandbox="allow-scripts"
              srcDoc={previewHtml}
              style={{
                width: `${targetViewportWidth}px`,
                height: `${targetViewportHeight}px`,
                transform: `scale(${scale})`,
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
