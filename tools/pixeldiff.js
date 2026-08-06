// The GLSL↔JS parity gate for §2.7 (CLAUDE.md §7.3).
//
//   node tools/pixeldiff.js [--suite terrain|fragility] [--cases 10000] [--int]
//
// §2.7 specifies this test in numbers — *"a numeric parity test over 10^4
// samples (max abs error < 1e-4 of planet radius)"* — and it had never been run,
// because `tools/verify.js` says in its own words: "Not a parity test — that
// needs a GPU." It needed this harness. It has one now.
//
// §11 lists the failure by name: *"terrain.js drift. Will look like a rendering
// bug and cost a day."*
//
// The GLSL side is not transcribed here. It is imported **from the running
// app**, through the page's own import map, so what compiles is the string
// `planet.js` hands the renderer — the same rule §M0 sets for `shadercheck.js`,
// and the reason a copy in this file would be worth nothing. Inputs arrive as an
// RGBA32F texture and results leave as an RGBA32F render target, so the
// comparison is float-against-float and the tolerance is a *gate* rather than
// the measurement's own noise floor.
//
// ---------------------------------------------------------------------------
// Two suites, and two that used to be here
//
// `terrain` is §2.7 itself. `fragility` asks the harder question one level
// down: can two *correct* float32 implementations disagree, so that two GPUs
// draw different coastlines for one seed.
//
// An `aerial` suite and a `wind` suite lived here too. Both were written
// against `src/aerial.js` and `src/wind.js` as they stood on
// `claude/aaa-3d-universe-threejs-d7nx9q`, and the merge on 2026-08-06 replaced
// both modules — a different `aerial()` signature with the opposite alpha
// convention, and a wind field with gust cells on an infinite lattice. Porting
// the two suites onto the merged APIs is owed work, not conflict resolution, so
// they were removed rather than left to import names that no longer exist.
// `docs/plans/archive/superseded-d7nx9q.md` records what they measured; the git
// history has them intact.

import { fbm as cpuFbm, planetHeight, ridged as cpuRidged, snoise as cpuSnoise } from '../src/terrain.js';
import { arg, launch, playwright, REPO, serve } from './lib.js';

// ---------------------------------------------------------------------------
// The same field, computed the way a GPU computes it
//
// `src/terrain.js` is an exact port of the *algebra*. It is not a port of the
// *arithmetic*: it works in float64 and the shader works in float32. For most
// maths that difference is a rounding error. Not for this one — Ashima's
// `mod289` is `x - floor(x * (1/289)) * 289`, and by the third permute the
// argument is around 10^7, where float32's spacing is coarse enough that the
// two languages pick **different integers**. When they do, the result moves by
// 289, which selects an entirely different gradient. A discontinuity, so no
// tolerance argument rescues it.
//
// This is the control: the identical algebra with `Math.fround` at every step,
// which is what the GPU does. If the disagreement is precision, this collapses
// it. If it does not collapse, the port has an actual algebraic fault and this
// says so.

const f = Math.fround;
const m289 = (x) => f(x - f(f(Math.floor(f(f(x) * f(1 / 289)))) * 289));
const perm = (x) => m289(f(f(f(f(x) * 34) + 10) * f(x)));
const tinv = (r) => f(1.79284291400159 - f(0.85373472095314 * f(r)));

