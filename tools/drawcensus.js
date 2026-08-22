// What the driver was actually asked to draw — CLAUDE.md §M0.
//
//   node tools/drawcensus.js
//   node tools/drawcensus.js --flags "bladedbg=2" --frames 2
//
// `docs/captures/blind/SCORE.md` ends on two facts and an admission:
//
//   > **In the frame, there is no grass.** Visually confirmed at magnification.
//   > **In the CPU's bookkeeping, there are 3.5 M blades across 162 chunks.**
//   > Both are facts and they do not agree. The reconciliation is *not* known.
//   > **Naming the cause needs a draw-call inspection, not another still.**
//
// This is that inspection. `src/flora.js` cites a third number that agrees with
// neither — "1,703 instances across 38 draw calls" — so there are three
// measurements of one quantity and no two of them match.
//
// The useful property: **this needs no rendered frame.** It records what was
// submitted, not what came back, so it runs at full speed on a software
// rasteriser where `tools/glimpse.js` has to wreck the quality knobs to get a
// picture at all. If the meadow submits 3.5 M instances, the fault is
// downstream of the draw and `?bladedbg=` separates the two candidates. If it
// submits 1,703, the fault is upstream and no shader change will ever fix it.
//
// ---------------------------------------------------------------------------
// Attribution, which is the part that takes the work
//
// A draw call names a program, not a material, and a program is a number. So
// the shader source is recorded at `shaderSource` time, mapped to its program
// at `attachShader`, and each program is tagged by matching its *vertex* source
// against markers that are unique to a subsystem — `aRoot` and `meadowKeep`
// belong to the blade shader in `src/flora.js` and to nothing else.
//
// Anything unmatched is reported as `?` with a source excerpt rather than
// silently bucketed, because a census that quietly drops the interesting draw
// is worse than no census.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { arg, launch, playwright, serve, REPO } from './lib.js';

const FRAMES = Number(arg('frames', 2));
const BUDGET = Number(arg('timeout', 900)) * 1000;
const extra = String(arg('flags', '') || '');
const SEED = String(arg('seed', '700181046'));
const WHERE = String(arg('at', 'g=1153665109&s=679069590&p=1'));
// the same wrecked preset glimpse uses, so the two are talking about one frame
const CHEAP = String(arg('preset', 'cheap')) === 'none' ? ''
  : 'q=low&grass=0.012,0.010,0.006,0.006&blades=1,1,1,1&wind=64&shres=512&shtaps=1&qd=10&qr=17&vc=0';

const url = `/index.html?seed=${SEED}&${WHERE}&dt=0.0166`
  + [CHEAP, extra].filter(Boolean).map((s) => '&' + s).join('');

const pw = await playwright();
const { origin, close } = await serve();
const browser = await launch(pw);
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });

