// Leaving the ground — CLAUDE.md §2.5, §M5.
//
// §2.5 is the invariant this file exists to close:
//
//   *"No cuts, no loading screens, no fades to black. Scale changes are
//   hyperzooms under a passing snapshot. **If a feature can't be entered
//   continuously, it isn't finished.**"*
//
// Every scale change in this project honours that except one, and it is the
// one a person actually reaches for: **you leave a planet by pressing Escape.**
// Flight has been in the walker since §M4 and the sky has been overhead since
// §M2, and if you fly straight up you do not leave — you hit an invisible
// clamp at the tile's edge and hover there. The ascent is a menu action on a
// world you are standing in, which is precisely the cut the invariant forbids,
// and it has been shipping since the surface scale existed.
//
// So: fly up, and the ground lets go.
//
// ---------------------------------------------------------------------------
// The altitude is derived, not chosen
//
// The obvious way to write this is a constant — "release at 900 m" — and it
// would work and it would be wrong in the way §11's "PBR instinct" note is
// about: a number that looks arbitrary because it is.
//
// There is a real altitude here and it is a property of the *lens and the
// tile*, not of taste. The surface is a finite square, `EXT` metres on a side.
// Looking down through a camera with a vertical field of view `fov`, the ground
// fills the frame only while
//
//     half-extent / altitude  >  tan(fov / 2)
//
// Above that the tile's own edge enters the picture — you can see where the
// world stops. That is the altitude at which the surface scale stops being an
// honest photograph of a planet, and therefore exactly the altitude at which
// something else should be drawing it:
//
//     h_release = (EXT / 2) / tan(fov / 2)
//
// For AEON's 1400 m tile at §M4's 52° lens that is **1435 m**. Nobody picked
// it. Widen the tile or change the lens and it moves on its own, which is the
// property that makes it a law rather than a magic number — and it means a
// mobile tier running a different FOV releases at its own correct altitude
// without a second constant to keep in step.
//
// ---------------------------------------------------------------------------
// Three things that stop it firing when it should not
//
// A bare altitude test is a trapdoor. All three of these are failure modes you
// would find by playing for ten minutes, and all three are cheap:
//
//   · **You have to be going up.** A world can have a 1600 m mountain on it,
//     and walking to the summit is not a request to leave. The trigger needs a
//     climb rate, not just a height — so it is `alt > h_release` **and**
//     `climb > 0`, which a mountaintop never satisfies.
//
//   · **Hysteresis.** Hovering exactly at the line would otherwise fire, land,
//     fire, land, once per frame. The release arms at `h_release` and disarms
//     only after falling back below `h_release · (1 − HYST)`, so the band has
//     width and crossing it is an event rather than a state.
//
//   · **You have to be under power.** This one was got wrong first and the
//     suite caught it. The reasoning was that a dwell would separate a jump
//     from a climb, because a ballistic arc decelerates at `g` and cannot
//     sustain a rise — which is true on Earth and false everywhere interesting.
//     A 400 m leap on Luna leaves at 36 m/s and takes **twenty-two seconds** to
//     fall below a walking pace. No dwell short enough to feel responsive can
//     tell that from powered flight, and a dwell long enough to try would make
//     leaving a planet feel like arguing with it.
//
//     The real distinction is not how long the climb lasts, it is what is
//     paying for it. A jump is ballistic; flight is thrust. The controller
//     already knows which — so the trigger reads that, and the dwell stays on
//     as what it actually is: a debounce, not a physics test.
//
// ---------------------------------------------------------------------------
// And it hands over what it was carrying
//
// §M5's gate says *"camera inherits velocity"*, and the reason is §2.5 again: a
// hyperzoom that starts from rest after a body that was doing 200 m/s is a cut
// with a crossfade over it. `handoff()` below converts the body's velocity into
// the frame the scale above uses, so the ascent begins at the speed the climb
// ended at.
//
// Nothing here imports three and nothing reads a clock, so the whole law is
// under test in `tools/verify.js` rather than being something you have to fly
// to find out about.

/**
 * The altitude at which the ground stops filling the lens.
 *
 * `extent` is the tile's full width in metres, `fovDeg` the camera's *vertical*
 * field of view. Returns metres above the local ground.
 */
