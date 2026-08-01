// Something grazes the far hills.
//
// Out past the meadow, herds of slender grazers move over the high ground —
// heads down in the grass, drifting as a loose band. Come too close and the
// whole herd startles as one: heads up, then away at a bound, spilling over
// the ridge before settling to graze again a safe distance off. They keep to
// the hills and away from the town, and they remember to be afraid of you.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { isBiosphere } from './life.js';
import { airOf, applyAerial } from './aerial.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const EXT = 1400;

// one grazer: a lean body, a lifted neck, a small head, four thin legs —
// built into a single geometry so a whole herd is one instanced draw
function grazerGeometry(pp) {
  const parts = [];
  const push = (geo, x, y, z, sx, sy, sz, rz = 0) => {
    geo.scale(sx, sy, sz); geo.rotateZ(rz); geo.translate(x, y, z);
    parts.push(geo);
  };
  push(new THREE.SphereGeometry(0.5, 7, 5), 0, 1.15, 0, 1.7, 0.75, 0.7);      // body
  push(new THREE.CylinderGeometry(0.13, 0.2, 1.0, 5), 1.0, 1.55, 0, 1, 1, 1, -0.7); // neck
  push(new THREE.BoxGeometry(0.4, 0.28, 0.24), 1.5, 1.95, 0, 1, 1, 1);        // head
  for (const [lx, lz] of [[0.55, 0.3], [0.55, -0.3], [-0.55, 0.3], [-0.55, -0.3]]) {
    push(new THREE.CylinderGeometry(0.07, 0.05, 1.2, 4), lx, 0.6, lz, 1, 1, 1);
  }
  // merge
  let total = 0;
  for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3);
  const idx = [];
  let vo = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx.push(gi[i] + vo);
    vo += g.attributes.position.count;
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setIndex(idx);
  return geo;
}

export function addHerds(s) {
  const pp = s.pp;
  if (!isBiosphere(pp) || (pp.res?.vegX ?? 1) < 0.2) return null;
  const r = new RNG(hash(pp.seed, 0x8e4d5));

  const dryHill = (x, z) => {
    const h = s.heightAt(x, z);
    if (s.seaLevel !== null && h < s.seaLevel + 4) return null;
    return h;
  };

  // scatter a couple of herds on the high ground, away from the town
  const herds = [];
  for (let i = 0; i < 200 && herds.length < (COARSE ? 2 : 3); i++) {
    const th = i * 2.399963, rad = 260 + (i / 200) * EXT * 0.9;
    const x = s.spawn.x + Math.cos(th) * rad, z = s.spawn.z + Math.sin(th) * rad;
    if (dryHill(x, z) === null) continue;
    if (s.settlement && Math.hypot(x - s.settlement.site.x, z - s.settlement.site.z) < 240) continue;
    if (herds.some(o => Math.hypot(o.cx - x, o.cz - z) < 300)) continue;
    herds.push({ cx: x, cz: z, n: r.int(6, COARSE ? 8 : 12), flee: 0 });
  }
  if (!herds.length) return null;

  const totalN = herds.reduce((a, h) => a + h.n, 0);
  const geo = grazerGeometry(pp);
  const mat = applyAerial(new THREE.MeshStandardMaterial({
    color: pp.colC.clone().lerp(new THREE.Color(0.5, 0.42, 0.32), 0.55),
    roughness: 0.9, flatShading: true,
  }), airOf(s), { name: 'herds/addHerds' });
  const mesh = new THREE.InstancedMesh(geo, mat, totalN);
  mesh.frustumCulled = false;
  s.scene.add(mesh);

  const animals = [];
  const d = new THREE.Object3D();
  for (const hd of herds) {
    for (let i = 0; i < hd.n; i++) {
      const a = { herd: hd,
        x: hd.cx + r.gauss() * 18, z: hd.cz + r.gauss() * 18,
        head: r.float(0, 6.28), vx: 0, vz: 0,
        graze: r.float(0, 6.28), pace: r.float(0.85, 1.2) };
      animals.push(a);
    }
  }

  let t = 0;
  return {
    herds: herds.length,
    _bands: herds,   // exposed for verification: {cx,cz,flee,n}
    update(dt, sunY) {
      t += dt;
      const bodyX = s.body.x, bodyZ = s.body.z;
      for (const hd of herds) {
        // is the wanderer inside the herd's comfort? startle the whole band
        const dc = Math.hypot(bodyX - hd.cx, bodyZ - hd.cz);
        if (dc < 55) hd.flee = 1;
        else hd.flee = Math.max(0, hd.flee - dt * 0.4);
      }
      let ai = 0;
      for (const a of animals) {
        const hd = a.herd;
        // herd cohesion — drift toward the band's slowly-moving center
        let ax = (hd.cx - a.x) * 0.02, az = (hd.cz - a.z) * 0.02;
        if (hd.flee > 0.02) {
          // flee directly away from the traveler, fast
          const dx = a.x - bodyX, dz = a.z - bodyZ, dl = Math.hypot(dx, dz) || 1;
          ax += dx / dl * 26; az += dz / dl * 26;
        } else {
          // graze: a slow random wander
          ax += Math.cos(t * 0.3 + a.graze) * 0.6;
          az += Math.sin(t * 0.27 + a.graze) * 0.6;
        }
        a.vx += (ax - a.vx) * Math.min(dt * 3, 1);
        a.vz += (az - a.vz) * Math.min(dt * 3, 1);
        const sp = Math.hypot(a.vx, a.vz);
        const cap = hd.flee > 0.02 ? 22 : 2.2;
        if (sp > cap) { a.vx *= cap / sp; a.vz *= cap / sp; }
        a.x += a.vx * dt; a.z += a.vz * dt;
        if (sp > 0.3) a.head = Math.atan2(a.vx, a.vz);
        const h = Math.max(s.heightAt(a.x, a.z), s.seaLevel === null ? -1e9 : s.seaLevel);
        // a bound when fleeing, a head-bob graze when calm
        const bob = hd.flee > 0.02
          ? Math.abs(Math.sin(t * 7 * a.pace + ai)) * 0.5
          : 0;
        d.position.set(a.x, h + bob, a.z);
        d.rotation.set(hd.flee > 0.02 ? -0.15 : 0.1, a.head, 0);
        d.scale.setScalar(0.9 + (ai % 3) * 0.06);
        d.updateMatrix();
        mesh.setMatrixAt(ai++, d.matrix);
        // let the herd center follow its animals when they've fled
        if (hd.flee > 0.5) { hd.cx += a.vx * dt / hd.n; hd.cz += a.vz * dt / hd.n; }
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
