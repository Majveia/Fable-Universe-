// The figure — CLAUDE.md §4, §M4, and the one clause of §4 the human overrode.
//
// What stands here today is five primitives: a cone, a sphere, a cone, a plane
// and a sprite. It reads at fifteen metres and it reads as five primitives at
// three, and §8's first axis asks for a *"readable subject at three
// distances"*, which is one out of three.
//
// §4 says **"No photoreal humanoid characters. Figures are silhouettes and
// scale references."** That clause survives here intact, and this module is
// written against it rather than around it, because the two halves of it point
// in opposite directions and only one of them was ever the constraint:
//
//   · *photoreal* is genuinely forbidden and genuinely impossible — §2.1 bans
//     the scan, the rig, the skin texture and the hair card, and nothing in
//     this file would be improved by having them
//   · *silhouette* is not a limitation. It is the brief. A silhouette is what
//     §8 axis 1 scores, it is the whole of what a figure at forty metres in
//     valley haze can be, and the most recognisable characters in any medium
//     are recognisable in black at thumbnail size. The reference agrees by
//     construction: its far ridges are *"pure haze, pure shape."*
//
// So: a figure with a *designed* silhouette, generated, at zero bytes. Not a
// person rendered accurately — a person **drawn well**, which is a harder
// problem and the right one.
//
// ---------------------------------------------------------------------------
// 1 · The proportions are canon, and the canon is measured
//
// Every length below is in head-heights, and the figure is eight of them. That
// is not a stylisation: it is the artists' canon, it has been the canon since
// Polykleitos, and it is what the eye checks first. A figure whose head is a
// tenth of it reads as heroic and slightly inhuman; a figure at six reads as a
// child. Eight is the one that reads as *someone*.
//
// The internal divisions come from the same place and are stated as fractions
// of stature so they scale to any world's spawn height:
//
//     crown        1.000        shoulder width  0.259
//     chin         0.870        hip width       0.191
//     shoulder     0.818        upper arm       0.186
//     nipple       0.720        forearm         0.146
//     navel        0.593        thigh           0.245
//     hip          0.530        shank           0.246
//     knee         0.285        foot length     0.152
//     ankle        0.039
//
// These are Drillis & Contini's segment fractions, the ones every gait lab and
// every crash-test model uses, and they are here rather than eyeballed for the
// same reason `magnetosphere.js` computes its oval: the eye is extremely good
// at spotting a wrong femur and extremely bad at saying why.
//
// ---------------------------------------------------------------------------
// 2 · The silhouette is the design, and it is four decisions
//
// Everything cool about a figure at distance is in its outline, and an outline
// has room for about four ideas before it turns to mush. These are the four:
//
//   **A long coat that breaks at the knee.** The single most load-bearing
//   shape. It gives the figure one continuous vertical from shoulder to shin,
//   it hides the leg geometry exactly where procedural legs look worst, and it
//   is the shape that reads at any distance — it is why the ronin, the
//   gunslinger, the duster, the greatcoat and the long coat recur across every
//   medium that has ever needed a figure to be legible from behind.
//
//   **A raised collar and a hood that is down.** The head reads as a head
//   because the collar frames it. A raised collar also solves the neck, which
//   is the second-worst thing to generate.
//
//   **Asymmetry, once.** A single strap crossing the chest, on a side chosen
//   by the seed. One asymmetry makes a figure look intentional; two make it
//   look cluttered, and none makes it look like a mannequin.
//
//   **Hands and feet that are dark.** Value, not detail. Terminating the limbs
//   in a darker tone reads as gloves and boots, gives the silhouette its
//   punctuation, and costs one colour.
//
// What is deliberately absent: a face, fingers, hair strands, buckles, and any
// surface detail that would be sub-pixel at the distance a third-person camera
// actually sits (4.6 m per §M4, where the whole figure is about 380 px tall on
// a 1440p frame and a knuckle is one).
//
// ---------------------------------------------------------------------------
// 3 · The coat is cloth, and cloth samples the one wind field
//
// §6 M3's thesis names the consumers: *"grass, foliage, dust, spores, cloth,
// water ripple, cloud advection, smoke."* Cloth is on that list and this is the
// only cloth in the project.
//
// The coat's skirt is a cylinder of vertices free below the hip, and each one
// is displaced by three things summed in the vertex shader:
//
//   · the wind, sampled once per figure per frame on the CPU and passed as a
//     uniform — one sample, because a coat is 1.1 m across and the field's
//     smallest gust cell is 260 m, so sampling it per-vertex would cost
//     forty lookups to compute forty copies of the same number
//   · the figure's own motion, as the negative of its velocity: a coat trails,
//     and a coat that trails is the difference between walking and gliding
//   · a travelling ripple along the hem, phase-locked to the **gait clock**
//
// That last one is §M4's rule and it is why this file takes a `gait` object
// rather than a time. *"One phase drives head bob, footstep audio, and the
// grass the walker parts, so they can never drift out of sync."* The figure
// standing in for that walker has to be on the same phase or the coat swings
// on a beat the footsteps are not on — and the current figure does exactly
// that, bobbing on `sin(t · 7.5)` with a hard-coded 7.5 while the walker's
// cadence is `0.58 + 0.34·v`. At 3.45 m/s those are 1.19 Hz and 1.75 Hz. They
// beat against each other every 1.8 seconds, forever.
//
// ---------------------------------------------------------------------------
// 4 · The pose is solved, not keyframed
//
// §M4: *"Locomotion blends procedurally — no keyframed assets."*
//
// The arms and the torso are sinusoids on the gait phase, which is all they
// need to be. The legs are not, and the first version of this file is the
// argument for why: two sines on the thigh and the knee produced a figure
// whose feet **never touched the ground** — lowest point five millimetres
// below its own swing, and both feet in the air for a quarter of every cycle.
// It marched. Every proportion in it was canon and it still read as wrong,
// because the one thing the eye actually checks in a walk is whether the foot
// stays where it was put.
//
// So the causality is inverted. The **foot** is authored and the leg is solved:
//
//   · in **stance** the foot is on the ground and stationary *in the world*,
//     which in the body's frame means sliding backwards at exactly walking
//     speed — no slip is possible, because the contact point is the
//     independent variable rather than a consequence
//   · in **swing** it arcs forward over the same ground, rising by a third of
//     its half-excursion, which is a shape rather than a height and so scales
//     with stature and speed without a second constant
//   · the **duty factor** — how much of the cycle a foot is down — is 0.62 at
//     a walk and falls to 0.34 as the Froude number passes 0.5. That is the
//     walk-run transition, it is 0.5 on every world including the Moon, and
//     nothing scripts it: double support and the float phase are `2·duty − 1`
//     changing sign. Measured on the built figure: 24% double support and no
//     airborne frames at 1.2 m/s, 0% and 32% at 3.45.
//   · and the **hips fall out**. A planted foot half a step ahead is further
//     from the hip than one underneath it, so the hip must drop to reach it,
//     by `L − sqrt(L² − z²)`. That is the compass gait and it is the real
//     reason walking bobs — so the head bob is now a consequence of the step
//     length rather than a sine tuned to look like one.
//
// The compass over-predicts that bob about twofold, and the reason has a name:
// the *determinants of gait*. A real pelvis rotates and lists and a real stance
// knee stays flexed through mid-stance, and together they flatten the hip's arc
// without shortening the step. Only one of those needs simulating and it is
// free — drop the hip **less** than the compass demands and the solve has no
// choice but to bend the stance knee to keep the foot where it was put. The
// mechanism is the fix. Measured: 4.7 cm of bob at a walk against a textbook
// 4–5, where the raw compass wanted 8.5.
//
// ---------------------------------------------------------------------------
// 5 · What it costs
//
// One `BufferGeometry`, one draw call, built once per world. About 2,400
// triangles at the top tier and 900 at the bottom — against §5's 2.2 M budget
// it is a rounding error, and it is one call of the 900. The per-frame cost is
// eighteen matrix composes and one wind sample; the coat is displaced on the
// GPU.
//
// It is one mesh rather than eighteen because a figure is one thing and
// eighteen `Object3D`s would be eighteen draw calls and eighteen chances for
// the aerial-perspective injection to be applied to seventeen of them.

