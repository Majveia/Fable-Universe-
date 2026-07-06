// Somebody lives here.
//
// Inhabited worlds get a settlement near the landing site: a cluster of
// instanced towers whose windows are drawn procedurally in the fragment
// shader — each one keeps its own lights, and they come on with the dark.
// Beacon masts blink at the edge of town. The distant city-glow domes on
// the horizon were always there; now the foreground has an address too.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture } from './nebula.js';

const BUILDING_VERT = /* glsl */`
  attribute float aSeed;
  attribute vec2 aGrid;
  varying vec2 vUv;
  varying vec3 vN;
  varying float vSeed;
  varying vec2 vGrid;
  varying float vSide;   // 1 walls, 0 roof
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vGrid = aGrid;
    vSide = 1.0 - step(0.5, abs(normal.y));
    #ifdef USE_INSTANCING
      vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    #else
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 w = modelMatrix * vec4(position, 1.0);
    #endif
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const BUILDING_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNight;
  uniform vec3 uFacade;
  varying vec2 vUv;
  varying vec3 vN;
  varying float vSeed;
  varying vec2 vGrid;
  varying float vSide;

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed * 37.0) * 43758.5453);
  }

  void main() {
    float day = 1.0 - uNight;
    float diff = max(dot(vN, uSunDir), 0.0);
    vec3 col = uFacade * (0.06 + diff * day * 0.9 + 0.10 * day);

    if (vSide > 0.5) {
      vec2 g = vUv * vGrid;
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.25, f.y) * step(f.y, 0.75);
      float on = step(0.42, hash2(cell)); // some homes are out tonight
      float flick = 0.85 + 0.15 * hash2(cell + 7.0);
      col += vec3(1.0, 0.72, 0.42) * win * on * flick * (uNight * 1.4 + 0.03);
      col = mix(col, col * 0.85, win * day); // glass reads darker by day
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function addSettlement(s) {
  const pp = s.pp;
  if (!pp.inhabited) return null;
  const r = new RNG(hash(pp.seed, 0x5e771e));

  // find flat, dry ground within a stroll of the spawn
  let site = null, bestVar = 1e9;
  for (let i = 0; i < 90; i++) {
    const th = r.float(0, 6.28), rad = r.float(140, 520);
    const x = s.spawn.x + Math.cos(th) * rad, z = s.spawn.z + Math.sin(th) * rad;
    const h = s.heightAt(x, z);
    if (s.seaLevel !== null && h < s.seaLevel + 2.5) continue;
    const spread = Math.max(
      Math.abs(s.heightAt(x + 40, z) - h), Math.abs(s.heightAt(x - 40, z) - h),
      Math.abs(s.heightAt(x, z + 40) - h), Math.abs(s.heightAt(x, z - 40) - h));
    if (spread < bestVar) { bestVar = spread; site = { x, z, h }; }
  }
  if (!site) return null;

  const N = r.int(16, 26);
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const seeds = new Float32Array(N);
  const grids = new Float32Array(N * 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: s.uSunDir, uSunColor: s.uSunColor,
      uNight: { value: 0 },
      uFacade: { value: new THREE.Color(0.16, 0.16, 0.18) },
    },
    vertexShader: BUILDING_VERT,
    fragmentShader: BUILDING_FRAG,
  });
  const town = new THREE.InstancedMesh(geo, mat, N);
  const d = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const ang = r.float(0, 6.28), rad = Math.abs(r.gauss()) * 70;
    const x = site.x + Math.cos(ang) * rad, z = site.z + Math.sin(ang) * rad;
    const h = s.heightAt(x, z);
    const tall = r.chance(0.2);
    const w = r.float(7, 15), ht = tall ? r.float(26, 52) : r.float(6, 18), dp = r.float(7, 15);
    d.position.set(x, h + ht / 2 - 1, z);
    d.rotation.y = r.chance(0.6) ? r.pick([0, Math.PI / 2]) + ang * 0.1 : r.float(0, 6.28);
    d.scale.set(w, ht, dp);
    d.updateMatrix();
    town.setMatrixAt(i, d.matrix);
    seeds[i] = r.float(0, 100);
    grids[i * 2] = Math.max(Math.round(w * 0.45), 2);
    grids[i * 2 + 1] = Math.max(Math.round(ht * 0.6), 2);
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geo.setAttribute('aGrid', new THREE.InstancedBufferAttribute(grids, 2));
  s.scene.add(town);

  // beacon masts, blinking their slow red warning
  const beacons = [];
  const tex = softDotTexture(32);
  for (let i = 0; i < 2; i++) {
    const ang = r.float(0, 6.28);
    const x = site.x + Math.cos(ang) * r.float(80, 140), z = site.z + Math.sin(ang) * r.float(80, 140);
    const h = s.heightAt(x, z);
    if (s.seaLevel !== null && h < s.seaLevel + 1) continue;
    const mastH = r.float(30, 55);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.6, mastH, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.9 }));
    mast.position.set(x, h + mastH / 2, z);
    s.scene.add(mast);
    const lamp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(1.6, 0.12, 0.1),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    lamp.position.set(x, h + mastH + 1.5, z);
    lamp.scale.setScalar(6);
    s.scene.add(lamp);
    beacons.push({ lamp, phase: r.float(0, 6.28) });
  }

  let time = 0;
  return {
    site,
    update(dt, sunY) {
      time += dt;
      const night = 1 - Math.min(Math.max((sunY + 0.12) * 3.5, 0), 1);
      mat.uniforms.uNight.value = night;
      for (const b of beacons) {
        b.lamp.material.opacity = (Math.sin(time * 2.2 + b.phase) > 0.82 ? 1 : 0.06) * (0.4 + 0.6 * night);
      }
    },
  };
}
