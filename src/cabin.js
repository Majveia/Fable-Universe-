// The cabin — CLAUDE.md §2.1, §2.5, §2.6, §M4.
//
// The one room in this universe that moves.
//
// `craft.js` sizes a vehicle from the Δv a world demands and argues, at length,
// that the craft is not an object but an answer. `conjure.js` assembles it and
// `climb.js` flies it. Between those, nobody was ever *inside* it — the craft
// was a thing you watched from outside and then were abruptly above.
//
// This is the inside. Three volumes along the axis, in the order you meet them
// walking forward:
//
//        −Z nose                                          +Z tail
//   ┌──────────────┬───────────────┬────────────────────────┐
//   │   COCKPIT    │   CORRIDOR    │        HABITAT         │
//   │ helm, canopy │ lockers, the  │ a long port, a table,  │
//   │              │ conduit run   │ somewhere to not fly   │
//   └──────────────┴───────────────┴────────────────────────┘
//
// ---------------------------------------------------------------------------
// §2.6, arrived at from the other end
//
// The cabin is modelled in **metres** and mounted on the craft, which lives in
// a world measured in planetary radii. That is not a convenience; it is the
// precision discipline the whole project runs on, one scale further in. Local
// coordinates stay inside ±8 m and a float never has to hold a cabin fitting's
// offset from a planet's centre.
//
// The reference this was ported from records the trap on the other side of that
// decision, and it is worth carrying because it costs a day: three's point
// lights attenuate as `max(d^decay, 0.01)`. Scale a metre-sized cabin up into
// kilometre world units and every lamp's distance term lands inside that clamp,
// which pins all of them at 100× and blows the interior to white. The cabin
// stays in metres and the *camera* is what changes frames.
//
// ---------------------------------------------------------------------------
// One kit, and why the seams run
//
// Everything here is surfaced by one plate-seam law rather than by five
// materials, because a ship whose panels were authored by five different
// passes reads as five different ships. The seams are analytic — a function of
// position, evaluated in the fragment shader — so there is no texture, which is
// §2.1, and they are continuous across parts because every part's transform is
// **baked into its geometry** before the parts are welded. Position in the
// shader is then the *cabin's* space rather than each mesh's own, and a seam
// that starts on the bulkhead carries on across the locker bolted to it.
//
// That is also what keeps the draw count down: a hundred pieces of furniture
// become a handful of meshes, one per material.
//
// ---------------------------------------------------------------------------
// The spec is pure
//
// `deck.js` returns arithmetic — dimensions, walkable volumes, blockers,
// stations — and imports nothing but the RNG. This draws exactly that and
// invents nothing, which is the discipline `rooms.js` keeps against
// `liminal.js`. It means `pilot.js`'s collision and this file's geometry cannot
// drift apart without `tools/verify.js` noticing, because they read one object
// — and the spec lives over there because node cannot load anything that
// imports three, and a test that cannot run is not a test.

import * as THREE from 'three';
import { CABIN, cabinFor } from './deck.js';
import {
  entryFor, entryFraction, entryState, sinkOf, stepEntry,
} from './descent.js';
import { crewState, look, sit, stand, stationInReach, stepCrew } from './pilot.js';
import { input } from './input.js';
import { now } from './clock.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

/* ---------------------------------------------------------------- the plate
   One seam law, evaluated analytically.

   A plate boundary is a *cell edge*, so the whole thing is one 3-D cell lookup
   and a distance to its border. Two scales — a metre-ish plate and a
   quarter-metre sub-plate — because a real hull is panelled at more than one
   gauge and a single scale reads as graph paper.

   The grazing rim term is the other half. three's standard shader has no
   grazing lobe in its diffuse response, so a bulkhead lit from behind collapses
   to a flat cut-out — which is exactly what a real backlit surface never does,
   because light wraps the edge and scatters off the paint. One Fresnel lobe
   costs nothing and is the difference between a wall and a hole. */
