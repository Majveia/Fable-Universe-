// The GLSL↔JS parity gate for §9.3 (CLAUDE.md §7.3).
//
//   node tools/pixeldiff.js [--cases 4096] [--json docs/captures/pixeldiff.json]
//
// §7.3: *"New shader math gets a CPU reference implementation and a pixel diff
// (≥97% within 2/255) before it enters the render loop."* §2.7 says the same
// thing one level up about the terrain height field, and §11 records what
// happens when a pair like this drifts: *"will look like a rendering bug and
// cost a day."*
//
// `tools/verify.js` proves the CPU reference has the properties §9.3 needs.
// This proves the shader computes the same function. They are different
// questions and neither implies the other — a chunk can be a perfect port of a
// wrong reference, or a wrong port of a right one.
//
// ---------------------------------------------------------------------------
// Why this runs the real chunk in a real driver
//
// `AERIAL_GLSL` is imported from `src/aerial.js` and handed to `shaderSource`
// verbatim, which is the same rule §M0 sets for `shadercheck.js`: the thing
// under test is the string the driver receives, never the string as it reads in
// the file. The only additions are a `#version` line, an output declaration and
// a `main` that unpacks one test case per fragment.
//
// Inputs arrive as an RGBA32F texture and results leave as an RGBA32F render
// target, so the comparison is float-against-float and the 2/255 threshold is a
// *gate* rather than the measurement's own noise floor. A half-float target
// would have put roughly 1/2048 of quantisation under a 2/255 gate and quietly
// spent a quarter of the tolerance on the instrument.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  AERIAL_GLSL, REFERENCE_PALETTE, aerial, airFor, airPalette,
} from '../src/aerial.js';
import { arg, launch, playwright, REPO } from './lib.js';

// ------------------------------------------------------------- the cases ---

/** the LCG from Numerical Recipes — deterministic, and §2.3 forbids the alternative */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Worlds to test the chunk against. Not a spread for its own sake — each row is
 * a place the parameterisation could break:
 *
 *   fixture    the reference's own valley. thickness and hazeScale both 1, so
 *              any disagreement here is the port and nothing else.
 *   mars       thin air over low gravity: thickness far below 1 *and* hazeScale
 *              far above it, which are the two axes pulling opposite ways.
 *   venusian   thick air, where `pow(d/1700, 1.28)` saturates early and the
 *              exponential is doing all its work in the first few hundred metres
 *   heavy      a super-earth: high gravity crushes the boundary layer, so the
 *              mist terms run against a hazeScale well under 1
 *   airless    thickness exactly 0. Every distance must return the input colour
 *              unchanged and a fog of exactly 0 — the check §16.3 names as the
 *              one that says this is the right parameterisation and not a
 *              fitted one.
 */
const WORLDS = [
  { name: 'fixture', pp: { massE: 1, radiusE: 1, Teq: 255 }, opt: { atmo: 1, hazeX: 1 }, T: 5778 },
  { name: 'mars', pp: { massE: 0.107, radiusE: 0.532, Teq: 210 }, opt: { atmo: 0.12, hazeX: 1 }, T: 5778 },
  { name: 'venusian', pp: { massE: 0.815, radiusE: 0.949, Teq: 232 }, opt: { atmo: 1, hazeX: 2.4 }, T: 5100 },
  { name: 'heavy', pp: { massE: 5.5, radiusE: 1.6, Teq: 290 }, opt: { atmo: 1, hazeX: 0.9, base: 320 }, T: 9400 },
  { name: 'm-dwarf', pp: { massE: 0.9, radiusE: 0.98, Teq: 268 }, opt: { atmo: 0.8, hazeX: 1.3 }, T: 3100 },
  { name: 'airless', pp: { massE: 0.012, radiusE: 0.27, Teq: 270 }, opt: { atmo: 0, hazeX: 1 }, T: 5778 },
];

/**
 * One case is a colour, a shaded point, a camera and a sun. Distances are
 * log-uniform because the function's whole structure lives between 70 m and
 * 8 km and a uniform spread would put 99% of the samples in the saturated tail.
 */
function cases(n, seed) {
  const r = lcg(seed);
  const out = [];

  // the edges first, by hand — a random spread will not land on any of them
  const edges = [
    { d: 0, y: 0 }, { d: 70, y: 6 }, { d: 69.999, y: 6 }, { d: 70.001, y: 6 },
    { d: 1700, y: 100 }, { d: 8000, y: 100 }, { d: 1e5, y: 100 },
    { d: 400, y: 8 }, { d: 400, y: 46 }, { d: 400, y: 47 }, { d: 120, y: 10 },
    { d: 420, y: 10 }, { d: 300, y: -80 }, { d: 300, y: 1e4 },
  ];
  for (const e of edges) {
    out.push({ col: [0.18, 0.18, 0.18], dist: e.d, y: e.y, elev: 13.5, az: 0, phi: 0, theta: Math.PI / 2 });
  }

  while (out.length < n) {
    const dist = Math.exp(r() * (Math.log(2e4) - Math.log(0.1)) + Math.log(0.1));
    out.push({
      col: [r() * 2, r() * 2, r() * 2],
      dist,
      y: r() * 3050 - 50,
      elev: r() * 62 - 2,
      az: r() * Math.PI * 2,
      // the direction from the shaded point to the camera, uniform on the sphere
      phi: r() * Math.PI * 2,
      theta: Math.acos(2 * r() - 1),
    });
  }
  return out;
}

