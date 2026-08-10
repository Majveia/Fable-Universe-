// SCALE 0 — THE COSMIC WEB
//
// A live structure-formation simulation. Dark-matter tracer particles evolve
// under the Zel'dovich approximation of ΛCDM perturbation theory:
//
//     x(q, a) = q + D(a) · ψ(q)
//
// where q is the initial (Lagrangian) position, D(a) is the linear growth
// factor integrated from the Friedmann equation (see cosmology.js), and ψ is
// a Gaussian random displacement field with a power-law spectrum, synthesized
// as a sum of plane waves — evaluated analytically per particle, per frame,
// in the vertex shader. As the user plays cosmic time forward, voids empty
// and matter drains into walls, filaments and nodes: the cosmic web.
//
// The same analytic field is mirrored on the CPU so a click can find the
// nearest density peak (gradient ascent on δ) and dive into a galaxy there.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { A_OPEN, A_START, COSMO } from './cosmology.js';
import { hash, RNG } from './rng.js';
import { NBodySim, NBODY_LAYOUT } from './nbody.js';
import { softDotTexture } from './nebula.js';
import {
  N_MODES, buildModes, deltaLinear, gradDeltaLinear,
} from './zeldovich.js';
import { qInt } from './quality.js';

const BOX = 900;           // comoving box, display units (≙ ~500 Mpc)
// A_START and A_OPEN live in cosmology.js — see the note there. They are
// epoch constants, and `tools/verify.js` has to be able to read them without a
// renderer, which a module that imports three cannot offer.

const PARAM = (k) => {
  try { return new URL(window.location.href).searchParams.get(k); }
  catch { return null; }
};

/**
 * M1 — the web must breathe. **Now default-on**; `?m1=0` restores the old web.
 *
 * docs/plans/M1.md records the gate honestly: clauses (a), (c), (d) and (e)
 * pass, and clause (b) — four distinguishable hue families — reached three and
 * is blocked on a compositing change of its own size, not on a palette tweak.
 * §7 caps that at five iterations and then asks for an escalation with a
 * written account of the blocking axis, which §12 and §13 of that plan are.
 *
 * What is *not* defensible is what shipping default-off meant in the meantime:
 * the scale a visitor actually lands on was the pre-M1 one, so none of the four
 * clauses that pass — the growth-factor drift, the N-toggle, the dither, the
 * anisotropic kernel — were in any frame anyone saw. A milestone that is four
 * fifths met and zero fifths visible is the worst of both. The flag stays, so
 * `?m1=0` still produces the old frame for a comparison, and clause (b) stays
 * open in the ledger where it can be argued with.
 */
const M1 = PARAM('m1') !== '0';

/**
 * `?slab=<fraction>` — render a view-aligned slice through the box instead of
 * the whole depth. `?slab=1` takes the default fraction; any number sets it.
 *
 * This is the experiment M1's escalation asks for (docs/plans/M1.md §9). The
 * blocking clause was four distinguishable hue families, and the diagnosis was
 * that the colour is honest but the projection destroys it: every ray crosses
 * voids *and* filaments, and an additive sum of differing hues is a
 * mass-weighted mean hue. A slab shortens the ray so a local field survives to
 * the frame.
 *
 * It only means anything with ?m1=1, because it is the M1 shaders that put a
 * physical field in the hue channel at all.
 */
/**
 * `?comp=1` — depth-reject the tracers instead of summing all of them.
 *
 * M1's blocked clause is four hue families, and eight iterations established
 * that the colour is right and the *compositing* is not: 262k additively
 * blended points integrated along a ray means every pixel carries a
 * mass-weighted mean hue, and a mean has no families. Depth-testing lets the
 * nearest tracer at a pixel keep it and rejects what is behind, which is the
 * one thing in that path that can restore a local field to the frame.
 *
 * Order is the geometry buffer's, which is fixed, so the result is stable —
 * but it is *arbitrary* with respect to depth, and that is the honest caveat:
 * this rejects a lot of contamination without being a correct back-to-front
 * resolve.
 *
 * Measured afterwards: it changes 96% of the pixels and 0% of the hue
 * distribution (docs/plans/M1.md §12). The tracers it rejects turn out to have
 * the same hue as the ones it keeps, because a thin slab already guarantees
 * that a ray crosses one structure — so the diagnosis this was built for was
 * wrong, and the concentration is a unimodal *field*, not an averaged one.
 *
 * Kept anyway, on a flag: it costs nothing when off, and a frame where the
 * nearest structure owns its pixels is a defensible thing to be able to ask
 * for. It is simply not the fix for gate (b).
 */
const COMPOSITE_DEPTH = PARAM('comp') === '1';

/**
 * The second hue channel (`?web=0` to disable) — structure class from the
 * tensor's eigenvalue signature, on top of the divergence ramp. M1 §12 option
 * B, and **now default-on**.
 *
 * It is the one change that moved the blocked clause: docs/plans/M1.md §13
 * measures the hue-family count going from 2 to 3, with peaks at 210° and 170°
 * where before there was one. Void amber and knot violet are on screen and
 * selected by physics. It costs nothing when the eigenvalues are already being
 * computed for the displacement, and the alternative — shipping the ramp alone
 * because the channel did not get all the way to four — throws away a measured
 * improvement to protect a number that a rendering change, not this one, is
 * what blocks.
 */
const WEB_CLASS = PARAM('web') !== '0';

const SLAB = (() => {
  const v = PARAM('slab');
  if (v === null) return 0;
  const f = v === '1' ? 0.16 : parseFloat(v);
  return Number.isFinite(f) && f > 0 && f < 1 ? f : 0;
})();

// how far past the present day deep time keeps drifting, and how much slower
// it runs once it gets there — §M1 asks for a continuous slow drift, and a
// clock that stops at a = 1 is a frozen clock
const A_FUTURE = 7.5;
const FUTURE_RATE = 0.11;

const vert = /* glsl */`
  uniform vec3  uK[${N_MODES}];
  uniform vec2  uAP[${N_MODES}];   // (amplitude, phase)
  uniform float uD;                // growth factor D(a)
  uniform float uAScale;           // 1 = comoving view, a = physical view
  uniform float uPx;               // pixel-ratio size boost
  uniform float uTime;
  varying float vDelta;
  varying float vEdge;
  varying float vHash;
  varying float vNova;
  varying vec3 vQ;

  void main() {
    vec3 q = position;
    // every tracer keeps its own clock: a hash for twinkle and hue, and —
    // for one particle in two thousand — a supernova schedule
    vHash = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vNova = 0.0;
    if (vHash > 0.9995) {
      float lc = fract(uTime / 90.0 + vHash * 991.0);
      vNova = max(0.0, 1.0 - lc * 30.0);
      vNova *= vNova;
    }
    vec3 disp = vec3(0.0);
    float div = 0.0;
    for (int i = 0; i < ${N_MODES}; i++) {
      vec3 k = uK[i];
      float kl = length(k);
      float ph = dot(k, q) + uAP[i].y;
      float amp = uAP[i].x;
      disp += (amp / kl) * k * sin(ph);
      div  += amp * kl * cos(ph);
    }
    vec3 x = (q + uD * disp) * uAScale;
    vQ = x;

    // linear-theory overdensity δ = -D ∇·ψ, boosted toward the Zel'dovich
    // nonlinear estimate 1/(1 - Dδ_l) where collapse is underway
    float dlin = -uD * div;
    float rho = 1.0 / max(1.0 - 0.55 * dlin, 0.12);
    vDelta = dlin;

    // fade the hard box boundary away
    vec3 aq = abs(q) / ${(BOX / 2).toFixed(1)};
    vEdge = 1.0 - smoothstep(0.86, 1.0, max(aq.x, max(aq.y, aq.z)));

    vec4 mv = modelViewMatrix * vec4(x, 1.0);
    float size = uPx * (0.95 + 0.6 * clamp(rho - 0.6, 0.0, 2.6)) * (1.0 + vNova * 3.5);
    gl_PointSize = clamp(size * (620.0 / -mv.z), 0.75, 9.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const frag = /* glsl */`
  precision highp float;
  uniform float uTime;
  varying float vDelta;
  varying float vEdge;
  varying float vHash;
  varying float vNova;
  varying vec3 vQ;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    float fall = exp(-r2 * 11.0);

    // voids: near-black indigo · filaments: cold blue-violet · nodes: hot white-gold
    // — and none of it holds one color: the palette breathes across the box
    float t = clamp(vDelta * 0.75, -1.0, 2.5);
    float hueT = 0.5 + 0.5 * sin(uTime * 0.045 + vQ.y * 0.003);
    float warmT = 0.5 + 0.5 * sin(uTime * 0.03 + vQ.x * 0.002);
    vec3 voidC = vec3(0.055, 0.06, 0.16);
    vec3 filC  = mix(vec3(0.30, 0.38, 1.00), vec3(0.52, 0.28, 0.98), hueT);
    vec3 nodeC = mix(vec3(1.35, 1.12, 0.78), vec3(1.42, 0.92, 0.86), warmT);
    vec3 col = t < 0.35
      ? mix(voidC, filC, smoothstep(-1.0, 0.35, t))
      : mix(filC, nodeC, smoothstep(0.35, 2.2, t));
    // no two lights are quite the same color, and none holds still
    col *= vec3(1.0 + 0.10 * sin(vHash * 6.283), 1.0 + 0.07 * sin(vHash * 12.6 + 2.0), 1.0 + 0.12 * cos(vHash * 6.283));
    float lum = 0.035 + 0.11 * smoothstep(-0.9, 0.1, t) + 0.38 * smoothstep(0.35, 2.6, t);
    lum *= 0.86 + 0.14 * sin(uTime * (0.4 + vHash * 1.8) + vHash * 40.0);
    // slow waves of brightness roll along the filaments like weather
    lum *= 0.82 + 0.18 * sin(dot(vQ, vec3(0.011, 0.007, 0.009)) - uTime * 0.55)
               + 0.12 * sin(dot(vQ, vec3(-0.006, 0.012, -0.008)) + uTime * 0.31);
    // a supernova blooms white and dies ember-red
    col += mix(vec3(1.4, 0.55, 0.32), vec3(1.9, 1.8, 1.55), vNova) * vNova * 2.4;

    gl_FragColor = vec4(col * (lum + vNova) * fall * vEdge, 1.0);
  }