// Nothing here imports three, on purpose, and it is the same reason
// `score.js` and `magnetosphere.js` do not: the interesting claims are
// geometric — that a heel never passes through the ground, that a shoulder
// stays inside the coat, that the canon holds at every stature — and a claim
// you can only check by looking at a screenshot is not under test. So the
// geometry comes out as plain typed arrays and the skeleton as a flat
// column-major `Float32Array`, which is what `mat4[]` wants anyway; the
// caller wraps them in a `BufferGeometry` and a `ShaderMaterial` and that is
// the entire three-facing surface.
import { RNG, hash } from './rng.js';

/**
 * Knee flexion at mid-stance — the second determinant of gait, and about 20°
 * in every gait lab that has ever measured it. It is the only reason a human
 * hip does not trace the full compass arc, and it is the only part of that
 * mechanism worth simulating: it acts at the top of the arc, where nothing
 * depends on it, rather than at the extremes, where the foot does.
 */
export const STANCE_KNEE_FLEX = 20 * Math.PI / 180;

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// --- the twenty lines of linear algebra this needs, rather than the library
//
// Column-major, `m[col * 4 + row]`, because that is what a GLSL `mat4` uniform
// is and a transpose in the middle is a bug waiting for a rest pose to be
// asymmetric enough to reveal it.

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);

/** translation + an Euler in YXZ, the order three uses and the camera uses */
export function compose(out, o, tx, ty, tz, rx, ry, rz) {
  const ca = Math.cos(rx), sa = Math.sin(rx);
  const cb = Math.cos(ry), sb = Math.sin(ry);
  const cc = Math.cos(rz), sc = Math.sin(rz);
  out[o + 0] = cb * cc + sb * sa * sc; out[o + 1] = ca * sc; out[o + 2] = cb * sa * sc - sb * cc; out[o + 3] = 0;
  out[o + 4] = sb * sa * cc - cb * sc; out[o + 5] = ca * cc; out[o + 6] = sb * sc + cb * sa * cc; out[o + 7] = 0;
  out[o + 8] = sb * ca; out[o + 9] = -sa; out[o + 10] = cb * ca; out[o + 11] = 0;
  out[o + 12] = tx; out[o + 13] = ty; out[o + 14] = tz; out[o + 15] = 1;
  return out;
}

/** `dst[d] = a[i] · b[j]`, all column-major, all in one flat array */
export function mul(dst, d, a, i, b, j) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[j + c * 4], b1 = b[j + c * 4 + 1], b2 = b[j + c * 4 + 2], b3 = b[j + c * 4 + 3];
    for (let r = 0; r < 4; r++) {
      dst[d + c * 4 + r] = a[i + r] * b0 + a[i + 4 + r] * b1 + a[i + 8 + r] * b2 + a[i + 12 + r] * b3;
    }
  }
  return dst;
}

/** a point through a matrix in the same array */
export function apply(m, i, x, y, z) {
  return [
    m[i] * x + m[i + 4] * y + m[i + 8] * z + m[i + 12],
    m[i + 1] * x + m[i + 5] * y + m[i + 9] * z + m[i + 13],
    m[i + 2] * x + m[i + 6] * y + m[i + 10] * z + m[i + 14],
  ];
}

/**
 * The canon, in fractions of stature. Drillis & Contini (1966) for the
 * segment lengths; the eight-head division for the vertical stations.
 */
export const CANON = {
  head: 0.1250,          // crown to chin — the module the rest is counted in
  chin: 0.8700,
  shoulderY: 0.8180,
  chestY: 0.7200,
  waistY: 0.5930,
  hipY: 0.5300,
  kneeY: 0.2850,
  ankleY: 0.0390,
  shoulderW: 0.2590,     // acromion to acromion
  hipW: 0.1910,
  upperArm: 0.1860,
  forearm: 0.1460,
  thigh: 0.2450,
  shank: 0.2460,
  foot: 0.1520,
};

/** §M4's third-person distance, and the reason nothing here has surface detail */
export const VIEW_DIST = 4.6;

/**
 * The gait, as four numbers on one phase.
 *
 * `phase` is `Walker.stepPhase` — cycles, not radians, and one cycle is two
 * footfalls. Taking it rather than a clock is the whole of §M4's "they can
 * never drift out of sync": there is nothing here to drift from.
 *
 * `amp` saturates at the row's own `bobSat` so a `?flow=1` body running at
 * 5.87 m/s does not swing its arms 1.7× further than a body at 3.45 — it
 * swings them at the same *fraction* of its own top speed, which is what a
 * faster gait actually looks like.
 */
