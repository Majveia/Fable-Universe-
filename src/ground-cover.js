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
import { MINERALS, SPECIES, mineralChunk, scatterChunk } from './scatter.js';

/** how far out we furnish, and how big a chunk is, in metres */
const REACH = 420;
const CHUNK = 32;

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
  for (let x = cx - REACH; x <= cx + REACH; x += CHUNK) {
    for (let z = cz - REACH; z <= cz + REACH; z += CHUNK) {
      for (const m of mineralChunk({
        x0: x, z0: z, size: CHUNK, seed, world, budget: 14, groundAt: ground,
      })) push(m.id, m);
      for (const p of scatterChunk({
        x0: x, z0: z, size: CHUNK, seed, biome, budget: 26, groundAt: ground,
      })) push(p.id, p);
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
