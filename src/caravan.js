// The roads are travelled.
//
// On inhabited worlds a caravan walks the road out of town — pack beasts in
// a patient train behind a canopied cart, a lantern swaying at the driver's
// hand. It paces the lantern-lit path between the plaza and an outlying
// hamlet, turns at the end of the road, and walks back, forever. Seen from
// a ridge at dusk it says the thing a still landscape can't: people live
// here, and they have somewhere to be.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture } from './nebula.js';
import { airOf, applyAerial } from './aerial.js';

export function addCaravan(s) {
  if (!s.pp.inhabited || !s.settlement?.routes?.length) return null;
  const r = new RNG(hash(s.pp.seed, 0xca7a5a));
  // walk the longest road — the one that actually goes somewhere
  const route = s.settlement.routes
    .slice().sort((a, b) => b.length - a.length)[0];
  if (route.length < 4) return null;

  const ground = (x, z) => Math.max(s.heightAt(x, z), s.seaLevel === null ? -1e9 : s.seaLevel);
  const hide = applyAerial(new THREE.MeshStandardMaterial({ color: 0x6b5640, roughness: 0.9, flatShading: true }), airOf(s), { name: 'caravan/addCaravan' });
  const dark = applyAerial(new THREE.MeshStandardMaterial({ color: 0x3a2f24, roughness: 0.95 }), airOf(s), { name: 'caravan/addCaravan' });
  const cloth = applyAerial(new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(r.float(0, 1), 0.4, 0.5), roughness: 0.85, side: THREE.DoubleSide,
  }), airOf(s), { name: 'caravan/addCaravan' });

  // one pack beast: a body ellipsoid, a low head, four stub legs
  function beast() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), hide);
    body.scale.set(1.5, 0.85, 0.75); body.position.y = 1.5;
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.32, 1.1, 6), hide);
    neck.position.set(1.3, 1.9, 0); neck.rotation.z = 0.9;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.35), hide);
    head.position.set(1.9, 2.2, 0);
    g.add(body, neck, head);
    const legXf = [[0.8, 0.4], [0.8, -0.4], [-0.8, 0.4], [-0.8, -0.4]];
    const legs = [];
    for (const [lx, lz] of legXf) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.1, 1.5, 5), dark);
      leg.position.set(lx, 0.75, lz);
      g.add(leg); legs.push(leg);
    }
    // a bundle of goods on its back
    const pack = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.7, 1.0), cloth);
    pack.position.y = 2.15;
    g.add(pack);
    g.userData.legs = legs;
    return g;
  }

  // the cart: two wheels, a bed, a canopy, and a lantern on a pole
  function cart() {
    const g = new THREE.Group();
    const bed = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 1.6), dark);
    bed.position.y = 1.3;
    g.add(bed);
    for (const sz of [-0.9, 0.9]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.18, 12), dark);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(-0.4, 0.9, sz);
      g.add(wheel);
      g.userData.wheels = g.userData.wheels || [];
      g.userData.wheels.push(wheel);
    }
    // canopy hoops + cloth
    const canopy = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.4, 10, 1, true, 0, Math.PI), cloth);
    canopy.rotation.z = Math.PI / 2;
    canopy.position.set(0.1, 2.1, 0);
    g.add(canopy);
    // draw pole forward
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.4, 5), dark);
    pole.rotation.z = Math.PI / 2; pole.position.set(2.5, 1.1, 0);
    g.add(pole);
    // the lantern
    const lamp = new THREE.Sprite(applyAerial(new THREE.SpriteMaterial({
      map: softDotTexture(32), color: new THREE.Color(1.35, 0.85, 0.42),
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }), airOf(s), { name: 'caravan/lamp', radius: 1.1 }));
    lamp.position.set(1.4, 2.6, 0);
    lamp.scale.setScalar(2.2);
    g.add(lamp);
    g.userData.lamp = lamp;
    return g;
  }

  const caravan = new THREE.Group();
  s.scene.add(caravan);
  const cartObj = cart();
  const beasts = [beast(), beast(), r.chance(0.6) ? beast() : null].filter(Boolean);
  caravan.add(cartObj, ...beasts);
  // the train: cart in front pulling, beasts strung behind, in metres of slack
  const train = [{ obj: cartObj, back: 0 }];
  beasts.forEach((b, i) => train.push({ obj: b, back: 5 + i * 4 }));

  const total = route.length - 1;
  let u = r.float(0, total * 0.5);
  let dir = 1;
  const speed = r.float(1.6, 2.6); // metres a second, a walking pace
  let t = 0;
  const _p = new THREE.Vector3();

  const atS = (arc) => {
    // sample the route polyline at arc-length position `arc` (in segments)
    arc = Math.max(0, Math.min(arc, total - 1e-3));
    const i0 = Math.floor(arc), f = arc - i0;
    const a = route[i0], b = route[Math.min(i0 + 1, total)];
    return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f,
             hx: b.x - a.x, hz: b.z - a.z };
  };

  return {
    update(dt, sunY) {
      t += dt;
      // segments are ~26 m apart; convert speed to segments/sec
      u += dir * speed * dt / 26;
      if (u >= total - 0.02) { u = total - 0.02; dir = -1; }
      if (u <= 0.02) { u = 0.02; dir = 1; }
      const night = 1 - Math.min(Math.max((sunY + 0.12) * 3.5, 0), 1);
      cartObj.userData.lamp.material.opacity = night * 0.9;
      for (const car of train) {
        const arc = u - dir * car.back / 26;
        const sm = atS(Math.max(0, Math.min(arc, total - 1e-3)));
        const h = ground(sm.x, sm.z);
        car.obj.position.set(sm.x, h, sm.z);
        const head = Math.atan2(sm.hx * dir, sm.hz * dir);
        car.obj.rotation.y = head;
        // a little gait bob + turning wheels/legs
        car.obj.position.y = h + Math.abs(Math.sin(t * 4 + car.back)) * 0.08;
        if (car.obj.userData.wheels)
          for (const w of car.obj.userData.wheels) w.rotation.y += dir * speed * dt * 0.9;
      }
    },
  };
}
