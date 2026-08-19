// The furniture every world gets, whether or not anything lives on it.
//
// `scatter.js` decides *what* is on the ground and where; this puts it there.
// The split is the same one `conjure.js` and `tree.js` make — the model is
// arithmetic and testable, and exactly one file turns numbers into meshes.
//
// It exists because gating the meadow on `isBiosphere` was correct and made
// things worse: a 28 K ice world went from metres of impossible blue grass to
// bare ground to the horizon. Both are wrong, and the second is the one that
// reads as unfinished.
//
// One instanced mesh per kind, so a world of rock costs five draw calls (§5's
// surface budget is 900). Chunks are placed once at build around the landing
// site rather than streamed: the tile is 1400 m and fixed, so streaming would
// be machinery in service of nothing.

import * as THREE from 'three';
import { RNG, hash } from './rng.js';
import {
  COVER_NEAR, MINERALS, SPECIES, coverDensity, mineralChunk, scatterChunk,
} from './scatter.js';

/** how far out we furnish, and how big a chunk is, in metres */
const REACH = 420;
const CHUNK = 32;

/**
 * What a chunk may spend at full density — §9.5's `B`, before the distance law.
 *
 * These are budgets for the *rejection sampler*, not object counts: both chunk
 * functions throw candidates at their own noise field and keep the ones that
 * land, and the acceptance rate runs around one in seven. So the number that
 * reaches the ground is roughly a seventh of this, which is the point — the
 * drift has to be the field's shape and not the budget's.
 *
 * ---------------------------------------------------------------------------
 * What the number is, and what decided it
 *
 * §5's ceiling is 2.2 M triangles per frame and it is not qualified by tier —
 * the tiers differ in the frame rate they must hit, not in how many triangles
 * a frame may contain. So the budget is a total, and backdrop furniture gets
 * a stated share of it rather than whatever looked right: **at most 15%**,
 * which is 330 000 triangles.
 *
 * That was not affordable when this was written. Desktop trees carried their
 * full crown at every distance — 33 342 leaf clumps, 666 840 triangles — and
 * furniture had to take what was left, which briefly made the *better* tier
 * get the smaller number. `life.js` now thins distant crowns by the same law
 * this file uses, which refunded 372 120 triangles on desktop, and the 15%
 * share fits on both tiers. One number, no tier branch, which is what it
 * should have been.
 *
 * Measured on Kerune III in full bloom, scene triangles:
 *
 *                        low        desktop
 *     tree foliage     167 640      294 720
 *     tree wood        283 700      423 940
 *     blossom           64 130      177 860
 *     ground cover     331 236      331 236      ← this file
 *     everything else  446 899      447 526
 *     ─────────────────────────────────────
 *     total          1 293 605    1 675 282      (59% and 76% of 2.2 M)
 *
 * These are scene triangles, which for this file *are* frame triangles: one
 * instanced mesh per kind spans the whole 840 m disc, so the frustum never
 * culls it — it is drawn entirely or not at all.
 */
const BASE_ROCK = 740;
const BASE_PLANT = 1230;

/**
 * Both communities, placed.
 *
 * `world` carries what both models ask about: surface temperature, moisture,
 * air, and the light the ground gets. A world is furnished with rock always and
 * with plants only where the plant model says they can live, which is why an
 * ice world comes back with shards and boulders and no sward.
 */
