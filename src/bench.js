// The ?bench=1 harness (CLAUDE.md §5, §M0).
//
// A fixed 600-frame scripted flight across all six scales, measured and
// written to window.AEON_BENCH as JSON. Nothing downstream of M0 is
// measurable without it: "frame budget is a correctness property" is only
// true if something reports the frame budget.
//
// Default-off in every sense. Without ?bench=1 the only thing this module
// does at import is read one URL parameter and return.
//
// Three things make a number here trustworthy:
//   · the route is frame-counted, not clock-driven, so a slow machine walks
//     the same path as a fast one and only the timings differ;
//   · adaptive resolution is pinned for the run (§11 — quality that moves
//     mid-flight measures itself, not the renderer);
//   · the GPU renderer string is recorded verbatim, so a SwiftShader run can
//     never be mistaken for a gate-valid one.

import * as THREE from 'three';
import { hash } from './rng.js';
import { GalaxyScale, galaxyParams } from './galaxy.js';
import { SystemScale, systemParams } from './system.js';
import { BlackHoleScale } from './blackhole.js';
import { SurfaceScale } from './surface.js';
import { PlanetScale } from './planetscale.js';
import { Q } from './quality.js';

/** ?bench=1 — checked once, at import, before anything allocates. */
export const BENCH_ON = (() => {
  try { return new URL(window.location.href).searchParams.get('bench') === '1'; }
  catch { return false; }
})();

/** the universe a bench run flies when no ?seed= pins one, so that a bare
 *  `?bench=1` is reproducible on every machine, forever */
export const BENCH_SEED = 20250601;

const FRAMES = 600;          // §M0: a fixed 600-frame scripted flight
const STATIONS = 6;          // §1: six seamlessly nested scales
const PER = FRAMES / STATIONS;
const WARM = 40;             // frames per station excluded from the statistics

// --------------------------------------------------------------- gl probe --
// WebGL exposes no memory query, so the only honest GPU-memory number is one
// we account for ourselves: every allocation through the context, minus every
// delete. Installed by patching getContext before the renderer is built —
// which is why this runs at module scope, and why it runs only under ?bench=1.

const glMem = { texture: 0, buffer: 0, renderbuffer: 0, peak: 0 };

function bytesPerPixel(gl, internalformat, type) {
  const F = {
    [gl.RGBA]: 4, [gl.RGB]: 3, [gl.LUMINANCE_ALPHA]: 2, [gl.LUMINANCE]: 1, [gl.ALPHA]: 1,
    [gl.RED]: 1, [gl.RG]: 2, [gl.RED_INTEGER]: 1, [gl.RGBA_INTEGER]: 4,
    [gl.R8]: 1, [gl.RG8]: 2, [gl.RGB8]: 3, [gl.RGBA8]: 4, [gl.SRGB8]: 3, [gl.SRGB8_ALPHA8]: 4,
    [gl.R16F]: 2, [gl.RG16F]: 4, [gl.RGB16F]: 6, [gl.RGBA16F]: 8,
    [gl.R32F]: 4, [gl.RG32F]: 8, [gl.RGB32F]: 12, [gl.RGBA32F]: 16,
    [gl.R11F_G11F_B10F]: 4, [gl.RGB10_A2]: 4,
    [gl.DEPTH_COMPONENT16]: 2, [gl.DEPTH_COMPONENT24]: 4, [gl.DEPTH_COMPONENT32F]: 4,
    [gl.DEPTH24_STENCIL8]: 4, [gl.DEPTH32F_STENCIL8]: 8, [gl.STENCIL_INDEX8]: 1,
    [gl.DEPTH_COMPONENT]: 3, [gl.DEPTH_STENCIL]: 4,
  };
  let bpp = F[internalformat];
  if (bpp === undefined) return 4;
  // the unsized formats carry their width in the type instead
  if (internalformat === gl.RGBA || internalformat === gl.RGB
    || internalformat === gl.RED || internalformat === gl.RG) {
    if (type === gl.FLOAT) bpp *= 4;
    else if (type === gl.HALF_FLOAT || type === gl.HALF_FLOAT_OES) bpp *= 2;
  }
  return bpp;
}

