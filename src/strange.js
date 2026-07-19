// The wonders.
//
// Life where the numbers say there is none. Ice worlds grow crystal
// gardens that hum with light after dark, under pillars of auroral fire.
// Lava worlds breathe — ember fountains riding the fracture heat. Barren
// worlds keep dust devils walking their plains, and once in a long while,
// on some airless nowhere, a black slab stands in perfect proportion,
// 1 : 4 : 9, saying nothing. Every wonder spawns at the biome anchor
// through the same host contract the living worlds use, and disposes
// with it.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture } from './nebula.js';

export function addWonders(s) {
  const t = s.pp.typeId;
  if (t === 3) return iceWonders(s);
  if (t === 4) return lavaWonders(s);
  if (t === 0) return barrenWonders(s);
  return null;
}

// ------------------------------------------------------------- ice ----
function iceWonders(s) {
  const r = new RNG(hash(s.pp.seed, 0x1cec1e));

  // the crystal garden: translucent spires in clustered stands
  const N = r.int(36, 60);
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.62, 0.82, 0.95), transparent: true, opacity: 0.66,
    roughness: 0.12, metalness: 0.1,
    emissive: new THREE.Color(0.10, 0.35, 0.55), emissiveIntensity: 0.12,
  });
  const spires = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), mat, N);
  const d = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const cl = r.int(0, 3);
    const cx = Math.cos(cl * 2.4) * 160, cz = Math.sin(cl * 2.4) * 160;
    const x = cx + r.gauss() * 45, z = cz + r.gauss() * 45;
    const h = s.heightAt(x, z);
    const tall = r.float(2.5, 9);
    d.position.set(x, h + tall * 0.75, z);
    d.scale.set(r.float(0.5, 1.3), tall, r.float(0.5, 1.3));
    d.rotation.set(r.float(-0.12, 0.12), r.float(0, 6.28), r.float(-0.12, 0.12));
    d.updateMatrix();
    spires.setMatrixAt(i, d.matrix);
  }
  s.scene.add(spires);

  // pillars of light, standing on the plain after dark
  const tex = softDotTexture(64);
  const pillars = [];
  for (let i = 0; i < 4; i++) {
    const x = r.float(-400, 400), z = r.float(-400, 400);
    const h = s.heightAt(x, z);
    const p = new THREE.Mesh(
      new THREE.PlaneGeometry(5, 240),
      new THREE.MeshBasicMaterial({
        map: tex, color: new THREE.Color(0.5, 0.9, 1.2),
        blending: THREE.AdditiveBlending, transparent: true, opacity: 0,
        depthWrite: false, side: THREE.DoubleSide,
      }));
    p.position.set(x, h + 118, z);
    s.scene.add(p);
    pillars.push({ p, phase: r.float(0, 6.28) });
  }

  let time = r.float(0, 100);
  return {
    update(dt, sunY) {
      time += dt;
      const night = 1 - Math.min(Math.max((sunY + 0.12) * 3.5, 0), 1);
      mat.emissiveIntensity = 0.1 + night * 0.45;
      for (const q of pillars) {
        q.p.material.opacity = night * (0.28 + 0.16 * Math.sin(time * 0.4 + q.phase));
        q.p.rotation.y += dt * 0.05;
      }
    },
  };
}

