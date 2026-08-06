// A threshold, and what waits past it.
//
// Near where you land stands a shrine you can actually enter: a colonnaded
// porch, a doorway, and — through it, past a fade — an enclosed hall. Rows of
// fluted columns hold a coffered ceiling; shafts of daylight fall from high
// clerestory windows onto a stone floor; and at the far end an altar-flame
// burns, warming the dark and throwing its light up the walls. Walk in and
// the world outside is shut away behind stone; walk to the door, or press
// esc, and it opens again onto the country. The one interior a great
// exterior needs to feel like a place people live, not a stage set.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture } from './nebula.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

// a fluted column with a base and a capital — never a naked cylinder
function columnGeometry(h, rad) {
  const parts = [];
  const base = new THREE.CylinderGeometry(rad * 1.35, rad * 1.5, h * 0.06, 12); base.translate(0, h * 0.03, 0); parts.push(base);
  const shaft = new THREE.CylinderGeometry(rad * 0.86, rad, h * 0.82, 16); shaft.translate(0, h * 0.47, 0); parts.push(shaft);
  const echinus = new THREE.CylinderGeometry(rad * 1.25, rad * 0.86, h * 0.05, 16); echinus.translate(0, h * 0.9, 0); parts.push(echinus);
  const abacus = new THREE.BoxGeometry(rad * 2.7, h * 0.06, rad * 2.7); abacus.translate(0, h * 0.95, 0); parts.push(abacus);
  return mergeGeos(parts);
}
function mergeGeos(list) {
  let total = 0; for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), idx = [];
  let vo = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    const gi = g.index ? g.index.array : null;
    if (gi) for (let i = 0; i < gi.length; i++) idx.push(gi[i] + vo);
    else for (let i = 0; i < g.attributes.position.count; i++) idx.push(vo + i);
    vo += g.attributes.position.count; g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return geo;
}

