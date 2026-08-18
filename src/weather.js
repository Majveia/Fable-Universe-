// The weather rolls through.
//
// Squalls cross the country on their own slow schedule: the light dims, a
// grey curtain sweeps in on the wind, rain streaks past you, and the ground
// darkens and holds a sheen long after the cloud has gone. And in the low
// hours — dawn and dusk — mist pools in the valleys, thickest over water and
// in the folds of the hills, burning off as the sun climbs. Both are the
// same wind that moves the grass and the sea; the world breathes as one.

import * as THREE from 'three';
import { RNG, arand, hash } from './rng.js';
import { precipFor, wrap } from './precip.js';
import { gravityOf } from './avatar.js';
import { softDotTexture } from './nebula.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export function addWeather(s) {
  const pp = s.pp;
  // molten and airless worlds keep their own sky; everyone else gets weather
  if (pp.typeId === 4 || s.atmo < 0.35) return null;
  const r = new RNG(hash(pp.seed, 0x3ea1e5));
  const rainy = pp.type === 'ocean' || (pp.clouds ?? 0) > 0.35 || pp.Teq < 285;

  // What actually falls here, and how fast — `src/precip.js` (§9).
  //
  // This used to be `const fall = 55 * dt` on every world in the universe.
  // 55 m/s is about six times a real raindrop, and being the same number
  // everywhere meant the one thing weather could have told you about a world —
  // how thick its air is — it instead concealed.
  //
  // Surface temperature is the equilibrium temperature with the atmosphere's
  // greenhouse folded in the same crude way `aerial.js` does it, because the
  // phase boundary is at 273 K and Teq alone would put snow on worlds that have
  // liquid oceans.
  const surfaceK = (pp.Teq ?? 288) * (1 + 0.28 * Math.min(s.atmo, 3));
  const PRECIP = precipFor({
    surfaceK, atmo: s.atmo, gravity: gravityOf(pp),
  });

  // ------------------------------------------------------------- rain ----
  const N = COARSE ? 500 : 1100;
  const span = 90, top = 60;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (arand() - 0.5) * span;
    pos[i * 3 + 1] = arand() * top;
    pos[i * 3 + 2] = (arand() - 0.5) * span;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const rain = new THREE.Points(geo, new THREE.PointsMaterial({
    color: new THREE.Color(0.7, 0.76, 0.85), size: 0.5,
    map: streakTexture(), transparent: true, opacity: 0,
    depthWrite: false, sizeAttenuation: true,
    blending: THREE.NormalBlending,
  }));
  rain.frustumCulled = false;
  s.scene.add(rain);

  // a soft grey curtain that rides in front of the squall
  const curtain = new THREE.Mesh(
    new THREE.SphereGeometry(600, 16, 8),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.42, 0.46, 0.52), transparent: true, opacity: 0,
      side: THREE.BackSide, depthWrite: false, fog: false,
    }));
  curtain.frustumCulled = false;
  s.scene.add(curtain);

  // ------------------------------------------------------------- mist ----
  // low banks of fog that settle in the valleys and lift with the sun
  const NM = COARSE ? 10 : 20;
  const mistTex = softDotTexture(64);
  const mist = [];
  for (let i = 0; i < NM; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mistTex, color: new THREE.Color(0.8, 0.84, 0.9),
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.NormalBlending,
    }));
    sp.scale.set(r.float(120, 240), r.float(40, 80), 1);
    s.scene.add(sp);
    mist.push({ sp, ox: r.float(-1, 1), oz: r.float(-1, 1), drift: r.float(0, 6.28) });
  }

  let stormT = r.float(0, 100);
  let t = 0;
  const _c = new THREE.Vector3();

  return {
    raining: false,
    update(dt, sunY) {
      t += dt;
      stormT += dt;
      // a squall every couple of minutes, if this world is the rainy sort
      const cycle = rainy ? 150 : 320;
      const phase = (stormT % cycle) / cycle;
      const storm = rainy
        ? Math.max(0, Math.sin((phase - 0.15) * Math.PI * 2)) * smooth(phase, 0.1, 0.45)
        : Math.max(0, Math.sin(phase * Math.PI * 2) - 0.75) * 4 * 0.4;
      const wet = Math.min(Math.max(storm * 1.6, 0), 1);
      this.raining = storm > 0.15;

      // wetness lags: it darkens fast in rain, dries slow after
      const cur = s.uWet.value;
      s.uWet.value += ((storm > 0.1 ? wet : 0) - cur) * (storm > 0.1 ? 1 - Math.exp(-dt * 0.8) : 1 - Math.exp(-dt * 0.12));

      const day = Math.min(Math.max((sunY + 0.15) * 3, 0), 1);
      // rain follows the camera; streaks fall and recycle, blown by the wind
      rain.position.set(s.camera.position.x, 0, s.camera.position.z);
      rain.material.opacity = storm * 0.6 * (0.3 + 0.7 * day);
      if (storm > 0.03) {
        const P = geo.attributes.position.array;
        // §6 M3 · rain slants on the *same* field that bends the grass, so a
        // gust arriving is one event in the frame rather than two systems
        // happening to be busy at once. Sampled once for the whole curtain —
        // it spans 120 m and the field varies over hundreds, so per-drop
        // sampling would buy nothing and cost N evaluations a frame.
        //
        // No terrain coupling: the speed-up over a crest is a boundary-layer
        // effect and a raindrop at forty metres is not in the boundary layer.
        const w = s.sampleWind
          ? s.sampleWind(s.camera.position.x, s.camera.position.z, 40)
          : { x: s.wind.x * 4, z: s.wind.y * 4 };
        // Terminal velocity, not a constant — and snow where it is cold enough,
        // which on a given world is a fact rather than a setting.
        const vT = PRECIP.snow > 0.5 ? PRECIP.vSnow : PRECIP.vRain;
        const fall = vT * dt;
        // Wind pushes precipitation toward the air's own speed, and how far it
        // gets is the velocity triangle: slow snow is carried almost fully,
        // fast rain barely leans. One number instead of a 2.2 nobody could name.
        const drag = Math.min(1 / Math.max(vT, 0.5), 1.6);
        const wx = w.x * drag * dt, wz = w.z * drag * dt;
        // Camera-*relative*, because line 110 already translates the group to
        // the camera each frame — which is the reference's own arrangement and
        // is what keeps float precision high this far from the origin. So the
        // box is centred on zero, not on the camera's world position; wrapping
        // around the latter would be wrong by exactly the camera's position,
        // which is a bug that only shows up once you have walked somewhere.
        for (let i = 0; i < N; i++) {
          P[i * 3] += wx; P[i * 3 + 1] -= fall; P[i * 3 + 2] += wz;
          // Wrap, do not respawn (§9, idea 1). A drop leaving the bottom
          // re-enters at the top with its horizontal phase intact, and one
          // leaving the side re-enters opposite — so density is exactly
          // constant and nothing trails the camera. Respawning three
          // coordinates at once is what put a visible wave behind a walking
          // player, and it is the loudest tell a rain system has.
          if (P[i * 3 + 1] < 0) P[i * 3 + 1] += top;
          P[i * 3] = wrap(P[i * 3], 0, span);
          P[i * 3 + 2] = wrap(P[i * 3 + 2], 0, span);
        }
        geo.attributes.position.needsUpdate = true;
      }
      curtain.position.copy(s.camera.position);
      curtain.material.opacity = storm * 0.28 * (0.3 + 0.7 * day);

      // mist: strongest in the low-sun hours, thinning at high noon, and it
      // hangs over the low ground — the valleys and the water's edge
      const lowSun = Math.max(1 - Math.abs(sunY - 0.05) * 3.5, 0);
      const mistAmt = Math.min(lowSun * 0.9 + storm * 0.5, 1) * s.atmo;
      for (let i = 0; i < mist.length; i++) {
        const m = mist[i];
        const rad = 140 + i * 14;
        const a = m.drift + t * 0.03;
        const x = s.camera.position.x + Math.cos(a) * rad + m.ox * 40;
        const z = s.camera.position.z + Math.sin(a) * rad + m.oz * 40;
        const g = Math.max(s.heightAt(x, z), s.seaLevel === null ? -1e9 : s.seaLevel);
        m.sp.position.set(x, g + 8 + Math.sin(t * 0.2 + i) * 3, z);
        // pool in the low places: fade with height above the local sea/floor
        const low = s.seaLevel !== null ? Math.max(1 - (g - s.seaLevel) / (s.amp * 0.35), 0) : 0.6;
        m.sp.material.opacity = mistAmt * (0.12 + low * 0.28);
      }
    },
  };
}

function smooth(x, a, b) { return Math.min(Math.max((x - a) / (b - a), 0), 1); }

function streakTexture() {
  const cv = document.createElement('canvas');
  cv.width = 8; cv.height = 32;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(2, 0, 4, 32);
  return new THREE.CanvasTexture(cv);
}
