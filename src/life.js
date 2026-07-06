// Life, where the numbers allow it.
//
// Worlds that are terrestrial or ocean-class with equilibrium temperatures
// in the liquid-water band grow a biosphere: wind-brushed tufts and stands
// of alien trees in a palette seeded by the world itself, flocks of
// skimmers riding boid rules overhead, and — after dark on inhabited
// worlds — slow constellations of bioluminescent spores.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture } from './nebula.js';

function bladeTexture(rng) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 11; i++) {
    const x = 12 + rng.next() * 104;
    const lean = (rng.next() - 0.5) * 38;
    const h = 50 + rng.next() * 70;
    g.lineWidth = 1.5 + rng.next() * 2.5;
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x + lean * 0.4, 128 - h * 0.6, x + lean, 128 - h);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

export function isBiosphere(pp) {
  return (pp.type === 'terrestrial' || pp.type === 'ocean') && pp.Teq >= 235 && pp.Teq <= 330;
}

export function addLife(s) {
  const pp = s.pp;
  if (!isBiosphere(pp)) return null;
  const r = new RNG(hash(pp.seed, 0x11fe));
  const EXT = 1400;

  const vegColor = new THREE.Color().setHSL(r.float(0.06, 0.62), r.float(0.4, 0.65), r.float(0.22, 0.34));
  const canopyColor = vegColor.clone().offsetHSL(r.float(-0.05, 0.05), 0, r.float(-0.04, 0.08));

  const dryland = (x, z) => {
    const h = s.heightAt(x, z);
    if (s.seaLevel !== null && h < s.seaLevel + 1.5) return null;
    if (h > s.amp * 0.55) return null; // no meadows on the peaks
    return h;
  };

  // ---------------------------------------------------------- tufts ----
  const tuftGeo = (() => {
    const g1 = new THREE.PlaneGeometry(2.6, 2.2);
    const g2 = g1.clone().rotateY(Math.PI / 2);
    const pos = new Float32Array(g1.attributes.position.count * 3 * 2);
    const uv = new Float32Array(g1.attributes.uv.count * 2 * 2);
    pos.set(g1.attributes.position.array, 0);
    pos.set(g2.attributes.position.array, g1.attributes.position.count * 3);
    uv.set(g1.attributes.uv.array, 0);
    uv.set(g2.attributes.uv.array, g1.attributes.uv.count * 2);
    const idx = [];
    for (const [base, g] of [[0, g1], [g1.attributes.position.count, g2]]) {
      for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + base);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    g1.dispose(); g2.dispose();
    return geo;
  })();
  const tuftMat = new THREE.MeshBasicMaterial({
    map: bladeTexture(r), transparent: true, alphaTest: 0.3,
    color: vegColor.clone(), side: THREE.DoubleSide, depthWrite: true,
  });
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 650);
  const d = new THREE.Object3D();
  let placed = 0;
  for (let i = 0; i < 2200 && placed < 650; i++) {
    const x = r.float(-EXT / 2, EXT / 2), z = r.float(-EXT / 2, EXT / 2);
    const h = dryland(x, z);
    if (h === null) continue;
    d.position.set(x, h + 0.9, z);
    d.rotation.y = r.float(0, Math.PI * 2);
    d.scale.setScalar(r.float(0.6, 2.1));
    d.updateMatrix();
    tufts.setMatrixAt(placed++, d.matrix);
  }
  tufts.count = placed;
  s.scene.add(tufts);

  // ---------------------------------------------------------- trees ----
  const trunkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.07, 0.3, 0.22), roughness: 1 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: canopyColor, roughness: 0.9, flatShading: true });
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.3, 1, 5), trunkMat, 130);
  const canopies = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), canopyMat, 130);
  let t = 0;
  for (let i = 0; i < 1400 && t < 130; i++) {
    const x = r.float(-EXT / 2, EXT / 2), z = r.float(-EXT / 2, EXT / 2);
    const h = dryland(x, z);
    if (h === null) continue;
    const height = r.float(5, 13);
    d.position.set(x, h + height / 2, z);
    d.rotation.set(0, r.float(0, 6.28), r.float(-0.06, 0.06));
    d.scale.set(1, height, 1);
    d.updateMatrix();
    trunks.setMatrixAt(t, d.matrix);
    d.position.y = h + height * r.float(0.85, 1.05);
    const cw = r.float(2.2, 4.6);
    d.scale.set(cw, cw * r.float(0.5, 1.2), cw);
    d.updateMatrix();
    canopies.setMatrixAt(t, d.matrix);
    t++;
  }
  trunks.count = t; canopies.count = t;
  s.scene.add(trunks); s.scene.add(canopies);

  // -------------------------------------------------------- skimmers ----
  const NB = 30;
  const boids = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.55, 2.6, 4),
    new THREE.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.8 }),
    NB);
  const bp = [], bv = [];
  const center = new THREE.Vector3(r.float(-200, 200), 60, r.float(-200, 200));
  for (let i = 0; i < NB; i++) {
    bp.push(center.clone().add(new THREE.Vector3(r.gauss() * 40, r.gauss() * 12, r.gauss() * 40)));
    bv.push(new THREE.Vector3(r.gauss(), 0, r.gauss()).normalize().multiplyScalar(12));
  }
  s.scene.add(boids);
  const wander = { t: 0 };

  // -------------------------------------------------- night spores ------
  let spores = null;
  if (pp.inhabited) {
    const tex = softDotTexture(32);
    spores = [];
    for (let i = 0; i < 46; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: new THREE.Color().setHSL(r.float(0.3, 0.55), 0.8, 0.6),
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
      }));
      const x = r.float(-500, 500), z = r.float(-500, 500);
      sp.position.set(x, (dryland(x, z) ?? 0) + r.float(2, 14), z);
      sp.scale.setScalar(r.float(0.5, 1.6));
      sp.userData.ph = r.float(0, 6.28);
      s.scene.add(sp);
      spores.push(sp);
    }
  }

  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const acc = new THREE.Vector3(), diff = new THREE.Vector3();
  let time = 0;

  return {
    update(dt, sunY) {
      time += dt;
      const day = Math.min(Math.max((sunY + 0.1) * 3, 0), 1);
      tuftMat.color.copy(vegColor).multiplyScalar(0.15 + 0.85 * day);

      // boids
      const cdt = Math.min(dt, 0.08);
      wander.t += dt;
      center.x += Math.sin(wander.t * 0.11) * 9 * cdt;
      center.z += Math.cos(wander.t * 0.07) * 9 * cdt;
      for (let i = 0; i < NB; i++) {
        acc.set(0, 0, 0);
        let n = 0;
        for (let j = 0; j < NB; j++) {
          if (i === j) continue;
          diff.subVectors(bp[j], bp[i]);
          const dd = diff.lengthSq();
          if (dd < 900) { // near flock
            acc.addScaledVector(bv[j], 0.03);                 // align
            acc.addScaledVector(diff, 0.012);                 // cohere
            if (dd < 36) acc.addScaledVector(diff, -0.5);     // separate
            n++;
          }
        }
        diff.subVectors(center, bp[i]);
        acc.addScaledVector(diff, 0.02);
        const ground = s.heightAt(bp[i].x, bp[i].z) + 18;
        if (bp[i].y < ground) acc.y += (ground - bp[i].y) * 0.6;
        if (bp[i].y > ground + 70) acc.y -= (bp[i].y - ground - 70) * 0.2;
        bv[i].addScaledVector(acc, cdt * 8);
        const sp = bv[i].length();
        if (sp > 22) bv[i].multiplyScalar(22 / sp);
        if (sp < 7) bv[i].multiplyScalar(7 / Math.max(sp, 0.01));
        bp[i].addScaledVector(bv[i], cdt);
        // orient cone along velocity, flap by scale pulse
        q.setFromUnitVectors(up, diff.copy(bv[i]).normalize());
        d.position.copy(bp[i]);
        d.quaternion.copy(q);
        const flap = 1 + 0.35 * Math.sin(time * 9 + i * 1.7);
        d.scale.set(flap, 1, 1);
        d.updateMatrix();
        boids.setMatrixAt(i, d.matrix);
      }
      boids.instanceMatrix.needsUpdate = true;

      if (spores) {
        const night = 1 - day;
        for (const sp of spores) {
          sp.material.opacity = night * (0.35 + 0.3 * Math.sin(time * 0.7 + sp.userData.ph));
          sp.position.y += Math.sin(time * 0.4 + sp.userData.ph) * dt * 0.6;
          sp.position.x += Math.cos(time * 0.23 + sp.userData.ph) * dt * 1.1;
        }
      }
    },
  };
}
