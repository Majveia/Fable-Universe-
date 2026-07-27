// The light model — CLAUDE.md §9.2. M2 act 3.
//
// One function. Every lit surface in an atmosphere goes through it, which is
// why §M2 says to port it before the materials it will light: build the
// materials first and they get tuned against a light model that is about to be
// replaced, and then tuned again.
//
// Ported from `docs/reference/hoshi-no-tani.html` lines 622–681 rather than
// from §9.2's summary, per §9: when the section and the file disagree, the file
// wins.
//
// ---------------------------------------------------------------------------
// The five ideas, and which one a PBR reflex will delete
//
// 1. **Half-Lambert wrap**, `ndl·0.62 + 0.46`. Non-negotiable at low sun. §9.7
//    forces spawn into an 8–18° band; a 13.5° sun grazes flat ground at
//    `ndl ≈ 0.23`, and plain Lambert drops the whole valley floor into the
//    shade band. Golden hour would read as dusk. The wrap lifts that same
//    ground to 0.60 — the middle of the ramp, which is where it belongs.
//
// 2. **A three-stop hue ramp with visibly banded edges**, at 0.17 and 0.58.
//    This is the single largest contributor to the illustrated look and it is
//    the first thing a physically-based instinct removes, because a band edge
//    looks exactly like quantisation. §11 lists it by name. The edges also
//    carry a per-surface `jit` — a painterly wobble, so the band is *drawn*
//    rather than computed.
//
// 3. **Shadows change hue, they do not go black.** `col·0.80 + shadowTint·0.040`,
//    never toward zero. A shadowed surface that has gone achromatic-dark is a
//    gate failure under §M2, stated in those words.
//
// 4. **Hemispheric ambient tints rather than washes.** The hemi colour is
//    normalised to unit luminance before it multiplies, so it can rotate hue —
//    cool from the sky, warm from the ground bounce — without ever bleaching
//    the palette. Two terms: a 0.22-weight hue rotation and a 0.052-weight
//    additive fill gated on AO.
//
// 5. **The backlight rim**, which the reference annotates *"the connective
//    tissue of the whole image."* Treat that as a spec, not a compliment.
//
// ---------------------------------------------------------------------------
// What is AEON's rather than the reference's
//
// - The four light colours are **uniforms, not literals**. The reference has
//   one star; `starlight.js` derives sun, sky fill, ground bounce and shadow
//   tint from any star's spectrum through the transfer §9.6 asks for.
// - The sun direction rides in the `Surf` struct instead of a global uniform,
//   so the chunk can be dropped into a shader that already has its own naming
//   without a collision.
// - The three ramp stops are inputs. They are a *material* property, and
//   materials are act 4; this file lights whatever it is handed.

import { STOPS, airColours, hexToLinear } from './starlight.js';

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * The three-colour hue path. Transitions are soft but **visibly banded** — the
 * edges are the point. `soft` sets the width, `jit` slides both edges together
 * so a surface can wobble its own bands.
 */
export function ramp3(t, shade, mid, lit, soft, jit) {
  const a = smoothstep(0.17 - soft + jit, 0.17 + soft + jit, t);
  const b = smoothstep(0.58 - soft + jit, 0.58 + soft + jit, t);
  return mix3(mix3(shade, mid, a), lit, b);
}

/**
 * §9.2, on the CPU. `s` is the surface, `L` the light set from `lightFor()`.
 *
 * s: { N, V, L: sunDir, shade, mid, lit, soft, jit, shadow, trans, transCol,
 *      rim, ao, ambient }
 */
export function paint(s, L) {
  const ndl = dot3(s.N, s.L);
  const wrap = clamp01(ndl * 0.62 + 0.46);
  const t = wrap * (0.34 + (1 - 0.34) * s.shadow);
  let col = ramp3(t, s.shade, s.mid, s.lit, s.soft, s.jit);

  const litAmt = smoothstep(0.34, 0.86, t);
  const sunGain = mix3([0.94, 0.94, 0.94], L.sun.map((v) => v * 1.32), litAmt * 0.62);
  col = [col[0] * sunGain[0], col[1] * sunGain[1], col[2] * sunGain[2]];

  // shadows change hue, they do not go black
  const shaded = col.map((v, i) => v * 0.80 + L.shadowTint[i] * 0.040);
  col = mix3(shaded, col, s.shadow * 0.82 + 0.18);

  // hemispheric ambient — a tint, not a wash
  const hemi = mix3(L.ambGnd, L.ambSky, s.N[1] * 0.5 + 0.5);
  const hueOnly = hemi.map((v) => v / Math.max(luma(hemi), 1e-3));
  const rot = mix3([1, 1, 1], hueOnly, 0.22 * s.ambient * (1 - litAmt * 0.55));
  col = col.map((v, i) => v * rot[i]);
  col = col.map((v, i) => v + hemi[i] * 0.052 * s.ambient * s.ao * (1 - litAmt * 0.85));

  // backlight rim — the connective tissue of the whole image
  const back = smoothstep(0.05, 0.85, -dot3(s.V, s.L));
  const fres = Math.pow(1 - clamp01(dot3(s.N, s.V)), 4.2);
  col = col.map((v, i) => v + L.sun[i] * (fres * back * s.rim * 1.15 * s.shadow));

  // subsurface transmission: light coming *through*, not bouncing off
  if (s.trans > 0.001) {
    const tr = Math.pow(clamp01(-dot3(s.V, s.L)), 3.2);
    const thin = Math.pow(clamp01(1 - Math.abs(dot3(s.N, s.L))), 2.2);
    col = col.map((v, i) => v + s.transCol[i] * tr * thin * s.trans * s.shadow * 0.52);
  }

  return col.map((v) => v * s.ao);
}

