import { describe, expect, it } from 'vitest';
import { createInitialProject } from '../src/core/document/factory';
import { getActivePage } from '../src/core/document/project';
import type { FolioProjectV2, RectNode } from '../src/core/document/types';
import { serializeDocumentToSvgString } from '../src/app/visualExport';
import { createStarterHeroEntranceClip } from '../src/engines/animation';
import { encodeAnimatedGif } from '../src/engines/animation/gifEncoder';
import { muxIsoBmffVideo, muxWebmVideo } from '../src/engines/animation/videoMuxer';
import {
  MOTION_EXPORT_FORMATS,
  buildFrameSchedule,
  buildMotionClipJson,
  computeExportDimensions,
  computeTargetBitrate,
  createMotionExportFilename,
  exportMotionAnimation,
} from '../src/engines/animation/videoExport';

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(bytes[offset + i]);
  }
  return out;
}

function readU32Be(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) >>> 0) +
    ((bytes[offset + 1] << 16) >>> 0) +
    ((bytes[offset + 2] << 8) >>> 0) +
    bytes[offset + 3]
  );
}

function containsAscii(bytes: Uint8Array, needle: string): boolean {
  const target = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - target.length; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return true;
  }
  return false;
}

function findAsciiOffset(bytes: Uint8Array, needle: string): number {
  const target = Array.from(needle, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - target.length; i += 1) {
    for (let j = 0; j < target.length; j += 1) {
      if (bytes[i + j] !== target[j]) continue outer;
    }
    return i;
  }
  return -1;
}

