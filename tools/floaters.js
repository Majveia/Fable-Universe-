// What is in the sky that should not be — CLAUDE.md §8 axis 8.
//
//   node tools/floaters.js
//   node tools/floaters.js --seed 29adc329273b929f --clear 3 --near 900
//
// `docs/captures/blind/SCORE.md` scored axis 8 a **2 in both frames**, for one
// object and the same sentence twice: *"the dark polyhedron at centre-top has
// no shadow, no ground contact and no scale reference."* Two blind reviews of
// two different builds, agreeing on the defect, and neither able to say what the
// object was — because a still shows you a shape and not a scene graph.
//
// So this asks the scene instead. It walks every mesh at surface scale, finds
// the terrain height under each one, and reports anything whose lowest vertex
// sits clear of the ground by more than a threshold. The answer to "what is
// that" is then a constructor name and a geometry, not a guess from a
// silhouette.
//
// It needs no rendered frame — like `tools/drawcensus.js` and for the same
// reason. It reads what was built, not what came back, so a software rasteriser
// that cannot draw the scene can still be asked what is in it.
//
// ---------------------------------------------------------------------------
// The unit is an assembly, not a mesh — and getting that wrong came first
//
// The first version measured every mesh independently and reported 28 floaters
// on the first world it looked at: cylinders 92 m up, cones at 117 m, boxes at
// 66 m. All of them real objects, none of them floating. They were the upper
// storeys and roofs of a settlement, and a roof on a hundred-metre tower is
// exactly as clear of the ground as a roof with nothing under it.
//
// A mesh cannot answer "does this touch the ground". Only the assembly can. So
// the walk aggregates to the nearest ancestor under the scene root — the group a
// settlement, a tree or a craft is built as — and asks whether *any part of it*
// reaches the terrain. What is left after that is the thing §8 axis 8 means.
//
// ---------------------------------------------------------------------------
// Why "clear of the ground" and not "above the ground"
//
// Plenty of things are legitimately above the terrain: clouds, the sun disc,
// the sky dome, a moon, a bird if there were one, and the whole of the M5
// skiff while it is flying. Height alone would report the sky as a defect.
//
// The test is the *gap*: the distance from a mesh's lowest point down to the
// terrain beneath it, with anything above `--ceiling` metres treated as sky and
// skipped. What §8 axis 8 scores is an object with **no ground contact and no
// scale reference** — something the size of a house hanging thirty metres up
// with nothing between it and the grass. That is a gap, at a human scale, close
// enough to read. The default thresholds say exactly that: more than 2 m of air
// under it, within 900 m of the camera, and below 400 m up.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { arg, launch, playwright, serve, REPO } from './lib.js';

/**
 * The seed, and a trap worth naming.
 *
 * `src/main.js` reads it with `parseInt`, so `?seed=29adc329273b929f` — the
 * string `docs/captures/blind/key.json` records — resolves to the integer
 * **29**. That is not this tool's behaviour to fix; §2.4 makes every URL a
 * permanent address and 29 is the world those captures are of. But a `--seed`
 * that silently means something else is the kind of quiet wrongness this
 * directory keeps finding, so the effective value is printed rather than
 * assumed, and the route is resolved from `window.AEON.seed` — what the page
 * actually used — rather than from the string handed in.
 */
const SEED = String(arg('seed', '29adc329273b929f'));
const CLEAR = Number(arg('clear', 2));
const NEAR = Number(arg('near', 900));
const CEILING = Number(arg('ceiling', 400));
const BUDGET = Number(arg('timeout', 900)) * 1000;
const extra = String(arg('flags', '') || '');

const pw = await playwright();
const { origin, close } = await serve();
const browser = await launch(pw);
const page = await browser.newPage({ viewport: { width: 320, height: 180 } });

// The cheap preset, for the same reason `tools/glimpse.js` has one: the scene
// graph this walks is the same whether or not the machine can draw it, and a
// software rasteriser asked to build twelve million blades will not get to the
// walk. Grass is not a floater — it is seated on the ground by construction —
// so removing it removes nothing this tool looks at.
const CHEAP = 'q=low&grass=0.01,0.01,0.006,0.006&blades=1,1,1,1&wind=64'
  + '&shres=512&shtaps=1&qd=10&qr=17&vc=0';

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

/**
 * The station, resolved from the seed rather than pasted in.
 *
 * `tools/capture.js` derives its itinerary in-page from the same pure
 * generators the universe uses, so the route is a property of the seed. This
 * borrows that exactly — otherwise `--seed` would be a lie: it would change the
 * world and leave the deep link pointing at a galaxy that seed does not have,
 * which is how the first run of this tool spent fifteen minutes measuring the
 * cosmic web.
 */