export function releaseAltitude(extent, fovDeg) {
  const half = Math.max(extent, 1) * 0.5;
  const t = Math.tan(Math.max(fovDeg, 1) * 0.5 * Math.PI / 180);
  return half / Math.max(t, 1e-6);
}

/** how far back below the line the body must fall before the trigger re-arms */
export const HYST = 0.22;
/** seconds the climb has to be sustained — longer than any ballistic arc */
export const DWELL = 0.75;
/** metres per second of climb that counts as climbing rather than drifting */
export const CLIMB_MIN = 0.5;

/** a fresh trigger, disarmed */
export const ascentState = () => ({ armed: false, held: 0, released: false });

/**
 * Step the trigger one frame.
 *
 * Pure: takes the previous state and this frame's numbers, returns the next
 * state. `released` is true on exactly the frame the ground lets go, and the
 * caller is expected to act on it once — the state stays released so a second
 * call in the same frame cannot fire twice.
 *
 * `alt` is metres above local ground, `climb` is the body's vertical velocity
 * in m/s, `release` is `releaseAltitude()` for this tile and lens, and
 * `powered` is whether the body is under thrust rather than in an arc.
 */
export function stepAscent(prev, { alt, climb, release, dt, powered = true, enabled = true }) {
  const s = { armed: prev.armed, held: prev.held, released: false };
  // Not under power is not a request to leave, however fast the body is rising.
  // This is the clause that distinguishes a leap from a departure, and it does
  // it without asking how long either one lasts.
  if (!enabled || !powered || !(release > 0)) return { ...s, armed: false, held: 0 };

  // the band: arm above the line, disarm only well below it
  if (alt >= release) s.armed = true;
  else if (alt < release * (1 - HYST)) { s.armed = false; s.held = 0; }

  // and the dwell, which is what separates a climb from an arc
  if (s.armed && climb > CLIMB_MIN) s.held = prev.held + Math.max(dt, 0);
  else s.held = 0;

  if (s.held >= DWELL) { s.released = true; s.held = 0; s.armed = false; }
  return s;
}

/**
 * How close the body is to leaving, 0 to 1 — for the HUD, and for anything
 * that wants to start reacting before the handover rather than at it.
 *
 * Deliberately a *blend* of the two conditions rather than the altitude alone:
 * a body sitting above the line and not climbing reads 0, which is what a
 * mountaintop should read.
 */
export function ascentFraction(state, { alt, climb, release }) {
  if (!(release > 0)) return 0;
  const h = Math.min(Math.max(alt / release, 0), 1);
  const c = climb > CLIMB_MIN ? Math.min(state.held / DWELL, 1) : 0;
  return state.armed ? Math.max(h * 0.5 + c * 0.5, h * 0.5) : h * 0.5;
}

/**
 * The body's velocity, in the frame the scale above will use.
 *
 * `up` must be the normal **in the same frame the velocity is in**. That reads
 * as obvious and is the one thing here that has already gone wrong: the surface
 * scale's axes are local, with `+y` up at the landing site by construction, so
 * its `up` is `[0, 1, 0]` — while the site's normal in *planet* space is a
 * different vector entirely. Mixing them returns a plausible number on every
 * world and the correct one on none, and the tell was a straight-up 60 m/s
 * climb reporting 6.7 m/s of climb.
 *
 * The decomposition is returned labelled rather than as a bare vector for the
 * same reason: rotating it into another frame needs that frame's full basis,
 * and the caller is the only thing that has one.
 *
 * Returned in metres per second, unscaled: the caller knows its own units and
 * this function refuses to guess at them, because a silent scale factor here is
 * a camera that leaves at either a crawl or a blur and looks correct in code.
 */
export function handoff(vel, up) {
  const climb = vel.x * up[0] + vel.y * up[1] + vel.z * up[2];
  return {
    climb,
    // whatever is left after the climb is taken out is the lateral drift, and
    // it is what makes an ascent lean instead of going straight up like a lift
    lateral: [
      vel.x - up[0] * climb,
      vel.y - up[1] * climb,
      vel.z - up[2] * climb,
    ],
    speed: Math.hypot(vel.x, vel.y, vel.z),
  };
}
