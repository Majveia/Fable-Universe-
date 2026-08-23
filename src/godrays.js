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
import { CSHADE_ON, cloudBeamAt } from './cloudshade.js';

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

      // Is the sun behind a cloud right now?
      //
      // Motes and a corona are both *beam* phenomena: dust is only visible
      // because a sunbeam is passing through it, and a corona is the sun seen
      // through air. When the deck covers the sun both should go out, and the
      // moment the gap arrives they should come back — which is the difference
      // between god rays that are a property of the weather and god rays that
      // are a permanent decoration hanging in front of the camera.
      //
      // One CPU evaluation a frame, at the camera, rather than a custom shader
      // asking the same question of seven hundred particles and getting the
      // same answer. `cloudshade.js` carries the twin for exactly this.
      let beam = 1;
      if (CSHADE_ON && s._cloudShade) {
        const cs = s._cloudShade();
        const u = cs.uniforms;
        beam = cloudBeamAt(s.camera.position, sun, {
          deck: u.uCsDeck.value,
          drift: u.uCloudDrift.value,
          amount: u.uCloudAmount.value,
          tau: u.uCsTau.value,
          blur: u.uCsBlur.value,
          octaves: cs.octaves,
        }).beam;
      }

      // the corona sits along the sun ray, far out
      corona.position.copy(s.camera.position).addScaledVector(sun, 6000);
      corona.scale.setScalar(1400);
      corona.material.opacity = low * day * 0.26 * s.atmo * beam;

      // motes: brighten when you face the sun (backlit air), drift on the wind
      s.camera.getWorldDirection(fwd);
      const facing = Math.max(fwd.dot(sun), 0);
      motes.material.opacity = (0.05 + facing * facing * 0.4) * low * day * s.atmo * beam;
      motes.position.set(s.camera.position.x, 0, s.camera.position.z);
      const P = geo.attributes.position.array;
      // dust in a shaft of light is *in* the boundary layer and near the
      // ground, so it gets the gusts — it is the finest-grained thing in the
      // frame and the first place a front becomes visible
      const w = s.sampleWind
        ? s.sampleWind(s.camera.position.x, s.camera.position.z, 2.5)
        : { x: (s.wind?.x ?? 0) * 4, z: (s.wind?.y ?? 0) * 4 };
      const wx = w.x * 0.5 * dt, wz = w.z * 0.5 * dt;
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
