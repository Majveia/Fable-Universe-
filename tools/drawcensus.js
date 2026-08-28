// What the driver was actually asked to draw — CLAUDE.md §M0.
//
//   node tools/drawcensus.js --preset none --at "g=…&s=…&p=…" --seed …   <- for §5
//   node tools/drawcensus.js --flags "bladedbg=2" --frames 2
//
// ---------------------------------------------------------------------------
// READ THIS BEFORE QUOTING A NUMBER FROM IT
//
// **The defaults change the subject, and until now they did it silently.**
// `--at` points at one fixed world that is almost certainly not yours, and
// `--preset cheap` multiplies the grass down to about a hundredth and takes the
// shadow map, the wind field and the quadtree with it.
//
// Both defaults are there for good reasons — the preset is what makes this
// runnable on a software rasteriser at all, and a fixed world is what makes two
// runs comparable with each other. Neither is a reason to let the output look
// like an answer to a question nobody asked.
//
// The cost is on the record. A §5 measurement taken under the preset came back
// **GREEN** and was quoted three times before anyone re-ran it with the knobs
// intact, at which point the same frame was **4.9× RED** — 10,740,531 triangles
// against 2,200,000. The tool was not wrong. It was answering a different
// question in the same voice.
//
// It now prints a banner on stderr naming every substitution it made, and a
// one-line all-clear when it made none, because "no banner" has to mean
// something for the banner to be worth printing.
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
//
// ---------------------------------------------------------------------------
// Triangles, and the column heading that was wrong
//
// The first version of this file multiplied the instance count by the draw's
// `count` parameter and called the result "vertices". For `drawArrays*` that is
// true. For `drawElementsInstanced` — which is every instanced draw in this
// repo — `count` is the number of **indices**, and an indexed mesh exists
// precisely so that its index count and its vertex count are different numbers.
// The figures were right and the heading was not, which is the worse of the two
// ways to be wrong: a mislabelled budget number is exactly the kind of thing
// that gets quoted into a decision.
//
// So the column is now **triangles**, which is the unit §5 actually budgets —
// *"≤ 2.2 M triangles"*, per frame, at surface scale. It is `count / 3` under
// `TRIANGLES` and undefined under any other primitive mode, so modes are
// counted separately and a non-triangle draw contributes zero rather than a
// third of a line strip.
//
// §5's cap is stated **per frame**, and a frame here includes every pass the
// renderer makes — the shadow map is not free because it is not the picture.
// So the total below is the number to compare, undivided.

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

/**
 * Say out loud that the defaults changed the subject.
 *
 * This tool has two defaults that quietly replace what you asked about: `--at`
 * points at one particular world that is not yours, and `--preset cheap`
 * multiplies the grass down to about a hundredth and takes the shadow map,
 * the wind field and the quadtree with it. Both exist for good reasons — the
 * preset is what makes the census runnable on a software rasteriser at all, and
 * a fixed world is what makes two runs comparable — and neither announced
 * itself.
 *
 * The cost of that is on the record: a §5 measurement was taken with the
 * preset in place, came back GREEN, and was quoted three times before someone
 * re-ran it with the knobs intact and got **4.9× RED**. The tool was not wrong.
 * It was answering a question nobody had asked, in a voice indistinguishable
 * from the one they had.
 *
 * So it says so, every run, on stderr, in the units that matter — and a run
 * that carries neither substitution says that too, because "no banner" has to
 * mean something.
 */
const SUBSTITUTED = [];
if (String(arg('preset', 'cheap')) !== 'none') {
  SUBSTITUTED.push('--preset cheap · grass ×0.012/0.010/0.006/0.006, blades 1/1/1/1, '
    + 'shadow 512¹, wind 64², quadtree depth 10 — the scene is measured with its legs cut off');
}
if (arg('at', null) === null) {
  SUBSTITUTED.push(`--at defaults to g=1153665109&s=679069590&p=1 — one fixed world, `
    + 'probably not the one you are asking about');
}