export function gaitPose(phase, speed, sat = 3.6, airborne = 0) {
  const a = Math.min(speed / Math.max(sat, 0.1), 1);
  const p = phase * Math.PI * 2;
  const s = Math.sin(p), c = Math.cos(p);
  // in the air the limbs stop striding and tuck — one blend, not a second pose
  const g = 1 - airborne;
  return {
    // The arms are filled in by `poseFor` from the *solved* thigh angles rather
    // than from a sine of their own, so contralateral swing is true by
    // construction and cannot drift when the gait's shape changes. In phase it
    // reads as a marionette, and that is the only thing anyone notices.
    armL: 0, armR: 0,
    elbowL: (0.22 + Math.max(s, 0) * 0.34) * a * g + 0.15,
    elbowR: (0.22 + Math.max(-s, 0) * 0.34) * a * g + 0.15,
    // the torso counter-rotates against the pelvis — small, and the frame
    // looks dead without it
    twist: c * 0.10 * a * g,
    lean: Math.min(speed * 0.020, 0.13) * g,
    amp: a,
    // the legs are not here. See `legPose` — they are solved, and the hip
    // height falls out of the solve rather than being a sine laid over it.
    airborne,
  };
}

/**
 * Where each foot is, and therefore where the hips must be.
 *
 * This is the part a sinusoid cannot do, and the first version of this file
 * proved it: swinging the thigh and bending the knee on two sines produced a
 * figure whose feet never touched the ground — lowest point 5 mm below the
 * swing, both feet airborne a quarter of every cycle. It marched. Everything
 * else about it was right and it still read as wrong, because the one thing
 * the eye actually checks in a walk is whether the foot stays where it was put.
 *
 * So the foot is authored and the leg is solved:
 *
 *   **Stance.** The foot is on the ground and *stationary in the world*. In the
 *   figure's own frame that means it slides backwards at exactly the walking
 *   speed, from half a step in front to half a step behind. No sliding is
 *   possible because there is nothing to slide — the contact point is the
 *   independent variable.
 *
 *   **Swing.** It arcs forward over the same distance, rising a sixth of the
 *   step length at the top. One constant, and it is a shape rather than a
 *   height, so it scales with stature and with speed on its own.
 *
 *   **Duty factor** — the fraction of the cycle a foot is down — is 0.62 at a
 *   walk and falls toward 0.34 as the Froude number climbs past 0.5, which is
 *   the walk-run transition and is where a real gait stops having a
 *   double-support phase at all. Below it, both feet are down for a quarter of
 *   the cycle and the figure is never airborne; above it, neither is, and it is.
 *   The transition is not scripted anywhere. It is `2·duty − 1` changing sign.
 *
 *   **The hips fall out.** A planted foot half a step ahead is further from the
 *   hip than a planted foot underneath it, so the hip has to drop to reach it —
 *   by exactly `L − sqrt(L² − z²)`. That is the compass gait, it is the real
 *   reason walking bobs, and it means the head bob is now a consequence of the
 *   step length rather than a sine that has to be tuned to look like one.
 */
export function legPose(phase, speed, dims, gravity = 9.81, cadence = 0) {
  const legL = dims.thigh + dims.shank;
  const stature = dims.stature || 1.78;
  // Froude number on the leg — dimensionless, so it says the same thing on
  // every world. 0.5 is the walk-run transition, and it is 0.5 on the Moon too,
  // at a speed a third of Earth's, which is why the Apollo footage lopes.
  const fr = (speed * speed) / Math.max(gravity * legL, 1e-6);
  // The stride is the distance between two contacts of the *same* foot, so it
  // is one full cycle of body travel — `cadence` is cycles per second, and the
  // two footfalls in a cycle belong to different feet.
  const stride = cadence > 1e-3 ? speed / cadence : 0;
  // The foot only slides backward for the part of the cycle it is *down*, so
  // its excursion in the body's frame is a fraction `duty` of the stride and
  // not the whole of it. Getting that wrong makes the stance foot travel
  // further than the body did, so it slips — 107 mm per stride, a figure
  // skating rather than walking, and the first version of this did exactly it.
  let duty = clamp(0.62 - 0.28 * smoothstep(0.30, 0.95, fr), 0.34, 0.62);
  // And the leg has a reach. When the stride is longer than the leg can cover
  // in that fraction, the answer is **not** to clamp the excursion — a clamped
  // foot is a sliding foot, which is the bug this whole solve exists to remove.
  // It is to shorten the stance: a body outrunning its own legs picks the foot
  // up earlier and spends longer in swing, which is what running *is*. So the
  // reach limit lands on `duty`, and the excursion is always exactly reachable.
  const REACH = 0.5;                    // of leg length, half the excursion
  const maxDuty = stride > 1e-6 ? (2 * legL * REACH) / stride : 1;
  const reached = maxDuty < duty;
  duty = Math.max(Math.min(duty, maxDuty), 0.02);
  const half = stride * duty * 0.5;
  const lift = half * 0.32;
  const out = { duty, stride, fr, airborne: 0, reach: reached };

  // How much of the cycle both feet are down. Above the walk-run transition
  // this goes negative and there is a float phase instead; below it, it is the
  // double-support interval, and it is where the hip's problem lives.
  const overlap = Math.max(2 * duty - 1, 0);
  const ov = duty > 1e-6 ? overlap / duty : 0;

  // The residual this leaves is one 37 mm step in the hip's demand at each
  // touchdown — the incoming foot lands at full extension while the outgoing
  // one is still short of its own — which drags the outgoing foot by 67 µm on
  // the single frame it happens. What removes it for real is the heel-and-toe
  // rocker: a real foot lands on its heel *ahead* of the ankle and leaves over
  // its toe *behind* it, so the ankle's excursion is shorter than the contact
  // point's by most of a foot length, and the two demands meet. That is a
  // second joint per leg and it is not here. 67 µm against the 107 mm this
  // replaced is the right place to stop, and this paragraph is what stops the
  // next reader from rediscovering the average.
  let wSum = 0, dSum = 0;
  for (const [foot, off] of [['L', 0], ['R', 0.5]]) {
    const u = (phase + off) % 1;
    let z, y, down, w = 0;
    if (u < duty) {                       // stance: planted, sliding back
      const t = u / duty;
      z = (1 - 2 * t) * half;
      y = 0;
      down = 1;
      // The hip is one point and both legs hang off it, so in double support
      // it has to answer **the deeper of the two demands** — not the average,
      // and that is worth writing down because the average is the appealing
      // answer and it fails in a way that looks like success. Weighting each
      // foot by the load it carries makes the hip's path beautifully smooth
      // (a 37 mm step at touchdown becomes 0.45 mm) and un-plants the more
      // extended foot by 39 mm, because a hip that has dropped the average
      // distance cannot reach the further foot at all. Reachability is not a
      // quantity to be traded against smoothness. It is a constraint.
      w = 1;
      wSum = 1;
      dSum = Math.max(dSum, legL - Math.sqrt(Math.max(legL * legL - z * z, 0)));
    } else {                              // swing: forward, over the same ground
      const t = (u - duty) / (1 - duty);
      z = (2 * t - 1) * half;
      y = Math.sin(Math.PI * t) * lift;
      down = 0;
    }
    out[foot] = { z, y, down, load: w };
  }
  const compass = wSum > 0 ? dSum / wSum : 0;
  out.airborne = out.L.down + out.R.down === 0 ? 1 : 0;
  // The compass drop is not negotiable — it is the distance the hip has to
  // come down for the stance leg to *reach* a foot it has already put on the
  // ground, and taking any less of it hands `twoBone` a target outside its own
  // reach, which it answers by straightening the chain and letting the foot
  // hover four centimetres up. Reducing this was the obvious way to flatten
  // the bob and it silently un-planted the foot the whole solve exists to
  // plant. It is the fix that undoes the feature.
  //
  // The flattening comes from the other end instead: a real stance knee stays
  // about 20° flexed through mid-stance — the second determinant of gait —
  // which lowers the hip *at the top of its arc* and nowhere else. Added here
  // as a term that is largest at mid-stance and exactly zero at the extremes,
  // so it can flatten the arc and can never reach into the part of it the foot
  // depends on.
  const flex = legL * (1 - Math.cos(STANCE_KNEE_FLEX * 0.5));
  const peak = legL - Math.sqrt(Math.max(legL * legL - half * half, 0));
  out.drop = compass + flex * (1 - Math.min(compass / Math.max(peak, 1e-9), 1));
  out.compass = compass;
  out.legL = legL;
  out.stature = stature;
  return out;
}

