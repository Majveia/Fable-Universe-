// Every world's people looked up and drew their own figures in the dark.
//
// A handful of constellations hang in each world's night: bright named
// stars joined by hairline strokes, with a label that kindles beneath the
// figure. They fade in only when the sky is dark, wheel with the night as
// the world turns, and — like everything here — are the same figures in the
// same places every time you return. Look up at dusk and the sky has names.

import * as THREE from 'three';
import { hash, RNG, constellationName } from './rng.js';
import { softDotTexture } from './nebula.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const SKY_R = 15000;

function labelTexture(text) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 96;
  const g = cv.getContext('2d');
  g.clearRect(0, 0, 512, 96);
  g.font = '300 34px "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(220,230,255,0.92)';
  // letter-spaced, the way the rest of the interface breathes
  const spaced = text.toUpperCase().split('').join(' ');
  g.fillText(spaced, 256, 52);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 2;
  return tex;
}

export function addConstellations(s) {
  if (s.atmo < 0.35) return null;   // airless skies keep their raw stars
  const r = new RNG(hash(s.pp.seed, 0xc025be11));
  const group = new THREE.Group();
  group.frustumCulled = false;
  s.scene.add(group);

  const K = COARSE ? 3 : r.int(4, 6);
  const starTex = softDotTexture(48);
  const labels = [];
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

    // the label, kindled beneath the figure
    const centroid = new THREE.Vector3();
    nodes.forEach(p => centroid.add(p));
    centroid.multiplyScalar(1 / n);
    const lowest = Math.min(...nodes.map(p => p.y));
    centroid.y = lowest - SKY_R * 0.045;
    const labelMat = new THREE.SpriteMaterial({
      map: labelTexture(name), transparent: true, opacity: 0,
      depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    });
    const label = new THREE.Sprite(labelMat);
    label.position.copy(centroid);
    label.scale.set(2600, 490, 1);
    label.renderOrder = 3;
    group.add(label);
    labels.push(labelMat);
  }

  return {
    count: K,
    update(dt, sunY) {
      // dark of night reveals them; a slow twinkle keeps them alive
      const dark = Math.max(1 - Math.max(sunY + 0.05, 0) * 4 * s.atmo, 0);
      const tw = 0.85 + 0.15 * Math.sin(performance.now() * 0.0013);
      for (const m of starMats) m.opacity = dark * tw;
      for (const m of lineMats) m.opacity = dark * 0.32;
      for (const m of labels) m.opacity = dark * 0.7;
    },
  };
}