/** a case, expanded into the four vectors the chunk actually takes */
function expand(c) {
  const e = (c.elev * Math.PI) / 180;
  const sun = [Math.cos(e) * Math.cos(c.az), Math.sin(e), Math.cos(e) * Math.sin(c.az)];
  const V = [
    Math.sin(c.theta) * Math.cos(c.phi),
    Math.cos(c.theta),
    Math.sin(c.theta) * Math.sin(c.phi),
  ];
  const P = [0, c.y, 0];
  const camPos = [V[0] * c.dist, c.y + V[1] * c.dist, V[2] * c.dist];
  return { col: c.col, P, camPos, sun };
}

// ------------------------------------------------------------ the browser ---

/**
 * Runs inside the page. Takes the chunk verbatim, wraps it in the smallest
 * shader that can call it, and returns one RGBA per case.
 */
const RUN = ({ chunk, packed, count, worlds }) => {
  const cv = document.createElement('canvas');
  cv.width = 1; cv.height = 1;
  const gl = cv.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
  if (!gl) return { error: 'no webgl2' };
  if (!gl.getExtension('EXT_color_buffer_float')) return { error: 'no EXT_color_buffer_float' };

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || 'compile failed');
    }
    return s;
  };

  const VS = `#version 300 es
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;

  // The chunk, verbatim, plus the smallest main that can drive it. Row 0 of the
  // input texture is the colour, 1 the shaded point, 2 the camera, 3 the sun.
  const FS = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uCases;
    out vec4 oColor;
${chunk}
    void main() {
      int i = int(gl_FragCoord.x);
      vec3 col = texelFetch(uCases, ivec2(i, 0), 0).rgb;
      vec3 P   = texelFetch(uCases, ivec2(i, 1), 0).rgb;
      vec3 cam = texelFetch(uCases, ivec2(i, 2), 0).rgb;
      vec3 sun = texelFetch(uCases, ivec2(i, 3), 0).rgb;
      oColor = aerial(col, P, cam, sun);
    }`;

  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      return { error: 'link: ' + gl.getProgramInfoLog(prog) };
    }
  } catch (e) {
    return { error: 'compile: ' + e.message };
  }
  gl.useProgram(prog);

  // inputs
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, count, 4, 0, gl.RGBA, gl.FLOAT,
    new Float32Array(packed));
  gl.uniform1i(gl.getUniformLocation(prog, 'uCases'), 0);

  // a float target, so the comparison is not quantised by the instrument
  const out = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, out);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, count, 1, 0, gl.RGBA, gl.FLOAT, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    return { error: 'incomplete framebuffer' };
  }
  gl.viewport(0, 0, count, 1);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);

  const loc = (n) => gl.getUniformLocation(prog, n);
  const results = {};
  const buf = new Float32Array(count * 4);
  for (const w of worlds) {
    gl.uniform3f(loc('uAirHaze'), ...w.palette.haze);
    gl.uniform3f(loc('uAirMist'), ...w.palette.mist);
    gl.uniform3f(loc('uAirHorSun'), ...w.palette.horizonSun);
    gl.uniform3f(loc('uAirAnti'), ...w.palette.anti);
    gl.uniform1f(loc('uAirThickness'), w.air.thickness);
    gl.uniform1f(loc('uAirHazeScale'), w.air.hazeScale);
    gl.uniform1f(loc('uAirBase'), w.air.base);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, count, 1, gl.RGBA, gl.FLOAT, buf);
    results[w.name] = Array.from(buf);
  }

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    results,
    renderer: gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
  };
};

// ----------------------------------------------------------------- report ---

const TOL = 2 / 255;

function compare(name, gpu, cpu) {
  const n = cpu.length;
  let within = 0, maxErr = 0, maxAt = -1, maxWhat = '';
  let fogWithin = 0, fogMax = 0;
  let nonFinite = 0;

  for (let i = 0; i < n; i++) {
    const g = gpu.slice(i * 4, i * 4 + 4);
    const c = [...cpu[i].col, cpu[i].fog];
    if (!g.every(Number.isFinite)) { nonFinite++; continue; }

    let worst = 0, what = '';
    for (let k = 0; k < 3; k++) {
      const e = Math.abs(g[k] - c[k]);
      if (e > worst) { worst = e; what = 'rgb'[k]; }
    }
    if (worst <= TOL) within++;
    if (worst > maxErr) { maxErr = worst; maxAt = i; maxWhat = what; }

    const fe = Math.abs(g[3] - c[3]);
    if (fe <= TOL) fogWithin++;
    fogMax = Math.max(fogMax, fe);
  }
  return {
    name, n, nonFinite,
    colourPct: (within / n) * 100,
    fogPct: (fogWithin / n) * 100,
    maxErr, maxErr255: maxErr * 255, maxAt, maxWhat,
    fogMax, fogMax255: fogMax * 255,
  };
}