/**
 * Solve one leg to its foot target and write the two angles the rig wants.
 *
 * The chain is planar — a leg does not need a third degree of freedom to walk —
 * so once `twoBone` has placed the knee, both angles are an `atan2`. Positive
 * `rx` swings the limb backwards, which is what the rest pose's local −y makes
 * it; the test asserts that rather than the comment.
 */
export function solveLeg(dims, hipY, footZ, footY, sideX = 0) {
  const H = [sideX, hipY, 0];
  const F = [sideX, footY + dims.ankleY, footZ];
  // the knee bends forward, always — a knee that can pick the other solution is
  // a knee that will, on one frame in a thousand, and it will be memorable
  const K = twoBone(H, F, dims.thigh, dims.shank, [0, 0, 1]);
  const thigh = Math.atan2(-(K[2] - H[2]), -(K[1] - H[1]));
  const shin = Math.atan2(-(F[2] - K[2]), -(F[1] - K[1]));
  // the rig's knee angle is measured from the thigh, not from vertical
  return { thigh, knee: shin - thigh, K };
}

/**
 * The whole pose for one frame: the arms and torso from the gait clock, the
 * legs from the solve, and the hip drop the solve demanded.
 *
 * One entry point so a caller cannot get half of it, which is the failure mode
 * a two-function version invites — arms swinging on a phase the legs are not on
 * is precisely the drift §M4 exists to forbid.
 */
export function poseFor(dims, { phase = 0, speed = 0, cadence = 0, sat = 3.6,
  gravity = 9.81, grounded = true, headYaw = 0, headPitch = 0 } = {}) {
  const leg = legPose(phase, speed, dims, gravity, cadence);
  // A body actually off the ground is a different thing from the float phase of
  // a run: the run's float is part of the stride and keeps its shape, while a
  // jump has no stride at all and the legs tuck. `air` is the second one.
  const air = grounded ? 0 : 1;
  const p = gaitPose(phase, speed, sat, air);
  const hipY = dims.hipY - leg.drop;
  const sx = dims.hipW * 0.42;
  const L = solveLeg(dims, hipY, leg.L.z, leg.L.y, -sx);
  const R = solveLeg(dims, hipY, leg.R.z, leg.R.y, sx);
  const tuck = air * 0.9;
  p.thighL = L.thigh * (1 - air) - tuck * 0.55;
  p.thighR = R.thigh * (1 - air) - tuck * 0.55;
  p.kneeL = L.knee * (1 - air) + tuck * 1.15;
  p.kneeR = R.knee * (1 - air) + tuck * 1.15;
  // Contralateral, and driven by where the opposite **foot** is rather than by
  // the thigh angle above it. That distinction was not obvious and cost a
  // failing check to find: a swing thigh reads as *forward* through most of
  // swing, because the knee leads while the foot is still behind, so arms
  // taken from thigh angles end up swinging together for half the cycle — the
  // marionette this is supposed to avoid. The foot's fore-aft position is both
  // the thing an observer actually reads and antiphase by construction, since
  // the two feet are half a cycle apart no matter what shape the gait takes.
  //
  // ±0.5 rad at full stride, which is an arm swing.
  const swing = 0.5 * (1 - air);
  p.armL = -swing * (leg.R.z / Math.max(leg.stride * leg.duty * 0.5, 1e-6)) + air * 0.35;
  p.armR = -swing * (leg.L.z / Math.max(leg.stride * leg.duty * 0.5, 1e-6)) + air * 0.35;
  p.rise = -leg.drop * (1 - air);
  p.headYaw = headYaw;
  p.headPitch = headPitch;
  p.duty = leg.duty;
  p.stride = leg.stride;
  p.fr = leg.fr;
  p.contacts = leg.L.down + leg.R.down;
  return p;
}

/**
 * The elbow (or knee) of a two-link chain, in closed form.
 *
 * Given a root, a target, two bone lengths and a pole direction, the middle
 * joint lies on a circle; the pole picks the point on it. If the target is out
 * of reach the chain straightens toward it rather than failing — which is the
 * correct behaviour and the reason this is not an iterative solver.
 */
export function twoBone(root, target, l1, l2, pole) {
  const raw = sub3(target, root);
  const rawLen = len3(raw);
  if (rawLen < 1e-5) return root.slice(0, 3);
  const d = Math.min(rawLen, (l1 + l2) * 0.999);
  const dir = [raw[0] / rawLen, raw[1] / rawLen, raw[2] / rawLen];
  // the foot of the perpendicular from the joint onto the root→target line
  const a = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(l1 * l1 - a * a, 0));
  // the pole, orthogonalised against the chain, is the direction the bend goes
  const k = dot3(pole, dir);
  let up = [pole[0] - dir[0] * k, pole[1] - dir[1] * k, pole[2] - dir[2] * k];
  let ul = len3(up);
  if (ul < 1e-5) {
    // The pole is parallel to the chain, so it says nothing about which way to
    // bend. Cross with whichever axis the chain is *least* aligned to — the
    // obvious fallbacks are not safe, because a chain pointing straight down
    // +z and a fallback of +z are the same degenerate case again, which is
    // exactly the one that produced a 32 cm bone.
    const ax = Math.abs(dir[0]) < Math.abs(dir[1])
      ? (Math.abs(dir[0]) < Math.abs(dir[2]) ? [1, 0, 0] : [0, 0, 1])
      : (Math.abs(dir[1]) < Math.abs(dir[2]) ? [0, 1, 0] : [0, 0, 1]);
    up = [
      dir[1] * ax[2] - dir[2] * ax[1],
      dir[2] * ax[0] - dir[0] * ax[2],
      dir[0] * ax[1] - dir[1] * ax[0],
    ];
    ul = len3(up) || 1;
  }
  return [
    root[0] + dir[0] * a + (up[0] / ul) * h,
    root[1] + dir[1] * a + (up[1] / ul) * h,
    root[2] + dir[2] * a + (up[2] / ul) * h,
  ];
}

