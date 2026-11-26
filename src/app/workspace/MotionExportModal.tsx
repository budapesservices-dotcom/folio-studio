import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AnimationClip, BreakpointId, FolioPage, FolioProject } from '../../core/document/types';
import { getEffectivePageAnimationDurationMs } from '../../engines/animation/svgExport';
import {
  MOTION_EXPORT_FORMATS,
  MOTION_EXPORT_RESOLUTIONS,
  buildFrameSchedule,
  computeExportDimensions,
  detectVideoExportCapabilities,
  exportMotionAnimation,
  formatFileSize,
  renderAnimatedFrameToCanvas,
  triggerMotionBlobDownload,
  type MotionExportFormatId,
  type MotionExportProgress,
  type MotionExportQualityId,
  type MotionExportResolutionId,
  type MotionExportResult,
  type VideoExportCapabilities,
} from '../../engines/animation/videoExport';

export interface MotionExportModalProps {
  project: FolioProject;
  activePage: FolioPage;
  pageClips: readonly AnimationClip[];
  activeClip: AnimationClip | null;
  breakpoint?: BreakpointId;
  onNotice?: (message: string) => void;
  onClose: () => void;
}

const FPS_OPTIONS = [15, 24, 30, 60] as const;
const QUALITY_OPTIONS: ReadonlyArray<{ id: MotionExportQualityId; label: string }> = [
  { id: 'draft', label: 'Draft' },
  { id: 'standard', label: 'Standard' },
  { id: 'high', label: 'High' },
  { id: 'lossless', label: 'Lossless' },
];

