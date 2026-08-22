// A frame this machine can actually render — CLAUDE.md §M0, and its limits.
//
//   node tools/glimpse.js
//   node tools/glimpse.js --flags "bladedbg=2" --name blades-fat
//   node tools/glimpse.js --preset none --w 960 --h 540      # on real silicon
//
// This container has no GPU. Measured: at 420x240 the surface scale builds
// cleanly, logs every timing, places 16 462 ground objects — and does not
// complete **eight frames in five hundred seconds**. Every instrument in this
// directory that needs to look at a surface frame is therefore unusable here,
// which is how `docs/captures/blind/SCORE.md` came to hold two facts that
// contradict each other and a note saying the reconciliation is unknown.
//
// So: a frame that is cheap enough to exist, at the cost of being a frame
// nobody would ship.
//
// ---------------------------------------------------------------------------
// What this is NOT
//
// `docs/captures/README.md` is explicit that a SwiftShader set is fabricated
// evidence, and `RECKONING.md` §1 makes it a standing rule: *"any claim about
// how something LOOKS must cite a capture or say plainly that it is
// unverified."* A glimpse is not a capture and must never be filed as one.
//
// It answers **binary** questions:
//
//   · do the blades appear at all, at any size?           (`?bladedbg=`)
//   · does the haze reach the near ground?
//   · did that change move the near field off 1.15/255?
//
// It does not answer whether anything is beautiful. The knobs below deliberately
// wreck the frame — a hundredth of the grass, one segment per blade, a 512 px
// shadow map — precisely so the vertex count drops far enough to render. A
// glimpse showing a lovely image would be a glimpse that had failed at its job,
// because it would mean the preset was not aggressive enough to be trusted as
// an instrument.
//
// It writes to `docs/captures/glimpse/`, never to a milestone directory, and
// stamps `gateValid: false` beside every number, exactly as `src/bench.js` does
// when it sees a software rasteriser.
//
// ---------------------------------------------------------------------------
// The preset, and why each knob is in it
//
// Every one of these already existed as a URL override in `src/quality.js`;
// none of this needed new plumbing.
//
//   q=low            the cheapest row: 25-px tiles, 6 atmosphere steps
//   grass=…          the big one. Low tier still submits ~3.5 M blades and
//                    about 12 M vertices; a hundredth of that is ~35 k
//   blades=1,1,1,1   one segment per blade rather than 3 — vertices again
//   wind=64          the wind field is a 160² render target on Low, and it is
//                    a million noise evaluations at 288²
//   shres/shtaps     a 512 px shadow map, one tap
//   qd/qr            a shallower, coarser quadtree
//   vc=0             volumetric clouds are a raymarch, and a raymarch on a CPU
//                    rasteriser is the single most expensive thing in the frame
//
// `--preset none` drops all of it, for running the same tool on a machine that
// does not need the help.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodePNG } from './png.js';
import { arg, launch, playwright, serve, REPO } from './lib.js';

const CHEAP = 'q=low&grass=0.012,0.010,0.006,0.006&blades=1,1,1,1&wind=64'
  + '&shres=512&shtaps=1&qd=10&qr=17&vc=0';

const preset = String(arg('preset', 'cheap'));
const extra = String(arg('flags', '') || '');
const W = Number(arg('w', 420));
const H = Number(arg('h', 240));
const FRAMES = Number(arg('frames', 3));
const NAME = String(arg('name', 'glimpse'));
const OUT = String(arg('out', 'docs/captures/glimpse'));
const BUDGET = Number(arg('timeout', 900)) * 1000;
const SEED = String(arg('seed', '700181046'));
const WHERE = String(arg('at', 'g=1153665109&s=679069590&p=1'));

/**
 * `--flags` overrides the preset, and it took a wrong answer to get this right.
 *
 * The first version concatenated `preset + '&' + extra`, and
 * `URLSearchParams.get()` returns the **first** occurrence of a repeated key —
 * so `--flags "grass=0.3"` after a preset carrying `grass=0.012` was silently
 * discarded. The run completed, reported a number, and the number was for the
 * preset's density. A tool whose override does not override is worse than one
 * with no override, because it answers confidently.
 *
 * So they are merged into a map. No key appears twice and precedence is a
 * property of the data rather than of string order.
 */
function mergeFlags(...groups) {
  const out = new Map();
  for (const g of groups) {
    for (const pair of String(g || '').split('&').filter(Boolean)) {
      const i = pair.indexOf('=');
      out.set(i < 0 ? pair : pair.slice(0, i), i < 0 ? '' : pair.slice(i + 1));
    }
  }
  return [...out].map(([k, v]) => (v === '' ? k : `${k}=${v}`)).join('&');
}

const flags = mergeFlags(preset === 'none' ? '' : CHEAP, extra);
const url = `/index.html?seed=${SEED}&${WHERE}&dt=0.0166${flags ? '&' + flags : ''}`;

/**
 * The number both `SCORE.md` and `BENCHMARK.md` argue from.
 *
 * §8 axis 5 scored 1 and 2 on "the ground reads as nothing", and the evidence
 * was a measured gradient magnitude of 1.07 and 1.15 out of 255 over the near
 * ground. This computes the same statistic so a change can be shown to move it
 * — mean |∇luma| over a window low and central in the frame, which at a 1.68 m
 * eye height is ground within a few metres of the boots.
 *
 * **It is not comparable to those two numbers**, and the trap is worth naming
 * because the figure looks like it should be. Gradient per *pixel* scales with
 * resolution: the same ground at 320 px wide puts several metres of world into
 * each pixel where a 1280 px capture puts a fraction of one, so the finite
 * difference across neighbours is larger for the same scene. A 320x180 glimpse
 * reads about 12/255 on ground that a real capture reads at 1.15/255, and
 * neither number is wrong.
 *
 * So this is a **relative** instrument: run it twice at identical settings and
 * the difference means something. Quote it against SCORE.md and it means
 * nothing at all.
 */
