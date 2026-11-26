import type {
  AnimationClip,
  BreakpointId,
  FolioDocument,
  FolioPage,
  FolioProject,
} from '../../core/document/types';
import { getProjectDesignTokens } from '../../core/document/tokens';
import { serializeDocumentToSvgString } from '../../app/visualExport';
import { buildLivePreviewHtml } from '../codegen/htmlCssCompiler';
import { buildZipArchive, type ZipArchiveEntry } from '../codegen/zipArchive';
import { compilePageAnimationsCss } from './codegen';
import { applyAnimatedPosesToDocument, evaluateClipAtTime } from './evaluator';
import { encodeAnimatedGif, type GifFrameInput } from './gifEncoder';
import { muxIsoBmffVideo, muxWebmVideo, type MuxedVideoSample } from './videoMuxer';

export type MotionExportFormatId =
  | 'mp4'
  | 'mov'
  | 'webm'
  | 'gif'
  | 'png-sequence'
  | 'html5'
  | 'css'
  | 'json';

export type MotionExportResolutionId =
  | 'canvas'
  | '720p'
  | '1080p'
  | '4k'
  | 'reels-9x16'
  | 'square-1x1';

export type MotionExportQualityId = 'draft' | 'standard' | 'high' | 'lossless';

export interface MotionExportFormatSpec {
  readonly id: MotionExportFormatId;
  readonly label: string;
  readonly shortLabel: string;
  readonly extension: string;
  readonly mimeType: string;
  readonly category: 'video' | 'image' | 'web';
  readonly supportsAlpha: boolean;
  readonly supportsFps: boolean;
  readonly supportsResolution: boolean;
  readonly supportsQuality: boolean;
  readonly description: string;
}

export const MOTION_EXPORT_FORMATS: readonly MotionExportFormatSpec[] = [
  {
    id: 'mp4',
    label: 'MP4 Video (H.264)',
    shortLabel: 'MP4',
    extension: 'mp4',
    mimeType: 'video/mp4',
    category: 'video',
    supportsAlpha: false,
    supportsFps: true,
    supportsResolution: true,
    supportsQuality: true,
    description: 'Universal H.264 video for YouTube, Reels, CapCut, Windows & Mobile.',
  },
  {
    id: 'mov',
    label: 'QuickTime MOV',
    shortLabel: 'MOV',
    extension: 'mov',
    mimeType: 'video/quicktime',
    category: 'video',
    supportsAlpha: true,
    supportsFps: true,
    supportsResolution: true,
    supportsQuality: true,
    description: 'H.264 QuickTime or Lossless 32-bit RGBA Alpha MOV for Premiere, After Effects & DaVinci.',
  },
  {
    id: 'webm',
    label: 'WebM Video (VP9/VP8)',
    shortLabel: 'WebM',
    extension: 'webm',
    mimeType: 'video/webm',
    category: 'video',
    supportsAlpha: false,
    supportsFps: true,
    supportsResolution: true,
    supportsQuality: true,
    description: 'High-efficiency open web video with crisp motion at small file sizes.',
  },
  {
    id: 'gif',
    label: 'Animated GIF',
    shortLabel: 'GIF',
    extension: 'gif',
    mimeType: 'image/gif',
    category: 'image',
    supportsAlpha: true,
    supportsFps: true,
    supportsResolution: true,
    supportsQuality: false,
    description: 'Native GIF89a with Bayer dithering, loop control & transparent background.',
  },
  {
    id: 'png-sequence',
    label: 'PNG Sequence (ZIP)',
    shortLabel: 'PNG ZIP',
    extension: 'zip',
    mimeType: 'application/zip',
    category: 'image',
    supportsAlpha: true,
    supportsFps: true,
    supportsResolution: true,
    supportsQuality: false,
    description: 'Lossless frame-by-frame PNGs + manifest.json with full RGBA transparency.',
  },
  {
    id: 'html5',
    label: 'HTML5 Animation',
    shortLabel: 'HTML5',
    extension: 'html',
    mimeType: 'text/html;charset=utf-8',
    category: 'web',
    supportsAlpha: false,
    supportsFps: false,
    supportsResolution: false,
    supportsQuality: false,
    description: 'Self-contained interactive HTML5 file with compiled @keyframes & Modern Effects.',
  },
  {
    id: 'css',
    label: 'CSS @keyframes',
    shortLabel: 'CSS',
    extension: 'css',
    mimeType: 'text/css;charset=utf-8',
    category: 'web',
    supportsAlpha: false,
    supportsFps: false,
    supportsResolution: false,
    supportsQuality: false,
    description: 'Production CSS @keyframes stylesheet with custom cubic-bezier & linear() curves.',
  },
  {
    id: 'json',
    label: 'Motion JSON',
    shortLabel: 'JSON',
    extension: 'json',
    mimeType: 'application/json;charset=utf-8',
    category: 'web',
    supportsAlpha: false,
    supportsFps: false,
    supportsResolution: false,
    supportsQuality: false,
    description: 'Portable Folio animation tracks, keyframes & custom easing curves JSON.',
  },
];

