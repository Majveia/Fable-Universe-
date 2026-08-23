// The crew, and the seat — CLAUDE.md §2.5, §M4.
//
// `avatar.js` walks a planet. This walks a deck, which is a smaller and
// strictly easier problem, and it exists as its own file for one reason: the
// thing worth getting right here is not the walking.
//
// ---------------------------------------------------------------------------
// The three metres that are actually hard
//
// Standing behind a pilot's seat and sitting down in it is a camera move of
// about three metres, and it is the move that decides whether a ship reads as a
// place you are inside of or as a menu with a viewport.
//
// The naive version lerps the eye from where it is standing to where it sits.
// It looks wrong, and it looks wrong in a way that is easy to misdiagnose as a
// timing problem: **the straight line runs through the backrest.** For a frame
// or two the camera is inside the chair and the screen fills with the grey
// underside of a shell, and no amount of easing fixes it because the geometry
// is what is wrong. The reference this was ported from hit exactly this and
// documents the fix in situ.
//
// So the eye travels a bowed path instead — out to whichever side it approached
// from, and lifted — and arrives the way a body would, swinging around the arm
// of the chair rather than through it. It is one quadratic Bézier, it costs
// nothing, and it is the difference between sitting down and clipping.
//
// §2.5 is why it matters beyond taste. "No cuts, no fades to black" is usually
// read as a statement about scale changes, but a camera that passes through the
// furniture is a cut of one frame, and the invariant does not have a size
// threshold in it.
//
// ---------------------------------------------------------------------------
// Nothing here imports three
//
// Vectors are `[x, y, z]` arrays and the module is arithmetic, so all of it is
// decided by `tools/verify.js` rather than by flying. That is the same contract
// `climb.js`, `ascent.js` and `descent.js` keep, and it is what lets the seat
// path be argued about numerically instead of by screenshot.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);
const wrapPi = (a) => {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
};
const lerp = (a, b, t) => a + (b - a) * t;
/** angles interpolate the short way round, or a yaw of 179°→−179° spins 358° */
export const lerpAngle = (a, b, t) => a + wrapPi(b - a) * t;
/** the ease every transition in this file uses — smooth at both ends */
export const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2);

export const CREW = {
  /**
   * Eye height standing, metres. §9.7 fixes 1.68 m for the walker and this
   * agrees with it deliberately: stepping from a deck onto a planet must not
   * change how tall you are.
   */
  eye: 1.68,
  /** shoulder radius for the corridor test, m */
  radius: 0.30,
  walk: 1.65,
  run: 2.9,
  /** seconds the sit takes. Slower than a cut, faster than a cutscene. */
  sitTime: 0.62,
  /**
   * How far the eye bows out of the straight line, m — sideways, up, and
   * back toward the room.
   *
   * These are not decoration. `side` has to clear the arm of the chair, `lift`
   * has to clear the seat cushion on the way past, and `back` has to clear the
   * backrest, which is the one that is actually in the way. Set all three to
   * zero and the path is the straight line the header is about.
   */
  bowSide: 0.30,
  bowLift: 0.17,
  bowBack: 0.16,
  /**
   * The arc a seated head can turn through, radians either side of the way the
   * seat faces — and this exists so you cannot end up staring through the back
   * of your own chair.
   *
   * 1.15 rad is 66°, which is about where a real neck stops without the
   * shoulders following. Past that a seated pilot would be looking at upholstery
   * and would read as a camera that had come loose from the body.
   */
  seatYaw: 1.15,
  seatPitchUp: 0.62,
  seatPitchDown: -0.72,
  /** how close, and how squarely faced, a station has to be to be usable */
  reach: 0.55,
  facing: 0.25,
  /**
   * Head-bob amplitude, m. Small enough to read as gait and not as a boat:
   * two centimetres vertical at a stride, under one and a half lateral.
   */
  bobUp: 0.021,
  bobSide: 0.014,
};

/** the crew member, standing where they woke */
export const crewState = (pos = [0, 0, 2.4], yaw = 0) => ({
  pos: [num(pos[0], 0), num(pos[1], 0), num(pos[2], 0)],
  vel: [0, 0],
  yaw: num(yaw, 0),
  pitch: 0,
  /** walk · seated · moving — `moving` is the transition and owns the camera */
  mode: 'walk',
  eye: [0, CREW.eye, 0],
  /** gait phase, radians. One clock — see `gait` below. */
  bob: 0,
  bobAmt: 0,
  /** the station within reach, or null */
  station: null,
  seat: null,
  /** transition bookkeeping */
  t: 0,
  target: null,
  from: { pos: [0, 0, 0], yaw: 0, pitch: 0 },
});