// same precedence rule as tools/glimpse.js, and for the same reason: a
// repeated key resolves to its FIRST occurrence, so a preset placed ahead of
// `--flags` silently eats the override.
const merged = (() => {
  const out = new Map();
  for (const g of [CHEAP, extra]) {
    for (const pair of String(g || '').split('&').filter(Boolean)) {
      const i = pair.indexOf('=');
      out.set(i < 0 ? pair : pair.slice(0, i), i < 0 ? '' : pair.slice(i + 1));
    }
  }
  return [...out].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join('&');
})();
const url = `/index.html?seed=${SEED}&${WHERE}&dt=0.0166${merged ? '&' + merged : ''}`;

if (SUBSTITUTED.length) {
  console.error('\n  ' + '!'.repeat(74));
  console.error('  !! THIS RUN IS NOT MEASURING WHAT YOU PROBABLY MEAN');
  for (const line of SUBSTITUTED) console.error(`  !!   ${line}`);
  console.error('  !! Numbers from this run are NOT comparable against §5. For that:');
  console.error('  !!   node tools/drawcensus.js --preset none --at "g=…&s=…&p=…" --seed …');
  console.error('  ' + '!'.repeat(74) + '\n');
} else {
  console.error('  census · full quality, on the world you named — comparable against §5\n');
}

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
    // `life.js` — trees, canopies, blossom. The largest non-meadow line in the
    // frame turned out to be here and reported only as `instanced prop`, which
    // is a census naming the wrong thing precisely where it matters most.
    ['life · bark / branch (life.js)', /aSeg|aBranch|aLean|barkMat/],
    ['life · canopy / leaf (life.js)', /aLeaf|aCanopy|uCanopy|leafMass/],
    ['life · blossom / petal (life.js)', /uFlutter|uPetal|uOpen/],
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
      // **`gl_Position`, and nothing else.** The first version asked whether
      // the source declared attributes or varyings and then tried to exclude
      // fragment shaders by looking for `gl_FragColor` or an `out vec4 frag…`.
      // Under GLSL3 a fragment shader declares its varyings as `in vec…` too,
      // and `src/flora.js` names its output `outColor` — so the blade's
      // *fragment* source passed the test and overwrote its vertex source. The
      // whole meadow then tagged as `terrain tile`, because the fragment shader
      // happens to carry a varying called `vW`.
      //
      // Only a vertex shader writes `gl_Position`. There is no second rule.
      if (/gl_Position/.test(s)) progVert.set(pr, s);
      return o.attachShader.call(this, pr, sh);
    };
    P.useProgram = function (pr) { cur = pr; return o.useProgram.call(this, pr); };

    // `count` is indices for drawElements* and vertices for drawArrays*; under
    // TRIANGLES (mode 4) both are three per triangle, and under anything else
    // there is no triangle to count.
    const record = (mode, instances, count) => {
      if (!cur) return;
      let e = stats.get(cur);
      if (!e) {
        const v = progVert.get(cur) || '';
        let tag = '?';
        for (const [name, re] of TAGS) if (re.test(v)) { tag = name; break; }
        e = { tag, calls: 0, instances: 0, elements: 0, tris: 0, modes: {},
          // An excerpt for anything that landed in a generic bucket too, not
          // only for `?`. A 608,800-triangle row reading `instanced prop` is
          // the census failing at the one job it has.
          // …with three's boilerplate cut off first. The first attempt at this
          // printed 200 characters of `#version 300 es` and precision
          // qualifiers, which is the same preamble on every program in the
          // build and identifies none of them.
          excerpt: (tag === '?' || tag === 'instanced prop')
            ? v.replace(/^[\s\S]*?precision\s+highp\s+sampler\w+\s*;/, '')
              .replace(/#define\s+\S+\s+\S*/g, '')
              .replace(/\bprecision\s+\w+\s+\w+\s*;/g, '')
              .replace(/\s+/g, ' ').trim().slice(0, 220) : '' };
        stats.set(cur, e);
      }
      e.calls++; e.instances += instances; e.elements += instances * count;
      e.modes[mode] = (e.modes[mode] || 0) + 1;
      if (mode === 4) e.tris += (instances * count) / 3;
    };
    P.drawElementsInstanced = function (m, c, t, off, n) { record(m, n, c); return o.drawElementsInstanced.call(this, m, c, t, off, n); };
    P.drawArraysInstanced = function (m, f, c, n) { record(m, n, c); return o.drawArraysInstanced.call(this, m, f, c, n); };
    P.drawElements = function (m, c, t, off) { record(m, 1, c); return o.drawElements.call(this, m, c, t, off); };
    P.drawArrays = function (m, f, c) { record(m, 1, c); return o.drawArrays.call(this, m, f, c); };
  };
  install(window.WebGL2RenderingContext?.prototype);
  install(window.WebGLRenderingContext?.prototype);

  window.__census = () => [...stats.values()].sort((a, b) => b.instances - a.instances);
  window.__censusReset = () => {
    stats.clear();
    // the frame the count started on, so the divisor is measured not assumed
    window.AEON.__censusBase = window.AEON.frames || 0;
    Object.defineProperty(window.AEON, '__censusFrames', {
      configurable: true,
      get: () => (window.AEON.halted || window.AEON.frames || 0) - window.AEON.__censusBase,
    });
  };
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
  //
  // Reset and halt in **one** evaluate. They were two, and the loop kept
  // running between them — so `--frames 1` counted the frame that slipped
  // through the gap plus the frame it halted on, and reported a doubled figure
  // against a divisor of one. That is how a 13.4 M frame came to be written
  // down as 26.8 M and then explained as "two passes": the tool was measuring
  // two frames and saying one. A single evaluate runs between animation frames,
  // so the reset and the deadline are set on the same frame boundary.
  await page.evaluate((n) => {
    window.__censusReset();
    window.AEON.haltAt((window.AEON.frames || 0) + n);
  }, FRAMES);
  await page.waitForFunction(() => window.AEON._haltAt && window.AEON.frames >= window.AEON._haltAt,
    null, { timeout: BUDGET });
} catch (e) {
  ok = false;
  console.error(`  did not settle: ${String(e).slice(0, 130)}`);
  console.error('  reporting whatever was submitted up to here — say so when quoting it');
}