// ---------------------------------------------------------------------------
// geometry
//
// Everything is built into one non-indexed position/normal/uv/attribute set,
// in a local space where the figure is `stature` tall and stands on y = 0.
// Parts are tagged by a `bone` attribute so the vertex shader can transform
// them: an eighteen-bone skin, with the skinning done by a uniform array of
// matrices rather than by three.js's `SkinnedMesh`, because a skeleton whose
// bind pose is generated has nothing to load and no reason to carry the rest
// of the skinning machinery.

/**
 * Material ids, carried per vertex in `aMat` and branched on in one fragment
 * shader — a figure is one draw call, and four `MeshStandardMaterial`s would
 * be four of them plus four chances for the aerial injection to reach three.
 */
export const MAT = { BODY: 0, COAT: 1, SKIN: 2, BOOT: 3, STRAP: 4 };

/** bone ids — the vertex shader indexes `uBones` with these */
export const BONE = {
  ROOT: 0, PELVIS: 1, SPINE: 2, CHEST: 3, NECK: 4, HEAD: 5,
  SHOULDER_L: 6, UPPER_L: 7, FORE_L: 8, HAND_L: 9,
  SHOULDER_R: 10, UPPER_R: 11, FORE_R: 12, HAND_R: 13,
  THIGH_L: 14, SHANK_L: 15, FOOT_L: 16,
  THIGH_R: 17, SHANK_R: 18, FOOT_R: 19,
  COAT: 20,
};
export const BONE_COUNT = 21;

/**
 * A tapered capsule along +y, in the local space of its bone.
 *
 * `sides` and `rings` are the tier's, and the shape is a superellipse in cross
 * section rather than a circle — `|x|^n + |z|^n = 1` at n ≈ 2.6, which is what
 * a limb actually is and what stops an arm reading as a pipe.
 */
function limb(out, bone, len, r0, r1, sides, rings, mat, xf = null, squash = 1, dir = 1) {
  const N = 2.6;
  const ring = (t) => {
    const pts = [];
    const r = r0 + (r1 - r0) * t;
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      // superellipse, unit-normalised
      const k = Math.pow(Math.pow(Math.abs(ca), N) + Math.pow(Math.abs(sa), N), -1 / N);
      pts.push([ca * k * r * squash, t * len * dir, sa * k * r]);
    }
    return pts;
  };
  const rows = [];
  for (let j = 0; j <= rings; j++) rows.push(ring(j / rings));
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < sides; i++) {
      const i2 = (i + 1) % sides;
      quad(out, rows[j][i], rows[j][i2], rows[j + 1][i2], rows[j + 1][i], bone, mat, xf);
    }
  }
  // caps, so the silhouette closes — a limb open at the end reads as a hole
  // exactly where the aerial perspective is brightest
  cap(out, rows[0], [0, 0, 0], bone, mat, xf, true);
  cap(out, rows[rings], [0, len * dir, 0], bone, mat, xf, false);
}

function cap(out, ring, centre, bone, mat, xf, flip) {
  for (let i = 0; i < ring.length; i++) {
    const i2 = (i + 1) % ring.length;
    tri(out, centre, flip ? ring[i2] : ring[i], flip ? ring[i] : ring[i2], bone, mat, xf);
  }
}

function push(out, v, bone, mat, xf) {
  const p = xf ? apply(xf, 0, v[0], v[1], v[2]) : v;
  out.pos.push(p[0], p[1], p[2]);
  out.bone.push(bone);
  out.mat.push(mat);
}

function tri(out, a, b, c, bone, mat, xf) {
  push(out, a, bone, mat, xf); push(out, b, bone, mat, xf); push(out, c, bone, mat, xf);
}

function quad(out, a, b, c, d, bone, mat, xf) {
  tri(out, a, b, c, bone, mat, xf);
  tri(out, a, c, d, bone, mat, xf);
}

/**
 * The coat, which is the silhouette.
 *
 * A skirt from the chest to just below the knee, flaring as it falls, with a
 * front opening so it reads as a coat rather than a dress. Its vertices carry
 * a `free` weight in the uv's second channel — zero at the shoulder, one at
 * the hem — and the vertex shader uses that to decide how much of the wind and
 * the trail each one gets. That weight is the whole cloth simulation: a hem
 * that swings and a collar that does not is 95% of what cloth reads as, at
 * 0% of the cost of solving one.
 */
function coat(out, s, sides, rings, seed) {
  const top = s.chestY, bot = s.kneeY - 0.06;
  const open = 0.34;              // radians of the front opening, half-angle
  const rTop = s.shoulderW * 0.60, rBot = s.shoulderW * 0.92;
  for (let j = 0; j < rings; j++) {
    const t0 = j / rings, t1 = (j + 1) / rings;
    for (let i = 0; i < sides; i++) {
      const a0 = -Math.PI + ((i + 0.0) / sides) * Math.PI * 2;
      const a1 = -Math.PI + ((i + 1.0) / sides) * Math.PI * 2;
      // the front opening — the two panels stop short of meeting
      if (Math.abs(a0) < open && Math.abs(a1) < open) continue;
      const P = (t, a) => {
        const y = top + (bot - top) * t;
        // the flare is cubic, so the coat hangs straight and then breaks —
        // a linear flare reads as a cone, which is what is standing there now
        const r = rTop + (rBot - rTop) * (t * t * t * 0.55 + t * 0.45);
        return [Math.sin(a) * r, y, Math.cos(a) * r * 1.12];
      };
      const A = P(t0, a0), B = P(t0, a1), C = P(t1, a1), D = P(t1, a0);
      // A→D→C→B rather than A→B→C→D. The obvious winding puts the outward
      // normal *inward* here: the ring runs from +z toward +x, so the cross
      // product of (along the ring) with (down the coat) points into the
      // garment, and the whole figure renders in its own lining.
      quad(out, A, D, C, B, BONE.COAT, MAT.COAT, null);
      // The free weight, per vertex, in the order `quad` pushed them — it
      // emits (A,D,C) then (A,C,B), so the sequence is not simply t0,t1,t1,t0.
      // Squared here rather than in the shader so the quartic falloff costs
      // nothing per frame.
      for (const w of [t0, t1, t1, t0, t1, t0]) out.free.push(w * w);
    }
  }
  // the collar: a short flare the other way, framing the head
  const cTop = s.chin - 0.012, cBot = s.shoulderY - 0.010;
  for (let i = 0; i < sides; i++) {
    const a0 = -Math.PI + (i / sides) * Math.PI * 2;
    const a1 = -Math.PI + ((i + 1) / sides) * Math.PI * 2;
    if (Math.abs(a0) < open * 0.9 && Math.abs(a1) < open * 0.9) continue;
    const Q = (y, a, r) => [Math.sin(a) * r, y, Math.cos(a) * r * 1.1];
    const rb = s.shoulderW * 0.30, rt = s.shoulderW * 0.42;
    quad(out, Q(cBot, a0, rb), Q(cTop, a0, rt), Q(cTop, a1, rt), Q(cBot, a1, rb),
      BONE.CHEST, MAT.COAT, null);
    for (let k = 0; k < 6; k++) out.free.push(0);
  }
  return seed;
}