async function main() {
  const n = Number(arg('cases', 4096));
  const list = cases(n, 0x9e3779b9);
  const expanded = list.map(expand);

  // one Float32Array, laid out as the shader reads it: row-major, 4 rows
  const packed = new Float32Array(n * 4 * 4);
  for (let i = 0; i < n; i++) {
    const e = expanded[i];
    const put = (row, v) => {
      const o = (row * n + i) * 4;
      packed[o] = v[0]; packed[o + 1] = v[1]; packed[o + 2] = v[2]; packed[o + 3] = 0;
    };
    put(0, e.col); put(1, e.P); put(2, e.camPos); put(3, e.sun);
  }

  const worlds = WORLDS.map((w) => ({
    name: w.name,
    air: airFor(w.pp, w.opt),
    palette: w.T === 5778 ? REFERENCE_PALETTE : airPalette(w.T, 13.5),
  }));

  const pw = await playwright();
  const browser = await launch(pw);
  const page = await browser.newPage();
  await page.setContent('<!doctype html><meta charset=utf-8><title>pixeldiff</title>');
  const out = await page.evaluate(RUN, {
    chunk: AERIAL_GLSL, packed: Array.from(packed), count: n, worlds,
  });
  await browser.close();

  if (out.error) {
    console.error('pixeldiff · ' + out.error);
    process.exit(1);
  }

  console.log('pixeldiff · §9.3 · the GLSL chunk against its CPU twin');
  console.log('  driver: ' + out.renderer);
  console.log(`  ${n} cases per world · gate: >=97% within 2/255 (${TOL.toFixed(5)})\n`);

  const rows = [];
  let failed = 0;
  for (const w of worlds) {
    const cpu = expanded.map((e) => aerial(e.col, e.P, e.camPos, e.sun, w.air, w.palette));
    const r = compare(w.name, out.results[w.name], cpu);
    rows.push(r);
    const pass = r.colourPct >= 97 && r.fogPct >= 97 && r.nonFinite === 0;
    if (!pass) failed++;
    console.log(
      `  ${pass ? 'ok  ' : 'FAIL'} ${r.name.padEnd(9)}`
      + ` colour ${r.colourPct.toFixed(2)}%  fog ${r.fogPct.toFixed(2)}%`
      + `  max ${r.maxErr255.toFixed(4)}/255 (${r.maxWhat}, case ${r.maxAt})`
      + `  fog max ${r.fogMax255.toFixed(4)}/255`
      + (r.nonFinite ? `  NON-FINITE ${r.nonFinite}` : ''));
  }

  // §16.3(a)'s own check, and it is stronger than the 2/255 gate: on an airless
  // world the fog does not merely get small, it is *absent*.
  //
  // Stated against the shader's own output rather than as a CPU/GPU difference,
  // which is the form the claim actually has — and the only form that can be
  // exact. The CPU twin computes in float64 and the driver receives float32, so
  // a diff between them carries the input's own rounding and can never be zero
  // for an arbitrary colour. Comparing to `Math.fround` of the input asks the
  // real question: did the chunk return the colour it was given, untouched.
  {
    const g = out.results.airless;
    let worst = 0, fogWorst = 0;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) {
        worst = Math.max(worst, Math.abs(g[i * 4 + k] - Math.fround(expanded[i].col[k])));
      }
      fogWorst = Math.max(fogWorst, Math.abs(g[i * 4 + 3]));
    }
    const exact = worst === 0 && fogWorst === 0;
    if (!exact) failed++;
    console.log(`\n  ${exact ? 'ok  ' : 'FAIL'} airless returns the colour untouched and a fog of`
      + ` exactly 0 — bit-for-bit over all ${n} cases`
      + (exact ? '' : `  (worst colour ${worst.toExponential(2)}, worst fog ${fogWorst.toExponential(2)})`));
  }

  const json = arg('json');
  if (json) {
    const p = resolve(REPO, typeof json === 'string' ? json : 'docs/captures/pixeldiff.json');
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify({
      when: new Date().toISOString(), renderer: out.renderer, cases: n, tol: TOL, rows,
    }, null, 2) + '\n');
    console.log('  wrote ' + p);
  }

  console.log(`\n${failed ? failed + ' world(s) failed' : 'all ' + rows.length + ' worlds pass'}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
