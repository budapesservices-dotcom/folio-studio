/**
 * Custom Ultra-Lightweight 2D GPU Instanced SDF Renderer (WebGPU / WebGL2 / Canvas2D)
 * + Viewport-Space Camera Projection + Tiled Rich Artwork Compositor.
 *
 * Key architecture guarantees:
 * 1. Zero-Copy Upload: `scenePacker.ts` writes 4 x vec4 floats directly in hardware order
 *    (`[rect, fill, geom(radius, rot, strokeW, kind), stroke]`) — zero per-frame CPU swizzle.
 * 2. True Viewport-Space Projection: Canvases cover only the visible viewport sub-rect at
 *    native DPR pixel density, staying razor-sharp at 1600%+ zoom while keeping VRAM tiny.
 * 3. Real WebGPU (WGSL) pipeline with instant WebGL2 -> Canvas2D seamless fallback.
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

/* ─── Viewport-Space Camera Projection (Pure, Unit-Testable) ─── */

export interface GpuViewportProjection {
  /** Visible document-space origin X clamped to [0, docWidth]. */
  readonly viewX: number;
  /** Visible document-space origin Y clamped to [0, docHeight]. */
  readonly viewY: number;
  /** Visible document-space width (>= 1). */
  readonly viewWidth: number;
  /** Visible document-space height (>= 1). */
  readonly viewHeight: number;
  /** Backing store pixel width clamped to GPU texture limit. */
  readonly pixelWidth: number;
  /** Backing store pixel height clamped to GPU texture limit. */
  readonly pixelHeight: number;
  /** CSS percentage placement inside the artboard-sized `.gpu-viewport-layer`. */
  readonly leftPct: number;
  readonly topPct: number;
  readonly widthPct: number;
  readonly heightPct: number;
}

const MAX_GPU_SURFACE_PX = 4096;

/**
 * Computes a viewport-space GPU surface projection covering only the visible
 * slice of the document at native display DPR — preserving sharp edges even
 * at 1600%+ zoom while avoiding multi-gigapixel VRAM clamping.
 */
export function computeGpuViewportProjection(
  viewportRect: ViewportRect,
  docWidth: number,
  docHeight: number,
  displayWidthPx: number,
  displayHeightPx: number,
  dpr: number,
): GpuViewportProjection {
  const safeDocW = Math.max(1, docWidth);
  const safeDocH = Math.max(1, docHeight);
  const safeDpr = Math.max(1, Math.min(2.5, dpr || 1));

  // Add a small 2px document-unit bleed margin to prevent sub-pixel seam flicker while panning
  const bleed = 2;
  const rawX0 = Math.floor(viewportRect.x - bleed);
  const rawY0 = Math.floor(viewportRect.y - bleed);
  const rawX1 = Math.ceil(viewportRect.x + viewportRect.width + bleed);
  const rawY1 = Math.ceil(viewportRect.y + viewportRect.height + bleed);

  const viewX = Math.max(0, Math.min(safeDocW - 1, rawX0));
  const viewY = Math.max(0, Math.min(safeDocH - 1, rawY0));
  const viewMaxX = Math.max(viewX + 1, Math.min(safeDocW, rawX1));
  const viewMaxY = Math.max(viewY + 1, Math.min(safeDocH, rawY1));
  const viewWidth = Math.max(1, viewMaxX - viewX);
  const viewHeight = Math.max(1, viewMaxY - viewY);

  const cssScaleX = Math.max(0.05, displayWidthPx) / safeDocW;
  const cssScaleY = Math.max(0.05, displayHeightPx) / safeDocH;

  const pixelWidth = Math.max(1, Math.min(MAX_GPU_SURFACE_PX, Math.round(viewWidth * cssScaleX * safeDpr)));
  const pixelHeight = Math.max(1, Math.min(MAX_GPU_SURFACE_PX, Math.round(viewHeight * cssScaleY * safeDpr)));

  return {
    viewX,
    viewY,
    viewWidth,
    viewHeight,
    pixelWidth,
    pixelHeight,
    leftPct: (viewX / safeDocW) * 100,
    topPct: (viewY / safeDocH) * 100,
    widthPct: (viewWidth / safeDocW) * 100,
    heightPct: (viewHeight / safeDocH) * 100,
  };
}

