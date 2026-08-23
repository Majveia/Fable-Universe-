// The print (CLAUDE.md §9.4) — and with it, §2.8's split by medium.
//
// This replaces ACES. §9.4 is unambiguous — *"Not ACES. Not Reinhard."* — and
// v1 of the constitution said "Never ACES" too, so the whole universe has been
// rendering through a curve both documents forbid since before either was
// written. M0's audit routed it here as finding 3.1, the largest single gap
// between the constitution and the pixels.
//
// Ported from the reference rather than from §9.4's summary, per §9: when the
// section and the file disagree, the file wins. The coefficients below are the
// file's, at the line numbers recorded in docs/plans/M2.md.
//
// ---------------------------------------------------------------------------
// uPaint, and why it settles two arguments
//
// §3's first row is the most consequential ruling in the constitution: OLED
// true-black versus the reference's explicit lift. It resolves them *by
// medium* — vacuum renders to true #000, atmosphere renders through the lifted
// print — and asks for a cross-fade on the atmospheric-entry hyperzoom, driven
// by the same parameter that drives the transition.
//
// The reference already had that parameter. Every grade step it applies is
// scaled by a single `uPaint` uniform, including the lift. So the split is not
// a fork in the shader or two pipelines to keep in sync — it is one number.
//
//   uPaint = 0   vacuum      AEON's curve, blacks land on exactly zero
//   uPaint = 1   atmosphere   the full print, nothing reaches black
//
// Anything between is the cross-fade, and it is continuous by construction.
//
// §3's *third* row rides the same number. It rules on the two tonemaps — "the
// reference curve wins at surface scale; AEON's survives in vacuum" — and that
// is not the same statement as the lift. Scaling only the grade steps by uPaint
// would have put the reference's rational curve in the deep field, where it
// nearly triples the value of a 2% grey: the cosmic web's mean luminance
// measured 0.204 through the old ACES path and 0.381 through the print, and the
// whole gain was the curve. So `tonemap()` takes uPaint too, and vacuum keeps
// `1 − exp(−1.32·c)`. One uniform, two rulings, no second pipeline.
//
// ---------------------------------------------------------------------------
// What is not here yet
//
// §9.4 steps 5 (watercolour softening at 0.42 × fog) and its chroma bleed need
// the fog fraction in the alpha channel, which is §9.3's aerial-perspective
// port and does not exist yet. They are the two steps that read a *distance*,
// and they land with the thing that writes one. Everything else — tonemap,
// shadow/highlight push, lift, S-curve, midtone saturation, paper tooth,
// vignette, dither — is complete.

import * as THREE from 'three';

import { SAT_AMOUNT } from './quality.js';
import { PAINTED, SHOULDER_D2, registerMix } from './register.js';

