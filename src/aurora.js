// The aurora, from orbit.
//
// Nested shells over each pole carrying a drifting curtain field at different
// radii, so the rays gain parallax depth as you move. The curtains live in
// longitude (tall, thin, slow), the band hugs the auroral oval, and everything
// multiplies by the night: on the day side there is nothing, at the terminator
// a whisper, at midnight under the oval the whole sky moves. Additive,
// depth-read-only, one draw call per emission line.
//
// ---------------------------------------------------------------------------
// The three numbers that used to be chosen, and now are not
//
// This file was built with the oval at |sin lat| = 0.95, an emerald shell at
// 1.030 R and a violet one at 1.048 R. All three were good choices and one of
// them was uncannily good: `src/magnetosphere.js` computes the oval from the
// magnetopause standoff and, for an Earth-like world under a G star, returns
// **0.946**. The eye had found the physics.
//
// So the guesses are gone and the formulas are in. What that buys is not
// accuracy — it is that the sky now *says* something:
//
//   · a world with no dynamo gets no shells at all, rather than a decorative
//     ring over a planet that physically cannot have one
//   · an active star compresses the magnetosphere and the ring slides toward
//     the equator, visibly, on a world you can then land on and look up from
//   · the shells sit at the altitudes their emission lines actually radiate at,
//     and are the colours those lines actually are, through the CIE observer
//   · a CO2 world's aurora is red, because its air has no nitrogen bands
//
// And it is the same oval, at the same latitude, in the same colours, as the
// curtain `src/curtain.js` draws from the ground. §2.5 asks for continuity
// between scales; two hand-tuned aurorae could never have had it.

import * as THREE from 'three';
import { NOISE_GLSL } from './planet.js';
import { magnetosphere, speciesFor, wavelengthRGB } from './magnetosphere.js';

const DEG = Math.PI / 180;

const AURORA_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const AURORA_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uColor;
  uniform float uGain;
  uniform float uOval;      // |sin(latitude)| of the oval, from the standoff
  uniform float uSpread;    // its width, from how much flux is open
  varying vec3 vDir;
  ${NOISE_GLSL}

  void main() {
    vec3 p = normalize(vDir);
    float night = smoothstep(0.08, -0.28, dot(p, normalize(uSunDir)));
    if (night <= 0.001) discard;
    float lat = abs(p.y);
    // The auroral oval. Its latitude is uOval, computed from this world's
    // magnetopause standoff, and it wanders because the magnetosphere breathes.
    float ovalC = uOval - uSpread * 0.6 * snoise(vec3(uTime * 0.013, uSeed, p.y * 2.0));
    float band = smoothstep(uSpread, uSpread * 0.2, abs(lat - ovalC));
    if (band <= 0.001) discard;
    // curtains: tall and thin — high frequency around, low along
    float lon = atan(p.z, p.x);
    float t = uTime;
    float c1 = snoise(vec3(lon * 6.0 + t * 0.05, lat * 3.0, uSeed * 7.7));
    float c2 = snoise(vec3(lon * 17.0 - t * 0.11, lat * 5.0 + t * 0.02, uSeed * 3.1));
    float cur = pow(max(c1 * 0.6 + c2 * 0.55, 0.0), 2.2);
    float a = band * cur * night * uGain;
    gl_FragColor = vec4(uColor * a, a * 0.85);
  }
`;

/**
 * Hang the aurora over a world — or do not, if it has no magnetosphere.
 *
 * Returns `null` for a world with a dead core, which is the common case and
 * the honest one. The caller already guards on `res.aurora`; this is the
 * second, physical gate behind it.
 */
export function addAurora(s) {
  const mag = magnetosphere(s.pp, {
    starT: s.ctx?.system?.temp ?? s.starT ?? 5778,
    auDist: s.pp.au ?? 1,
  });
  if (!mag.hasOval) return null;

  // |sin(latitude)| of the oval. The old hand-picked 0.95 is what this returns
  // for an Earth-like world, which is why it looked right.
  const oval = Math.cos(mag.colat * DEG);
  // A weakly held-off magnetosphere has a broad, bright oval; a tightly held
  // one a narrow faint ring. openFlux is that, normalised to Earth's.
  const spread = Math.min(0.06 + 0.05 * Math.log2(Math.max(mag.openFlux, 0.25) + 1), 0.2);

  const RKm = Math.max((s.pp.radiusE ?? 1) * 6371, 200);
  const lines = speciesFor(s.pp, Math.max(s.pp.atmo ?? 1, 0.2));

  const group = new THREE.Group();
  const mats = [];
  // one shell per emission line, at the altitude that line actually radiates
  // from, in the colour that line actually is
  for (const [radK, color, gain] of lines.map((l) => [
    1 + l.peak / RKm,
    new THREE.Color(...wavelengthRGB(l.nm)),
    l.weight * 1.15,
  ])) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: s.uSunDir,
        uTime: s.uTime,
        uSeed: { value: s.pp.noiseSeed },
        uColor: { value: color },
        uGain: { value: gain },
        uOval: { value: oval },
        uSpread: { value: spread },
      },
      vertexShader: AURORA_VERT,
      fragmentShader: AURORA_FRAG,
      // both faces: from the ground you stand inside the shell, from
      // orbit you look across at it — the curtains must read either way
      side: THREE.DoubleSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(s.R * radK, 64, 48), mat);
    shell.renderOrder = 4;
    group.add(shell);
    mats.push(mat);
  }
  s.planetGroup.add(group);
  return {
    dispose() {
      s.planetGroup.remove(group);
      group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    },
  };
}