/* ─── GLSL ES 3.00 Instanced 2D SDF Shaders (WebGL2 — Zero-Copy Layout) ─── */

const WEBGL2_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_unitQuad;
layout(location = 1) in vec4 a_rect;     // x, y, width, height
layout(location = 2) in vec4 a_fill;     // r, g, b, a
layout(location = 3) in vec4 a_geom;     // radius, rotRad, strokeW, shapeKind
layout(location = 4) in vec4 a_stroke;   // sr, sg, sb, sa

uniform vec4 u_viewport;                 // viewX, viewY, viewWidth, viewHeight

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

  vec2 clip = ((world - u_viewport.xy) / u_viewport.zw) * 2.0 - 1.0;
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

  float aa = max(0.5, fwidth(dist));
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

/* ─── WGSL Instanced 2D SDF Shader (WebGPU — Zero-Copy Hardware Layout) ─── */

export const WEBGPU_SDF_WGSL = `
struct Uniforms {
  viewport: vec4<f32>, // viewX, viewY, viewWidth, viewHeight
};

struct Instance {
  rect: vec4<f32>,   // x, y, width, height
  fill: vec4<f32>,   // r, g, b, a
  geom: vec4<f32>,   // radius, rotRad, strokeW, shapeKind
  stroke: vec4<f32>, // sr, sg, sb, sa
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
  let strokeW = inst.geom.z;
  let pad = strokeW * 0.5 + 2.0;
  let local = (quad[vid] * 2.0 - 1.0) * (halfSize + vec2<f32>(pad, pad));
  let c = cos(inst.geom.y);
  let s = sin(inst.geom.y);
  let rot = vec2<f32>(local.x * c - local.y * s, local.x * s + local.y * c);
  let world = inst.rect.xy + halfSize + rot;
  let clip = ((world - u.viewport.xy) / u.viewport.zw) * 2.0 - 1.0;

  var out: VertexOut;
  out.pos = vec4<f32>(clip.x, -clip.y, 0.0, 1.0);
  out.localPos = local;
  out.halfSize = halfSize;
  out.fill = inst.fill;
  out.stroke = inst.stroke;
  out.params = vec3<f32>(min(inst.geom.x, min(halfSize.x, halfSize.y)), strokeW, inst.geom.w);
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

  let aa = max(0.5, fwidth(dist));
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

/* ─── Minimal Typed WebGPU Interfaces (No extra @webgpu/types dependency needed) ─── */

interface MinimalGpuBuffer {
  destroy(): void;
}
interface MinimalGpuBindGroup {}
interface MinimalGpuBindGroupLayout {}
interface MinimalGpuRenderPipeline {
  getBindGroupLayout(index: number): MinimalGpuBindGroupLayout;
}
interface MinimalGpuRenderPassEncoder {
  setPipeline(pipeline: MinimalGpuRenderPipeline): void;
  setBindGroup(index: number, bindGroup: MinimalGpuBindGroup): void;
  draw(vertexCount: number, instanceCount?: number): void;
  end(): void;
}
interface MinimalGpuCommandEncoder {
  beginRenderPass(descriptor: unknown): MinimalGpuRenderPassEncoder;
  finish(): unknown;
}
interface MinimalGpuQueue {
  writeBuffer(buffer: MinimalGpuBuffer, bufferOffset: number, data: ArrayBufferView | ArrayBuffer, dataOffset?: number, size?: number): void;
  submit(commandBuffers: readonly unknown[]): void;
}
interface MinimalGpuDevice {
  readonly queue: MinimalGpuQueue;
  createShaderModule(descriptor: { code: string }): unknown;
  createRenderPipeline(descriptor: unknown): MinimalGpuRenderPipeline;
  createBuffer(descriptor: { size: number; usage: number }): MinimalGpuBuffer;
  createBindGroup(descriptor: unknown): MinimalGpuBindGroup;
  createCommandEncoder(): MinimalGpuCommandEncoder;
  destroy?(): void;
}
interface MinimalGpuCanvasContext {
  configure(config: { device: MinimalGpuDevice; format: string; alphaMode: 'premultiplied' | 'opaque' }): void;
  getCurrentTexture(): { createView(): unknown };
  unconfigure?(): void;
}
interface MinimalNavigatorGpu {
  getPreferredCanvasFormat?(): string;
  requestAdapter(options?: { powerPreference?: string }): Promise<{ requestDevice(): Promise<MinimalGpuDevice> } | null>;
}

const GPU_BUFFER_USAGE_UNIFORM = 0x0040;
const GPU_BUFFER_USAGE_STORAGE = 0x0080;
const GPU_BUFFER_USAGE_COPY_DST = 0x0008;

/* ─── Real WebGPU Instanced SDF Renderer ─── */

class WebGpuInstancedRenderer {
  private readonly device: MinimalGpuDevice;
  private readonly context: MinimalGpuCanvasContext;
  private readonly pipeline: MinimalGpuRenderPipeline;
  private readonly uniformBuffer: MinimalGpuBuffer;
  private readonly uniformData = new Float32Array(4);
  private instanceBuffer: MinimalGpuBuffer;
  private instanceCapacityBytes: number;
  private bindGroup: MinimalGpuBindGroup;

  private constructor(
    device: MinimalGpuDevice,
    context: MinimalGpuCanvasContext,
    pipeline: MinimalGpuRenderPipeline,
    uniformBuffer: MinimalGpuBuffer,
    instanceBuffer: MinimalGpuBuffer,
    instanceCapacityBytes: number,
    bindGroup: MinimalGpuBindGroup,
  ) {
    this.device = device;
    this.context = context;
    this.pipeline = pipeline;
    this.uniformBuffer = uniformBuffer;
    this.instanceBuffer = instanceBuffer;
    this.instanceCapacityBytes = instanceCapacityBytes;
    this.bindGroup = bindGroup;
  }

  public static async tryCreate(canvas: HTMLCanvasElement): Promise<WebGpuInstancedRenderer | null> {
    if (typeof navigator === 'undefined') return null;
    const gpu = (navigator as unknown as { gpu?: MinimalNavigatorGpu }).gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') return null;

    try {
      const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) return null;
      const device = await adapter.requestDevice();
      const context = canvas.getContext('webgpu') as MinimalGpuCanvasContext | null;
      if (!context) return null;

      const format = typeof gpu.getPreferredCanvasFormat === 'function'
        ? gpu.getPreferredCanvasFormat()
        : 'bgra8unorm';
      context.configure({ device, format, alphaMode: 'premultiplied' });

      const shaderModule = device.createShaderModule({ code: WEBGPU_SDF_WGSL });
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: shaderModule, entryPoint: 'vs_main' },
        fragment: {
          module: shaderModule,
          entryPoint: 'fs_main',
          targets: [
            {
              format,
              blend: {
                color: {
                  srcFactor: 'src-alpha',
                  dstFactor: 'one-minus-src-alpha',
                  operation: 'add',
                },
                alpha: {
                  srcFactor: 'one',
                  dstFactor: 'one-minus-src-alpha',
                  operation: 'add',
                },
              },
            },
          ],
        },
        primitive: { topology: 'triangle-list' },
      });

      const uniformBuffer = device.createBuffer({
        size: 16,
        usage: GPU_BUFFER_USAGE_UNIFORM | GPU_BUFFER_USAGE_COPY_DST,
      });

      const initialCapacity = 256 * GPU_INSTANCE_STRIDE_FLOATS * 4;
      const instanceBuffer = device.createBuffer({
        size: initialCapacity,
        usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_DST,
      });

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: uniformBuffer } },
          { binding: 1, resource: { buffer: instanceBuffer } },
        ],
      });

      return new WebGpuInstancedRenderer(
        device,
        context,
        pipeline,
        uniformBuffer,
        instanceBuffer,
        initialCapacity,
        bindGroup,
      );
    } catch {
      return null;
    }
  }

  public render(
    instanceData: Float32Array,
    instanceCount: number,
    projection: GpuViewportProjection,
    backgroundColor: string,
  ): { uploadMs: number; drawMs: number; gpuBufferBytes: number } {
    const uploadStart = performance.now();
    this.uniformData[0] = projection.viewX;
    this.uniformData[1] = projection.viewY;
    this.uniformData[2] = projection.viewWidth;
    this.uniformData[3] = projection.viewHeight;
    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);

    const floatCount = instanceCount * GPU_INSTANCE_STRIDE_FLOATS;
    const bytesNeeded = floatCount * 4;
    if (bytesNeeded > this.instanceCapacityBytes) {
      this.instanceBuffer.destroy();
      this.instanceCapacityBytes = Math.max(bytesNeeded, this.instanceCapacityBytes * 2);
      this.instanceBuffer = this.device.createBuffer({
        size: this.instanceCapacityBytes,
        usage: GPU_BUFFER_USAGE_STORAGE | GPU_BUFFER_USAGE_COPY_DST,
      });
      this.bindGroup = this.device.createBindGroup({
        layout: this.pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.uniformBuffer } },
          { binding: 1, resource: { buffer: this.instanceBuffer } },
        ],
      });
    }

    if (instanceCount > 0) {
      // Direct zero-copy upload — scenePacker layout matches WGSL `struct Instance` 1:1
      this.device.queue.writeBuffer(
        this.instanceBuffer,
        0,
        instanceData,
        0,
        instanceCount * GPU_INSTANCE_STRIDE_FLOATS,
      );
    }
    const uploadMs = Math.max(0, performance.now() - uploadStart);

    const drawStart = performance.now();
    const bg = parseCssColorToRgba(backgroundColor, 1);
    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: bg[0], g: bg[1], b: bg[2], a: bg[3] },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    if (instanceCount > 0) {
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0, this.bindGroup);
      pass.draw(6, instanceCount);
    }
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    const drawMs = Math.max(0, performance.now() - drawStart);

    return { uploadMs, drawMs, gpuBufferBytes: bytesNeeded };
  }

  public dispose(): void {
    this.uniformBuffer.destroy();
    this.instanceBuffer.destroy();
    this.context.unconfigure?.();
    this.device.destroy?.();
  }
}

/* ─── WebGL2 Instanced SDF Renderer (Zero-Copy Hardware Layout) ─── */

class WebGL2InstancedRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly quadVbo: WebGLBuffer;
  private readonly instanceVbo: WebGLBuffer;
  private readonly viewportLoc: WebGLUniformLocation | null;
  private instanceCapacityBytes = 0;

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
    this.viewportLoc = gl.getUniformLocation(program, 'u_viewport');
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

    // Locations 1..4: Packed instanced attributes (16 floats = 64 bytes stride, 1:1 with scenePacker)
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
    projection: GpuViewportProjection,
    backgroundColor: string,
  ): { uploadMs: number; drawMs: number; gpuBufferBytes: number } {
    const gl = this.gl;
    gl.viewport(0, 0, projection.pixelWidth, projection.pixelHeight);

    const bg = parseCssColorToRgba(backgroundColor, 1);
    gl.clearColor(bg[0], bg[1], bg[2], bg[3]);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (instanceCount <= 0) {
      return { uploadMs: 0, drawMs: 0, gpuBufferBytes: 0 };
    }

    const uploadStart = performance.now();
    const floatCount = instanceCount * GPU_INSTANCE_STRIDE_FLOATS;
    const bytesNeeded = floatCount * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceVbo);
    if (bytesNeeded > this.instanceCapacityBytes) {
      this.instanceCapacityBytes = Math.max(bytesNeeded, this.instanceCapacityBytes * 2);
      gl.bufferData(gl.ARRAY_BUFFER, this.instanceCapacityBytes, gl.DYNAMIC_DRAW);
    }
    // Zero-copy direct upload (no CPU swizzle loop)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, instanceData.subarray(0, floatCount));
    const uploadMs = Math.max(0, performance.now() - uploadStart);

    const drawStart = performance.now();
    gl.useProgram(this.program);
    gl.uniform4f(
      this.viewportLoc,
      projection.viewX,
      projection.viewY,
      projection.viewWidth,
      projection.viewHeight,
    );
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

/* ─── Canvas2D Instanced Fallback (when WebGPU/WebGL2 are unavailable) ─── */

function renderInstancesCanvas2DFallback(
  ctx: CanvasRenderingContext2D,
  instanceData: Float32Array,
  instanceCount: number,
  projection: GpuViewportProjection,
  backgroundColor: string,
): { uploadMs: number; drawMs: number; gpuBufferBytes: number } {
  const start = performance.now();
  const scaleX = projection.pixelWidth / Math.max(1, projection.viewWidth);
  const scaleY = projection.pixelHeight / Math.max(1, projection.viewHeight);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = backgroundColor || '#ffffff';
  ctx.fillRect(0, 0, projection.pixelWidth, projection.pixelHeight);
  ctx.scale(scaleX, scaleY);
  ctx.translate(-projection.viewX, -projection.viewY);

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
    const sw = instanceData[b + 10];
    const shapeKind = instanceData[b + 11];
    const sr = Math.round(instanceData[b + 12] * 255);
    const sg = Math.round(instanceData[b + 13] * 255);
    const sb = Math.round(instanceData[b + 14] * 255);
    const sa = instanceData[b + 15];

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

function applyCanvasViewportStyle(canvas: HTMLCanvasElement, proj: GpuViewportProjection): void {
  canvas.style.left = `${proj.leftPct}%`;
  canvas.style.top = `${proj.topPct}%`;
  canvas.style.width = `${proj.widthPct}%`;
  canvas.style.height = `${proj.heightPct}%`;
  canvas.style.right = 'auto';
  canvas.style.bottom = 'auto';
}

export class HybridGpuViewportEngine {
  private readonly instancedCanvas: HTMLCanvasElement;
  private readonly tileCanvas: HTMLCanvasElement;
  private webgpuCanvas: HTMLCanvasElement | null = null;
  private webgpu: WebGpuInstancedRenderer | null = null;
  private webgl2: WebGL2InstancedRenderer | null;
  private readonly fallback2d: CanvasRenderingContext2D | null;
  private readonly tileCtx: CanvasRenderingContext2D | null;
  private readonly tileCache: TileCacheManager;
  private scratchBuffer = new Float32Array(256 * GPU_INSTANCE_STRIDE_FLOATS);
  private backend: GpuBackendKind;
  private disposed = false;

  constructor(instancedCanvas: HTMLCanvasElement, tileCanvas: HTMLCanvasElement, maxTiles = 64) {
    this.instancedCanvas = instancedCanvas;
    this.tileCanvas = tileCanvas;
    this.webgl2 = WebGL2InstancedRenderer.tryCreate(instancedCanvas);
    this.fallback2d = this.webgl2 ? null : instancedCanvas.getContext('2d');
    this.tileCtx = tileCanvas.getContext('2d');
    this.tileCache = new TileCacheManager(maxTiles);
    this.backend = this.webgl2 ? 'webgl2' : 'canvas2d-tiled';
  }

  /**
   * Asynchronously upgrades the instanced SDF pass to WebGPU on a dedicated canvas
   * (since a canvas bound to WebGL2 cannot simultaneously acquire a WebGPU context).
   * Returns `true` when upgraded, or `false` to keep WebGL2/Canvas2D seamlessly.
   */
  public async upgradeToWebGpuAsync(webgpuCanvas: HTMLCanvasElement): Promise<boolean> {
    if (this.disposed || this.webgpu) return Boolean(this.webgpu);
    const renderer = await WebGpuInstancedRenderer.tryCreate(webgpuCanvas);
    if (!renderer || this.disposed) {
      renderer?.dispose();
      return false;
    }
    this.webgpu = renderer;
    this.webgpuCanvas = webgpuCanvas;
    this.backend = 'webgpu';
    if (this.webgl2) {
      this.webgl2.dispose();
      this.webgl2 = null;
    }
    this.instancedCanvas.style.display = 'none';
    webgpuCanvas.style.display = 'block';
    return true;
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

    const proj = computeGpuViewportProjection(
      viewportRect,
      docWidth,
      docHeight,
      displayWidthPx,
      displayHeightPx,
      dpr,
    );

    const activeInstancedCanvas = this.webgpu && this.webgpuCanvas
      ? this.webgpuCanvas
      : this.instancedCanvas;

    if (activeInstancedCanvas.width !== proj.pixelWidth || activeInstancedCanvas.height !== proj.pixelHeight) {
      activeInstancedCanvas.width = proj.pixelWidth;
      activeInstancedCanvas.height = proj.pixelHeight;
    }
    applyCanvasViewportStyle(activeInstancedCanvas, proj);

    if (this.tileCanvas.width !== proj.pixelWidth || this.tileCanvas.height !== proj.pixelHeight) {
      this.tileCanvas.width = proj.pixelWidth;
      this.tileCanvas.height = proj.pixelHeight;
    }
    applyCanvasViewportStyle(this.tileCanvas, proj);

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

    // 2. Render instanced solid primitives on WebGPU -> WebGL2 -> Canvas2D (1 zero-copy draw call)
    const instancedTiming = this.webgpu
      ? this.webgpu.render(packed.instanceData, packed.instanceCount, proj, background)
      : this.webgl2
        ? this.webgl2.render(packed.instanceData, packed.instanceCount, proj, background)
        : this.fallback2d
          ? renderInstancesCanvas2DFallback(
              this.fallback2d,
              packed.instanceData,
              packed.instanceCount,
              proj,
              background,
            )
          : { uploadMs: 0, drawMs: 0, gpuBufferBytes: 0 };

    // 3. Render rich artwork through 512x512 LRU Tile Cache in viewport space
    const tileDrawStart = performance.now();
    let visibleTilesCount = 0;
    const tileCtx = this.tileCtx;

    if (tileCtx) {
      tileCtx.setTransform(1, 0, 0, 1, 0, 0);
      tileCtx.clearRect(0, 0, proj.pixelWidth, proj.pixelHeight);

      if (packed.richNodes.length > 0) {
        const scaleX = proj.pixelWidth / Math.max(1, proj.viewWidth);
        const scaleY = proj.pixelHeight / Math.max(1, proj.viewHeight);
        // Quantize tile raster scale into crisp buckets up to 4x for sharp zoomed-in typography/vectors
        const tileScale = Math.max(0.5, Math.min(4, Math.round(Math.max(scaleX, scaleY) * 4) / 4));
        const visibleTiles = computeVisibleTileGrid(
          { x: proj.viewX, y: proj.viewY, width: proj.viewWidth, height: proj.viewHeight },
          docWidth,
          docHeight,
          DEFAULT_TILE_SIZE,
        );
        visibleTilesCount = visibleTiles.length;

        for (let t = 0; t < visibleTiles.length; t += 1) {
          const tile = visibleTiles[t];
          const tileNodes = filterNodesForTile(packed.richNodes, tile);
          if (tileNodes.length === 0) continue;

          const signature = computeTileSignature(tileNodes, tile, tileScale, richContext.componentById);
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
              (tile.x - proj.viewX) * scaleX,
              (tile.y - proj.viewY) * scaleY,
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
    this.disposed = true;
    this.webgpu?.dispose();
    this.webgpu = null;
    this.webgl2?.dispose();
    this.webgl2 = null;
    this.tileCache.clear();
  }
}
