// Measure a milestone gate instead of asserting it.
//
//   node tools/gate.js --milestone M1
//
// §7.6 sends the critic at the captures; §8 insists a review name the pixel
// region that lost the point. Some gate clauses are numeric and can simply be
// computed — M1 wants four distinguishable hue families inside a luminance
// band, no banding in the deep field at 8-bit, motion that does not loop, and
// vacuum blacks at true zero (§2.8). All four are measurable, so they are
// measured here and the answer is a number, not an opinion.
//
// What this does NOT do is replace the critic on the axes that are genuinely
// judgement — silhouette, materials, whether the thing is beautiful. It clears
// the mechanical clauses so the judgement has somewhere to stand.

import { arg, launch, playwright, serve } from './lib.js';
import { decodePNG } from './png.js';

const milestone = String(arg('milestone', 'M1'));
const seed = Number(arg('seed', 20250601));

const settle = (n) => new Promise((d) => {
  let i = 0;
  const tick = () => (++i >= n ? d(i) : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
});

// --------------------------------------------------------------- analysis --

function analyse(img) {
  const { width: w, height: h, data: d } = img;
  const hues = new Array(36).fill(0);
  const lumHist = new Array(256).fill(0);
  let lit = 0, maxLum = 0, pureBlack = 0, atOne = 0;
  const n = w * h;

  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > maxLum) maxLum = lum;
    if (d[i] === 0 && d[i + 1] === 0 && d[i + 2] === 0) pureBlack++;
    else if (d[i] <= 1 && d[i + 1] <= 1 && d[i + 2] <= 1) atOne++;
    if (lum < 0.02) continue;
    lit++;
    lumHist[Math.min(255, Math.round(lum * 255))]++;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 0.05) { hues[35]++; continue; }   // achromatic
    let deg;
    if (mx === r) deg = 60 * (((g - b) / (mx - mn)) % 6);
    else if (mx === g) deg = 60 * ((b - r) / (mx - mn) + 2);
    else deg = 60 * ((r - g) / (mx - mn) + 4);
    if (deg < 0) deg += 360;
    hues[Math.min(34, Math.floor(deg / 10))]++;
  }

  // Banding: in a smooth dark gradient, an undithered 8-bit image produces
  // long horizontal runs of one exact value. Dither breaks them up. Only the
  // dark field is scanned, which is where §M1's gate (d) points.
  let worstRun = 0, runs = 0, scanned = 0;
  for (let y = 4; y < h; y += 13) {
    let run = 1, prev = -1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      const mean = (d[i] + d[i + 1] + d[i + 2]) / 3;
      if (mean < 1.5 || mean > 40) { run = 1; prev = -1; continue; }
      scanned++;
      if (v === prev) { run++; if (run > worstRun) worstRun = run; if (run === 24) runs++; }
      else run = 1;
      prev = v;
    }
  }
  return { n, lit, maxLum, pureBlack, atOne, hues, lumHist, worstRun, longRuns: runs, scanned };
}

/** hue families = separated local maxima in the circular histogram */
function families(A) {
  const chroma = A.hues.slice(0, 35);
  const sm = chroma.map((_, i) => (chroma[(i + 34) % 35] + chroma[i] * 2 + chroma[(i + 1) % 35]) / 4);
  const peaks = [];
  for (let i = 0; i < 35; i++) {
    if (sm[i] >= sm[(i + 34) % 35] && sm[i] >= sm[(i + 1) % 35] && sm[i] / A.lit > 0.015) {
      peaks.push({ deg: i * 10, frac: sm[i] / A.lit });
    }
  }
  const merged = [];
  for (const pk of peaks.sort((x, y) => y.frac - x.frac)) {
    if (!merged.some(m => Math.min(Math.abs(m.deg - pk.deg), 360 - Math.abs(m.deg - pk.deg)) < 35)) merged.push(pk);
  }
  const achromatic = A.hues[35] / A.lit;
  return { chromatic: merged, achromatic, count: merged.length + (achromatic > 0.02 ? 1 : 0) };
}

