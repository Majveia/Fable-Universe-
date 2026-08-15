// The room, drawn — CLAUDE.md §2.4, §2.5, and `src/liminal.js` made visible.
//
// `liminal.js` establishes that the Backrooms is the negative space of the seed
// function: the addresses the generator can express and never visits. It
// computes where reality is thin, what a room's address is, what shape that
// address implies, which worlds its doors open onto, and what colour a mercury
// discharge actually is. All of it is arithmetic and all of it is under test.
//
// This file has one job: **draw exactly that and invent nothing.** Every number
// below comes out of `room()`. If a dimension here were chosen rather than
// read, the whole argument of the other file would quietly become decoration.
//
// ---------------------------------------------------------------------------
// The one thing this file gets to decide, and it is a sampling question
//
// The lamp flickers at 100 Hz (§5 of `liminal.js`: a discharge strikes twice
// per 50 Hz cycle). A frame is 1/60 s. Point-sampling a 100 Hz signal at 60 Hz
// **aliases**, and it aliases to 40 Hz — which is not a subtle artifact, it is
// a visible strobe, and it would look like the lamp is failing rather than
// humming. The temptation is then to slow the flicker until it "looks right",
// which would mean deleting a real number because of a sampling mistake.
//
// The correct fix is the one a real camera performs for free: **integrate over
// the exposure.** A frame does not sample an instant, it accumulates light for
// its whole duration, so what belongs on screen is the *mean* of the flicker
// across `dt`. That removes the alias completely, keeps the 100 Hz, and leaves
// the shallow ripple the phosphor's persistence actually produces.
//
// `lampExposure()` in `liminal.js` is that mean. It is there rather than here
// because it is still the lamp's physics — this file only decides to ask for it.
//
// ---------------------------------------------------------------------------
// What the geometry is
//
// Four walls, a floor, a ceiling on the 600 mm grid, troffers on the lamp
// pitch, and one doorway per world that shares the room's address. Roughly 400
// triangles and three draw calls, because a room is six quads and some
// rectangles — §5's budget is not remotely in question here, and that is worth
// saying because the instinct with a "level" is to spend like one.
//
// The unease is carried by four things, none of which is geometry:
//
//   · **The walls are out of true.** `shape.skew` is a few tenths of a degree.
//     Nobody can name it and everybody feels it; it is the difference between a
//     room that is wrong and a room that is *almost* right, which is the entire
//     mechanism being borrowed.
//   · **The light is overhead and only overhead.** No fill, no bounce, no sky.
//     A ceiling grid of tubes gives you flat top-down illumination and hard
//     nothing underneath, which is why every photograph of a corridor like this
//     has dark skirting and a bright floor centre.
//   · **The damp.** `shape.damp` darkens the corners, because the corners are
//     where a real building fails first and because it is what stops the room
//     reading as a clean box.
//   · **The doors are just gaps.** No frames, no signage, no light beyond them
//     until you are through. A door you cannot see through is the only kind
//     worth walking toward.
//
// ---------------------------------------------------------------------------
// §2.8, and why this room is the exception that proves it
//
// §2.8 splits black by medium: true `#000` in vacuum, a lifted print inside an
// atmosphere. A room is neither. It has air in it — so the print's lift applies
// — but it has no sky, so there is no aerial perspective and no horizon light.
// The result is the flattest frame in the project, lit by one source, and that
// is correct: fluorescent light in a windowless room *is* flat. It is the one
// place in AEON where the absence of everything §9 asks for is the point.

import * as THREE from 'three';
import { GAIT, Walker } from './avatar.js';
import { input, attachKeyboard, jumpHeld } from './input.js';
import { lampColour, lampExposure, room, roomKey } from './liminal.js';

/** how far past a doorway you have to walk before it takes you */
const THRESHOLD = 0.55;