export function addGroundCover(s) {
  const pp = s.pp;
  const seed = hash(pp.seed, 0x6c0e) >>> 0;
  const r = new RNG(seed);

  // Surface temperature with the same crude greenhouse `weather.js` uses, so
  // the two cannot disagree about whether this world is frozen.
  const surfaceK = (pp.Teq ?? 288) * (1 + 0.28 * Math.min(s.atmo, 3));
  const wet = pp.oceanLevel > -0.5 ? 0.72 : 0.18;
  const world = { surfaceK, wet, atmo: s.atmo };
  const biome = {
    wet, atmo: s.atmo,
    warm: Math.min(Math.max((surfaceK - 230) / 110, 0), 1),
    sun: Math.min(Math.max(1 - (pp.clouds ?? 0.3) * 0.8, 0), 1),
  };

  const ground = (x, z) => {
    const h = s.heightAt(x, z);
    if (s.seaLevel !== null && h < s.seaLevel) return null;   // nothing on water
    return h;
  };

  // gather across the reach, then build one mesh per kind
  const byKind = new Map();
  const push = (k, rec) => {
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(rec);
  };
  const cx = Math.round((s.spawn?.x ?? 0) / CHUNK) * CHUNK;
  const cz = Math.round((s.spawn?.z ?? 0) / CHUNK) * CHUNK;

  /**
   * A chunk's distance from the viewer, measured to its **nearest** point.
   *
   * Its centre would be wrong in the one place it matters: the chunk you are
   * standing at the edge of is 22 m away by its centre and 0 m away by the
   * ground under your boots, and thinning it as if it were 22 m puts a visible
   * hole exactly where the eye is. §9.5 makes the same call for the grass and
   * for the same reason — over-draw from the nearest corner, never the centre.
   */
  const nearestDist = (x, z) => {
    const dx = Math.max(x - cx, cx - (x + CHUNK), 0);
    const dz = Math.max(z - cz, cz - (z + CHUNK), 0);
    return Math.hypot(dx, dz);
  };

  for (let x = cx - REACH; x <= cx + REACH; x += CHUNK) {
    for (let z = cz - REACH; z <= cz + REACH; z += CHUNK) {
      // one law, evaluated once per chunk. Rings would be cheaper to reason
      // about and would put a density step at every ring boundary, which §9.5
      // is explicit about: rings exist to switch tessellation, never density.
      const f = coverDensity(nearestDist(x, z));
      const rock = Math.round(BASE_ROCK * f);
      const plant = Math.round(BASE_PLANT * f);
      if (rock >= 1) {
        for (const m of mineralChunk({
          x0: x, z0: z, size: CHUNK, seed, world, budget: rock, groundAt: ground,
        })) push(m.id, m);
      }
      if (plant >= 1) {
        for (const p of scatterChunk({
          x0: x, z0: z, size: CHUNK, seed, biome, budget: plant, groundAt: ground,
        })) push(p.id, p);
      }
    }
  }
  if (!byKind.size) return null;

  // --- geometry per kind ---------------------------------------------------
  // Rock is faceted low-poly on purpose: §9's illustrated look wants a readable
  // plane, not a displaced sphere, and a boulder that reads at 40 m needs about
  // twelve faces. Plants are cards, per the reference — a card is four vertices
  // whatever it is a picture of.
  const geo = (id) => {
    if (id === 'boulder') return new THREE.DodecahedronGeometry(0.5, 0);
    if (id === 'scree' || id === 'crust') return new THREE.TetrahedronGeometry(0.6, 0);
    if (id === 'shard') return new THREE.ConeGeometry(0.4, 1, 5);
    if (id === 'ripple') return new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const c = new THREE.PlaneGeometry(1, 1);
    c.translate(0, 0.5, 0);                 // a blade grows from its root
    return c;
  };

  const rock = (h, sat, l) => new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(h, sat, l), roughness: 1, flatShading: true,
  });
  const plantMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(pp.colC?.r ?? 0.3, pp.colC?.g ?? 0.42, pp.colC?.b ?? 0.24),
    roughness: 0.95, side: THREE.DoubleSide, transparent: true, alphaTest: 0.35,
    flatShading: true,
  });
  const mats = {
    boulder: rock(0.08, 0.10, 0.30), scree: rock(0.07, 0.12, 0.34),
    shard: rock(0.55, 0.16, 0.72), ripple: rock(0.10, 0.18, 0.52),
    crust: rock(0.03, 0.30, 0.18),
  };

  const group = new THREE.Group();
  const d = new THREE.Object3D();
  let drawn = 0, placed = 0;
  for (const [id, list] of byKind) {
    const isMineral = MINERALS.some((m) => m.id === id);
    const mesh = new THREE.InstancedMesh(geo(id), isMineral ? mats[id] : plantMat, list.length);
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      // A boulder sits *in* the ground, not on it — `bury` is the fraction sunk,
      // and without it every rock on the world looks dropped there this morning.
      const sink = isMineral ? o.h * (o.bury ?? 0.25) : 0;
      d.position.set(o.x, o.y - sink, o.z);
      d.rotation.set(o.tilt ?? o.lean ?? 0, o.yaw, 0);
      d.scale.set(o.w, o.h, o.w);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = false;
    group.add(mesh);
    drawn++; placed += list.length;
  }
  s.scene.add(group);
  console.info(`[ground] ${placed} across ${drawn} kinds · `
    + `${[...byKind.keys()].join(', ')} · ${surfaceK.toFixed(0)} K`);
  return { group, kinds: [...byKind.keys()], count: placed, draws: drawn };
}
