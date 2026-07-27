// The light made visible.
//
// When the sun rides low the air itself glows: motes of dust drift through
// the sunbeams and catch fire when you face the light, and a great soft
// corona hangs where the star sits, which the bloom pass draws out into
// shafts. Together they give every vista the luminous, god-rayed atmosphere
// of a held breath at golden hour — the spectacle that crowns a world.

import * as THREE from 'three';
import { softDotTexture } from './nebula.js';
import { arand } from './rng.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export function addGodRays(s) {
  if (s.atmo < 0.35) return null;
  const N = COARSE ? 260 : 700;
  const SPAN = 240;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (arand() - 0.5) * SPAN;
    pos[i * 3 + 1] = arand() * 120;
    pos[i * 3 + 2] = (arand() - 0.5) * SPAN;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const motes = new THREE.Points(geo, new THREE.PointsMaterial({
    map: softDotTexture(24), color: new THREE.Color(1.2, 1.05, 0.75),
    size: 1.1, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  motes.frustumCulled = false;
  s.scene.add(motes);

  // the sun's corona: a soft disk out along the sun ray that bloom smears
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture(128), color: s.uSunColor.value.clone().multiplyScalar(1.6),
    transparent: true, opacity: 0, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
  }));
  corona.frustumCulled = false;
  corona.renderOrder = 3;
  s.scene.add(corona);

  const fwd = new THREE.Vector3();
  let t = 0;
  return {
    update(dt) {
      t += dt;
      const sun = s.uSunDir.value;
      const low = Math.max(1 - Math.abs(sun.y - 0.06) * 3.2, 0);   // strongest at golden hour
      const day = Math.min(Math.max((sun.y + 0.1) * 3, 0), 1);

      // the corona sits along the sun ray, far out
      corona.position.copy(s.camera.position).addScaledVector(sun, 6000);
      corona.scale.setScalar(1400);
      corona.material.opacity = low * day * 0.26 * s.atmo;

      // motes: brighten when you face the sun (backlit air), drift on the wind
      s.camera.getWorldDirection(fwd);
      const facing = Math.max(fwd.dot(sun), 0);
      motes.material.opacity = (0.05 + facing * facing * 0.4) * low * day * s.atmo;
      motes.position.set(s.camera.position.x, 0, s.camera.position.z);
      const P = geo.attributes.position.array;
      const wx = (s.wind?.x ?? 0) * 2 * dt, wz = (s.wind?.y ?? 0) * 2 * dt;
      for (let i = 0; i < N; i++) {
        P[i * 3] += wx + Math.sin(t * 0.5 + i) * 0.05;
        P[i * 3 + 2] += wz;
        if (P[i * 3] > SPAN / 2) P[i * 3] -= SPAN; else if (P[i * 3] < -SPAN / 2) P[i * 3] += SPAN;
        if (P[i * 3 + 2] > SPAN / 2) P[i * 3 + 2] -= SPAN; else if (P[i * 3 + 2] < -SPAN / 2) P[i * 3 + 2] += SPAN;
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