/**
 * Build the figure's geometry at a given stature and tier.
 *
 * `tier` is the quality row index — 0 ultra to 3 low — and it only ever
 * changes tessellation, never proportion. §5's rule: one row change
 * reconfigures the renderer, and a figure that got *shorter* on a phone would
 * be a different figure rather than a cheaper one.
 */
export function buildFigure(stature = 1.78, tier = 1, seed = 0) {
  const r = new RNG(hash(seed >>> 0, 0xf16));
  const s = {};
  for (const k of Object.keys(CANON)) s[k] = CANON[k] * stature;
  s.stature = stature;
  const SIDES = [12, 10, 8, 6][Math.min(tier, 3)];
  const RINGS = [4, 3, 2, 2][Math.min(tier, 3)];
  const CSIDES = [20, 16, 12, 10][Math.min(tier, 3)];
  const CRINGS = [7, 6, 4, 3][Math.min(tier, 3)];

  const out = { pos: [], bone: [], mat: [], free: [] };
  const at = (x, y, z) => compose(new Float64Array(16), 0, x, y, z, 0, 0, 0);

  // -- torso. Two segments so the twist reads; the chest is wider than deep,
  //    which is the difference between a person and a barrel. The torso, the
  //    neck and the head are authored in *root* space with an absolute
  //    translation, because their bones sit at the origin; the limbs below are
  //    authored in their own bone's space, hanging along −y, because that is
  //    the direction the rest offsets chain them in. Authoring a limb along +y
  //    puts every arm and leg inside the torso, pointing at the sky, and the
  //    coat hides it well enough that the first render read as a figure with
  //    no arms rather than as a figure with its arms on backwards.
  limb(out, BONE.SPINE, s.chestY - s.hipY, s.hipW * 0.52, s.shoulderW * 0.40,
    SIDES, RINGS, MAT.BODY, at(0, s.hipY, 0), 1.28);
  limb(out, BONE.CHEST, s.shoulderY - s.chestY, s.shoulderW * 0.40, s.shoulderW * 0.36,
    SIDES, RINGS, MAT.BODY, at(0, s.chestY, 0), 1.30);
  limb(out, BONE.PELVIS, s.hipY - s.waistY * 0.86, s.hipW * 0.56, s.hipW * 0.52,
    SIDES, 2, MAT.BODY, at(0, s.waistY * 0.86, 0), 1.16);

  // -- head and neck. The head is an ovoid, longer than wide, and it is the
  //    module everything else was counted in — get it wrong and nothing reads.
  limb(out, BONE.NECK, s.chin - s.shoulderY, s.head * 0.30, s.head * 0.27,
    SIDES, 1, MAT.SKIN, at(0, s.shoulderY, 0), 1.0);
  // ...and the crown lands on `stature` exactly, because the canon is eight
  // heads and a figure 1.5% short of its own stated height is a figure whose
  // eye height, camera distance and scale reference are all 1.5% wrong.
  limb(out, BONE.HEAD, stature - (s.chin - s.head * 0.06), s.head * 0.40, s.head * 0.30,
    SIDES, RINGS + 1, MAT.SKIN, at(0, s.chin - s.head * 0.06, 0), 0.90);

  // -- arms and legs, mirrored, each hanging along −y in its own bone's space
  const DOWN = -1;
  for (const side of [-1, 1]) {
    const L = side < 0;
    limb(out, L ? BONE.UPPER_L : BONE.UPPER_R, s.upperArm,
      s.upperArm * 0.30, s.upperArm * 0.24, SIDES, RINGS, MAT.BODY, null, 1, DOWN);
    limb(out, L ? BONE.FORE_L : BONE.FORE_R, s.forearm,
      s.forearm * 0.28, s.forearm * 0.20, SIDES, RINGS, MAT.BODY, null, 1, DOWN);
    // the hand: short, dark, and no fingers — value, not detail (§2 above)
    limb(out, L ? BONE.HAND_L : BONE.HAND_R, s.head * 0.72,
      s.head * 0.20, s.head * 0.15, Math.max(SIDES - 4, 5), 1, MAT.BOOT, null, 0.62, DOWN);
    limb(out, L ? BONE.THIGH_L : BONE.THIGH_R, s.thigh,
      s.hipW * 0.34, s.hipW * 0.26, SIDES, RINGS, MAT.BODY, null, 1, DOWN);
    limb(out, L ? BONE.SHANK_L : BONE.SHANK_R, s.shank,
      s.hipW * 0.27, s.hipW * 0.16, SIDES, RINGS, MAT.BODY, null, 1, DOWN);
    // The boot: a wedge lying forward from the ankle. Rotated −90° about x,
    // which takes the limb's own −y onto +z — so it points where the figure is
    // facing rather than where its shins are.
    limb(out, L ? BONE.FOOT_L : BONE.FOOT_R, s.foot,
      s.hipW * 0.26, s.hipW * 0.17, Math.max(SIDES - 4, 5), 1, MAT.BOOT,
      compose(new Float64Array(16), 0, 0, -s.hipW * 0.10, -s.foot * 0.28, -Math.PI / 2, 0, 0),
      0.74, DOWN);
  }

  // everything so far is rigid, so its free weight is zero
  while (out.free.length < out.pos.length / 3) out.free.push(0);

  // -- the coat, last, because it is the only thing that moves on its own
  coat(out, s, CSIDES, CRINGS, r.int(0, 1 << 20));
  while (out.free.length < out.pos.length / 3) out.free.push(0);

  // -- the strap: the one asymmetry (§2). A flat band across the chest, on a
  //    side the seed picks, because a figure that is symmetric everywhere reads
  //    as a mannequin and one that is asymmetric twice reads as clutter.
  const strapSide = r.float(0, 1) < 0.5 ? -1 : 1;
  {
    const w = s.shoulderW * 0.085;
    const A = [strapSide * s.shoulderW * 0.34, s.shoulderY - 0.01, s.shoulderW * 0.20];
    const B = [-strapSide * s.hipW * 0.34, s.waistY, s.hipW * 0.30];
    const ax = sub3(B, A);
    const nl = Math.hypot(ax[1], ax[0]) || 1;
    const nrm = [(-ax[1] / nl) * w, (ax[0] / nl) * w, 0];
    const add = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
    quad(out, add(A, nrm), sub3(A, nrm), sub3(B, nrm), add(B, nrm), BONE.CHEST, MAT.STRAP, null);
    for (let k = 0; k < 6; k++) out.free.push(0);
  }

  const position = new Float32Array(out.pos);
  return {
    position,
    normal: faceNormals(position),
    bone: new Float32Array(out.bone),
    mat: new Float32Array(out.mat),
    free: new Float32Array(out.free),
    dims: s, strapSide, tris: position.length / 9,
  };
}

