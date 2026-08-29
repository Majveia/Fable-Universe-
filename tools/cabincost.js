// What the cabin costs the driver — CLAUDE.md §5, §16 rule 2.
//
//   node tools/cabincost.js [--seed 7]
//
// §16 rule 2: *"Before proposing a feature, state its cost against §5."* The
// cabin is behind `?cab=1` and any conversation about flipping it has to start
// with a number, so this gets one.
//
// **What this can and cannot measure, stated first.**
//
// It counts what was *submitted* — draw calls, triangles, programs — which is
// the same reasoning `drawcensus.js` runs on: a submission count is a property
// of the scene graph and is identical on every rasteriser. Two of §5's three
// per-frame clauses are exactly that, so they are measurable here.
//
// The third is not. §5's frame-time and fps rows are GPU work, this container
// has SwiftShader, and CI *never* gates §5 (§14). Any millisecond printed here
// would be a number about a software rasteriser wearing the costume of a
// budget, so none is printed. That row stays open and says so.

import { arg, launch, playwright, serve } from './lib.js';

const SEED = arg('seed', '7');

const pw = await playwright();
const { origin, close } = await serve();
const browser = await launch(pw);
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });

/* Console errors count, not just thrown ones — and this is the clause that
   makes this tool a §M0 shader check for the cabin as well as a cost report.

   three does not throw on a shader that fails to compile; it logs
   "THREE.WebGLProgram: Shader Error" through console.error and carries on with
   a broken program. So a `pageerror` listener alone watches for the one
   symptom this particular defect does not produce. Since this file is the only
   thing in the repo that actually *renders* a cabin — `cabincheck.js` steps the
   scale but never draws it — a compile failure in `plated()`'s injected GLSL
   had nowhere else to surface. §M0 is explicit that shaders are checked
   post-assembly, and template-interpolated GLSL only exists post-assembly. */
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

try {
  await page.goto(`${origin}/?seed=${SEED}&cab=1&dt=16`, { timeout: 120000 });
  await page.waitForFunction('window.AEON && window.AEON.stack.length > 0',
    { timeout: 120000 });

  const r = await page.evaluate(`(async () => {
    const { CabinScale } = await import('/src/cabin.js');
    const { craftFor } = await import('/src/craft.js');
    const A = window.AEON;
    const R = A.renderer;

    const worlds = {
      Earth: { seed: 3, massE: 1, radiusE: 1, atmo: 1, name: 'e', color: 0x6f7f6a },
      Luna: { seed: 4, massE: 0.0123, radiusE: 0.273, atmo: 0, name: 'l', color: 0x9a9a92 },
      Big: { seed: 5, massE: 2.4, radiusE: 1.3, atmo: 1.6, name: 'b', color: 0x7a6f5a },
    };
    const out = {};
    for (const [n, pp] of Object.entries(worlds)) {
      const cs = new CabinScale(A, {
        planet: pp, system: {}, sunColor: 0xfff1ce, hostIndex: 0,
        craft: craftFor(pp), capture: 1435,
      });
      cs.enter();
      for (let i = 0; i < 5; i++) cs.update(1 / 60);
      // one honest frame straight at the renderer, no post chain: this is the
      // scene's own submission cost, which is the thing that belongs to it
      R.info.reset();
      R.render(cs.scene, cs.camera);
      const seatedCalls = (() => {
        // ...and again from the seat, which is the view that actually ships
        const helm = cs.spec.stations.find(q => q.id === 'helm');
        cs.crew = { ...cs.crew, mode: 'seated', seat: { eye: helm.seatEye, yaw: 0, id: 'helm' } };
        cs.update(1 / 60);
        R.info.reset();
        R.render(cs.scene, cs.camera);
        return { calls: R.info.render.calls, tris: R.info.render.triangles };
      })();
      /* Textures belonging to *this cabin*, not to the renderer.
         R.info.memory.textures is a renderer-wide count and the app has
         already uploaded its own — all generated, all legal under §2.1 — so
         reading it here attributed seventeen of somebody else's textures to a
         cabin that has none. The question is whether the cabin's own materials
         sample anything, so that is what is asked.
         (No backticks in here: this comment lives inside a template literal,
         which is the same trap parse.js exists to catch in GLSL.) */
      let ownTex = 0;
      cs.scene.traverse((o) => {
        const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of mats) {
          for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap',
            'aoMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'envMap']) {
            if (m[k]) ownTex++;
          }
        }
      });
      out[n] = {
        deck: +cs.spec.length.toFixed(2),
        objects: cs.scene.children.length,
        seated: seatedCalls,
        geometries: R.info.memory.geometries,
        textures: ownTex,
      };
      cs.dispose();
    }
    return out;
  })()`);

  console.log('\ncabin · §5 exposure — submission counts, not frame time\n');
  console.log('  world     deck      draws   triangles   geometries   own tex');
  for (const [n, v] of Object.entries(r)) {
    console.log(`  ${n.padEnd(9)} ${(v.deck + ' m').padEnd(8)} `
      + `${String(v.seated.calls).padStart(6)} `
      + `${String(v.seated.tris).padStart(11)} `
      + `${String(v.geometries).padStart(12)} `
      + `${String(v.textures).padStart(10)}`);
  }
  const worst = Math.max(...Object.values(r).map((v) => v.seated.calls));
  const wtri = Math.max(...Object.values(r).map((v) => v.seated.tris));
  const zeroTex = Object.values(r).every((v) => v.textures === 0);

  console.log('\n  §5 · ≤ 900 draw calls   → ' + `${worst} (${(worst / 900 * 100).toFixed(1)}% of budget)`);
  console.log('  §5 · ≤ 2.2 M triangles  → ' + `${(wtri / 1e6).toFixed(4)} M (${(wtri / 2.2e6 * 100).toFixed(2)}% of budget)`);
  console.log('  §2.1 · zero assets      → ' + (zeroTex
    ? 'the cabin\'s own materials sample no texture at all — the plate seams,'
      + '\n                            the weathering and the rim are analytic, so there is'
      + '\n                            nothing to generate and nothing to ship'
    : 'the cabin samples a texture, which §2.1 allows only if generated'));
  console.log('\n  §5 · ≤ 12 ms CPU, and the fps rows: NOT MEASURED. This container'
    + '\n       rasterises in software and §14 says CI never gates §5. A'
    + '\n       millisecond from SwiftShader is not a budget, so none is quoted.');
  console.log('\n  §M0 · every shader the cabin submits, compiled → '
    + (errors.length ? `${errors.length} ERROR(S)` : 'clean')
    + '\n       (three logs a failed compile rather than throwing, so this'
    + '\n        watches the console; the cabin was rendered three times above)');
  if (errors.length) {
    console.log(`\n  ${errors.join('\n  ')}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
  await close();
}
