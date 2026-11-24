/**
 * Custom Ultra-Lightweight 2D GPU Instanced SDF Renderer (WebGPU / WebGL2 / Canvas2D)
 * + Tiled Rich Artwork Compositor.
 *
 * Renders 10,000+ rounded rectangles, frames, and ellipses in ONE single GPU
 * instanced SDF draw call (zero 8MB WASM engine overhead) while compositing
 * rich artwork through the 512x512 LRU TileCacheManager.
 */

import type { DesignNode } from '../../../core/document/types';
import {
  DEFAULT_TILE_SIZE,
  GPU_INSTANCE_STRIDE_FLOATS,
  type GpuBackendKind,
  type GpuSceneMetrics,
  type RichNodeRenderContext,
  type ViewportRect,
} from './types';
import {
  computeTileSignature,
  computeVisibleTileGrid,
  filterNodesForTile,
  packSceneToGpuBatches,
  parseCssColorToRgba,
} from './scenePacker';
import { renderRichNodeToContext2D, TileCacheManager } from './tileCache';

/* ─── GLSL ES 3.00 Instanced 2D SDF Shaders (WebGL2) ─── */

const WEBGL2_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_unitQuad;
layout(location = 1) in vec4 a_rect;     // x, y, width, height
layout(location = 2) in vec4 a_fill;     // r, g, b, a
layout(location = 3) in vec4 a_geom;     // radius, rotRad, strokeW, shapeKind
layout(location = 4) in vec4 a_stroke;   // sr, sg, sb, sa

uniform vec2 u_docSize;

out vec2 v_localPos;
out vec2 v_halfSize;
out vec4 v_fill;
out vec4 v_stroke;
out float v_radius;
out float v_strokeW;
out float v_shapeKind;

void main() {
  vec2 size = max(a_rect.zw, vec2(0.001));
  vec2 halfSize = size * 0.5;
  float pad = a_geom.z * 0.5 + 2.0;
  vec2 paddedHalf = halfSize + vec2(pad);
  vec2 local = (a_unitQuad * 2.0 - 1.0) * paddedHalf;

  float c = cos(a_geom.y);
  float s = sin(a_geom.y);
  vec2 rotated = vec2(local.x * c - local.y * s, local.x * s + local.y * c);
  vec2 center = a_rect.xy + halfSize;
  vec2 world = center + rotated;

  vec2 clip = (world / u_docSize) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);

  v_localPos = local;
  v_halfSize = halfSize;
  v_fill = a_fill;
  v_stroke = a_stroke;
  v_radius = min(a_geom.x, min(halfSize.x, halfSize.y));
  v_strokeW = a_geom.z;
  v_shapeKind = a_geom.w;
}
`;

const WEBGL2_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 v_localPos;
in vec2 v_halfSize;
in vec4 v_fill;
in vec4 v_stroke;
in float v_radius;
in float v_strokeW;
in float v_shapeKind;

out vec4 outColor;

float sdRoundedBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + vec2(r);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - r;
}

float sdEllipseApprox(vec2 p, vec2 ab) {
  vec2 safe = max(ab, vec2(0.5));
  vec2 q = p / safe;
  float k0 = length(q);
  if (k0 < 0.0001) return -min(safe.x, safe.y);
  float k1 = length(p / (safe * safe));
  return k0 * (k0 - 1.0) / max(k1, 0.0001);
}

void main() {
  float dist = v_shapeKind > 0.5
    ? sdEllipseApprox(v_localPos, v_halfSize)
    : sdRoundedBox(v_localPos, v_halfSize, v_radius);

  float aa = max(0.75, fwidth(dist));
  float fillCoverage = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, dist);

  vec4 color = vec4(v_fill.rgb, v_fill.a * fillCoverage);

  if (v_strokeW > 0.001 && v_stroke.a > 0.001) {
    float halfStroke = v_strokeW * 0.5;
    float strokeDist = abs(dist) - halfStroke;
    float strokeCoverage = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, strokeDist);
    float sa = v_stroke.a * strokeCoverage;
    // Porter-Duff source-over stroke on top of fill
    float outA = sa + color.a * (1.0 - sa);
    if (outA > 0.0001) {
      vec3 outRgb = (v_stroke.rgb * sa + color.rgb * color.a * (1.0 - sa)) / outA;
      color = vec4(outRgb, outA);
    }
  }

  if (color.a <= 0.001) discard;
  outColor = color;
}
`;

