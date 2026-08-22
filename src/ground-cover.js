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
import { cardMask, paintedStandard, stopsFrom } from './painted.js';
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
 *     tree wood        338 400      490 140
 *     ground cover     331 236      331 236      ← this file
 *     tree foliage     188 820      324 080
 *     blossom           56 255      177 670
 *     everything else  432 119      432 446
 *     ─────────────────────────────────────
 *     total          1 346 830    1 755 572      (61% and 80% of 2.2 M)
 *
 * A snapshot, not a contract: those rows move whenever anything above them
 * does. What this file owes is its own row and the rule that sets it.
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

  // --- materials -----------------------------------------------------------
  //
  // Two things changed here and both were bugs rather than taste.
  //
  // **The five minerals were five hardcoded HSL constants** — `shard` was
  // `setHSL(0.55, …)`, which is *blue*, on every world in the universe. §9.1
  // is explicit that there is no default palette and that every colour is
  // derived per world; five literals nailed to the file are the exact thing it
  // forbids, and a pale blue cone on an ochre desert is what it looks like.
  // They are tints of the world's own rock colour now, so a boulder belongs to
  // the ground it is sitting on.
  //
  // **The plant material had `alphaTest: 0.35` and no alphaMap.** Alpha was
  // uniformly 1.0, the test passed at every texel, and every plant rendered as
  // an opaque rectangle — a few hundred hard-edged dark quads per frame at
  // every angle, which is the single most conspicuous artefact in a surface
  // capture. `cardMask()` generates the silhouette the comments always assumed
  // was there (§2.1: on-device, from `hash(seed, …)`).
  //
  // And both now light through §9.2 rather than through three's PBR, which is
  // what `docs/plans/M2.md` §24.4 says is the fix for "the rocks read as
  // near-black silhouettes" — a failure that section records and leaves open.
  // The terrain's own light and its own shadow map, so a boulder and the
  // ground it sits on cannot disagree about where the sun is or what is in
  // shade (§9.2: one function, one light).
  const wiring = s.paintWiring();
  const light = s._paintLight
    ? { sun: [...s._paintLight.uniforms.sun.value], shadowTint: [...s._paintLight.uniforms.sh.value] }
    : { sun: [1, 0.84, 0.61], shadowTint: [0.36, 0.43, 0.62] };
  const arr = (c, f) => [(c?.r ?? f[0]), (c?.g ?? f[1]), (c?.b ?? f[2])];
  const rockBase = arr(pp.colB, [0.42, 0.40, 0.38]);
  const soilBase = arr(pp.colA, [0.34, 0.27, 0.20]);
  const vegBase = arr(pp.colC, [0.30, 0.42, 0.24]);

  /**
   * A mineral, as a tint of this world's rock.
   *
   * `k` is brightness against the world's stone and `warmth` slides it toward
   * the soil — scree is stone freshly broken and stays stone; crust is stone
   * that has been weathering in the dirt for an age and has taken its colour.
   */
  const mineral = (k, warmth, look, params) => {
    const base = rockBase.map((v, i) => (v * (1 - warmth) + soilBase[i] * warmth) * k);
    return paintedStandard(
      { color: new THREE.Color(base[0], base[1], base[2]), flatShading: true, ...params },
      wiring,
      // Stone barely shifts hue and takes a hard band edge; §9.2's `soft` is
      // what separates a mineral from a leaf as much as the colour does.
      { ...stopsFrom(base, light, { warm: 0.10, cool: 0.16, range: 0.30 }),
        soft: 0.085, jit: 0.05, rim: 0.30, ambient: 1.0, ...look });
  };

  // One mask per species, generated once per world. Six 64x64 RGBA masks is
  // 96 KB of device memory and, per §2.1, zero bytes shipped.
  const masks = new Map();
  const maskFor = (id) => {
    if (!masks.has(id)) masks.set(id, cardMask(id, seed));
    return masks.get(id);
  };

  const mats = {
    boulder: mineral(0.78, 0.22),
    scree: mineral(0.92, 0.10),
    // A shard is a fractured crystal face: brighter, cooler, and the one
    // mineral allowed a real rim, because a broken edge catching a low sun is
    // the whole reason it is worth drawing.
    shard: mineral(1.18, 0.0, { rim: 0.85, soft: 0.06 }),
    // The one mineral that is a card rather than a solid, and so the one that
    // needs the mask for the same reason the plants do: a 2.6 m opaque quad
    // lying on the floor has a straight edge, and no patch of sand does.
    ripple: mineral(1.06, 0.70, { rim: 0.18, soft: 0.14 },
      { alphaMap: maskFor('ripple'), alphaTest: 0.3, side: THREE.DoubleSide }),
    crust: mineral(0.62, 0.55, { rim: 0.22 }),
  };

  /**
   * A plant, which is the material that most needed §9.2.
   *
   * `trans` is the subsurface term: a leaf edge-on to a low sun transmits
   * rather than reflects, and §9.2 calls that the difference between foliage
   * and green cardboard. `rim` is high for the same reason — the backlight is
   * "the connective tissue of the whole image" and a card is nearly all rim.
   */
  const plantMats = new Map();
  const plantMat = (id) => {
    if (plantMats.has(id)) return plantMats.get(id);
    // each species sits a little off the world's vegetation colour, so a
    // meadow is a mosaic rather than one green (§9.5)
    const j = new RNG(hash(seed, 0x91a7, id.length));
    const base = vegBase.map((v) => v * j.float(0.82, 1.18));
    const m = paintedStandard(
      {
        color: new THREE.Color(base[0], base[1], base[2]),
        alphaMap: maskFor(id),
        alphaTest: 0.42,
        side: THREE.DoubleSide,
        flatShading: false,
      },
      wiring,
      {
        ...stopsFrom(base, light, { warm: 0.34, cool: 0.20, range: 0.24 }),
        soft: 0.16, jit: 0.10, rim: 0.95, ambient: 1.0,
        trans: 0.85,
        // light coming through a leaf is yellow-green, never the leaf's own
        // colour brightened — §9.5's root-to-tip path, at the far end
        transCol: [base[0] * 1.7 + 0.10, base[1] * 2.0 + 0.16, base[2] * 0.7],
      });
    plantMats.set(id, m);
    return m;
  };

  const group = new THREE.Group();
  const d = new THREE.Object3D();
  let drawn = 0, placed = 0;
  for (const [id, list] of byKind) {
    const isMineral = MINERALS.some((m) => m.id === id);
    const mesh = new THREE.InstancedMesh(geo(id), isMineral ? mats[id] : plantMat(id), list.length);
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