export const PLATE_GLSL = /* glsl */`
  float plateSeam(vec3 p, float gauge, float w) {
    vec3 c = p / gauge;
    vec3 f = abs(fract(c) - 0.5);
    float d = (0.5 - max(max(f.x, f.y), f.z)) * gauge;
    return 1.0 - smoothstep(0.0, w, d);
  }
`;

/**
 * Dress a standard material with the seam law and the rim.
 *
 * `onBeforeCompile` rather than a `ShaderMaterial`, so the cabin keeps three's
 * lighting — there are real lamps in here and re-deriving them would be a
 * second lighting model to keep in step with the first.
 *
 * The one caution worth carrying from the reference: `Material.clone()` does
 * **not** carry `onBeforeCompile`, so a hook on a shared material is a trap
 * waiting for the first clone. Every material here is built by this function
 * and never cloned.
 */
export function plated(mat, { gauge = 0.92, fine = 0.23, seam = 0.30, rim = 0.55 } = {}) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGauge = { value: gauge };
    sh.uniforms.uFine = { value: fine };
    sh.uniforms.uSeam = { value: seam };
    sh.uniforms.uRim = { value: rim };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCabinPos;
        varying vec3 vCabinNrm;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        // the *object's* space, not the mesh's — transforms are baked into the
        // geometry before the weld, so a seam runs across a part boundary
        vCabinPos = position;
        vCabinNrm = normalize(normalMatrix * normal);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCabinPos;
        varying vec3 vCabinNrm;
        uniform float uGauge; uniform float uFine;
        uniform float uSeam; uniform float uRim;
        ${PLATE_GLSL}`)
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
        float s = max(plateSeam(vCabinPos, uGauge, 0.006),
                      plateSeam(vCabinPos, uFine, 0.0035) * 0.45);
        gl_FragColor.rgb *= 1.0 - s * uSeam;
        // the grazing lobe — a backlit bulkhead is not a silhouette
        float f = pow(1.0 - clamp(dot(normalize(vCabinNrm),
                    normalize(-vViewPosition)), 0.0, 1.0), 3.4);
        gl_FragColor.rgb += f * uRim * gl_FragColor.rgb;`);
  };
  // three caches programs by this key, so two materials with different seam
  // settings must not share one
  mat.customProgramCacheKey = () => `cabin${gauge}|${fine}|${seam}|${rim}`;
  return mat;
}

/* ------------------------------------------------------------------- weld
   `vendor/addons` has no BufferGeometryUtils, so the merge is by hand — which
   is no loss, because doing it here is what lets the transform be baked first.
   That ordering is the whole trick: bake, then weld, and `position` in the
   shader is one continuous space across every part. */

/** a box with its transform already baked in */
export function place(w, h, d, [x, y, z], [rx, ry, rz] = [0, 0, 0]) {
  const g = new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz));
  m.setPosition(x, y, z);
  g.applyMatrix4(m);
  return g;
}