export const MOTION_EXPORT_RESOLUTIONS: ReadonlyArray<{
  readonly id: MotionExportResolutionId;
  readonly label: string;
  readonly width: number;
  readonly height: number;
}> = [
  { id: 'canvas', label: 'Canvas Native (1×)', width: 0, height: 0 },
  { id: '720p', label: 'HD 720p (1280×720)', width: 1280, height: 720 },
  { id: '1080p', label: 'Full HD 1080p (1920×1080)', width: 1920, height: 1080 },
  { id: '4k', label: 'Ultra HD 4K (3840×2160)', width: 3840, height: 2160 },
  { id: 'reels-9x16', label: 'Vertical / Reels (1080×1920)', width: 1080, height: 1920 },
  { id: 'square-1x1', label: 'Square Social (1080×1080)', width: 1080, height: 1080 },
];

export interface MotionExportOptions {
  readonly format: MotionExportFormatId;
  readonly resolution: MotionExportResolutionId;
  readonly fps: number;
  readonly quality: MotionExportQualityId;
  readonly startMs: number;
  readonly endMs: number;
  /** Number of playback passes for video/sequence, or GIF loop count (0 = infinite). */
  readonly loopCount: number;
  readonly transparentBackground: boolean;
  readonly breakpoint?: BreakpointId;
  readonly fitMode?: 'contain' | 'cover';
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: MotionExportProgress) => void;
}

export interface MotionExportProgress {
  readonly phase: 'preparing' | 'rendering' | 'encoding' | 'muxing' | 'complete';
  readonly frame: number;
  readonly totalFrames: number;
  readonly percent: number;
  readonly message: string;
  readonly previewDataUrl?: string;
}

export interface MotionExportResult {
  readonly blob: Blob;
  readonly filename: string;
  readonly format: MotionExportFormatId;
  readonly codecLabel: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly totalFrames: number;
  readonly durationMs: number;
  readonly sizeBytes: number;
}

export interface VideoExportCapabilities {
  readonly webCodecsAvc: boolean;
  readonly webCodecsVp9: boolean;
  readonly webCodecsVp8: boolean;
  readonly mediaRecorderMp4: boolean;
  readonly mediaRecorderWebm: boolean;
  readonly avcCodecString: string | null;
  readonly webmCodecString: string | null;
}

function makeEven(n: number): number {
  const rounded = Math.max(2, Math.round(n));
  return rounded % 2 === 0 ? rounded : rounded + 1;
}

/**
 * Computes encoder-safe (even-aligned) target dimensions for any resolution preset.
 */
export function computeExportDimensions(
  docWidth: number,
  docHeight: number,
  resolution: MotionExportResolutionId,
  format: MotionExportFormatId,
): { width: number; height: number } {
  const preset = MOTION_EXPORT_RESOLUTIONS.find((r) => r.id === resolution);
  const rawW = preset && preset.width > 0 ? preset.width : Math.max(16, docWidth);
  const rawH = preset && preset.height > 0 ? preset.height : Math.max(16, docHeight);
  // Video hardware encoders (H.264, VP9, VP8) require even pixel dimensions.
  if (format === 'mp4' || format === 'mov' || format === 'webm') {
    return { width: makeEven(rawW), height: makeEven(rawH) };
  }
  return { width: Math.max(2, Math.round(rawW)), height: Math.max(2, Math.round(rawH)) };
}

/**
 * Computes sensible target bitrate (bits/sec) scaled by pixel area, FPS, and quality preset.
 */
export function computeTargetBitrate(
  width: number,
  height: number,
  fps: number,
  quality: MotionExportQualityId,
): number {
  const pixelsPerSec = Math.max(1, width * height * Math.max(1, fps));
  const bppByQuality: Record<MotionExportQualityId, number> = {
    draft: 0.06,
    standard: 0.14,
    high: 0.26,
    lossless: 0.45,
  };
  const raw = Math.round(pixelsPerSec * bppByQuality[quality]);
  return Math.max(600_000, Math.min(45_000_000, raw));
}

/**
 * Builds deterministic frame timestamps (ms) across `[startMs, endMs]` for `fps` and `passes`.
 */
export function buildFrameSchedule(
  startMs: number,
  endMs: number,
  fps: number,
  passes = 1,
): number[] {
  const safeFps = Math.max(1, Math.min(60, Math.round(fps)));
  const safeStart = Math.max(0, Math.round(startMs));
  const safeEnd = Math.max(safeStart, Math.round(endMs));
  const spanMs = safeEnd - safeStart;
  const frameStepMs = 1000 / safeFps;
  const framesPerPass = Math.max(1, Math.round((spanMs / 1000) * safeFps) + 1);
  const safePasses = Math.max(1, Math.min(10, Math.round(passes)));
  const schedule: number[] = [];

  for (let pass = 0; pass < safePasses; pass += 1) {
    for (let i = 0; i < framesPerPass; i += 1) {
      if (pass > 0 && i === 0 && framesPerPass > 1) continue;
      const t = i === framesPerPass - 1 ? safeEnd : Math.min(safeEnd, safeStart + i * frameStepMs);
      schedule.push(Math.round(t * 100) / 100);
    }
  }
  return schedule;
}