/**
 * The bowed eye path between standing and seated.
 *
 * One quadratic Bézier. The control point is the midpoint pushed out to the
 * side the crew member approached from, lifted, and pulled back toward the
 * room — which is what takes the curve around the backrest instead of through
 * it.
 *
 * The side is *signed by the approach*, not fixed, so walking up on the left
 * swings the eye around the left arm and walking up on the right swings it
 * round the right. A fixed side is right half the time and reads as the camera
 * taking a detour the other half. When the approach is dead-on and there is no
 * side to prefer, it picks one rather than dividing by zero.
 */
export function seatPath(from, to, k, out = [0, 0, 0]) {
  const dx = from[0] - to[0];
  const side = Math.abs(dx) > 0.04 ? Math.sign(dx) : 1;

  /* **Cubic, not quadratic**, and the difference is the whole point.
     
     A quadratic has one control point, so the curve's single bulge sits in the
     middle — and the middle is not where the obstacle is. The backrest is in
     the *last* quarter of the move, right where a mid-bulged curve has already
     come back down to the straight line. Measured against a real seat it cut
     the frames spent inside the backrest from 14.2% to 11.8%: better, and not
     remotely the fix it was supposed to be.
     
     Two control points let the curve leave and arrive independently, which is
     what a body actually does. `c1` lifts and swings out of the standing
     position while staying back; `c2` sits high and slightly *past* the seat
     eye, so the last stretch comes down onto the cushion from in front of the
     backrest rather than through it. */
  const c1 = [
    from[0] + side * CREW.bowSide,
    from[1] + CREW.bowLift * 0.5,
    lerp(from[2], to[2], 0.22) + CREW.bowBack,
  ];
  const c2 = [
    to[0] + side * CREW.bowSide * 0.45,
    to[1] + CREW.bowLift * 2.1,
    to[2] - CREW.bowBack * 0.55,
  ];
  const u = 1 - k;
  const a = u * u * u, b = 3 * u * u * k, c = 3 * u * k * k, d = k * k * k;
  out[0] = a * from[0] + b * c1[0] + c * c2[0] + d * to[0];
  out[1] = a * from[1] + b * c1[1] + c * c2[1] + d * to[1];
  out[2] = a * from[2] + b * c1[2] + c * c2[2] + d * to[2];
  return out;
}

/** the straight line the bow replaced — kept so the suite can compare them */
export function straightPath(from, to, k, out = [0, 0, 0]) {
  out[0] = lerp(from[0], to[0], k);
  out[1] = lerp(from[1], to[1], k);
  out[2] = lerp(from[2], to[2], k);
  return out;
}

/**
 * Does a path pass through a box — the backrest, an armrest, a console?
 *
 * `box` is `[x0, x1, y0, y1, z0, z1]`. Returns the fraction of sampled steps
 * that are inside it, so a caller can tell a graze from a full traversal.
 *
 * This is exposed because clearing the furniture is the property the bowed path
 * exists to have, and a property nothing can see is one that quietly stops
 * being true the next time somebody moves a seat 20 cm. The suite asserts it
 * against `straightPath` so the comparison is to the thing that was wrong,
 * rather than to a number somebody chose.
 *
 * The endpoints are excluded: the seat eye is *inside* the chair by
 * construction — that is what sitting in it means — so a test that counted
 * them could never pass for any path at all.
 */
export function pathHits(from, to, box, path = seatPath, steps = 128) {
  const p = [0, 0, 0];
  let hits = 0, n = 0;
  for (let i = 1; i < steps; i++) {
    path(from, to, easeInOut(i / steps), p);
    n++;
    if (p[0] > box[0] && p[0] < box[1] && p[1] > box[2] && p[1] < box[3]
      && p[2] > box[4] && p[2] < box[5]) hits++;
  }
  return hits / Math.max(n, 1);
}

/** begin sitting. A no-op unless standing, so a held key cannot re-enter it. */
export function sit(s, station) {
  if (s.mode !== 'walk' || !station) return s;
  return {
    ...s,
    from: { pos: [...s.pos], yaw: s.yaw, pitch: s.pitch },
    seat: {
      eye: station.seatEye ? [...station.seatEye] : [0, 1.16, -5.28],
      yaw: num(station.seatYaw, 0),
      id: station.id ?? null,
    },
    mode: 'moving',
    target: 'seated',
    t: 0,
  };
}