/**
 * Flat normals, per triangle, written to every vertex of it.
 *
 * Flat rather than smoothed, and that is the art direction rather than a
 * shortcut: §9.2's three-stop hue ramp puts a *visible* band edge at every
 * shading transition, and CLAUDE.md §11 is explicit that this is the thing a
 * PBR reflex will try to delete. A faceted figure banded by that ramp reads as
 * painted; a smooth one reads as plastic, because the ramp then has nowhere to
 * put its edges except across a gradient.
 */
export function faceNormals(pos) {
  const n = new Float32Array(pos.length);
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i + 3] - pos[i], ay = pos[i + 4] - pos[i + 1], az = pos[i + 5] - pos[i + 2];
    const bx = pos[i + 6] - pos[i], by = pos[i + 7] - pos[i + 1], bz = pos[i + 8] - pos[i + 2];
    let cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const l = Math.hypot(cx, cy, cz) || 1;
    cx /= l; cy /= l; cz /= l;
    for (let k = 0; k < 9; k += 3) { n[i + k] = cx; n[i + k + 1] = cy; n[i + k + 2] = cz; }
  }
  return n;
}

// ---------------------------------------------------------------------------
// the rig
//
// Eighteen matrices, composed on the CPU once a frame and uploaded as a
// uniform array. Not `SkinnedMesh`: there is no bind pose to invert because
// every vertex was authored in its own bone's local space at build time, which
// is the one simplification a generated skeleton buys you over a loaded one.

/** the bind offsets — where each bone sits in its parent, at rest */
export function restPose(s) {
  const A = (x, y, z) => [x, y, z];
  const rest = new Array(BONE_COUNT).fill(null).map(() => A(0, 0, 0));
  rest[BONE.UPPER_L] = A(-s.shoulderW * 0.52, s.shoulderY - s.head * 0.10, 0);
  rest[BONE.FORE_L] = A(0, -s.upperArm, 0);
  rest[BONE.HAND_L] = A(0, -s.forearm, 0);
  rest[BONE.UPPER_R] = A(s.shoulderW * 0.52, s.shoulderY - s.head * 0.10, 0);
  rest[BONE.FORE_R] = A(0, -s.upperArm, 0);
  rest[BONE.HAND_R] = A(0, -s.forearm, 0);
  rest[BONE.THIGH_L] = A(-s.hipW * 0.42, s.hipY, 0);
  rest[BONE.SHANK_L] = A(0, -s.thigh, 0);
  rest[BONE.FOOT_L] = A(0, -s.shank, 0);
  rest[BONE.THIGH_R] = A(s.hipW * 0.42, s.hipY, 0);
  rest[BONE.SHANK_R] = A(0, -s.thigh, 0);
  rest[BONE.FOOT_R] = A(0, -s.shank, 0);
  return rest;
}

/**
 * Compose the skeleton for one frame into `mats`, a flat column-major
 * `Float32Array(16 · BONE_COUNT)` — the exact thing `uniform mat4[]` wants, so
 * the per-frame path allocates nothing and copies nothing.
 *
 * Pure, and takes plain numbers, so `tools/verify.js` can assert on where a
 * heel ends up without a renderer. That is the only way to catch a leg passing
 * through the ground on one world in ten thousand: nobody is going to look.
 */
export function poseFigure(mats, dims, pose, rest = restPose(dims)) {
  const set = (i, parent, rx, ry = 0, rz = 0) => {
    const o = rest[i];
    compose(TMP, 0, o[0], o[1], o[2], rx, ry, rz);
    if (parent < 0) for (let k = 0; k < 16; k++) mats[i * 16 + k] = TMP[k];
    else mul(mats, i * 16, mats, parent * 16, TMP, 0);
    return i;
  };
  const lean = pose.lean || 0, twist = pose.twist || 0, amp = pose.amp || 0;

  compose(mats, BONE.ROOT * 16, 0, pose.rise || 0, 0, 0, 0, 0);
  set(BONE.PELVIS, BONE.ROOT, 0, -twist * 0.5, 0);
  set(BONE.SPINE, BONE.PELVIS, -lean * 0.55, twist, 0);
  set(BONE.CHEST, BONE.SPINE, -lean * 0.45, twist * 0.4, 0);
  set(BONE.NECK, BONE.CHEST, lean * 0.7, 0, 0);
  set(BONE.HEAD, BONE.NECK, lean * 0.3 + (pose.headPitch || 0), pose.headYaw || 0, 0);
  // The coat hangs off the root, not the chest. A coat is heavy: it does not
  // take the torso's counter-rotation, and a coat that twists with the
  // shoulders is the tell that a figure is wearing a decal rather than a garment.
  set(BONE.COAT, BONE.ROOT, 0, 0, 0);

  for (const [side, up, fore, hand, thigh, shank, foot, arm, elbow, thighA, kneeA] of [
    [-1, BONE.UPPER_L, BONE.FORE_L, BONE.HAND_L, BONE.THIGH_L, BONE.SHANK_L, BONE.FOOT_L,
      pose.armL, pose.elbowL, pose.thighL, pose.kneeL],
    [1, BONE.UPPER_R, BONE.FORE_R, BONE.HAND_R, BONE.THIGH_R, BONE.SHANK_R, BONE.FOOT_R,
      pose.armR, pose.elbowR, pose.thighR, pose.kneeR],
  ]) {
    // arms hang from the chest, so a twisting torso carries them — the tell
    // that a figure is one body rather than a torso with limbs stapled on
    set(up, BONE.CHEST, arm || 0, 0, side * (0.09 + amp * 0.05));
    set(fore, up, -(elbow || 0), 0, 0);
    set(hand, fore, -0.12, 0, 0);
    set(thigh, BONE.PELVIS, thighA || 0, 0, side * 0.02);
    set(shank, thigh, kneeA || 0, 0, 0);
    // the ankle counter-rotates so the sole stays flat through the stride,
    // which is the difference between walking and being dragged
    set(foot, shank, -((thighA || 0) + (kneeA || 0)) * 0.55 - 0.06, 0, 0);
  }
  return mats;
}

