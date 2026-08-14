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
import { HOVER, Hover, MOUNT, Mount, handMomentum } from './vehicle.js';
import { input, jumpHeld } from './input.js';
import { GAIT, gravityOf } from './avatar.js';
import { TIER } from './quality.js';
import {
  BONE_COUNT, FIGURE_FRAG, FIGURE_PALETTE, FIGURE_VERT,
  buildFigure, poseFigure, poseFor, restPose,
} from './figure.js';

const EYE = 1.8;

// §6 M5's half of this file. Default-off (§7.4), and the old path is left
// intact underneath it — `?m5=0` is the rollback and it is the whole rollback.
const M5 = new URL(window.location.href).searchParams.get('m5') === '1';

/**
 * `?figure=1` — `src/figure.js` instead of the five primitives. Default-off
 * (§7.4), and the two are built side by side so the flag hides one and shows
 * the other rather than branching the placer.
 */
const FIGURE = new URL(window.location.href).searchParams.get('figure') === '1';

/**
 * Hang the drawn figure inside the avatar group and return the handle that
 * drives it.
 *
 * Two things it needs each frame and cannot compute: the gait clock, which
 * belongs to `Walker` and must not be duplicated (§6 M4), and the wind, which
 * belongs to the scale's one field (§6 M3). Both are read here rather than
 * re-derived, which is the whole reason the coat and the footfalls agree.
 */