export function addInterior(s) {
  const pp = s.pp;
  if (pp.typeId > 4) return null;
  const r = new RNG(hash(pp.seed, 0x171e710));

  // a flat, dry site within a short walk of where you land
  const dry = (x, z) => s.seaLevel === null || s.heightAt(x, z) > s.seaLevel + 2;
  let site = null, bestVar = 1e9;
  for (let i = 0; i < 140; i++) {
    const th = r.float(0, 6.28), rad = r.float(55, 150);
    const x = s.spawn.x + Math.cos(th) * rad, z = s.spawn.z + Math.sin(th) * rad;
    if (!dry(x, z)) continue;
    const h = s.heightAt(x, z);
    const v = Math.abs(s.heightAt(x + 24, z) - h) + Math.abs(s.heightAt(x, z + 24) - h);
    if (v < bestVar) { bestVar = v; site = { x, z, h }; }
  }
  if (!site) return null;

  // orient the doorway toward where you land, so you can walk right up to it
  const face = Math.atan2(s.spawn.x - site.x, s.spawn.z - site.z);
  const cos = Math.cos(face), sin = Math.sin(face);
  // local→world: +Z is "out the door" (toward spawn), +X is to the door's right
  const L2W = (lx, lz) => ({ x: site.x + lx * cos + lz * sin, z: site.z - lx * sin + lz * cos });

  const HW = 22, HD = 16, WALL = 14;              // interior half-width/depth, wall height
  const floorY = site.h + 0.6;
  const group = new THREE.Group();
  group.position.set(site.x, site.h, site.z);
  group.rotation.y = face;
  s.scene.add(group);

  const stone = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.09, 0.14, 0.6), roughness: 0.94, flatShading: true });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.08, 0.12, 0.4), roughness: 0.96, flatShading: true });

  // stylobate + floor
  const styl = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 8, 1.4, HD * 2 + 8), stone);
  styl.position.set(0, 0.7, 0); group.add(styl);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(HW * 2, 0.4, HD * 2), dark);
  floor.position.set(0, floorY - site.h - 0.2, 0); group.add(floor);

  // walls (local frame): back, left, right solid; front split around a doorway
  const wallMat = stone;
  const wy = floorY - site.h + WALL / 2;
  const mkWall = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL, d), wallMat); m.position.set(x, wy, z); group.add(m); };
  mkWall(HW * 2 + 2, 1.5, 0, -HD);                       // back
  mkWall(1.5, HD * 2, -HW, 0);                           // left
  mkWall(1.5, HD * 2, HW, 0);                            // right
  const DOOR = 5;                                         // half-width of the doorway
  mkWall(HW - DOOR, 1.5, -(HW + DOOR) / 2, HD);          // front left of door
  mkWall(HW - DOOR, 1.5, (HW + DOOR) / 2, HD);           // front right of door
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(DOOR * 2 + 2, WALL - 8, 1.6), stone);
  lintel.position.set(0, floorY - site.h + WALL - (WALL - 8) / 2, HD); group.add(lintel);

  // coffered ceiling: a slab with a grid of recessed panels
  const ceil = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 2, 1.4, HD * 2 + 2), dark);
  ceil.position.set(0, floorY - site.h + WALL + 0.7, 0); group.add(ceil);
  const cofferN = (COARSE ? 3 : 5) * (COARSE ? 3 : 5);
  const coffers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stone, cofferN);
  { const d = new THREE.Object3D(); let i = 0; const nx = COARSE ? 3 : 5, nz = COARSE ? 3 : 5;
    for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
      d.position.set((ix / (nx - 1) - 0.5) * (HW * 1.7), floorY - site.h + WALL - 0.2, (iz / (nz - 1) - 0.5) * (HD * 1.7));
      d.scale.set(HW * 1.5 / nx, 0.6, HD * 1.5 / nz); d.updateMatrix(); coffers.setMatrixAt(i++, d.matrix);
    }
    coffers.count = i; group.add(coffers);
  }

  // colonnade: interior rows + a porch out front, all fluted with capitals
  const colGeo = columnGeometry(WALL - 1, 1.4);
  const rows = [-HW * 0.5, HW * 0.5], depths = COARSE ? 3 : 4;
  const nCol = rows.length * depths + 6;                 // + porch
  const cols = new THREE.InstancedMesh(colGeo, stone, nCol);
  { const d = new THREE.Object3D(); let i = 0;
    for (const cx of rows) for (let k = 0; k < depths; k++) {
      d.position.set(cx, floorY - site.h, -HD * 0.6 + k * (HD * 1.2 / (depths - 1)));
      d.scale.setScalar(1); d.updateMatrix(); cols.setMatrixAt(i++, d.matrix);
    }
    // porch: two rows of columns in front of the doorway
    for (const cx of [-HW * 0.6, -HW * 0.2, HW * 0.2, HW * 0.6]) {
      d.position.set(cx, floorY - site.h, HD + 6); d.scale.setScalar(1.05); d.updateMatrix(); cols.setMatrixAt(i++, d.matrix);
    }
    d.position.set(-HW * 0.6, floorY - site.h, HD + 12); d.updateMatrix(); cols.setMatrixAt(i++, d.matrix);
    d.position.set(HW * 0.6, floorY - site.h, HD + 12); d.updateMatrix(); cols.setMatrixAt(i++, d.matrix);
    cols.count = i; group.add(cols);
  }
  // porch entablature + pediment
  const arch = new THREE.Mesh(new THREE.BoxGeometry(HW * 1.5, 2.2, 2.4), stone);
  arch.position.set(0, floorY - site.h + WALL - 1, HD + 9); group.add(arch);
  const ped = new THREE.Mesh(new THREE.CylinderGeometry(0.1, HW * 0.8, 4, 3), stone);
  ped.rotation.z = Math.PI; ped.scale.set(1, 1, 0.5);
  ped.position.set(0, floorY - site.h + WALL + 1.6, HD + 9); ped.rotation.y = Math.PI / 2; group.add(ped);

  // the altar: a plinth, a brazier, a flame, and a light that fills the hall
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 4), stone);
  plinth.position.set(0, floorY - site.h + 1.5, -HD * 0.6); group.add(plinth);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 1.2, 1.4, 12), dark);
  bowl.position.set(0, floorY - site.h + 3.7, -HD * 0.6); group.add(bowl);
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture(64), color: new THREE.Color(1.6, 1.05, 0.5),
    transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  flame.position.set(0, floorY - site.h + 5.2, -HD * 0.6); flame.scale.setScalar(6); group.add(flame);
  const light = new THREE.PointLight(new THREE.Color(1.0, 0.72, 0.4), 0, 90, 2);
  light.position.copy(flame.position); group.add(light);
  // an idol behind the altar
  const idol = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, WALL * 0.55, 6), stone);
  idol.position.set(0, floorY - site.h + WALL * 0.28, -HD + 2); group.add(idol);
  const idolHead = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), stone);
  idolHead.position.set(0, floorY - site.h + WALL * 0.55 + 1, -HD + 2); group.add(idolHead);

  // clerestory light-shafts: slanted additive beams from high windows to floor
  const shafts = [];
  const shaftMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(1.0, 0.92, 0.7), transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  for (let i = 0; i < (COARSE ? 2 : 4); i++) {
    const sx = (i / 3 - 0.5) * HW * 1.2;
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(4, WALL * 1.5), shaftMat.clone());
    beam.position.set(sx, floorY - site.h + WALL * 0.5, -HD * 0.2 + i * 4);
    beam.rotation.set(0.5, 0.3, 0.2);
    group.add(beam);
    shafts.push(beam);
  }

  // world-space doorway points: the threshold you cross, and where you land
  // on each side (deep enough in / far enough out that you don't bounce back)
  const doorThresh = L2W(0, HD);        // the doorway line
  const inPlace = L2W(0, HD - 11);      // well inside the hall
  const outPlace = L2W(0, HD + 13);     // out on the approach
  // interior bounds in world space (axis-aligned box around the site is fine —
  // the hall is roughly centred on the site)
  const bounds = { r: HW - 2, d: HD - 2, cx: site.x, cz: site.z, cos, sin };
  // clamp a world point to the interior, in the shrine's own frame
  bounds.clamp = (x, z) => {
    const dx = x - site.x, dz = z - site.z;
    let lx = dx * cos - dz * sin, lz = dx * sin + dz * cos;   // world→local (inverse rot)
    lx = Math.min(Math.max(lx, -HW + 2), HW - 2);
    lz = Math.min(Math.max(lz, -HD + 2), HD - 2);
    return { x: site.x + lx * cos + lz * sin, z: site.z - lx * sin + lz * cos };
  };

  let t = 0;
  return {
    site, floorY, doorThresh, inPlace, outPlace, bounds,
    update(dt, sunY, inside) {
      t += dt;
      const day = Math.min(Math.max((sunY + 0.1) * 3, 0), 1);
      flame.scale.setScalar(5.5 + Math.sin(t * 9) * 0.6 + Math.sin(t * 13.7) * 0.3);
      flame.material.opacity = 0.85 + 0.15 * Math.sin(t * 11);
      light.intensity = (inside ? 2.6 : 0.8) * (1.1 + 0.12 * Math.sin(t * 10));
      for (let i = 0; i < shafts.length; i++)
        shafts[i].material.opacity = day * (inside ? 0.5 : 0.12) * (0.7 + 0.3 * Math.sin(t * 0.6 + i));
    },
  };
}