const rows = await page.evaluate(() => window.__census());

// What the loop actually drew, rather than what was asked for. If these differ
// the divisor below is wrong and every per-frame number with it, so it is read
// back rather than assumed.
const counted = await page.evaluate(() => window.AEON.__censusFrames || 0);

/**
 * The per-ring breakdown the census structurally cannot give.
 *
 * All four rings share one `RawShaderMaterial` — deliberately, and the
 * constructor in `src/flora.js` says why — so three compiles one program for
 * them and every draw the census sees names that one program. Four rings
 * collapse into one row, and "which ring is the budget" is exactly the question
 * Act 3a has to answer.
 *
 * `GrassRing.update()` already records `blades` (what the CPU instanced this
 * frame, before the shader's own thinning) and `drawn` (the chunks that
 * survived the frustum), so the numbers exist; nothing was reading them. This
 * reads them off the live ring objects after the same settled frame, and
 * multiplies by the ring's own geometry to get triangles.
 */
const meadow = await page.evaluate(() => {
  const st = window.AEON?.stack || [];
  const s = st[st.length - 1];
  if (!s?.meadow) return null;
  return s.meadow.map((r, i) => ({
    ring: i,
    chunk: r.spec.chunk,
    far: r.spec.far,
    blades: r.blades | 0,
    drawn: r.drawn | 0,
    curved: !!r.curved,
    triPerBlade: (r.geometry?.index?.count || 0) / 3,
    densityMul: r.densityMul,
  }));
});
await browser.close();
await close();