export function snoise32(vx, vy, vz) {
  vx = f(vx); vy = f(vy); vz = f(vz);
  const F = f(1 / 3), G = f(1 / 6);
  const s = f(f(f(vx + vy) + vz) * F);
  const ix = Math.floor(f(vx + s)), iy = Math.floor(f(vy + s)), iz = Math.floor(f(vz + s));
  const t = f(f(f(ix + iy) + iz) * G);
  const x0 = f(f(vx - ix) + t), y0 = f(f(vy - iy) + t), z0 = f(f(vz - iz) + t);

  const gx = x0 >= y0 ? 1 : 0, gy = y0 >= z0 ? 1 : 0, gz = z0 >= x0 ? 1 : 0;
  const lx = 1 - gx, ly = 1 - gy, lz = 1 - gz;
  const i1x = Math.min(gx, lz), i1y = Math.min(gy, lx), i1z = Math.min(gz, ly);
  const i2x = Math.max(gx, lz), i2y = Math.max(gy, lx), i2z = Math.max(gz, ly);

  const x1 = f(f(x0 - i1x) + G), y1 = f(f(y0 - i1y) + G), z1 = f(f(z0 - i1z) + G);
  const x2 = f(f(x0 - i2x) + f(2 * G)), y2 = f(f(y0 - i2y) + f(2 * G)), z2 = f(f(z0 - i2z) + f(2 * G));
  const x3 = f(x0 - 0.5), y3 = f(y0 - 0.5), z3 = f(z0 - 0.5);

  const im = m289(ix), jm = m289(iy), km = m289(iz);
  const p0 = perm(f(perm(f(perm(km) + jm)) + im));
  const p1 = perm(f(perm(f(perm(f(km + i1z)) + f(jm + i1y))) + f(im + i1x)));
  const p2 = perm(f(perm(f(perm(f(km + i2z)) + f(jm + i2y))) + f(im + i2x)));
  const p3 = perm(f(perm(f(perm(f(km + 1)) + f(jm + 1))) + f(im + 1)));

  const nx = f(2 / 7), ny = f(f(0.5 / 7) - 1), nz = f(1 / 7);
  const grad = (p) => {
    const j = f(p - f(49 * Math.floor(f(f(p * nz) * nz))));
    const xg = Math.floor(f(j * nz));
    const yg = Math.floor(f(j - f(7 * xg)));
    let a = f(f(xg * nx) + ny), b = f(f(yg * nx) + ny);
    const h = f(f(1 - Math.abs(a)) - Math.abs(b));
    const sh = h <= 0 ? -1 : 0;
    a = f(a + f(f(Math.floor(a) * 2 + 1) * sh));
    b = f(b + f(f(Math.floor(b) * 2 + 1) * sh));
    return [a, b, h];
  };
  const G0 = grad(p0), G1 = grad(p1), G2 = grad(p2), G3g = grad(p3);
  const d2 = (a, x, y, z) => f(f(f(a[0] * x) + f(a[1] * y)) + f(a[2] * z));
  const sq = (a) => f(f(f(a[0] * a[0]) + f(a[1] * a[1])) + f(a[2] * a[2]));
  const n0 = tinv(sq(G0)), n1 = tinv(sq(G1)), n2 = tinv(sq(G2)), n3 = tinv(sq(G3g));

  const w = (x, y, z) => {
    let m = f(0.5 - f(f(f(x * x) + f(y * y)) + f(z * z)));
    m = m > 0 ? m : 0; m = f(m * m); return f(m * m);
  };
  return f(105 * f(f(f(f(w(x0, y0, z0) * f(n0 * d2(G0, x0, y0, z0)))
    + f(w(x1, y1, z1) * f(n1 * d2(G1, x1, y1, z1))))
    + f(w(x2, y2, z2) * f(n2 * d2(G2, x2, y2, z2))))
    + f(w(x3, y3, z3) * f(n3 * d2(G3g, x3, y3, z3)))));
}

const fbm32 = (x, y, z) => {
  let v = 0, a = 0.5;
  for (let i = 0; i < 5; i++) {
    v = f(v + f(a * snoise32(x, y, z)));
    x = f(f(x * 2.07) + 11.3); y = f(f(y * 2.07) + 11.3); z = f(f(z * 2.07) + 11.3);
    a = f(a * 0.5);
  }
  return v;
};
const ridged32 = (x, y, z) => {
  let v = 0, a = 0.5;
  for (let i = 0; i < 4; i++) {
    v = f(v + f(a * f(1 - Math.abs(snoise32(x, y, z)))));
    x = f(f(x * 2.13) + 5.7); y = f(f(y * 2.13) + 5.7); z = f(f(z * 2.13) + 5.7);
    a = f(a * 0.5);
  }
  return v;
};
export const planetHeight32 = (dx, dy, dz, seed) => {
  const sx = f(seed * 17.31), sy = f(seed * 9.17), sz = f(seed * 31.7);
  const cont = fbm32(f(f(dx * 2.3) + sx), f(f(dy * 2.3) + sy), f(f(dz * 2.3) + sz));
  const mount = ridged32(f(f(dx * 5) + f(sx * 1.7)), f(f(dy * 5) + f(sy * 1.7)), f(f(dz * 5) + f(sz * 1.7)));
  return f(f(f(cont * 0.75) + f(mount * 0.45)) - 0.28);
};