function installGLProbe() {
  const proto = HTMLCanvasElement.prototype;
  const orig = proto.getContext;
  proto.getContext = function (kind, ...rest) {
    const gl = orig.call(this, kind, ...rest);
    if (!gl || !/webgl/i.test(kind) || gl.__aeonProbed) return gl;
    gl.__aeonProbed = true;

    const size = new WeakMap();       // GL object → bytes currently charged
    const bound = { tex: new Map(), buf: new Map(), rb: null };
    const charge = (obj, key, bytes) => {
      if (!obj) return;
      const prev = size.get(obj) || 0;
      size.set(obj, prev + bytes);
      glMem[key] += bytes;
      const total = glMem.texture + glMem.buffer + glMem.renderbuffer;
      if (total > glMem.peak) glMem.peak = total;
    };
    const release = (obj, key) => {
      const held = size.get(obj);
      if (held === undefined) return;
      glMem[key] -= held;
      size.delete(obj);
    };
    const wrap = (name, fn) => {
      const o = gl[name];
      if (typeof o !== 'function') return;
      gl[name] = function (...a) { const r = o.apply(gl, a); fn(a, r); return r; };
    };

    wrap('bindTexture', (a) => bound.tex.set(a[0], a[1]));
    wrap('bindBuffer', (a) => bound.buf.set(a[0], a[1]));
    wrap('bindRenderbuffer', (a) => { bound.rb = a[1]; });

    // texImage2D has two shapes: explicit (w, h) and DOM-source
    wrap('texImage2D', (a) => {
      const target = a[0];
      const tex = bound.tex.get(target === gl.TEXTURE_CUBE_MAP ? gl.TEXTURE_CUBE_MAP
        : target >= 0x8515 && target <= 0x851A ? gl.TEXTURE_CUBE_MAP : target);
      let w, h, internalformat = a[2], type;
      if (a.length >= 8) { w = a[3]; h = a[4]; type = a[7]; }
      else { const src = a[5]; w = src?.width | 0; h = src?.height | 0; type = a[4]; }
      if (!w || !h) return;
      charge(tex, 'texture', w * h * bytesPerPixel(gl, internalformat, type));
    });
    wrap('texStorage2D', (a) => {
      const [target, levels, internalformat, w, h] = a;
      const tex = bound.tex.get(target);
      // texStorage allocates the whole chain up front
      charge(tex, 'texture', w * h * bytesPerPixel(gl, internalformat, 0)
        * (levels > 1 ? 4 / 3 : 1));
    });
    wrap('texImage3D', (a) => {
      const [target, , internalformat, w, h, d, , , type] = a;
      charge(bound.tex.get(target), 'texture', w * h * d * bytesPerPixel(gl, internalformat, type));
    });
    wrap('generateMipmap', (a) => {
      const tex = bound.tex.get(a[0]);
      charge(tex, 'texture', Math.round((size.get(tex) || 0) / 3));   // the tail of the chain
    });
    wrap('bufferData', (a) => {
      const n = typeof a[1] === 'number' ? a[1] : (a[1]?.byteLength || 0);
      charge(bound.buf.get(a[0]), 'buffer', n);
    });
    const rbStore = (a) => {
      const [, arg1, w, h] = a;
      const ms = a.length >= 5;
      const fmt = ms ? a[2] : arg1;
      const W = ms ? a[3] : w, H = ms ? a[4] : h;
      charge(bound.rb, 'renderbuffer', W * H * bytesPerPixel(gl, fmt, 0) * (ms ? a[1] || 1 : 1));
    };
    wrap('renderbufferStorage', rbStore);
    wrap('renderbufferStorageMultisample', rbStore);

    wrap('deleteTexture', (a) => release(a[0], 'texture'));
    wrap('deleteBuffer', (a) => release(a[0], 'buffer'));
    wrap('deleteRenderbuffer', (a) => release(a[0], 'renderbuffer'));

    return gl;
  };
}

if (BENCH_ON) installGLProbe();

// ------------------------------------------------------------ statistics --

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

function summarize(samples) {
  if (!samples.length) return null;
  const s = [...samples].sort((a, b) => a - b);
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  return {
    n: s.length,
    mean: +mean.toFixed(3),
    p50: +percentile(s, 0.50).toFixed(3),
    p95: +percentile(s, 0.95).toFixed(3),
    p99: +percentile(s, 0.99).toFixed(3),
    max: +s[s.length - 1].toFixed(3),
  };
}