`;

// ===========================================================================
// M1 · the web must breathe
//
// Everything below replaces a sine with something the simulation already
// knows. The derivation is in docs/plans/M1.md §2; the arithmetic is checked
// against finite differences and an eigen-decomposition by tools/verify.js
// before it ever reaches a driver (§7.3).

/** the deformation tensor and its invariants — the whole milestone, shared by
 *  both the linear and the N-body vertex shaders */
const M1_TENSOR = /* glsl */`
  // M is symmetric: (xx, yy, zz, xy, xz, yz). r·M·r and u·M·v, packed.
  float qform(float m0, float m1, float m2, float m3, float m4, float m5, vec3 v) {
    return m0*v.x*v.x + m1*v.y*v.y + m2*v.z*v.z
         + 2.0*(m3*v.x*v.y + m4*v.x*v.z + m5*v.y*v.z);
  }
  float bform(float m0, float m1, float m2, float m3, float m4, float m5, vec3 u, vec3 v) {
    return m0*u.x*v.x + m1*u.y*v.y + m2*u.z*v.z
         + m3*(u.x*v.y + u.y*v.x) + m4*(u.x*v.z + u.z*v.x) + m5*(u.y*v.z + u.z*v.y);
  }

  // The screen-space thread axis: project the tensor onto the view plane and
  // decompose the 2x2 exactly. A filament runs along the least-compressed
  // axis, which is the eigenvector of the larger eigenvalue.
  //   axis  — unit direction in screen space
  //   aniso — 0 round, 1 fully directional
  // The divergence transfer. θ/(aHf·D) is not symmetric about zero and never
  // could be: outflow is bounded — a void can only empty so fast — while infall
  // runs away as an element collapses. Measured on the mass-weighted
  // distribution at D = 0.52: p10 = −7.4 against p90 = +1.1, a negative tail six
  // times the length of the positive side, with 3.5% already shell-crossed.
  //
  // A linear scale cannot spread that. Divide by enough to keep the tail and
  // the middle collapses to one hue; divide by little and a third of the sky
  // clamps to the infall end — which is exactly what the frame showed, 31.9%
  // pinned at −1 and 41% of lit pixels inside one 10° hue bucket.
  //
  // Signed log carries a long tail into a bounded range without a clamp. It is
  // still strictly monotone in θ, so nothing about the readout is invented: the
  // ordering is the physics, and this is the transfer that makes it visible —
  // §9.6's argument for deriving stops through a fixed transfer rather than
  // choosing them by eye, applied to the divergence instead of the sky.
  //
  // Referenced to |θ/(aHf·D)| = 12, which the same measurement puts near the
  // 1st percentile. Clamping falls from 31.9% to 8.8%.
  float compressTheta(float x) {
    return clamp(sign(x) * log(1.0 + abs(x)) * 0.3899, -1.0, 1.0);
  }

  // The eigenvalues of the symmetric 3×3, descending. Closed form (Smith 1961)
  // — the exact arithmetic of zeldovich.js's eigenvalues(), which is checked
  // against a Jacobi iteration in tools/verify.js. §2.7's discipline: one
  // definition, ported rather than re-derived, because a drift between the two
  // would look like a rendering bug.
  vec3 eig3(float m0, float m1, float m2, float m3, float m4, float m5) {
    float p1 = m3*m3 + m4*m4 + m5*m5;
    float q = (m0 + m1 + m2) / 3.0;
    if (p1 < 1e-20) {
      vec3 d = vec3(m0, m1, m2);
      float hi = max(d.x, max(d.y, d.z));
      float lo = min(d.x, min(d.y, d.z));
      return vec3(hi, d.x + d.y + d.z - hi - lo, lo);
    }
    float p2 = (m0-q)*(m0-q) + (m1-q)*(m1-q) + (m2-q)*(m2-q) + 2.0*p1;
    float p  = sqrt(p2 / 6.0);
    float ip = 1.0 / p;
    float b0 = (m0-q)*ip, b1 = (m1-q)*ip, b2 = (m2-q)*ip;
    float b3 = m3*ip,     b4 = m4*ip,     b5 = m5*ip;
    float det = b0*(b1*b2 - b5*b5) - b3*(b3*b2 - b5*b4) + b4*(b3*b5 - b1*b4);
    float phi = acos(clamp(det * 0.5, -1.0, 1.0)) / 3.0;
    float e0 = q + 2.0*p*cos(phi);
    float e2 = q + 2.0*p*cos(phi + 2.0943951);
    return vec3(e0, 3.0*q - e0 - e2, e2);
  }

  // How many principal axes have collapsed — the T-web classification, as a
  // continuous count in [0, 3]. See zeldovich.js for why the threshold has to
  // be nonzero (with λ_th = 0 the class never changes, because D scales the
  // eigenvalues but cannot flip their sign) and why the count is smoothed (a
  // hard count puts a hue discontinuity between neighbouring tracers, and the
  // web reads as four flat stencils).
  float webCount(vec3 lam, float D) {
    const float LTH = 0.2, W = 0.12;
    vec3 stretch = vec3(1.0) + D * lam;
    // written out rather than smoothstep(hi, lo, x): GLSL leaves a reversed-edge
    // smoothstep undefined, and this has to match zeldovich.js exactly
    vec3 t = clamp((vec3(1.0 - LTH + W) - stretch) / (2.0 * W), 0.0, 1.0);
    vec3 c = t * t * (3.0 - 2.0 * t);
    return c.x + c.y + c.z;
  }

  vec3 threadAxis(float a, float b, float c) {
    float mean = 0.5*(a + c);
    float diff = 0.5*(a - c);
    float rad  = sqrt(diff*diff + b*b);
    float phi  = 0.5 * atan(2.0*b, a - c);
    float aniso = rad / (rad + abs(mean) + 1e-7);
    return vec3(cos(phi), sin(phi), aniso);
  }
`;

/**
 * Surface brightness across the zoom range — the LOD §5 asks for *before* the
 * feature, and the thing that makes `minDistance = 6` mean anything.
 *
 * A point sprite whose side is proportional to 1/d spreads a flux that falls as
 * 1/d² over an area that falls as 1/d², so its surface brightness is constant —
 * which is why the scale looks right at its opening distance and only there.
 * Both clamps break it, in opposite directions:
 *
 *   at the floor (0.75 px, far away) the sprite is *too large* for its flux, so
 *   the deep field never dims as the camera pulls back and the box stays a
 *   uniform sheet however far away it is;
 *
 *   at the ceiling the sprite is too small for its flux, so flying into a
 *   filament stacks tracers that should have spread out and the frame goes to a
 *   white wall — which is what `minDistance = 6` would otherwise buy.
 *
 * The rule below holds a tracer's *total* light fixed once it is resolved and
 * lets it fall as 1/d² once it is not. That is a compression, not a lie: the
 * true surface brightness of a mass element being flown into rises without
 * bound, the display cannot hold four decades of it, and this is monotone in
 * distance so nothing about which region is brighter than which ever inverts —
 * the same argument `compressTheta()` makes for the divergence.
 */
const M1_LOD = /* glsl */`
  float tracerFlux(float ideal, float px) {
    float s = min(ideal, 4.0) / max(px, 1e-4);
    return clamp(s * s, 0.05, 1.0);
  }
`;

/** the slab window: how much of a tracer survives, by depth from the slice */
const M1_SLAB = /* glsl */`
  uniform float uSlabHalf;   // half-thickness in display units; 0 = whole box

  // The slice is view-aligned and centred on the box, so it always faces the
  // camera and turns with it — orbiting sweeps the slice through the volume
  // rather than swinging a fixed plane edge-on. The edge is a smoothstep, not
  // a cut: a hard clip would pop tracers in and out as the camera moves, and
  // §2.5 has no patience for that.
  float slabWeight(float viewZ, float centreZ) {
    if (uSlabHalf <= 0.0) return 1.0;
    float d = abs(viewZ - centreZ) / uSlabHalf;
    return 1.0 - smoothstep(0.55, 1.0, d);
  }
