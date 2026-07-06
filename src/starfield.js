// The sky as seen from inside a galaxy: a seeded dome of stars with a
// milky band across it — the home galaxy's disk seen edge-on from within.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture, nebulaTexture } from './nebula.js';

/**
 * The night sky as it truly is from a point inside a galaxy: every one of the
 * galaxy's rendered stars projected onto the sky sphere with 1/d² brightness.
 * Stand near the rim and the band thins; near the core and the sky burns.
 *
 * `starData` are the arrays from generateGalaxyStars; `time`/`vrot` freeze the
 * differential rotation at the moment of arrival; the system's own sun (any
 * star within ~2 units of the viewer) is skipped — it's rendered in person.
 */
export function makeGalaxySkyFromWithin(starData, time, vrot, viewerPos, radius) {
  const group = new THREE.Group();
  const { aR, aTheta, aY, aColor, aSize } = starData;
  const N = aR.length;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const K_LUM = 60; // display-unit luminance scale, tuned for the band to glow
  let j = 0;
  let bulgeDir = null;
  for (let i = 0; i < N; i++) {
    const th = aTheta[i] + (vrot / Math.max(aR[i], 14)) * time;
    const wx = aR[i] * Math.cos(th) - viewerPos.x;
    const wy = aY[i] - viewerPos.y;
    const wz = aR[i] * Math.sin(th) - viewerPos.z;
    const d2 = wx * wx + wy * wy + wz * wz;
    if (d2 < 4) continue; // that one is *our* sun
    const inv = 1 / Math.sqrt(d2);
    pos[j * 3] = wx * inv * radius;
    pos[j * 3 + 1] = wy * inv * radius;
    pos[j * 3 + 2] = wz * inv * radius;
    const b = Math.min((K_LUM * (0.5 + aSize[i])) / d2, 1.5);
    col[j * 3] = aColor[i * 3] * b;
    col[j * 3 + 1] = aColor[i * 3 + 1] * b;
    col[j * 3 + 2] = aColor[i * 3 + 2] * b;
    j++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, j * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, j * 3), 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.01);
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    size: radius * 0.0019, vertexColors: true, sizeAttenuation: true,
    map: softDotTexture(64), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  group.add(stars);

  // the bulge glows toward galactic center
  bulgeDir = new THREE.Vector3(-viewerPos.x, -viewerPos.y * 0.4, -viewerPos.z);
  const dCore = Math.max(bulgeDir.length(), 8);
  bulgeDir.normalize();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture(),
    color: new THREE.Color(1.0, 0.82, 0.6).multiplyScalar(Math.min(30 / dCore, 0.34)),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  glow.position.copy(bulgeDir).multiplyScalar(radius * 0.97);
  glow.scale.setScalar(radius * (0.35 + 24 / dCore));
  group.add(glow);

  return group;
}

export function makeSkyDome(seed, radius) {
  const group = new THREE.Group();
  const r = new RNG(hash(seed, 0x5c7));

  // random great circle for the galactic plane
  const nz = r.float(-1, 1), nth = r.float(0, Math.PI * 2);
  const ns = Math.sqrt(1 - nz * nz);
  const normal = new THREE.Vector3(ns * Math.cos(nth), ns * Math.sin(nth), nz);
  const u = new THREE.Vector3(0, 1, 0).cross(normal);
  if (u.lengthSq() < 1e-4) u.set(1, 0, 0); else u.normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);

  const N = 9000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const dir = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const inBand = i < N * 0.55; // over half the stars hug the galactic plane
    if (inBand) {
      const th = r.float(0, Math.PI * 2);
      const lat = r.gauss() * 0.12;
      dir.copy(u).multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th)).addScaledVector(normal, lat).normalize();
    } else {
      const z = r.float(-1, 1), th = r.float(0, Math.PI * 2);
      const s = Math.sqrt(1 - z * z);
      dir.set(s * Math.cos(th), s * Math.sin(th), z);
    }
    pos[i * 3] = dir.x * radius; pos[i * 3 + 1] = dir.y * radius; pos[i * 3 + 2] = dir.z * radius;
    const t = Math.pow(r.next(), 3);
    const b = 0.25 + 1.3 * Math.pow(r.next(), 6);
    col[i * 3] = b * (1 - t * 0.25);
    col[i * 3 + 1] = b * (0.82 + 0.1 * t);
    col[i * 3 + 2] = b * (0.72 + 0.5 * t);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    size: radius * 0.0021, vertexColors: true, sizeAttenuation: true,
    map: softDotTexture(64), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  group.add(stars);

  // the soft glowing band itself
  const bandTex = nebulaTexture(hash(seed, 3), 256);
  const M = 42;
  for (let i = 0; i < M; i++) {
    const th = (i / M) * Math.PI * 2;
    const lat = r.gauss() * 0.05;
    dir.copy(u).multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th)).addScaledVector(normal, lat).normalize();
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: bandTex,
      color: new THREE.Color(0.035, 0.033, 0.05),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      rotation: r.float(0, Math.PI * 2),
    }));
    sp.position.copy(dir).multiplyScalar(radius * 0.98);
    sp.scale.setScalar(radius * r.float(0.28, 0.5));
    group.add(sp);
  }

  // occasionally, a vast drifting emission nebula owns a corner of the sky
  if (r.chance(0.45)) {
    const z = r.float(-0.7, 0.7), th = r.float(0, Math.PI * 2);
    const s = Math.sqrt(1 - z * z);
    dir.set(s * Math.cos(th), s * Math.sin(th), z);
    const warm = r.chance(0.5);
    const tint = warm ? new THREE.Color(0.10, 0.028, 0.045) : new THREE.Color(0.03, 0.055, 0.08);
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: bandTex, color: tint,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        rotation: r.float(0, Math.PI * 2),
      }));
      sp.position.copy(dir).multiplyScalar(radius * 0.96)
        .add(new THREE.Vector3(r.gauss(), r.gauss(), r.gauss()).multiplyScalar(radius * 0.07));
      sp.scale.setScalar(radius * r.float(0.3, 0.55));
      group.add(sp);
    }
  }

  return group;
}