// ------------------------------------------------------------ lava ----
function lavaWonders(s) {
  const r = new RNG(hash(s.pp.seed, 0x1a7a));
  const tex = softDotTexture(32);
  const NV = r.int(6, 9), PPV = 20;

  const vents = [];
  const glows = [];
  for (let v = 0; v < NV; v++) {
    const x = r.float(-350, 350), z = r.float(-350, 350);
    const h = s.heightAt(x, z);
    vents.push({ x, y: h, z, h0: r.float(26, 60), spd: r.float(9, 16) });
    const g = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(2.0, 0.7, 0.2),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    g.position.set(x, h + 2, z);
    g.scale.setScalar(r.float(14, 26));
    s.scene.add(g);
    glows.push({ g, phase: r.float(0, 6.28), s0: g.scale.x });
  }

  // one Points cloud carries every ember on the anchor
  const N = NV * PPV;
  const pos = new Float32Array(N * 3);
  const seedv = new Float32Array(N);
  for (let i = 0; i < N; i++) seedv[i] = r.float(0, 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 900);
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    map: tex, color: new THREE.Color(2.2, 0.85, 0.28), size: 2.6,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    sizeAttenuation: true,
  }));
  pts.frustumCulled = false;
  s.scene.add(pts);

  let time = r.float(0, 100);
  return {
    update(dt) {
      time += dt;
      for (let i = 0; i < N; i++) {
        const v = vents[(i / PPV) | 0];
        const cyc = (time * v.spd * (0.7 + seedv[i] * 0.6) + seedv[i] * 97) % v.h0;
        const o = i * 3;
        pos[o] = v.x + Math.sin(seedv[i] * 40 + cyc * 0.11) * (1.5 + cyc * 0.06);
        pos[o + 1] = v.y + 1 + cyc;
        pos[o + 2] = v.z + Math.cos(seedv[i] * 31 + cyc * 0.09) * (1.5 + cyc * 0.06);
      }
      geo.attributes.position.needsUpdate = true;
      for (const q of glows) {
        q.g.scale.setScalar(q.s0 * (0.85 + 0.2 * Math.sin(time * 1.7 + q.phase)));
      }
    },
  };
}

// ---------------------------------------------------------- barren ----
function barrenWonders(s) {
  const r = new RNG(hash(s.pp.seed, 0xba22e0));
  const tex = softDotTexture(48);

  // dust devils, walking their slow patrols
  const devils = [];
  for (let i = 0; i < r.int(2, 4); i++) {
    const g = new THREE.Group();
    const discs = [];
    for (let k = 0; k < 7; k++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: new THREE.Color(0.55, 0.46, 0.36),
        transparent: true, opacity: 0.15, depthWrite: false,
      }));
      const y = 6 + k * 13;
      sp.position.set(0, y, 0);
      sp.scale.setScalar(8 + k * 2.6);
      g.add(sp);
      discs.push({ sp, y, k });
    }
    const x = r.float(-380, 380), z = r.float(-380, 380);
    g.position.set(x, s.heightAt(x, z), z);
    s.scene.add(g);
    devils.push({ g, discs, dir: r.float(0, 6.28), turn: r.float(-0.06, 0.06), phase: r.float(0, 6.28) });
  }

  // and, once in a long while, the slab: 1 : 4 : 9, saying nothing
  if (r.chance(0.07)) {
    const x = r.float(-120, 120), z = r.float(-120, 120);
    const h = s.heightAt(x, z);
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(4, 9, 1),
      new THREE.MeshStandardMaterial({ color: 0x040404, roughness: 0.22, metalness: 0.75 }));
    slab.position.set(x, h + 4.5, z);
    slab.rotation.y = r.float(0, 6.28);
    s.scene.add(slab);
  }

  let time = r.float(0, 100);
  return {
    update(dt) {
      time += dt;
      for (const dv of devils) {
        dv.dir += dv.turn * dt;
        dv.g.position.x += Math.cos(dv.dir) * 3.2 * dt;
        dv.g.position.z += Math.sin(dv.dir) * 3.2 * dt;
        // the column stays on the ground it wanders over
        dv.g.position.y = s.heightAt(dv.g.position.x, dv.g.position.z);
        for (const { sp, y, k } of dv.discs) {
          sp.position.x = Math.sin(time * 2.1 + k * 1.7 + dv.phase) * (1.2 + k * 0.55);
          sp.position.z = Math.cos(time * 1.9 + k * 1.7 + dv.phase) * (1.2 + k * 0.55);
          sp.position.y = y + Math.sin(time * 0.9 + k) * 1.5;
        }
      }
    },
  };
}
