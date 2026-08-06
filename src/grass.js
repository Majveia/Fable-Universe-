// The wind made visible.
//
// A field of grass follows you across the world: thousands of instanced
// blades on a wrap-around grid, re-seated cell by cell as you move, so the
// meadow is always underfoot and never repeats. The wind is not a shimmer —
// gust fronts travel through the field as real waves (the same wind that
// drives the sea and the petals), each blade bowing when the front arrives
// and standing back up as it passes. Spent petals stream downwind through
// the air. Stand still a moment and watch the field breathe.

import * as THREE from 'three';
import { RNG, arand, hash } from './rng.js';
import { isBiosphere } from './life.js';
import { softDotTexture } from './nebula.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const GRASS_VERT = /* glsl */`
  attribute vec3 aRoot;      // world root of this blade
  attribute float aH;        // height
  attribute float aPh;       // phase
  attribute float aLean;     // resting lean
  uniform float uTime;
  uniform vec2 uWind;
  uniform vec3 uCam;
  uniform float uR;          // field radius (for the edge fade)
  varying float vTip;
  varying float vFade;
  varying float vGust;

  void main() {
    vTip = position.y;       // 0 at the root, 1 at the tip
    // gust fronts roll downwind through the field; a slower counter-swell
    // underneath keeps the motion from ever looking mechanical
    float front = sin(dot(aRoot.xz, uWind) * 0.045 - uTime * 1.9 + aPh * 0.4);
    float swell = sin(dot(aRoot.xz, uWind) * 0.012 - uTime * 0.6);
    float gust = max(front, 0.0) * 0.85 + swell * 0.25 + 0.15 * sin(uTime * 2.3 + aPh * 6.283);
    vGust = max(front, 0.0);
    float bend = (aLean * 0.25 + gust * 0.75) * vTip * vTip;
    vec3 p = aRoot;
    p.xz += position.x * vec2(-uWind.y, uWind.x);   // blade width, across wind
    p.y += position.y * aH;
    p.xz += uWind * bend * aH * 0.9;
    p.y -= bend * bend * aH * 0.35;                        // bowing shortens it

    float d = length(p.xz - uCam.xz);
    vFade = 1.0 - smoothstep(uR * 0.62, uR * 0.95, d);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const GRASS_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uBase;
  uniform vec3 uTipCol;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uHorizon;
  varying float vTip;
  varying float vFade;
  varying float vGust;

  void main() {
    if (vFade < 0.02) discard;
    float day = smoothstep(-0.15, 0.2, uSunDir.y);
    // tips catch the light; a passing gust flashes the field silver
    vec3 col = mix(uBase, uTipCol, vTip * vTip);
    col += uSunColor * vGust * vTip * 0.28;
    col *= (0.16 + day * (0.65 + 0.45 * vTip)) ;
    col += uHorizon * 0.18 * smoothstep(0.0, 0.25, uSunDir.y) * vTip;
    gl_FragColor = vec4(col, vFade);
  }
`;

export function addGrass(s) {
  const pp = s.pp;
  if (!isBiosphere(pp) || (pp.res?.vegX ?? 1) < 0.25) return null;
  const r = new RNG(hash(pp.seed, 0x96a55));

  // the wrap-around grid: W×W cells under a metre apart — a living carpet
  const W = COARSE ? 56 : 82;
  const CELL = 0.85;
  const N = W * W;
  const R = W * CELL * 0.5;

  // one blade: a tapered ribbon, three segments so it can actually bow
  const blade = new THREE.PlaneGeometry(0.14, 1, 1, 3);
  blade.translate(0, 0.5, 0);

  const roots = new Float32Array(N * 3);
  const hts = new Float32Array(N);
  const phs = new Float32Array(N);
  const leans = new Float32Array(N);
  blade.setAttribute('aRoot', new THREE.InstancedBufferAttribute(roots, 3));
  blade.setAttribute('aH', new THREE.InstancedBufferAttribute(hts, 1));
  blade.setAttribute('aPh', new THREE.InstancedBufferAttribute(phs, 1));
  blade.setAttribute('aLean', new THREE.InstancedBufferAttribute(leans, 1));

  const base = new THREE.Color().setHSL(0.24, 0.4, 0.2).lerp(pp.colC, 0.45);
  const tip = base.clone().offsetHSL(0.03, 0.05, 0.16).lerp(new THREE.Color(0.85, 0.8, 0.45), 0.3);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: s.uTime, uWind: { value: s.wind }, uCam: s.uCam,
      uR: { value: R },
      uBase: { value: base }, uTipCol: { value: tip },
      uSunDir: s.uSunDir, uSunColor: s.uSunColor,
      uHorizon: { value: s.horizonColor },
    },
    vertexShader: GRASS_VERT,
    fragmentShader: GRASS_FRAG,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: true,
  });
  const mesh = new THREE.InstancedMesh(blade, mat, N);
  mesh.frustumCulled = false;
  // instance matrices are identity; every blade lives in its attributes
  s.scene.add(mesh);

  // seat one blade in its cell — deterministic per cell, so walking away
  // and back finds the same field
  const seat = (i, cx, cz) => {
    const hsh = hash(pp.seed, cx, cz, 0x9b);
    const rr = new RNG(hsh);
    const x = (cx + rr.next()) * CELL;
    const z = (cz + rr.next()) * CELL;
    const h = s.heightAt(x, z);
    const under = s.seaLevel !== null && h < s.seaLevel + 1.4;
    const high = h > s.amp * 0.5;
    // the meadow grows in swathes, not on a lattice: macro patches decide
    // where the grass runs thick and where the bare earth shows through
    const patch = (hash(pp.seed, cx >> 4, cz >> 4, 0x6f) & 1023) / 1023;
    if (under || high || rr.chance(0.1 + patch * 0.55)) { hts[i] = 0; }
    else {
      roots[i * 3] = x; roots[i * 3 + 1] = h - 0.04; roots[i * 3 + 2] = z;
      hts[i] = rr.float(0.4, 1.15) * (1.2 - patch * 0.5);
      phs[i] = rr.next();
      leans[i] = rr.float(-0.4, 0.9);
    }
  };

  // torus indexing: slot i owns every world cell congruent to (i%W, i/W)
  // mod W — as you walk, a slot's cell jumps from behind you to ahead,
  // and only those slots get re-seated
  const cellOf = new Int32Array(N * 2).fill(0x7fffffff);
  let originX = null, originZ = null;
  const attrs = [blade.attributes.aRoot, blade.attributes.aH, blade.attributes.aPh, blade.attributes.aLean];
  const reseat = () => {
    const ox = Math.floor(s.body.x / CELL) - (W >> 1);
    const oz = Math.floor(s.body.z / CELL) - (W >> 1);
    if (ox === originX && oz === originZ) return;
    let touched = 0;
    for (let i = 0; i < N; i++) {
      const ti = i % W, tj = (i / W) | 0;
      const gx = ox + (((ti - ox) % W) + W) % W;
      const gz = oz + (((tj - oz) % W) + W) % W;
      if (cellOf[i * 2] !== gx || cellOf[i * 2 + 1] !== gz) {
        cellOf[i * 2] = gx; cellOf[i * 2 + 1] = gz;
        seat(i, gx, gz);
        touched++;
      }
    }
    originX = ox; originZ = oz;
    if (touched) for (const a of attrs) a.needsUpdate = true;
  };
  reseat();

  // ------------------------------------------------------ petals aloft ----
  // what the meadow lets go of, the wind carries: petals (or pale leaves)
  // streaming past you, spinning as they go
  const NP = COARSE ? 40 : 90;
  const pGeo = new THREE.BufferGeometry();
  const pPos = new Float32Array(NP * 3);
  const petals = new THREE.Points(pGeo, new THREE.PointsMaterial({
    map: softDotTexture(24),
    color: new THREE.Color().setHSL(r.float(0, 1), 0.7, 0.72),
    size: 0.32, transparent: true, opacity: 0.85,
    depthWrite: false, sizeAttenuation: true,
  }));
  const pVel = new Float32Array(NP * 3);
  const pLife = new Float32Array(NP);
  const spawnPetal = (i) => {
    // upwind of the camera, chest height to treetop
    const back = 24 + arand() * 30;
    const side = (arand() - 0.5) * 60;
    const x = s.body.x - s.wind.x * back - s.wind.y * side;
    const z = s.body.z - s.wind.y * back + s.wind.x * side;
    pPos[i * 3] = x;
    pPos[i * 3 + 1] = s.heightAt(x, z) + 1 + arand() * 7;
    pPos[i * 3 + 2] = z;
    pVel[i * 3] = s.wind.x * (3 + arand() * 3);
    pVel[i * 3 + 1] = 0;
    pVel[i * 3 + 2] = s.wind.y * (3 + arand() * 3);
    pLife[i] = 6 + arand() * 10;
  };
  for (let i = 0; i < NP; i++) { spawnPetal(i); pLife[i] *= arand(); }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  s.scene.add(petals);

  let t = 0;
  return {
    update(dt, sunY) {
      t += dt;
      reseat(false);
      petals.material.opacity = 0.35 + 0.5 * Math.min(Math.max((sunY + 0.15) * 3, 0), 1);
      for (let i = 0; i < NP; i++) {
        pLife[i] -= dt;
        if (pLife[i] <= 0) { spawnPetal(i); continue; }
        // flutter: sideways figure-eights on the way downwind
        pPos[i * 3] += (pVel[i * 3] + Math.sin(t * 2.1 + i) * 1.1) * dt;
        pPos[i * 3 + 1] += (Math.sin(t * 1.4 + i * 2.0) * 0.7 - 0.35) * dt;
        pPos[i * 3 + 2] += (pVel[i * 3 + 2] + Math.cos(t * 1.7 + i) * 1.1) * dt;
        const g = s.heightAt(pPos[i * 3], pPos[i * 3 + 2]);
        if (pPos[i * 3 + 1] < g + 0.2) pLife[i] = 0;   // came to rest
      }
      pGeo.attributes.position.needsUpdate = true;
    },
  };
}
