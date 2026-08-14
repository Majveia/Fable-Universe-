// Does the figure's foot stay where it was put? — CLAUDE.md §M4.
//
//   node tools/footplant.js
//   node tools/footplant.js --speeds 1.2,3.2,8 --gravity 1.62
//
// §M4 asks for locomotion that "blends procedurally" and for a camera nobody
// can catch fighting the body. Neither clause names the thing that actually
// makes a walk cycle read as cheap, because it is not visible in a still: a
// **stance foot that slides**. The eye is unreasonably good at it — it is the
// one part of a gait everybody has watched ten thousand times — and it is
// invisible to every other instrument in this directory. A screenshot cannot
// show it, `verify.js` could not reach it while the figure needed a renderer,
// and `capture.js` flies a route rather than standing still and walking.
//
// So: drive the shipped `Figure` with a synthetic walker, ask it where its
// feet are each frame, and check the one invariant a planted foot has —
// **it moves backwards through the body's frame at exactly the body's speed,
// and by nothing else.** Any residual is skate.
//
// ---------------------------------------------------------------------------
// Why it runs in a browser
//
// `figure.js` imports three, so node cannot load it. Everything measured here
// is arithmetic that would happily run under `verify.js` if it could — and the
// pure half of it (`legPlant`, `solveLeg`) does, over there. What needs the
// browser is the *composition*: the bone chain, the pelvis, and the solve
// interacting, which is exactly where the residual lives and is the reason
// measuring the pure functions alone was not enough.
//
// ---------------------------------------------------------------------------
// Reading the number
//
// Slip is reported per frame at the sampling rate below, which is the honest
// unit: a millimetre per frame at 60 fps is six centimetres a second of foot
// travelling over ground it is supposed to be gripping. Under about 0.2 mm is
// invisible. Ten is a figure skating.

import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { arg, launch, playwright, serve, REPO } from './lib.js';

const speeds = String(arg('speeds', '1.2,2.0,3.2,5.0')).split(',').map(Number);
const gravity = Number(arg('gravity', 9.81));
const rate = Number(arg('rate', 120));
const cycles = Number(arg('cycles', 6));

const MEASURE = ([origin, speeds, gravity, rate, cycles]) => (async () => {
  const THREE = await import('three');
  const { Figure } = await import(origin + '/src/figure.js');
  // the plant law itself is three-free and lives in avatar.js, where the
  // gait clock it shares a phase with lives
  const { legPlant } = await import(origin + '/src/avatar.js');
  const light = {
    sun: [1, 0.85, 0.60], ambSky: [0.60, 0.78, 0.90],
    ambGnd: [0.67, 0.61, 0.39], shadowTint: [0.36, 0.43, 0.62],
  };
  const fig = new Figure({ seed: 1, sunDir: { value: new THREE.Vector3(0.4, 0.24, 0.88) }, light });
  const DT = 1 / rate;
  const rows = [];
  for (const speed of speeds) {
    const cad = 0.58 + 0.34 * speed;          // the module's own cadence law
    const w = {
      grounded: true, landed: 0, stepPhase: 0, stepFreq: cad,
      vel: { x: 0, y: 0, z: speed }, steps: 0, lean: 0, bobY: 0, breath: 0,
    };
    const N = Math.round((cycles / cad) * rate);
    let prev = null, worst = 0, worstAt = 0, samples = 0, lo = 1e9, hi = -1e9;
    const a = new THREE.Vector3(), b = new THREE.Vector3();
    for (let i = 0; i < N; i++) {
      w.stepPhase += cad * DT;
      w.breath += DT;
      fig.update(DT, {
        walker: w, speed, vel: w.vel, sunY: 0.24, wind: { x: 0, z: 0 },
        face: 0, mode: 'walk', gravity,
      });
      const L = fig.joint('footL', a).clone(), R = fig.joint('footR', b).clone();
      lo = Math.min(lo, L.y, R.y); hi = Math.max(hi, L.y, R.y);
      const u = w.stepPhase - Math.floor(w.stepPhase);
      const pl = legPlant(u, speed, cad, gravity);
      if (prev) {
        const travel = speed * DT;
        for (const [k, now, was, down] of [
          ['L', L, prev.L, pl.L.down], ['R', R, prev.R, pl.R.down]]) {
          if (!down || !prev.down[k]) continue;
          samples++;
          const e = Math.abs((now.z - was.z) + travel);
          if (e > worst) { worst = e; worstAt = u; }
        }
      }
      prev = { L, R, down: { L: pl.L.down, R: pl.R.down } };
    }
    const p0 = legPlant(0, speed, cad, gravity);
    rows.push({
      speed, cad, worst, worstAt, samples, lo, hi,
      duty: p0.duty, stride: p0.stride, fr: p0.fr, drop: p0.drop,
    });
  }
  return rows;
})();

const pw = await playwright();
const site = await serve();
const browser = await launch(pw);
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
page.on('pageerror', (e) => console.error('  page error: ' + e.message.split('\n')[0]));

// A same-origin page, so the module graph resolves against the served tree
// rather than against `null` — `setContent` gives the page an opaque origin and
// every import fails CORS, which reads as a broken module rather than a broken
// harness.
const stage = join(REPO, 'docs/captures/_footplant.html');
await writeFile(stage, '<!doctype html><meta charset=utf-8><title>footplant</title>\n'
  + '<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>\n');
await page.goto(site.origin + '/docs/captures/_footplant.html', { waitUntil: 'load' });
const rows = await page.evaluate(MEASURE, [site.origin, speeds, gravity, rate, cycles]);
await browser.close();
await site.close();
await unlink(stage).catch(() => {});

console.log(`footplant · gravity ${gravity} m/s² · ${rate} Hz · ${cycles} stride cycles\n`);
console.log('  speed  cadence  Froude  duty  stride   hip drop   contacts   worst slip');
let worst = 0;
for (const r of rows) {
  worst = Math.max(worst, r.worst);
  console.log(`  ${r.speed.toFixed(1).padStart(4)}   ${r.cad.toFixed(2).padStart(5)}   `
    + `${r.fr.toFixed(2).padStart(5)}  ${r.duty.toFixed(2)}  ${r.stride.toFixed(2)} m  `
    + `${(r.drop * 100).toFixed(1).padStart(5)} cm     ${String(r.samples).padStart(5)}    `
    + `${(r.worst * 1000).toFixed(2).padStart(6)} mm`);
}
console.log(`\n  worst over all speeds: ${(worst * 1000).toFixed(2)} mm/frame`
  + ` = ${(worst * 60 * 1000).toFixed(0)} mm/s of skate at 60 fps`);
console.log(worst < 0.0002
  ? '  Invisible. The foot is planted.'
  : worst < 0.012
    ? '  Residual — the pelvis moves the hip after the solve reads it. See legPlant.'
    : '  Skating. The stance foot is not the independent variable.');
