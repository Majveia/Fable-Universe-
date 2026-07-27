// Some nights, the town lets go of its lights.
//
// On a festival night the people of the town release sky-lanterns — warm
// paper flames that rise slowly out of the plaza, catch the wind, and drift
// up into the dark until they're indistinguishable from the stars. A bell
// rings out now and then across the fields. Whether tonight is a festival is
// fixed per world and per day, so the calendar is real: come back on the
// right night and the sky fills; come back on the wrong one and it's quiet.

import * as THREE from 'three';
import { RNG, arand, hash } from './rng.js';
import { softDotTexture } from './nebula.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const TWO_PI = Math.PI * 2;

/** deterministic: is the given night (day index) a festival on this world? */
function festivalNight(seed, dayIdx) {
  return (hash(seed, dayIdx, 0xfe57) & 255) < 108;   // ~42% of nights
}

export function addFestival(s) {
  const pp = s.pp;
  if (!pp.inhabited || !s.settlement) return null;
  const r = new RNG(hash(pp.seed, 0xfe57a1));
  const site = s.settlement.site;
  const lanternCol = new THREE.Color().setHSL(r.float(0.05, 0.1), 0.9, 0.62).multiplyScalar(1.5);

  const N = COARSE ? 60 : 130;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const lantern = [];
  for (let i = 0; i < N; i++) {
    lantern.push({ alive: false, y: 0, x: 0, z: 0, vy: 0, sway: r.float(0, TWO_PI), life: 0 });
    pos[i * 3 + 1] = -9999;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({
    map: softDotTexture(48), color: lanternCol, size: 8,
    transparent: true, opacity: 0.95, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  pts.frustumCulled = false;
  s.scene.add(pts);

  let spawnT = 0, bellT = 0, t = 0;
  const spawn = (l) => {
    // released from around the plaza, a spread of hearths
    const a = r.float(0, TWO_PI), rad = Math.abs(r.gauss()) * 55;
    l.x = site.x + Math.cos(a) * rad;
    l.z = site.z + Math.sin(a) * rad;
    l.y = s.heightAt(l.x, l.z) + 2;
    l.vy = r.float(3.5, 6);
    l.sway = r.float(0, TWO_PI);
    l.life = r.float(14, 26);
    l.alive = true;
  };

  return {
    festivalTonight: false,
    update(dt, sunY) {
      t += dt;
      const dayIdx = Math.floor(s.sunPhase / TWO_PI);
      const night = 1 - Math.min(Math.max((sunY + 0.05) * 4, 0), 1);
      const on = night > 0.4 && festivalNight(pp.seed, dayIdx);
      this.festivalTonight = on;

      // release new lanterns while the festival runs
      if (on) {
        spawnT -= dt;
        if (spawnT <= 0) {
          spawnT = 0.14 + arand() * 0.3;
          // release a small clutch at a time — a plaza lets go together
          for (let k = 0; k < 3; k++) { const l = lantern.find(x => !x.alive); if (l) spawn(l); }
        }
        // a bell across the fields, now and then
        bellT -= dt;
        if (bellT <= 0) {
          bellT = 3 + arand() * 6;
          s.app.audio?.festivalBell?.(s._scoreRoot ? s._scoreRoot * 2 : 261.6);
        }
      }

      const P = geo.attributes.position.array;
      let anyAlive = false;
      for (let i = 0; i < N; i++) {
        const l = lantern[i];
        if (!l.alive) { P[i * 3 + 1] = -9999; continue; }
        anyAlive = true;
        l.life -= dt;
        l.y += l.vy * dt;
        l.vy = Math.max(l.vy * (1 - dt * 0.1), 1.5);      // they slow as they rise
        l.x += (s.wind.x * 2.5 + Math.sin(t * 0.7 + l.sway) * 0.8) * dt;
        l.z += (s.wind.y * 2.5 + Math.cos(t * 0.6 + l.sway) * 0.8) * dt;
        if (l.life <= 0) l.alive = false;
        P[i * 3] = l.x; P[i * 3 + 1] = l.y; P[i * 3 + 2] = l.z;
      }
      geo.attributes.position.needsUpdate = true;
      // fade the whole swarm with how much of the night is left
      pts.material.opacity = anyAlive ? 0.55 + 0.4 * night : 0;
    },
  };
}
