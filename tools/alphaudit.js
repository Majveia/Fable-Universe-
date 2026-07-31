// §9.3's alpha channel, audited from outside the app.
//
//   node tools/alphaudit.js [--seed 1337146641] [--extra "solve=1"] [--png <path>]
//
// docs/plans/M2.md §16.5 makes this a gate: step 4 of act 2 passes when *"alpha
// survives to the print unmodified"*. §16.6 says what threatens it —
//
//   > The fog fraction is written by *fragment* shaders, so anything drawn
//   > without `aerial()` writes garbage into alpha. Audit every surface-scale
//   > material in step 4. A sky dome writing `a = 0` is correct; a sky dome
//   > writing `a = 1` reads as maximally distant, which is also correct — but
//   > it has to be a decision, not an accident.
//
// The audit cannot live behind a debug flag in `surface.js`, because the
// materials that would corrupt alpha are exactly the ones that do not have the
// flag. It has to read the **composited** channel, after every draw. So this
// renders the live scene into a float target and reads it back.
//
// ---------------------------------------------------------------------------
// What it can and cannot prove
//
// Alpha is written by every material, but only blending decides whether a later
// draw *replaces* it or *accumulates* into it. Three's preset `AdditiveBlending`
// is `(SRC_ALPHA, ONE)` applied to alpha as well as to colour, so an additive
// sprite adds `a·a` to whatever was underneath. That is the corruption to look
// for, and it shows up as alpha above 1 — which is why the target is float and
// the histogram deliberately extends past 1.0.
//
// It reports the distribution and names the worst offenders by screen region.
// It does not attribute a bad pixel to a material; for that, disable a draw and
// re-run. The point is to make "nothing writes garbage" a measured statement
// rather than an assumed one.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { arg, launch, playwright, serve, TIERS, REPO } from './lib.js';

const seed = Number(arg('seed', 1337146641));
const extra = arg('extra', '');
const tier = String(arg('tier', 'low'));

const RESOLVE_ROUTE = (origin) => `
  import { hash } from '${origin}/src/rng.js';
  import { galaxyParams } from '${origin}/src/galaxy.js';
  import { systemParams } from '${origin}/src/system.js';
  const galaxySeed = hash(${seed}, 0xbe0) >>> 0;
  const gp = galaxyParams(galaxySeed);
  for (let i = 0; i < 4096; i++) {
    const starSeed = hash(gp.seed, i, 0x57a9) >>> 0;
    const sp = systemParams(starSeed);
    const rocky = sp.planets.findIndex(p => p.typeId <= 4);
    if (rocky >= 0) { window.__route = { galaxySeed, starSeed, rocky }; break; }
  }
`;

const SETTLE = ([n, capMs]) => new Promise((done) => {
  const app = window.AEON;
  const t0 = performance.now();
  const start = app.frames;
  app.haltAt(start + n);
  const tick = () => {
    if (app.halted > 0) return done({ frames: app.halted - start, by: 'frames' });
    if (performance.now() - t0 > capMs) { app.haltAt(app.frames); return done({ frames: app.frames - start, by: 'timeout' }); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

/**
 * Re-render the settled scene into a float target and read the alpha back.
 *
 * Rendering it a second time rather than reading the composer's own buffer is
 * deliberate: the composer's targets are half-float and ping-ponged, so which
 * one holds the scene depends on how many passes ran, and the readback type
 * would have to track the target's. A float target of our own is unambiguous,
 * and the scene is a pure function of its state — it is the same frame.
 */
const PROBE = async (origin) => {
  const THREE = await import(`${origin}/vendor/three.module.js`);
  const app = window.AEON;
  const s = app.active();
  const size = app.renderer.getSize(new THREE.Vector2());
  const w = Math.min(Math.round(size.x), 960);
  const h = Math.min(Math.round(size.y), 540);

  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: true, stencilBuffer: false,
  });
  const prevTarget = app.renderer.getRenderTarget();
  app.renderer.setRenderTarget(rt);
  app.renderer.clear(true, true, true);
  app.renderer.render(s.scene, s.camera);
  const buf = new Float32Array(w * h * 4);
  app.renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);
  app.renderer.setRenderTarget(prevTarget);
  rt.dispose();

  // histogram over [0,1] in 20 bins, plus the two tails that are the finding
  const bins = new Array(20).fill(0);
  let below = 0, above = 0, nan = 0, n = 0;
  let minA = Infinity, maxA = -Infinity;
  // where the offenders are: an 8x8 grid of the frame, counting bad pixels
  const GX = 8, GY = 8;
  const grid = new Array(GX * GY).fill(0);
  // and the fog's spatial coherence: alpha should rise smoothly toward the
  // horizon, so the biggest vertical neighbour step is a shape check
  let worstStep = 0, worstAt = null;

  const A = (x, y) => buf[(y * w + x) * 4 + 3];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = A(x, y);
      n++;
      if (a !== a) { nan++; grid[(Math.floor(y / h * GY)) * GX + Math.floor(x / w * GX)]++; continue; }
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
      if (a < 0) { below++; grid[(Math.floor(y / h * GY)) * GX + Math.floor(x / w * GX)]++; }
      else if (a > 1) { above++; grid[(Math.floor(y / h * GY)) * GX + Math.floor(x / w * GX)]++; }
      else bins[Math.min(19, Math.floor(a * 20))]++;
      if (y > 0) {
        const d = Math.abs(a - A(x, y - 1));
        if (d > worstStep && d === d) { worstStep = d; worstAt = [x, y]; }
      }
    }
  }

  // a greyscale PNG-able dump of the channel, downsampled, for looking at
  const SW = 240, SH = 135;
  const thumb = new Uint8Array(SW * SH);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const a = A(Math.floor((x / SW) * w), Math.floor((y / SH) * h));
      thumb[y * SW + x] = a === a ? Math.max(0, Math.min(255, Math.round(a * 255))) : 255;
    }
  }

  return {
    kind: s.kind, w, h, n, nan, below, above, minA, maxA, bins, grid, GX, GY,
    worstStep, worstAt, thumb: Array.from(thumb), SW, SH,
  };
};

