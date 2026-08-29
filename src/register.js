// The print's register — CLAUDE.md §9.4, and `docs/plans/SAKURA.md`.
//
// AEON has two vendored art references and they disagree about the print.
//
//   `docs/reference/hoshi-no-tani.html`  watercolour. Wet-in-wet softening,
//                                        chroma bleed, paper tooth, a warm-dark
//                                        vignette. §9.4 is its transcription.
//   `docs/reference/sakura-realm/`        photographic. Clean, bloomed, no
//                                        paper, highlights that roll off
//                                        instead of clipping.
//
// §9 gives the first one the last word, so the second has been vendored for its
// nature systems and ignored for its look. That was defensible while the only
// question was which reference to copy. It stops being defensible the moment
// you notice **the two files are not disagreeing about taste. They are
// photographs of different air.**
//
// hoshi-no-tani is one hand-composed valley 2400 m across that wants its far
// wall dissolved, and `src/aerial.js` already carries the diagnosis in its own
// header: *"`fogFar 1700` is not a constant of nature. It is a weather."* At
// 1700 m of visibility — WMO **mist** — a real photograph of a real valley
// loses its edges, its contrast and its colour separation, and the honest way
// to render that is wet paper. Sakura-realm's field reads hills at five
// kilometres. That is WMO **clear**, and clear air is where a photograph keeps
// its edges.
//
// So the two references are the two ends of one axis, each correct about its
// own air, and neither is a style. This file is that axis.
//
// ---------------------------------------------------------------------------
// One number, and why it must collapse
//
//   R = 1   painted        every knob at hoshi-no-tani's value
//   R = 0   photographic   every knob at sakura-realm's
//
// **At `R = 1` the print must be bit-identical to what shipped before this file
// existed.** Not approximately — identically, to 1e-12 over a 4096-colour
// sweep, which `tools/verify.js --suite register` measures.
//
// That is not politeness toward the old look. It is the only thing that makes
// the axis reviewable: a knob that changes the frame at `R = 1` is a knob that
// has silently retuned the reference case, and then no capture of the painted
// end means anything any more. Every `PAINTED` value below is therefore
// transcribed from the literal it replaces in `print.js`, and the suite reads
// both.
//
// ---------------------------------------------------------------------------
// The shape is §5's quality table, deliberately
//
// §5: *"one array indexed by tier, each row carrying every knob... One row
// change reconfigures the entire renderer."* Same discipline here, one axis
// over: two rows, fourteen columns, and `KNOBS` fixes the order so a caller
// cannot mis-pack them. Adding a knob means adding a column to both rows and a
// name to the list, and `parse`/`verify` catch a row that forgot one.
//
// No THREE, no clock, no GL: everything here is arithmetic, so the suite holds
// it to account without a GPU (§14).

// ---------------------------------------------------------------------------
// the knobs

/**
 * The order every packed form uses. A row is validated against this, so a row
 * that gains a key without the list gaining a name fails at import rather than
 * rendering a frame with one knob quietly reading undefined.
 */
export const KNOBS = [
  'shoulder', 'shadowPush', 'highPush', 'sBend', 'satX',
  'wash', 'bleedBase', 'bleedGain',
  'tooth', 'fibre', 'vignette', 'vigWarm',
  'bloomX', 'halation',
];

/**
 * `R = 1` — hoshi-no-tani. Every value transcribed from the literal it replaces
 * in `print.js`, at the line `docs/plans/SAKURA.md` §5 act 2 names.
 *
 * Read this column as the answer to "what did the print do before there was a
 * register", and nothing else. It is a fixture.
 */
export const PAINTED = {
  /** §9.4 step 1 · added to the tonemap denominator's x². 0 is the curve as written. */
  shoulder: 0.0,
  /** §9.4 step 2 · how much of the violet-shadow push lands. */
  shadowPush: 0.85,
  /** §9.4 step 2 · how much of the cream-highlight push lands. */
  highPush: 0.90,
  /** §9.4 step 4 · the gentle S, toward c²(3−2c). */
  sBend: 0.16,
  /** §9.4 step 4 · multiplier on `uSat`. 1 is `SAT_AMOUNT` unchanged. */
  satX: 1.0,
  /** §9.4 step 5 · watercolour softening, as a coefficient on the fog fraction. */
  wash: 0.42,
  /** §9.4 step 5b · chroma bleed, constant term. */
  bleedBase: 0.09,
  /** §9.4 step 5b · chroma bleed, per unit of wet. */
  bleedGain: 0.17,
  /** §9.4 step 6 · paper grain, ±3% at 1. */
  tooth: 1.0,
  /** §9.4 step 6 · directional paper fibre, 1% at 1. */
  fibre: 1.0,
  /** §9.4 step 7 · vignette depth. */
  vignette: 1.0,
  /** §9.4 step 7 · how far the vignette's colour sits from neutral. */
  vigWarm: 1.0,
  /** multiplier on the bloom composite. */
  bloomX: 1.0,
  /** warm halation on the bloom. Paper does not halate; film does. */
  halation: 0.0,
};

