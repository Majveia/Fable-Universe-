// The traveler — because a universe this big deserves a witness you can see.
//
// Press C and the camera steps back: there you are, a small cloaked figure
// under a straw hat, scarf leaning with your speed, a lantern warming your
// hand after dark. The camera follows on a spring — drag still orbits, WASD
// is camera-relative, and the figure turns to face wherever it's going.
//
// Near the town plaza a hover-skiff waits, keel-light breathing. Walk up,
// press E, and the world starts moving underneath you: banking turns, a
// bobbing hover over land and sea alike, dust and spray kicked up behind.
// E again steps off wherever you are; the skiff parks and keeps waiting.

import * as THREE from 'three';
import { RNG, arand, hash } from './rng.js';
import { softDotTexture } from './nebula.js';
import { airOf, applyAerial } from './aerial.js';

const EYE = 1.8;

export function addTraveler(s) {
  const r = new RNG(hash(s.pp.seed, 0x77a7e1e5));

  // ------------------------------------------------------------ avatar ----
  const avatar = new THREE.Group();
  const cloak = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 1.3, 9),
    applyAerial(new THREE.MeshStandardMaterial({ color: 0x2c3350, roughness: 0.85 }), airOf(s), { name: 'traveler/addTraveler' }));
  cloak.position.y = 0.65;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    applyAerial(new THREE.MeshStandardMaterial({ color: 0xe6c6a4, roughness: 0.7 }), airOf(s), { name: 'traveler/addTraveler' }));
  head.position.y = 1.42;
  const hat = new THREE.Mesh(
    new THREE.ConeGeometry(0.44, 0.26, 10),
    applyAerial(new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.9 }), airOf(s), { name: 'traveler/addTraveler' }));
  hat.position.y = 1.58;
  const scarf = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.55),
    applyAerial(new THREE.MeshStandardMaterial({ color: 0xa33b2e, roughness: 0.8, side: THREE.DoubleSide }), airOf(s), { name: 'traveler/addTraveler' }));
  scarf.position.set(0, 1.15, -0.28);
  scarf.rotation.x = 0.5;
  const lantern = new THREE.Sprite(applyAerial(new THREE.SpriteMaterial({
    map: softDotTexture(32), color: new THREE.Color(1.3, 0.85, 0.45),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }), airOf(s), { name: 'traveler/addTraveler' }));
  lantern.position.set(0.34, 0.75, 0.12);
  lantern.scale.setScalar(1.6);
  avatar.add(cloak, head, hat, scarf, lantern);
  avatar.visible = false;
  s.scene.add(avatar);

  // ------------------------------------------------------------- skiff ----
  const skiff = new THREE.Group();
  const hullMat = applyAerial(new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.5, metalness: 0.15 }), airOf(s), { name: 'traveler/addTraveler' });
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 2.2, 6, 10), hullMat);
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1.2, 1, 0.42);
  hull.position.y = 0.4;
  const wingMat = applyAerial(new THREE.MeshStandardMaterial({ color: 0xcac2ae, roughness: 0.55, metalness: 0.2 }), airOf(s), { name: 'traveler/addTraveler' });
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 1.0), wingMat);
  wingL.position.set(-1.45, 0.42, 0.25);
  wingL.rotation.set(0.06, 0.45, 0);
  const wingR = wingL.clone();
  wingR.position.x = 1.45;
  wingR.rotation.set(0.06, -0.45, 0);
  const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5),
    applyAerial(new THREE.MeshStandardMaterial({
      color: 0x8fb6c9, roughness: 0.2, metalness: 0.3,
      transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    }), airOf(s), { name: 'traveler/addTraveler' }));
  fin.position.set(0, 0.85, -0.7);
  fin.rotation.x = -0.35;
  const keel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2.6),
    applyAerial(new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.35, 0.8, 1.1), transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }), airOf(s), { name: 'traveler/addTraveler' }));
  keel.rotation.x = Math.PI / 2;
  keel.position.y = 0.06;
  const engine = new THREE.Sprite(applyAerial(new THREE.SpriteMaterial({
    map: softDotTexture(32), color: new THREE.Color(0.5, 0.9, 1.3),
    transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  }), airOf(s), { name: 'traveler/addTraveler' }));
  engine.position.set(0, 0.42, 1.6);
  engine.scale.setScalar(1.1);
  skiff.add(hull, wingL, wingR, fin, keel, engine);
  s.scene.add(skiff);

  // parked at the town dock, or beside the landing if nobody lives here
  const dock = s.settlement?.dock
    ?? { x: s.spawn.x + 26, z: s.spawn.z + 14, y: s.heightAt(s.spawn.x + 26, s.spawn.z + 14) };
  const ground = (x, z) => Math.max(s.heightAt(x, z), s.seaLevel === null ? -1e9 : s.seaLevel);
  skiff.position.set(dock.x, ground(dock.x, dock.z) + 0.55, dock.z);
  skiff.rotation.y = r.float(0, 6.28);

  // ----------------------------------------------------------- the wake ----
  const NW = 26;
  const wakeGeo = new THREE.BufferGeometry();
  const wPos = new Float32Array(NW * 3);
  const wAge = new Float32Array(NW).fill(9);
  wakeGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
  const wake = new THREE.Points(wakeGeo, applyAerial(new THREE.PointsMaterial({
    map: softDotTexture(32), color: 0xbfc8cc, size: 2.2,
    transparent: true, opacity: 0.22, depthWrite: false, sizeAttenuation: true,
  }), airOf(s), { name: 'traveler/addTraveler' }));
  wake.visible = false;
  s.scene.add(wake);
  let wi = 0, wakeT = 0;

  const T = {
    third: false,
    riding: false,
    avatar, skiff,
    _camSet: false,
    _face: skiff.rotation.y,
    _bank: 0,
    _t: 0,

    toggleView() {
      T.third = !T.third;
      T._camSet = false;
      return T.third;
    },

    /** E: mount if the skiff is close; step off if riding */
    tryMount() {
      if (T.riding) {
        T.riding = false;
        // park it right here, settled on the ground
        skiff.position.y = ground(skiff.position.x, skiff.position.z) + 0.55;
        skiff.rotation.z = 0;
        wake.visible = false;
        return 'dismounted';
      }
      const d = Math.hypot(s.body.x - skiff.position.x, s.body.z - skiff.position.z);
      if (d < 14) {
        T.riding = true;
        T.third = true;
        T._camSet = false;
        s.fly = false;
        s.body.x = skiff.position.x;
        s.body.z = skiff.position.z;
        s.body.y = skiff.position.y + EYE;
        return 'mounted';
      }
      return null;
    },

    /** the skiff has the helm: banking hover flight, camera-relative */
    drive(dt) {
      const boost = s.keys.has('ShiftLeft') || s.keys.has('ShiftRight');
      const speed = boost ? 190 : 85;
      const fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const acc = new THREE.Vector3();
      if (s.keys.has('KeyW') || s.keys.has('ArrowUp')) acc.add(fwd);
      if (s.keys.has('KeyS') || s.keys.has('ArrowDown')) acc.sub(fwd);
      if (s.keys.has('KeyD') || s.keys.has('ArrowRight')) acc.add(right);
      if (s.keys.has('KeyA') || s.keys.has('ArrowLeft')) acc.sub(right);
      if (acc.lengthSq() > 0) acc.normalize().multiplyScalar(speed);
      s.vel.lerp(acc, 1 - Math.exp(-2.2 * dt));
      s.body.addScaledVector(s.vel, dt);

      // hover: ride the terrain and the sea at a steady keel height
      const g = ground(s.body.x, s.body.z);
      const hoverY = g + 3.4 + Math.sin(T._t * 2.1) * 0.24;
      s.body.y += (hoverY + EYE - s.body.y) * (1 - Math.exp(-5 * dt));

      // the skiff itself: under the body, nose into the velocity, banking
      skiff.position.set(s.body.x, s.body.y - EYE, s.body.z);
      const sp = Math.hypot(s.vel.x, s.vel.z);
      if (sp > 2) {
        const want = Math.atan2(-s.vel.x, -s.vel.z);
        let dy = want - T._face;
        dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        T._face += dy * Math.min(dt * 5, 1);
        T._bank += (dy * -1.1 - T._bank) * Math.min(dt * 4, 1);
      } else {
        T._bank *= Math.exp(-3 * dt);
      }
      skiff.rotation.set(0, T._face, Math.min(Math.max(T._bank, -0.55), 0.55));
      engine.material.opacity = 0.3 + Math.min(sp / 190, 1) * 0.7;
      keel.material.opacity = 0.35 + 0.2 * Math.sin(T._t * 3.1);

      // wake: dust over land, spray over water, only when moving low
      wakeT -= dt;
      const overSea = s.seaLevel !== null && s.heightAt(s.body.x, s.body.z) < s.seaLevel;
      if (sp > 18 && wakeT <= 0) {
        wakeT = 0.05;
        wPos[wi * 3] = s.body.x - s.vel.x / sp * 2.4 + (arand() - 0.5) * 1.4;
        wPos[wi * 3 + 1] = g + 0.5;
        wPos[wi * 3 + 2] = s.body.z - s.vel.z / sp * 2.4 + (arand() - 0.5) * 1.4;
        wAge[wi] = 0;
        wi = (wi + 1) % NW;
      }
      for (let i = 0; i < NW; i++) {
        if (wAge[i] < 2) { wAge[i] += dt; wPos[i * 3 + 1] += dt * 1.6; }
      }
      wakeGeo.attributes.position.needsUpdate = true;
      wake.visible = sp > 18;
      wake.material.color.setHex(overSea ? 0xd8ecf2 : 0xcabfa8);
    },

    /** after movement: seat the camera (and the figure) for this frame */
    place(dt, camera) {
      T._t += dt;
      if (!T.third) {
        avatar.visible = false;
        camera.position.copy(s.body);
        camera.quaternion.setFromEuler(new THREE.Euler(s.pitch, s.yaw, 0, 'YXZ'));
        return;
      }

      // the figure stands at the body's feet (hidden while riding)
      avatar.visible = !T.riding;
      if (!T.riding) {
        avatar.position.set(s.body.x, s.body.y - EYE, s.body.z);
        const sp = Math.hypot(s.vel.x, s.vel.z);
        if (sp > 0.8) {
          const want = Math.atan2(-s.vel.x, -s.vel.z);
          let dy = want - T._face;
          dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          T._face += dy * Math.min(dt * 8, 1);
        }
        avatar.rotation.y = T._face;
        avatar.position.y += Math.abs(Math.sin(T._t * 7.5)) * Math.min(sp / 16, 1) * 0.09;
        avatar.rotation.x = Math.min(sp / 60, 0.14);
        scarf.rotation.x = 0.5 + Math.sin(T._t * 3.2) * 0.15 + Math.min(sp / 40, 0.6);
        const night = 1 - Math.min(Math.max((s.uSunDir.value.y + 0.12) * 3.5, 0), 1);
        lantern.material.opacity = night * 0.85;
      }

      // the camera hangs back on a spring, orbiting with the drag
      const dist = T.riding ? 11 : 7;
      const rise = T.riding ? 3.2 : 2.1;
      const fwd = new THREE.Vector3(0, 0, -1)
        .applyEuler(new THREE.Euler(s.pitch, s.yaw, 0, 'YXZ'));
      const want = new THREE.Vector3().copy(s.body)
        .addScaledVector(fwd, -dist);
      want.y += rise;
      // never sink the lens under the hill
      want.y = Math.max(want.y, ground(want.x, want.z) + 0.7);
      if (!T._camSet) { camera.position.copy(want); T._camSet = true; }
      else camera.position.lerp(want, 1 - Math.exp(-7 * dt));
      const look = new THREE.Vector3().copy(s.body).addScaledVector(s.vel, 0.12);
      look.y = s.body.y + 0.35;
      camera.lookAt(look);
    },
  };
  return T;
}
