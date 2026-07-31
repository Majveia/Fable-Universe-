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
// §9.4 steps 5 (watercolour softening at 0.42 × fog) and its chroma bleed are
// the two steps that read a *distance*. That distance now exists — `aerial.js`
// writes §9.3's fog fraction into alpha and `tools/alphaudit.js` proves it
// arrives here — so what these two were waiting on is no longer missing. They
// are the only part of §9.4 still owed.
//
// Everything else — tonemap, shadow/highlight push, lift, S-curve, midtone
// saturation, paper tooth, vignette, dither — is complete.

import * as THREE from 'three';

export const PRINT_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uBloom: { value: null },    // §9.4's step order: the bloom composites here
    uBloomAmt: { value: 0 },
    uPaint: { value: 0 },       // 0 vacuum · 1 atmosphere (§2.8, §3 row 1)
    uExposure: { value: 1 },
    uGrain: { value: 1 },
    uVignette: { value: 1 },
    uRes: { value: new THREE.Vector2(1, 1) },
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
    uniform float uPaint, uExposure, uGrain, uVignette;
    uniform vec2 uRes;
    varying vec2 vUv;

    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    // §9.4 step 1 — a rational curve. Not ACES. Not Reinhard.
    vec3 tonemapPrint(vec3 x) {
      vec3 a = x * (x * 0.36 + 0.42);
      vec3 b = x * (x * 0.34 + 0.66) + 0.11;
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
      return mix(tonemapVacuum(x), tonemapPrint(x), paint);
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
      // §9.3's fog fraction rides in alpha, and the audit that proved it
      // arrives intact also found the one thing that dirties it: three's preset
      // AdditiveBlending is (SRC_ALPHA, ONE) on the *alpha* channel too, so an
      // additive sprite adds its own alpha on top of the scene's. Measured on
      // the surface scale, that is 0.039% of pixels, reaching 1.55.
      //
      // Clamped here, at the one place the value is read, rather than at each
      // of the dozens of places it is written. tools/alphaudit.js still reports
      // the raw channel, so this bounds the damage without hiding it.
      float fog = clamp(src.a, 0.0, 1.0);
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
      c += max(bl, vec3(0.0)) * uBloomAmt;

      c = tonemap(c * uExposure, uPaint);

      // §9.4 step 2 — shadows to violet, highlights to cream.
      // The reference annotates this "the single biggest lever." It is.
      float l = luma(c);
      vec3 shadowPush = mix(vec3(0.90, 0.95, 1.16), vec3(1.0), smoothstep(0.0, 0.34, l));
      vec3 highPush   = mix(vec3(1.0), vec3(1.055, 1.012, 0.925), smoothstep(0.44, 0.98, l));
      c *= mix(vec3(1.0), shadowPush, 0.85 * uPaint) * mix(vec3(1.0), highPush, 0.9 * uPaint);

      // §9.4 step 3 — the lift, and §2.8's whole argument in one line: it is
      // scaled by uPaint, so in vacuum it is exactly zero and black stays black
      vec3 lift = vec3(0.017, 0.021, 0.036) * uPaint;
      c = c * (1.0 - lift) + lift;

      // §9.4 step 4 — a gentle S, then saturation in the midtones only
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.16 * uPaint);
      l = luma(c);
      float satBoost = 1.0 + 0.16 * uPaint
        * smoothstep(0.10, 0.42, l) * (1.0 - smoothstep(0.62, 0.96, l));
      c = mix(vec3(l), c, satBoost);

      // §9.4 step 6 — paper tooth: two octaves, ±3% grain plus 1% fibre
      vec2 gp = vUv * uRes / 2.4;
      float grain = pn2(gp * 0.5) * 0.62 + pn2(gp * 0.13 + 11.0) * 0.38;
      float fibre = pn2(vec2(vUv.x * uRes.x * 0.06, vUv.y * uRes.y * 0.9));
      c *= 1.0 + grain * 0.030 * uGrain * uPaint + fibre * 0.010 * uGrain * uPaint;

      // §9.4 step 7 — warm-dark vignette
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      float vig = pow(clamp(1.0 - r2 * 1.15, 0.0, 1.0), 1.55);
      c *= mix(vec3(1.0), mix(vec3(0.62, 0.60, 0.66), vec3(1.0), vig), uVignette * uPaint);

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

      // the fog fraction passes through, bounded — §9.4 steps 5 and 5b are the
      // two that will read it, and they are the only thing still owed here
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), fog);
    }
  `,
};

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