/* ─── WGSL Instanced 2D SDF Shader (WebGPU) ─── */

export const WEBGPU_SDF_WGSL = `
struct Uniforms {
  docSize: vec2<f32>,
  _pad: vec2<f32>,
};

struct Instance {
  rect: vec4<f32>,
  fill: vec4<f32>,
  geom: vec4<f32>,   // radius, rotRad, strokeR, strokeG (remapped below)
  extra: vec4<f32>,  // strokeB, strokeA, strokeW, shapeKind
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;

struct VertexOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) localPos: vec2<f32>,
  @location(1) halfSize: vec2<f32>,
  @location(2) fill: vec4<f32>,
  @location(3) stroke: vec4<f32>,
  @location(4) params: vec3<f32>, // radius, strokeW, shapeKind
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VertexOut {
  var quad = array<vec2<f32>, 6>(
    vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
    vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0)
  );
  let inst = instances[iid];
  let size = max(inst.rect.zw, vec2<f32>(0.001, 0.001));
  let halfSize = size * 0.5;
  let strokeW = inst.extra.z;
  let pad = strokeW * 0.5 + 2.0;
  let local = (quad[vid] * 2.0 - 1.0) * (halfSize + vec2<f32>(pad, pad));
  let c = cos(inst.geom.y);
  let s = sin(inst.geom.y);
  let rot = vec2<f32>(local.x * c - local.y * s, local.x * s + local.y * c);
  let world = inst.rect.xy + halfSize + rot;
  let clip = (world / u.docSize) * 2.0 - 1.0;

  var out: VertexOut;
  out.pos = vec4<f32>(clip.x, -clip.y, 0.0, 1.0);
  out.localPos = local;
  out.halfSize = halfSize;
  out.fill = inst.fill;
  out.stroke = vec4<f32>(inst.geom.z, inst.geom.w, inst.extra.x, inst.extra.y);
  out.params = vec3<f32>(min(inst.geom.x, min(halfSize.x, halfSize.y)), strokeW, inst.extra.w);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  var dist: f32 = 0.0;
  if (in.params.z > 0.5) {
    let safe = max(in.halfSize, vec2<f32>(0.5, 0.5));
    let k0 = length(in.localPos / safe);
    let k1 = length(in.localPos / (safe * safe));
    dist = select(-min(safe.x, safe.y), k0 * (k0 - 1.0) / max(k1, 0.0001), k0 >= 0.0001);
  } else {
    let q = abs(in.localPos) - in.halfSize + vec2<f32>(in.params.x, in.params.x);
    dist = min(max(q.x, q.y), 0.0) + length(max(q, vec2<f32>(0.0, 0.0))) - in.params.x;
  }

  let aa = max(0.75, fwidth(dist));
  let fillCov = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, dist);
  var color = vec4<f32>(in.fill.rgb, in.fill.a * fillCov);

  if (in.params.y > 0.001 && in.stroke.a > 0.001) {
    let sDist = abs(dist) - in.params.y * 0.5;
    let sCov = 1.0 - smoothstep(-aa * 0.5, aa * 0.5, sDist);
    let sa = in.stroke.a * sCov;
    let outA = sa + color.a * (1.0 - sa);
    if (outA > 0.0001) {
      color = vec4<f32>((in.stroke.rgb * sa + color.rgb * color.a * (1.0 - sa)) / outA, outA);
    }
  }
  if (color.a <= 0.001) { discard; }
  return color;
}
`;

/* ─── WebGL2 Instanced SDF Renderer ─── */