/**
 * `R = 0` — sakura-realm.
 *
 * Four of these are the whole difference and the rest are consequences.
 *
 * **`shoulder`.** The single most visible one, and the only one that needed a
 * derivation rather than a reading. §9.4 says *"Not ACES. Not Reinhard."* and
 * that stands — but the reason sakura-realm reached for ACES is real: the print
 * curve `x(0.36x + 0.42) / (x(0.34x + 0.66) + 0.11)` **clips**. Solve
 * `a/b = 1` and it reaches white at `x = 12.44`, so a sun disc above that is a
 * flat white hole with no shape in it, and so is anything the bloom pushed
 * past it.
 *
 * Raising the denominator's x² coefficient fixes exactly that, inside the same
 * rational family, without importing a curve the constitution forbids. At
 * `0.34 + 0.0335 = 0.3735` the asymptote is `0.36/0.3735 = 0.964`: the equation
 * `a/b = 1` loses its positive root entirely, so **nothing ever clips**.
 * Highlights compress forever and the disc keeps its shape; only the bloom
 * composite, which is added after, takes a pixel to white. That is what a film
 * shoulder is, and it is one coefficient.
 *
 * **`wash`, `tooth`, `fibre`.** Paper. A photograph has no paper. `wash` does
 * not go to zero — a photograph in air *does* lose acuity with distance, which
 * is a fact about the air and not about the medium — it goes to 0.05, which is
 * enough to keep a far ridge from looking cut out of the sky and nowhere near
 * enough to read as pigment.
 *
 * **`bloomX` and `halation`.** Sakura-realm's signature, and the reason its
 * frames read as photographed rather than rendered: a bright edge blooms warm.
 * Halation is a real mechanism — light that passed the emulsion, scattered off
 * the film base and came back — and it is why it is warm rather than white: the
 * red layer sits deepest and is what survives the return trip.
 *
 * **These two were 1.55 and 0.42, and the first frame ever rendered through
 * them said no.** Measured on a surface capture against a `?reg=1&ae=0`
 * control: **31.1% of the frame blown past 0.92 luma against the control's
 * 0.1%**, and mean saturation *down* 36% — 0.255 against 0.397 — because a
 * blown pixel has no colour left to have.
 *
 * The mistake was a category error, and it is worth naming because it is easy
 * to make again. **A register is a claim about character, not about level.**
 * Paper versus film is a question of how highlights roll, how colour runs, what
 * the grain is — none of which is "more light". `bloomX` is level. It was
 * multiplying a bloom strength that `surface.js` had already tuned to 0.58 at a
 * 0.34 threshold, so two independently-made decisions compounded, and the
 * bloom composites *before* the tonemap where there is no headroom left to
 * absorb it.
 *
 * 1.10 keeps a touch more bloom than paper gets, which is real and is
 * characteristic. The photographic look is carried by the shoulder, the
 * halation's *hue*, and the saturation — the three knobs that change character
 * without changing exposure.
 *
 * The rest follow. A photographic print keeps its violet shadows (sakura-realm
 * gets them from sky ambient rather than from a grade, but they are there), so
 * `shadowPush` softens rather than vanishing. Saturation rises because there is
 * no wash left to carry colour outward. The vignette becomes a lens's, which is
 * darker-neutral rather than warm-grey, so `vigWarm` drops much further than
 * `vignette` does.
 */
export const PHOTOGRAPHIC = {
  shoulder: 1.0,
  shadowPush: 0.58,
  highPush: 0.72,
  sBend: 0.09,
  satX: 1.22,
  wash: 0.05,
  bleedBase: 0.015,
  bleedGain: 0.03,
  tooth: 0.16,
  fibre: 0.0,
  vignette: 0.30,
  vigWarm: 0.25,
  bloomX: 1.10,
  halation: 0.16,
};

/**
 * How far the tonemap denominator's x² coefficient travels at full
 * photographic. Exported because both the shader and the suite need it and
 * §2.7's rule about two copies of one constant applies to a scalar as much as
 * to a height field.
 *
 * 0.3735 is not tuned. It is the largest value whose asymptote still rounds to
 * a display step below white (`0.36/0.3735 = 0.9639`, i.e. 246/255): far enough
 * that the clip root is gone, close enough that a specular highlight still
 * reads as *nearly* white before the bloom finishes the job.
 */