/** stand up again, along the same curve run backwards */
export function stand(s, standAt = null) {
  if (s.mode !== 'seated') return s;
  const at = standAt || [s.seat.eye[0], 0, s.seat.eye[2] + 0.95];
  return {
    ...s,
    // the full seat eye, not the deck under it: this carried a y of 0 and the
    // curve therefore started half a metre low, which put one frame of the
    // stand back inside the backrest the sit had just been taught to miss
    from: { pos: [...s.seat.eye], yaw: s.yaw, pitch: s.pitch },
    pos: [num(at[0], 0), 0, num(at[2], 0)],
    mode: 'moving',
    target: 'walk',
    t: 0,
  };
}

/**
 * Aim the head.
 *
 * Seated, the yaw is clamped **relative to the way the seat faces** rather than
 * absolutely, so a seat installed at any heading gets the same arc. Clamping in
 * world yaw works only for a seat that happens to face zero, which is the sort
 * of bug that survives every test written on the ship it was written for.
 */
export function look(s, dx, dy, sens = 1) {
  if (s.mode === 'moving') return s;
  let yaw = s.yaw - dx * 0.0024 * sens;
  let pitch = clamp(s.pitch - dy * 0.0024 * sens, -1.32, 1.32);
  if (s.mode === 'seated' && s.seat) {
    yaw = s.seat.yaw + clamp(wrapPi(yaw - s.seat.yaw), -CREW.seatYaw, CREW.seatYaw);
    pitch = clamp(pitch, CREW.seatPitchDown, CREW.seatPitchUp);
  }
  return { ...s, yaw, pitch };
}

/**
 * Which station, if any, is in reach and being faced.
 *
 * Distance alone is not enough: standing between two consoles it picks whichever
 * is marginally nearer, which from the crew member's point of view is arbitrary.
 * Requiring that the station be roughly in front resolves it the way a person
 * would — and the requirement is dropped at very short range, because at 20 cm
 * "in front of" stops being meaningful and the prompt should not flicker as you
 * turn on the spot.
 */
export function stationInReach(s, stations) {
  if (s.mode !== 'walk' || !stations) return null;
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  let best = null, bd = Infinity;
  for (const st of stations) {
    const dx = st.pos[0] - s.pos[0], dz = st.pos[2] - s.pos[2];
    const d = Math.hypot(dx, dz);
    if (d > num(st.radius, 0.6) + CREW.reach) continue;
    if (d >= 0.25 && (dx * fx + dz * fz) / d < CREW.facing) continue;
    if (d < bd) { bd = d; best = st; }
  }
  return best;
}

/**
 * The walkable half-width of the hull at a given z, and whether a point is
 * blocked. Deliberately not a physics engine: a cabin is a corridor of known
 * width plus a handful of boxes, and moving each axis separately means you
 * slide along a bulkhead instead of sticking to it.
 */
function halfWidthAt(cabin, z) {
  for (const v of cabin.volumes) if (z >= v[1] && z <= v[2]) return v[0];
  return 0.6;
}
function blocked(cabin, x, z) {
  for (const b of cabin.blockers) {
    if (x > b[0] - CREW.radius && x < b[1] + CREW.radius
      && z > b[2] - CREW.radius && z < b[3] + CREW.radius) return true;
  }
  return false;
}

/**
 * One frame.
 *
 * Pure: takes a state and returns the next one, so a whole walk across a deck
 * and into a seat runs offline in a loop.
 *
 * `input` is `{ fwd, strafe, run }` with the two axes already in [−1, 1], which
 * keeps every key-vs-stick question in `input.js` where it belongs.
 *
 * §9.8: `motion` scales the bob and the transition, and a reduced-motion
 * viewer passes something under one. It is never zero — stillness would be a
 * lie about a vehicle.
 */