// ------------------------------------------------------------------ main ---

const pw = await playwright();
const site = await serve();
const browser = await launch(pw);
const cfg = TIERS[tier] || TIERS.low;
const ctx = await browser.newContext({ viewport: cfg.viewport, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

await page.goto(`${site.origin}/index.html?seed=${seed}`, { waitUntil: 'load' });
await page.addScriptTag({ type: 'module', content: RESOLVE_ROUTE(site.origin) });
await page.waitForFunction('window.__route', null, { timeout: 60000 });
const route = await page.evaluate(() => window.__route);

const url = `${site.origin}/index.html?seed=${seed}&g=${route.galaxySeed}`
  + `&s=${route.starSeed}&p=${route.rocky}${extra ? '&' + extra : ''}`;
console.log('alphaudit · ' + url + '\n');
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction('window.AEON && window.AEON.active()', null, { timeout: 60000 });
const settle = await page.evaluate(SETTLE, [90, 240000]);
const r = await page.evaluate(PROBE, site.origin);
await browser.close();
await site.close();

if (errors.length) console.log('page errors:\n  ' + errors.slice(0, 4).join('\n  ') + '\n');

console.log(`  scale ${r.kind} · ${r.w}x${r.h} · settled by ${settle.by} after ${settle.frames} frames\n`);
console.log(`  alpha range [${r.minA.toFixed(5)}, ${r.maxA.toFixed(5)}]`);

const pct = (v) => ((v / r.n) * 100).toFixed(3) + '%';
console.log(`  NaN        ${r.nan} (${pct(r.nan)})`);
console.log(`  below 0    ${r.below} (${pct(r.below)})`);
console.log(`  above 1    ${r.above} (${pct(r.above)})`);

console.log('\n  distribution of the fog fraction:');
const peak = Math.max(...r.bins);
for (let i = 0; i < r.bins.length; i++) {
  const lo = (i / 20).toFixed(2), hi = ((i + 1) / 20).toFixed(2);
  const bar = '#'.repeat(Math.round((r.bins[i] / Math.max(peak, 1)) * 44));
  console.log(`   ${lo}-${hi} ${String(pct(r.bins[i])).padStart(8)} ${bar}`);
}

if (r.above + r.below + r.nan > 0) {
  console.log('\n  where the out-of-range pixels are (8x8 grid, % of each cell):');
  for (let gy = 0; gy < r.GY; gy++) {
    const cells = [];
    for (let gx = 0; gx < r.GX; gx++) {
      const c = r.grid[gy * r.GX + gx];
      const cellN = (r.w / r.GX) * (r.h / r.GY);
      cells.push(c === 0 ? '    .' : ((c / cellN) * 100).toFixed(1).padStart(5));
    }
    console.log('   ' + cells.join(' '));
  }
}

console.log(`\n  largest vertical neighbour step: ${r.worstStep.toFixed(4)}`
  + (r.worstAt ? ` at (${r.worstAt[0]}, ${r.worstAt[1]})` : ''));

const png = arg('png');
if (png) {
  // A P5 PGM is a short ASCII header and the bytes — the whole encoder, and no
  // reason to reach for one. `tools/png.js` only decodes.
  const p = resolve(REPO, typeof png === 'string' ? png : 'docs/captures/alpha.pgm');
  await mkdir(dirname(p), { recursive: true });
  const header = Buffer.from(`P5\n${r.SW} ${r.SH}\n255\n`, 'ascii');
  await writeFile(p, Buffer.concat([header, Buffer.from(r.thumb)]));
  console.log('  wrote ' + p);
}

const clean = r.nan === 0 && r.below === 0 && r.above === 0;
console.log(`\n  ${clean ? 'ok  ' : 'FAIL'} alpha carries only the fog fraction`
  + (clean ? ' — nothing outside [0,1], no NaN' : ' — something drawn without aerial() is writing into it'));
process.exit(clean ? 0 : 1);
