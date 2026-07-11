// The second inhabited scale: orbit.
//
// Inhabited worlds carry stations on circular orbits — truss, habitat
// ring, panel wings, a beacon — and a handful of ships flying errands:
// surface-to-station climbs, station transfers, the occasional departure
// for deep space. Every hull carries an additive sprite whose brightness
// follows the true sunlit test against the planet's shadow cylinder, so
// from the ground at night they are moving lights among the stars that
// dim into eclipse mid-pass, exactly like the station passes you can
// watch from a real backyard.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture } from './nebula.js';

const _t1 = new THREE.Vector3();
const _t2 = new THREE.Vector3();
const _t3 = new THREE.Vector3();

export function addOrbitals(s) {
  if (!s.pp.inhabited) return null;
  const r = new RNG(hash(s.pp.seed, 0xb17a));
  const R = s.R;
  const group = new THREE.Group();
  s.planetGroup.add(group);
  const tex = softDotTexture();

  const metal = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.5, metalness: 0.8 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x2b3f66, roughness: 0.35, metalness: 0.4 });

  // ---- stations -----------------------------------------------------
  const stations = [];
  const nSt = 1 + (r.chance(0.45) ? 1 : 0);
  for (let i = 0; i < nSt; i++) {
    const st = new THREE.Group();
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 8), metal);
    core.rotation.z = Math.PI / 2;
    st.add(core);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.03, 8, 24), metal);
    ring.rotation.y = Math.PI / 2;
    st.add(ring);
    for (const sgn of [-1, 1]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.005, 0.12), panel);
      p.position.x = sgn * 0.36;
      st.add(p);
    }
    st.scale.setScalar(r.float(0.25, 0.5));
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(1.5, 1.45, 1.3),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    spr.scale.setScalar(6);
    st.add(spr);
    group.add(st);
    // orbit basis from inclination + node
    const inc = r.float(-0.55, 0.55), node = r.float(0, Math.PI * 2);
    const axis = new THREE.Vector3(Math.sin(inc) * Math.cos(node), Math.cos(inc), Math.sin(inc) * Math.sin(node));
    let e1 = new THREE.Vector3(0, 1, 0).cross(axis);
    if (e1.lengthSq() < 1e-6) e1 = new THREE.Vector3(1, 0, 0).cross(axis);
    e1.normalize();
    const e2 = new THREE.Vector3().crossVectors(axis, e1);
    stations.push({
      obj: st, spr, e1, e2,
      orbR: R * r.float(1.12, 1.5),
      phase: r.float(0, Math.PI * 2),
      w: r.float(0.008, 0.02) * (r.chance(0.5) ? 1 : -1),
      spin: r.float(0.02, 0.08),
    });
  }
  const stationPos = (st, time, out) =>
    out.copy(st.e1).multiplyScalar(Math.cos(st.phase + st.w * time))
      .addScaledVector(st.e2, Math.sin(st.phase + st.w * time)).multiplyScalar(st.orbR);

  // ---- ships ----------------------------------------------------------
  const ships = [];
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.11, 6), metal);
    body.rotation.x = Math.PI / 2;   // nose along +z
    g.add(body);
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(1.4, 1.2, 0.9),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    spr.scale.setScalar(2.2);
    g.add(spr);
    g.visible = false;
    group.add(g);
    ships.push({ obj: g, spr, state: 'idle', wait: r.float(2, 25), t: 0, dur: 1, ph: r.float(0, 6.28) });
  }
  // route endpoints: functions of time, so a moving station still docks
  const endpoint = (time) => {
    const roll = Math.random();
    if (roll < 0.55 && stations.length) {
      const st = stations[(Math.random() * stations.length) | 0];
      return (tt, out) => stationPos(st, tt, out);
    }
    if (roll < 0.85) {
      // a point low over the world (a launch/landing corridor)
      const z = Math.random() * 2 - 1, th = Math.random() * 6.28;
      const q = Math.sqrt(1 - z * z);
      const d = new THREE.Vector3(q * Math.cos(th), z, q * Math.sin(th));
      return (tt, out) => out.copy(d).multiplyScalar(R * 1.03);
    }
    // gone to deep space
    const z = Math.random() * 2 - 1, th = Math.random() * 6.28;
    const q = Math.sqrt(1 - z * z);
    const d = new THREE.Vector3(q * Math.cos(th), z, q * Math.sin(th));
    return (tt, out) => out.copy(d).multiplyScalar(R * 3.6);
  };

  const sunlit = (pos, sun) => {
    const d = pos.dot(sun);
    if (d > 0) return 1;
    return _t1.copy(pos).addScaledVector(sun, -d).length() > R ? 1 : 0;
  };

  let time = 0;
  return {
    stations: stations.length,
    update(dt) {
      time += dt;
      const sun = s.uSunDir.value;
      for (const st of stations) {
        stationPos(st, time, st.obj.position);
        st.obj.rotation.y += st.spin * dt;
        const lit = sunlit(st.obj.position, sun);
        st.spr.material.opacity = lit ? 1 : 0.1;
        st.spr.material.color.setRGB(lit ? 1.5 : 0.5, lit ? 1.45 : 0.12, lit ? 1.3 : 0.1);
      }
      for (const sh of ships) {
        if (sh.state === 'idle') {
          sh.wait -= dt;
          if (sh.wait <= 0) {
            sh.from = endpoint(time); sh.to = endpoint(time);
            sh.t = 0;
            sh.from(time, _t1); sh.to(time, _t2);
            sh.dur = 14 + _t1.distanceTo(_t2) / 9;   // ~9 units/s cruise
            sh.state = 'fly';
            sh.obj.visible = true;
          }
          continue;
        }
        sh.t += dt / sh.dur;
        if (sh.t >= 1) {
          sh.state = 'idle'; sh.wait = 6 + Math.random() * 26;
          sh.obj.visible = false;
          continue;
        }
        const sm = sh.t * sh.t * (3 - 2 * sh.t);
        sh.from(time, _t1); sh.to(time, _t2);
        // separate direction and radius so transfers arc, never tunnel
        const r0 = _t1.length(), r1 = _t2.length();
        _t3.copy(_t1).multiplyScalar(1 - sm).addScaledVector(_t2, sm).normalize();
        const rad = r0 * (1 - sm) + r1 * sm + Math.sin(Math.PI * sm) * R * 0.06;
        const prev = sh.obj.position.clone();
        sh.obj.position.copy(_t3).multiplyScalar(rad);
        sh.obj.lookAt(_t1.copy(sh.obj.position).multiplyScalar(2).sub(prev)); // along velocity
        const lit = sunlit(sh.obj.position, sun);
        const blink = Math.sin(time * 3 + sh.ph) > 0 ? 1 : 0.4;
        sh.spr.material.opacity = (lit ? 0.9 : 0.25) * blink + 0.25; // engines glow regardless
      }
    },
    dispose() {
      s.planetGroup.remove(group);
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
    },
  };
}