class WebGL2InstancedRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadVbo: WebGLBuffer;
  private readonly instanceVbo: WebGLBuffer;
  private readonly docSizeLoc: WebGLUniformLocation | null;
  private instanceCapacityBytes = 0;
  private packedGlBuffer = new Float32Array(0);

  private constructor(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    vao: WebGLVertexArrayObject,
    quadVbo: WebGLBuffer,
    instanceVbo: WebGLBuffer,
  ) {
    this.gl = gl;
    this.program = program;
    this.vao = vao;
    this.quadVbo = quadVbo;
    this.instanceVbo = instanceVbo;
    this.docSizeLoc = gl.getUniformLocation(program, 'u_docSize');
  }

  public static tryCreate(canvas: HTMLCanvasElement): WebGL2InstancedRenderer | null {
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: true,
        antialias: true,
        premultipliedAlpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
      });
    } catch {
      return null;
    }
    if (!gl) return null;

    const vs = compileShader(gl, gl.VERTEX_SHADER, WEBGL2_VERTEX_SHADER);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, WEBGL2_FRAGMENT_SHADER);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return null;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return null;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }

    const vao = gl.createVertexArray();
    const quadVbo = gl.createBuffer();
    const instanceVbo = gl.createBuffer();
    if (!vao || !quadVbo || !instanceVbo) {
      gl.deleteProgram(program);
      return null;
    }

    gl.bindVertexArray(vao);

    // Location 0: Unit quad vertices
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVbo);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Locations 1..4: Packed instanced attributes (16 floats = 64 bytes stride)
    // Layout in packedGlBuffer:
    // [0..3]   a_rect   (x, y, w, h)
    // [4..7]   a_fill   (r, g, b, a)
    // [8..11]  a_geom   (radius, rotRad, strokeW, shapeKind)
    // [12..15] a_stroke (sr, sg, sb, sa)
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceVbo);
    const strideBytes = GPU_INSTANCE_STRIDE_FLOATS * 4;
    for (let attr = 1; attr <= 4; attr += 1) {
      gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(attr, 4, gl.FLOAT, false, strideBytes, (attr - 1) * 16);
      gl.vertexAttribDivisor(attr, 1);
    }

    gl.bindVertexArray(null);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    return new WebGL2InstancedRenderer(gl, program, vao, quadVbo, instanceVbo);
  }

  public render(
    instanceData: Float32Array,
    instanceCount: number,
    docWidth: number,
    docHeight: number,
    backgroundColor: string,
    pixelWidth: number,
    pixelHeight: number,
  ): { uploadMs: number; drawMs: number; gpuBufferBytes: number } {
    const gl = this.gl;
    gl.viewport(0, 0, pixelWidth, pixelHeight);

    const bg = parseCssColorToRgba(backgroundColor, 1);
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (instanceCount <= 0) {
      return { uploadMs: 0, drawMs: 0, gpuBufferBytes: 0 };
    }

    const uploadStart = performance.now();
    const floatCount = instanceCount * GPU_INSTANCE_STRIDE_FLOATS;
    if (this.packedGlBuffer.length < floatCount) {
      this.packedGlBuffer = new Float32Array(Math.max(floatCount, 256 * GPU_INSTANCE_STRIDE_FLOATS));
    }

    // Swizzle fields [8..15] into a_geom=[radius, rotRad, strokeW, shapeKind] + a_stroke=[sr, sg, sb, sa]
    const dst = this.packedGlBuffer;
    for (let i = 0; i < instanceCount; i += 1) {
      const b = i * GPU_INSTANCE_STRIDE_FLOATS;
      dst[b] = instanceData[b];
      dst[b + 1] = instanceData[b + 1];
      dst[b + 2] = instanceData[b + 2];
      dst[b + 3] = instanceData[b + 3];
      dst[b + 4] = instanceData[b + 4];
      dst[b + 5] = instanceData[b + 5];
      dst[b + 6] = instanceData[b + 6];
      dst[b + 7] = instanceData[b + 7];
      // a_geom
      dst[b + 8] = instanceData[b + 8];
      dst[b + 9] = instanceData[b + 9];
      dst[b + 10] = instanceData[b + 14];
      dst[b + 11] = instanceData[b + 15];
      // a_stroke
      dst[b + 12] = instanceData[b + 10];
      dst[b + 13] = instanceData[b + 11];
      dst[b + 14] = instanceData[b + 12];
      dst[b + 15] = instanceData[b + 13];
    }

    const bytesNeeded = floatCount * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    if (bytesNeeded > this.instanceCapacityBytes) {
      this.instanceCapacityBytes = Math.max(bytesNeeded, this.instanceCapacityBytes * 2);
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceCapacityBytes, gl.DYNAMIC_DRAW);
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, dst.subarray(0, floatCount));
    const uploadMs = Math.max(0, performance.now() - uploadStart);

    const drawStart = performance.now();
    gl.useProgram(this.program);
    gl.uniform2f(this.docSizeLoc, Math.max(1, docWidth), Math.max(1, docHeight));
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, instanceCount);
    gl.bindVertexArray(null);
    const drawMs = Math.max(0, performance.now() - drawStart);

    return { uploadMs, drawMs, gpuBufferBytes: bytesNeeded };
  }

  public dispose(): void {
    this.gl.deleteBuffer(this.quadVbo);
    this.gl.deleteBuffer(this.instanceVbo);
    this.gl.deleteVertexArray(this.vao);
    this.gl.deleteProgram(this.program);
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/* ─── Canvas2D Instanced Fallback (when WebGL2 is unavailable in headless/software environments) ─── */

function renderInstancesCanvas2DFallback(
  ctx: CanvasRenderingContext2D,
  instanceData: Float32Array,
  instanceCount: number,
  docWidth: number,
  docHeight: number,
  backgroundColor: string,
  pixelWidth: number,
  pixelHeight: number,
): { uploadMs: number; drawMs: number; gpuBufferBytes: number } {
  const start = performance.now();
  const scaleX = pixelWidth / Math.max(1, docWidth);
  const scaleY = pixelHeight / Math.max(1, docHeight);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = backgroundColor || '#ffffff';
  ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  ctx.scale(scaleX, scaleY);

  for (let i = 0; i < instanceCount; i += 1) {
    const b = i * GPU_INSTANCE_STRIDE_FLOATS;
    const x = instanceData[b];
    const y = instanceData[b + 1];
    const w = instanceData[b + 2];
    const h = instanceData[b + 3];
    const fr = Math.round(instanceData[b + 4] * 255);
    const fg = Math.round(instanceData[b + 5] * 255);
    const fb = Math.round(instanceData[b + 6] * 255);
    const fa = instanceData[b + 7];
    const r = instanceData[b + 8];
    const rot = instanceData[b + 9];
    const sr = Math.round(instanceData[b + 10] * 255);
    const sg = Math.round(instanceData[b + 11] * 255);
    const sb = Math.round(instanceData[b + 12] * 255);
    const sa = instanceData[b + 13];
    const sw = instanceData[b + 14];
    const shapeKind = instanceData[b + 15];

    if (rot !== 0) {
      ctx.save();
      ctx.translate(x + w * 0.5, y + h * 0.5);
      ctx.rotate(rot);
      ctx.translate(-(x + w * 0.5), -(y + h * 0.5));
    }

    ctx.beginPath();
    if (shapeKind > 0.5) {
      ctx.ellipse(x + w * 0.5, y + h * 0.5, Math.max(0.5, w * 0.5), Math.max(0.5, h * 0.5), 0, 0, Math.PI * 2);
    } else if (r > 0.01) {
      const cr = Math.min(r, w * 0.5, h * 0.5);
      ctx.moveTo(x + cr, y);
      ctx.lineTo(x + w - cr, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + cr);
      ctx.lineTo(x + w, y + h - cr);
      ctx.quadraticCurveTo(x + w, y + h, x + w - cr, y + h);
      ctx.lineTo(x + cr, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - cr);
      ctx.lineTo(x, y + cr);
      ctx.quadraticCurveTo(x, y, x + cr, y);
      ctx.closePath();
    } else {
      ctx.rect(x, y, w, h);
    }

    if (fa > 0.001) {
      ctx.fillStyle = `rgba(${fr},${fg},${fb},${fa})`;
      ctx.fill();
    }
    if (sw > 0.001 && sa > 0.001) {
      ctx.strokeStyle = `rgba(${sr},${sg},${sb},${sa})`;
      ctx.lineWidth = sw;
      ctx.stroke();
    }

    if (rot !== 0) {
      ctx.restore();
    }
  }

  ctx.restore();
  return {
    uploadMs: 0,
    drawMs: Math.max(0, performance.now() - start),
    gpuBufferBytes: instanceCount * GPU_INSTANCE_STRIDE_FLOATS * 4,
  };
}

/* ─── WebGPU Capability Probe ─── */

export async function probeWebGpuAvailability(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  const gpu = (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown | null> } }).gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return false;
  try {
    const adapter = await gpu.requestAdapter();
    return Boolean(adapter);
  } catch {
    return false;
  }
}

