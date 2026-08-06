// Every world's people looked up and drew their own figures in the dark.
//
// A handful of constellations hang in each world's night: bright stars joined
// by hairline strokes. They fade in only when the sky is dark, wheel with the
// night as the world turns, and — like everything here — are the same figures
// in the same places every time you return.
//
// ---------------------------------------------------------------------------
// The names are computed and never drawn, which is the whole point
//
// This module used to paint each figure's name into the sky as a sprite, in
// `300 34px "Helvetica Neue", Arial, sans-serif`. It was the only place in
// `src/` that drew letterforms into a world, and it broke three things at once:
//
// - **§2.1**, which forbids web fonts by name. Letterforms are the most
//   authored asset there is — a typeface is somebody's drawing — and this
//   imported one from whatever the operating system happened to have.
// - **§2.3**, and visibly. That font stack resolves to Helvetica Neue on
//   macOS, Arial on Windows and Liberation or DejaVu on Linux, so one seed
//   gave three different skies. §11 calls this a determinism leak; it was the
//   only one anybody could *see*.
// - **§4, and §8's seventh axis.** "Minimalism is a property of the chrome."
//   A caption hanging over an alien horizon is chrome that escaped into the
//   world, and it read as a label on a place rather than as the place.
//
// The figures were never the problem. The directions, the star counts, the
// spread, the hue and the walk order all come out of `RNG(hash(seed))` and
// always did. Only the caption was imported.
//
// So the names are still derived and still deterministic, and they are returned
// in this module's API for the HUD or the logbook to use if they ever want
// them. The sky simply does not spell them out. A constellation is a shape you
// are told about, not a shape with its name written beside it.

import * as THREE from 'three';
import { hash, RNG, constellationName } from './rng.js';
import { softDotTexture } from './nebula.js';
import { now } from './clock.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const SKY_R = 15000;

export function addConstellations(s) {
  if (s.atmo < 0.35) return null;   // airless skies keep their raw stars
  const r = new RNG(hash(s.pp.seed, 0xc025be11));
  const group = new THREE.Group();
  group.frustumCulled = false;
  s.scene.add(group);

  const K = COARSE ? 3 : r.int(4, 6);
  const starTex = softDotTexture(48);
  const names = [];
  const starMats = [];
  const lineMats = [];

  for (let c = 0; c < K; c++) {
    const name = constellationName(s.pp.seed, c);
    // a seed direction well above the horizon, spread around the sky
    const az = (c / K) * Math.PI * 2 + r.float(-0.4, 0.4);
    const el = r.float(0.35, 1.15);
    const dir = new THREE.Vector3(
      Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
    // a local frame to scatter the figure's stars across a patch of sky
    const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const ex = new THREE.Vector3().crossVectors(up, dir).normalize();
    const ey = new THREE.Vector3().crossVectors(dir, ex).normalize();

    const n = r.int(4, 7);
    const nodes = [];
    const spread = r.float(0.11, 0.2);
    for (let i = 0; i < n; i++) {
      const a = r.float(-spread, spread), b = r.float(-spread, spread);
      const p = dir.clone().addScaledVector(ex, a).addScaledVector(ey, b).normalize().multiplyScalar(SKY_R);
      nodes.push(p);
    }
    // bright named stars
    const starGeo = new THREE.BufferGeometry();
    const sp = new Float32Array(n * 3);
    nodes.forEach((p, i) => sp.set([p.x, p.y, p.z], i * 3));
    starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    const starMat = new THREE.PointsMaterial({
      map: starTex, color: new THREE.Color().setHSL(r.float(0.55, 0.68), 0.4, 0.85),
      size: 220, transparent: true, opacity: 0, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    stars.renderOrder = 2;
    group.add(stars);
    starMats.push(starMat);

    // join them into a figure: a walk through the nodes (a path, not a mesh)
    const order = [...nodes.keys()].sort((a, b) =>
      nodes[a].distanceToSquared(nodes[0]) - nodes[b].distanceToSquared(nodes[0]));
    const segs = [];
    for (let i = 0; i < order.length - 1; i++) {
      segs.push(nodes[order[i]], nodes[order[i + 1]]);
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(segs);
    const lineMat = new THREE.LineBasicMaterial({
      color: new THREE.Color(0.55, 0.68, 0.95), transparent: true, opacity: 0,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    const line = new THREE.LineSegments(lineGeo, lineMat);
    line.frustumCulled = false;
    line.renderOrder = 2;
    group.add(line);
    lineMats.push(lineMat);

    names.push(name);
  }

  return {
    count: K,
    /** derived, deterministic, and deliberately not painted into the sky */
    names,
    update(dt, sunY) {
      // dark of night reveals them; a slow twinkle keeps them alive
      const dark = Math.max(1 - Math.max(sunY + 0.05, 0) * 4 * s.atmo, 0);
      const tw = 0.85 + 0.15 * Math.sin(now() * 1.3);
      for (const m of starMats) m.opacity = dark * tw;
      for (const m of lineMats) m.opacity = dark * 0.32;
    },
  };
}