/** merge a list of baked geometries into one — position/normal/uv only */
export function weld(list) {
  const counts = list.reduce((n, g) => n + g.attributes.position.count, 0);
  const idxCount = list.reduce((n, g) => n + (g.index ? g.index.count : 0), 0);
  const pos = new Float32Array(counts * 3);
  const nrm = new Float32Array(counts * 3);
  const uv = new Float32Array(counts * 2);
  const idx = new Uint32Array(idxCount);
  let vo = 0, io = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    pos.set(p.array, vo * 3);
    if (n) nrm.set(n.array, vo * 3);
    if (t) uv.set(t.array, vo * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.array[i] + vo;
    io += g.index ? g.index.count : 0;
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

/** the hull shell, as an inward-facing extruded rounded section */
function shellGeo(spec) {
  const pts = [];
  const seg = 6;
  const r = CABIN.fillet;
  const arc = (cx, cy, a0, a1) => {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  const hw = spec.sections[2].half, h = spec.ceiling;
  arc(hw - r, r, -Math.PI / 2, 0);
  arc(hw - r, h - r, 0, Math.PI / 2);
  arc(-hw + r, h - r, Math.PI / 2, Math.PI);
  arc(-hw + r, r, Math.PI, Math.PI * 1.5);

  const n = pts.length;
  const pos = [], nrm = [], uv = [], idx = [];
  const rings = spec.sections.length + 1;
  const zs = [spec.zNose, ...spec.sections.map((s) => s.z1)];
  const halves = [spec.sections[0].half, ...spec.sections.map((s) => s.half)];
  for (let r0 = 0; r0 < rings; r0++) {
    const k = halves[r0] / hw;
    for (let i = 0; i < n; i++) {
      pos.push(pts[i][0] * k, pts[i][1], zs[r0]);
      const l = Math.hypot(pts[i][0], pts[i][1] - h * 0.5) || 1;
      // inward-facing: the crew is inside the tube
      nrm.push(-pts[i][0] / l, -(pts[i][1] - h * 0.5) / l, 0);
      uv.push(i / n, r0 / rings);
    }
  }
  for (let r0 = 0; r0 < rings - 1; r0++) {
    for (let i = 0; i < n; i++) {
      const a = r0 * n + i, b = r0 * n + ((i + 1) % n);
      const c = a + n, d = b + n;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/**
 * The cabin, drawn.
 *
 * Everything is in metres and parented to `group`; the caller mounts that on
 * the craft and renders it with its own camera. Nothing here reads a clock —
 * `update()` takes the scene time, so `?dt=` pins it and `repeat.js` can shoot
 * the same frame twice.
 */
export class Cabin {
  constructor(craft, seed = 0) {
    this.spec = cabinFor(craft, seed);
    const S = this.spec;
    this.group = new THREE.Group();

    const lin = (h) => new THREE.Color(h).convertSRGBToLinear();

    // ---- the shell
    this.hullMat = plated(new THREE.MeshStandardMaterial({
      color: lin(0x8d8f95), roughness: 0.72, metalness: 0.18,
      side: THREE.BackSide,
    }), { gauge: 0.92, seam: 0.34 });
    this.group.add(new THREE.Mesh(shellGeo(S), this.hullMat));

    // ---- the deck: a separate material, because a floor is walked on and a
    // ceiling is not, and one roughness cannot be right for both
    this.deckMat = plated(new THREE.MeshStandardMaterial({
      color: lin(0x4b4e55), roughness: 0.88, metalness: 0.06,
    }), { gauge: 0.61, fine: 0.152, seam: 0.42 });
    const deck = new THREE.Mesh(
      new THREE.PlaneGeometry(S.sections[2].half * 2, S.length), this.deckMat);
    deck.rotation.x = -Math.PI / 2;
    deck.position.z = (S.zNose + S.zTail) * 0.5;
    this.group.add(deck);

    // ---- the furniture, baked and welded into one mesh
    const parts = [];
    const seatZ = S.seat.z;
    // console across the nose
    parts.push(place(S.sections[0].half * 1.9, 0.30, CABIN.consoleDepth,
      [0, 0.86, S.zNose + CABIN.consoleDepth * 0.5], [-0.34, 0, 0]));
    // the seat: pan, backrest, two arms
    parts.push(place(0.54, 0.11, 0.52, [0, 0.46, seatZ - 0.06]));
    parts.push(place(0.56, 0.72, 0.13, [0, 0.90, seatZ + 0.15], [0.13, 0, 0]));
    parts.push(place(0.09, 0.09, 0.42, [-0.32, 0.66, seatZ - 0.04]));
    parts.push(place(0.09, 0.09, 0.42, [0.32, 0.66, seatZ - 0.04]));
    // the nav table amidships — if this ship has room for one. Read from the
    // spec rather than indexed: a short cabin has one blocker, not two, and
    // `blockers[1]` was about to draw a table out of `undefined`.
    const nb = S.blockers[1];
    if (nb) {
      parts.push(place(nb[1] - nb[0], 0.08, nb[3] - nb[2],
        [0, 0.78, (nb[2] + nb[3]) * 0.5]));
    }
    // lockers down the corridor, on the side the dressing chose
    const cor = S.sections[1];
    for (let i = 0; i < S.dressing.lockers; i++) {
      const t = (i + 0.5) / S.dressing.lockers;
      parts.push(place(0.16, 0.86, 0.44,
        [S.dressing.decalSide * (cor.half - 0.09), 1.12,
          cor.z0 + (cor.z1 - cor.z0) * t]));
    }
    this.fitMat = plated(new THREE.MeshStandardMaterial({
      color: lin(0x6f7278), roughness: 0.66, metalness: 0.24,
    }), { gauge: 0.44, fine: 0.11, seam: 0.28 });
    this.group.add(new THREE.Mesh(weld(parts), this.fitMat));

    // ---- the canopy. Not glass with a refraction model: a hole in the hull
    // that the sky is drawn through, which is what a windscreen is.
    this.canopyMat = new THREE.MeshBasicMaterial({
      color: lin(0x0a0d12), transparent: true, opacity: 0.10,
      side: THREE.DoubleSide, depthWrite: false,
    });
    const cw = S.sections[0].half * 1.72;
    const cd = S.canopy.z1 - S.canopy.z0;
    const canopy = new THREE.Mesh(new THREE.PlaneGeometry(cw, cd), this.canopyMat);
    canopy.rotation.x = -Math.PI / 2;
    canopy.position.set(0, S.ceiling - 0.06, (S.canopy.z0 + S.canopy.z1) * 0.5);
    this.canopy = canopy;
    this.group.add(canopy);

    /* ---- the lamps.
       Metres, and this is the trap the header names: three attenuates as
       `max(d^decay, 0.01)`, so a cabin scaled into kilometre units puts every
       one of these inside the clamp and pins it at 100×. They stay here, in the
       frame they were authored in, and the camera is what moves between frames. */
    this.lamps = [];
    for (const [z, hex, power] of [
      [S.zNose + 0.7, 0xffd6a2, 2.1],
      [(S.sections[1].z0 + S.sections[1].z1) * 0.5, 0xbfd2e6, 1.5],
      [(S.sections[2].z0 + S.sections[2].z1) * 0.5, 0xffe0b4, 2.4],
    ]) {
      const l = new THREE.PointLight(lin(hex), power, 7.5, 2);
      l.position.set(0, S.ceiling - 0.16, z);
      l.base = power;
      this.lamps.push(l);
      this.group.add(l);
    }
    // a dim fill so an unlit corner is never achromatic-black — §8 axis 2
    this.group.add(new THREE.HemisphereLight(lin(0x5c6e9e), lin(0x2a2622), 0.28));
  }

  /**
   * `t` is scene seconds from `clock.js` and `entry` is `descent.js`'s
   * `entryFraction` — 0 in vacuum, 1 on the ground.
   *
   * The lamps warm and lift as the cabin enters atmosphere, which is the
   * §2.8/§3 cross-fade seen from inside: the same parameter that drives the
   * grade outside drives the light in here, so the two cannot disagree about
   * where the atmosphere started.
   */
  update(t = 0, entry = 0) {
    const e = clamp(num(entry, 0), 0, 1);
    for (let i = 0; i < this.lamps.length; i++) {
      const l = this.lamps[i];
      // a slow breath, out of phase per lamp so they do not pulse as one.
      // Read from `base` rather than from `intensity`, or each frame multiplies
      // the last one and the cabin ramps to white over about a minute.
      const b = 1 + Math.sin(t * 0.7 + i * 2.2) * 0.018;
      l.intensity = l.base * b * (1 + e * 0.22);
    }
    // the canopy darkens through entry: there is a plasma sheath out there
    this.canopy.material.opacity = 0.10 + e * 0.16;
  }

  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}

/* ===========================================================================
   The cabin as a place — CLAUDE.md §2.4, §2.5.

   A scale in the stack, like a room or a surface, and it exists to close the
   one gap §2.5 still had: you arrived at a planet by *pushing a scale*, which
   is a cut however smoothly it is animated.

   The chain this makes possible, unbroken:

       orbit  →  stand in the cabin  →  sit at the helm  →  fly it down  →  ground

   Nothing in that sentence is a fade. The sit is `pilot.js`'s bowed curve, the
   descent is `descent.js` integrating a real entry, and the hand-over to the
   surface is the same edge-and-latch `climb.js` uses going the other way.
   ========================================================================= */

const PARAM = (k) => {
  try { return new URL(window.location.href).searchParams.get(k); }
  catch { return null; }
};

/** §7.4 — built behind a flag, default-off. Flipping it is a separate commit. */
export const CABIN_ON = PARAM('cab') === '1' || PARAM('cab') === '2';

export class CabinScale {
  /**
   * `ctx` carries the planet being descended to, the system it is in, and the
   * craft `craftFor()` solved for that world — the same object `climb.js`
   * would fly off it.
   */
  constructor(app, ctx) {
    this.app = app;
    this.kind = 'cabin';
    this.ctx = ctx;
    const pp = this.pp = ctx.planet;

    this.scene = new THREE.Scene();
    /* §2.8, and the reason this scale is interesting for the grade: the cabin
       *crosses* the boundary. In vacuum the background behind the canopy is
       true #000; inside an atmosphere nothing reaches black. So the background
       is not a constant here — it is driven by the same `entryFraction` that
       drives everything else, which is exactly what §3 row 1 asks for. */
    this.scene.background = new THREE.Color(0x000000);
    // §M4's lens, so stepping from the deck onto the ground does not change
    // the focal length of the world
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.05, 4e7);

    this.cabin = new Cabin(ctx.craft ?? {}, pp?.seed ?? 0);
    this.scene.add(this.cabin.group);
    this.spec = this.cabin.spec;

    // the crew, standing where the deck plan says there is deck to stand on,
    // facing forward toward the helm
    this.crew = crewState(this.spec.spawn, 0);

    /* The descent, armed but not begun. `entryFor` is solved once here rather
       than per frame: it is the same "constants that do not change during the
       flight" split `launchFor()` makes, and it keeps the per-frame step to
       arithmetic. */
    this.world = {
      massE: num(pp?.massE, 1),
      radiusE: num(pp?.radiusE, 1),
      atmo: num(pp?.atmo, 1),
    };
    this.entryP = entryFor(ctx.craft ?? {}, this.world);
    this.entry = entryState(this.entryP);
    this.flying = false;
    this.capture = num(ctx.capture, 1435);

    /* The world through the canopy.

       Not a skybox: a real sphere at a real distance, so its angular size is
       the one the altitude implies and the horizon curves the way the radius
       says it should. It is drawn in the cabin's metre frame with the radius
       and distance scaled together, which keeps the *angle* exact while
       keeping every number inside a float — the same trick the camera-at-origin
       rule plays at every other scale (§2.6). */
    const R = this.world.radiusE * 6.371e6;
    this.planetR = R;
    const col = pp?.color ? new THREE.Color(pp.color) : new THREE.Color(0x6f7f6a);
    this.globeMat = new THREE.MeshStandardMaterial({
      color: col.convertSRGBToLinear(), roughness: 0.94, metalness: 0,
    });
    this.globe = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.globeMat);
    this.scene.add(this.globe);
    this.sun = new THREE.DirectionalLight(
      new THREE.Color(ctx.sunColor ?? 0xfff1ce).convertSRGBToLinear(), 2.4);
    this.sun.position.set(-0.6, 0.5, -1);
    this.scene.add(this.sun);

    this._motion = matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0.35 : 1;
  }

  /** §2.4 · `?cab=1` standing, `?cab=2` seated */
  get deepLink() { return this.crew.mode === 'seated' ? '2' : '1'; }

  /** 0 in vacuum, 1 on the ground — the parameter the grade rides (§2.8) */
  get entryFrac() { return this.flying ? entryFraction(this.entry, this.entryP) : 0; }

  enter() { this._active = true; }
  exit() { this._active = false; }
  resume() { this._active = true; }

  /**
   * Keys. `E` uses whatever station is in reach, `Esc`/`Q` stands up, and — from
   * the helm, seated — `L` commits the descent.
   *
   * Returns true when the key was consumed, so `main.js` does not also act on it.
   */
  onKey(code) {
    if (code === 'KeyE') {                       // BINDINGS.interact
      const st = stationInReach(this.crew, this.spec.stations);
      if (st) { this.crew = sit(this.crew, st); return true; }
      return false;
    }
    if (code === 'KeyQ' && this.crew.mode === 'seated') {
      this.crew = stand(this.crew);
      return true;
    }
    if (code === 'KeyL' && this.crew.mode === 'seated'
      && this.crew.seat?.id === 'helm' && !this.flying) {
      this.flying = true;
      this.entry = entryState(this.entryP);
      return true;
    }
    return false;
  }

  update(dt) {
    const step = Math.min(Math.max(dt, 0), 0.25);

    // ---- the crew
    const aim = input.takeLook();
    if (aim.x || aim.y) this.crew = look(this.crew, aim.x, aim.y);
    /* `input.js`, not a key map of this file's own. §13 is explicit that there
       is one input layer and that desktop and touch never mount together, and
       `input.move` is already analog — a keyboard writes ±1 into it and a thumb
       writes whatever fraction it is pushed to, so the cabin gets a touch
       control layer for free and cannot tell which wrote it. */
    this.crew = stepCrew(this.crew, this.spec, {
      fwd: -input.move.y,
      strafe: input.move.x,
      run: input.down('sprint'),
    }, step, this._motion);

    this.camera.position.set(this.crew.eye[0], this.crew.eye[1], this.crew.eye[2]);
    this.camera.quaternion.setFromEuler(
      new THREE.Euler(this.crew.pitch, this.crew.yaw, 0, 'YXZ'));

    // ---- the descent
    if (this.flying && this.entry.phase !== 'down') {
      this.entry = stepEntry(this.entry, this.entryP, step, this.capture);
      if (this.entry.captured) this._handOff();
    }

    const e = this.entryFrac;
    this.cabin.update(now(), e);

    /* The world outside, placed by the altitude rather than by a curve.

       Distance to the centre is `R + h`; both are divided by the same factor so
       the *angle* the sphere subtends is exact while the numbers stay small.
       A planet 122 km below a 6371 km world fills 172° of sky, and this is what
       makes the canopy go from a disc to a floor without anybody animating it. */
    const alt = this.flying ? Math.max(this.entry.h, 0) : this.entryP.interface;
    const d = this.planetR + alt;
    const k = 900 / d;                       // put the surface ~900 m "below"
    this.globe.scale.setScalar(this.planetR * k);
    this.globe.position.set(0, -(d * k) + this.spec.ceiling * 0.5, 0);

    /* §2.8 · the background crosses the boundary with the vehicle. True #000 in
       vacuum; lifted once there is air outside, because an atmosphere never
       delivers zero photons. The lift is §9.4's, and it arrives on the same
       parameter as the cabin's lamps so the two cannot disagree. */
    this.scene.background.setRGB(0.017 * e, 0.021 * e, 0.036 * e);
  }

  /** the surface scale takes the vehicle, and the chain closes without a cut */
  _handOff() {
    this.app?.arriveOnSurface?.(this, {
      planet: this.pp,
      system: this.ctx.system,
      sunColor: this.ctx.sunColor,
      hostIndex: this.ctx.hostIndex,
      down: this.entry.down,
    });
  }

  hudStats() {
    if (!this.flying) {
      return this.crew.mode === 'seated'
        ? ['HELM', 'L · descend', 'Q · stand']
        : ['CABIN', stationInReach(this.crew, this.spec.stations)
          ? 'E · take the seat' : 'W A S D'];
    }
    const s = this.entry;
    return [
      `${(s.h / 1000).toFixed(1)} km`,
      `${sinkOf(s).toFixed(0)} m/s down`,
      `${(s.decel / 9.80665).toFixed(1)} g`,
      s.phase.toUpperCase(),
    ];
  }

  pick() { return null; }

  dispose() {
    this.cabin.dispose();
    this.globe.geometry.dispose();
    this.globeMat.dispose();
  }
}