export const PRINT_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uBloom: { value: null },    // §9.4's step order: the bloom composites here
    uBloomAmt: { value: 0 },
    uPaint: { value: 0 },       // 0 vacuum · 1 atmosphere (§2.8, §3 row 1)
    uExposure: { value: 1 },
    /**
     * §9.4 step 4's midtone saturation, as the excess above unity at the peak
     * of the band. **3.0**, and it was 0.16.
     *
     * The old number was not wrong for the mechanism it had. It multiplied the
     * distance from grey directly, so anything above about 0.7 pushed channels
     * out of [0,1] — measured, 3.72% of a 4096-colour sweep went *negative* at
     * the shipped 0.16 and the framebuffer clamped them to zero. 0.16 was the
     * largest number that old mechanism could safely carry, and it left the
     * print costing **-25.4% of mean saturation** end to end: horizon sky -68%,
     * sun -49%, blossom -45%. That is the washed-out complaint, in one number,
     * and it was in the grade rather than in the world.
     *
     * The rewrite above walks up to the gamut wall instead of through it, so a
     * much larger excess is safe. At 3.0 the same eight-colour set comes out
     * **+11.7%** against its input with **zero** channels out of gamut — call
     * it a 50% relative gain in saturation over what shipped.
     *
     * §3 row 5 is what licenses moving it at all: "the numbers are never
     * negotiable; the palette always is." The tonemap, the band edges and the
     * shadow/highlight push are all untouched — this changes how much colour
     * survives them, not what they are. `?sat=` overrides for A/B; `?sat=0.16`
     * restores the shipped look for comparison.
     */
    uSat: { value: SAT_AMOUNT },
    uGrain: { value: 1 },
    uVignette: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) },
    // `?fogview=1` — output the distance the print actually read, instead of
    // the picture. §9.3's alpha trick is the one part of act 2 whose failure
    // mode is invisible: a chain that quietly dropped alpha still renders a
    // perfectly good frame, just one where step 5 softens nothing. This is the
    // same instrument `?shdebug=1` is for the shadow term, and it is what makes
    // "the fog fraction survives to the print" a measurement rather than a hope.
    uFogView: { value: 0 },

    /**
     * The register — `src/register.js`, `docs/plans/SAKURA.md`.
     *
     * AEON has two vendored art references and they are photographs of
     * different air, not two opinions about one. These fourteen numbers are the
     * axis between them, and `registerFor(visibility)` chooses a point on it
     * from the same weather the fog already runs on.
     *
     * They arrive as uniforms rather than as literals in the shader for the
     * reason §2.7 gives about the height field: a table that exists twice is a
     * table that will be edited once. `register.js` holds the only copy;
     * `setRegister()` below packs it, and it is the only thing that may.
     *
     * The defaults are `PAINTED` — so a build that never calls `setRegister()`
     * renders exactly what shipped before this file grew a register, which is
     * what makes the axis reviewable at all.
     */
    uShoulder: { value: PAINTED.shoulder },
    uPush: { value: new THREE.Vector2(PAINTED.shadowPush, PAINTED.highPush) },
    uSBend: { value: PAINTED.sBend },
    uSatX: { value: PAINTED.satX },
    // x wash · y bleed base · z bleed gain
    uWash: { value: new THREE.Vector3(PAINTED.wash, PAINTED.bleedBase, PAINTED.bleedGain) },
    // x paper tooth · y directional fibre
    uTooth: { value: new THREE.Vector2(PAINTED.tooth, PAINTED.fibre) },
    // x depth · y how far the vignette's colour sits from neutral
    uVig: { value: new THREE.Vector2(PAINTED.vignette, PAINTED.vigWarm) },
    // x bloom multiplier · y warm halation
    uBloomReg: { value: new THREE.Vector2(PAINTED.bloomX, PAINTED.halation) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform sampler2D uBloom;
    uniform float uBloomAmt;
    uniform float uPaint, uExposure, uGrain, uVignette, uFogView, uSat;
    uniform float uShoulder, uSBend, uSatX;
    uniform vec2 uPush, uTooth, uVig, uBloomReg;
    uniform vec3 uWash;
    uniform vec2 uRes;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    // §9.4 step 1 — a rational curve. Not ACES. Not Reinhard.
    //
    // The shoulder is the register's, and it is one coefficient. As written,
    // 0.34 in the denominator's x^2 puts the asymptote at 0.36/0.34 = 1.0588,
    // so the curve *reaches* white: solve a/b = 1 and it clips at x = 12.44,
    // and everything above that is a flat hole with no shape in it — which is
    // the defect sakura-realm reached for ACES to fix.
    //
    // At uShoulder = 1 the coefficient is 0.3735 and the asymptote is 0.9639.
    // The positive root is gone entirely: nothing clips, highlights compress
    // forever, a sun disc keeps its shape, and only the bloom composite added
    // afterwards takes a pixel to white. A film shoulder, inside the rational
    // family §9.4 specifies, without importing the curve it forbids.
    vec3 tonemapPrint(vec3 x, float shoulder) {
      vec3 a = x * (x * 0.36 + 0.42);
      vec3 b = x * (x * (0.34 + 0.0335 * shoulder) + 0.66) + 0.11;
      return clamp(a / b, 0.0, 1.0);
    }

    // §3 row 3 — AEON's own curve, which survives in vacuum.
    vec3 tonemapVacuum(vec3 x) {
      return clamp(1.0 - exp(-1.32 * x), 0.0, 1.0);
    }

    // ...and the ruling itself: "the reference curve wins at surface scale;
    // AEON's survives in vacuum. Cross-fade on entry." Both curves are monotone
    // and both send 0 to 0, so the blend is monotone at every uPaint and true
    // black survives the whole descent, not just its endpoints.
    vec3 tonemap(vec3 x, float paint) {
      x = max(x, vec3(0.0));
      return mix(tonemapVacuum(x), tonemapPrint(x, uShoulder), paint);
    }

    // §9.4 steps 1–4, as one function, because step 5 has to run the softened
    // tap through exactly the same curve the sharp pixel took. Two copies of a
    // grade is the same fault §2.7 names for the height field: they look
    // identical until one of them is edited.
    vec3 grade(vec3 c, float paint) {
      c = tonemap(c * uExposure, paint);

      // §9.4 step 2 — shadows to violet, highlights to cream.
      // The reference annotates this "the single biggest lever." It is.
      float l = luma(c);
      vec3 shadowPush = mix(vec3(0.90, 0.95, 1.16), vec3(1.0), smoothstep(0.0, 0.34, l));
      vec3 highPush   = mix(vec3(1.0), vec3(1.055, 1.012, 0.925), smoothstep(0.44, 0.98, l));
      // The strengths are the register's. Both survive at the photographic end
      // rather than vanishing: sakura-realm's shadows are violet too — it gets
      // them from a blue sky ambient instead of from a grade, but they are
      // there, and a photograph with neutral-grey shadows is the one thing
      // neither reference has.
      c *= mix(vec3(1.0), shadowPush, uPush.x * paint) * mix(vec3(1.0), highPush, uPush.y * paint);

      // §9.4 step 3 — the lift, and §2.8's whole argument in one line: it is
      // scaled by uPaint, so in vacuum it is exactly zero and black stays black
      vec3 lift = vec3(0.017, 0.021, 0.036) * paint;
      c = c * (1.0 - lift) + lift;

      // §9.4 step 4 — a gentle S, then saturation in the midtones only
      c = mix(c, c * c * (3.0 - 2.0 * c), uSBend * paint);
      l = luma(c);

      // The boost the band asks for, as an EXCESS above 1 rather than a factor.
      // Zero outside the band, which is what keeps this exactly neutral there.
      // uSatX is the register's multiplier: a photographic print carries more
      // saturation because it has no wash left to carry colour outward for it.
      // The knee below is unchanged, so the extra excess still walks up to the
      // gamut wall rather than through it — which is the property that made a
      // number this large safe in the first place.
      float e = uSat * uSatX * paint
        * smoothstep(0.10, 0.42, l) * (1.0 - smoothstep(0.62, 0.96, l));

      // How far the colour can travel away from grey before a channel leaves
      // [0,1], along the line from grey through c. Per channel:
      //   d > 0  ->  s <= (1 - l)/d       d < 0  ->  s <= -l/d
      vec3 d = c - vec3(l);
      float lim = 1.0e9;
      if (d.r >  1e-6) lim = min(lim, (1.0 - l) / d.r);
      if (d.r < -1e-6) lim = min(lim, -l / d.r);
      if (d.g >  1e-6) lim = min(lim, (1.0 - l) / d.g);
      if (d.g < -1e-6) lim = min(lim, -l / d.g);
      if (d.b >  1e-6) lim = min(lim, (1.0 - l) / d.b);
      if (d.b < -1e-6) lim = min(lim, -l / d.b);

      // Soften the excess against the headroom, harmonically: e*h/(e+h) is e
      // when there is room and approaches h when there is not, so the colour
      // walks up to the gamut wall and never through it. A hard min() would
      // reach the wall exactly and band along the set of pixels that hit it;
      // tanh would be the textbook knee and does not exist in GLSL ES 1.00.
      float h = max(lim - 1.0, 0.0);
      float s = 1.0 + (e * h) / max(e + h, 1e-6);
      return vec3(l) + s * d;
    }

    vec3 toSRGB(vec3 c) {
      return mix(c * 12.92,
                 1.055 * pow(max(c, vec3(1e-5)), vec3(1.0 / 2.4)) - 0.055,
                 step(0.0031308, c));
    }

    // Gradient noise for the paper tooth — the reference's own, verbatim from
    // its line 412, not a lookalike. Three details are load-bearing and all
    // three are easy to lose in a re-derivation: the gradients are unit length,
    // the fade is quintic, and the result is normalised by 1.42 so the field
    // spans roughly ±1. §9.4's ±3% grain is calibrated against that span; a
    // hand-rolled fract-of-sine noise lands at a different amplitude and
    // quietly changes how much tooth the paper has.
    //
    // The hash is the sine-free one (reference line 389) for the same reason it
    // is there: fract(sin(x)) is precision-dependent, and two GPUs would
    // disagree about the grain — which the capture gate would then read as a
    // difference between machines rather than a difference between builds.
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    vec2 grad2(vec2 i) { float a = hash12(i) * 6.2831853; return vec2(cos(a), sin(a)); }
    float pn2(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
      float a = dot(grad2(i), f), b = dot(grad2(i + vec2(1, 0)), f - vec2(1, 0));
      float c = dot(grad2(i + vec2(0, 1)), f - vec2(0, 1));
      float d = dot(grad2(i + vec2(1, 1)), f - vec2(1, 1));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.42;
    }

    void main() {
      vec4 src = texture2D(tDiffuse, vUv);
      // §11: one non-finite fragment survives the tonemap as a solid block, and
      // the bloom downsample chain will have smeared it over a neighbourhood
      // first. NaN is the only value that fails to equal itself.
      vec3 c = mix(vec3(0.0), src.rgb, vec3(equal(src.rgb, src.rgb)));

      // The bloom composites here, not as a pass of its own — §9.4's step order
      // puts it before the tonemap, and bloom.js explains why it must not be an
      // additive pass at all (it would overwrite the alpha §9.3 needs).
      // §11's second firewall, since the chain that produced this has been
      // downsampled four times and one bad texel would now be a neighbourhood.
      vec3 bl = texture2D(uBloom, vUv).rgb;
      bl = mix(vec3(0.0), bl, vec3(equal(bl, bl)));
      // The register's gain, and its halation. Halation is a real mechanism and
      // not a warm-bloom preset: light that passed the emulsion, scattered off
      // the film base and came back through. It reads warm because the red
      // layer sits deepest and is most of what survives the return trip — which
      // is why the tint is a red-weighted vec3 rather than a saturation boost.
      // One mix on a vec3 already fetched; nothing is sampled twice.
      vec3 halo = mix(vec3(1.0), vec3(1.10, 0.98, 0.90), uBloomReg.y * uPaint);
      c += max(bl, vec3(0.0)) * uBloomAmt * uBloomReg.x * halo;

      c = grade(c, uPaint);

      // ─── §9.4 step 5 · watercolour softening, tied to distance ───────────
      //
      // This is the step §9.3's alpha channel exists to make possible, and the
      // one act 1 had to defer twice for want of a distance to read.
      //
      // "Wet-in-wet, *not* bokeh" is the whole specification. A depth-of-field
      // blur is an optical defect of a lens; this is pigment spreading into
      // damp paper, so the radius stays small and fixed and it is the *amount*
      // that grows with distance. A far ridge does not go out of focus — it
      // goes soft, which is a different thing and reads as air rather than as
      // a camera.
      //
      // The tap is graded once, after averaging, rather than each sample being
      // graded and then averaged. The two differ only in the second order, and
      // the alternative is five tonemap-plus-grade evaluations per pixel for a
      // wash whose entire purpose is to lose detail.
      // Alpha carries clarity, 1 - fog — src/aerial.js explains why it is
      // stored inverted. An opaque material that knows nothing about §9.3
      // writes 1, which reads here as "no fog": sharp, and correct.
      float fog = 1.0 - clamp(src.a, 0.0, 1.0);
      if (uFogView > 0.5) { gl_FragColor = vec4(vec3(fog), 1.0); return; }
      float wet = uWash.x * fog;
      if (wet > 0.002) {
        vec2 px = 1.6 / max(uRes, vec2(1.0));
        vec3 t = texture2D(tDiffuse, vUv + vec2( px.x,  px.y)).rgb
               + texture2D(tDiffuse, vUv + vec2(-px.x,  px.y)).rgb
               + texture2D(tDiffuse, vUv + vec2( px.x, -px.y)).rgb
               + texture2D(tDiffuse, vUv + vec2(-px.x, -px.y)).rgb;
        // §11's firewall again: a NaN four texels away must not spread here
        t = mix(vec3(0.0), t, vec3(equal(t, t)));
        vec3 soft = grade(t * 0.25, uPaint);
        c = mix(c, soft, wet * uPaint);

        // §9.4 step 5b — chroma bleed at 0.09 + 0.17·wet. "Paint runs, pixels
        // do not": the *colour* is taken from the spread tap while the
        // luminance stays exactly where it was, so edges keep their drawing
        // and only the pigment wanders across them.
        float bleed = (uWash.y + uWash.z * wet) * uPaint;
        c = mix(c, vec3(luma(c)) + (soft - vec3(luma(soft))), bleed);
      }

      // §9.4 step 6 — paper tooth: two octaves, ±3% grain plus 1% fibre
      vec2 gp = vUv * uRes / 2.4;
      float grain = pn2(gp * 0.5) * 0.62 + pn2(gp * 0.13 + 11.0) * 0.38;
      float fibre = pn2(vec2(vUv.x * uRes.x * 0.06, vUv.y * uRes.y * 0.9));
      c *= 1.0 + grain * 0.030 * uTooth.x * uGrain * uPaint
               + fibre * 0.010 * uTooth.y * uGrain * uPaint;

      // §9.4 step 7 — warm-dark vignette
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      float vig = pow(clamp(1.0 - r2 * 1.15, 0.0, 1.0), 1.55);
      // uVig.y is how *coloured* the vignette is, and it drops much further
      // than its depth does. Paper darkens warm-grey at the edge because the
      // print is a physical object; a lens darkens neutral, because it is only
      // running out of aperture.
      vec3 vigCol = mix(vec3(1.0), vec3(0.62, 0.60, 0.66), uVig.y);
      c *= mix(vec3(1.0), mix(vigCol, vec3(1.0), vig), uVig.x * uVignette * uPaint);

      c = toSRGB(clamp(c, 0.0, 1.0));

      // §9.4 step 8 — ordered dither, post-sRGB.
      // Gated on luma so a true-black vacuum pixel is never rounded up to
      // 1/255: §2.8 says blacks are never lifted, and half of ±0.5/255 at zero
      // would lift them. Banding lives in the first visible step, not at zero.
      //
      // The gate opens at half a display step rather than at zero, because a
      // gate opening at zero still dithers a pixel at 0.4/255 — which quantises
      // to black — and half of those round up. Measured on an RTX 3060: the
      // cosmic frame reached true #000 on 42.2% of pixels with the dither off
      // and 39.0% with it on. Below half a step there is nothing to dither
      // between. Same edge as post.js; they must not drift apart.
      float dth = fract(dot(gl_FragCoord.xy, vec2(0.7548776662, 0.5698402909)));
      c += ((dth - 0.5) / 255.0) * smoothstep(0.5 / 255.0, 2.0 / 255.0, luma(c));

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
    }
  `,
};

/**
 * Pack a register onto a print pass's uniforms. **The only thing that may.**
 *
 * `register.js` holds the one copy of the table and this is the one place it is
 * read into GL, so a knob cannot acquire a second value the way §2.7 warns a
 * height field can. `uniforms` is `printPass.uniforms`; anything without a
 * register block (the pre-M2 path, which has no print at all) is a no-op rather
 * than an error, because whether a build has a print is `post.js`'s question.
 *
 * Returns the knobs it packed, so a caller — the HUD, `tools/gate.js` — can
 * report what the frame was actually printed with rather than what it asked for.
 */
export function setRegister(uniforms, r) {
  const k = registerMix(r);
  if (!uniforms || !uniforms.uShoulder) return k;
  uniforms.uShoulder.value = k.shoulder;
  uniforms.uPush.value.set(k.shadowPush, k.highPush);
  uniforms.uSBend.value = k.sBend;
  uniforms.uSatX.value = k.satX;
  uniforms.uWash.value.set(k.wash, k.bleedBase, k.bleedGain);
  uniforms.uTooth.value.set(k.tooth, k.fibre);
  uniforms.uVig.value.set(k.vignette, k.vigWarm);
  uniforms.uBloomReg.value.set(k.bloomX, k.halation);
  return k;
}

/**
 * The register a scale prints in, before the weather has a say.
 *
 * Vacuum is the interesting case and it is the reason this is not simply "ask
 * the air": at `uPaint = 0` every knob multiplies a term that is already zero,
 * so the register is *unobservable* there and any value is equally correct.
 * Returning the painted end keeps a vacuum frame byte-identical to what it has
 * always been, which is what `tools/repeat.js` and the digest both want, and it
 * means §2.8 needs no second branch anywhere in the chain.
 *
 * Inside an atmosphere the answer belongs to `registerFor()` and to the world,
 * so this returns `null` — "ask the air" — rather than guessing at a default
 * the caller is in a better position to know.
 */
export function registerForScale(scale) {
  switch (scale?.kind) {
    case 'cosmic':
    case 'galaxy':
    case 'system':
    case 'blackhole':
      return 1;
    default:
      return null;
  }
}

/**
 * How much print a scale gets. §2.8 splits by medium, so this is a property of
 * where you are standing, not a preference — vacuum genuinely delivers zero
 * photons and an atmosphere genuinely never does.
 *
 * The planet scale is the interesting one: it spans both. It begins in orbit,
 * which is vacuum, and ends on the ground, which is not, so it interpolates on
 * altitude — the same descent that drives the hyperzoom drives the grade,
 * which is what §3 asks for.
 */
export function paintForScale(scale) {
  switch (scale?.kind) {
    case 'cosmic':
    case 'galaxy':
    case 'system':
    case 'blackhole':
      return 0;
    case 'surface':
    case 'clouds':
      return 1;
    case 'planet': {
      // altUnits is in planet radii above the ground
      const alt = scale.altUnits ?? 1;
      // full print by ~2 km, none above ~1 planet radius of altitude
      return Math.min(Math.max(1 - (alt - 0.0003) / 0.35, 0), 1);
    }
    default:
      return 0;
  }
}