/* ─── Unified Hybrid GPU Viewport Engine ─── */

export interface RenderHybridFrameParams {
  readonly docWidth: number;
  readonly docHeight: number;
  readonly background: string;
  readonly renderNodes: readonly DesignNode[];
  readonly viewportRect: ViewportRect;
  readonly dpr: number;
  readonly displayWidthPx: number;
  readonly displayHeightPx: number;
  readonly hiddenNodeIds?: ReadonlySet<string> | null;
  readonly inlineEditNodeId?: string | null;
  readonly richContext: RichNodeRenderContext;
}

export class HybridGpuViewportEngine {
  private readonly instancedCanvas: HTMLCanvasElement;
  private readonly tileCanvas: HTMLCanvasElement;
  private readonly webgl2: WebGL2InstancedRenderer | null;
  private readonly fallback2d: CanvasRenderingContext2D | null;
  private readonly tileCtx: CanvasRenderingContext2D | null;
  private readonly tileCache: TileCacheManager;
  private scratchBuffer = new Float32Array(256 * GPU_INSTANCE_STRIDE_FLOATS);
  private readonly backend: GpuBackendKind;

  constructor(instancedCanvas: HTMLCanvasElement, tileCanvas: HTMLCanvasElement, maxTiles = 64) {
    this.instancedCanvas = instancedCanvas;
    this.tileCanvas = tileCanvas;
    this.webgl2 = WebGL2InstancedRenderer.tryCreate(instancedCanvas);
    this.fallback2d = this.webgl2 ? null : instancedCanvas.getContext('2d');
    this.tileCtx = tileCanvas.getContext('2d');
    this.tileCache = new TileCacheManager(maxTiles);
    this.backend = this.webgl2 ? 'webgl2' : 'canvas2d-tiled';
  }

