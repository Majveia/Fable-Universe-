// Creatures of wonder — the things that make a world legendary.
//
// A COLOSSUS stands somewhere on nearly every world: a weathered bronze
// titan taller than any tower, raised by hands nobody remembers, patinaed
// green in its recesses and catching the low sun on its crown. SKY-WHALES
// drift through the high air on slow currents, fins beating, lit from below
// at dusk. And on the ocean worlds a LEVIATHAN moves through the far water,
// its humped back breaching and sounding across the horizon. All are built
// from many parts and lit by the world's own sun — the monumental
// centerpiece a great vista needs.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture } from './nebula.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const EXT = 1400;

// ---------------------------------------------------------- the colossus ----
function buildColossus(s, r) {
  const dry = (x, z, m = 3) => (s.seaLevel === null || s.heightAt(x, z) > s.seaLevel + m)
    && s.heightAt(x, z) < s.amp * 0.55;
  // a commanding, fairly level spot in view of the landing, not on top of it
  let site = null, bestScore = -1e9;
  for (let i = 0; i < 260; i++) {
    const th = i * 2.399963, rad = 240 + (i / 260) * 900;
    const x = s.spawn.x + Math.cos(th) * rad, z = s.spawn.z + Math.sin(th) * rad;
    if (!dry(x, z)) continue;
    if (s.settlement && Math.hypot(x - s.settlement.site.x, z - s.settlement.site.z) < 180) continue;
    const h = s.heightAt(x, z);
    const flat = Math.abs(s.heightAt(x + 30, z) - h) + Math.abs(s.heightAt(x, z + 30) - h);
    const score = h * 0.3 - flat * 3 - rad * 0.02;   // prominent but standable
    if (score > bestScore) { bestScore = score; site = { x, z, h }; }
  }
  if (!site) return null;

  const H = r.float(90, 150);                          // total height, metres
  const u = H / 150;                                   // unit scale
  const bronze = new THREE.Color().setHSL(0.09, 0.5, 0.34);
  const verd = new THREE.Color().setHSL(0.42, 0.45, 0.38);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.55, flatShading: true });

  const g = new THREE.Group();
  const parts = [];
  // paint a part's vertices: verdigris pooling low, bronze catching high,
  // with a little grain — the patina of centuries
  const add = (geo, x, y, z, loT = 0) => {
    geo.computeBoundingBox();
    const bb = geo.boundingBox, span = Math.max(bb.max.y - bb.min.y, 0.001);
    const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - bb.min.y) / span;       // 0 bottom … 1 top of part
      const patina = Math.min(loT + (1 - t) * 0.8 + (Math.sin(pos.getX(i) * 0.7 + pos.getZ(i)) * 0.5 + 0.5) * 0.15, 1);
      c.copy(bronze).lerp(verd, patina * 0.85);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    parts.push(m); g.add(m);
    return m;
  };

  // stepped stone pedestal (its own paler material) — the plinth of a titan
  const stoneMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.09, 0.16, 0.55), roughness: 0.95, flatShading: true });
  for (let i = 0; i < 4; i++) {
    const w = (34 - i * 6) * u;
    const step = new THREE.Mesh(new THREE.BoxGeometry(w, 4 * u, w), stoneMat);
    step.position.y = 2 * u + i * 4 * u;
    g.add(step);
  }
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(10 * u, 12 * u, 10 * u, 16), stoneMat);
  drum.position.y = 21 * u; g.add(drum);
  const base = 26 * u;                                  // feet start here

  // legs: tapered, with greave plates
  for (const sx of [-1, 1]) {
    add(new THREE.CylinderGeometry(3.4 * u, 4.6 * u, 34 * u, 10), sx * 5 * u, base + 17 * u, 0, 0.35);
    add(new THREE.BoxGeometry(8 * u, 14 * u, 8.5 * u), sx * 5 * u, base + 8 * u, 1.2 * u, 0.5); // shin plate
  }
  const hip = base + 34 * u;
  add(new THREE.BoxGeometry(20 * u, 8 * u, 12 * u), 0, hip + 3 * u, 0, 0.4);           // belt
  // torso — layered chest plates, not a naked box
  add(new THREE.CylinderGeometry(13 * u, 11 * u, 30 * u, 12), 0, hip + 20 * u, 0, 0.15);
  for (let i = 0; i < 4; i++)
    add(new THREE.BoxGeometry((22 - i * 2) * u, 4 * u, (15 - i) * u), 0, hip + 10 * u + i * 6 * u, 5.5 * u, 0.1); // pectoral bands
  const shoulder = hip + 36 * u;
  add(new THREE.SphereGeometry(8 * u, 12, 10), 0, shoulder, 0, 0.1);                    // gorget
  // arms — one at the side, one raised holding a beacon-staff
  add(new THREE.CylinderGeometry(3.4 * u, 4 * u, 32 * u, 8), -15 * u, shoulder - 12 * u, 0, 0.3);
  const raised = add(new THREE.CylinderGeometry(3.4 * u, 4 * u, 30 * u, 8), 15 * u, shoulder + 6 * u, 0, 0.1);
  raised.rotation.z = -0.5;
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(1.1 * u, 1.1 * u, 46 * u, 6), mat);
  staff.geometry.setAttribute('color', constColor(staff.geometry, bronze.clone().lerp(verd, 0.3)));
  staff.position.set(24 * u, shoulder + 22 * u, 0); g.add(staff);
  // head + radiate crown
  add(new THREE.CylinderGeometry(6 * u, 7 * u, 6 * u, 10), 0, shoulder + 10 * u, 0, 0.1);   // neck
  add(new THREE.BoxGeometry(11 * u, 13 * u, 12 * u), 0, shoulder + 20 * u, 0, 0);            // head
  const crownY = shoulder + 30 * u;
  const rays = 9;
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const spike = add(new THREE.ConeGeometry(1.4 * u, 12 * u, 5), Math.cos(a) * 7 * u, crownY, Math.sin(a) * 7 * u, 0);
    spike.rotation.z = -Math.cos(a) * 0.5; spike.rotation.x = Math.sin(a) * 0.5;
  }

  // the eyes and the staff-jewel take a light after dark
  const glow = new THREE.Group();
  const jewel = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture(48), color: new THREE.Color(1.4, 1.1, 0.6),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  jewel.scale.setScalar(10 * u);
  jewel.position.set(24 * u, shoulder + 46 * u, 0);
  glow.add(jewel);
  for (const ex of [-2.6 * u, 2.6 * u]) {
    const eye = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDotTexture(32), color: new THREE.Color(1.3, 0.8, 0.4),
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    eye.scale.setScalar(2.4 * u);
    eye.position.set(ex, shoulder + 21 * u, 6.2 * u);
    glow.add(eye);
  }
  g.add(glow);

  g.position.set(site.x, site.h - 2, site.z);
  g.rotation.y = Math.atan2(s.spawn.x - site.x, s.spawn.z - site.z);   // face the traveler
  s.scene.add(g);
  return { site, height: H,
    update(night) { for (const c of glow.children) c.material.opacity = night * (0.5 + 0.5 * Math.sin(performance.now() * 0.0016)); } };
}

