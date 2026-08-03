// The camera rig — CLAUDE.md §M4, §9.7.
//
// Three scales roll their own yaw/pitch drag today, at three different
// sensitivities and three different pitch clamps:
//
//     surface.js:1151      0.0035 / 0.0032, clamp ±1.45
//     planetscale.js:1653  0.0024 / 0.0024, clamp ±1.50
//     blackhole.js:214     0.0040 / 0.0030, clamp ±1.25
//
// Nobody chose those. They are three independent guesses at the same number,
// and the effect is that looking around means something slightly different
// depending on how far you have fallen — which is exactly the kind of thing a
// player feels and cannot name.
//
// ---------------------------------------------------------------------------
// The contract this implements is one the codebase already has
//
// `surface.js:435` and `planetscale.js:828` both duck-type an object so the
// hyperzoom can drive them:
//
//     this.controls = { enabled: false, target: Vector3, update: () => {} }
//
// `transition.js` reads `.target` and toggles `.enabled` at every scale change,
// and every scale's `enter/exit/resume` does the same. So that *is* the camera
// interface, and a rig that implements it drops in without touching a single
// call site. This one does.
//
// ---------------------------------------------------------------------------
// Third person, and the one clause M4's gate actually names
//
// `traveler.js:204` already has a spring arm: a fixed 7 m boom, 2.1 m rise, an
// exponential follow, and a ground clamp. What it does not have is collision —
// it clamps against the height *directly under the camera*, which is a
// different question from whether anything is between the camera and the head.
// Walk backwards toward a cliff and the boom goes through it.
//
// §M4's gate says "camera never clips terrain across the full route", so the
// arm is swept here: the segment from the head outward is sampled against the
// height field and the boom is shortened to the first obstruction. That is a
// claim `tools/verify.js` can check without a renderer, and it does.

import * as THREE from 'three';
import { ARM, GAIT, LOOK, sweepArm } from './avatar.js';

// Re-exported so a caller has one import for the rig, even though the geometry
// itself lives next to the body — see the note above `LOOK` in `avatar.js` for
// why the pure half is on that side of the line.
export { ARM, LOOK, sweepArm };

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/**
 * The rig.
 *
 * Implements the duck-typed `{ enabled, target, update() }` contract, so
 * `transition.js` and every `enter/exit/resume` call site work unchanged.
 */
export class CameraRig {
  constructor({ camera, walker, heightAt, third = false }) {
    this.camera = camera;
    this.walker = walker;
    this.heightAt = heightAt;

    this.yaw = 0;
    this.pitch = 0;
    this.third = third;

    // the hyperzoom's contract
    this.enabled = false;
    this.target = new THREE.Vector3();
    this.update = () => {};

    this._pos = new THREE.Vector3();
    this._aim = new THREE.Vector3();
    this._settled = false;
    this._armLen = ARM.dist;

    if (camera) {
      camera.fov = GAIT.fov;
      camera.near = 0.12;
      camera.updateProjectionMatrix();
    }
  }

  /** a drag, a locked pointer move, or a right-thumb swipe — all one path */
  look(dx, dy) {
    this.yaw -= dx * LOOK.perPixel;
    this.pitch = clamp(this.pitch - dy * LOOK.perPixel * LOOK.pitchScale,
      -LOOK.pitchClamp, LOOK.pitchClamp);
  }

  /** take over from wherever the hyperzoom left the camera, without a cut */
  syncFromCamera() {
    const e = new THREE.Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = clamp(e.x, -LOOK.pitchClamp, LOOK.pitchClamp);
    this._settled = false;
  }

  /** switch person without a cut (§2.5): the arm grows or retracts from here */
  toggleThird() {
    this.third = !this.third;
    return this.third;
  }

  /**
   * Place the camera for this frame.
   *
   * First person is the walker's eye plus the gait — one phase drives the bob,
   * the sway and the roll, so they cannot disagree about where in the stride
   * the body is (§6 M4).
   */
  place(dt) {
    const w = this.walker;
    const cam = this.camera;
    const eyeY = w.eyeY();

    if (!this.third) {
      // the lateral sway is a world-space offset perpendicular to the look, so
      // it reads as the head moving over the feet rather than as the world
      // sliding sideways
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      cam.position.set(w.pos.x + c * w.bobX, eyeY, w.pos.z - s * w.bobX);
      cam.rotation.set(0, 0, 0);
      cam.rotateY(this.yaw);
      cam.rotateX(this.pitch - w.lean);
      cam.rotateZ(w.roll);
      this.target.set(
        cam.position.x - Math.sin(this.yaw) * 10,
        cam.position.y + Math.sin(this.pitch) * 10,
        cam.position.z - Math.cos(this.yaw) * 10);
      this._settled = false;
      return;
    }

    // --- third person ------------------------------------------------------
    const head = { x: w.pos.x, y: w.pos.y + GAIT.eye * 0.82, z: w.pos.z };

    // The boom points *away* from where the camera looks. Pitch is folded in at
    // 0.62 so looking up does not bury the camera in the hill behind you —
    // §9.7 holds the horizon low, and a rig that swings to the zenith fights it.
    const cp = Math.cos(this.pitch * 0.62), sp = Math.sin(this.pitch * 0.62);
    const dir = { x: Math.sin(this.yaw) * cp, y: sp + ARM.rise / ARM.dist, z: Math.cos(this.yaw) * cp };
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= dl; dir.y /= dl; dir.z /= dl;

    // sweep, then ease the *length* rather than the position: easing the
    // position lets the camera drift through the wall it is being pushed out of
    const want = sweepArm(head, dir, ARM.dist, this.heightAt);
    const kIn = 1 - Math.exp(-24 * dt);   // pull in immediately when blocked
    const kOut = 1 - Math.exp(-3.2 * dt); // let back out slowly, so it breathes
    this._armLen += (want - this._armLen) * (want < this._armLen ? kIn : kOut);

    const px = head.x + dir.x * this._armLen;
    const py = head.y + dir.y * this._armLen;
    const pz = head.z + dir.z * this._armLen;
    // last resort, in case the sweep's resolution missed a spike between taps
    const floor = this.heightAt(px, pz) + ARM.clearance;

    this._pos.set(px, Math.max(py, floor), pz);
    if (!this._settled) { cam.position.copy(this._pos); this._settled = true; }
    else cam.position.lerp(this._pos, 1 - Math.exp(-ARM.follow * dt));

    // velocity-proportional look-ahead: the aim leads the body, so a turn
    // shows you where you are going rather than where you have been
    // Aimed at the chest rather than the eye, which is what drops the horizon
    // in a third-person frame (§9.7: "the horizon sits low; nothing is
    // centred"). Aiming at the head puts the horizon through the middle.
    this._aim.set(
      w.pos.x + w.vel.x * ARM.lookAhead,
      w.pos.y + GAIT.eye * 0.66,
      w.pos.z + w.vel.z * ARM.lookAhead);
    cam.lookAt(this._aim);
    this.target.copy(this._aim);
  }
}