/**
 * The four light colours for a world, from its star. Linear RGB.
 *
 * `airColours()` already derives them — this only names the four §9.2 reads, so
 * a caller does not have to know which entries of a ten-stop table are lights.
 */
export function lightFor(T, elev) {
  const a = airColours(T, elev);
  return { sun: a.sunLight, ambSky: a.ambSky, ambGnd: a.ambGnd, shadowTint: a.shadowTint };
}

/** the fixture's lights, for a temperate world — §9.1's four values exactly */
export const REFERENCE_LIGHT = {
  sun: hexToLinear(STOPS.sunLight.hex),
  ambSky: hexToLinear(STOPS.ambSky.hex),
  ambGnd: hexToLinear(STOPS.ambGnd.hex),
  shadowTint: hexToLinear(STOPS.shadowTint.hex),
};

/**
 * The same arithmetic as GLSL, for injection into any fragment shader.
 *
 * It declares its own four light uniforms and carries the sun direction in the
 * struct, so it collides with nothing. Include it once per shader; call
 * `paint()` per lit fragment.
 */
export const PAINT_GLSL = /* glsl */`
  uniform vec3 uPaintSun;
  uniform vec3 uPaintAmbSky;
  uniform vec3 uPaintAmbGnd;
  uniform vec3 uPaintShadowTint;

  struct Surf {
    vec3 N; vec3 V; vec3 L;      // normal, surface->eye, surface->sun
    vec3 shade; vec3 mid; vec3 lit;
    float soft;                  // band softness
    float jit;                   // painterly wobble of the band edges
    float shadow;                // 0 shadowed .. 1 lit
    float trans; vec3 transCol;  // subsurface transmission
    float rim; float ao; float ambient;
  };

  // three-colour hue path; transitions are soft but visibly banded
  vec3 ramp3(float t, vec3 shade, vec3 mid, vec3 lit, float soft, float jit) {
    float a = smoothstep(0.17 - soft + jit, 0.17 + soft + jit, t);
    float b = smoothstep(0.58 - soft + jit, 0.58 + soft + jit, t);
    return mix(mix(shade, mid, a), lit, b);
  }

  vec3 paint(Surf s) {
    float ndl = dot(s.N, s.L);
    // Half-Lambert. A 13.5 degree sun grazes flat ground at ndl about 0.23;
    // plain Lambert would drop the whole valley floor into the shade band and
    // golden hour would read as dusk.
    float wrap = clamp(ndl * 0.62 + 0.46, 0.0, 1.0);
    float t = wrap * mix(0.34, 1.0, s.shadow);
    vec3 col = ramp3(t, s.shade, s.mid, s.lit, s.soft, s.jit);

    float litAmt = smoothstep(0.34, 0.86, t);
    col *= mix(vec3(0.94), uPaintSun * 1.32, litAmt * 0.62);

    // shadows change hue, they do not go black
    col = mix(col * 0.80 + uPaintShadowTint * 0.040, col, s.shadow * 0.82 + 0.18);

    // Hemispheric ambient TINTS rather than washes: normalised to unit
    // luminance so it can rotate hue without ever bleaching the palette.
    vec3 hemi = mix(uPaintAmbGnd, uPaintAmbSky, s.N.y * 0.5 + 0.5);
    vec3 hueOnly = hemi / max(dot(hemi, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
    col *= mix(vec3(1.0), hueOnly, 0.22 * s.ambient * (1.0 - litAmt * 0.55));
    col += hemi * 0.052 * s.ambient * s.ao * (1.0 - litAmt * 0.85);

    // backlight rim — the connective tissue of the whole image
    float back = smoothstep(0.05, 0.85, dot(s.V, -s.L));
    float fres = pow(1.0 - clamp(dot(s.N, s.V), 0.0, 1.0), 4.2);
    col += uPaintSun * (fres * back * s.rim * 1.15 * s.shadow);

    // subsurface transmission: light coming THROUGH, not bouncing off
    if (s.trans > 0.001) {
      float tr = pow(clamp(dot(s.V, -s.L), 0.0, 1.0), 3.2);
      float thin = pow(clamp(1.0 - abs(dot(s.N, s.L)), 0.0, 1.0), 2.2);
      col += s.transCol * tr * thin * s.trans * s.shadow * 0.52;
    }

    col *= s.ao;
    return col;
  }
`;