/** scratch for one local transform — `poseFigure` runs every frame */
const TMP = new Float64Array(16);

/** where a bone's origin ends up, in figure space — for tests and for the hand */
export function boneAt(mats, bone) {
  const i = bone * 16;
  return [mats[i + 12], mats[i + 13], mats[i + 14]];
}

// ---------------------------------------------------------------------------
// the material
//
// Four values on one mesh, keyed by the `aMat` attribute: coat, skin, boot and
// strap. §9.1's discipline — the palette is a table, converted once, injected
// as literals — and §9.2's `paint()` does the lighting if `?paint=1` is on, so
// nothing here duplicates a light model.

export const FIGURE_VERT = /* glsl */`
  attribute float aBone;
  attribute float aMat;
  attribute float aFree;
  uniform mat4 uBones[${BONE_COUNT}];
  uniform vec3 uCloth;      // wind + trail, in figure space, metres
  uniform vec2 uHem;        // travelling ripple: amplitude, phase in cycles
  varying float vMat;
  varying vec3 vN;
  varying vec3 vW;

  void main() {
    int b = int(aBone + 0.5);
    mat4 B = uBones[b];
    vec4 p = B * vec4(position, 1.0);
    vec3 n = mat3(B) * normal;

    // the cloth. aFree is zero at the collar and one at the hem, squared at
    // build time, so the displacement is quartic in height — a hem that moves
    // and a shoulder that does not, which is what cloth reads as.
    if (aFree > 0.0) {
      float w = aFree;
      p.xyz += uCloth * w;
      // and a ripple travelling around the hem on the gait's own phase, so the
      // coat swings on the footfall rather than on a clock of its own (§3)
      float a = atan(p.x, p.z);
      p.x += sin(a * 3.0 + uHem.y * 6.2831853) * uHem.x * w;
      p.z += cos(a * 3.0 + uHem.y * 6.2831853) * uHem.x * w * 0.6;
      p.y -= (uCloth.x * uCloth.x + uCloth.z * uCloth.z) * 0.34 * w;   // it lifts as it swings
    }

    vMat = aMat;
    vN = normalize(mat3(modelMatrix) * n);
    vW = (modelMatrix * p).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * p;
  }
`;

/**
 * Four colours, and the reason they are these four.
 *
 * The coat is a deep desaturated indigo rather than black: §9.1's shadow tint
 * is `#5C6E9E` and §9.2 is explicit that *"shadows change hue, they do not go
 * black"* — a black coat would be the one surface in frame that violates the
 * rule the whole light model is built on, and at surface scale §2.8 forbids it
 * outright. Indigo also does what black is usually chosen for: it reads as a
 * single dark mass at distance and holds its hue in the light.
 *
 * The lining is warm, because a coat that flares should show something when it
 * does, and warm-against-cool is the oldest way to make a shape read.
 */
export const FIGURE_PALETTE = {
  coat: 0x2A3050,
  lining: 0x8C5A3C,
  skin: 0xD9B08C,
  boot: 0x1E2233,
  strap: 0xB4753E,
};

/**
 * The shading, which is deliberately §9.2's shape and not a PBR one.
 *
 * A half-Lambert wrap and a three-stop ramp with visibly soft band edges —
 * §11 names this as the first thing a physically-based instinct will try to
 * delete and it is the art direction. On a figure it does more work than
 * anywhere else in the frame: a smoothly-shaded generated body reads as a
 * mannequin because the gradient has nothing to describe, while banded values
 * read as *drawn*, and the bands land on the anatomy that put them there.
 *
 * The lining shows on backfaces, which is the whole reason the material is
 * double-sided: a coat that flares should show something when it does, and
 * warm-inside against cool-outside is the oldest way to make a shape read.
 */
export const FIGURE_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uCoat, uLining, uSkin, uBoot, uStrap;
  varying float vMat;
  varying vec3 vN;
  varying vec3 vW;

  void main() {
    vec3 N = normalize(vN);
    vec3 V = normalize(cameraPosition - vW);
    // Which of the five this triangle is. Ids rather than materials, because
    // a figure is one draw call.
    vec3 base = uCoat;
    if (vMat < 0.5) base = uCoat;              // body: under the coat, same cloth
    else if (vMat < 1.5) base = uCoat;         // the coat proper
    else if (vMat < 2.5) base = uSkin;         // head and neck
    else if (vMat < 3.5) base = uBoot;         // boots and gloves
    else base = uStrap;
    // ...and the inside of the coat, which is the whole reason for two faces
    if (!gl_FrontFacing) {
      N = -N;
      if (vMat > 0.5 && vMat < 1.5) base = uLining;
    }

    // §9.2's wrap. A grazing sun is the only sun this project spawns you under
    // (§9.7 forces 8-18 degrees), and plain Lambert puts the whole figure in
    // the shade band at that elevation.
    float ndl = clamp(dot(N, normalize(uSunDir)) * 0.62 + 0.46, 0.0, 1.0);
    // and the three-stop ramp, with soft-but-visible edges
    float lo = smoothstep(0.10, 0.24, ndl);
    float hi = smoothstep(0.50, 0.66, ndl);
    vec3 shade = base * 0.62 + vec3(0.036, 0.043, 0.062);   // never toward black
    vec3 mid = base;
    vec3 lit = base * 1.22 + vec3(0.030, 0.026, 0.014);
    vec3 col = mix(shade, mix(mid, lit, hi), lo);

    // the rim, which §9.2 calls the connective tissue of the whole image — and
    // on a figure standing against a valley it is what separates the two
    float rim = pow(1.0 - max(dot(N, V), 0.0), 4.2)
      * smoothstep(0.05, 0.85, dot(V, -normalize(uSunDir)));
    col += vec3(1.0, 0.86, 0.62) * rim * 0.42;

    gl_FragColor = vec4(col, 1.0);
  }
`;