  public getBackend(): GpuBackendKind {
    return this.backend;
  }

  public invalidateTiles(): void {
    this.tileCache.clear();
  }

  public renderFrame(params: RenderHybridFrameParams): GpuSceneMetrics {
    const frameStart = performance.now();
    const {
      docWidth,
      docHeight,
      background,
      renderNodes,
      viewportRect,
      dpr,
      displayWidthPx,
      displayHeightPx,
      hiddenNodeIds,
      inlineEditNodeId,
      richContext,
    } = params;

    const safeDpr = Math.max(1, Math.min(2, dpr || 1));
    // Clamp backing store dimensions to safe GPU texture limits (4096px)
    const pixelWidth = Math.max(1, Math.min(4096, Math.round(displayWidthPx * safeDpr)));
    const pixelHeight = Math.max(1, Math.min(4096, Math.round(displayHeightPx * safeDpr)));

    if (this.instancedCanvas.width !== pixelWidth || this.instancedCanvas.height !== pixelHeight) {
      this.instancedCanvas.width = pixelWidth;
      this.instancedCanvas.height = pixelHeight;
    }
    if (this.tileCanvas.width !== pixelWidth || this.tileCanvas.height !== pixelHeight) {
      this.tileCanvas.width = pixelWidth;
      this.tileCanvas.height = pixelHeight;
    }

    const neededFloats = renderNodes.length * GPU_INSTANCE_STRIDE_FLOATS;
    if (this.scratchBuffer.length < neededFloats) {
      this.scratchBuffer = new Float32Array(Math.max(neededFloats, this.scratchBuffer.length * 2));
    }

    // 1. Pack fast-path primitives + rich nodes (with viewport culling & z-order safety)
    const packed = packSceneToGpuBatches(renderNodes, {
      viewportRect,
      hiddenNodeIds,
      inlineEditNodeId,
      clipMaskMap: richContext.clipMaskMap,
      frameClipMap: richContext.frameClipMap,
      scratchBuffer: this.scratchBuffer,
    });

    // 2. Render instanced solid primitives on GPU (1 draw call) or fallback 2D canvas
    const instancedTiming = this.webgl2
      ? this.webgl2.render(
          packed.instanceData,
          packed.instanceCount,
          docWidth,
          docHeight,
          background,
          pixelWidth,
          pixelHeight,
        )
      : this.fallback2d
        ? renderInstancesCanvas2DFallback(
            this.fallback2d,
            packed.instanceData,
            packed.instanceCount,
            docWidth,
            docHeight,
            background,
            pixelWidth,
            pixelHeight,
          )
        : { uploadMs: 0, drawMs: 0, gpuBufferBytes: 0 };

    // 3. Render rich artwork through 512x512 LRU Tile Cache
    const tileDrawStart = performance.now();
    let visibleTilesCount = 0;
    const tileCtx = this.tileCtx;

    if (tileCtx) {
      tileCtx.setTransform(1, 0, 0, 1, 0, 0);
      tileCtx.clearRect(0, 0, pixelWidth, pixelHeight);

      if (packed.richNodes.length > 0) {
        const scaleX = pixelWidth / Math.max(1, docWidth);
        const scaleY = pixelHeight / Math.max(1, docHeight);
        // Quantize tile raster scale into crisp buckets to maximize cache hits across zoom/pan
        const tileScale = Math.max(0.5, Math.min(2, Math.round(Math.max(scaleX, scaleY) * 4) / 4));
        const visibleTiles = computeVisibleTileGrid(viewportRect, docWidth, docHeight, DEFAULT_TILE_SIZE);
        visibleTilesCount = visibleTiles.length;

        for (let t = 0; t < visibleTiles.length; t += 1) {
          const tile = visibleTiles[t];
          const tileNodes = filterNodesForTile(packed.richNodes, tile);
          if (tileNodes.length === 0) continue;

          const signature = computeTileSignature(tileNodes, tile, tileScale);
          const tilePixW = Math.max(1, Math.ceil(tile.width * tileScale));
          const tilePixH = Math.max(1, Math.ceil(tile.height * tileScale));

          const surface = this.tileCache.getOrRenderTile(
            tile,
            signature,
            tilePixW,
            tilePixH,
            (targetSurface) => {
              const sCtx = targetSurface.getContext2D();
              if (!sCtx) return;
              sCtx.setTransform(1, 0, 0, 1, 0, 0);
              sCtx.clearRect(0, 0, tilePixW, tilePixH);
              sCtx.save();
              sCtx.scale(tileScale, tileScale);
              sCtx.translate(-tile.x, -tile.y);
              for (let n = 0; n < tileNodes.length; n += 1) {
                renderRichNodeToContext2D(sCtx, tileNodes[n], richContext);
              }
              sCtx.restore();
            },
          );

          if (surface.drawable) {
            tileCtx.drawImage(
              surface.drawable,
              0,
              0,
              tilePixW,
              tilePixH,
              tile.x * scaleX,
              tile.y * scaleY,
              tile.width * scaleX,
              tile.height * scaleY,
            );
          }
        }
      }
    }

    const tileDrawMs = Math.max(0, performance.now() - tileDrawStart);
    const totalDrawMs = instancedTiming.drawMs + tileDrawMs;
    const totalFrameMs = Math.max(0, performance.now() - frameStart);
    const cacheStats = this.tileCache.getStats();

    return {
      backend: this.backend,
      totalNodes: renderNodes.length,
      instancedPrimitives: packed.instanceCount,
      richNodes: packed.richNodes.length,
      culledNodes: packed.culledNodes,
      visibleTiles: visibleTilesCount,
      tileCacheHits: cacheStats.hits,
      tileCacheMisses: cacheStats.misses,
      tileCacheSize: cacheStats.size,
      gpuBufferBytes: instancedTiming.gpuBufferBytes,
      packMs: packed.packMs,
      uploadMs: instancedTiming.uploadMs,
      drawMs: totalDrawMs,
      lastFrameMs: totalFrameMs,
    };
  }

  public dispose(): void {
    this.webgl2?.dispose();
    this.tileCache.clear();
  }
}
