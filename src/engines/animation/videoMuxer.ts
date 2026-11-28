/**
 * Native Zero-Dependency Binary Video Muxers for Folio Studio:
 * 1. ISO BMFF Muxer — writes spec-compliant `.mp4` (isom/mp42) and Apple QuickTime `.mov` (qt  )
 *    supporting H.264/AVC (`avc1` + `avcC`), Lossless 32-bit RGBA QuickTime PNG (`png `),
 *    and Photo-JPEG / MJPEG (`jpeg`).
 * 2. WebM EBML Muxer — writes spec-compliant `.webm` (EBML v4, VP9 `V_VP9` & VP8 `V_VP8`).
 */

export type IsoBmffContainer = 'mp4' | 'mov';
export type IsoBmffCodec = 'avc1' | 'png ' | 'jpeg';

export interface MuxedVideoSample {
  readonly data: Uint8Array;
  /** Duration of this frame in milliseconds. */
  readonly durationMs: number;
  /** Timestamp of this frame in milliseconds (used by WebM muxer). */
  readonly timestampMs: number;
  readonly isKeyframe: boolean;
}

export interface IsoBmffMuxOptions {
  readonly container: IsoBmffContainer;
  readonly codec: IsoBmffCodec;
  readonly width: number;
  readonly height: number;
  readonly timescale?: number;
  /** Raw AVCDecoderConfigurationRecord bytes from WebCodecs `decoderConfig.description` (required for `avc1`). */
  readonly avcConfig?: Uint8Array;
  /** Color depth in bits (24 for opaque video, 32 for RGBA `png ` QuickTime alpha). */
  readonly depth?: 24 | 32;
}

export interface WebmMuxOptions {
  readonly codec: 'V_VP9' | 'V_VP8';
  readonly width: number;
  readonly height: number;
  readonly durationMs: number;
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function asciiBytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i += 1) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function u16be(val: number): Uint8Array {
  const buf = new Uint8Array(2);
  buf[0] = (val >>> 8) & 0xff;
  buf[1] = val & 0xff;
  return buf;
}

function u32be(val: number): Uint8Array {
  const buf = new Uint8Array(4);
  buf[0] = (val >>> 24) & 0xff;
  buf[1] = (val >>> 16) & 0xff;
  buf[2] = (val >>> 8) & 0xff;
  buf[3] = val & 0xff;
  return buf;
}

function u64be(val: number): Uint8Array {
  const hi = Math.floor(val / 0x100000000);
  const lo = val >>> 0;
  return concatBytes([u32be(hi), u32be(lo)]);
}

function fixed16_16(val: number): Uint8Array {
  return u32be(Math.round(val * 65536));
}

function makeBox(type: string, ...payloads: Uint8Array[]): Uint8Array {
  const body = concatBytes(payloads);
  const size = 8 + body.length;
  return concatBytes([u32be(size), asciiBytes(type.slice(0, 4).padEnd(4, ' ')), body]);
}

function makeFullBox(type: string, version: number, flags: number, ...payloads: Uint8Array[]): Uint8Array {
  const header = new Uint8Array(4);
  header[0] = version & 0xff;
  header[1] = (flags >>> 16) & 0xff;
  header[2] = (flags >>> 8) & 0xff;
  header[3] = flags & 0xff;
  return makeBox(type, header, ...payloads);
}

/**
 * Identity 3x3 display transformation matrix in ISO BMFF fixed-point format:
 * [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]
 */
function identityMatrix(): Uint8Array {
  return concatBytes([
    u32be(0x00010000), u32be(0), u32be(0),
    u32be(0), u32be(0x00010000), u32be(0),
    u32be(0), u32be(0), u32be(0x40000000),
  ]);
}

function buildFtypBox(container: IsoBmffContainer, codec: IsoBmffCodec): Uint8Array {
  if (container === 'mov') {
    return makeBox('ftyp', asciiBytes('qt  '), u32be(0x20050300), asciiBytes('qt  '));
  }
  const brands = codec === 'avc1'
    ? [asciiBytes('isom'), asciiBytes('iso2'), asciiBytes('avc1'), asciiBytes('mp41')]
    : [asciiBytes('isom'), asciiBytes('iso2'), asciiBytes('mp41')];
  return makeBox('ftyp', asciiBytes('mp42'), u32be(0), ...brands);
}

