// Global tone, which §8 never asks about — and which M2 spent 37% of.
//
//   node tools/tone.js [--seed 1337146641] [--builds "m2=1,m2=1&wash=1"]
//                      [--scale surface] [--tier low]
//
// §8's sixth axis asks whether anything clips and how many hue families there
// are. It does not ask what *range* the frame occupies, and §25 and §27.11 both
// measure mean `|∇luma|` inside hand-placed regions, which says nothing about
// the frame as a whole. Between them, three separate changes each took a fifth
// to a tenth of the image's contrast and each was signed off on its own
// evidence:
//
//   legacy                                      sd 39.0
//   the print and the rebuilt bloom             sd 34.1     −13%
//   §9.2's light model                          sd 27.1     −21%
//   airmat + wash                               sd 24.6      −9%
//
// Nobody was wrong at any single step. There was simply no number that carried
// across them, so this is that number. docs/plans/M2.md §30 has the argument.
//
// ---------------------------------------------------------------------------
// What it measures, and the two things it deliberately does not conclude
//
// Mean, standard deviation, saturation, floor, ceiling and a sixteen-bin luma
// histogram, over the frame with the HUD strips masked out — the left text
// block and the bottom hint row would otherwise contribute a fixed population
// of near-white pixels to every build equally, which flatters the range.
//
// It does **not** decide that low contrast is wrong. Three of the steps above
// are supposed to compress: §9.2's half-Lambert wrap exists to lift a grazed
// valley floor, §9.4's lift raises blacks by construction (§2.8), and the
// reference is a low-contrast painterly image by intent. A high standard
// deviation is not the goal.
//
// And it does not decide that a low ceiling is a cap. A frame facing away from
// the sun on an overcast world may simply contain nothing bright. The way to
// tell is the `--builds` sweep on a world with the sun in shot; if the ceiling
// holds at the same value there, the print is capping highlights and that is a
// defect worth chasing.
//
// What it is for is the comparison. Run it before and after a change that
// touches the light model, the print, the bloom or the air, and if a fifth of
// the frame's range has gone, it says so.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { decodePNG } from './png.js';
import { arg, launch, playwright, serve, TIERS, REPO } from './lib.js';

const seed = Number(arg('seed', 1337146641));
const tier = String(arg('tier', 'low'));
const builds = String(arg('builds', 'm2=1')).split(',').map((b) => b.trim()).filter(Boolean);

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
    if (app.halted > 0) return done('frames');
    if (performance.now() - t0 > capMs) { app.haltAt(app.frames); return done('timeout'); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

/**
 * Reduce a decoded frame. Node-side, from `page.screenshot()`, and the reason
 * is worth recording: reading the canvas in-page with `drawImage` returns
 * **black**, because the WebGL context is not created with
 * `preserveDrawingBuffer` and the drawing buffer is cleared once composited.
 * The first version of this tool did that and reported a perfectly confident
 * table of zeroes for every build.
 *
 * The HUD is a fixed population of near-white pixels in every build, so it
 * would flatter the range identically everywhere and hide the thing this
 * measures. Masked by region rather than by colour — a colour mask would also
 * eat any genuinely bright pixel in the scene, which is the half most at risk.
 */
function measure(png) {
  const { width: W, height: H, data: p } = png;
  const inFrame = (x, y) => !(x < W * 0.19 && y > H * 0.68) && y > H * 0.06 && y < H * 0.94;

  let n = 0, sum = 0, sum2 = 0, satSum = 0, minL = 1e9, maxL = -1e9, black = 0, white = 0;
  const hist = new Array(16).fill(0);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inFrame(x, y)) continue;
      const i = (y * W + x) * 4, r = p[i], g = p[i + 1], b = p[i + 2];
      const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      n++; sum += L; sum2 += L * L;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      satSum += mx === 0 ? 0 : (mx - mn) / mx;
      if (L < minL) minL = L;
      if (L > maxL) maxL = L;
      if (L < 1) black++;
      if (L > 254) white++;
      hist[Math.min(15, Math.floor(L / 16))]++;
    }
  }
  const mean = sum / n;
  return {
    W, H, n, mean, sd: Math.sqrt(sum2 / n - mean * mean), sat: satSum / n,
    minL, maxL, black: (black / n) * 100, white: (white / n) * 100, hist,
  };
}