export function stepCrew(s0, cabin, input = {}, dt = 1 / 60, motion = 1) {
  const s = { ...s0, pos: [...s0.pos], vel: [...s0.vel], eye: [...s0.eye] };
  const step = clamp(num(dt, 0), 0, 0.25);
  if (step <= 0) return s;
  const m = clamp(num(motion, 1), 0.25, 1);

  if (s.mode === 'moving') {
    // The transition owns the camera outright — look() refuses input while it
    // runs, so there is no way to fight it and no way to end up half-seated.
    // §9.8 · reduced motion *shortens* transitions — hyperzooms go to 250 ms.
    // This read `/ m`, which lengthened the sit to 1.8 s for exactly the viewer
    // who asked for less of it.
    s.t = Math.min(1, s.t + (step / (CREW.sitTime * m)));
    const k = easeInOut(s.t);
    const stood = [s.from.pos[0], CREW.eye, s.from.pos[2]];
    if (s.target === 'seated') {
      seatPath(stood, s.seat.eye, k, s.eye);
      s.yaw = lerpAngle(s.from.yaw, s.seat.yaw, k);
      s.pitch = lerp(s.from.pitch, -0.10, k);
    } else {
      // the same curve, run backwards, so standing up retraces sitting down
      seatPath([s.pos[0], CREW.eye, s.pos[2]], s.from.pos, 1 - k, s.eye);
      s.yaw = lerpAngle(s.from.yaw, s.yaw, k);
      s.pitch = lerp(s.from.pitch, 0, k);
    }
    if (s.t >= 1) {
      s.mode = s.target;
      if (s.target === 'walk') s.seat = null;
      s.target = null;
    }
    return s;
  }

  if (s.mode === 'seated') {
    s.eye = [...s.seat.eye];
    s.bobAmt *= Math.max(0, 1 - step * 6);
    return s;
  }

  // ---- walking a deck
  const run = !!input.run;
  const speed = (run ? CREW.run : CREW.walk);
  const fwd = clamp(num(input.fwd, 0), -1, 1);
  const strafe = clamp(num(input.strafe, 0), -1, 1);
  const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw);
  let vx = -sy * fwd + cy * strafe;
  let vz = -cy * fwd - sy * strafe;
  const l = Math.hypot(vx, vz);
  // normalise the *diagonal* rather than the axes, or holding two keys is
  // 1.41× walking speed and the ship reads as bigger when you cut a corner
  if (l > 1) { vx /= l; vz /= l; }

  const k = Math.min(1, step * 12);
  s.vel[0] = lerp(s.vel[0], vx * speed, k);
  s.vel[1] = lerp(s.vel[1], vz * speed, k);

  // one axis at a time, so a wall is slid along rather than stuck to
  if (cabin) {
    const zMin = cabin.volumes[0][1] + CREW.radius;
    const zMax = cabin.volumes[cabin.volumes.length - 1][2] - CREW.radius;
    const nx = s.pos[0] + s.vel[0] * step;
    if (Math.abs(nx) <= halfWidthAt(cabin, s.pos[2]) - CREW.radius
      && !blocked(cabin, nx, s.pos[2])) s.pos[0] = nx;
    const nz = clamp(s.pos[2] + s.vel[1] * step, zMin, zMax);
    if (Math.abs(s.pos[0]) <= halfWidthAt(cabin, nz) - CREW.radius
      && !blocked(cabin, s.pos[0], nz)) s.pos[2] = nz;
  } else {
    s.pos[0] += s.vel[0] * step;
    s.pos[2] += s.vel[1] * step;
  }

  /* One gait clock, per §M4 — the same phase drives the bob, the footstep and
     anything else that has to agree with the feet. Two clocks cannot be kept in
     step and will drift apart over exactly the length of time nobody watches
     for. Advanced by *distance travelled*, not by time, so slowing down
     lengthens the stride instead of speeding up the legs. */
  const moving = Math.hypot(s.vel[0], s.vel[1]);
  s.bob += moving * step * (run ? 5.4 : 6.6);
  s.bobAmt += (Math.min(moving / CREW.walk, 1.2) - s.bobAmt) * Math.min(1, step * 8);

  s.eye[0] = s.pos[0] + Math.cos(s.bob) * CREW.bobSide * s.bobAmt * m;
  s.eye[1] = CREW.eye + Math.sin(s.bob * 2) * CREW.bobUp * s.bobAmt * m;
  s.eye[2] = s.pos[2];
  return s;
}

/** the gait phase, for anything that has to land on the same foot */
export const gait = (s) => s.bob;
/** 0→1 through a sit or a stand; 0 when neither is happening */
export const transitionFraction = (s) => (s.mode === 'moving' ? easeInOut(s.t) : 0);