function buildVisualSampleEntry(options: IsoBmffMuxOptions): Uint8Array {
  const { codec, width, height, avcConfig, depth } = options;
  const bitDepth = depth ?? (codec === 'png ' ? 32 : 24);
  const compressorNameRaw = codec === 'avc1'
    ? 'Folio AVC'
    : codec === 'png '
      ? 'PNG'
      : 'Photo - JPEG';
  const compressorName = new Uint8Array(32);
  const nameLen = Math.min(31, compressorNameRaw.length);
  compressorName[0] = nameLen;
  for (let i = 0; i < nameLen; i += 1) {
    compressorName[1 + i] = compressorNameRaw.charCodeAt(i) & 0xff;
  }

  const children: Uint8Array[] = [];
  if (codec === 'avc1' && avcConfig && avcConfig.length > 0) {
    children.push(makeBox('avcC', avcConfig));
  }
  // Pixel aspect ratio 1:1 (`pasp` box improves QuickTime & Premiere Pro compatibility)
  children.push(makeBox('pasp', u32be(1), u32be(1)));

  return makeBox(
    codec,
    new Uint8Array(6), // reserved
    u16be(1),          // data_reference_index
    u16be(0),          // pre_defined
    u16be(0),          // reserved
    new Uint8Array(12), // pre_defined[3]
    u16be(width),
    u16be(height),
    fixed16_16(72),    // horizresolution 72 dpi
    fixed16_16(72),    // vertresolution 72 dpi
    u32be(0),          // reserved
    u16be(1),          // frame_count
    compressorName,    // 32-byte Pascal string
    u16be(bitDepth),   // depth (24 or 32 for RGBA alpha)
    u16be(0xffff),     // pre_defined = -1
    ...children,
  );
}

/**
 * Muxes encoded video frames into a valid ISO BMFF `.mp4` or QuickTime `.mov` byte stream.
 */