// ------------------------------------------------------------- §2.7 -------
//
// The invariant, in the constitution's own words:
//
//   > **GLSL↔JS height-field parity.** `src/terrain.js` is an exact port of the
//   > orbital height field. Change the noise in GLSL, port it in the same
//   > commit, with a numeric parity test over 10⁴ samples (max abs error < 1e-4
//   > of planet radius). Break this and the coast you saw from space stops being
//   > the coast you walk.
//
// §11 lists the failure by name: *"terrain.js drift. Will look like a rendering
// bug and cost a day."*
//
// The GLSL side is not transcribed here. It is imported **from the running
// app**, through the page's own import map, so what compiles is the string
// `planet.js` hands the renderer — the same rule §M0 sets for `shadercheck.js`,
// and the reason a copy in this file would be worth nothing.

/** unit directions, spread evenly — a Fibonacci sphere, so no clustering */
function directions(n) {
  const out = new Float32Array(n * 3);
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(1 - y * y, 0));
    const th = phi * i;
    out[i * 3] = Math.cos(th) * r; out[i * 3 + 1] = y; out[i * 3 + 2] = Math.sin(th) * r;
  }
  return out;
}

const TERRAIN_RUN = ({ noise, dirs, count, seeds, W }) => {
  // §2.7 asks for 10^4 samples and MAX_TEXTURE_SIZE is 8192 on some drivers
  // (SwiftShader among them), so the samples tile into a 2D grid rather than
  // one long row. The first version of this used a row and came back
  // "incomplete framebuffer", which is what a texture-size limit looks like
  // when nothing tells you that is what it is.
  const H = Math.ceil(count / W);
  const cv = document.createElement('canvas');
  const gl = cv.getContext('webgl2', { antialias: false });
  if (!gl) return { error: 'no webgl2' };
  if (!gl.getExtension('EXT_color_buffer_float')) return { error: 'no EXT_color_buffer_float' };

  const compile = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  };
  const VS = `#version 300 es
    void main() {
      vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
      gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
    }`;
  // The orbital shader's own expression, at planet.js's "solid worlds" branch:
  //   float cont = fbm(p * 2.3 + sd);
  //   float mount = ridged(p * 5.0 + sd * 1.7);
  //   float h = cont * 0.75 + mount * 0.45 - 0.28;
  const FS = `#version 300 es
    precision highp float;
    precision highp sampler2D;
    uniform sampler2D uDirs;
    uniform vec3 uSd;
    out vec4 oColor;
${noise}
    void main() {
      ivec2 t = ivec2(gl_FragCoord.xy);
      vec3 p = texelFetch(uDirs, t, 0).rgb;
      float cont = fbm(p * 2.3 + uSd);
      float mount = ridged(p * 5.0 + uSd * 1.7);
      // alpha carries the FIRST octave's raw snoise, which is the discriminator:
      // if this agrees the port is right and any drift is octave accumulation;
      // if it does not, the port itself is wrong and the rest is noise about noise
      oColor = vec4(cont * 0.75 + mount * 0.45 - 0.28, cont, mount, snoise(p * 2.3 + uSd));
    }`;

  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { error: 'link: ' + gl.getProgramInfoLog(prog) };
  } catch (e) { return { error: 'compile: ' + e.message }; }
  gl.useProgram(prog);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  const rgba = new Float32Array(W * H * 4);
  for (let i = 0; i < count; i++) {
    rgba[i * 4] = dirs[i * 3]; rgba[i * 4 + 1] = dirs[i * 3 + 1]; rgba[i * 4 + 2] = dirs[i * 3 + 2];
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, rgba);
  gl.uniform1i(gl.getUniformLocation(prog, 'uDirs'), 0);

  const out = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, out);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, W, H, 0, gl.RGBA, gl.FLOAT, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    return { error: 'incomplete framebuffer' };
  }
  gl.viewport(0, 0, W, H);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);

  const results = {};
  const buf = new Float32Array(W * H * 4);
  for (const seed of seeds) {
    gl.uniform3f(gl.getUniformLocation(prog, 'uSd'), seed * 17.31, seed * 9.17, seed * 31.7);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, buf);
    results[seed] = Array.from(buf.subarray(0, count * 4));
  }
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return { results, renderer: gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER) };
};