function constColor(geo, color) {
  const n = geo.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  return new THREE.BufferAttribute(arr, 3);
}

// --------------------------------------------------------- the sky-whales ----
function buildWhales(s, r) {
  const N = COARSE ? 4 : 8;
  const geo = whaleGeometry();
  const col = new THREE.Color().setHSL(r.float(0.55, 0.72), 0.35, 0.4);
  const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 0.85, flatShading: true });
  const whales = new THREE.InstancedMesh(geo, mat, N);
  whales.frustumCulled = false;
  s.scene.add(whales);
  // a soft belly-glow billboard under each, for dusk
  const glowTex = softDotTexture(64);
  const glows = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
    map: glowTex, color: new THREE.Color(0.7, 0.85, 1.1), size: 40, transparent: true,
    opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  const gp = new Float32Array(N * 3);
  glows.geometry.setAttribute('position', new THREE.BufferAttribute(gp, 3));
  glows.frustumCulled = false;
  s.scene.add(glows);

  const state = [];
  for (let i = 0; i < N; i++) state.push({
    cx: s.spawn.x + r.gauss() * 400, cz: s.spawn.z + r.gauss() * 400,
    rad: r.float(260, 620), alt: r.float(180, 420), size: r.float(0.7, 1.6),
    w: r.float(0.03, 0.07) * r.sign(), ph: r.float(0, 6.28), roll: r.float(0, 6.28),
  });
  const d = new THREE.Object3D();
  let t = 0;
  return {
    update(dt, night) {
      t += dt;
      for (let i = 0; i < N; i++) {
        const w = state[i];
        const a = w.ph + w.w * t;
        const x = w.cx + Math.cos(a) * w.rad;
        const z = w.cz + Math.sin(a) * w.rad;
        const y = Math.max(s.heightAt(x, z), s.seaLevel ?? -1e9) + w.alt + Math.sin(t * 0.4 + w.roll) * 22;
        d.position.set(x, y, z);
        d.rotation.set(Math.sin(t * 0.5 + w.roll) * 0.12, a + (w.w > 0 ? Math.PI / 2 : -Math.PI / 2), Math.sin(t * 0.7 + w.ph) * 0.14);
        d.scale.setScalar(w.size * 18);
        d.updateMatrix();
        whales.setMatrixAt(i, d.matrix);
        gp[i * 3] = x; gp[i * 3 + 1] = y - w.size * 14; gp[i * 3 + 2] = z;
      }
      whales.instanceMatrix.needsUpdate = true;
      glows.geometry.attributes.position.needsUpdate = true;
      glows.material.opacity = night * 0.5;
    },
  };
}

