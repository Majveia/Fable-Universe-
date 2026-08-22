// Does §9.2 still compile onto a prop? — CLAUDE.md §M0, §9.2.
//
//   node tools/paintcheck.js
//
// `src/painted.js` injects `PAINT_GLSL` into an ordinary
// `MeshStandardMaterial` through `onBeforeCompile`. That is the right way to
// do it — instancing, the shadow map and depth sorting all keep working — and
// it has the failure mode of every string-splice: the program either compiles
// or it does not, and there is no way to know which by reading the source,
// because the shader does not exist until three has assembled it. §M0 makes
// exactly this argument about the renderer's own shaders:
//
//   "extract every shader string *as passed to gl.shaderSource*, not as it
//    reads in source, and compile-check it."
//
// `shadercheck.js` covers the shaders the app assembles by flying the bench
// route, and it takes forty minutes on a software rasteriser because it has to
// build six scales to reach them. This one builds nothing: three meshes, five
// materials, two frames, about twenty seconds. That difference is the whole
// point — a gate this cheap gets run before a commit rather than after a
// milestone.
//
// ---------------------------------------------------------------------------
// What it caught, on the first run
//
//   ERROR: 0:1914: 'getShadowMask' : no matching overloaded function found
//
// `getShadowMask()` is a lambert/phong chunk. It does not exist in a standard
// material, and calling it is a **compile error, not a fallback** — six
// programs died, every prop in the world rendered with a broken shader, and
// nothing in the console connected any of it to the change that caused it. It
// took a twenty-minute surface build to find, once. It takes twenty seconds to
// find now.
//
// ---------------------------------------------------------------------------
// The five paths, and why each is separate
//
// Every one of them assembles a *different* program, because three's defines
// are driven by what the material carries:
//
//   mineral, instanced              USE_INSTANCING, flat shading
//   card, instanced + alphaMap      + USE_ALPHAMAP, USE_UV, ALPHATEST, DoubleSide
//   non-instanced                   the branch without USE_INSTANCING, which the
//                                   vertex injection has to handle separately
//   mineral + sunShadow()           the production path: the terrain's shadow
//                                   chunk and its four uniforms spliced in
//   card + sunShadow()              both at once, which is what a world is
//
// A pass on one says nothing about the others, and the vertex splice in
// particular reads `instanceMatrix` behind an `#ifdef`.
//
// It also checks that something was actually *drawn*. A shader that compiles
// and outputs black is a green gate and a black world, and the lit fraction is
// the cheapest possible guard against it.

import { readFile } from 'node:fs/promises';
import { arg, launch, playwright, serve, REPO } from './lib.js';

const FIXTURE = '/tools/paintcheck.html';
const MIN_LIT = 0.02;

const pw = await playwright();
const { origin, close } = await serve();
const browser = await launch(pw);
const page = await browser.newPage({ viewport: { width: 300, height: 300 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
page.on('console', (m) => {
  const t = m.text();
  // a 404 for a favicon is not a defect and never was
  if (m.type() === 'error' && !/favicon|404/i.test(t)) errors.push(t.slice(0, 300));
});

await page.goto(origin + FIXTURE, { waitUntil: 'load' });
await page.waitForFunction(() => window.__result !== undefined, null,
  { timeout: Number(arg('timeout', 120)) * 1000 }).catch(() => {});

const r = await page.evaluate(() => window.__result);
await browser.close();
await close();

if (!r) {
  console.error('paintcheck · the fixture never finished — nothing was compiled, so nothing was checked');
  process.exit(2);
}

for (const name of r.results) console.log(`  ok   ${name}`);

let bad = 0;
if (r.fails.length) {
  bad = 1;
  console.error(`\n─── ${r.fails.length} shader failure${r.fails.length > 1 ? 's' : ''} ───`);
  for (const f of r.fails) console.error('  ' + String(f).split('\n').slice(0, 4).join('\n  '));
  console.error('\n§9.2 is not reaching the props. Every one of them is rendering with a\n'
    + 'broken program, and the console in the app will not say so.');
}
if (r.litFraction < MIN_LIT) {
  bad = 1;
  console.error(`\nthe frame is empty — ${(r.litFraction * 100).toFixed(2)}% of pixels lit, `
    + `below ${MIN_LIT * 100}%.\nA shader that compiles and outputs black is a green gate and a black world.`);
}
for (const e of errors) { bad = 1; console.error('  page error: ' + e); }

console.log(`\npaintcheck · ${r.results.length} programs · ${r.fails.length} failures`
  + ` · ${(r.litFraction * 100).toFixed(1)}% of the frame lit`
  + (bad ? ' · FAILED' : ' · clean'));
process.exit(bad);