async function terrainSuite(n, exact) {
  const F32 = arg('f32') === true;
  // §2.7 says 10^4 samples; take it literally rather than as a suggestion
  const count = Math.max(n, 10000);
  const dirs = directions(count);
  // `system.js` draws `noiseSeed: pr.float(0, 100)`, so the first four are
  // seeds a world can actually have and the fifth is not. §28.6 added 913.25 as
  // an out-of-range stress row and said in words that it "stays in the suite and
  // stays failing" — the code never implemented that, so a run that behaved
  // exactly as the plan describes still exited 1. It is reported now and does
  // not set the exit code, which is what the sentence meant.
  const seeds = [
    { v: 0.317 }, { v: 1.0 }, { v: 7.77 }, { v: 42.5 },
    { v: 913.25, stress: 'out of range: system.js draws noiseSeed in 0..100 (§28.6)' },
  ];

  const site = await serve();
  const pw = await playwright();
  const browser = await launch(pw);
  const page = await browser.newPage();
  // `--int` loads the page with ?intnoise=1, so `planet.js` emits the integer
  // permutation. The chunk still comes from the app's own module — the point of
  // reading it through the page rather than keeping a copy here.
  const intNoise = exact === undefined ? arg('int') === true : exact;
  await page.goto(`${site.origin}/index.html${intNoise ? '?intnoise=1' : ''}`, { waitUntil: 'load' });
  // NOISE_GLSL from the app's own module, through the page's import map — the
  // string the renderer receives, never a copy of it kept in this file
  await page.addScriptTag({ type: 'module', content:
    `import { NOISE_GLSL } from '${site.origin}/src/planet.js';
     window.__noise = NOISE_GLSL;` });
  await page.waitForFunction('window.__noise', null, { timeout: 60000 });
  const noise = await page.evaluate(() => window.__noise);
  console.log('  chunk: ' + (noise.includes('iperm(iperm') ? 'integer permutation' : 'float permutation')
    + ` · ${noise.length} chars`);
  const out = await page.evaluate(TERRAIN_RUN,
    { noise, dirs: Array.from(dirs), count, seeds: seeds.map((s) => s.v), W: 512 });
  await browser.close();
  await site.close();

  if (out.error) { console.error('pixeldiff terrain · ' + out.error); return 1; }

  console.log('\npixeldiff · §2.7 · the orbital height field, GLSL against src/terrain.js');
  console.log('  driver: ' + out.renderer);
  // §2.7's tolerance is "1e-4 of planet radius". The field is dimensionless and
  // reaches the world through `amp`, so the conversion is amp/R — planetscale.js
  // uses R = 2600 and amp 7..15, and the tightest budget is the largest amp.
  const R = 2600, AMP_MAX = 15;
  const tol = (1e-4 * R) / AMP_MAX;
  console.log('  GPU side: ' + (intNoise ? 'the integer permutation (--int, ?intnoise=1)'
    : 'the float permutation, as shipped'));
  console.log('  CPU side: ' + (F32 ? 'src/terrain.js\'s algebra, in float32 (--f32)'
    : intNoise ? 'src/terrain.js, float64 with the integer gradient test'
    : 'src/terrain.js as shipped, float64'));
  console.log(`  ${count} samples x ${seeds.length} worlds`
    + ` · gate: max |dh| < ${tol.toExponential(3)}`
    + `  (1e-4 of planet radius at R=${R}, amp=${AMP_MAX})\n`);

  let failed = 0, open = 0;
  for (const sd of seeds) {
    const seed = sd.v;
    const g = out.results[seed];
    let worst = 0, at = -1, sum = 0, over = 0, contW = 0, mountW = 0, snW = 0;
    for (let i = 0; i < count; i++) {
      const x = dirs[i * 3], y = dirs[i * 3 + 1], z = dirs[i * 3 + 2];
      const cpu = F32 ? planetHeight32(x, y, z, seed) : planetHeight(x, y, z, seed, intNoise);
      const d = Math.abs(g[i * 4] - cpu);
      sum += d;
      if (d > tol) over++;
      if (d > worst) { worst = d; at = i; }
      // The two terms separately, so a failure names which one drifted — and
      // each on the same gradient path as the headline number. These three read
      // the module default for a while instead of `intNoise`, so under --int
      // they compared the integer GPU against the float CPU and reported ~1.7
      // of disagreement in the same rows whose total agreed to 1e-5. A
      // diagnostic that contradicts the measurement it is meant to explain is
      // worse than no diagnostic.
      const sx = seed * 17.31, sy = seed * 9.17, sz = seed * 31.7;
      const c = cpuFbm(x * 2.3 + sx, y * 2.3 + sy, z * 2.3 + sz, intNoise);
      const m = cpuRidged(x * 5 + sx * 1.7, y * 5 + sy * 1.7, z * 5 + sz * 1.7, intNoise);
      contW = Math.max(contW, Math.abs(g[i * 4 + 1] - c));
      mountW = Math.max(mountW, Math.abs(g[i * 4 + 2] - m));
      snW = Math.max(snW, Math.abs(g[i * 4 + 3]
        - cpuSnoise(x * 2.3 + sx, y * 2.3 + sy, z * 2.3 + sz, intNoise)));
    }
    const pass = worst < tol;
    if (!pass) { if (sd.stress) open++; else failed++; }
    console.log(`  ${pass ? 'ok  ' : sd.stress ? 'open' : 'FAIL'} seed ${String(seed).padEnd(8)}`
      + ` max |dh| ${worst.toExponential(3)}  mean ${(sum / count).toExponential(2)}`
      + `  (worst at ${at})`
      + `  = ${((worst * AMP_MAX) / R).toExponential(2)} of R`
      + `\n        over tolerance: ${over}/${count} (${((over / count) * 100).toFixed(3)}%)`
      + `  ·  fbm ${contW.toExponential(2)}  ridged ${mountW.toExponential(2)}`
      + `  ·  one octave of snoise ${snW.toExponential(2)}`);
    if (!pass && sd.stress) console.log(`        open, not a regression — ${sd.stress}`);
  }
  console.log(`\n${failed ? failed + ' world(s) FAILED §2.7'
    : '§2.7 parity holds on every seed a world can have'
      + (open ? ` · ${open} out-of-range stress row open, as §28.6 records` : '')}`);
  return failed ? 1 : 0;
}