async function resolveStation() {
  if (arg('at', '') !== '' && arg('at', '') !== true) return String(arg('at'));
  const p = await browser.newPage();
  await p.goto(origin + '/index.html?seed=' + SEED, { waitUntil: 'domcontentloaded' });
  await p.addScriptTag({ type: 'module', content: `
    import { hash } from '${origin}/src/rng.js';
    import { galaxyParams } from '${origin}/src/galaxy.js';
    import { systemParams } from '${origin}/src/system.js';
    const seed = window.AEON?.seed ?? 0;
    const galaxySeed = hash(seed, 0xbe0) >>> 0;
    const gp = galaxyParams(galaxySeed);
    for (let i = 0; i < 4096; i++) {
      const starSeed = hash(gp.seed, i, 0x57a9) >>> 0;
      const sp = systemParams(starSeed);
      const rocky = sp.planets.findIndex((pl) => pl.typeId <= 4);
      if (rocky >= 0) { window.__route = { galaxySeed, starSeed, rocky }; break; }
    }
  ` });
  await p.waitForFunction('window.__route', null, { timeout: 120000 });
  const r = await p.evaluate(() => window.__route);
  await p.close();
  return `g=${r.galaxySeed}&s=${r.starSeed}&p=${r.rocky}`;
}

const where = await resolveStation();
const flags = mergeFlags(CHEAP, extra);
const url = `/index.html?seed=${SEED}&${where}&dt=0.0166&${flags}`;
console.log(`floaters · ${url}`);
console.log(`  gap > ${CLEAR} m · within ${NEAR} m · below ${CEILING} m`);

await page.goto(origin + url, { waitUntil: 'domcontentloaded' });

let out;
try {
  await page.waitForFunction(
    () => !!(window.AEON?.stack?.length
      && /Surface/.test(window.AEON.stack[window.AEON.stack.length - 1].constructor.name)),
    null, { timeout: BUDGET });
  // three through the page's own import map, exactly as every module in src/
  // receives it. The first version reached for a Box3 via
  // `terrain.children[0].geometry.boundingBox` and found null, because nothing
  // in this renderer ever calls computeBoundingBox() on a tile — the quadtree
  // knows where its tiles are without asking geometry.
  await page.addScriptTag({ type: 'module', content:
    `import * as THREE from 'three'; window.__THREE = THREE;` });
  await page.waitForFunction('window.__THREE', null, { timeout: 60000 });
  await page.evaluate((n) => window.AEON.haltAt((window.AEON.frames || 0) + n), 2);
  await page.waitForFunction(() => window.AEON._haltAt && window.AEON.frames >= window.AEON._haltAt,
    null, { timeout: BUDGET });

  out = await page.evaluate(({ CLEAR, NEAR, CEILING }) => {
    const st = window.AEON.stack;
    const s = st[st.length - 1];
    const cam = { x: s.body?.x ?? 0, y: s.body?.y ?? 0, z: s.body?.z ?? 0 };
    const rows = [];

    const B3 = window.__THREE?.Box3;
    if (!B3) return { error: 'no Box3 — three did not resolve through the import map' };

    // The assembly an object belongs to: its highest ancestor below the scene
    // root. That is the unit a settlement, a tree, a craft or a figure is built
    // as, and the unit "does this touch the ground" is a question about.
    const assemblyOf = (o) => {
      let a = o;
      while (a.parent && a.parent !== s.scene) a = a.parent;
      return a;
    };

    const groups = new Map();
    s.scene.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      if (!o.visible) return;
      // an invisible ancestor hides it just as thoroughly
      for (let a = o.parent; a && a !== s.scene; a = a.parent) if (!a.visible) return;
      const a = assemblyOf(o);
      let e = groups.get(a);
      if (!e) {
        e = { root: a, parts: 0, caster: false, geos: new Map(), instances: 0, mats: new Set() };
        groups.set(a, e);
      }
      e.parts++;
      e.instances += o.isInstancedMesh ? o.count : 1;
      if (o.material) e.mats.add(Array.isArray(o.material) ? 'array' : o.material.type);
      if (o.layers && (o.layers.mask & (1 << 3))) e.caster = true;
      const g = o.geometry?.type || '?';
      e.geos.set(g, (e.geos.get(g) || 0) + 1);
    });

    for (const [root, e] of groups) {
      let b;
      try { b = new B3().setFromObject(root); } catch (err) { continue; }
      if (!isFinite(b.min.y) || !isFinite(b.max.y)) continue;
      const cx = (b.min.x + b.max.x) * 0.5, cz = (b.min.z + b.max.z) * 0.5;
      const dist = Math.hypot(cx - cam.x, cz - cam.z);
      if (!isFinite(dist) || dist > NEAR) continue;
      // the sky dome, the sun, the moons: anything whose whole extent is above
      // the ceiling is weather, not a floater
      if (b.min.y > CEILING) continue;
      // Sample the terrain under several points of the footprint, not only the
      // centre. A settlement straddling a slope has ground contact at its
      // downhill edge and forty metres of air under its uphill one, and the
      // centre alone would call that a floater on half the worlds it lands on.
      let hi = -Infinity;
      for (const [fx, fz] of [[0.5, 0.5], [0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0], [0, 0.5], [1, 0.5], [0.5, 1]]) {
        const x = b.min.x + (b.max.x - b.min.x) * fx;
        const z = b.min.z + (b.max.z - b.min.z) * fz;
        let g = null;
        try { g = s.heightAt(x, z); } catch (err) { g = null; }
        if (g !== null && isFinite(g) && g > hi) hi = g;
      }
      if (!isFinite(hi)) continue;
      const gap = b.min.y - hi;
      if (gap <= CLEAR) continue;
      const size = Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z);
      const geos = [...e.geos.entries()].sort((p, q) => q[1] - p[1])
        .map(([g, n]) => (n > 1 ? `${g.replace('Geometry', '')}x${n}` : g.replace('Geometry', '')));
      rows.push({
        kind: root.constructor.name,
        geo: geos.join(' '),
        name: root.name || '',
        parts: e.parts,
        instances: e.instances,
        gap, dist, size,
        y: b.min.y, ground: hi,
        caster: e.caster,
        mats: [...e.mats].join(','),
        box: [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].map((v) => +v.toFixed(1)),
      });
    }
    rows.sort((a, b2) => (b2.size / Math.max(b2.dist, 1)) - (a.size / Math.max(a.dist, 1)));
    return {
      rows,
      cam,
      total: rows.length,
      landform: s.landform?.id ?? '?',
      isles: s.landform?.floatingIsles ?? null,
      seed: window.AEON.seed,
    };
  }, { CLEAR, NEAR, CEILING });
} catch (e) {
  console.error(`  did not settle: ${String(e).slice(0, 150)}`);
  out = { error: String(e).slice(0, 150), rows: [] };
}