await page.addInitScript(() => {
  const TAGS = [
    ['meadow blade (flora.js)', /aRoot|meadowKeep/],
    ['meadow wind field', /uWindTime[\s\S]*fullscreen|FS_QUAD/],
    ['terrain tile', /uHeightTex[\s\S]*aerial|vW\b/],
    ['painted prop (painted.js)', /uPaintShade|vPaintW/],
    ['instanced prop', /instanceMatrix/],
    ['sky / dome', /uSunDir[\s\S]*horizon|skyColour|uZenith/],
    ['post / fullscreen', /gl_Position = vec4\(\s*position\.xy/],
  ];
  const src = new WeakMap();
  const progVert = new WeakMap();
  const stats = new Map();
  let cur = null;

  const install = (P) => {
    if (!P) return;
    const o = {
      shaderSource: P.shaderSource, attachShader: P.attachShader,
      useProgram: P.useProgram,
      drawElementsInstanced: P.drawElementsInstanced,
      drawArraysInstanced: P.drawArraysInstanced,
      drawElements: P.drawElements, drawArrays: P.drawArrays,
    };
    P.shaderSource = function (sh, s) { src.set(sh, String(s)); return o.shaderSource.call(this, sh, s); };
    P.attachShader = function (pr, sh) {
      const s = src.get(sh) || '';
      // the vertex shader is the one that declares attributes
      if (/\battribute\b|\bin\s+vec|gl_Position/.test(s) && !/gl_FragColor|\bout\s+vec4\s+\w*frag/i.test(s)) {
        progVert.set(pr, s);
      }
      return o.attachShader.call(this, pr, sh);
    };
    P.useProgram = function (pr) { cur = pr; return o.useProgram.call(this, pr); };

    const record = (instances, verts) => {
      if (!cur) return;
      let e = stats.get(cur);
      if (!e) {
        const v = progVert.get(cur) || '';
        let tag = '?';
        for (const [name, re] of TAGS) if (re.test(v)) { tag = name; break; }
        e = { tag, calls: 0, instances: 0, verts: 0,
          excerpt: tag === '?' ? v.slice(0, 160).replace(/\s+/g, ' ') : '' };
        stats.set(cur, e);
      }
      e.calls++; e.instances += instances; e.verts += instances * verts;
    };
    P.drawElementsInstanced = function (m, c, t, off, n) { record(n, c); return o.drawElementsInstanced.call(this, m, c, t, off, n); };
    P.drawArraysInstanced = function (m, f, c, n) { record(n, c); return o.drawArraysInstanced.call(this, m, f, c, n); };
    P.drawElements = function (m, c, t, off) { record(1, c); return o.drawElements.call(this, m, c, t, off); };
    P.drawArrays = function (m, f, c) { record(1, c); return o.drawArrays.call(this, m, f, c); };
  };
  install(window.WebGL2RenderingContext?.prototype);
  install(window.WebGLRenderingContext?.prototype);

  window.__census = () => [...stats.values()].sort((a, b) => b.instances - a.instances);
  window.__censusReset = () => stats.clear();
});

console.log(`drawcensus · ${url}`);
const pageNotes = [];
page.on('console', (m) => {
  const t = m.text();
  if (/\[(ground|§M3)\]/.test(t)) pageNotes.push(t.slice(0, 170));
});

await page.goto(origin + url, { waitUntil: 'domcontentloaded' });
let ok = true;
try {
  await page.waitForFunction(
    () => !!(window.AEON?.stack?.length
      && /Surface/.test(window.AEON.stack[window.AEON.stack.length - 1].constructor.name)),
    null, { timeout: BUDGET });
  console.log('  surface built');
  // Count ONE settled frame, not the build. The build issues uploads and
  // one-off passes; the question is what a steady frame asks for.
  await page.evaluate(() => window.__censusReset());
  await page.evaluate((n) => window.AEON.haltAt((window.AEON.frames || 0) + n), FRAMES);
  await page.waitForFunction(() => window.AEON._haltAt && window.AEON.frames >= window.AEON._haltAt,
    null, { timeout: BUDGET });
} catch (e) {
  ok = false;
  console.error(`  did not settle: ${String(e).slice(0, 130)}`);
  console.error('  reporting whatever was submitted up to here — say so when quoting it');
}

const rows = await page.evaluate(() => window.__census());
await browser.close();
await close();

console.log(`\n  ${'subsystem'.padEnd(30)} ${'calls'.padStart(6)} ${'instances'.padStart(11)} ${'vertices'.padStart(12)}`);
let ti = 0, tv = 0;
for (const r of rows) {
  ti += r.instances; tv += r.verts;
  console.log(`  ${r.tag.padEnd(30)} ${String(r.calls).padStart(6)}`
    + ` ${r.instances.toLocaleString().padStart(11)} ${r.verts.toLocaleString().padStart(12)}`);
  if (r.excerpt) console.log(`      ${r.excerpt}`);
}
console.log(`  ${'—'.repeat(30)} ${'—'.repeat(6)} ${'—'.repeat(11)} ${'—'.repeat(12)}`);
console.log(`  ${'total'.padEnd(30)} ${''.padStart(6)} ${ti.toLocaleString().padStart(11)} ${tv.toLocaleString().padStart(12)}`);

const out = join(REPO, 'docs/captures/glimpse');
await mkdir(out, { recursive: true });
await writeFile(join(out, `census${extra ? '-' + extra.replace(/\W+/g, '') : ''}.json`),
  JSON.stringify({ url, frames: FRAMES, settled: ok, rows, totals: { instances: ti, verts: tv }, pageNotes }, null, 2) + '\n');

for (const n of pageNotes.slice(0, 4)) console.log(`\n  · ${n}`);
console.log(`\ndrawcensus · ${rows.length} programs · ${ti.toLocaleString()} instances`
  + ` · ${tv.toLocaleString()} vertices over ${FRAMES} frame(s)` + (ok ? '' : ' · INCOMPLETE'));