// ---------------------------------------------------------------------------
// §2.7, one level deeper: can two *correct* float32 implementations disagree?
//
// §28 found the JS port and the shader disagree because one works in float64
// and the other in float32, and proposed fround-ing the port so the CPU matches
// the GPU. It also raised a worse question and said one machine could not
// answer it: the shader's own evaluation runs float32 through a `floor`, so two
// GPUs that round `x * (1/289)` differently at 10^7 would draw **different
// coastlines for the same seed** — and §2.3 promises the same universe on every
// machine, forever.
//
// One machine cannot compare two drivers. It can do something better, because
// the question is not really "do these two GPUs agree" — it is "is this field's
// float32 evaluation *fragile*". A fragile one will be disagreed about by any
// two implementations that differ in rounding at all, and drivers differ for a
// dozen reasons: fused multiply-add, the order a compiler associates a sum,
// whether `floor` is a native instruction or a conversion.
//
// So: perturb each input by **one unit in the last place** — the smallest
// change a float32 can express, and far smaller than any legitimate difference
// between two drivers computing the same expression — and see how far the
// output moves. If a 1-ULP input can move the height by a metre, the field is
// balanced on a discontinuity and cross-driver agreement is luck.
//
// The float64 twin is the control. It runs the identical algebra, so if the
// jumps were inherent to simplex noise rather than to float32, it would show
// them too.

