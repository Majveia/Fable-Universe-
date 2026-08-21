// Streaming growth — CLAUDE.md §5, and the question a single-frame probe cannot ask.
//
//   node tools/perfgrow.js '?seed=7&g=12&s=40&pl=1'
//   node tools/perfgrow.js '?seed=7&g=12&s=40&p=1' 20,60,120,240,420,700
//
// `tools/capture.js` shoots a settled frame and `?bench=1` runs a fixed route.
// Neither answers the question that actually breaks a streaming renderer: **does
// the cost keep going up?** A quadtree that never retires a tile, a light that
// is added per chunk, a geometry cache with no eviction — all of them look fine
// at frame 60 and are fatal at frame 700, and all of them are invisible to a
// measurement taken once.
//
// So this samples `renderer.info` at a ladder of frame counts and prints the
// series. A flat tail is the pass condition; a rising one names the leak, and
// the column it rises in says which kind it is:
//
//     draws  climbing → something is added per tile and never merged or freed
//     tris   climbing → LOD is not retiring parents (§11's "tile seams" trap,
//                       from the other side: parents that never stop drawing)
//     geo    climbing → the streaming cache has no ceiling
//     progs  climbing → a material is being rebuilt rather than reused, which
//                       usually means a `customProgramCacheKey` that varies
//     ms/f   climbing while the rest is flat → the leak is on the CPU side
//
// It arrived as an ad-hoc probe written by the perf agent, with an absolute
// path to one machine's Playwright and a hardcoded port. It is kept because
// the measurement is right and nothing else in `tools/` makes it — rehomed
// onto `tools/lib.js`, which already knows how to find a browser and how to
// serve the repo, so it runs wherever the rest of the instrument does.
//
// Honesty: on a software rasteriser the `ms/f` column is meaningless as an
// absolute (§M0) and is printed with the renderer string so it cannot be
// mistaken for a §5 number. Every other column is real on any driver, because
// draw calls and triangle counts are counts.

import { arg, launch, playwright, serve } from './lib.js';

const query = process.argv[2] ?? '?seed=7';
const marks = String(arg('marks', process.argv[3] ?? '20,60,120,240,420,700'))
  .split(',').map(Number).filter(Number.isFinite);

const site = await serve();
const pw = await playwright();
const browser = await launch(pw);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('  ERR ' + String(e.message).slice(0, 160)));

await page.goto(`${site.origin}/index.html${query.startsWith('?') ? query : '?' + query}`,
  { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.AEON && window.AEON.frames > 1', null, { timeout: 180000 });

const renderer = await page.evaluate(() => {
  const gl = window.AEON.renderer.getContext();
  const d = gl.getExtension('WEBGL_debug_renderer_info');
  return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown';
});

// `info.autoReset = false` and a reset at the top of each frame, so the counts
// are one frame's work rather than an accumulating total — the default would
// make every column rise and every run look like a leak.
await page.evaluate(() => {
  const A = window.AEON, r = A.renderer;
  r.info.autoReset = false;
  window.__last = null;
  const inner = Object.getPrototypeOf(A)._frame;
  A._frame = function wrapped() {
    r.info.reset();
    const t = performance.now();
    inner.call(A);
    const ri = r.info.render;
    window.__last = {
      ms: +(performance.now() - t).toFixed(1), calls: ri.calls, tris: ri.triangles,
      pts: ri.points, geo: r.info.memory.geometries, tex: r.info.memory.textures,
      progs: (r.info.programs || []).length, frames: A.frames,
    };
  };
});

console.log(`\nperfgrow · ${query}`);
console.log(`  driver: ${renderer}`);
console.log('  §5 ceilings at surface scale: 900 draws · 2.2 M triangles · 12 ms CPU');
console.log('  ms/f is wall-clock and is only meaningful on a real GPU (§M0)\n');

const t0 = Date.now();
const series = [];
for (const m of marks) {
  await page.waitForFunction(`window.AEON.frames >= ${m}`, null, { timeout: 300000 })
    .catch(() => { /* a scale that never reaches the mark still reports where it got to */ });
  const d = await page.evaluate('window.__last');
  if (!d) continue;
  series.push(d);
  console.log(`  frame ${String(d.frames).padStart(4)}`
    + `  wall ${String(((Date.now() - t0) / 1000).toFixed(0)).padStart(4)}s`
    + `  ms/f ${String(d.ms).padStart(7)}`
    + `  draws ${String(d.calls).padStart(5)}`
    + `  tris ${(d.tris / 1e6).toFixed(3)}M`
    + `  geo ${String(d.geo).padStart(5)}`
    + `  tex ${String(d.tex).padStart(4)}`
    + `  progs ${d.progs}`);
}

// The verdict, over the second half of the run — the first half is the scale
// streaming in, which is supposed to climb.
if (series.length >= 3) {
  const tail = series.slice(Math.floor(series.length / 2));
  const grew = [];
  for (const k of ['calls', 'tris', 'geo', 'progs']) {
    const a = tail[0][k], b = tail[tail.length - 1][k];
    if (b > a * 1.12 + 2) grew.push(`${k} ${a} → ${b}`);
  }
  console.log(grew.length
    ? `\n  still growing after the stream settled: ${grew.join(' · ')}`
    : '\n  flat across the settled tail — nothing is accumulating');
}

await browser.close();
await site.close();