function whaleGeometry() {
  const parts = [];
  const body = new THREE.SphereGeometry(1, 10, 8); body.scale(3.2, 1.0, 1.2); parts.push(body);
  const head = new THREE.SphereGeometry(1, 8, 6); head.scale(1.2, 0.9, 1.0); head.translate(3.0, 0, 0); parts.push(head);
  const fluke = new THREE.ConeGeometry(1.5, 2.2, 4); fluke.rotateZ(Math.PI / 2); fluke.scale(1, 0.3, 2.2); fluke.translate(-3.4, 0, 0); parts.push(fluke);
  for (const sz of [-1, 1]) { const fin = new THREE.ConeGeometry(0.6, 3, 4); fin.rotateX(sz * Math.PI / 2); fin.scale(1, 1, 0.4); fin.translate(0.4, -0.3, sz * 1.3); parts.push(fin); }
  const ridge = new THREE.ConeGeometry(0.5, 2, 4); ridge.translate(0, 1.0, 0); parts.push(ridge);
  return mergeGeos(parts);
}

// --------------------------------------------------------- the leviathan ----
function buildLeviathan(s, r) {
  if (s.seaLevel === null) return null;
  const SEG = COARSE ? 7 : 11;
  const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.58, 0.4, 0.14), roughness: 0.5, metalness: 0.2, flatShading: true });
  const humps = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), mat, SEG);
  humps.frustumCulled = false;
  s.scene.add(humps);
  // a head with a fin sail
  const head = new THREE.Mesh(mergeGeos([
    (() => { const gg = new THREE.ConeGeometry(6, 22, 7); gg.rotateZ(-Math.PI / 2); return gg; })(),
    (() => { const gg = new THREE.ConeGeometry(4, 16, 4); gg.translate(-2, 8, 0); return gg; })(),
  ]), mat);
  head.frustumCulled = false;
  s.scene.add(head);

  // a great circling path far out on the water
  const cx = s.spawn.x + r.gauss() * 500, cz = s.spawn.z + r.gauss() * 500;
  const rad = r.float(900, 1600), w = r.float(0.02, 0.04) * r.sign();
  const d = new THREE.Object3D();
  let t = 0, breach = 0, nextBreach = r.float(8, 20);
  return {
    update(dt) {
      t += dt;
      nextBreach -= dt;
      if (nextBreach <= 0) { breach = 1; nextBreach = r.float(14, 30); }
      breach = Math.max(0, breach - dt * 0.5);
      const a = w * t;
      const hx = cx + Math.cos(a) * rad, hz = cz + Math.sin(a) * rad;
      const dir = a + (w > 0 ? Math.PI / 2 : -Math.PI / 2);
      const dx = Math.cos(dir), dz = Math.sin(dir);
      head.position.set(hx, s.seaLevel + 3 + breach * 26, hz);
      head.rotation.set(0, -dir, breach * 0.6);
      head.scale.setScalar(2.6);
      for (let i = 0; i < SEG; i++) {
        const back = (i + 1) * 30;
        const x = hx - dx * back, z = hz - dz * back;
        const phase = t * 2 - i * 0.5;
        const rise = Math.sin(phase) * 8 + breach * Math.max(0, 20 - i * 2.5);
        d.position.set(x, s.seaLevel - 4 + rise, z);
        d.rotation.set(0, -dir, 0);
        d.scale.setScalar((9 - i * 0.4) * 1.4);
        d.updateMatrix();
        humps.setMatrixAt(i, d.matrix);
      }
      humps.instanceMatrix.needsUpdate = true;
    },
  };
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

export function addMegafauna(s) {
  const pp = s.pp;
  if (pp.typeId > 4) return null;
  const r = new RNG(hash(pp.seed, 0x11e6afa));
  const colossus = pp.typeId <= 4 ? buildColossus(s, r) : null;
  const whales = s.atmo > 0.4 && r.chance(0.85) ? buildWhales(s, r) : null;
  const leviathan = r.chance(0.8) ? buildLeviathan(s, r) : null;
  if (!colossus && !whales && !leviathan) return null;
  return {
    colossusSite: colossus?.site ?? null,
    update(dt, sunY) {
      const night = 1 - Math.min(Math.max((sunY + 0.12) * 3.5, 0), 1);
      colossus?.update(night);
      whales?.update(dt, night);
      leviathan?.update(dt);
    },
  };
}
