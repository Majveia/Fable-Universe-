// The coverage field, and the one place it is written down.
//
// This chunk used to live in `clouds.js`, whose own note (still there, above
// the import) states the invariant:
//
//   "One field decides two things: whether a puff is drawn at all, and — when
//    surface.js grows a shadow pass — where its shadow falls. ... a shadow must
//    always belong to a cloud you can point at."
//
// It moved here for one reason: `clouds.js` imports three, and cloudshade.js
// must not, or it cannot be tested in Node. That is the same property
// `src/material.js` and `src/meadow.js` have and it was bought the same way —
// by keeping the arithmetic in a file that owns no meshes.
//
// Nothing else changed. `clouds.js` re-exports `CLOUD_FIELD_GLSL` so every
// caller and every check that names it keeps working, and `cloudField()` returns
// exactly what it returned before: the same three chains, the same weights, the
// same transition.
//
// ---------------------------------------------------------------------------
// The one addition
//
// `cloudFieldRaw()` is the field *before* its smoothstep, with the octave count
// of each chain as a parameter. Two callers want two different things from one
// field: the deck wants coverage at full detail, and the shadow wants the raw
// value so it can put the transition where the sun's angular size says it goes
// (cloudshade.js §2). Splitting the readout from the field is what lets them
// disagree about the edge and agree about everything else.

export const CLOUD_FIELD_GLSL = /* glsl */`
uniform vec2 uCloudDrift;    // metres, from the shared wind field
uniform float uCloudAmount;  // 0 clear .. 1 overcast

vec2 cfHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}
float cfNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return 1.4 * mix(
    mix(dot(cfHash2(i), f), dot(cfHash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(cfHash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(cfHash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}
float cfFbm(vec2 p, int oct) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    if (i >= oct) break;
    v += a * cfNoise(p); p = p * 2.07 + 11.3; a *= 0.5;
  }
  return v;
}
// The field before its transition. Octave counts are parameters because the
// deck and its shadow want different amounts of the same field — see
// cloudshade.js on why the sun's angular size decides how much survives.
float cloudFieldRaw(vec2 q, int octW, int octF, int octG) {
  vec2 p = (q - uCloudDrift) * 0.00071;
  vec2 w = vec2(cfFbm(p * 1.55 + vec2(11.3, 4.7), octW),
                cfFbm(p * 1.55 + vec2(37.1, 19.2), octW));
  float f = cfFbm(p + w * 0.62, octF);
  float g = cfFbm(p * 3.7 + w * 1.1, octG);
  return f * 0.78 + g * 0.22;
}
// Evaluated per *vertex*, four times per puff — not per fragment. That is the
// whole reason it can afford a domain warp.
float cloudField(vec2 q) {
  return clamp(smoothstep(-0.035, 0.30, cloudFieldRaw(q, 3, 4, 3)) * uCloudAmount,
               0.0, 1.0);
}
`;