export const SHOULDER_D2 = 0.0335;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** every row carries every knob, or the import fails rather than the frame */
for (const [name, row] of [['PAINTED', PAINTED], ['PHOTOGRAPHIC', PHOTOGRAPHIC]]) {
  for (const k of KNOBS) {
    if (!Number.isFinite(row[k])) {
      throw new Error(`register.js · row ${name} is missing knob "${k}"`);
    }
  }
  if (Object.keys(row).length !== KNOBS.length) {
    throw new Error(`register.js · row ${name} has a knob KNOBS does not name`);
  }
}

/**
 * The knobs at register `r`.
 *
 * Linear between the two rows, and linear on purpose: every knob is already a
 * coefficient on a term the eye reads roughly linearly, so a smoothstep here
 * would only make the axis lie about where its midpoint is. The smoothstep
 * belongs one level up, in `registerFor()`, where it maps a *physical* quantity
 * onto this one — which is where a nonlinearity has a reason.
 *
 * `r` outside [0,1] is clamped rather than extrapolated. There is no such thing
 * as more painted than paper.
 */
export function registerMix(r) {
  const t = clamp(Number.isFinite(r) ? r : 1, 0, 1);
  const out = {};
  for (const k of KNOBS) out[k] = lerp(PHOTOGRAPHIC[k], PAINTED[k], t);
  return out;
}

// ---------------------------------------------------------------------------
// the law

/**
 * WMO's own boundaries, in metres, and they are the anchors — not a taste.
 *
 * `MIST_TOP` is the top of *mist* and `CLEAR_FLOOR` the bottom of *clear*.
 * Both are published thresholds in the WMO's visibility vocabulary, which
 * `src/aerial.js`'s `VISIBILITY` table already speaks.
 *
 * That the two references land exactly on the two ends is a **result**, not a
 * calibration: hoshi-no-tani chose 1700 m for its own composition years before
 * anyone put it on an axis, and sakura-realm's hills at 5 km put it well past
 * 10 km. Neither number was moved to make this work.
 */
export const MIST_TOP = 2000;
export const CLEAR_FLOOR = 10000;

/**
 * The register a given air prints in.
 *
 * `visibility` is metres, and it is `src/aerial.js`'s `visibilityFor()` — the
 * same number the fog already runs on, so the print and the air can never
 * disagree about the weather. That shared source is the point: a register
 * derived from its own second opinion about the atmosphere would be §2.7's
 * trap wearing a different hat.
 *
 * **Logarithmic**, because visibility is. The difference between 2 km and 4 km
 * is a different day; the difference between 20 km and 22 km is nothing, and a
 * linear map would spend most of its range on the second.
 *
 * Worked, so the claim is checkable rather than asserted:
 *
 * | V | | R |
 * |---|---|---|
 * | 1700 m | hoshi-no-tani's own air | **1.000** |
 * | 6000 m | `visibilityFor()` on a temperate Earth-like world | **0.238** |
 * | 22000 m | `VISIBILITY.clear` | **0.000** |
 *
 * The middle row is the one that answers the ask. A temperate world prints
 * three-quarters photographic, and it gets there from `visibilityFor()`'s
 * humidity model rather than from anybody choosing.
 *
 * `hazeX` is the resonance's mood multiplier on the air, the same one
 * `aerialParams()` takes — the one term in either file that is art rather than
 * physics, and it is kept in one place for that reason. Above 1 it thickens the
 * air and paints; below 1 it clears and photographs.
 */
export function registerFor(visibility, hazeX = 1) {
  const v = Number.isFinite(visibility) ? visibility : MIST_TOP;
  const x = Number.isFinite(hazeX) && hazeX > 1e-6 ? hazeX : 1;
  // thicker air is less visibility, so the mood divides
  const V = Math.max(v / x, 1);
  const t = clamp(
    (Math.log(CLEAR_FLOOR) - Math.log(V))
    / (Math.log(CLEAR_FLOOR) - Math.log(MIST_TOP)), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The register's name, for the HUD and for a capture's filename.
 *
 * §8 axis 7 asks whether the chrome can be deleted without losing orientation,
 * and a number between 0 and 1 is not orientation. A word is.
 */
export function registerName(r) {
  const t = clamp(Number.isFinite(r) ? r : 1, 0, 1);
  if (t < 0.18) return 'photographic';
  if (t < 0.45) return 'clear';
  if (t < 0.75) return 'washed';
  return 'painted';
}
