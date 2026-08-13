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
import { FLOW_ARM } from './flight.js';

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

    /**
     * `?flow=1`'s flight, or null. **Not a second rig** — the flight only ever
     * supplies numbers (speed, bank) that reschedule the one boom below, and
     * every line that places the camera is shared with third person. With the
     * flag off this stays null for the life of the rig and `place()` is the
     * function it always was, branch for branch.
     */
    this.flow = null;
    this._fovTouched = false;

    if (camera) {
      camera.fov = GAIT.fov;
      camera.near = 0.12;
      camera.updateProjectionMatrix();
    }
  }

  /**
   * Hand the rig the flight, and take the boom out from the head rather than
   * cutting to it (§2.5).
   *
   * `_settled` deliberately stays true: setting it false would `copy()` the
   * camera onto the far end of the boom in one frame, which is the cut. Leaving
   * it true with a 25 cm arm means the camera is where it already was and the
   * existing `kOut` easing walks it back along the boom over about a second —
   * which reads as the body leaving the camera behind, and is the shot.
   */
  beginFlow(flow) {
    this.flow = flow;
    this._armLen = FLOW_ARM.grow;
    this._settled = true;
  }

  /** the flight is over; the boom retracts on the same easing it grew on */
  endFlow() {
    this.flow = null;
  }

  /**
   * How far into the flight schedules this frame is, 0..1.
   *
   * One number, read by all six of them, so the boom cannot stretch on a
   * different curve from the one the field of view opens on.
   */
  _flowFrac() {
    if (!this.flow || this.flow.mode !== 'fly') return 0;
    return clamp(this.flow.speed / FLOW_ARM.refSpeed, 0, 1);
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
    const flying = !!this.flow && this.flow.mode === 'fly';

    if (!this.third && !flying) {
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
      if (this._fovTouched) this._fov(dt, 0);
      return;
    }

    // --- third person, and the flight, which is the same boom --------------
    //
    // One arm. `f` is 0 on foot and everything below reduces to §M4's rig
    // exactly; in flight it schedules the same five numbers with speed. There
    // is no second spring, no second sweep and no second follow, which is the
    // whole reason this reads as one camera rather than as two that agree.
    const f = this._flowFrac();
    const head = { x: w.pos.x, y: w.pos.y + GAIT.eye * 0.82, z: w.pos.z };

    // The boom points *away* from where the camera looks. Pitch is folded in at
    // 0.62 so looking up does not bury the camera in the hill behind you —
    // §9.7 holds the horizon low, and a rig that swings to the zenith fights it.
    const cp = Math.cos(this.pitch * 0.62), sp = Math.sin(this.pitch * 0.62);
    const dir = {
      x: Math.sin(this.yaw) * cp,
      y: sp + (ARM.rise / ARM.dist) * (1 - FLOW_ARM.drop * f),
      z: Math.cos(this.yaw) * cp,
    };

    // The body leads with the head and shoulders: at speed the boom swings from
    // "behind the look" toward "behind the *velocity*", so the camera sits on
    // the flight path and the body is seen going where it is going. Blended
    // rather than switched, and only to `trail`, so the mouse keeps authority —
    // a boom nailed to the velocity is a boom you cannot look sideways from.
    if (flying) {
      const v = this.flow.vel;
      const vl = Math.hypot(v.x, v.y, v.z);
      if (vl > 1e-3) {
        const t = FLOW_ARM.trail * f;
        dir.x += (-v.x / vl - dir.x) * t;
        dir.y += (-v.y / vl - dir.y) * t;
        dir.z += (-v.z / vl - dir.z) * t;
      }
    }
    const dl = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= dl; dir.y /= dl; dir.z /= dl;

    // sweep, then ease the *length* rather than the position: easing the
    // position lets the camera drift through the wall it is being pushed out of
    const reach = ARM.dist + FLOW_ARM.stretch * f;
    const want = sweepArm(head, dir, reach, this.heightAt);
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
    else cam.position.lerp(this._pos, 1 - Math.exp(-ARM.follow * (1 - FLOW_ARM.lag * f) * dt));

    // velocity-proportional look-ahead: the aim leads the body, so a turn
    // shows you where you are going rather than where you have been
    // Aimed at the chest rather than the eye, which is what drops the horizon
    // in a third-person frame (§9.7: "the horizon sits low; nothing is
    // centred"). Aiming at the head puts the horizon through the middle.
    //
    // In flight the lead grows with speed and picks up the vertical too: at
    // 87 m/s a 0.16 s lead is 14 m and the aim is still essentially on the
    // body, which is a portrait of someone flying rather than a shot of where
    // they are about to be.
    const lead = ARM.lookAhead + FLOW_ARM.lead * f;
    this._aim.set(
      w.pos.x + w.vel.x * lead,
      w.pos.y + GAIT.eye * 0.66 + (flying ? w.vel.y * lead : 0),
      w.pos.z + w.vel.z * lead);
    cam.lookAt(this._aim);
    // Roll last, and in the camera's own frame: `lookAt` writes the whole
    // quaternion, so a bank applied before it is a bank thrown away.
    if (flying && this.flow.bank !== 0) cam.rotateZ(this.flow.bank);
    this.target.copy(this._aim);
    if (flying || this._fovTouched) this._fov(dt, f);
  }

  /**
   * The one speed cue that costs nothing.
   *
   * §5 makes the frame budget a correctness property, and every honest way to
   * say "fast" — vapour, speed lines, motion blur — is a pass or a particle
   * system. The field of view is neither: it is a number in a matrix that is
   * rebuilt anyway, it is the oldest speed cue in cinema, and unlike a shock
   * cone at Mach 0.26 it makes no claim about the physics for §8 axis 8 to
   * catch (see the header of `flight.js`).
   *
   * Eased rather than set, because a field of view that tracks speed exactly
   * pumps on every gust of throttle, and `updateProjectionMatrix` is skipped
   * below a fortieth of a degree so a settled camera stops paying for it.
   */
  _fov(dt, f) {
    const cam = this.camera;
    if (!cam) return;
    const want = GAIT.fov + FLOW_ARM.fovGain * f;
    let next = cam.fov + (want - cam.fov) * clamp(2.6 * dt, 0, 1);
    // Snap the tail. An exponential approach never arrives, and "never arrives"
    // here means a lens left a fifth of a degree wide of §M4's 52 for the rest
    // of the session — small enough to miss and large enough to move a capture.
    if (Math.abs(next - want) < 0.02) next = want;
    if (Math.abs(next - cam.fov) < 1e-4) {
      if (next === GAIT.fov) this._fovTouched = false;
      return;
    }
    cam.fov = next;
    cam.updateProjectionMatrix();
    this._fovTouched = true;
  }
}