// ------------------------------------------------------------------- main ---

const pw = await playwright();
const site = await serve();
const browser = await launch(pw);
const cfg = TIERS[tier] || TIERS.low;
const ctx = await browser.newContext({ viewport: cfg.viewport, deviceScaleFactor: 1 });
const page = await ctx.newPage();

await page.goto(`${site.origin}/index.html?seed=${seed}`, { waitUntil: 'load' });
await page.addScriptTag({ type: 'module', content: RESOLVE_ROUTE(site.origin) });
await page.waitForFunction('window.__route', null, { timeout: 60000 });
const route = await page.evaluate(() => window.__route);
const base = `seed=${seed}&g=${route.galaxySeed}&s=${route.starSeed}&p=${route.rocky}`;

const rows = [];
for (const b of builds) {
  // `dt` pinned, always: without it the day clock runs on wall time and two
  // "identical" frames have the sun in different places. That cost two people
  // real time before it was noticed (docs/plans/M2.md §24).
  await page.goto(`${site.origin}/index.html?${base}${b ? '&' + b : ''}&dt=16.667`,
    { waitUntil: 'load' });
  await page.waitForFunction('window.AEON && window.AEON.active()', null, { timeout: 60000 });
  await page.evaluate(SETTLE, [70, 240000]);
  rows.push({ build: b || '(default)', ...measure(decodePNG(await page.screenshot())) });
}
await browser.close();
await site.close();

console.log(`tone · seed ${seed} · ${rows[0].W}x${rows[0].H} · HUD masked\n`);
console.log('  build                          mean     sd    sat    min    max  range   =0%  =255%');
for (const r of rows) {
  console.log(`  ${r.build.slice(0, 28).padEnd(30)}`
    + `${r.mean.toFixed(1).padStart(5)} ${r.sd.toFixed(1).padStart(6)} ${r.sat.toFixed(3).padStart(6)}`
    + `${r.minL.toFixed(0).padStart(7)}${r.maxL.toFixed(0).padStart(7)}${(r.maxL - r.minL).toFixed(0).padStart(7)}`
    + `${r.black.toFixed(2).padStart(6)}${r.white.toFixed(2).padStart(7)}`);
}

if (rows.length > 1) {
  const a = rows[0], z = rows[rows.length - 1];
  const d = ((z.sd - a.sd) / a.sd) * 100;
  console.log(`\n  ${a.build}  →  ${z.build}`);
  console.log(`  standard deviation ${a.sd.toFixed(1)} → ${z.sd.toFixed(1)}`
    + `  (${d >= 0 ? '+' : ''}${d.toFixed(1)}%)`);
  console.log(d < -10
    ? '  A tenth of the frame\'s contrast or more. Say why in the commit.'
    : '  Within a tenth.');
}

console.log('\n  luma histogram, 16 bins of 16 (% of frame)\n');
console.log('   bin ' + rows.map((r) => r.build.slice(0, 9).padStart(10)).join(''));
for (let b = 0; b < 16; b++) {
  console.log(`  ${String(b * 16).padStart(4)} `
    + rows.map((r) => ((r.hist[b] / r.n) * 100).toFixed(2).padStart(10)).join(''));
}

const json = arg('json');
if (json) {
  const p = resolve(REPO, typeof json === 'string' ? json : 'docs/captures/tone.json');
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ when: new Date().toISOString(), seed, tier, rows }, null, 2) + '\n');
  console.log('\n  wrote ' + p);
}