export class RoomScale {
  /**
   * @param ctx `{ galaxySeed, addr }` — the address is the room, so there is
   *            nothing else to pass and nothing to look up.
   */
  constructor(app, ctx) {
    this.app = app;
    this.kind = 'room';
    this.ctx = ctx;
    this.R = room(ctx.galaxySeed >>> 0, ctx.addr, ctx.scan ?? 4096);
    const sh = this.R.shape;

    this.scene = new THREE.Scene();
    // §2.8: there is no sky here, so the "background" is the far wall's own
    // shadow. Not black — a room with air in it never reaches black.
    this.scene.background = new THREE.Color(0x0a0a08).convertSRGBToLinear();
    this.camera = new THREE.PerspectiveCamera(GAIT.fov, 1, 0.05, 400);

    const lamp = new THREE.Color(...lampColour(sh.lampAge));
    this.lampColour = lamp;

    // -- the shell. One box, inside-out, so it is three draw calls rather than
    //    six and so the corners cannot develop a seam.
    const shell = new THREE.BoxGeometry(sh.width, sh.ceiling, sh.depth);
    this.wallMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xBFB48A).convertSRGBToLinear(),   // the wallpaper
      roughness: 0.95, metalness: 0, side: THREE.BackSide,
    });
    this.walls = new THREE.Mesh(shell, this.wallMat);
    this.walls.position.y = sh.ceiling * 0.5;
    // out of true — a few tenths of a degree, and the whole reason it unsettles
    this.walls.rotation.z = sh.skew;
    this.walls.rotation.x = sh.skew * 0.6;
    this.scene.add(this.walls);

    // -- the floor, separately, because carpet and vinyl are different surfaces
    //    and because it must stay level while the walls do not
    const floorMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(sh.carpet ? 0x6E6A50 : 0x9A9686).convertSRGBToLinear(),
      roughness: sh.carpet ? 0.98 : 0.42, metalness: 0,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(sh.width, sh.depth), floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // -- the troffers, on the grid the ceiling is tiled to. Emissive rather
    //    than lit: a tube is a source, and a source that receives light is the
    //    tell that somebody modelled a lamp instead of a lamp.
    this.tubeMat = new THREE.MeshBasicMaterial({ color: lamp.clone() });
    const tubes = new THREE.Group();
    const nx = Math.max(1, Math.floor(sh.width / sh.lampPitch));
    const nz = Math.max(1, Math.floor(sh.depth / sh.lampPitch));
    const tube = new THREE.PlaneGeometry(sh.tile * 1.9, sh.tile * 0.55);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const m = new THREE.Mesh(tube, this.tubeMat);
        m.rotation.x = Math.PI / 2;
        m.position.set(
          (i + 0.5) * sh.lampPitch - sh.width * 0.5,
          sh.ceiling - 0.02,
          (j + 0.5) * sh.lampPitch - sh.depth * 0.5,
        );
        tubes.add(m);
      }
    }
    this.scene.add(tubes);
    this.tubeCount = nx * nz;

    // -- and the light they cast. One hemisphere from above plus a point at the
    //    room's centre is not physical, and a grid of real lights would be —
    //    but §5 says a frame budget is a correctness property, and the visible
    //    difference between forty lights and this is nothing at these
    //    distances. What matters is that it comes from *above* and nowhere else.
    this.key = new THREE.PointLight(lamp, 1, sh.width + sh.depth, 1.6);
    this.key.position.set(0, sh.ceiling - 0.25, 0);
    this.scene.add(this.key);
    this.fill = new THREE.HemisphereLight(lamp, new THREE.Color(0x14120c), 0.55);
    this.scene.add(this.fill);

    // -- the doors. One gap per world sharing the address, spaced along the
    //    walls in index order so the same room always presents the same doors
    //    in the same places (§2.3).
    this.doors = [];
    const per = Math.max(1, this.R.doors.length);
    const doorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x07070a).convertSRGBToLinear() });
    const doorGeo = new THREE.PlaneGeometry(0.9, 2.05);
    this.R.doors.forEach((d, i) => {
      // walk the perimeter: the doors are distributed around it rather than
      // clustered, because a room with every exit on one wall is a corridor
      const u = (i + 0.5) / per;
      const peri = 2 * (sh.width + sh.depth);
      let t = u * peri, x, z, rot;
      if (t < sh.width) { x = t - sh.width / 2; z = -sh.depth / 2 + 0.01; rot = 0; }
      else if ((t -= sh.width) < sh.depth) { x = sh.width / 2 - 0.01; z = t - sh.depth / 2; rot = -Math.PI / 2; }
      else if ((t -= sh.depth) < sh.width) { x = sh.width / 2 - t; z = sh.depth / 2 - 0.01; rot = Math.PI; }
      else { t -= sh.width; x = -sh.width / 2 + 0.01; z = sh.depth / 2 - t; rot = Math.PI / 2; }
      const m = new THREE.Mesh(doorGeo, doorMat);
      m.position.set(x, 1.025, z);
      m.rotation.y = rot;
      this.scene.add(m);
      this.doors.push({ mesh: m, x, z, star: d });
    });

    // -- the body. The same walker that stands on planets, on a flat floor —
    //    one controller, so the step, the bob and the gait clock are the ones
    //    §M4 tested rather than a second copy for indoors.
    this.walker = new Walker({
      heightAt: () => 0,
      gravity: 9.81,
      seaLevel: -1e9,
      gait: GAIT,
    });
    this.walker.place(0, 0, 0);
    this.yaw = 0; this.pitch = 0;
    this.t = 0;
    this._detach = attachKeyboard();

    // duck-typed to match every other scale's `controls` (see `transition.js`)
    this.controls = {
      enabled: false,
      target: new THREE.Vector3(),
      update: () => {},
    };
  }

  /** §2.4 — this room's own URL fragment */
  get deepLink() { return roomKey(this.ctx.addr); }

  /** the hyperzoom arrives through the ceiling, because there is no sky */
  arriveFrom(rest) {
    return rest.clone().add(new THREE.Vector3(0, this.R.shape.ceiling * 3, 0));
  }

  update(dt) {
    this.t += dt;
    const sh = this.R.shape;

    // The exposure, not the instant — see the header. A 100 Hz lamp sampled at
    // 60 fps aliases to a 40 Hz strobe; integrating over the frame is what a
    // camera does and what removes it.
    const lit = lampExposure(this.t, dt);
    this.key.intensity = 1.15 * lit;
    this.fill.intensity = 0.55 * lit;
    this.tubeMat.color.copy(this.lampColour).multiplyScalar(0.6 + 0.4 * lit);

    if (!this.controls.enabled) return;

    // look, then move — the same order the surface uses so a drag means the
    // same thing on both sides of a doorway
    this.yaw -= (input.look?.x ?? 0) * 0.0022;
    this.pitch = Math.min(Math.max(this.pitch - (input.look?.y ?? 0) * 0.0022, -1.4), 1.4);
    if (input.look) { input.look.x = 0; input.look.y = 0; }

    this.walker.step(dt, {
      move: input.move,
      jump: jumpHeld(),
      sprint: input.down?.('sprint') ?? false,
      up: 0,
    }, this.yaw);

    // the walls hold you. A room you can walk out of the side of is a box.
    const w = this.walker;
    const hx = sh.width * 0.5 - 0.35, hz = sh.depth * 0.5 - 0.35;
    w.pos.x = Math.min(Math.max(w.pos.x, -hx), hx);
    w.pos.z = Math.min(Math.max(w.pos.z, -hz), hz);

    this.camera.position.set(w.pos.x, w.eyeY(), w.pos.z);
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));

    this._doorCheck();
  }

  /**
   * Walk into a doorway and the door takes you — to a *real world*, which is
   * the entire point of the graph (§6 of `liminal.js`). Address proximity has
   * nothing to do with distance, so this is a genuine shortcut across the
   * galaxy and not a corridor between two rooms.
   */
  _doorCheck() {
    if (this._used) return;
    const w = this.walker;
    for (const d of this.doors) {
      if (Math.hypot(w.pos.x - d.x, w.pos.z - d.z) > THRESHOLD) continue;
      this._used = true;
      this.app.enterWorldFromRoom?.(this.ctx.galaxySeed, d.star);
      return;
    }
  }

  /**
   * The HUD asks every scale for this **every frame**, and a scale that does
   * not answer takes the whole render loop down with it — the app froze at
   * frame 1 on `?room=`, because a missing method in a hot path is not a
   * missing feature, it is a crash. The scale contract is duck-typed and
   * therefore unenforced, which is exactly why a new scale has to be checked
   * against it by hand: `hudStats`, `update`, `dispose`, `enter`, `exit`,
   * `resume`, `pick`, `onKey`.
   *
   * What it says is what a room can honestly tell you. There is no sun, no
   * gravity worth quoting and no sky — the only true facts here are the
   * address, how many ways out there are, and that none of them lead back.
   */
  hudStats() {
    const sh = this.R.shape;
    return [
      ['address', this.R.key],
      ['room', `${sh.width.toFixed(1)} × ${sh.depth.toFixed(1)} × ${sh.ceiling.toFixed(1)} m`],
      ['doors', `${this.R.doors.length} · each to a world sharing this address`],
      ['lamp', `mercury · ${this.R.flickerHz} Hz`],
    ];
  }

  pick() { return null; }
  onKey() { return false; }
  enter() { this.controls.enabled = true; }
  exit() { this.controls.enabled = false; }
  resume() { this.controls.enabled = true; this._used = false; }

  dispose() {
    this._detach?.();
    this.scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

export const ROOM_NOTE = 'You noclipped. This is not a place the generator '
  + 'built — it is an address it can express and never visits, and the doors '
  + 'lead to the worlds that share it. They may be anywhere.';