describe('Native Animation & Video Export Engine (MP4, MOV, WebM, GIF, PNG ZIP, HTML5, CSS, JSON)', () => {
  it('muxes valid ISO BMFF MP4 (H.264 avc1 + avcC + exact mdat sample offsets)', () => {
    const fakeAvcC = new Uint8Array([0x01, 0x42, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x04, 0x67, 0x42, 0x00, 0x1f]);
    const frame1 = new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x65, 0x88, 0x84, 0x21]);
    const frame2 = new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x41, 0x9a, 0x12, 0x34]);

    const mp4 = muxIsoBmffVideo(
      [
        { data: frame1, durationMs: 33.33, timestampMs: 0, isKeyframe: true },
        { data: frame2, durationMs: 33.33, timestampMs: 33.33, isKeyframe: false },
      ],
      {
        container: 'mp4',
        codec: 'avc1',
        width: 1280,
        height: 720,
        avcConfig: fakeAvcC,
      },
    );

    // Top-level boxes: ftyp -> mdat -> moov
    const ftypSize = readU32Be(mp4, 0);
    expect(readAscii(mp4, 4, 4)).toBe('ftyp');
    expect(readAscii(mp4, 8, 4)).toBe('mp42');
    expect(readAscii(mp4, ftypSize + 4, 4)).toBe('mdat');
    const mdatSize = readU32Be(mp4, ftypSize);
    expect(readAscii(mp4, ftypSize + mdatSize + 4, 4)).toBe('moov');

    // Essential ISO BMFF boxes present
    for (const box of ['mvhd', 'trak', 'tkhd', 'mdia', 'mdhd', 'hdlr', 'minf', 'vmhd', 'dinf', 'stbl', 'stsd', 'avc1', 'avcC', 'pasp', 'stts', 'stss', 'stsc', 'stsz', 'stco']) {
      expect(containsAscii(mp4, box)).toBe(true);
    }

    // Verify stco chunk offsets point directly to frame1 and frame2 in mdat
    const stcoPos = findAsciiOffset(mp4, 'stco');
    expect(stcoPos).toBeGreaterThan(0);
    const entryCount = readU32Be(mp4, stcoPos + 8);
    expect(entryCount).toBe(2);
    const off1 = readU32Be(mp4, stcoPos + 12);
    const off2 = readU32Be(mp4, stcoPos + 16);
    expect(Array.from(mp4.subarray(off1, off1 + frame1.length))).toEqual(Array.from(frame1));
    expect(Array.from(mp4.subarray(off2, off2 + frame2.length))).toEqual(Array.from(frame2));
  });

  it('muxes valid QuickTime MOV with 32-bit RGBA PNG alpha codec (`qt  ` + `png ` + depth 32)', () => {
    const pngFrame = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
    const mov = muxIsoBmffVideo(
      [
        { data: pngFrame, durationMs: 41.67, timestampMs: 0, isKeyframe: true },
        { data: pngFrame, durationMs: 41.67, timestampMs: 41.67, isKeyframe: true },
      ],
      {
        container: 'mov',
        codec: 'png ',
        width: 1920,
        height: 1080,
        depth: 32,
      },
    );

    expect(readAscii(mov, 4, 4)).toBe('ftyp');
    expect(readAscii(mov, 8, 4)).toBe('qt  ');
    expect(containsAscii(mov, 'mhlr')).toBe(true);
    expect(containsAscii(mov, 'vide')).toBe(true);
    const pngEntryPos = findAsciiOffset(mov, 'png ');
    expect(pngEntryPos).toBeGreaterThan(0);
    // VisualSampleEntry depth field sits at +78 bytes from box type start (86 bytes from box size start)
    const depth = (mov[pngEntryPos + 78] << 8) | mov[pngEntryPos + 79];
    expect(depth).toBe(32);
  });

  it('muxes valid WebM EBML container for VP9 and VP8 streams', () => {
    const webm = muxWebmVideo(
      [
        { data: new Uint8Array([0x82, 0x49, 0x83, 0x42, 0x00]), durationMs: 33.33, timestampMs: 0, isKeyframe: true },
        { data: new Uint8Array([0x86, 0x01, 0x02, 0x03]), durationMs: 33.33, timestampMs: 33.33, isKeyframe: false },
      ],
      {
        codec: 'V_VP9',
        width: 1280,
        height: 720,
        durationMs: 66.66,
      },
    );

    // EBML magic bytes 0x1A 0x45 0xDF 0xA3
    expect(Array.from(webm.subarray(0, 4))).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(containsAscii(webm, 'webm')).toBe(true);
    expect(containsAscii(webm, 'V_VP9')).toBe(true);
    expect(containsAscii(webm, 'Folio Studio')).toBe(true);
  });

  it('encodes valid animated GIF89a with NETSCAPE2.0 loop, transparency, and LZW blocks', () => {
    const w = 16;
    const h = 12;
    const frameA = new Uint8ClampedArray(w * h * 4);
    const frameB = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i += 1) {
      // Frame A: cyan opaque left half, transparent right half
      const x = i % w;
      frameA[i * 4] = 0;
      frameA[i * 4 + 1] = 229;
      frameA[i * 4 + 2] = 255;
      frameA[i * 4 + 3] = x < 8 ? 255 : 0;
      // Frame B: purple opaque
      frameB[i * 4] = 124;
      frameB[i * 4 + 1] = 108;
      frameB[i * 4 + 2] = 246;
      frameB[i * 4 + 3] = 255;
    }

    const gif = encodeAnimatedGif(
      [
        { rgba: frameA, delayMs: 50 },
        { rgba: frameB, delayMs: 50 },
      ],
      { width: w, height: h, loopCount: 0, transparent: true, dither: true },
    );

    expect(readAscii(gif, 0, 6)).toBe('GIF89a');
    expect(gif[6] | (gif[7] << 8)).toBe(w);
    expect(gif[8] | (gif[9] << 8)).toBe(h);
    expect(containsAscii(gif, 'NETSCAPE2.0')).toBe(true);
    expect(gif[gif.length - 1]).toBe(0x3b); // GIF trailer
  });

  it('computes even video dimensions, deterministic frame schedules, filenames, and exports HTML5 / CSS / JSON cleanly', async () => {
    expect(MOTION_EXPORT_FORMATS.map((f) => f.id)).toEqual([
      'mp4',
      'mov',
      'webm',
      'gif',
      'png-sequence',
      'html5',
      'css',
      'json',
    ]);

    // Odd canvas dimensions automatically align to even pixels for video codecs
    expect(computeExportDimensions(1001, 777, 'canvas', 'mp4')).toEqual({ width: 1002, height: 778 });
    expect(computeExportDimensions(1440, 900, '1080p', 'mov')).toEqual({ width: 1920, height: 1080 });
    expect(computeExportDimensions(1440, 900, 'reels-9x16', 'webm')).toEqual({ width: 1080, height: 1920 });
    expect(computeTargetBitrate(1920, 1080, 60, 'high')).toBeGreaterThan(computeTargetBitrate(1280, 720, 30, 'draft'));

    const schedule1x = buildFrameSchedule(0, 1000, 30, 1);
    expect(schedule1x.length).toBe(31);
    expect(schedule1x[0]).toBe(0);
    expect(schedule1x[schedule1x.length - 1]).toBe(1000);

    const schedule2x = buildFrameSchedule(0, 500, 20, 2);
    expect(schedule2x.length).toBe(21);

    expect(createMotionExportFilename('First Canvas', 'Hero Entrance', 'mp4')).toBe('first-canvas-hero-entrance.mp4');
    expect(createMotionExportFilename('First Canvas', 'Hero Entrance', 'mov')).toBe('first-canvas-hero-entrance.mov');
    expect(createMotionExportFilename('First Canvas', 'Hero Entrance', 'png-sequence')).toBe('first-canvas-hero-entrance.zip');

    const project = createInitialProject('Motion Studio Export');
    const page = getActivePage(project);
    const clip = createStarterHeroEntranceClip(page);
    const projectWithClip: FolioProjectV2 = {
      ...project,
      animations: [clip],
    };

    const htmlRes = await exportMotionAnimation(projectWithClip, page, clip, {
      format: 'html5',
      resolution: 'canvas',
      fps: 60,
      quality: 'high',
      startMs: 0,
      endMs: clip.durationMs,
      loopCount: 1,
      transparentBackground: false,
    });
    expect(htmlRes.filename).toMatch(/\.html$/);
    expect(await htmlRes.blob.text()).toContain('@keyframes folio-kf-');

    const cssRes = await exportMotionAnimation(projectWithClip, page, clip, {
      format: 'css',
      resolution: 'canvas',
      fps: 60,
      quality: 'high',
      startMs: 0,
      endMs: clip.durationMs,
      loopCount: 1,
      transparentBackground: false,
    });
    expect(cssRes.filename).toMatch(/\.css$/);
    expect(await cssRes.blob.text()).toContain('@keyframes folio-kf-');

    const jsonRes = await exportMotionAnimation(projectWithClip, page, clip, {
      format: 'json',
      resolution: 'canvas',
      fps: 30,
      quality: 'high',
      startMs: 0,
      endMs: clip.durationMs,
      loopCount: 1,
      transparentBackground: false,
    });
    const parsedJson = JSON.parse(await jsonRes.blob.text()) as { schema: string; clip: { id: string } };
    expect(parsedJson.schema).toBe('folio.motion.v1');
    expect(parsedJson.clip.id).toBe(clip.id);
    expect(buildMotionClipJson(projectWithClip, page, clip)).toContain('folio.motion.v1');
  });

  it('composes SVG filter (layerBlur) and CSS filter (brightness) on nested groups in exported frames', () => {
    const project = createInitialProject('Filter Parity');
    const page = getActivePage(project);
    const rect: RectNode = {
      id: 'fx-both',
      type: 'rect',
      name: 'Combined FX',
      x: 100,
      y: 100,
      width: 200,
      height: 120,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      style: { fill: '#00E5FF', stroke: 'none', strokeWidth: 0, radius: 16 },
      effects: [{ id: 'blur-1', type: 'layer-blur', radius: 24, visible: true }],
      cssFilters: { brightness: 135, contrast: 120 },
    };
    const svg = serializeDocumentToSvgString({ ...page.document, nodes: [rect] }, [], { rasterizeSafe: true });
    expect(svg).toContain('filterUnits="userSpaceOnUse"');
    expect(svg).toContain('filter="url(#');
    expect(svg).toContain('<g style="filter:brightness(135%) contrast(120%)">');
  });
});
