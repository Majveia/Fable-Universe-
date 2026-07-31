// Sails on the water.
//
// Inhabited worlds with a sea get ships: wooden hulls riding slow circles
// off the coast, canvas up, a masthead lantern warming after dark. They
// never dock and never sink — they're weather with a crew, the detail that
// makes a coastline read as a place someone sails home to.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture } from './nebula.js';
import { airOf, applyAerial } from './aerial.js';

const EXT = 1400;

export function addShips(s) {
  const pp = s.pp;
  if (!pp.inhabited || s.seaLevel === null) return null;
  const r = new RNG(hash(pp.seed, 0x5a115));

  // deep anchorages, nearest first — sails should be visible from the
  // beach you actually stand on, not rumors over the horizon
  const anchors = [];
  const want = r.chance(0.5) ? 3 : 2;
  for (let i = 0; i < 4000 && anchors.length < want; i++) {
    const rad = 240 + (i / 4000) * EXT * 1.1;
    const th = i * 2.399963;
    const x = s.spawn.x + Math.cos(th) * rad, z = s.spawn.z + Math.sin(th) * rad;
    if (s.heightAt(x, z) > s.seaLevel - 6) continue;
    // keep them spread out; each ship wants its own patch of sea
    if (anchors.some(a => Math.hypot(a.x - x, a.z - z) < 380)) continue;
    anchors.push({ x, z });
  }
  if (!anchors.length) return null;

  const hullMat = applyAerial(new THREE.MeshStandardMaterial({ color: 0x4e3a26, roughness: 0.85 }), airOf(s), { name: 'ships/addShips' });
  const sailMat = applyAerial(new THREE.MeshStandardMaterial({
    color: 0xe8e0cc, roughness: 0.9, side: THREE.DoubleSide,
  }), airOf(s), { name: 'ships/addShips' });
  const tex = softDotTexture(32);
  const ships = [];
  for (const a of anchors) {
    const ship = new THREE.Group();
    const scale = r.float(0.8, 1.35);
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(1.6, 7, 5, 8), hullMat);
    hull.rotation.x = Math.PI / 2;
    hull.scale.set(1, 1, 0.55);
    hull.position.y = 0.4;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 9, 6), hullMat);
    mast.position.y = 4.8;
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 6.2), sailMat);
    sail.position.set(0, 5.4, 0.5);
    sail.rotation.y = 0.12; // canvas holds a little wind
    const jib = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 4.0), sailMat);
    jib.position.set(0, 3.6, 3.4);
    jib.rotation.y = -0.18;
    const lamp = new THREE.Sprite(applyAerial(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(1.35, 0.85, 0.4),
      transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
    }), airOf(s), { name: 'ships/addShips' }));
    lamp.position.y = 9.6;
    lamp.scale.setScalar(3);
    ship.add(hull, mast, sail, jib, lamp);
    ship.scale.setScalar(scale);
    s.scene.add(ship);
    ships.push({
      grp: ship, lamp, anchor: a,
      radius: r.float(60, 160),
      w: r.float(0.008, 0.02) * r.sign(),
      ph: r.float(0, 6.28),
      bob: r.float(0, 6.28),
    });
  }

  let time = 0;
  return {
    count: ships.length,
    ships,
    update(dt, sunY) {
      time += dt;
      const night = 1 - Math.min(Math.max((sunY + 0.12) * 3.5, 0), 1);
      for (const sh of ships) {
        const th = sh.w * time + sh.ph;   // a sailing pace, not a speedboat's
        const x = sh.anchor.x + Math.cos(th) * sh.radius;
        const z = sh.anchor.z + Math.sin(th) * sh.radius;
        sh.grp.position.set(x, s.seaLevel + Math.sin(time * 0.9 + sh.bob) * 0.18, z);
        // bow into the direction of travel (the tangent of the circle)
        const sgn = Math.sign(sh.w);
        sh.grp.rotation.set(
          Math.sin(time * 0.7 + sh.bob) * 0.03,
          Math.atan2(-Math.sin(th) * sgn, Math.cos(th) * sgn),
          Math.sin(time * 1.1 + sh.bob) * 0.045);
        sh.lamp.material.opacity = night * 0.85;
      }
    },
  };
}
