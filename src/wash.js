// §9.4 steps 5 and 5b — the two print steps that read a distance.
//
// Split from `soft.js` for the same reason `aerial.js` is split from the
// shaders that call it: **one file owns the arithmetic in both languages.**
// `soft.js` builds the wash on the GPU and imports three to do it, which puts
// it out of reach of `tools/verify.js`; this file has no dependencies at all,
// so the CPU twin the suite tests is the shipped one rather than a
// transcription of it. This repo has now removed that duplicate twice.
//
// §9.4:
//
//   > **Watercolour softening tied to distance** — a blurred tap blended at
//   > `0.42 × fog`. Wet-in-wet, *not* bokeh. Plus chroma bleed at
//   > `0.09 + 0.17·wet`: paint runs, pixels do not.

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * §9.4 steps 5 and 5b, on the CPU. `c` is the graded pixel, `soft` the same
 * pixel from the wash above, `fog` §9.3's fraction out of the alpha channel.
 *
 * Two properties are worth stating because they are what the checks assert and
 * what makes this paint rather than defocus:
 *
 * 1. **The bleed is exactly luminance-preserving.** It replaces the pixel with
 *    its own luminance plus the wash's *chrominance*, and the wash's chroma has
 *    zero luminance by construction — so no amount of bleed can move a pixel's
 *    brightness. Every edge in the image stays exactly where it was while the
 *    colour runs. That is the sentence "paint runs, pixels do not", as algebra.
 *
 * 2. **The bleed has a floor and the softening does not.** At `fog = 0` the
 *    softening is exactly nothing and the bleed is still 0.09. That is the
 *    reference's, deliberately — its own comment records that the bleed used to
 *    be a flat 20% everywhere and that moving it onto distance is the fix, not
 *    removing it. A little chroma runs even in the foreground; a watercolour
 *    with perfectly crisp near colour is a print of a watercolour.
 */
export function soften(c, soft, fog, paint = 1) {
  const wet = Math.min(Math.max(fog * 0.85, 0), 1);
  const t = wet * 0.42 * paint;
  let out = [c[0] + (soft[0] - c[0]) * t, c[1] + (soft[1] - c[1]) * t, c[2] + (soft[2] - c[2]) * t];

  const lc = luma(out);
  const ls = luma(soft);
  const bleed = (0.09 + 0.17 * wet) * paint;
  out = out.map((v, i) => v + ((lc + (soft[i] - ls)) - v) * bleed);
  return { col: out, wet };
}

/**
 * The same arithmetic as GLSL, for `print.js` to interpolate. It takes the wash
 * as a parameter rather than sampling it, so the firewall stays at the tap
 * where the print already has one.
 */
export const WASH_GLSL = /* glsl */`
  // §9.4 step 5 — watercolour softening, tied to distance — and 5b, the chroma
  // bleed. The pixel keeps its own luminance and takes the wash's chrominance,
  // and the wash's chroma has zero luminance by construction, so no amount of
  // bleed can move a pixel's brightness. Colour runs a long way; every edge
  // stays exactly where it was. That is the difference between a watercolour
  // and a smudge, and it is why the wash is allowed to be as wide as it is.
  //
  // The 0.09 floor is the reference's and is deliberate: a little chroma runs
  // even in the foreground. Its own note records that this used to be a flat
  // 20% everywhere and that putting it on distance was the fix, not deleting it.
  vec3 soften(vec3 c, vec3 wash, float fog, float paint) {
    float wet = clamp(fog * 0.85, 0.0, 1.0);
    c = mix(c, wash, wet * 0.42 * paint);
    float lc = dot(c, vec3(0.2126, 0.7152, 0.0722));
    vec3 chroma = wash - vec3(dot(wash, vec3(0.2126, 0.7152, 0.0722)));
    return mix(c, vec3(lc) + chroma, (0.09 + 0.17 * wet) * paint);
  }
`;

/** wet, on its own — the print reports it and the suite asserts where it saturates */
export const wetFor = (fog) => Math.min(Math.max(fog * 0.85, 0), 1);