export function muxIsoBmffVideo(
  samples: readonly MuxedVideoSample[],
  options: IsoBmffMuxOptions,
): Uint8Array {
  if (samples.length === 0) {
    throw new Error('Cannot mux an empty video sample list.');
  }
  const timescale = options.timescale ?? 90000;
  const sampleDurations = samples.map((s) => Math.max(1, Math.round((s.durationMs / 1000) * timescale)));
  const totalDuration = sampleDurations.reduce((sum, d) => sum + d, 0);

  const ftyp = buildFtypBox(options.container, options.codec);
  const mdatPayload = concatBytes(samples.map((s) => s.data));
  const mdatHeaderSize = 8;
  const mdatDataOffset = ftyp.length + mdatHeaderSize;
  const mdat = makeBox('mdat', mdatPayload);

  // Sample offsets in mdat
  const offsets: number[] = [];
  let cursor = mdatDataOffset;
  for (const sample of samples) {
    offsets.push(cursor);
    cursor += sample.data.length;
  }

  // `stts` — run-length compressed decoding time-to-sample entries
  const sttsRuns: Array<{ count: number; delta: number }> = [];
  for (const delta of sampleDurations) {
    const prev = sttsRuns[sttsRuns.length - 1];
    if (prev && prev.delta === delta) {
      prev.count += 1;
    } else {
      sttsRuns.push({ count: 1, delta });
    }
  }
  const stts = makeFullBox(
    'stts',
    0,
    0,
    u32be(sttsRuns.length),
    ...sttsRuns.flatMap((run) => [u32be(run.count), u32be(run.delta)]),
  );

  // `stss` — sync sample (keyframe) indices (1-based)
  const keyframeIndices: number[] = [];
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i].isKeyframe || i === 0) {
      keyframeIndices.push(i + 1);
    }
  }
  const includeStss = keyframeIndices.length < samples.length;
  const stss = includeStss
    ? makeFullBox('stss', 0, 0, u32be(keyframeIndices.length), ...keyframeIndices.map((idx) => u32be(idx)))
    : null;

  // `stsc` — 1 sample per chunk (simple, universal random-access seekability)
  const stsc = makeFullBox(
    'stsc',
    0,
    0,
    u32be(1),
    u32be(1), // first_chunk
    u32be(1), // samples_per_chunk
    u32be(1), // sample_description_index
  );

  // `stsz` — sample sizes
  const stsz = makeFullBox(
    'stsz',
    0,
    0,
    u32be(0), // uniform size = 0 (variable)
    u32be(samples.length),
    ...samples.map((s) => u32be(s.data.length)),
  );

  // `stco` / `co64` — chunk offsets
  const needs64BitOffsets = offsets.some((off) => off > 0xffffffff);
  const chunkOffsetBox = needs64BitOffsets
    ? makeFullBox('co64', 0, 0, u32be(offsets.length), ...offsets.map((off) => u64be(off)))
    : makeFullBox('stco', 0, 0, u32be(offsets.length), ...offsets.map((off) => u32be(off)));

  const stsd = makeFullBox('stsd', 0, 0, u32be(1), buildVisualSampleEntry(options));

  const stblChildren: Uint8Array[] = [stsd, stts];
  if (stss) stblChildren.push(stss);
  stblChildren.push(stsc, stsz, chunkOffsetBox);
  const stbl = makeBox('stbl', ...stblChildren);

  const urlEntry = makeFullBox('url ', 0, 1); // self-contained media flag = 1
  const dref = makeFullBox('dref', 0, 0, u32be(1), urlEntry);
  const dinf = makeBox('dinf', dref);
  const vmhd = makeFullBox('vmhd', 0, 1, u16be(0), u16be(0), u16be(0), u16be(0));
  const minf = makeBox('minf', vmhd, dinf, stbl);

  const handlerComponentType = options.container === 'mov' ? asciiBytes('mhlr') : u32be(0);
  const hdlr = makeFullBox(
    'hdlr',
    0,
    0,
    handlerComponentType,
    asciiBytes('vide'),
    new Uint8Array(12), // reserved
    asciiBytes('Folio VideoHandler\0'),
  );

  const mdhd = makeFullBox(
    'mdhd',
    0,
    0,
    u32be(0), // creation_time
    u32be(0), // modification_time
    u32be(timescale),
    u32be(totalDuration),
    u16be(0x55c4), // 'und' language
    u16be(0),
  );
  const mdia = makeBox('mdia', mdhd, hdlr, minf);

  // Track flags: 0x000003 (enabled | in_movie)
  const tkhd = makeFullBox(
    'tkhd',
    0,
    0x000003,
    u32be(0), // creation_time
    u32be(0), // modification_time
    u32be(1), // track_ID
    u32be(0), // reserved
    u32be(totalDuration),
    new Uint8Array(8), // reserved[2]
    u16be(0), // layer
    u16be(0), // alternate_group
    u16be(0), // volume (0 for video)
    u16be(0), // reserved
    identityMatrix(),
    fixed16_16(options.width),
    fixed16_16(options.height),
  );
  const trak = makeBox('trak', tkhd, mdia);

  const mvhd = makeFullBox(
    'mvhd',
    0,
    0,
    u32be(0), // creation_time
    u32be(0), // modification_time
    u32be(timescale),
    u32be(totalDuration),
    fixed16_16(1), // preferred rate 1.0
    u16be(0x0100), // preferred volume 1.0
    new Uint8Array(10), // reserved
    identityMatrix(),
    new Uint8Array(24), // pre_defined[6]
    u32be(2), // next_track_ID
  );

  const moov = makeBox('moov', mvhd, trak);
  return concatBytes([ftyp, mdat, moov]);
}

// ---------------------------------------------------------------------------
// Native WebM / EBML Muxer (VP9 & VP8)
// ---------------------------------------------------------------------------

function encodeEbmlVint(value: number): Uint8Array {
  if (value < 0x7f) {
    return new Uint8Array([0x80 | value]);
  }
  if (value < 0x3fff) {
    return new Uint8Array([0x40 | (value >>> 8), value & 0xff]);
  }
  if (value < 0x1fffff) {
    return new Uint8Array([0x20 | (value >>> 16), (value >>> 8) & 0xff, value & 0xff]);
  }
  if (value < 0x0fffffff) {
    return new Uint8Array([
      0x10 | (value >>> 24),
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]);
  }
  // 8-byte VINT for very large payloads
  const hi = Math.floor(value / 0x100000000);
  const lo = value >>> 0;
  return new Uint8Array([
    0x01,
    (hi >>> 16) & 0xff,
    (hi >>> 8) & 0xff,
    hi & 0xff,
    (lo >>> 24) & 0xff,
    (lo >>> 16) & 0xff,
    (lo >>> 8) & 0xff,
    lo & 0xff,
  ]);
}

function ebmlUint(value: number): Uint8Array {
  if (value === 0) return new Uint8Array([0]);
  const bytes: number[] = [];
  let v = Math.floor(value);
  while (v > 0) {
    bytes.unshift(v & 0xff);
    v = Math.floor(v / 256);
  }
  return new Uint8Array(bytes);
}

function ebmlFloat64(value: number): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, value, false);
  return new Uint8Array(buf);
}

