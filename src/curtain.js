// The curtain — the aurora, made visible.
//
// `src/magnetosphere.js` is the physics: where the oval sits, which lines the air can
// emit, at what altitude, and what colour each of those is. It imports no
// three, which is what lets `tools/verify.js` hold every one of those claims to
// a number without a browser.
//
// This file is where that meets a GPU — the ribbon's buffers, the material, and
// the substorm that drives it. Exactly the split `src/wind.js` and
// `src/flora.js` already use, and for exactly the same reason: the interesting
// half of a physical effect is the half a test can reach.

import * as THREE from 'three';
import { RNG, hash } from './rng.js';
import { noiseGLSL } from './planet.js';
import {
  AURORA_FRAG, AURORA_VERT, auroralGeometry, magnetosphere, ribbonMesh,
  speciesFor, speciesGLSL,
} from './magnetosphere.js';

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

/**
 * An aurora over one world, or `null` if the physics says there is not one.
 *
 * `null` is a real answer and the common one: a world with no dynamo has no
 * oval, and returning a faint ring anyway would make the sky stop being a
 * readout — which is the only reason this file exists.
 */
export function addAurora(pp, { latDeg = 62, starT = 5778, auDist = 1, RKm = 6371,
  hScale = 1, skyR = 12000 } = {}) {
  const mag = magnetosphere(pp, { starT, auDist });
  if (!mag.hasOval || (pp.atmo ?? 1) < 0.05) return null;

  const geom = auroralGeometry(pp, latDeg, mag, { RKm });
  // Beyond about 2500 km the oval is a glow on the horizon and not worth a
  // draw call; inside about −8° the observer is under the cap, where the
  // curtain is overhead and this ribbon's parameterisation stops being right.
  if (geom.gapKm > 2600 || geom.gapDeg < -6) return null;

  const lines = speciesFor(pp, hScale);
  const r = ribbonMesh(mag, geom, lines, { RKm, skyR });
  const { loKm, hiKm } = r;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(r.pos, 3));
  geometry.setAttribute('aAlong', new THREE.BufferAttribute(r.along, 1));
  geometry.setAttribute('aAlt', new THREE.BufferAttribute(r.alt, 1));
  geometry.setIndex(new THREE.BufferAttribute(r.index, 1));
  geometry.computeBoundingSphere();

  const uniforms = {
    uTime: { value: 0 },
    uPower: { value: 0 },
    uNight: { value: 0 },
  };
  const frag = AURORA_FRAG(noiseGLSL(true), speciesGLSL(lines), loKm, hiKm);

  const mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: AURORA_VERT,
    fragmentShader: frag,
    uniforms,
    transparent: true,
    // Additive, because emission adds photons to whatever is behind it — and
    // §2.8's vacuum clause is not at stake here: this is inside an atmosphere,
    // and the lifted print still owns the blacks.
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  }));
  mesh.frustumCulled = false;
  // sky dome 0 · stars 1 · **aurora 1.5** · clouds 2. Not arbitrary and not a
  // detail: the sky is a sphere at radius 20000 with renderOrder 0, so at -5
  // this drew first and the sky painted straight over it. The frame was a
  // perfectly ordinary night with no aurora in it and nothing to say why.
  //
  // Clouds after it is the physical order too — a cloud is five kilometres up
  // and the curtain is a hundred, so the cloud is in front.
  mesh.renderOrder = 1.5;
  mesh.userData.noAerial = true;    // it is emission at 100 km, not a surface

  // Bearing. The ribbon is built facing -Z and has to be turned toward the
  // oval, and §9.7 decides how much freedom there is in that: *"at least one
  // hero landmark in the opening frustum"*. An aurora is a hero landmark, so
  // when a world has one the opening frame gets it — the same class of spawn
  // constraint the landing solver already applies to leading lines and ridges,
  // and the reason §3 says composition is a solver constraint rather than a
  // decoration.
  //
  // The seeded ±38° keeps it from being centred, which §9.7 also asks for.
  mesh.userData.bearingJitter = new RNG(hash(pp.seed ?? 0, 0xa17c)).float(-0.66, 0.66);

  return {
    mesh, mag, geom, lines, uniforms,
    /**
     * `sunY` is the sun's height; `t` is seconds. Two things change and they
     * are different: night is whether you can see it at all, and the substorm
     * is whether there is anything to see.
     */
    update(t, sunY) {
      uniforms.uTime.value = t;
      // Civil twilight is about −6°; an aurora is washed out well before that,
      // so the gate is the sun's own height rather than a clock.
      uniforms.uNight.value = clamp((-sunY - 0.02) / 0.12, 0, 1);
      // The substorm cycle: loading and unloading of the magnetotail, roughly
      // an hour-scale sawtooth in reality. Deterministic in t, so a capture
      // taken twice is the same aurora — §2.3 reaches animation too.
      const s = new RNG(hash(pp.seed ?? 0, 0xa17d)).float(0, 1000);
      const load = 0.5 + 0.5 * Math.sin(t * 0.021 + s);
      const gust = 0.5 + 0.5 * Math.sin(t * 0.11 + s * 1.7);
      uniforms.uPower.value = clamp(
        (0.28 + 0.72 * Math.pow(load, 2.2)) * (0.7 + 0.3 * gust) * clamp(mag.openFlux, 0.25, 2.4),
        0, 1.6);
    },
    dispose() { geometry.dispose(); mesh.material.dispose(); },
  };
}