/** frame times are milliseconds; the budget table speaks fps, so invert the
 *  slow tail: 95% of frames at or above N fps is the 95th-percentile time */
const asFps = (ms) => (ms ? +(1000 / ms).toFixed(1) : null);

// ---------------------------------------------------------------- route ---
// Six stations, one per scale. Each returns the scale to stand in; the
// harness swaps the stack directly — the same construction path _restore()
// uses for deep links — so the flight carries no transition frames into the
// statistics it reports.

function pickRoute(seed) {
  const galaxySeed = hash(seed, 0xbe0) >>> 0;
  const gp = galaxyParams(galaxySeed);
  // walk this galaxy's stars in its own index order until one has a world you
  // can stand on; systemParams is pure, so the search costs no scene at all
  for (let i = 0; i < 4096; i++) {
    const starSeed = hash(gp.seed, i, 0x57a9) >>> 0;
    const sp = systemParams(starSeed);
    const idx = sp.planets.findIndex(p => p.typeId <= 4);
    if (idx >= 0) return { galaxySeed, gp, starSeed, planetIndex: idx };
  }
  throw new Error('bench: no rocky world within 4096 stars of ' + galaxySeed);
}

export class Bench {
  /** null unless ?bench=1 — the caller stays free of the branch */
  static maybe(app) { return BENCH_ON ? new Bench(app) : null; }

  constructor(app) {
    this.app = app;
    const url = new URL(window.location.href);
    this.tier = url.searchParams.get('tier') || 'unspecified';
    this.route = pickRoute(app.seed);
    this.stations = [];
    this.frame = 0;
    this.done = false;
    this.t0 = performance.now();
    this._cur = null;
    this._pending = null;

    // §11's "set once at init" is now structural — quality.js chooses a tier
    // before anything allocates and nothing moves it afterwards — so a bench
    // run no longer has to pin anything to measure the renderer rather than
    // the resolution controller. The tier it ran at is recorded instead.

    // the tour would fly its own route over ours
    app.tour?.stop?.();

    const s = document.getElementById('splash');
    if (s) s.remove();

    this._plan = [
      { name: 'cosmic', enter: () => null },
      { name: 'galaxy', enter: () => new GalaxyScale(app, { galaxySeed: this.route.galaxySeed }) },
      { name: 'system', enter: () => new SystemScale(app, { starSeed: this.route.starSeed }) },
      { name: 'planet', enter: () => this._planet() },
      { name: 'surface', enter: () => this._surface() },
      { name: 'blackhole', enter: () => new BlackHoleScale(app, { bhMassMsun: this.route.gp.bhMassMsun }) },
    ];
  }

  /** the whole-planet globe, entered the way the system hands it over */
  _planet() {
    const app = this.app;
    const sys = app.active();
    if (sys.kind !== 'system') throw new Error('bench: planet station expects the system below it');
    const pp = sys.params.planets[this.route.planetIndex];
    return new PlanetScale(app, app._approachCtx(sys, pp));
  }

  /** boots on regolith: the classic surface, which is still the scale a moon
   *  and a ?quad=0 world are walked on */
  _surface() {
    const app = this.app;
    const sp = systemParams(this.route.starSeed);
    const pp = sp.planets[this.route.planetIndex];
    return new SurfaceScale(app, {
      planet: pp, system: sp, sunColor: new THREE.Color(1, 0.96, 0.9),
      hostIndex: this.route.planetIndex,
    });
  }

  /** swap the stack without a transition — _restore()'s path, not push()'s */
  _stand(scale) {
    const app = this.app;
    if (!scale) return;
    const from = app.active();
    from.exit();
    if (app.stack.length > 1) { from.dispose(); app.stack.pop(); }
    app.stack.push(scale);
    scale.enter?.();
    app._syncScale();
  }

  frameStart() {
    // renderer.info resets itself on every render() call, and the post chain
    // makes four or five of those per frame — so reading it at the tail of the
    // frame reported the *last pass only*: one draw call and two triangles for
    // the final fullscreen quad. §5 budgets 900 draws and 2.2 M triangles, and
    // the harness was answering 1 and 0.00 M on every machine it had ever run
    // on. Take ownership of the counter and reset it once, here.
    const info = this.app.renderer.info;
    info.autoReset = false;
    info.reset();
    const t = performance.now();
    // the interval between successive frame starts is the real frame time —
    // which is not the simulation's dt, and under a fixed timestep is not even
    // close to it. Measuring dt would report the timestep back as a frame rate.
    this._wall = this._fs === undefined ? null : t - this._fs;
    this._fs = t;
  }