function nearGroundGradient({ width, height, data }) {
  const x0 = Math.floor(width * 0.3), x1 = Math.floor(width * 0.7);
  const y0 = Math.floor(height * 0.78), y1 = height - 2;
  const lum = (x, y) => {
    const i = (y * width + x) * 4;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  let sum = 0, n = 0, lo = 255, hi = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const gx = lum(x + 1, y) - lum(x, y);
      const gy = lum(x, y + 1) - lum(x, y);
      sum += Math.hypot(gx, gy); n++;
      const l = lum(x, y);
      if (l < lo) lo = l; if (l > hi) hi = l;
    }
  }
  return { gradient: n ? sum / n : 0, min: lo, max: hi, samples: n };
}

/** saturation and hue spread, which are axis 6's numbers */
function colour({ width, height, data }) {
  let sat = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    sat += mx === 0 ? 0 : (mx - mn) / mx;
    n++;
  }
  return { saturation: n ? sat / n : 0 };
}

/** legible in a transcript without opening a file */
function ascii({ width, height, data }, cols = 64) {
  const ramp = ' .:-=+*#%@';
  const rows = Math.max(1, Math.round((cols * height) / width / 2.1));
  const out = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x = Math.min(width - 1, Math.floor(((c + 0.5) / cols) * width));
      const y = Math.min(height - 1, Math.floor(((r + 0.5) / rows) * height));
      const i = (y * width + x) * 4;
      const l = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      line += ramp[Math.min(9, Math.floor(l * 9.99))];
    }
    out.push(line);
  }
  return out;
}

const pw = await playwright();
const { origin, close } = await serve();
const browser = await launch(pw);
const page = await browser.newPage({ viewport: { width: W, height: H } });

const notes = [];
page.on('console', (m) => {
  const t = m.text();
  if (/\[(ground|§M3|§9\.7|§M2\.6)\]/.test(t)) notes.push(t.slice(0, 170));
  if (m.type() === 'error' && !/favicon|404/i.test(t)) notes.push('ERROR ' + t.slice(0, 170));
});
page.on('pageerror', (e) => notes.push('PAGEERROR ' + String(e).slice(0, 170)));

console.log(`glimpse · ${W}x${H} · ${preset === 'none' ? 'no preset' : 'cheap preset'}`);
console.log(`  ${url}`);

const t0 = Date.now();
await page.goto(origin + url, { waitUntil: 'domcontentloaded' });

let built = 0, ok = true;
try {
  await page.waitForFunction(
    () => !!(window.AEON?.stack?.length
      && /Surface/.test(window.AEON.stack[window.AEON.stack.length - 1].constructor.name)),
    null, { timeout: BUDGET });
  built = Date.now() - t0;
  console.log(`  surface built in ${(built / 1000).toFixed(1)} s`);

  // §M0's discipline: halt on a *named* frame rather than photographing
  // whichever one the loop happened to be on. Same call `capture.js` makes.
  await page.evaluate((n) => {
    const a = window.AEON;
    a.haltAt((a.frames || 0) + n);
  }, FRAMES);
  await page.waitForFunction(() => window.AEON._haltAt && window.AEON.frames >= window.AEON._haltAt,
    null, { timeout: BUDGET });
} catch (e) {
  ok = false;
  console.error(`  did not settle: ${String(e).slice(0, 120)}`);
}

const drew = Date.now() - t0;
const perFrame = built && ok ? (drew - built) / FRAMES : 0;
console.log(`  ${FRAMES} frames in ${((drew - built) / 1000).toFixed(1)} s`
  + (perFrame ? ` · ${(perFrame / 1000).toFixed(1)} s/frame` : ''));

let png = null;
try {
  png = await page.screenshot({ type: 'png', timeout: Math.min(BUDGET, 300000) });
} catch (e) {
  console.error(`  screenshot failed: ${String(e).slice(0, 120)}`);
}
await browser.close();
await close();

if (!png) { console.error('\nglimpse · no frame'); process.exit(2); }

const img = decodePNG(png);
const near = nearGroundGradient(img);
const col = colour(img);

await mkdir(join(REPO, OUT), { recursive: true });
await writeFile(join(REPO, OUT, `${NAME}.png`), png);
const report = {
  // said first and said plainly: this is a software rasteriser
  gateValid: false,
  note: 'A glimpse is not a capture. Software rasteriser, wrecked quality knobs. '
    + 'Binary questions only — see the header of tools/glimpse.js.',
  url, preset, viewport: { w: W, h: H }, frames: FRAMES,
  builtMs: built, perFrameMs: Math.round(perFrame), settled: ok,
  nearGround: near, colour: col, notes,
};
await writeFile(join(REPO, OUT, `${NAME}.json`), JSON.stringify(report, null, 2) + '\n');

for (const line of ascii(img)) console.log('  ' + line);
console.log();
for (const n of notes.slice(0, 8)) console.log('  · ' + n);
console.log(`\nglimpse · near-ground gradient ${near.gradient.toFixed(2)}/255`
  + ` · luma ${near.min.toFixed(0)}–${near.max.toFixed(0)}`
  + ` · saturation ${col.saturation.toFixed(3)}`);
console.log(`  ${OUT}/${NAME}.png · gateValid FALSE — this is an instrument, not evidence`);