await browser.close();
await close();

if (out.error) { console.error(`floaters · ${out.error}`); process.exit(1); }

console.log(`\n  seed ${out.seed} · landform ${out.landform} · floatingIsles ${out.isles}`
  + ` · eye at ${out.cam.x.toFixed(0)}, ${out.cam.y.toFixed(1)}, ${out.cam.z.toFixed(0)}`);
if (!out.rows.length) {
  console.log('\nfloaters · nothing clear of the ground · §8 axis 8 has no target here');
} else {
  // Sorted by angular size, because that is what a still is scored on: a barn
  // at 800 m loses fewer points than a boulder at 12 m.
  console.log(`\n  ${'assembly'.padEnd(14)} ${'parts'.padStart(5)} ${'geometry'.padEnd(30)}`
    + ` ${'gap'.padStart(8)} ${'dist'.padStart(7)} ${'size'.padStart(7)} ${'ang'.padStart(6)}  casts`);
  for (const r of out.rows.slice(0, 40)) {
    const ang = (r.size / Math.max(r.dist, 1)) * (180 / Math.PI);
    console.log(`  ${(r.name || r.kind).slice(0, 14).padEnd(14)} ${String(r.parts).padStart(5)}`
      + ` ${r.geo.slice(0, 30).padEnd(30)}`
      + ` ${r.gap.toFixed(1).padStart(7)}m ${r.dist.toFixed(0).padStart(6)}m`
      + ` ${r.size.toFixed(1).padStart(6)}m ${ang.toFixed(1).padStart(5)}°`
      + `  ${r.caster ? 'yes' : 'NO'}`);
    // The identifying line. A silhouette says "dark polyhedron"; this says
    // which InstancedMesh, how many of it, what lights it and where it sits.
    console.log(`  ${''.padEnd(14)} ${String(r.instances).padStart(5)} instances`
      + ` · ${r.mats} · y ${r.box[1]} to ${r.box[4]}`
      + ` · ground ${r.ground.toFixed(1)} m`);
  }
  console.log(`\nfloaters · ${out.total} object(s) clear of the ground`
    + ` · "casts NO" is §8 axis 8's actual complaint: no shadow means no contact`);
}

const dir = join(REPO, 'docs/captures/glimpse');
await mkdir(dir, { recursive: true });
await writeFile(join(dir, 'floaters.json'),
  JSON.stringify({ url, clear: CLEAR, near: NEAR, ceiling: CEILING, ...out }, null, 2) + '\n');