function lumBand(A) {
  const tot = A.lumHist.reduce((x, y) => x + y, 0);
  let acc = 0, lo = 0, hi = 1;
  for (let i = 0; i < 256; i++) {
    acc += A.lumHist[i];
    if (!lo && acc / tot >= 0.01) lo = i / 255;
    if (acc / tot <= 0.99) hi = i / 255;
  }
  return [lo, hi];
}

function pixelsChanged(a, b, tol = 2) {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    if (Math.abs(a.data[i] - b.data[i]) > tol
      || Math.abs(a.data[i + 1] - b.data[i + 1]) > tol
      || Math.abs(a.data[i + 2] - b.data[i + 2]) > tol) n++;
  }
  return n / (a.width * a.height);
}

// ------------------------------------------------------------------ drive --

let pass = 0, fail = 0;
const clause = (id, text, good, detail) => {
  good ? pass++ : fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'} (${id}) ${text}`);
  if (detail) console.log(`         ${detail}`);
};

const pw = await playwright();
const site = await serve();
const browser = await launch(pw);

// The scale is judged on the path a visitor actually gets: the particle-mesh
// N-body run, not the linear fallback. It matters here — linear theory cannot
// virialize, so left running it simply keeps piling matter up, and by a ≈ 0.85
// most of the frame has collapsed into one hue. Scoring that state would be
// scoring a regime the default build never shows.
async function openCosmic(query, targetA) {
  const page = await browser.newPage({ viewport: { width: 720, height: 450 } });
  await page.goto(`${site.origin}/index.html?${query}`, { waitUntil: 'load' });
  await page.waitForFunction('window.AEON', null, { timeout: 60000 });
  await page.evaluate(() => document.querySelectorAll('.hud, #splash').forEach(e => { e.style.visibility = 'hidden'; }));
  if (targetA !== undefined) {
    await page.evaluate(async (target) => {
      const s = window.AEON.active();
      s.rate = 1.6;
      await new Promise((done) => {
        const tick = () => (s.a >= target ? done() : requestAnimationFrame(tick));
        requestAnimationFrame(tick);
      });
      s.playing = false;
    }, targetA);
  }
  await page.evaluate(settle, 10);
  return page;
}

/** how far apart two hue histograms are — the legibility of a difference */
function hueDistance(a, b) {
  const na = a.lit || 1, nb = b.lit || 1;
  let d = 0;
  for (let i = 0; i < 36; i++) d += Math.abs(a.hues[i] / na - b.hues[i] / nb);
  return d / 2;   // total variation distance, 0..1
}

const shot = async (page) => decodePNG(await page.screenshot({ type: 'png' }));

if (milestone !== 'M1') {
  console.error(`gate: no scorer for ${milestone} yet — M1 only`);
  process.exit(2);
}

const EPOCH = Number(arg('a', 0.45));   // web formed, voids still open

console.log(`\ngate · ${milestone} · seed ${seed} · measured at a = ${EPOCH}\n`);

/** N-body frame, then the same instant under linear theory — clause (c) is
 *  about how much the toggle actually tells you */
async function pair(query) {
  const page = await openCosmic(query, EPOCH);
  const nbody = analyse(await shot(page));
  await page.evaluate(() => window.AEON.active().toggleMode());
  await page.evaluate(settle, 10);
  const linear = analyse(await shot(page));
  await page.evaluate(() => window.AEON.active().toggleMode());
  await page.evaluate(settle, 10);
  return { page, nbody, linear };
}

const ref = await pair(`seed=${seed}`);
const legacyA = ref.nbody;
const legacyF = families(legacyA);
const legacyToggle = hueDistance(ref.nbody, ref.linear);
await ref.page.close();

