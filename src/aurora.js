// The aurora.
//
// Worlds that wear winter light get the sky to prove it: two nested
// shells over each pole — an emerald base and a violet crown — carrying
// the same drifting curtain field at different radii, so the rays gain
// parallax depth as you move. The curtains live in longitude (tall, thin,
// slow), the band hugs the auroral oval, and everything multiplies by
// the night: on the day side there is nothing, at the terminator a
// whisper, at midnight under the oval the whole sky moves. Additive,
// depth-read-only, two draw calls.

import * as THREE from 'three';
import { NOISE_GLSL } from './planet.js';

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
  varying vec3 vDir;
  ${NOISE_GLSL}

  void main() {
    vec3 p = normalize(vDir);
    float night = smoothstep(0.08, -0.28, dot(p, normalize(uSunDir)));
    if (night <= 0.001) discard;
    float lat = abs(p.y);
    // the auroral oval: a band around ±72°, wandering slowly with time
    float ovalC = 0.95 - 0.06 * snoise(vec3(uTime * 0.013, uSeed, p.y * 2.0));
    float band = smoothstep(0.10, 0.02, abs(lat - ovalC));
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

/** hang the aurora over an inhabited-by-winter world; returns a handle */
export function addAurora(s) {
  const group = new THREE.Group();
  const mats = [];
  // base curtain in emerald, crown in violet — parallax between the shells
  for (const [radK, color, gain] of [
    [1.030, new THREE.Color(0.15, 1.05, 0.42), 1.15],
    [1.048, new THREE.Color(0.62, 0.28, 1.05), 0.7],
  ]) {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: s.uSunDir,
        uTime: s.uTime,
        uSeed: { value: s.pp.noiseSeed },
        uColor: { value: color },
        uGain: { value: gain },
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