`;

/** the palette — the hue families, and which physics selects each */
const M1_PALETTE = /* glsl */`
  // Luminance carries density. Hue carries the divergence of the flow, on a
  // four-stop ramp read strictly monotonically:
  //
  //   θ ≪ 0  hard infall, collapsed      → violet
  //   θ <  0  infall                     → cold blue
  //   θ ≈  0  barely moving              → teal
  //   θ >  0  outflow                    → warm amber   (voids, emptying)
  //   dense and θ ≈ 0, under gravity     → cream        (virialized: stopped)
  //
  // Four stops rather than a two-colour lerp, because the divergence a tracer
  // actually experiences is not symmetric about zero. Tracers live where the
  // mass is, so the particle-weighted distribution is skewed toward infall,
  // and a straight cool→warm lerp spends almost its whole range inside one
  // hue: measured, the first version put 88% of lit pixels between 220° and
  // 280°. The ramp is still a monotone function of θ — nothing is invented,
  // the transfer is simply spread across the range that occurs, exactly as
  // §9.6 derives its sky stops through a fixed transfer rather than by taste.
  //
  // The cream stop only ever appears under gravity: linear theory cannot
  // virialize, so pressing N genuinely changes what the halo cores are made
  // of, which is what §M1's gate (c) asks the toggle to demonstrate.
  // ---------------------------------------------------------------------
  // The second channel (?web=1) — hue by structure class, value by flow.
  //
  // M1 §12 established that the divergence field cannot supply four hue
  // families: it is unimodal, and a monotone readout of a unimodal scalar has
  // one peak. The tensor's *signature* is an independent channel, and it is
  // the one every published image of the cosmic web is drawn in.
  //
  // The four families are the same four colours the divergence ramp already
  // sweeps, which is not a coincidence and is the reason this reads as the
  // same universe rather than a repaint: voids expand, so the ramp's warm
  // end already lived there; knots collapse hardest, so the violet end
  // already lived there. What changes is that the assignment is now discrete
  // and driven by *how many axes have collapsed* rather than by how fast the
  // element is moving. Divergence keeps a job — it modulates within a family,
  // so the flow is still legible along a filament.
  vec3 webColorClass(float dens, float th, float nClass, float hash) {
    // ---------------------------------------------------------------------
    // The colours are the observed colour–density relation, not a key.
    //
    // The real cosmic web has no intrinsic colour — dark matter emits nothing.
    // What is actually seen is the galaxies tracing it, and their colour is a
    // strong, measured function of exactly the quantity this channel computes.
    // The morphology–density relation (Dressler 1980) and the bimodal galaxy
    // colour distribution (Baldry et al. 2004) say:
    //
    //   void, field      gas-rich, unquenched, actively forming stars
    //                    → the blue cloud, hot young O/B light        #9FC4FF
    //   sheet            still forming, slightly older populations    #CFE0FF
    //   filament         infall begins stripping gas; green valley    #E8E2C4
    //   knot / cluster   ram-pressure stripped, quenched, all old
    //                    stars → the red sequence                     #FFB47A
    //
    // So the palette runs blue in the empty places and red in the dense ones —
    // which is the opposite of the intuition that dense means hot, and it is
    // what the sky actually looks like. A cluster is red because its galaxies
    // stopped making blue stars a long time ago.
    //
    // This also fixes the frame's temperature. The divergence ramp ran violet
    // through amber, which is a false-colour key: legible, and not a photograph
    // of anything. These are stellar-population colours on a black sky.
    //
    // The transitions are narrow on purpose. The count is within 0.15 of an
    // integer for 85% of Lagrangian space (tools/verify.js), so a wide ramp
    // spends its width on a region that barely exists while blending the
    // families that do — measured, 0.15→0.85 edges put 80% of the mass into one
    // 40° hue band and the histogram read two families.
    // ---------------------------------------------------------------------
    // Chroma, and the measurement that forced it up.
    //
    // The stops above were pastels — #9FC4FF through #FFB47A — and an 8-bit
    // frame cannot hold a pastel at the luminance a deep field lives at. The
    // arithmetic is unforgiving: #CFE0FF normalised to unit luminance is
    // (0.93, 1.01, 1.15), a linear saturation of 0.19; through the vacuum
    // tonemap and the sRGB encode that lands as 3.5% saturation, and a tracer
    // printing (95, 98, 104) is **grey**. Measured on the capture: 93.8% of lit
    // pixels achromatic and two hue families, against a gate that wants four.
    //
    // The pastels were also not the physics. Galaxy colours are *strongly*
    // bimodal (Baldry et al. 2004) — the blue cloud is genuinely blue and the
    // red sequence genuinely red — and painting a measured bimodality as two
    // near-whites is the lossy step, not this. So the stops move to the
    // chromaticity the populations actually have, each at least 42° from its
    // neighbours in hue so that additive overlap between two families still
    // resolves as two families rather than as their mean.
    vec3 col = vec3(0.53, 0.63, 1.00);                                    // void: blue cloud, O/B light
    col = mix(col, vec3(0.18, 0.86, 0.92), smoothstep(0.45, 0.55, nClass)); // sheet
    col = mix(col, vec3(1.00, 0.80, 0.20), smoothstep(1.45, 1.55, nClass)); // filament: green valley
    col = mix(col, vec3(1.00, 0.30, 0.32), smoothstep(2.45, 2.55, nClass)); // knot: red sequence

    // Divergence still speaks inside the family — but it may not spend chroma
    // to do it. The previous version pulled up to 22% toward grey, which is
    // exactly the budget this channel has to keep, so flow now modulates
    // saturation *upward* from a saturated base instead of downward from one.
    float flow = clamp(-th, 0.0, 1.0);
    col = mix(vec3(dot(col, vec3(0.2126, 0.7152, 0.0722))), col, 1.0 + 0.18 * flow);

    // Dense, fully collapsed and no longer flowing: it has stopped. Kept far
    // narrower than the divergence ramp's version, because there it was the
    // fifth stop of a monotone sweep and here it competes with a family. At the
    // old width it turned most of the knot class achromatic — 28.9% of the
    // frame — and a family that reads as cream is not a hue.
    float vir = smoothstep(1.90, 2.55, dens)
              * smoothstep(2.80, 2.97, nClass)
              * (1.0 - smoothstep(0.02, 0.12, abs(th)));
    col = mix(col, vec3(1.00, 0.95, 0.86), vir);

    col *= vec3(1.0 + 0.09*sin(hash*6.283),
                1.0 + 0.06*sin(hash*12.6 + 2.0),
                1.0 + 0.10*cos(hash*6.283));
    return col / max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  }

  vec3 webColor(float dens, float th, float crossed, float hash) {
    // ---------------------------------------------------------------------
    // The banded ramp, and why nine iterations missed it.
    //
    // docs/plans/M1.md §12 concluded that four hue families are unreachable:
    // "the mass-weighted divergence field is unimodal, and a strictly monotone
    // transfer of a unimodal scalar produces one dominant hue with tails."
    //
    // That is true of a *continuous* transfer and false of a quantised one.
    // A smooth ramp spends most of its output on the colours *between* its
    // stops, so the histogram peaks wherever the distribution peaks — measured,
    // 53% of lit pixels inside one 10° bucket at 210°, which is the midpoint of
    // mix(blue, teal) and is not one of the four stops at all. A ramp with
    // narrow edges outputs the stop colours themselves almost everywhere, and
    // the histogram becomes four spikes whose heights are the quantiles of θ.
    // The readout is still strictly monotone in θ; nothing about what it means
    // has changed. Only the width of the transitions has.
    //
    // And this is not a trick to beat a measurement — it is §9.2, verbatim:
    //
    //   "Three-stop hue ramp, band edges at 0.17 and 0.58, with a soft width
    //    and a per-surface jit — a painterly wobble on the band edges.
    //    Transitions are soft but *visibly banded*. This is the single largest
    //    contributor to the illustrated look, and the first thing a PBR-trained
    //    instinct will delete. Don't."
    //
    // The edges sit on the compressed distribution's own quantiles at D ≈ 0.52
    // — p20 −0.66, p50 −0.25, p80 +0.18 — so all four bands are populated by
    // construction rather than by hope: roughly 20 / 30 / 30 / 20 percent of
    // tracers. The old stops assumed the range was uniformly populated; it is
    // not, and the amber end was simply unreachable.
    //
    // jit is §9.2's per-surface wobble, here per-tracer: without it the bands
    // are a stencil and the boundary between two hues is a hard geometric edge
    // running through the web. With it, neighbouring tracers cross at slightly
    // different θ and the boundary dissolves into a stipple — soft to look at,
    // bimodal to measure.
    float jit = (hash - 0.5) * 0.11;
    const float W = 0.045;
    vec3 col = vec3(0.62, 0.18, 1.00);                                          // θ ≪ 0  collapsed
    col = mix(col, vec3(0.16, 0.42, 1.00), smoothstep(-0.66 + jit - W, -0.66 + jit + W, th)); // infall
    col = mix(col, vec3(0.10, 0.90, 0.80), smoothstep(-0.25 + jit - W, -0.25 + jit + W, th)); // still
    col = mix(col, vec3(1.00, 0.62, 0.10), smoothstep( 0.18 + jit - W,  0.18 + jit + W, th)); // outflow

    // Dense and no longer flowing: it has stopped. Kept deliberately narrow —
    // this is §8 axis 6's "one accent", not a fifth family, and at the width it
    // used to have it turned most of the collapsed end achromatic, which is a
    // hue family spent on grey.
    float vir = smoothstep(1.30, 2.10, dens) * (1.0 - smoothstep(0.04, 0.16, abs(th)));
    col = mix(col, vec3(1.00, 0.95, 0.86), vir);

    // no two tracers hold quite the same colour
    col *= vec3(1.0 + 0.09*sin(hash*6.283),
                1.0 + 0.06*sin(hash*12.6 + 2.0),
                1.0 + 0.10*cos(hash*6.283));

    // Hue rotates at constant luminance. §9.2 gives this rule for hemispheric
    // ambient — "normalise to unit luminance so it can rotate hue without ever
    // bleaching the palette" — and it applies here for the same reason: a
    // palette that carries brightness lets the flow field set the exposure,
    // and the first draft of this shader washed the whole web to lavender
    // exactly that way. Density owns luminance; divergence owns hue.
    return col / max(dot(col, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  }

  // Luminance, and nothing but density decides it.
  //
  // The gain is deliberately shallow, and that is a physics correction rather
  // than a taste one. Every tracer carries the same mass, so the image already
  // encodes density through how many of them land on a pixel. Scaling each
  // tracer's brightness by the density it sits in counts the same thing twice
  // — invisible while the field is linear, and ruinous afterwards: by a ≈ 0.7
  // a quarter of all elements have shell-crossed, so a quarter of the sky
  // pins to maximum brightness and the web washes out to a white sheet.
  // Measured, not guessed (tools/verify.js reports the crossed fraction).
  //
  // Crowding does the work; this only tilts the balance.
  //
  // The range is also what keeps the hue readable. Rendering θ on its own
  // shows infall running blue along the filaments and outflow filling the
  // voids between them, exactly as it should — but a steep density gain
  // extinguishes the void tracers before that reaches the frame, and the
  // whole divergence channel goes invisible in the half of the volume where
  // it is most interesting. Fifteen stops from void to node, not ninety.
  //
  // The floor was raised from 0.012 to 0.022 on a measurement, and the reason
  // is the paragraph above taken seriously. Every tracer is the same mass, so
  // a void does not contain *dimmer* galaxies — it contains *fewer* of them,
  // and crowding is what is supposed to say so. At the old floor the void
  // tracers printed at the very bottom of the 8-bit range, where the blue they
  // are carrying cannot be expressed in the two or three levels of channel
  // spread available: the frame's hue histogram had four families and none of
  // them was the blue one, with nothing at all between 190° and 340°. A flatter
  // law is both the more faithful reading of equal-mass tracers and the one
  // that lets the emptiest half of the volume reach the frame with its colour.
  float webLum(float dens) {
    return 0.022
         + 0.026 * smoothstep(-1.70, 0.05, dens)
         + 0.040 * smoothstep(0.35, 1.70, dens)
         + 0.075 * smoothstep(1.95, 2.48, dens);
  }

  // Shimmer rides ln D and ln a — both integrals of the Friedmann equation,
  // neither with a period, so no capture of any length can show a loop. The
  // amplitude follows the growth rate f, so the web shimmers hardest while
  // structure is actually forming and calms as Λ takes over.
  float webShimmer(float lnD, float lnA, float f, float hash, vec3 x) {
    float s = 0.88 + 0.12 * f * sin(lnD * (3.0 + hash*9.0) + hash*40.0);
    s *= 0.84 + 0.16 * sin(dot(x, vec3(0.011, 0.007, 0.009)) - lnA*2.4)
              + 0.12 * sin(dot(x, vec3(-0.006, 0.012, -0.008)) + lnA*1.5);
    return s;
  }

  // An anisotropic, area-preserving kernel. sigma along the thread grows by
  // the stretch factor, sigma across shrinks by the same, so a stretched tracer
  // is dimmer per pixel rather than a brighter blob — otherwise elongation
  // would masquerade as density and corrupt the readout.
  float webKernel(vec2 pc, vec2 axis, float stretch) {
    vec2 c = pc - 0.5;
    float u = dot(c, axis);
    float v = dot(c, vec2(-axis.y, axis.x)) * stretch * stretch;
    float r2 = u*u + v*v;
    if (r2 > 0.25) return -1.0;
    // The pedestal has to be subtracted, and this is a §2.8 fix rather than a
    // cosmetic one. A Gaussian truncated at r² = 0.25 still returns
    // exp(−2.75) = 0.064 at the cut, so every sprite ends on a 6.4% step
    // instead of on zero — and with 262k additively blended sprites over a
    // 230k-pixel frame, those steps are a floor under the entire deep field.
    // Measured before this line existed: 0.9% of the cosmic frame reached true
    // #000, against an invariant that says the vacuum *is* black. Subtracting
    // the truncation value and renormalising costs one madd and lets a pixel
    // no sprite core covers actually be empty.
    return (exp(-r2 * 11.0) - 0.0639279) * 1.0682943;
  }
`;

const M1_VERT = /* glsl */`
  precision highp float;
  uniform vec4  uKA[${N_MODES}];   // (k̂.xyz, |k|) — precomputed, so the mode
  uniform vec2  uAP[${N_MODES}];   // (amplitude, phase)  loop carries no sqrt
  uniform float uD;                // growth factor D(a)
  uniform float uThetaNorm;        // 1/(2.2·D) — puts the divergence on [-1,1]
  uniform float uAScale;
  uniform float uPx;
  out float vDens;      // ln(1 + δ)
  out float vTheta;     // ∇·v in units of aHf
  out float vCrossed;
  out float vHash;
  out float vNova;
  out float vStretch;
  out float vEdge;
  out float vClass;
  out float vFlux;
  out vec2  vAxis;
  out vec3  vQ;
  ${M1_TENSOR}
  ${M1_LOD}
  ${M1_SLAB}

  void main() {
    vec3 q = position;
    vHash = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);

    vec3 disp = vec3(0.0);
    float m0 = 0.0, m1 = 0.0, m2 = 0.0, m3 = 0.0, m4 = 0.0, m5 = 0.0;
    for (int i = 0; i < ${N_MODES}; i++) {
      vec3  kh = uKA[i].xyz;
      float kl = uKA[i].w;
      float ph = kl * dot(kh, q) + uAP[i].y;
      float amp = uAP[i].x;
      disp += (amp * sin(ph)) * kh;
      float w = amp * kl * cos(ph);          // M += w · k̂k̂ᵀ
      m0 += w*kh.x*kh.x; m1 += w*kh.y*kh.y; m2 += w*kh.z*kh.z;
      m3 += w*kh.x*kh.y; m4 += w*kh.x*kh.z; m5 += w*kh.y*kh.z;
    }
    vec3 x = (q + uD * disp) * uAScale;
    vQ = x;

    // The structure class — how many principal axes have collapsed. The same
    // tensor, read by its signature rather than its trace, which is the second
    // independent channel §M1's hue clause needs (docs/plans/M1.md §12).
    vClass = webCount(eig3(m0, m1, m2, m3, m4, m5), uD);

    // B = I + D·M. Density is 1/det B; divergence is 3 − I₂/det B, with the
    // growth factor cancelling out of the ratio (docs/plans/M1.md §2).
    float b0 = 1.0 + uD*m0, b1 = 1.0 + uD*m1, b2 = 1.0 + uD*m2;
    float b3 = uD*m3, b4 = uD*m4, b5 = uD*m5;
    float det = b0*(b1*b2 - b5*b5) - b3*(b3*b2 - b5*b4) + b4*(b3*b5 - b1*b4);
    float i2  = (b0*b1 - b3*b3) + (b0*b2 - b4*b4) + (b1*b2 - b5*b5);

    vCrossed = det <= 0.0 ? 1.0 : 0.0;
    float rho = mix(min(1.0 / max(det, 0.0833), 12.0), 12.0, vCrossed);
    vDens = log(rho);
    // past shell crossing the ratio is meaningless — but the element is
    // certainly collapsing, and linear theory says how fast
    // θ/(aHf) scales with D in the linear regime, so divide it out — hue must
    // read the same at every epoch — then compress the asymmetric tail. A
    // shell-crossed element is past the far end of that tail by definition.
    vTheta = vCrossed > 0.5 ? -1.0 : compressTheta((3.0 - i2/det) * uThetaNorm);

    vNova = 0.0;
    if (vHash > 0.9995) {
      float lc = fract(uD * 6.0 + vHash * 991.0);
      vNova = max(0.0, 1.0 - lc * 30.0);
      vNova *= vNova;
    }

    vec3 aq = abs(q) / ${(BOX / 2).toFixed(1)};
    vEdge = 1.0 - smoothstep(0.86, 1.0, max(aq.x, max(aq.y, aq.z)));

    vec4 mv = modelViewMatrix * vec4(x, 1.0);
    vEdge *= slabWeight(mv.z, modelViewMatrix[3].z);
    float ideal = uPx * (0.95 + 0.6 * clamp(rho - 0.6, 0.0, 2.6)) * (1.0 + vNova * 3.5)
                * (620.0 / -mv.z);
    float size = clamp(ideal, 0.75, 22.0);

    // the thread axis, in screen space, from the projected tensor
    mat3 R = mat3(modelViewMatrix);
    vec3 r0 = vec3(R[0][0], R[1][0], R[2][0]);
    vec3 r1 = vec3(R[0][1], R[1][1], R[2][1]);
    vec3 ax = threadAxis(
      qform(m0,m1,m2,m3,m4,m5, r0),
      bform(m0,m1,m2,m3,m4,m5, r0, r1),
      qform(m0,m1,m2,m3,m4,m5, r1));
    // Elongate only once the deformation is real — an unstructured early
    // universe must stay round — and only when the sprite can resolve it.
    //
    // That second gate used to open at 2.5 px, and at the opening distance a
    // tracer is 0.74 to 1.94 px, so it never opened at all: the anisotropic
    // kernel §M1 asks for, and the whole reason filaments should read as
    // *thread* rather than as fog, was switched off in every frame anyone has
    // ever seen of this scale. It now opens at 1.1 px, which is where a sprite
    // first has two pixels to be anisotropic across.
    float gate = smoothstep(0.10, 0.75, uD * length(vec3(m0, m1, m2)))
               * smoothstep(1.1, 2.6, size);
    vStretch = 1.0 + 1.6 * ax.z * gate;
    vAxis = ax.xy;

    // energy is preserved inside the kernel, but *coverage* is not, and
    // coverage is what the bloom pass multiplies — so the elongated sprite is
    // held to the same footprint ceiling the round one had
    float px = min(size * vStretch, 26.0);
    vFlux = tracerFlux(ideal, px);
    gl_PointSize = px;
    gl_Position = projectionMatrix * mv;
  }
`;

const M1_FRAG = /* glsl */`
  precision highp float;
  uniform float uLnD;
  uniform float uLnA;
  uniform float uF;
  in float vDens;
  in float vTheta;
  in float vCrossed;
  in float vHash;
  in float vNova;
  in float vStretch;
  in float vEdge;
  in float vClass;
  in float vFlux;
  in vec2  vAxis;
  in vec3  vQ;
  out vec4 fragColor;
  ${M1_PALETTE}

  void main() {
    float fall = webKernel(gl_PointCoord, vAxis, vStretch);
    if (fall < 0.0) discard;

    vec3 col = ${WEB_CLASS ? 'webColorClass(vDens, vTheta, vClass, vHash)' : 'webColor(vDens, vTheta, vCrossed, vHash)'};
    float lum = webLum(vDens) * webShimmer(uLnD, uLnA, uF, vHash, vQ) * vFlux;
    col += mix(vec3(1.4, 0.55, 0.32), vec3(1.9, 1.8, 1.55), vNova) * vNova * 2.4;

    vec3 outc = col * (lum + vNova) * fall * vEdge;
    // §11: one NaN texel is smeared over a whole neighbourhood by the bloom
    // downsample chain and survives the tonemap as a solid block. NaN is the
    // only value that fails to equal itself; clamp then takes the infinities.
    outc = mix(vec3(0.0), outc, vec3(equal(outc, outc)));
    fragColor = vec4(clamp(outc, 0.0, 64.0), 1.0);
  }
`;

// GLSL3 point renderer fed directly by the N-body sim's GPU textures
const NB_VERT = /* glsl */`
  precision highp float;
  uniform sampler2D uPos;
  uniform sampler2D uDen;
  uniform float uAScale;
  uniform float uPx;
  uniform float uTime;
  out float vDelta;
  out float vEdge;
  out float vHash;
  out float vNova;
  out vec3 vQ;
  ${NBODY_LAYOUT.LAYOUT}

  void main() {
    ivec2 t = ivec2(gl_VertexID % ${NBODY_LAYOUT.PN}, gl_VertexID / ${NBODY_LAYOUT.PN});
    vec3 x = texelFetch(uPos, t, 0).xyz;                  // box units [0,1)
    ivec3 cell = ivec3(fract(x) * float(G)) % G;
    float delta = texelFetch(uDen, cellToTexel(cell), 0).x - 1.0;
    // compress the nonlinear range so halos glow without nuking the frame
    vDelta = clamp(log(1.0 + max(delta, -0.95)) * 1.05 - 0.25, -1.0, 2.5);

    // per-tracer clock: twinkle, hue, and the occasional supernova
    vHash = fract(sin(float(gl_VertexID) * 0.1031) * 43758.5453);
    vNova = 0.0;
    if (vHash > 0.9995) {
      float lc = fract(uTime / 90.0 + vHash * 991.0);
      vNova = max(0.0, 1.0 - lc * 30.0);
      vNova *= vNova;
    }

    vec3 disp = (x - 0.5) * ${BOX.toFixed(1)} * uAScale;
    vQ = disp;
    vec3 ax = abs(x - 0.5) * 2.0;
    vEdge = 1.0 - smoothstep(0.86, 1.0, max(ax.x, max(ax.y, ax.z)));

    vec4 mv = modelViewMatrix * vec4(disp, 1.0);
    float size = uPx * (0.95 + 0.42 * clamp(vDelta, 0.0, 2.0)) * (1.0 + vNova * 3.5);
    gl_PointSize = clamp(size * (620.0 / -mv.z), 0.75, 9.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const NB_FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  in float vDelta;
  in float vEdge;
  in float vHash;
  in float vNova;
  in vec3 vQ;
  out vec4 fragColor;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    float fall = exp(-r2 * 11.0);
    float t = vDelta;
    float hueT = 0.5 + 0.5 * sin(uTime * 0.045 + vQ.y * 0.003);
    float warmT = 0.5 + 0.5 * sin(uTime * 0.03 + vQ.x * 0.002);
    vec3 voidC = vec3(0.055, 0.06, 0.16);
    vec3 filC  = mix(vec3(0.30, 0.38, 1.00), vec3(0.52, 0.28, 0.98), hueT);
    vec3 nodeC = mix(vec3(1.35, 1.12, 0.78), vec3(1.42, 0.92, 0.86), warmT);
    vec3 col = t < 0.35
      ? mix(voidC, filC, smoothstep(-1.0, 0.35, t))
      : mix(filC, nodeC, smoothstep(0.35, 2.2, t));
    col *= vec3(1.0 + 0.10 * sin(vHash * 6.283), 1.0 + 0.07 * sin(vHash * 12.6 + 2.0), 1.0 + 0.12 * cos(vHash * 6.283));
    float lum = 0.035 + 0.1 * smoothstep(-0.9, 0.1, t) + 0.3 * smoothstep(0.35, 2.4, t);
    lum *= 0.86 + 0.14 * sin(uTime * (0.4 + vHash * 1.8) + vHash * 40.0);
    lum *= 0.82 + 0.18 * sin(dot(vQ, vec3(0.011, 0.007, 0.009)) - uTime * 0.55)
               + 0.12 * sin(dot(vQ, vec3(-0.006, 0.012, -0.008)) + uTime * 0.31);
    col += mix(vec3(1.4, 0.55, 0.32), vec3(1.9, 1.8, 1.55), vNova) * vNova * 2.4;
    fragColor = vec4(col * (lum + vNova) * fall * vEdge, 1.0);
  }
`;

const M1_NB_VERT = /* glsl */`
  precision highp float;
  uniform sampler2D uPos;
  uniform sampler2D uDen;
  uniform sampler2D uDenPrev;
  uniform sampler2D uForce;  // −∇φ on the mesh; its own gradient is the tidal tensor
  uniform float uThetaK;     // 1/(Δa·f) — turns Δδ into ∇·v in units of aHf
  uniform float uThetaNorm;  // 1/(2.2·D) — same normalisation the linear path uses
  uniform float uTidalNorm;  // a/(1.5·Ωm·h) — puts the tidal eigenvalues in δ units
  uniform float uD;
  uniform float uAScale;
  uniform float uPx;
  out float vDens;
  out float vTheta;
  out float vCrossed;
  out float vHash;
  out float vNova;
  out float vStretch;
  out float vEdge;
  out float vClass;
  out float vFlux;
  out vec2  vAxis;
  out vec3  vQ;
  ${NBODY_LAYOUT.LAYOUT}
  ${M1_TENSOR}
  ${M1_LOD}
  ${M1_SLAB}

  float den(ivec3 c) { return texelFetch(uDen, cellToTexel(c), 0).x; }
  vec3 frc(ivec3 c) { return texelFetch(uForce, cellToTexel(c), 0).xyz; }

  void main() {
    ivec2 t = ivec2(gl_VertexID % ${NBODY_LAYOUT.PN}, gl_VertexID / ${NBODY_LAYOUT.PN});
    vec3 x = texelFetch(uPos, t, 0).xyz;
    ivec3 cell = ivec3(fract(x) * float(G)) % G;

    float rho = max(den(cell), 0.02);
    float rhoPrev = max(texelFetch(uDenPrev, cellToTexel(cell), 0).x, 0.02);
    vDens = log(rho);
    // continuity: θ = −(∂δ/∂t)/(1+δ). Under gravity a virialized halo stops
    // growing, so θ → 0 and its core goes neutral — the thing linear theory
    // cannot do, and what pressing N is meant to show (§M1 gate c).
    vTheta = compressTheta(-(rho - rhoPrev) * uThetaK * uThetaNorm / rho);
    // the PM code has no deformation tensor; "collapsed" is simply "dense"
    vCrossed = smoothstep(1.6, 2.6, vDens);

    // ---- the T-web class, from this simulation's own gravity --------------
    //
    // docs/plans/M1.md §13 built the structure classification on the linear
    // path and named its absence here as "a known next step and not a gap":
    // the N-body path was left on the divergence ramp, so with the second hue
    // channel default-on it did nothing at all in the frame a visitor actually
    // lands on, because the visitor gets the particle-mesh run.
    //
    // It does not need the Zel'dovich tensor. The classification is Hahn et
    // al. (2007) / Forero-Romero et al. (2009), and its actual definition is
    // the eigenvalues of the *tidal tensor* T_ij = ∂²φ/∂x_i∂x_j — which this
    // code already has, one derivative away: force holds −∇φ, so
    // T_ij = −∂F_i/∂x_j. Six texel fetches, the same central difference
    // FORCE_FRAG used to make F in the first place, and the answer is the
    // simulated potential's rather than linear theory's — so after shell
    // crossing, where the two genuinely disagree, this reports what gravity
    // did and not what perturbation theory predicted.
    //
    // Normalisation: the Poisson solve carries φ_k = −1.5·Ωm·δ_k/(a·k²), so
    // tr(T) = ∇²φ = (1.5·Ωm/a)·δ. Dividing by that constant puts the
    // eigenvalues in units where they sum to δ, which is the convention the
    // λ_th = 0.2 threshold in webCount is quoted in.
    //
    // Sign: ψ ∝ −∇φ, so the Zel'dovich tensor is M = −T and an axis collapses
    // where λ_T is *positive*. Negating here lets both paths share one
    // webCount, which is §2.7's discipline — one definition, ported rather
    // than re-derived.
    vec3 fpx = frc(cell + ivec3(1,0,0)), fmx = frc(cell - ivec3(1,0,0));
    vec3 fpy = frc(cell + ivec3(0,1,0)), fmy = frc(cell - ivec3(0,1,0));
    vec3 fpz = frc(cell + ivec3(0,0,1)), fmz = frc(cell - ivec3(0,0,1));
    float k = -uTidalNorm;
    float t0 = k * (fpx.x - fmx.x);
    float t1 = k * (fpy.y - fmy.y);
    float t2 = k * (fpz.z - fmz.z);
    // the off-diagonals are symmetrised: two discrete estimates of the same
    // mixed partial, averaged, which is both more accurate and exactly what
    // makes the matrix eig3() receives symmetric
    float t3 = k * 0.5 * ((fpy.x - fmy.x) + (fpx.y - fmx.y));
    float t4 = k * 0.5 * ((fpz.x - fmz.x) + (fpx.z - fmx.z));
    float t5 = k * 0.5 * ((fpz.y - fmz.y) + (fpy.z - fmy.z));
    vClass = webCount(-eig3(t0, t1, t2, t3, t4, t5), 1.0);

    vHash = fract(sin(float(gl_VertexID) * 0.1031) * 43758.5453);
    vNova = 0.0;
    if (vHash > 0.9995) {
      float lc = fract(uD * 6.0 + vHash * 991.0);
      vNova = max(0.0, 1.0 - lc * 30.0);
      vNova *= vNova;
    }

    vec3 disp = (x - 0.5) * ${BOX.toFixed(1)} * uAScale;
    vQ = disp;
    vec3 ax3 = abs(x - 0.5) * 2.0;
    vEdge = 1.0 - smoothstep(0.86, 1.0, max(ax3.x, max(ax3.y, ax3.z)));

    vec4 mv = modelViewMatrix * vec4(disp, 1.0);
    vEdge *= slabWeight(mv.z, modelViewMatrix[3].z);
    float ideal = uPx * (0.95 + 0.42 * clamp(vDens, 0.0, 2.0)) * (1.0 + vNova * 3.5)
                * (620.0 / -mv.z);
    float size = clamp(ideal, 0.75, 22.0);

    // No tensor here, but there is a field: a filament runs *along* its ridge,
    // so the thread is perpendicular to the density gradient. Six fetches.
    vec3 g = vec3(
      den(cell + ivec3(1,0,0)) - den(cell - ivec3(1,0,0)),
      den(cell + ivec3(0,1,0)) - den(cell - ivec3(0,1,0)),
      den(cell + ivec3(0,0,1)) - den(cell - ivec3(0,0,1)));
    mat3 R = mat3(modelViewMatrix);
    vec2 gs = vec2(dot(vec3(R[0][0], R[1][0], R[2][0]), g),
                   dot(vec3(R[0][1], R[1][1], R[2][1]), g));
    float gmag = length(gs);
    float aniso = gmag / (gmag + 0.35 * rho + 1e-6);
    vAxis = gmag > 1e-6 ? vec2(-gs.y, gs.x) / gmag : vec2(1.0, 0.0);
    // same correction as the linear path: the gate used to open at 2.5 px and a
    // tracer at the opening distance is under 2, so the thread kernel never ran
    vStretch = 1.0 + 1.6 * aniso * smoothstep(1.1, 2.6, size);

    float px = min(size * vStretch, 26.0);
    vFlux = tracerFlux(ideal, px);
    gl_PointSize = px;
    gl_Position = projectionMatrix * mv;
  }
`;

const M1_NB_FRAG = /* glsl */`
  precision highp float;
  uniform float uLnD;
  uniform float uLnA;
  uniform float uF;
  in float vDens;
  in float vTheta;
  in float vCrossed;
  in float vHash;
  in float vNova;
  in float vStretch;
  in float vEdge;
  in float vClass;
  in float vFlux;
  in vec2  vAxis;
  in vec3  vQ;
  out vec4 fragColor;
  ${M1_PALETTE}

  void main() {
    float fall = webKernel(gl_PointCoord, vAxis, vStretch);
    if (fall < 0.0) discard;
    vec3 col = ${WEB_CLASS ? 'webColorClass(vDens, vTheta, vClass, vHash)' : 'webColor(vDens, vTheta, vCrossed, vHash)'};
    float lum = webLum(vDens) * webShimmer(uLnD, uLnA, uF, vHash, vQ) * vFlux;
    col += mix(vec3(1.4, 0.55, 0.32), vec3(1.9, 1.8, 1.55), vNova) * vNova * 2.4;
    vec3 outc = col * (lum + vNova) * fall * vEdge;
    outc = mix(vec3(0.0), outc, vec3(equal(outc, outc)));
    fragColor = vec4(clamp(outc, 0.0, 64.0), 1.0);
  }
`;

export class CosmicScale {
  constructor(app) {
    this.app = app;
    this.kind = 'cosmic';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 20000);
    this.camera.position.set(0, BOX * 0.33, BOX * 0.85);

    this.a = A_OPEN;
    this.playing = true;
    this.rate = 0.16;          // d(ln a)/dt per real second
    this.physicalView = false;

    this._buildField(app.seed);
    this._buildParticles();
    this._buildNBody();
    this._buildComets();

    this.controls = new OrbitControls(this.camera, app.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.rotateSpeed = 0.5;
    // --- how far you may fly, and how fast the gesture takes you there -----
    //
    // The dwell was 60 … 1890 units on a 900-unit box. Two things were wrong
    // with it, and only the second is obvious.
    //
    // The near stop was the real one. 60 units is about a fourteenth of the
    // box, which sounds close and is not: the filaments are tens of units
    // across, so 60 is still *outside* every structure in the simulation. You
    // could approach the web and never enter it, and the thing worth seeing at
    // this scale — that a filament is not fog but a crowd of individual
    // tracers, each one a galaxy — was behind a wall nobody could get past.
    // 6 units puts the camera inside a filament with tracers on both sides.
    //
    // The far stop is the framing complaint: at 1890 the box subtends most of
    // the frame, so pulling back to "see the whole thing" instead ran out of
    // travel with the web still cropped. 3.4× the box is enough to hold it
    // whole with air around it.
    this.controls.minDistance = 6;
    this.controls.maxDistance = BOX * 3.4;

    // A 315× dwell range is unusable at a fixed step, and OrbitControls' dolly
    // is already geometric — each notch scales the distance rather than
    // subtracting from it — which is exactly the right law and why the range
    // can be this wide at all. What it is not is fast enough: at the default
    // speed, crossing 6 → 3060 takes something like sixty notches, and a pinch
    // on glass has far less travel than sixty notches of a wheel.
    //
    // So the speed is raised, and raised further on a coarse pointer, where
    // the gesture is a thumb-and-forefinger span of a couple of centimetres
    // rather than an unbounded scroll. This is the whole of "on mobile, make
    // sure you can really zoom in and out": the range was there, the gesture
    // could not reach across it.
    //
    // And the gesture could not reach it *at all*, which is the defect under
    // the defect. `main.js` and `touch.js` both synthesise a pinch into
    // `active().onWheel?.({ deltaY })`, a plain object — while `OrbitControls`
    // binds a real DOM `wheel` listener to the canvas. A plain object never
    // reaches that listener, so pinch-to-zoom did nothing here on any build,
    // and the mouse wheel worked, which is exactly why it survived: the wheel
    // is the one input a desktop test exercises and a phone never has.
    // `onWheel()` below owns the dolly for both, so this switch stays off.
    const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
    this.controls.enableZoom = false;
    // exp(k · 100) = 0.95^−1.7 — one notch is 9.25%, the tuned wheel feel
    this._zoomK = 8.845e-4 * (coarse ? 2.9 : 1);
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.14;
    app.renderer.domElement.addEventListener('pointerdown', () => {
      this.controls.autoRotate = false;
    }, { once: true });

    // Threshold 0 means `bloom.js`'s bright pass collapses to w = 1 and the
    // *entire* frame is blurred and added back to itself. In vacuum that is a
    // pedestal under a field §2.8 requires to reach zero, and it is measurable:
    // the cosmic frame reached true #000 on 0.9% of pixels and read 65%
    // achromatic, because a broad grey haze is what an unthresholded bloom of a
    // multicoloured point field *is*. Above the void tracers (which peak near
    // 0.05) and below the filament and knot cores, so what glows is structure.
    // Strength matters as much as the threshold, and for a second reason: a
    // bloom is a *blur*, and blurring a field whose neighbouring tracers carry
    // different hues averages them — which is the same hue-destroying mechanism
    // the compositing does, applied again in screen space. 0.85 was adding
    // nearly a full second copy of the frame.
    this.bloomSettings = { strength: 0.5, radius: 0.75, threshold: 0.06 };
  }

  // ------------------------------------------------------------ field ----
  _buildField(seed) {
    // one definition, shared with the CPU mirror, the N-body initial
    // conditions and tools/verify.js — §2.7's lesson, applied here
    this.modes = buildModes(seed, BOX);
  }

  /** linear δ(q) at growth D — CPU mirror of the vertex shader */
  delta(p, D) { return deltaLinear(this.modes, [p.x, p.y, p.z], D); }

  gradDelta(p, D, out) {
    const g = gradDeltaLinear(this.modes, [p.x, p.y, p.z], D);
    return out.set(g[0], g[1], g[2]);
  }

  // -------------------------------------------------------- particles ----
  _buildParticles() {
    // ?n still wins for anyone who saved a link with it (§2.4); the tier row
    // supplies the default it used to hardcode
    const nSide = Math.min(Math.max(qInt('n', 'cosmic'), 32), 110);
    const n = nSide ** 3;
    const pos = new Float32Array(n * 3);
    const r = new RNG(hash(this.app.seed, 0x9a27));
    const cell = BOX / nSide;
    let j = 0;
    for (let ix = 0; ix < nSide; ix++)
      for (let iy = 0; iy < nSide; iy++)
        for (let iz = 0; iz < nSide; iz++) {
          pos[j++] = (ix + 0.5 + (r.next() - 0.5) * 0.9) * cell - BOX / 2;
          pos[j++] = (iy + 0.5 + (r.next() - 0.5) * 0.9) * cell - BOX / 2;
          pos[j++] = (iz + 0.5 + (r.next() - 0.5) * 0.9) * cell - BOX / 2;
        }
    this.particleCount = n;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOX);

    const kArr = [], apArr = [], kaArr = [];
    for (const m of this.modes) {
      kArr.push(new THREE.Vector3(...m.k));
      apArr.push(new THREE.Vector2(m.amp, m.phase));
      // |k| and k̂ are constants; computing length(k) inside the mode loop
      // cost 64 square roots per vertex per frame, which is what pays for the
      // deformation tensor (docs/plans/M1.md §6)
      kaArr.push(new THREE.Vector4(m.khat[0], m.khat[1], m.khat[2], m.klen));
    }
    this.uTime = { value: 0 };
    this.uniforms = M1 ? {
      uKA: { value: kaArr },
      uAP: { value: apArr },
      uD: { value: COSMO.growth(this.a) },
      uThetaNorm: { value: 1 },
      uSlabHalf: { value: SLAB * BOX * 0.5 },
      uLnD: { value: Math.log(Math.max(COSMO.growth(this.a), 1e-6)) },
      uLnA: { value: Math.log(this.a) },
      uF: { value: COSMO.growthRate(this.a) },
      uAScale: { value: 1 },
      uPx: { value: Math.min(window.devicePixelRatio, 2) },
    } : {
      uK: { value: kArr },
      uAP: { value: apArr },
      uD: { value: COSMO.growth(this.a) },
      uAScale: { value: 1 },
      uPx: { value: Math.min(window.devicePixelRatio, 2) },
      uTime: this.uTime,
    };
    const depthComposite = M1 && COMPOSITE_DEPTH;
    const mat = new THREE.ShaderMaterial({
      ...(M1 ? { glslVersion: THREE.GLSL3 } : {}),
      uniforms: this.uniforms,
      vertexShader: M1 ? M1_VERT : vert,
      fragmentShader: M1 ? M1_FRAG : frag,
      blending: THREE.AdditiveBlending,
      depthWrite: depthComposite,
      depthTest: depthComposite,
      transparent: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.scene.add(this.points);
  }

  /** the PM N-body integrator; falls back to pure Zel'dovich if unsupported */
  _buildNBody() {
    this.sim = null;
    this.mode = 'linear';
    const url = new URL(window.location.href);
    if (url.searchParams.get('nb') === '0') return;
    try {
      this.sim = new NBodySim(this.app.renderer, this.modes, BOX, this.a);
    } catch (e) {
      console.warn('AEON: PM N-body unavailable, staying with linear theory —', e.message);
      return;
    }
    const N = this.sim.particleCount;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOX);
    this.nbUniforms = M1 ? {
      uPos: { value: this.sim.posTexture },
      uDen: { value: this.sim.densityTexture },
      uDenPrev: { value: this.sim.densityPrevTexture },
      uForce: { value: this.sim.forceTexture },
      uThetaK: { value: 0 },
      uThetaNorm: { value: 1 },
      uTidalNorm: { value: this.sim.tidalScale },
      uSlabHalf: { value: SLAB * BOX * 0.5 },
      uD: { value: COSMO.growth(this.a) },
      uLnD: { value: Math.log(Math.max(COSMO.growth(this.a), 1e-6)) },
      uLnA: { value: Math.log(this.a) },
      uF: { value: COSMO.growthRate(this.a) },
      uAScale: { value: 1 },
      uPx: { value: Math.min(window.devicePixelRatio, 2) },
    } : {
      uPos: { value: this.sim.posTexture },
      uDen: { value: this.sim.densityTexture },
      uAScale: { value: 1 },
      uPx: { value: Math.min(window.devicePixelRatio, 2) },
      uTime: this.uTime,
    };
    this.nbPoints = new THREE.Points(geo, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.nbUniforms,
      vertexShader: M1 ? M1_NB_VERT : NB_VERT,
      fragmentShader: M1 ? M1_NB_FRAG : NB_FRAG,
      blending: THREE.AdditiveBlending,
      depthWrite: M1 && COMPOSITE_DEPTH, depthTest: M1 && COMPOSITE_DEPTH,
      transparent: true,
    }));
    this.scene.add(this.nbPoints);
    this.mode = 'nbody';
    this.points.visible = false;
  }

  /** three wanderers arc through the box trailing light — the web has weather */
  _buildComets() {
    const r = new RNG(hash(this.app.seed, 0xc0ae7));
    const tex = softDotTexture(48);
    this.comets = [];
    const tints = [
      new THREE.Color(0.8, 1.2, 1.6),
      new THREE.Color(1.5, 1.1, 0.6),
      new THREE.Color(1.1, 0.8, 1.5),
    ];
    for (let i = 0; i < 3; i++) {
      // a random ellipse threading the box
      const A = new THREE.Vector3(r.gauss(), r.gauss(), r.gauss()).normalize().multiplyScalar(BOX * r.float(0.34, 0.55));
      const B = new THREE.Vector3(r.gauss(), r.gauss(), r.gauss());
      B.addScaledVector(A, -B.dot(A) / A.lengthSq()).normalize().multiplyScalar(BOX * r.float(0.28, 0.5));
      const ghosts = [];
      for (let g = 0; g < 6; g++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex, color: tints[i], transparent: true, depthWrite: false, depthTest: false,
          blending: THREE.AdditiveBlending, opacity: g === 0 ? 0.9 : 0.5 / (g + 0.6),
        }));
        sp.scale.setScalar(g === 0 ? 17 : 13 - g * 1.7);
        this.scene.add(sp);
        ghosts.push(sp);
      }
      this.comets.push({ A, B, w: r.float(0.05, 0.11) * r.sign(), ph: r.float(0, 6.28), ghosts });
    }
  }

  toggleMode() {
    if (!this.sim) return;
    this.mode = this.mode === 'nbody' ? 'linear' : 'nbody';
    this.nbPoints.visible = this.mode === 'nbody';
    this.points.visible = this.mode === 'linear';
    if (this.mode === 'nbody' && Math.abs(this.sim.a - this.a) > 0.02) {
      // linear scrubbing moved the clock: re-run gravity up to it
      this.sim.reset(A_START);
      this.sim.step(Math.max(this.a - A_START, 0));
    }
  }

  // ------------------------------------------------------------- loop ----
  /** d(ln a) this frame. Past the present day the clock keeps running, more
   *  slowly: §M1 wants a continuous drift, and a universe that stops at a = 1
   *  is a still frame with a play button. */
  _dLnA(dt) {
    if (!this.playing) return 0;
    if (this.a >= A_FUTURE) return 0;
    return this.rate * (this.a >= 1 ? FUTURE_RATE : 1) * dt;
  }

  update(dt) {
    this.uTime.value += dt;
    const dln = this._dLnA(dt);
    if (this.mode === 'nbody') {
      if (dln > 0) {
        const da = this.a * (Math.exp(dln) - 1);
        this.sim.step(Math.min(da, A_FUTURE - this.a + 1e-6));
        this.a = Math.min(this.sim.a, A_FUTURE);
      }
      this.nbUniforms.uPos.value = this.sim.posTexture;
      this.nbUniforms.uDen.value = this.sim.densityTexture;
      this.nbUniforms.uAScale.value = this.physicalView ? this.a : 1;
      if (M1) {
        this.nbUniforms.uDenPrev.value = this.sim.densityPrevTexture;
        this.nbUniforms.uForce.value = this.sim.forceTexture;
        this.nbUniforms.uThetaK.value = this.sim.thetaScale;
        this.nbUniforms.uTidalNorm.value = this.sim.tidalScale;
        this._setDeepTime(this.nbUniforms);
      }
    } else if (dln > 0) {
      this.a = Math.min(this.a * Math.exp(dln), A_FUTURE);
    }
    this.uniforms.uD.value = COSMO.growth(this.a);
    this.uniforms.uAScale.value = this.physicalView ? this.a : 1;
    if (M1) this._setDeepTime(this.uniforms);
    if (this.comets) {
      const t = this.uTime.value;
      for (const c of this.comets) {
        for (let g = 0; g < c.ghosts.length; g++) {
          const tg = t - g * 0.55; // each ghost rides a moment behind
          c.ghosts[g].position
            .copy(c.A).multiplyScalar(Math.cos(c.w * tg + c.ph))
            .addScaledVector(c.B, Math.sin(c.w * tg + c.ph));
        }
      }
    }
    this.controls.update();
  }

  /** the two integrating phases every M1 shimmer rides — ln D and ln a. Both
   *  come out of the Friedmann equation, neither has a period, so no capture
   *  of any length can catch a loop. */
  _setDeepTime(u) {
    const D = COSMO.growth(this.a);
    u.uD.value = D;
    // just 1/D — the shape of the transfer lives in compressTheta(), where it
    // can be reasoned about against a measured distribution
    u.uThetaNorm.value = 1 / Math.max(D, 1e-4);
    u.uLnD.value = Math.log(Math.max(COSMO.growth(this.a), 1e-6));
    u.uLnA.value = Math.log(this.a);
    u.uF.value = COSMO.growthRate(this.a);
  }

  // ------------------------------------------------------------- time ----
  togglePlay() {
    if (this.a >= A_FUTURE && !this.playing) {
      this.a = A_START;
      if (this.mode === 'nbody') this.sim.reset(A_START);
      this.playing = true;
      return;
    }
    this.playing = !this.playing;
  }
  speedUp() { this.rate = Math.min(this.rate * 1.6, 2.2); }
  slowDown() { this.rate = Math.max(this.rate / 1.6, 0.02); }
  scrub(dir) { // step in ln a (linear theory is reversible; gravity is not)
    this.playing = false;
    if (this.mode === 'nbody') {
      if (dir < 0) { this.sim.reset(A_START); this.a = A_START; }
      else { this.sim.step(this.a * (Math.exp(0.06) - 1)); this.a = Math.min(this.sim.a, A_FUTURE); }
      return;
    }
    this.a = Math.min(Math.max(this.a * Math.exp(dir * 0.06), A_START), A_FUTURE);
  }

  timeReadout() {
    const z = COSMO.z(this.a);
    return `z ${z >= 10 ? z.toFixed(0) : z.toFixed(2)} · ${COSMO.age(this.a).toFixed(2)} Gyr`;
  }

  hudStats() {
    const n = this.mode === 'nbody' ? this.sim.particleCount : this.particleCount;
    return [
      ['epoch', !this.playing ? 'paused' : (this.a >= 1 ? 'beyond the present day' : 'evolving')],
      ['redshift', 'z = ' + (COSMO.z(this.a) >= 10 ? COSMO.z(this.a).toFixed(1) : COSMO.z(this.a).toFixed(2))],
      ['age of universe', COSMO.age(this.a).toFixed(2) + ' Gyr'],
      ['gravity', this.mode === 'nbody' ? 'particle-mesh N-body' : 'Zel’dovich linear theory'],
      ['tracer particles', n.toLocaleString()],
      ['coordinates', this.physicalView ? 'physical (expanding)' : 'comoving'],
    ];
  }

  // ------------------------------------------------------------ input ----
  /** click → densest peak near the ray → galaxy dive target, or null */
  pick(raycaster) {
    const D = Math.max(COSMO.growth(this.a), 0.05);
    const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
    const p = new THREE.Vector3();
    let best = null, bestScore = -1e9;
    for (let i = 0; i < 140; i++) {
      const t = 30 + i * (BOX * 1.9 / 140);
      p.copy(rd).multiplyScalar(t).add(ro);
      const h = Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
      if (h > BOX * 0.52) continue;
      const score = this.delta(p, D) - t * 0.0006;
      if (score > bestScore) { bestScore = score; best = p.clone(); }
    }
    if (!best) return null;
    // gradient-ascend onto the peak
    const g = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      this.gradDelta(best, D, g);
      const gl = g.length();
      if (gl < 1e-6) break;
      best.addScaledVector(g, Math.min(6 / gl, 900));
      best.clampScalar(-BOX / 2, BOX / 2);
    }
    const q = 8; // quantize → stable galaxy identity for nearby clicks
    const gseed = hash(this.app.seed, Math.round(best.x / q), Math.round(best.y / q), Math.round(best.z / q));
    return { position: best, galaxySeed: gseed };
  }

  /**
   * Zoom, owned here rather than by `OrbitControls`, so that the *pinch* works.
   *
   * `main.js` synthesises a pinch into `active().onWheel?.({ deltaY })` and
   * `touch.js` does the same — but `CosmicScale` never implemented `onWheel`,
   * and `OrbitControls` listens for real DOM wheel events on the canvas, which
   * a synthesised plain object is not. So two fingers on the glass did nothing
   * at this scale, on every build, while the mouse wheel worked. Taking the
   * dolly means one implementation serves both, which is why
   * `controls.enableZoom` is off above.
   *
   * Geometric, because the range is: 6 to BOX·3.4 is a factor of 510, and a
   * linear dolly cannot cross that without being useless at one end.
   *
   * The gain reproduces the tuned `zoomSpeed = 1.7` feel exactly — one 100-unit
   * notch is 9.25%, so `exp(k·100) = 0.95^-1.7`. A coarse pointer gets 2.9×
   * that, and the reason is arithmetic rather than taste: `touch.js` scales
   * finger travel by 3.2, so a full-screen pinch on a 390-point phone arrives
   * as |deltaY| ≈ 1,600, and at the mouse gain that is a 4× dolly — five
   * pinches to cross the range. A one-pinch traverse of the *useful* range
   * (whole web to inside a filament, about 60×) wants |deltaY| ≈ 4,600, and
   * multiplying here rather than asking `touch.js` for a bigger gain keeps the
   * change inside one file.
   */
  onWheel(e) {
    const dy = Number(e?.deltaY) || 0;
    if (!dy) return true;
    // DOM_DELTA_LINE reports notches, not pixels; one line is about 16 px
    const k = this._zoomK * (e.deltaMode === 1 ? 16 : 1);
    const t = this.controls.target;
    const d = this.camera.position.clone().sub(t);
    const len = Math.min(Math.max(d.length() * Math.exp(k * dy),
      this.controls.minDistance), this.controls.maxDistance);
    this.camera.position.copy(t).addScaledVector(d.normalize(), len);
    return true;
  }

  onKey(code) {
    if (code === 'KeyE') { this.physicalView = !this.physicalView; return true; }
    if (code === 'KeyN') { this.toggleMode(); return true; }
    return false;
  }

  enter() {}
  exit() { this.controls.enabled = false; }
  resume() { this.controls.enabled = true; }

  dispose() {
    this.controls.dispose();
    this.points.geometry.dispose();
    this.points.material.dispose();
    if (this.sim) {
      this.sim.dispose();
      this.nbPoints.geometry.dispose();
      this.nbPoints.material.dispose();
    }
  }
}

export const COSMIC_NOTE = `The <em>cosmic web</em>, forming under real gravity. 262,144 dark-matter particles run through a <em>particle-mesh N-body code on your GPU</em>: each frame their mass is deposited on a 64³ mesh, Poisson's equation is solved by FFT (<em>φ_k = −3Ω<sub>m</sub>δ_k/2ak²</em>), and the particles are kicked and drifted with ΛCDM factors integrated from the Friedmann equation (Ω<sub>m</sub> = 0.315, Ω<sub>Λ</sub> = 0.685, H₀ = 67.4). Initial conditions come from the Zel'dovich approximation at z ≈ 20 — press <em>N</em> to compare against pure linear theory and watch self-gravity sharpen the filaments and virialize the halos. Click a bright node to fall into one of its galaxies.`;