export function createMotionExportFilename(
  projectName: string,
  clipName: string,
  format: MotionExportFormatId,
): string {
  const spec = MOTION_EXPORT_FORMATS.find((f) => f.id === format);
  const ext = spec?.extension ?? 'mp4';
  const base = `${projectName || 'folio'}-${clipName || 'motion'}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'folio-animation'}.${ext}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

export function triggerMotionBlobDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Probes live browser WebCodecs & MediaRecorder support for MP4 (H.264), MOV, and WebM (VP9/VP8).
 */
export async function detectVideoExportCapabilities(
  sampleWidth = 1280,
  sampleHeight = 720,
): Promise<VideoExportCapabilities> {
  const hasWebCodecs = typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
  let avcCodecString: string | null = null;
  let webmCodecString: string | null = null;
  let webCodecsVp9 = false;
  let webCodecsVp8 = false;

  if (hasWebCodecs) {
    const avcCandidates = ['avc1.640028', 'avc1.4d0028', 'avc1.42001f', 'avc1.42E01E'];
    for (const codec of avcCandidates) {
      try {
        const res = await VideoEncoder.isConfigSupported({
          codec,
          width: makeEven(sampleWidth),
          height: makeEven(sampleHeight),
          bitrate: 4_000_000,
          framerate: 30,
          avc: { format: 'avc' },
        });
        if (res.supported) {
          avcCodecString = codec;
          break;
        }
      } catch {
        // Probe next profile
      }
    }

    try {
      const vp9 = await VideoEncoder.isConfigSupported({
        codec: 'vp09.00.10.08',
        width: makeEven(sampleWidth),
        height: makeEven(sampleHeight),
        bitrate: 3_000_000,
        framerate: 30,
      });
      if (vp9.supported) {
        webCodecsVp9 = true;
        webmCodecString = 'vp09.00.10.08';
      }
    } catch {
      // Ignore probe error
    }

    try {
      const vp8 = await VideoEncoder.isConfigSupported({
        codec: 'vp8',
        width: makeEven(sampleWidth),
        height: makeEven(sampleHeight),
        bitrate: 3_000_000,
        framerate: 30,
      });
      if (vp8.supported) {
        webCodecsVp8 = true;
        if (!webmCodecString) webmCodecString = 'vp8';
      }
    } catch {
      // Ignore probe error
    }
  }

  const hasMediaRecorder = typeof MediaRecorder === 'function' && typeof MediaRecorder.isTypeSupported === 'function';
  const mediaRecorderMp4 = hasMediaRecorder
    && (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E') || MediaRecorder.isTypeSupported('video/mp4'));
  const mediaRecorderWebm = hasMediaRecorder
    && (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      || MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      || MediaRecorder.isTypeSupported('video/webm'));

  return {
    webCodecsAvc: Boolean(avcCodecString),
    webCodecsVp9,
    webCodecsVp8,
    mediaRecorderMp4,
    mediaRecorderWebm,
    avcCodecString,
    webmCodecString,
  };
}

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException('Animation export cancelled.', 'AbortError');
  }
}

async function yieldToMainThread(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Renders a single evaluated animation frame onto `canvas` with exact aspect-ratio fit.
 */
export async function renderAnimatedFrameToCanvas(
  project: FolioProject,
  page: FolioPage,
  clip: AnimationClip | null,
  timeMs: number,
  canvas: HTMLCanvasElement,
  options: {
    transparentBackground: boolean;
    breakpoint?: BreakpointId;
    fitMode?: 'contain' | 'cover';
  },
): Promise<void> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('2D canvas context is unavailable for animation frame rendering.');
  }

  let frameDoc: FolioDocument = page.document;
  if (clip && clip.tracks.length > 0) {
    const poses = evaluateClipAtTime(clip, timeMs);
    frameDoc = applyAnimatedPosesToDocument(page.document, poses);
  }
  if (options.transparentBackground) {
    frameDoc = { ...frameDoc, background: 'transparent' };
  }

  const tokens = getProjectDesignTokens(project);
  const svg = serializeDocumentToSvgString(frameDoc, project.components, {
    title: `${project.metadata.name} - ${clip?.name ?? page.name}`,
    designTokens: tokens,
    assets: project.assets,
    breakpoint: options.breakpoint ?? 'desktop',
    rasterizeSafe: true,
  });

  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Browser failed to rasterize animation SVG frame.'));
      image.src = svgUrl;
    });

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!options.transparentBackground) {
      const bg = page.document.background;
      const fillBg = bg && bg !== 'transparent' && bg !== 'none' && bg !== '#00000000' ? bg : '#12161A';
      ctx.fillStyle = fillBg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    const srcW = Math.max(1, img.naturalWidth || page.document.width);
    const srcH = Math.max(1, img.naturalHeight || page.document.height);
    const scale = options.fitMode === 'cover'
      ? Math.max(canvas.width / srcW, canvas.height / srcH)
      : Math.min(canvas.width / srcW, canvas.height / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const dx = (canvas.width - drawW) / 2;
    const dy = (canvas.height - drawH) / 2;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, dx, dy, drawW, drawH);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

async function canvasToBytes(canvas: HTMLCanvasElement, mime: 'image/png' | 'image/jpeg', quality?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error(`Failed to encode frame as ${mime}.`));
      },
      mime,
      quality,
    );
  });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Encodes frames deterministically via WebCodecs `VideoEncoder` (zero dropped frames, exact timestamps).
 */
async function encodeFramesWithWebCodecs(
  project: FolioProject,
  page: FolioPage,
  clip: AnimationClip | null,
  schedule: readonly number[],
  canvas: HTMLCanvasElement,
  config: {
    codec: string;
    isAvc: boolean;
    fps: number;
    bitrate: number;
    transparentBackground: boolean;
    breakpoint?: BreakpointId;
    fitMode?: 'contain' | 'cover';
    signal?: AbortSignal;
    onProgress?: (progress: MotionExportProgress) => void;
  },
): Promise<{ samples: MuxedVideoSample[]; avcConfig?: Uint8Array }> {
  const samples: MuxedVideoSample[] = [];
  let avcConfig: Uint8Array | undefined;
  let encoderError: Error | null = null;
  const frameDurationMs = 1000 / config.fps;
  const frameDurationUs = Math.round(frameDurationMs * 1000);

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      if (config.isAvc && !avcConfig && metadata?.decoderConfig?.description) {
        const desc = metadata.decoderConfig.description;
        if (desc instanceof ArrayBuffer) {
          avcConfig = new Uint8Array(desc.slice(0));
        } else if (ArrayBuffer.isView(desc)) {
          avcConfig = new Uint8Array(desc.buffer.slice(desc.byteOffset, desc.byteOffset + desc.byteLength));
        }
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      samples.push({
        data,
        durationMs: chunk.duration ? chunk.duration / 1000 : frameDurationMs,
        timestampMs: chunk.timestamp / 1000,
        isKeyframe: chunk.type === 'key',
      });
    },
    error: (err) => {
      encoderError = err instanceof Error ? err : new Error(String(err));
    },
  });

  const encoderConfig: VideoEncoderConfig = {
    codec: config.codec,
    width: canvas.width,
    height: canvas.height,
    bitrate: config.bitrate,
    framerate: config.fps,
    latencyMode: 'quality',
    ...(config.isAvc ? { avc: { format: 'avc' as const } } : {}),
  };

  encoder.configure(encoderConfig);
  const keyframeInterval = Math.max(1, Math.round(config.fps * 2));

  try {
    for (let i = 0; i < schedule.length; i += 1) {
      checkAborted(config.signal);
      if (encoderError) throw encoderError;

      await renderAnimatedFrameToCanvas(project, page, clip, schedule[i], canvas, {
        transparentBackground: config.transparentBackground,
        breakpoint: config.breakpoint,
        fitMode: config.fitMode,
      });

      const frame = new VideoFrame(canvas, {
        timestamp: i * frameDurationUs,
        duration: frameDurationUs,
      });
      try {
        encoder.encode(frame, { keyFrame: i === 0 || i % keyframeInterval === 0 });
      } finally {
        frame.close();
      }

      // Backpressure guard for low-spec PCs so encoder queue never spikes RAM
      while (encoder.encodeQueueSize > 8) {
        checkAborted(config.signal);
        await yieldToMainThread();
      }

      if (i % 2 === 0 || i === schedule.length - 1) {
        config.onProgress?.({
          phase: 'encoding',
          frame: i + 1,
          totalFrames: schedule.length,
          percent: Math.round(((i + 1) / schedule.length) * 90),
          message: `Encoding frame ${i + 1} / ${schedule.length} (${config.isAvc ? 'H.264' : config.codec.toUpperCase()})…`,
          previewDataUrl: i % 4 === 0 || i === schedule.length - 1 ? canvas.toDataURL('image/jpeg', 0.6) : undefined,
        });
        await yieldToMainThread();
      }
    }

    await encoder.flush();
    if (encoderError) throw encoderError;
  } finally {
    if (encoder.state !== 'closed') {
      encoder.close();
    }
  }

  return { samples, avcConfig };
}

/**
 * Fallback encoder using MediaRecorder when WebCodecs isn't available for a container.
 */
async function encodeFramesWithMediaRecorder(
  project: FolioProject,
  page: FolioPage,
  clip: AnimationClip | null,
  schedule: readonly number[],
  canvas: HTMLCanvasElement,
  config: {
    mimeType: string;
    fps: number;
    bitrate: number;
    transparentBackground: boolean;
    breakpoint?: BreakpointId;
    fitMode?: 'contain' | 'cover';
    signal?: AbortSignal;
    onProgress?: (progress: MotionExportProgress) => void;
  },
): Promise<Blob> {
  const stream = canvas.captureStream(config.fps);
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, {
    mimeType: config.mimeType,
    videoBitsPerSecond: config.bitrate,
  });

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.onerror = () => reject(new Error('MediaRecorder failed during video capture.'));
    recorder.onstop = () => resolve(new Blob(chunks, { type: config.mimeType }));
  });

  const frameDelayMs = Math.max(16, Math.round(1000 / config.fps));
  recorder.start();

  try {
    for (let i = 0; i < schedule.length; i += 1) {
      checkAborted(config.signal);
      await renderAnimatedFrameToCanvas(project, page, clip, schedule[i], canvas, {
        transparentBackground: config.transparentBackground,
        breakpoint: config.breakpoint,
        fitMode: config.fitMode,
      });
      config.onProgress?.({
        phase: 'encoding',
        frame: i + 1,
        totalFrames: schedule.length,
        percent: Math.round(((i + 1) / schedule.length) * 92),
        message: `Capturing frame ${i + 1} / ${schedule.length}…`,
      });
      await new Promise<void>((r) => setTimeout(r, frameDelayMs));
    }
  } finally {
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
    for (const track of stream.getTracks()) track.stop();
  }

  return stopped;
}

/**
 * Builds portable Folio Motion JSON export data for a clip and its custom easings.
 */
export function buildMotionClipJson(
  project: FolioProject,
  page: FolioPage,
  clip: AnimationClip | null,
): string {
  const payload = {
    schema: 'folio.motion.v1',
    exportedAt: new Date().toISOString(),
    projectName: project.metadata.name,
    page: {
      id: page.id,
      name: page.name,
      route: page.route,
      width: page.document.width,
      height: page.document.height,
      background: page.document.background,
    },
    clip: clip ?? null,
    customEasings: project.customEasings ?? [],
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Master entry point: exports an animation clip (or static page pose) in any of Folio's
 * 8 supported animation formats: MP4, MOV, WebM, GIF, PNG Sequence (ZIP), HTML5, CSS, JSON.
 */
export async function exportMotionAnimation(
  project: FolioProject,
  page: FolioPage,
  clip: AnimationClip | null,
  options: MotionExportOptions,
): Promise<MotionExportResult> {
  const clipName = clip?.name ?? page.name;
  const filename = createMotionExportFilename(project.metadata.name, clipName, options.format);
  const startMs = Math.max(0, Math.round(options.startMs));
  const rawEnd = Math.round(options.endMs);
  const endMs = Math.max(startMs, rawEnd > startMs ? rawEnd : (clip?.durationMs ?? 1000));
  const durationMs = Math.max(100, endMs - startMs);

  // --- Lightweight Web / Code Formats (Instant, zero canvas rasterization needed) ---
  if (options.format === 'html5') {
    options.onProgress?.({ phase: 'encoding', frame: 1, totalFrames: 1, percent: 80, message: 'Compiling standalone HTML5 animation…' });
    const html = buildLivePreviewHtml(project, {
      pageId: page.id,
      includeCustomScripts: false,
      themeId: getProjectDesignTokens(project).activeThemeId,
    });
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    options.onProgress?.({ phase: 'complete', frame: 1, totalFrames: 1, percent: 100, message: 'HTML5 animation ready.' });
    return {
      blob,
      filename,
      format: 'html5',
      codecLabel: 'HTML5 + CSS @keyframes',
      width: page.document.width,
      height: page.document.height,
      fps: 60,
      totalFrames: 1,
      durationMs,
      sizeBytes: blob.size,
    };
  }

  if (options.format === 'css') {
    options.onProgress?.({ phase: 'encoding', frame: 1, totalFrames: 1, percent: 80, message: 'Compiling CSS @keyframes…' });
    const css = compilePageAnimationsCss(project, page)
      || '/* No animated tracks found on this page yet. Add keyframes in Motion Timeline. */\n';
    const blob = new Blob([css], { type: 'text/css;charset=utf-8' });
    options.onProgress?.({ phase: 'complete', frame: 1, totalFrames: 1, percent: 100, message: 'CSS @keyframes ready.' });
    return {
      blob,
      filename,
      format: 'css',
      codecLabel: 'CSS3 @keyframes',
      width: page.document.width,
      height: page.document.height,
      fps: 60,
      totalFrames: 1,
      durationMs,
      sizeBytes: blob.size,
    };
  }

  if (options.format === 'json') {
    options.onProgress?.({ phase: 'encoding', frame: 1, totalFrames: 1, percent: 80, message: 'Serializing Motion JSON…' });
    const json = buildMotionClipJson(project, page, clip);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    options.onProgress?.({ phase: 'complete', frame: 1, totalFrames: 1, percent: 100, message: 'Motion JSON ready.' });
    return {
      blob,
      filename,
      format: 'json',
      codecLabel: 'Folio Motion JSON v1',
      width: page.document.width,
      height: page.document.height,
      fps: options.fps,
      totalFrames: 1,
      durationMs,
      sizeBytes: blob.size,
    };
  }

  // --- Frame-Rendered Formats (MP4, MOV, WebM, GIF, PNG Sequence ZIP) ---
  checkAborted(options.signal);
  const { width, height } = computeExportDimensions(
    page.document.width,
    page.document.height,
    options.resolution,
    options.format,
  );
  const fps = Math.max(5, Math.min(60, Math.round(options.fps)));
  const passes = options.format === 'gif' ? 1 : Math.max(1, Math.min(5, Math.round(options.loopCount || 1)));
  const schedule = buildFrameSchedule(startMs, endMs, fps, passes);
  const frameDurationMs = 1000 / fps;
  const totalDurationMs = schedule.length * frameDurationMs;

  options.onProgress?.({
    phase: 'preparing',
    frame: 0,
    totalFrames: schedule.length,
    percent: 2,
    message: `Preparing ${width}×${height} @ ${fps} FPS (${schedule.length} frames)…`,
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  // --- PNG Sequence (ZIP) ---
  if (options.format === 'png-sequence') {
    const entries: ZipArchiveEntry[] = [];
    const padLen = Math.max(4, String(schedule.length).length);
    for (let i = 0; i < schedule.length; i += 1) {
      checkAborted(options.signal);
      await renderAnimatedFrameToCanvas(project, page, clip, schedule[i], canvas, {
        transparentBackground: options.transparentBackground,
        breakpoint: options.breakpoint,
        fitMode: options.fitMode,
      });
      const pngBytes = await canvasToBytes(canvas, 'image/png');
      const frameIndex = String(i + 1).padStart(padLen, '0');
      entries.push({ path: `frames/frame_${frameIndex}.png`, content: pngBytes });
      if (i % 2 === 0 || i === schedule.length - 1) {
        options.onProgress?.({
          phase: 'rendering',
          frame: i + 1,
          totalFrames: schedule.length,
          percent: Math.round(((i + 1) / schedule.length) * 90),
          message: `Rendering PNG frame ${i + 1} / ${schedule.length}…`,
          previewDataUrl: i % 4 === 0 || i === schedule.length - 1 ? canvas.toDataURL('image/png') : undefined,
        });
        await yieldToMainThread();
      }
    }

    options.onProgress?.({ phase: 'muxing', frame: schedule.length, totalFrames: schedule.length, percent: 95, message: 'Packing ZIP archive…' });
    const manifest = JSON.stringify(
      {
        schema: 'folio.png-sequence.v1',
        projectName: project.metadata.name,
        clipName,
        width,
        height,
        fps,
        totalFrames: schedule.length,
        durationMs: Math.round(totalDurationMs),
        transparentBackground: options.transparentBackground,
        files: entries.map((e) => e.path),
      },
      null,
      2,
    );
    entries.unshift({ path: 'manifest.json', content: manifest });
    const zipBytes = buildZipArchive(entries);
    const blob = bytesToBlob(zipBytes, 'application/zip');
    options.onProgress?.({ phase: 'complete', frame: schedule.length, totalFrames: schedule.length, percent: 100, message: 'PNG Sequence ZIP ready.' });
    return {
      blob,
      filename,
      format: 'png-sequence',
      codecLabel: options.transparentBackground ? 'Lossless PNG RGBA (ZIP)' : 'Lossless PNG RGB (ZIP)',
      width,
      height,
      fps,
      totalFrames: schedule.length,
      durationMs: Math.round(totalDurationMs),
      sizeBytes: blob.size,
    };
  }

  // --- Animated GIF (GIF89a) ---
  if (options.format === 'gif') {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D context unavailable for GIF export.');
    const gifFrames: GifFrameInput[] = [];
    for (let i = 0; i < schedule.length; i += 1) {
      checkAborted(options.signal);
      await renderAnimatedFrameToCanvas(project, page, clip, schedule[i], canvas, {
        transparentBackground: options.transparentBackground,
        breakpoint: options.breakpoint,
        fitMode: options.fitMode,
      });
      const imgData = ctx.getImageData(0, 0, width, height);
      gifFrames.push({
        rgba: new Uint8ClampedArray(imgData.data),
        delayMs: frameDurationMs,
      });
      if (i % 2 === 0 || i === schedule.length - 1) {
        options.onProgress?.({
          phase: 'rendering',
          frame: i + 1,
          totalFrames: schedule.length,
          percent: Math.round(((i + 1) / schedule.length) * 80),
          message: `Capturing GIF frame ${i + 1} / ${schedule.length}…`,
          previewDataUrl: i % 4 === 0 || i === schedule.length - 1 ? canvas.toDataURL('image/png') : undefined,
        });
        await yieldToMainThread();
      }
    }
    options.onProgress?.({ phase: 'muxing', frame: schedule.length, totalFrames: schedule.length, percent: 90, message: 'Compressing GIF89a LZW stream…' });
    await yieldToMainThread();
    const gifBytes = encodeAnimatedGif(gifFrames, {
      width,
      height,
      loopCount: options.loopCount,
      transparent: options.transparentBackground,
      dither: true,
    });
    const blob = bytesToBlob(gifBytes, 'image/gif');
    options.onProgress?.({ phase: 'complete', frame: schedule.length, totalFrames: schedule.length, percent: 100, message: 'Animated GIF ready.' });
    return {
      blob,
      filename,
      format: 'gif',
      codecLabel: options.transparentBackground ? 'GIF89a (LZW + Alpha)' : 'GIF89a (LZW 256-Color)',
      width,
      height,
      fps,
      totalFrames: schedule.length,
      durationMs: Math.round(totalDurationMs),
      sizeBytes: blob.size,
    };
  }

  // --- Video Formats (MP4, MOV, WebM) ---
  const capabilities = await detectVideoExportCapabilities(width, height);
  const bitrate = computeTargetBitrate(width, height, fps, options.quality);

  // --- MOV (QuickTime): Alpha RGBA (`png ` codec) OR H.264 (`avc1` + `qt  `) ---
  if (options.format === 'mov') {
    const useQuickTimePng = options.transparentBackground || options.quality === 'lossless' || !capabilities.webCodecsAvc;
    if (useQuickTimePng) {
      const samples: MuxedVideoSample[] = [];
      for (let i = 0; i < schedule.length; i += 1) {
        checkAborted(options.signal);
        await renderAnimatedFrameToCanvas(project, page, clip, schedule[i], canvas, {
          transparentBackground: options.transparentBackground,
          breakpoint: options.breakpoint,
          fitMode: options.fitMode,
        });
        const pngBytes = await canvasToBytes(canvas, 'image/png');
        samples.push({
          data: pngBytes,
          durationMs: frameDurationMs,
          timestampMs: i * frameDurationMs,
          isKeyframe: true,
        });
        if (i % 2 === 0 || i === schedule.length - 1) {
          options.onProgress?.({
            phase: 'encoding',
            frame: i + 1,
            totalFrames: schedule.length,
            percent: Math.round(((i + 1) / schedule.length) * 90),
            message: `Encoding QuickTime PNG frame ${i + 1} / ${schedule.length}…`,
            previewDataUrl: i % 4 === 0 || i === schedule.length - 1 ? canvas.toDataURL('image/png') : undefined,
          });
          await yieldToMainThread();
        }
      }
      options.onProgress?.({ phase: 'muxing', frame: schedule.length, totalFrames: schedule.length, percent: 95, message: 'Muxing QuickTime .mov container…' });
      const movBytes = muxIsoBmffVideo(samples, {
        container: 'mov',
        codec: 'png ',
        width,
        height,
        depth: options.transparentBackground ? 32 : 24,
      });
      const blob = bytesToBlob(movBytes, 'video/quicktime');
      options.onProgress?.({ phase: 'complete', frame: schedule.length, totalFrames: schedule.length, percent: 100, message: 'QuickTime MOV ready.' });
      return {
        blob,
        filename,
        format: 'mov',
        codecLabel: options.transparentBackground ? 'QuickTime MOV (Lossless PNG 32-bit RGBA)' : 'QuickTime MOV (Lossless PNG)',
        width,
        height,
        fps,
        totalFrames: schedule.length,
        durationMs: Math.round(totalDurationMs),
        sizeBytes: blob.size,
      };
    }

    // Opaque H.264 QuickTime `.mov` via WebCodecs
    const encoded = await encodeFramesWithWebCodecs(project, page, clip, schedule, canvas, {
      codec: capabilities.avcCodecString!,
      isAvc: true,
      fps,
      bitrate,
      transparentBackground: false,
      breakpoint: options.breakpoint,
      fitMode: options.fitMode,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    options.onProgress?.({ phase: 'muxing', frame: schedule.length, totalFrames: schedule.length, percent: 95, message: 'Muxing QuickTime H.264 .mov…' });
    const movBytes = muxIsoBmffVideo(encoded.samples, {
      container: 'mov',
      codec: 'avc1',
      width,
      height,
      avcConfig: encoded.avcConfig,
      depth: 24,
    });
    const blob = bytesToBlob(movBytes, 'video/quicktime');
    options.onProgress?.({ phase: 'complete', frame: schedule.length, totalFrames: schedule.length, percent: 100, message: 'QuickTime MOV (H.264) ready.' });
    return {
      blob,
      filename,
      format: 'mov',
      codecLabel: 'QuickTime MOV (H.264 / AVC)',
      width,
      height,
      fps,
      totalFrames: schedule.length,
      durationMs: Math.round(totalDurationMs),
      sizeBytes: blob.size,
    };
  }

  // --- MP4 (ISO BMFF): WebCodecs H.264 -> MediaRecorder MP4 -> ISO BMFF MJPEG Fallback ---
  if (options.format === 'mp4') {
    if (capabilities.webCodecsAvc && capabilities.avcCodecString) {
      const encoded = await encodeFramesWithWebCodecs(project, page, clip, schedule, canvas, {
        codec: capabilities.avcCodecString,
        isAvc: true,
        fps,
        bitrate,
        transparentBackground: false,
        breakpoint: options.breakpoint,
        fitMode: options.fitMode,
        signal: options.signal,
        onProgress: options.onProgress,
      });
      options.onProgress?.({ phase: 'muxing', frame: schedule.length, totalFrames: schedule.length, percent: 95, message: 'Muxing MP4 (H.264) container…' });
      const mp4Bytes = muxIsoBmffVideo(encoded.samples, {
        container: 'mp4',
        codec: 'avc1',
        width,
        height,
        avcConfig: encoded.avcConfig,
        depth: 24,
      });
      const blob = bytesToBlob(mp4Bytes, 'video/mp4');
      options.onProgress?.({ phase: 'complete', frame: schedule.length, totalFrames: schedule.length, percent: 100, message: 'MP4 (H.264) ready.' });
      return {
        blob,
        filename,
        format: 'mp4',
        codecLabel: 'MP4 (H.264 / AVC)',
        width,
        height,
        fps,
        totalFrames: schedule.length,
        durationMs: Math.round(totalDurationMs),
        sizeBytes: blob.size,
      };
    }

    if (capabilities.mediaRecorderMp4) {
      const mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1.42E01E')
        ? 'video/mp4;codecs=avc1.42E01E'
        : 'video/mp4';
      const blob = await encodeFramesWithMediaRecorder(project, page, clip, schedule, canvas, {
        mimeType,
        fps,
        bitrate,
        transparentBackground: false,
        breakpoint: options.breakpoint,
        fitMode: options.fitMode,
        signal: options.signal,
        onProgress: options.onProgress,
      });
      options.onProgress?.({ phase: 'complete', frame: schedule.length, totalFrames: schedule.length, percent: 100, message: 'MP4 ready.' });
      return {
        blob,
        filename,
        format: 'mp4',
        codecLabel: 'MP4 (MediaRecorder AVC)',
        width,
        height,
        fps,
        totalFrames: schedule.length,
        durationMs: Math.round(totalDurationMs),
        sizeBytes: blob.size,
      };
    }

    // Universal fallback when browser lacks proprietary H.264 hardware/software encoder: Photo-JPEG inside ISO BMFF MP4
    const jpegQuality = options.quality === 'draft' ? 0.72 : options.quality === 'standard' ? 0.85 : 0.94;
    const samples: MuxedVideoSample[] = [];
    for (let i = 0; i < schedule.length; i += 1) {
      checkAborted(options.signal);
      await renderAnimatedFrameToCanvas(project, page, clip, schedule[i], canvas, {
        transparentBackground: false,
        breakpoint: options.breakpoint,
        fitMode: options.fitMode,
      });
      const jpgBytes = await canvasToBytes(canvas, 'image/jpeg', jpegQuality);
      samples.push({
        data: jpgBytes,
        durationMs: frameDurationMs,
        timestampMs: i * frameDurationMs,
        isKeyframe: true,
      });
      if (i % 2 === 0 || i === schedule.length - 1) {
        options.onProgress?.({
          phase: 'encoding',
          frame: i + 1,
          totalFrames: schedule.length,
          percent: Math.round(((i + 1) / schedule.length) * 90),
          message: `Encoding MP4 MJPEG frame ${i + 1} / ${schedule.length}…`,
          previewDataUrl: i % 4 === 0 || i === schedule.length - 1 ? canvas.toDataURL('image/jpeg', 0.6) : undefined,
        });
        await yieldToMainThread();
      }
    }
    options.onProgress?.({ phase: 'muxing', frame: schedule.length, totalFrames: schedule.length, percent: 95, message: 'Muxing MP4 container…' });
    const mp4Bytes = muxIsoBmffVideo(samples, {
      container: 'mp4',
      codec: 'jpeg',
      width,
      height,
      depth: 24,
    });
    const blob = bytesToBlob(mp4Bytes, 'video/mp4');
    options.onProgress?.({ phase: 'complete', frame: schedule.length, totalFrames: schedule.length, percent: 100, message: 'MP4 (MJPEG) ready.' });
    return {
      blob,
      filename,
      format: 'mp4',
      codecLabel: 'MP4 (Motion-JPEG Fallback)',
      width,
      height,
      fps,
      totalFrames: schedule.length,
      durationMs: Math.round(totalDurationMs),
      sizeBytes: blob.size,
    };
  }

  // --- WebM (VP9 / VP8): WebCodecs + Native EBML Muxer -> MediaRecorder WebM Fallback ---
  if (capabilities.webmCodecString) {
    const encoded = await encodeFramesWithWebCodecs(project, page, clip, schedule, canvas, {
      codec: capabilities.webmCodecString,
      isAvc: false,
      fps,
      bitrate,
      transparentBackground: false,
      breakpoint: options.breakpoint,
      fitMode: options.fitMode,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    options.onProgress?.({ phase: 'muxing', frame: schedule.length, totalFrames: schedule.length, percent: 95, message: 'Muxing WebM (EBML) container…' });
    const webmCodec = capabilities.webmCodecString.startsWith('vp09') ? 'V_VP9' : 'V_VP8';
    const webmBytes = muxWebmVideo(encoded.samples, {
      codec: webmCodec,
      width,
      height,
      durationMs: totalDurationMs,
    });
    const blob = bytesToBlob(webmBytes, 'video/webm');
    options.onProgress?.({ phase: 'complete', frame: schedule.length, totalFrames: schedule.length, percent: 100, message: 'WebM video ready.' });
    return {
      blob,
      filename,
      format: 'webm',
      codecLabel: webmCodec === 'V_VP9' ? 'WebM (VP9)' : 'WebM (VP8)',
      width,
      height,
      fps,
      totalFrames: schedule.length,
      durationMs: Math.round(totalDurationMs),
      sizeBytes: blob.size,
    };
  }

  if (capabilities.mediaRecorderWebm) {
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
        ? 'video/webm;codecs=vp8'
        : 'video/webm';
    const blob = await encodeFramesWithMediaRecorder(project, page, clip, schedule, canvas, {
      mimeType,
      fps,
      bitrate,
      transparentBackground: false,
      breakpoint: options.breakpoint,
      fitMode: options.fitMode,
      signal: options.signal,
      onProgress: options.onProgress,
    });
    options.onProgress?.({ phase: 'complete', frame: schedule.length, totalFrames: schedule.length, percent: 100, message: 'WebM video ready.' });
    return {
      blob,
      filename,
      format: 'webm',
      codecLabel: 'WebM (MediaRecorder)',
      width,
      height,
      fps,
      totalFrames: schedule.length,
      durationMs: Math.round(totalDurationMs),
      sizeBytes: blob.size,
    };
  }

  throw new Error('WebM video encoding is not supported in this browser. Try MOV (Lossless PNG), GIF, or PNG Sequence (ZIP).');
}