function makePerson(s, parent) {
  const built = buildFigure(GAIT.eye / 0.936, TIER, s.pp.seed >>> 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(built.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(built.normal, 3));
  g.setAttribute('aBone', new THREE.BufferAttribute(built.bone, 1));
  g.setAttribute('aMat', new THREE.BufferAttribute(built.mat, 1));
  g.setAttribute('aFree', new THREE.BufferAttribute(built.free, 1));
  g.computeBoundingSphere();
  // the bounding sphere has to cover the *posed* figure, not the bind pose —
  // limbs authored at their own bone's origin all sit near y = 0 in the buffer
  g.boundingSphere.center.set(0, built.dims.chestY, 0);
  g.boundingSphere.radius = built.dims.stature;

  const bones = new Float32Array(16 * BONE_COUNT);
  const rest = restPose(built.dims);
  const uniforms = {
    uBones: { value: bones },
    uCloth: { value: new THREE.Vector3() },
    uHem: { value: new THREE.Vector2(0, 0) },
    uSunDir: s.uSunDir,
    uCoat: { value: new THREE.Color(FIGURE_PALETTE.coat).convertSRGBToLinear() },
    uLining: { value: new THREE.Color(FIGURE_PALETTE.lining).convertSRGBToLinear() },
    uSkin: { value: new THREE.Color(FIGURE_PALETTE.skin).convertSRGBToLinear() },
    uBoot: { value: new THREE.Color(FIGURE_PALETTE.boot).convertSRGBToLinear() },
    uStrap: { value: new THREE.Color(FIGURE_PALETTE.strap).convertSRGBToLinear() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, vertexShader: FIGURE_VERT, fragmentShader: FIGURE_FRAG,
    // Both faces. A coat is a surface with no back and the hem lifts far
    // enough in a gust to show the inside of it, which is what the lining
    // colour is for — one-sided here is a hole in the silhouette exactly where
    // the eye is looking.
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.castShadow = true;
  parent.add(mesh);

  return {
    mesh, mat, uniforms, dims: built.dims, bones, rest,
    /** one frame: the pose from the walker's clock, the coat from the field */
    step(dt, speed, phase, grounded, yaw) {
      const cad = s.walker?.stepFreq ?? 0;
      const pose = poseFor(built.dims, {
        phase, speed, cadence: cad,
        sat: s.walker?.g?.bobSat ?? 3.6,
        gravity: s.walker?.gravity ?? 9.81,
        grounded,
      });
      poseFigure(bones, built.dims, pose, rest);
      mat.uniformsNeedUpdate = true;

      // §6 M3: the coat is cloth and cloth reads the one field. Sampled once
      // per frame at the body, at chest height — a coat is a metre across and
      // the smallest gust cell is 260 m, so forty per-vertex lookups would
      // return forty copies of this number.
      const w = s.sampleWind
        ? s.sampleWind(s.body.x, s.body.z, built.dims.chestY)
        : { x: 0, z: 0 };
      // in the figure's own frame, because the coat is
      const cy = Math.cos(-yaw), sy = Math.sin(-yaw);
      const wx = w.x * cy - w.z * sy, wz = w.x * sy + w.z * cy;
      // and its own motion, trailing: a coat that does not trail is a cape on
      // a statue, and it is the difference between walking and gliding
      const vx = (s.vel?.x ?? 0), vz = (s.vel?.z ?? 0);
      const tx = -(vx * cy - vz * sy), tz = -(vx * sy + vz * cy);
      const c = uniforms.uCloth.value;
      // eased rather than snapped: cloth has mass, and the field is sampled at
      // frame rate while a gust front crosses in tens of seconds
      const k = 1 - Math.exp(-4.5 * dt);
      c.x += ((wx * 0.020 + tx * 0.030) - c.x) * k;
      c.z += ((wz * 0.020 + tz * 0.030) - c.z) * k;
      c.y += ((-0.02 - Math.hypot(tx, tz) * 0.004) - c.y) * k;
      // the hem ripple rides the gait phase, so the coat swings on the
      // footfall rather than on a clock of its own (§6 M4)
      uniforms.uHem.value.set(0.018 + Math.min(speed / 9, 1) * 0.030, phase);
      return pose;
    },
    dispose() { parent.remove(mesh); g.dispose(); mat.dispose(); },
  };
}

export function addTraveler(s) {
  const r = new RNG(hash(s.pp.seed, 0x77a7e1e5));

  // ------------------------------------------------------------ avatar ----
  const avatar = new THREE.Group();
  const cloak = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 1.3, 9),
    new THREE.MeshStandardMaterial({ color: 0x2c3350, roughness: 0.85 }));
  cloak.position.y = 0.65;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.16, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0xe6c6a4, roughness: 0.7 }));
  head.position.y = 1.42;
  const hat = new THREE.Mesh(
    new THREE.ConeGeometry(0.44, 0.26, 10),
    new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.9 }));
  hat.position.y = 1.58;
  const scarf = new THREE.Mesh(
    new THREE.PlaneGeometry(0.16, 0.55),
    new THREE.MeshStandardMaterial({ color: 0xa33b2e, roughness: 0.8, side: THREE.DoubleSide }));
  scarf.position.set(0, 1.15, -0.28);
  scarf.rotation.x = 0.5;
  const lantern = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture(32), color: new THREE.Color(1.3, 0.85, 0.45),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  lantern.position.set(0.34, 0.75, 0.12);
  lantern.scale.setScalar(1.6);
  avatar.add(cloak, head, hat, scarf, lantern);
  avatar.visible = false;
  s.scene.add(avatar);

  // ------------------------------------------------------------ FIGURE ----
  // `?figure=1` — the same person, drawn. Built alongside the five primitives
  // rather than in place of them so the flag is a swap of one boolean and the
  // rollback is the URL (§7.4). Everything downstream — the placer, the
  // lantern, the skiff, the camera — reads `avatar`, so the figure is hung
  // inside the same group and the five originals are simply hidden.
  const person = FIGURE ? makePerson(s, avatar) : null;
  if (person) for (const o of [cloak, head, hat, scarf]) o.visible = false;

  // ------------------------------------------------------------- skiff ----
  const skiff = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.5, metalness: 0.15 });
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 2.2, 6, 10), hullMat);
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1.2, 1, 0.42);
  hull.position.y = 0.4;
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xcac2ae, roughness: 0.55, metalness: 0.2 });
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 1.0), wingMat);
  wingL.position.set(-1.45, 0.42, 0.25);
  wingL.rotation.set(0.06, 0.45, 0);
  const wingR = wingL.clone();
  wingR.position.x = 1.45;
  wingR.rotation.set(0.06, -0.45, 0);
  const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5),
    new THREE.MeshStandardMaterial({
      color: 0x8fb6c9, roughness: 0.2, metalness: 0.3,
      transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    }));
  fin.position.set(0, 0.85, -0.7);
  fin.rotation.x = -0.35;
  const keel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2.6),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.35, 0.8, 1.1), transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
  keel.rotation.x = Math.PI / 2;
  keel.position.y = 0.06;
  const engine = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture(32), color: new THREE.Color(0.5, 0.9, 1.3),
    transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
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
  const wake = new THREE.Points(wakeGeo, new THREE.PointsMaterial({
    map: softDotTexture(32), color: 0xbfc8cc, size: 2.2,
    transparent: true, opacity: 0.22, depthWrite: false, sizeAttenuation: true,
  }));
  wake.visible = false;
  s.scene.add(wake);
  let wi = 0, wakeT = 0;

  // §6 M5 — the dynamics the suite tests, rather than a second copy of them
  // written inline. `ride` is the skiff's own keel height, not the walker's;
  // gravity is the world's, so a moon hop hangs the way a moon hop should.
  const hover = M5 ? new Hover({
    groundAt: ground,
    gravity: gravityOf(s.pp),
    ride: 3.4,
  }) : null;
  const mount = M5 ? new Mount(MOUNT.dur) : null;

  const T = {
    third: false,
    riding: false,
    avatar, skiff,
    hover, mount,
    _camSet: false,
    _face: skiff.rotation.y,
    _bank: 0,
    _t: 0,

    toggleView() {
      T.third = !T.third;
      // Under §M5 the view swap is a handover like any other: the eye is where
      // it is, and the arm grows or retracts from there rather than cutting.
      if (!M5) T._camSet = false;
      return T.third;
    },

    /**
     * E: mount if the skiff is close; step off if riding.
     *
     * §2.5 — "if a feature can't be entered continuously, it isn't finished."
     * The old path teleports the body onto the deck, and has since it was
     * written; nobody noticed because the camera is behind the walker and the
     * jump is short. Over forty kilometres it stops going unnoticed.
     *
     * So under §M5 both directions are a spring plus a momentum handover, and
     * they are the same code because they are the same physics: whatever was
     * moving keeps moving.
     */
    tryMount() {
      if (T.riding) {
        T.riding = false;
        if (M5) {
          const eye = { x: s.camera.position.x, y: s.camera.position.y, z: s.camera.position.z };
          // step off where the craft is, carrying its velocity into the body
          const w = s.walker;
          if (w) {
            w.pos.x = hover.pos.x;
            w.pos.z = hover.pos.z;
            w.pos.y = ground(hover.pos.x, hover.pos.z);
            handMomentum(hover.vel, w.vel);
            w.vel.y = 0;          // the skiff's bob is not a jump
            w.grounded = true;
          }
          s.body.set(hover.pos.x, (w ? w.eyeY() : ground(hover.pos.x, hover.pos.z) + EYE), hover.pos.z);
          s.vel.set(hover.vel.x, 0, hover.vel.z);
          // the craft settles where it was left, keel down
          skiff.position.set(hover.pos.x, ground(hover.pos.x, hover.pos.z) + 0.55, hover.pos.z);
          skiff.rotation.z = 0;
          wake.visible = false;
          mount.begin(eye, { x: s.body.x, y: s.body.y, z: s.body.z }, s.vel);
          return 'dismounted';
        }
        skiff.position.y = ground(skiff.position.x, skiff.position.z) + 0.55;
        skiff.rotation.z = 0;
        wake.visible = false;
        return 'dismounted';
      }
      const d = Math.hypot(s.body.x - skiff.position.x, s.body.z - skiff.position.z);
      if (d < MOUNT.reach) {
        if (M5) {
          const eye = { x: s.camera.position.x, y: s.camera.position.y, z: s.camera.position.z };
          T.riding = true;
          T.third = true;
          s.fly = false;
          hover.place(skiff.position.x, skiff.position.z, T._face);
          // and the walker's momentum goes with you — running at the skiff and
          // boarding should not stop you dead
          if (s.walker) handMomentum(s.walker.vel, hover.vel);
          s.body.set(hover.pos.x, hover.pos.y + EYE, hover.pos.z);
          s.vel.set(hover.vel.x, 0, hover.vel.z);
          mount.begin(eye, { x: s.body.x, y: s.body.y, z: s.body.z }, s.vel);
          T._camSet = true;    // the spring owns the gap now, not a snap
          return 'mounted';
        }
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
      if (M5) return T._driveM5(dt);
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

    /**
     * Dust over land, spray over water — and both drift *downwind* (§6 M5).
     *
     * The old wake rises straight up at 1.6 m/s on `arand()`, which is a
     * plume in still air on a world that has weather. M3 act 6 established
     * `s.sampleWind(x, z, height)` as the one reading every consumer agrees
     * on — the grass, the clouds, the ocean and the god rays all take it — and
     * a craft's wake joins that list rather than growing a fourth wind.
     *
     * It is sampled at the particle's own height, so the boundary layer does
     * the work: what is kicked up near the ground barely moves, and what gets
     * carried up rides the gust that is passing. That is also the cheapest
     * possible demonstration that the field is shared, because over water the
     * spray and the waves lean the same way.
     */
    _wake(dt, sp) {
      wakeT -= dt;
      const overSea = s.seaLevel !== null
        && s.heightAt(hover.pos.x, hover.pos.z) < s.seaLevel;
      const g = ground(hover.pos.x, hover.pos.z);
      if (sp > 18 && wakeT <= 0 && !hover.airborne) {
        wakeT = 0.05;
        const inv = 1 / Math.max(sp, 1e-3);
        wPos[wi * 3] = hover.pos.x - hover.vel.x * inv * 2.4 + (arand() - 0.5) * 1.4;
        wPos[wi * 3 + 1] = g + 0.5;
        wPos[wi * 3 + 2] = hover.pos.z - hover.vel.z * inv * 2.4 + (arand() - 0.5) * 1.4;
        wAge[wi] = 0;
        wi = (wi + 1) % NW;
      }
      for (let i = 0; i < NW; i++) {
        if (wAge[i] >= 2) continue;
        wAge[i] += dt;
        const h = Math.max(wPos[i * 3 + 1] - g, 0.05);
        const w = s.sampleWind
          ? s.sampleWind(wPos[i * 3], wPos[i * 3 + 2], h)
          : { x: 0, z: 0 };
        // spray is heavier than dust and is thrown rather than lifted, so it
        // rises slower and settles sooner
        const lift = overSea ? 1.1 : 1.6;
        wPos[i * 3] += w.x * dt;
        wPos[i * 3 + 1] += lift * dt;
        wPos[i * 3 + 2] += w.z * dt;
      }
      wakeGeo.attributes.position.needsUpdate = true;
      wake.visible = sp > 18;
      wake.material.color.setHex(overSea ? 0xd8ecf2 : 0xcabfa8);
    },

    /**
     * §M5's helm. The dynamics live in `vehicle.js` and are exercised in Node
     * by `tools/verify.js`; what is left here is the mesh, the wake and the
     * bridge back to `s.body`/`s.vel`, which twenty other things read.
     *
     * The craft takes the same analog axis the walker does, so switching
     * between them cannot change what the stick means — and `Space` is the
     * short hop for the same reason it is the jump: one thing a rider already
     * knows, transferred rather than relearned.
     */
    _driveM5(dt) {
      const boost = input.down('sprint');
      // The surface tile is a fixed mesh with nothing to stream, so there is
      // nothing here to outrun and no governor — that is planet scale's
      // problem (§6 M5, and `docs/plans/M5.md` §2). The ceiling here is the
      // tile: 1400 m wide, so 190 m/s crosses it in seven seconds.
      const top = boost ? 190 : 85;
      hover.step(dt, { move: input.move, hop: jumpHeld() }, s.rig ? s.rig.yaw : s.yaw, top);

      T._face = hover.face;
      T._bank = hover.bank;
      s.body.set(hover.pos.x, hover.pos.y + EYE, hover.pos.z);
      s.vel.set(hover.vel.x, hover.vel.y, hover.vel.z);

      skiff.position.set(hover.pos.x, hover.pos.y, hover.pos.z);
      skiff.rotation.set(0, hover.face, hover.bank);

      const sp = hover.speed();
      engine.material.opacity = 0.3 + Math.min(sp / 190, 1) * 0.7;
      keel.material.opacity = 0.35 + 0.2 * Math.sin(hover.t * 3.1)
        // the skirt flares when it is carrying you rather than resting
        + (hover.airborne ? 0.25 : 0);
      // `_t` is advanced by `place()`, which also runs every frame — bumping it
      // here too would run the figure's clock at twice speed while riding
      T._wake(dt, sp);
    },

    /** after movement: seat the camera (and the figure) for this frame */
    // `camera` may be null: under §M4 the rig in `camera.js` owns the lens and
    // this is called only to keep the avatar mesh following. Splitting the two
    // responsibilities is what lets the new rig land without the figure, its
    // scarf, its lantern and its gait all having to move in the same commit.
    place(dt, camera) {
      T._t += dt;
      if (!T.third) {
        avatar.visible = false;
        if (camera) {
          camera.position.copy(s.body);
          camera.quaternion.setFromEuler(new THREE.Euler(s.pitch, s.yaw, 0, 'YXZ'));
        }
        return;
      }

      // the figure stands at the body's feet (hidden while riding)
      avatar.visible = !T.riding;
      if (!T.riding) {
        avatar.position.set(s.body.x, s.body.y - EYE, s.body.z);
        const sp = Math.hypot(s.vel.x, s.vel.z);
        if (sp > 0.8) {
          // The cone is symmetric so nothing ever revealed which way it faced;
          // the drawn figure's front is +z and its coat opens there, so the two
          // conventions differ by pi and the flag picks between them.
          const want = person ? Math.atan2(s.vel.x, s.vel.z)
            : Math.atan2(-s.vel.x, -s.vel.z);
          let dy = want - T._face;
          dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          T._face += dy * Math.min(dt * 8, 1);
        }
        avatar.rotation.y = T._face;
        if (person) {
          // §6 M4's one clock. `Walker.stepPhase` drives the head bob, the
          // footfall count and the grass the walker parts; the figure standing
          // in for that walker reads the same number, so it cannot be on a
          // different beat. What it replaces below is `sin(_t · 7.5)` against a
          // walker cadence of `0.58 + 0.34·v` — 1.19 Hz against 1.75 at walking
          // speed, beating against each other every 1.8 seconds, forever.
          person.step(dt, sp, s.walker?.stepPhase ?? T._t * 0.5,
            s.walker ? s.walker.grounded : true, T._face);
          // the lean is the walker's, for the same reason
          avatar.rotation.x = s.walker?.lean ?? Math.min(sp / 60, 0.14);
        } else {
          avatar.position.y += Math.abs(Math.sin(T._t * 7.5)) * Math.min(sp / 16, 1) * 0.09;
          avatar.rotation.x = Math.min(sp / 60, 0.14);
          scarf.rotation.x = 0.5 + Math.sin(T._t * 3.2) * 0.15 + Math.min(sp / 40, 0.6);
        }
        const night = 1 - Math.min(Math.max((s.uSunDir.value.y + 0.12) * 3.5, 0), 1);
        lantern.material.opacity = night * 0.85;
      }

      if (!camera) return;   // §M4's rig owns the lens; the figure is done

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
      T.applyMount(dt, camera);
    },

    /**
     * Close whatever gap a mount or dismount opened, after the frame's placer
     * has had its say (§2.5).
     *
     * This runs *last* and adds an offset rather than overriding a position,
     * because both placers are legitimate — the rig owns the lens on foot and
     * the arm above owns it while riding — and a handover that fought either of
     * them for ownership would be a third opinion about where the eye goes.
     * The offset starts at exactly the gap, ends at exactly zero, and has zero
     * slope at both ends, so neither the leaving nor the arriving camera takes
     * a step in velocity.
     */
    applyMount(dt, camera) {
      if (!M5 || !mount.active || !camera) return;
      const o = mount.update(dt);
      camera.position.x += o.x;
      camera.position.y += o.y;
      camera.position.z += o.z;
    },
  };
  return T;
}