  /** called at the tail of App._frame, after everything has been submitted */
  frameEnd() {
    if (this.done) return;
    const cpu = performance.now() - this._fs;
    const idx = Math.floor(this.frame / PER);

    if (idx !== this._cur) {
      this._cur = idx;
      const plan = this._plan[idx];
      if (plan) {
        try { this._stand(plan.enter()); }
        catch (e) { this._fail = String(e && e.message || e); }
        this.stations.push({
          name: plan.name, kind: this.app.active().kind,
          frameMs: [], cpuMs: [], calls: [], tris: [],
          error: this._fail || undefined,
        });
        this._fail = null;
      }
    }

    const st = this.stations[idx];
    if (st && this.frame % PER >= WARM && this._wall !== null) {
      const info = this.app.renderer.info.render;
      st.frameMs.push(this._wall);
      st.cpuMs.push(cpu);
      st.calls.push(info.calls);
      st.tris.push(info.triangles);
    }

    if (++this.frame >= FRAMES) this._finish();
  }

  _finish() {
    this.done = true;
    const app = this.app;
    const gl = app.renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const software = /swiftshader|llvmpipe|software|basic render/i.test(String(renderer));

    const all = { frameMs: [], cpuMs: [], calls: [], tris: [] };
    const scales = this.stations.map((st) => {
      for (const k of Object.keys(all)) all[k].push(...st[k]);
      return {
        name: st.name, kind: st.kind, error: st.error,
        frameMs: summarize(st.frameMs),
        fps: {
          p50: asFps(summarize(st.frameMs)?.p50),
          p95: asFps(summarize(st.frameMs)?.p95),
          p99: asFps(summarize(st.frameMs)?.p99),
        },
        cpuMs: summarize(st.cpuMs),
        drawCalls: summarize(st.calls),
        triangles: summarize(st.tris),
      };
    });

    const MB = (b) => +(b / 1048576).toFixed(1);
    this.report = {
      schema: 'aeon-perf/1',
      seed: app.seed,
      tier: this.tier,
      qualityRow: Q.name,
      route: {
        galaxySeed: this.route.galaxySeed,
        starSeed: this.route.starSeed,
        planetIndex: this.route.planetIndex,
      },
      frames: FRAMES,
      warmupFramesPerStation: WARM,
      wallClockMs: +(performance.now() - this.t0).toFixed(0),
      fixedTimestepMs: app.fixedDt ? +(app.fixedDt * 1000).toFixed(3) : null,
      device: {
        renderer: String(renderer),
        // §M0 gates on a real GPU: a software rasteriser produces a valid
        // shape and worthless numbers, and must say so in its own output
        softwareRasterizer: software,
        gateValid: !software,
        dpr: app.dpr,
        viewport: [app.width, app.height],
        userAgent: navigator.userAgent,
      },
      overall: {
        frameMs: summarize(all.frameMs),
        fps: {
          p50: asFps(summarize(all.frameMs)?.p50),
          p95: asFps(summarize(all.frameMs)?.p95),
          p99: asFps(summarize(all.frameMs)?.p99),
        },
        cpuMs: summarize(all.cpuMs),
        drawCalls: summarize(all.calls),
        triangles: summarize(all.tris),
      },
      scales,
      gpuMemoryMB: {
        // accounted from the context, not queried: WebGL has no query
        textures: MB(glMem.texture),
        buffers: MB(glMem.buffer),
        renderbuffers: MB(glMem.renderbuffer),
        peak: MB(glMem.peak),
        method: 'tracked GL allocations minus deletes',
      },
      threeInfo: {
        geometries: app.renderer.info.memory.geometries,
        textures: app.renderer.info.memory.textures,
        programs: app.renderer.info.programs?.length ?? null,
      },
    };

    window.AEON_BENCH = this.report;
    window.AEON_BENCH_DONE = true;
    app.renderer.setAnimationLoop(null);
    console.log('[aeon bench] complete', this.report);
  }
}