const n0 = (x) => Math.round(x).toLocaleString();
console.log(`\n  ${'subsystem'.padEnd(30)} ${'calls'.padStart(6)} ${'instances'.padStart(11)} ${'triangles'.padStart(12)}`);
let ti = 0, tt = 0, tc = 0;
for (const r of rows) {
  ti += r.instances; tt += r.tris; tc += r.calls;
  console.log(`  ${r.tag.padEnd(30)} ${String(r.calls).padStart(6)}`
    + ` ${r.instances.toLocaleString().padStart(11)} ${n0(r.tris).padStart(12)}`
    + (Object.keys(r.modes).some((m) => m !== '4') ? `  (modes ${Object.keys(r.modes).join(',')})` : ''));
  if (r.excerpt && r.tris > 50000) console.log(`      ${r.excerpt}`);
}
console.log(`  ${'—'.repeat(30)} ${'—'.repeat(6)} ${'—'.repeat(11)} ${'—'.repeat(12)}`);
console.log(`  ${'total'.padEnd(30)} ${String(tc).padStart(6)} ${ti.toLocaleString().padStart(11)} ${n0(tt).padStart(12)}`);

// §5, stated per frame and compared per frame. `frames` is how many the census
// counted, so the per-frame figure is the total over it — the shadow pass is
// inside a frame, not beside it.
if (meadow) {
  console.log(`\n  ${'meadow'.padEnd(10)} ${'chunks'.padStart(7)} ${'blades'.padStart(11)}`
    + ` ${'tri/blade'.padStart(9)} ${'triangles'.padStart(12)}  reach`);
  let mb = 0, mt = 0;
  for (const r of meadow) {
    const t = r.blades * r.triPerBlade;
    mb += r.blades; mt += t;
    console.log(`  ring ${r.ring}     ${String(r.drawn).padStart(7)} ${r.blades.toLocaleString().padStart(11)}`
      + ` ${String(r.triPerBlade).padStart(9)} ${Math.round(t).toLocaleString().padStart(12)}`
      + `  ${r.far} m${r.curved ? ' · curved' : ''}`);
  }
  console.log(`  ${'total'.padEnd(10)} ${''.padStart(7)} ${mb.toLocaleString().padStart(11)}`
    + ` ${''.padStart(9)} ${Math.round(mt).toLocaleString().padStart(12)}`
    + `   (§M3 gate: 800,000 blades)`);
}

const TRI_CAP = 2_200_000, CALL_CAP = 900;
const nf = counted > 0 ? counted : FRAMES;
if (counted !== FRAMES) {
  console.log(`\n  note · asked for ${FRAMES} frame(s), the loop drew ${counted}`
    + ` — dividing by ${nf}`);
}
const triF = tt / nf, callF = tc / nf;
console.log(`\n  §5 · ${n0(triF)} triangles/frame against 2,200,000`
  + `  ${triF <= TRI_CAP ? 'GREEN' : `RED · ${(triF / TRI_CAP).toFixed(1)}x over`}`);
console.log(`  §5 · ${n0(callF)} draw calls/frame against 900`
  + `  ${callF <= CALL_CAP ? 'GREEN' : `RED · ${(callF / CALL_CAP).toFixed(1)}x over`}`);

const out = join(REPO, 'docs/captures/glimpse');
await mkdir(out, { recursive: true });
await writeFile(join(out, `census${extra ? '-' + extra.replace(/\W+/g, '') : ''}.json`),
  JSON.stringify({ url, frames: FRAMES, framesCounted: counted, settled: ok, rows,
    totals: { instances: ti, triangles: tt, calls: tc },
    perFrame: { triangles: tt / nf, calls: tc / nf },
    budget: { triangles: 2200000, calls: 900, source: 'CLAUDE.md §5, per frame' },
    meadow,
    pageNotes }, null, 2) + '\n');

for (const n of pageNotes.slice(0, 4)) console.log(`\n  · ${n}`);
console.log(`\ndrawcensus · ${rows.length} programs · ${ti.toLocaleString()} instances`
  + ` · ${n0(tt)} triangles over ${nf} frame(s)` + (ok ? '' : ' · INCOMPLETE'));