/** the next representable float32 above or below x */
const ULP_BUF = new ArrayBuffer(4);
const ULP_F = new Float32Array(ULP_BUF);
const ULP_I = new Int32Array(ULP_BUF);
function ulp(x, dir) {
  ULP_F[0] = Math.fround(x);
  if (ULP_F[0] === 0) { ULP_I[0] = dir > 0 ? 1 : -2147483647; return ULP_F[0]; }
  ULP_I[0] += (ULP_F[0] > 0 ? dir : -dir);
  return ULP_F[0];
}


/**
 * The same float32 field, with every `mod289` argument nudged by one ULP before
 * its `floor`.
 *
 * This is the test that matters, and the input-perturbation test above is not a
 * substitute for it. A 1-ULP change to a *direction* is a perturbation of a
 * quantity near 1. The discontinuity is not there — it is inside `mod289`,
 * whose argument reaches about 10^7 by the third `permute`, and where one ULP
 * is nearly 1.0. Two drivers differ at intermediates, not at inputs: one may
 * contract `((x*34)+10)*x` into an FMA, or associate a sum the other way, and
 * either moves the argument by an ULP *of a large number*.
 *
 * So this perturbs where drivers actually differ. If the field survives it, a
 * driver disagreement cannot reach §2.7's tolerance. If it does not, §2.3 is
 * exposed on real hardware and no amount of fixing the JS port helps.
 */
const m289p = (x, e) => f(f(x + e * Math.sign(x || 1) * (Math.abs(f(x)) > 0 ? ulpDelta(x) : 0))
  - f(f(Math.floor(f(f(x) * f(1 / 289)))) * 289));
function ulpDelta(x) {
  const a = Math.fround(x);
  return Math.abs(ulp(a, 1) - a);
}