export function MotionExportModal({
  project,
  activePage,
  pageClips,
  activeClip,
  breakpoint = 'desktop',
  onNotice,
  onClose,
}: MotionExportModalProps) {
  const [selectedClipId, setSelectedClipId] = useState<string>(activeClip?.id ?? pageClips[0]?.id ?? '');
  const [format, setFormat] = useState<MotionExportFormatId>('mp4');
  const [resolution, setResolution] = useState<MotionExportResolutionId>('canvas');
  const [fitMode, setFitMode] = useState<'contain' | 'cover'>('contain');
  const [fps, setFps] = useState<number>(30);
  const [quality, setQuality] = useState<MotionExportQualityId>('high');
  const [transparentBackground, setTransparentBackground] = useState<boolean>(false);
  const [loopCount, setLoopCount] = useState<number>(1);

  const selectedClip = useMemo(
    () => pageClips.find((c) => c.id === selectedClipId) ?? activeClip ?? pageClips[0] ?? null,
    [pageClips, selectedClipId, activeClip],
  );

  const clipDurationMs = useMemo(
    () => getEffectivePageAnimationDurationMs(project, activePage, selectedClip),
    [project, activePage, selectedClip],
  );
  const [startMs, setStartMs] = useState<number>(0);
  const [endMs, setEndMs] = useState<number>(clipDurationMs);

  const [capabilities, setCapabilities] = useState<VideoExportCapabilities | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [progress, setProgress] = useState<MotionExportProgress | null>(null);
  const [lastResult, setLastResult] = useState<MotionExportResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const formatSpec = useMemo(
    () => MOTION_EXPORT_FORMATS.find((f) => f.id === format) ?? MOTION_EXPORT_FORMATS[0],
    [format],
  );
  const clipHasMorphTracks = useMemo(
    () => Boolean(selectedClip?.tracks.some((t) => t.property === 'pathMorph' && t.keyframes.length > 0)),
    [selectedClip],
  );

  useEffect(() => {
    setStartMs(0);
    setEndMs(clipDurationMs);
    setLastResult(null);
    setErrorMessage(null);
  }, [selectedClip?.id, clipDurationMs]);

  useEffect(() => {
    let cancelled = false;
    detectVideoExportCapabilities(activePage.document.width, activePage.document.height)
      .then((caps) => {
        if (!cancelled) setCapabilities(caps);
      })
      .catch(() => {
        // Ignore probe errors
      });
    return () => {
      cancelled = true;
    };
  }, [activePage.document.width, activePage.document.height]);

  // Escape key closes modal when not actively encoding
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isExporting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isExporting, onClose]);

  // Abort ongoing render on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Render crisp thumbnail preview of startMs whenever clip / transparency / fitMode changes
  useEffect(() => {
    if (isExporting) return;
    let cancelled = false;
    const canvas = document.createElement('canvas');
    const dims = computeExportDimensions(activePage.document.width, activePage.document.height, resolution, format);
    const scale = Math.min(1, 360 / Math.max(dims.width, dims.height));
    canvas.width = Math.max(2, Math.round(dims.width * scale));
    canvas.height = Math.max(2, Math.round(dims.height * scale));

    renderAnimatedFrameToCanvas(project, activePage, selectedClip, startMs, canvas, {
      transparentBackground: formatSpec.supportsAlpha && transparentBackground,
      breakpoint,
      fitMode,
    })
      .then(() => {
        if (!cancelled) {
          setPreviewUrl(canvas.toDataURL('image/png'));
        }
      })
      .catch(() => {
        // Ignore preview error in headless/jsdom
      });

    return () => {
      cancelled = true;
    };
  }, [
    isExporting,
    project,
    activePage,
    selectedClip,
    startMs,
    resolution,
    format,
    formatSpec.supportsAlpha,
    transparentBackground,
    breakpoint,
    fitMode,
  ]);

  const targetDims = useMemo(
    () => computeExportDimensions(activePage.document.width, activePage.document.height, resolution, format),
    [activePage.document.width, activePage.document.height, resolution, format],
  );

  const safeStartMs = Math.max(0, Math.min(startMs, clipDurationMs));
  const safeEndMs = Math.max(safeStartMs, Math.min(endMs, Math.max(clipDurationMs, safeStartMs + 100)));
  const effectivePasses = format === 'gif' ? 1 : Math.max(1, loopCount);
  const frameCount = useMemo(
    () => (formatSpec.supportsFps ? buildFrameSchedule(safeStartMs, safeEndMs, fps, effectivePasses).length : 1),
    [formatSpec.supportsFps, safeStartMs, safeEndMs, fps, effectivePasses],
  );

  const handleSelectFormat = (nextFormat: MotionExportFormatId) => {
    if (isExporting) return;
    setFormat(nextFormat);
    setLastResult(null);
    setErrorMessage(null);
    const nextSpec = MOTION_EXPORT_FORMATS.find((f) => f.id === nextFormat);
    if (nextSpec && !nextSpec.supportsAlpha) {
      setTransparentBackground(false);
    }
    if (nextFormat === 'gif') {
      setFps((current) => (current > 24 ? 15 : current));
      setLoopCount(0); // Infinite loop by default for GIF
    } else if (loopCount === 0) {
      setLoopCount(1);
    }
  };

  const activeCodecHint = useMemo(() => {
    if (format === 'mp4') {
      if (capabilities?.webCodecsAvc) return 'WebCodecs H.264 (AVC)';
      if (capabilities?.mediaRecorderMp4) return 'Browser MP4 Recorder';
      return 'ISO BMFF MP4 (MJPEG Fallback)';
    }
    if (format === 'mov') {
      if (transparentBackground || quality === 'lossless') return 'QuickTime PNG (Lossless 32-bit RGBA)';
      if (capabilities?.webCodecsAvc) return 'QuickTime H.264 (AVC)';
      return 'QuickTime PNG (Lossless)';
    }
    if (format === 'webm') {
      if (capabilities?.webCodecsVp9) return 'WebCodecs VP9 (EBML)';
      if (capabilities?.webCodecsVp8) return 'WebCodecs VP8 (EBML)';
      if (capabilities?.mediaRecorderWebm) return 'MediaRecorder WebM';
      return 'WebM (Unsupported in this browser)';
    }
    if (format === 'gif') return transparentBackground ? 'GIF89a LZW + Alpha' : 'GIF89a LZW 256-Color';
    if (format === 'png-sequence') return transparentBackground ? 'Lossless PNG RGBA + manifest.json' : 'Lossless PNG + manifest.json';
    if (format === 'svg') return 'Standalone SMIL Animated SVG';
    if (format === 'html5') return 'Standalone HTML5 + CSS @keyframes';
    if (format === 'css') return 'CSS3 @keyframes + Custom Curves';
    return 'Folio Motion JSON v1';
  }, [format, capabilities, transparentBackground, quality]);

  const handleStartExport = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setErrorMessage(null);
    setLastResult(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await exportMotionAnimation(project, activePage, selectedClip, {
        format,
        resolution,
        fps,
        quality,
        startMs: safeStartMs,
        endMs: safeEndMs,
        loopCount: format === 'gif' ? loopCount : Math.max(1, loopCount),
        transparentBackground: formatSpec.supportsAlpha && transparentBackground,
        breakpoint,
        fitMode,
        signal: controller.signal,
        onProgress: (prog) => {
          setProgress(prog);
          if (prog.previewDataUrl) {
            setPreviewUrl(prog.previewDataUrl);
          }
        },
      });
      setLastResult(result);
      triggerMotionBlobDownload(result.blob, result.filename);
      onNotice?.(`Exported ${result.filename} (${result.codecLabel} · ${formatFileSize(result.sizeBytes)}).`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setErrorMessage('Export cancelled.');
      } else {
        setErrorMessage(err instanceof Error ? err.message : 'Animation export failed.');
      }
    } finally {
      abortRef.current = null;
      setIsExporting(false);
    }
  };

  const handleCancelExport = () => {
    abortRef.current?.abort();
  };

  const modalContent = (
    <div
      class="mex-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isExporting) {
          onClose();
        }
      }}
    >
      <div
        class="mex-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Export Animation & Video"
        data-testid="motion-export-modal"
      >
        <header class="mex-header">
          <div class="mex-title-wrap">
            <span class="mex-badge">EXPORT</span>
            <h2 class="mex-title">Export Animation &amp; Video</h2>
            <span class="mex-subtitle">
              {selectedClip ? `${selectedClip.name} · ${activePage.name}` : activePage.name}
            </span>
          </div>
          <button
            type="button"
            class="mt-icon-btn"
            aria-label="Close Animation Export dialog"
            disabled={isExporting}
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div class="mex-body">
          {/* LEFT: Format Grid + Live Preview Stage */}
          <div class="mex-left-col">
            <div class="mex-section-label">Output Format</div>
            <div class="mex-format-grid" role="radiogroup" aria-label="Animation export format">
              {MOTION_EXPORT_FORMATS.map((item) => {
                const isActive = item.id === format;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={isActive}
                    data-format={item.id}
                    class={`mex-format-card${isActive ? ' is-active' : ''}`}
                    disabled={isExporting}
                    onClick={() => handleSelectFormat(item.id)}
                  >
                    <div class="mex-format-card-top">
                      <span class="mex-format-short">{item.shortLabel}</span>
                      {item.supportsAlpha && <span class="mex-alpha-pill">ALPHA</span>}
                    </div>
                    <span class="mex-format-ext">.{item.extension}</span>
                  </button>
                );
              })}
            </div>
            <p class="mex-format-desc">{formatSpec.description}</p>

            {/* Preview Thumbnail */}
            <div class={`mex-preview-stage${formatSpec.supportsAlpha && transparentBackground ? ' is-checker' : ''}`}>
              {previewUrl ? (
                <img src={previewUrl} alt="Animation export frame preview" class="mex-preview-img" />
              ) : (
                <div class="mex-preview-placeholder">Preparing preview…</div>
              )}
              <div class="mex-preview-overlay-meta">
                <span>
                  {targetDims.width}×{targetDims.height}
                </span>
                {formatSpec.supportsFps && (
                  <>
                    <span>·</span>
                    <span>{fps} FPS</span>
                    <span>·</span>
                    <span>{frameCount} frames</span>
                  </>
                )}
              </div>
            </div>

            <div class="mex-codec-strip">
              <span class="mex-codec-kicker">ENGINE</span>
              <span class="mex-codec-value" data-testid="motion-export-codec-hint">{activeCodecHint}</span>
            </div>
          </div>

          {/* RIGHT: Clip, Resolution, FPS, Quality, Range & Alpha Controls */}
          <div class="mex-right-col">
            <label class="mex-field">
              <span class="mex-field-label">Animation Clip</span>
              <select
                class="mex-select"
                aria-label="Animation clip to export"
                value={selectedClip?.id ?? ''}
                disabled={isExporting || pageClips.length === 0}
                onChange={(event) => setSelectedClipId(event.currentTarget.value)}
              >
                {pageClips.length === 0 ? (
                  <option value="">Current Page Pose (No motion tracks yet)</option>
                ) : (
                  pageClips.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({(c.durationMs / 1000).toFixed(2)}s · {c.tracks.length} tracks)
                    </option>
                  ))
                )}
              </select>
            </label>

            {formatSpec.supportsResolution && (
              <div class="mex-row-2">
                <label class="mex-field">
                  <span class="mex-field-label">Resolution</span>
                  <select
                    class="mex-select"
                    aria-label="Export resolution"
                    value={resolution}
                    disabled={isExporting}
                    onChange={(event) => setResolution(event.currentTarget.value as MotionExportResolutionId)}
                  >
                    {MOTION_EXPORT_RESOLUTIONS.map((res) => (
                      <option key={res.id} value={res.id}>
                        {res.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div class="mex-field">
                  <span class="mex-field-label">Aspect Fit</span>
                  <div class="mex-seg-group">
                    <button
                      type="button"
                      class={`mex-seg-btn${fitMode === 'contain' ? ' is-active' : ''}`}
                      disabled={isExporting}
                      onClick={() => setFitMode('contain')}
                    >
                      Contain
                    </button>
                    <button
                      type="button"
                      class={`mex-seg-btn${fitMode === 'cover' ? ' is-active' : ''}`}
                      disabled={isExporting}
                      onClick={() => setFitMode('cover')}
                    >
                      Cover
                    </button>
                  </div>
                </div>
              </div>
            )}

            {formatSpec.supportsFps && (
              <div class="mex-field">
                <span class="mex-field-label">Frame Rate (FPS)</span>
                <div class="mex-seg-group">
                  {FPS_OPTIONS.map((rate) => (
                    <button
                      key={rate}
                      type="button"
                      class={`mex-seg-btn${fps === rate ? ' is-active' : ''}`}
                      disabled={isExporting}
                      onClick={() => setFps(rate)}
                    >
                      {rate} FPS
                    </button>
                  ))}
                </div>
              </div>
            )}

            {formatSpec.supportsQuality && (
              <div class="mex-field">
                <span class="mex-field-label">Encoding Quality</span>
                <div class="mex-seg-group">
                  {QUALITY_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      class={`mex-seg-btn${quality === opt.id ? ' is-active' : ''}`}
                      disabled={isExporting}
                      onClick={() => setQuality(opt.id)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {formatSpec.supportsFps && (
              <div class="mex-row-3">
                <label class="mex-field">
                  <span class="mex-field-label">Start (ms)</span>
                  <input
                    type="number"
                    class="mex-input"
                    min={0}
                    max={Math.max(0, safeEndMs - 50)}
                    step={50}
                    aria-label="Export start time (ms)"
                    value={safeStartMs}
                    disabled={isExporting}
                    onChange={(event) => {
                      const v = Number.parseInt(event.currentTarget.value, 10);
                      if (Number.isFinite(v)) setStartMs(Math.max(0, Math.min(v, safeEndMs)));
                    }}
                  />
                </label>

                <label class="mex-field">
                  <span class="mex-field-label">End (ms)</span>
                  <input
                    type="number"
                    class="mex-input"
                    min={safeStartMs + 50}
                    max={60000}
                    step={50}
                    aria-label="Export end time (ms)"
                    value={safeEndMs}
                    disabled={isExporting}
                    onChange={(event) => {
                      const v = Number.parseInt(event.currentTarget.value, 10);
                      if (Number.isFinite(v)) setEndMs(Math.max(safeStartMs + 50, v));
                    }}
                  />
                </label>

                <label class="mex-field">
                  <span class="mex-field-label">{format === 'gif' ? 'GIF Loop' : 'Passes'}</span>
                  <select
                    class="mex-select"
                    aria-label="Loop count"
                    value={loopCount}
                    disabled={isExporting}
                    onChange={(event) => setLoopCount(Number.parseInt(event.currentTarget.value, 10))}
                  >
                    {format === 'gif' ? (
                      <>
                        <option value={0}>Infinite</option>
                        <option value={1}>1× Once</option>
                        <option value={2}>2×</option>
                        <option value={3}>3×</option>
                      </>
                    ) : (
                      <>
                        <option value={1}>1× (Single)</option>
                        <option value={2}>2× Loop</option>
                        <option value={3}>3× Loop</option>
                      </>
                    )}
                  </select>
                </label>
              </div>
            )}

            {formatSpec.supportsAlpha && (
              <label class="mex-checkbox-row">
                <input
                  type="checkbox"
                  checked={transparentBackground}
                  disabled={isExporting}
                  onChange={(event) => setTransparentBackground(event.currentTarget.checked)}
                />
                <span>
                  <strong>Transparent Background (Alpha Channel)</strong>
                  <small>
                    {format === 'mov'
                      ? 'Uses QuickTime Lossless 32-bit RGBA PNG codec for Premiere, After Effects & CapCut overlays.'
                      : 'Exports transparent backdrop with preserved alpha.'}
                  </small>
                </span>
              </label>
            )}

            {clipHasMorphTracks && format === 'css' && (
              <div class="mex-error-box" role="note" data-testid="motion-export-morph-css-warning">
                Shape Morph tracks require Bezier geometry interpolation and are not animated in pure CSS @keyframes.
                Use HTML5, MP4, MOV, WebM, GIF, PNG Sequence, or Motion JSON for full Shape Morph output.
              </div>
            )}

            {/* Progress & Status Area */}
            {isExporting && progress && (
              <div class="mex-progress-box" role="status" aria-live="polite">
                <div class="mex-progress-head">
                  <span>{progress.message}</span>
                  <strong>{progress.percent}%</strong>
                </div>
                <div class="mex-progress-track">
                  <div class="mex-progress-fill" style={{ width: `${progress.percent}%` }} />
                </div>
              </div>
            )}

            {errorMessage && (
              <div class="mex-error-box" role="alert">
                {errorMessage}
              </div>
            )}

            {lastResult && !isExporting && (
              <div class="mex-success-box" data-testid="motion-export-success">
                <div class="mex-success-meta">
                  <strong>{lastResult.filename}</strong>
                  <span>
                    {lastResult.codecLabel} · {formatFileSize(lastResult.sizeBytes)} · {lastResult.totalFrames} frame
                    {lastResult.totalFrames === 1 ? '' : 's'}
                  </span>
                </div>
                <button
                  type="button"
                  class="mex-secondary-btn"
                  onClick={() => triggerMotionBlobDownload(lastResult.blob, lastResult.filename)}
                >
                  Download Again
                </button>
              </div>
            )}
          </div>
        </div>

        <footer class="mex-footer">
          <span class="mex-footer-hint">
            100% client-side native encoding · Preserves Modern Effects, Alpha &amp; Custom Easing Curves
          </span>
          <div class="mex-footer-actions">
            {isExporting ? (
              <button type="button" class="mex-danger-btn" onClick={handleCancelExport}>
                Cancel Export
              </button>
            ) : (
              <>
                <button type="button" class="mex-secondary-btn" onClick={onClose}>
                  Close
                </button>
                <button
                  type="button"
                  class="mex-primary-btn"
                  data-testid="motion-export-start-btn"
                  onClick={handleStartExport}
                >
                  Export {formatSpec.shortLabel}
                </button>
              </>
            )}
          </div>
        </footer>
      </div>
    </div>
  );

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalContent, document.body);
  }
  return modalContent;
}