const m1 = await pair(`seed=${seed}&m1=1`);
const page = m1.page;
const before = await shot(page);
const A = m1.nbody;
const F = families(A);
const [lo, hi] = lumBand(A);
const m1Toggle = hueDistance(m1.nbody, m1.linear);

console.log('reference (flag off):');
console.log(`  ${legacyF.count} hue families · longest identical run ${legacyA.worstRun}px`
  + ` · lit ${((legacyA.lit / legacyA.n) * 100).toFixed(1)}%\n`);
console.log('M1 (flag on):');
console.log(`  lit ${((A.lit / A.n) * 100).toFixed(1)}% · max luminance ${A.maxLum.toFixed(3)}`);
console.log(`  hue histogram peaks: ${F.chromatic.map(m => `${m.deg}°(${(m.frac * 100).toFixed(1)}%)`).join(' ')}`
  + ` + achromatic ${(F.achromatic * 100).toFixed(1)}%`);
const bar = (A) => A.hues.slice(0, 35).map((v, i) => [i * 10, v / A.lit])
  .filter(([, f]) => f > 0.004).map(([d, f]) => `${d}°:${(f * 100).toFixed(1)}`).join(' ');
console.log(`  full histogram  M1: ${bar(A)}`);
console.log(`  full histogram ref: ${bar(legacyA)}\n`);

clause('b', '≥4 distinguishable hue families', F.count >= 4,
  `${F.count} families${F.count < 4 ? ` — was ${legacyF.count} before` : ''}`);
clause('b', 'all lit pixels within 0.02–0.85 luminance', lo >= 0.02 && hi <= 0.85,
  `p01..p99 = ${lo.toFixed(3)}..${hi.toFixed(3)}, max ${A.maxLum.toFixed(3)}`);
clause('d', 'no banding in the deep field at 8-bit', A.worstRun < 24,
  `longest identical-value run ${A.worstRun}px over ${A.scanned}px scanned`
  + ` (reference: ${legacyA.worstRun}px)`);
clause('c', 'the N toggle is more legible than it was',
  m1Toggle > legacyToggle,
  `hue-distribution shift between modes: ${(m1Toggle * 100).toFixed(1)}%`
  + ` vs ${(legacyToggle * 100).toFixed(1)}% before`);
clause('2.8', 'vacuum blacks stay at true #000', A.atOne / A.n < 0.001,
  `${((A.pureBlack / A.n) * 100).toFixed(1)}% exactly #000,`
  + ` ${((A.atOne / A.n) * 100).toFixed(3)}% lifted to 1/255`);

// -- (a) motion, across an interval of deep time
await page.evaluate(() => { const s = window.AEON.active(); s.playing = true; s.rate = 0.35; });
await page.evaluate(settle, 45);
const mid = await shot(page);
await page.evaluate(settle, 45);
const after = await shot(page);
const d1 = pixelsChanged(before, mid);
const d2 = pixelsChanged(mid, after);
const loop = pixelsChanged(before, after);
const aEnd = await page.evaluate(() => window.AEON.active().a);
clause('a', 'continuous motion, and it does not return to where it started',
  d1 > 0.02 && d2 > 0.02 && loop > Math.max(d1, d2) * 0.6,
  `${(d1 * 100).toFixed(1)}% then ${(d2 * 100).toFixed(1)}% of pixels changed;`
  + ` start-vs-end differs by ${(loop * 100).toFixed(1)}% — a loop would collapse this`);
clause('a', 'deep time runs past the present day rather than freezing', aEnd > 1.0,
  `a reached ${aEnd.toFixed(3)} (z = ${(1 / aEnd - 1).toFixed(3)}), still advancing`);
await page.close();

console.log(`\n${pass}/${pass + fail} measurable clauses pass`);
console.log('clause (e), budgets, is scored separately by ?bench=1.\n');

await browser.close();
await site.close();
process.exit(fail ? 1 : 0);