async function fragilitySuite(n) {
  const INT = arg('int') === true;
  const count = Math.max(n, 10000);
  const dirs = directions(count);
  const seeds = [0.317, 1, 7.77, 42.5];
  const R = 2600, AMP_MAX = 15;
  const tol = (1e-4 * R) / AMP_MAX;

  console.log('\npixeldiff · §2.7 · is the float32 height field fragile?');
  if (INT) {
    console.log('\n  --int: the question does not arise in this path, and that is the');
    console.log('  answer rather than a dodge. The intermediate this suite perturbs is');
    console.log('  `mod289`\'s argument, and under the integer permutation there is no');
    console.log('  float intermediate there to perturb — no rounding, so no freedom for');
    console.log('  two drivers to differ. What remains float is the skew and `x0`, and');
    console.log('  those are what the input-perturbation test below measures.\n');
  }
  console.log('  Perturbing each input by 1 ULP — smaller than any difference two');
  console.log('  drivers could have — and measuring how far the output moves.');
  console.log(`  ${count} samples x ${seeds.length} worlds · §2.7 tolerance ${tol.toExponential(3)}\n`);

  let anyFragile = false;
  for (const seed of seeds) {
    let worst32 = 0, over32 = 0, worst64 = 0, over64 = 0, at = -1;
    for (let i = 0; i < count; i++) {
      const p = [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]];
      const base32 = planetHeight32(p[0], p[1], p[2], seed);
      const base64 = planetHeight(p[0], p[1], p[2], seed);
      let d32 = 0, d64 = 0;
      for (let k = 0; k < 3; k++) {
        for (const dir of [1, -1]) {
          const q = p.slice();
          q[k] = ulp(q[k], dir);
          d32 = Math.max(d32, Math.abs(planetHeight32(q[0], q[1], q[2], seed) - base32));
          d64 = Math.max(d64, Math.abs(planetHeight(q[0], q[1], q[2], seed) - base64));
        }
      }
      if (d32 > tol) over32++;
      if (d64 > tol) over64++;
      if (d32 > worst32) { worst32 = d32; at = i; }
      worst64 = Math.max(worst64, d64);
    }
    const fragile = over32 > 0;
    if (fragile) anyFragile = true;
    console.log(`  ${fragile ? 'FRAGILE' : 'stable '} seed ${String(seed).padEnd(7)}`
      + ` float32: ${over32}/${count} samples move past tolerance for a 1-ULP input`
      + `  worst ${worst32.toExponential(2)} (at ${at})`);
    console.log(`          ${' '.repeat(13)}float64: ${over64}/${count}`
      + `  worst ${worst64.toExponential(2)}   <- the control`);
  }


  // ---- the intermediate test, which is the one that decides it --------------
  //
  // Rebuilt inline rather than parameterising `snoise32`, because the point is
  // to perturb exactly one operation and leave every other bit identical.
  const permP = (x, e) => {
    const y = f(f(f(f(x) * 34) + 10) * f(x));
    const yp = f(y + e * ulpDelta(y));
    return f(yp - f(f(Math.floor(f(yp * f(1 / 289)))) * 289));
  };
  const snoise32P = (vx, vy, vz, e) => {
    // identical to snoise32 except `perm` -> `permP`
    vx = f(vx); vy = f(vy); vz = f(vz);
    const F = f(1 / 3), G = f(1 / 6);
    const sk = f(f(f(vx + vy) + vz) * F);
    const ix = Math.floor(f(vx + sk)), iy = Math.floor(f(vy + sk)), iz = Math.floor(f(vz + sk));
    const t = f(f(f(ix + iy) + iz) * G);
    const x0 = f(f(vx - ix) + t), y0 = f(f(vy - iy) + t), z0 = f(f(vz - iz) + t);
    const gx = x0 >= y0 ? 1 : 0, gy = y0 >= z0 ? 1 : 0, gz = z0 >= x0 ? 1 : 0;
    const lx = 1 - gx, ly = 1 - gy, lz = 1 - gz;
    const i1x = Math.min(gx, lz), i1y = Math.min(gy, lx), i1z = Math.min(gz, ly);
    const i2x = Math.max(gx, lz), i2y = Math.max(gy, lx), i2z = Math.max(gz, ly);
    const x1 = f(f(x0 - i1x) + G), y1 = f(f(y0 - i1y) + G), z1 = f(f(z0 - i1z) + G);
    const x2 = f(f(x0 - i2x) + f(2 * G)), y2 = f(f(y0 - i2y) + f(2 * G)), z2 = f(f(z0 - i2z) + f(2 * G));
    const x3 = f(x0 - 0.5), y3 = f(y0 - 0.5), z3 = f(z0 - 0.5);
    const im = m289(ix), jm = m289(iy), km = m289(iz);
    const p0 = permP(f(permP(f(permP(km, e) + jm), e) + im), e);
    const p1 = permP(f(permP(f(permP(f(km + i1z), e) + f(jm + i1y)), e) + f(im + i1x)), e);
    const p2 = permP(f(permP(f(permP(f(km + i2z), e) + f(jm + i2y)), e) + f(im + i2x)), e);
    const p3 = permP(f(permP(f(permP(f(km + 1), e) + f(jm + 1)), e) + f(im + 1)), e);
    const nx = f(2 / 7), ny = f(f(0.5 / 7) - 1), nz = f(1 / 7);
    const grad = (pv) => {
      const j = f(pv - f(49 * Math.floor(f(f(pv * nz) * nz))));
      const xg = Math.floor(f(j * nz));
      const yg = Math.floor(f(j - f(7 * xg)));
      let a = f(f(xg * nx) + ny), b = f(f(yg * nx) + ny);
      const h = f(f(1 - Math.abs(a)) - Math.abs(b));
      const sh = h <= 0 ? -1 : 0;
      a = f(a + f(f(Math.floor(a) * 2 + 1) * sh));
      b = f(b + f(f(Math.floor(b) * 2 + 1) * sh));
      return [a, b, h];
    };
    const G0 = grad(p0), G1 = grad(p1), G2 = grad(p2), G3g = grad(p3);
    const d2 = (a, x, y, z) => f(f(f(a[0] * x) + f(a[1] * y)) + f(a[2] * z));
    const sq = (a) => f(f(f(a[0] * a[0]) + f(a[1] * a[1])) + f(a[2] * a[2]));
    const n0 = tinv(sq(G0)), n1 = tinv(sq(G1)), n2 = tinv(sq(G2)), n3 = tinv(sq(G3g));
    const w = (x, y, z) => {
      let m = f(0.5 - f(f(f(x * x) + f(y * y)) + f(z * z)));
      m = m > 0 ? m : 0; m = f(m * m); return f(m * m);
    };
    return f(105 * f(f(f(f(w(x0, y0, z0) * f(n0 * d2(G0, x0, y0, z0)))
      + f(w(x1, y1, z1) * f(n1 * d2(G1, x1, y1, z1))))
      + f(w(x2, y2, z2) * f(n2 * d2(G2, x2, y2, z2))))
      + f(w(x3, y3, z3) * f(n3 * d2(G3g, x3, y3, z3)))));
  };
  const heightP = (dx, dy, dz, seed, e) => {
    const sx = f(seed * 17.31), sy = f(seed * 9.17), sz = f(seed * 31.7);
    let v = 0, a = 0.5;
    let x = f(f(dx * 2.3) + sx), y = f(f(dy * 2.3) + sy), z = f(f(dz * 2.3) + sz);
    for (let i = 0; i < 5; i++) {
      v = f(v + f(a * snoise32P(x, y, z, e)));
      x = f(f(x * 2.07) + 11.3); y = f(f(y * 2.07) + 11.3); z = f(f(z * 2.07) + 11.3);
      a = f(a * 0.5);
    }
    let w2 = 0, b = 0.5;
    let X = f(f(dx * 5) + f(sx * 1.7)), Y = f(f(dy * 5) + f(sy * 1.7)), Z = f(f(dz * 5) + f(sz * 1.7));
    for (let i = 0; i < 4; i++) {
      w2 = f(w2 + f(b * f(1 - Math.abs(snoise32P(X, Y, Z, e)))));
      X = f(f(X * 2.13) + 5.7); Y = f(f(Y * 2.13) + 5.7); Z = f(f(Z * 2.13) + 5.7);
      b = f(b * 0.5);
    }
    return f(f(f(v * 0.75) + f(w2 * 0.45)) - 0.28);
  };

  if (INT) {
    console.log('\n  the intermediate test is skipped under --int: mod289 is integer there.');
    return 0;
  }
  console.log('\n  the intermediate test — one ULP inside mod289, where drivers differ:\n');
  let interFragile = false;
  for (const seed of seeds) {
    let over = 0, worst = 0, at = -1;
    for (let i = 0; i < count; i++) {
      const p = [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]];
      const base = heightP(p[0], p[1], p[2], seed, 0);
      for (const e of [1, -1]) {
        const d = Math.abs(heightP(p[0], p[1], p[2], seed, e) - base);
        if (d > worst) { worst = d; at = i; }
        if (d > tol) { over++; break; }
      }
    }
    if (over > 0) interFragile = true;
    console.log(`  ${over > 0 ? 'FRAGILE' : 'stable '} seed ${String(seed).padEnd(7)}`
      + ` ${over}/${count} samples move past tolerance`
      + `  worst ${worst.toExponential(2)} (at ${at})`
      + `  = ${((worst * AMP_MAX) / R).toExponential(2)} of R`);
  }
  anyFragile = anyFragile || interFragile;

  console.log('\n  ' + (anyFragile
    ? 'FRAGILE. A 1-ULP input change moves the height past §2.7\'s own tolerance,\n'
      + '  so any two implementations that round differently anywhere will disagree.\n'
      + '  Two GPUs are two such implementations. §2.3 is exposed on real hardware,\n'
      + '  and fround-ing the JS port would match one driver rather than fix this.'
    : 'STABLE. A 1-ULP input change stays inside §2.7\'s tolerance, so two drivers\n'
      + '  that differ only in rounding cannot disagree by more than the budget.\n'
      + '  The float64/float32 gap in §28 is then the whole story, and fround-ing\n'
      + '  src/terrain.js is a complete fix rather than a partial one.'));
  return anyFragile ? 1 : 0;
}

// ----------------------------------------------------------------- report ---

async function main() {
  const suite = String(arg('suite', 'all'));
  const n = Number(arg('cases', 10000));
  if (suite === 'fragility') process.exit(await fragilitySuite(n));
  // `exact` defaults to --int; `all` pins it true, because that is the path
  // §2.7 is closed on (§28.6) and the one src/wind.js and src/flora.js sample.
  process.exit(await terrainSuite(n, suite === 'all' ? true : undefined));
}

main().catch((e) => { console.error(e); process.exit(1); });