function ebmlElement(idBytes: readonly number[], ...payloads: Uint8Array[]): Uint8Array {
  const body = concatBytes(payloads);
  return concatBytes([new Uint8Array(idBytes), encodeEbmlVint(body.length), body]);
}

/**
 * Muxes encoded VP8 or VP9 frames into a spec-compliant `.webm` (EBML/Matroska) container.
 */
export function muxWebmVideo(
  samples: readonly MuxedVideoSample[],
  options: WebmMuxOptions,
): Uint8Array {
  if (samples.length === 0) {
    throw new Error('Cannot mux an empty WebM sample list.');
  }

  // EBML Header (0x1A45DFA3)
  const ebmlHeader = ebmlElement(
    [0x1a, 0x45, 0xdf, 0xa3],
    ebmlElement([0x42, 0x86], ebmlUint(1)),        // EBMLVersion
    ebmlElement([0x42, 0xf7], ebmlUint(1)),        // EBMLReadVersion
    ebmlElement([0x42, 0xf2], ebmlUint(4)),        // EBMLMaxIDLength
    ebmlElement([0x42, 0xf3], ebmlUint(8)),        // EBMLMaxSizeLength
    ebmlElement([0x42, 0x82], asciiBytes('webm')), // DocType
    ebmlElement([0x42, 0x87], ebmlUint(4)),        // DocTypeVersion
    ebmlElement([0x42, 0x85], ebmlUint(2)),        // DocTypeReadVersion
  );

  // Segment Info (0x1549A966) — TimecodeScale = 1,000,000 ns (1ms per tick)
  const info = ebmlElement(
    [0x15, 0x49, 0xa9, 0x66],
    ebmlElement([0x2a, 0xd7, 0xb1], ebmlUint(1_000_000)),
    ebmlElement([0x44, 0x89], ebmlFloat64(Math.max(1, options.durationMs))),
    ebmlElement([0x4d, 0x80], asciiBytes('Folio Studio')),
    ebmlElement([0x57, 0x41], asciiBytes('Folio Motion Engine')),
  );

  // Track Entry (0xAE) inside Tracks (0x1654AE6B)
  const videoSettings = ebmlElement(
    [0xe0],
    ebmlElement([0xb0], ebmlUint(options.width)),
    ebmlElement([0xba], ebmlUint(options.height)),
  );
  const trackEntry = ebmlElement(
    [0xae],
    ebmlElement([0xd7], ebmlUint(1)), // TrackNumber
    ebmlElement([0x73, 0xc5], ebmlUint(1)), // TrackUID
    ebmlElement([0x83], ebmlUint(1)), // TrackType = 1 (video)
    ebmlElement([0x86], asciiBytes(options.codec)), // CodecID
    videoSettings,
  );
  const tracks = ebmlElement([0x16, 0x54, 0xae, 0x6b], trackEntry);

  // Split samples into Clusters (every keyframe or > 20s relative timestamp)
  const clusters: Uint8Array[] = [];
  let clusterStartMs = Math.max(0, Math.round(samples[0].timestampMs));
  let clusterBlocks: Uint8Array[] = [];

  const flushCluster = () => {
    if (clusterBlocks.length === 0) return;
    clusters.push(
      ebmlElement(
        [0x1f, 0x43, 0xb6, 0x75],
        ebmlElement([0xe7], ebmlUint(clusterStartMs)),
        ...clusterBlocks,
      ),
    );
    clusterBlocks = [];
  };

  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i];
    const tsMs = Math.max(0, Math.round(sample.timestampMs));
    const relTs = tsMs - clusterStartMs;
    if (i > 0 && ((sample.isKeyframe && relTs > 0) || relTs > 20_000 || relTs < -32768)) {
      flushCluster();
      clusterStartMs = tsMs;
    }
    const clampedRel = Math.max(-32768, Math.min(32767, tsMs - clusterStartMs));
    const header = new Uint8Array(4);
    header[0] = 0x81; // TrackNumber 1 as VINT
    header[1] = (clampedRel >> 8) & 0xff;
    header[2] = clampedRel & 0xff;
    header[3] = sample.isKeyframe ? 0x80 : 0x00; // Keyframe flag
    clusterBlocks.push(ebmlElement([0xa3], header, sample.data));
  }
  flushCluster();

  const segment = ebmlElement([0x18, 0x53, 0x80, 0x67], info, tracks, ...clusters);
  return concatBytes([ebmlHeader, segment]);
}
