// The quality table (CLAUDE.md §5).
//
// One array indexed by tier, each row carrying every knob, so one row change
// reconfigures the entire renderer. The shape is the reference's, which §5 says
// to adopt verbatim — four rows, `px` a supersample factor *on top of* the
// device pixel ratio, always ≥ 1.0 above Low so the composite always resolves
// down to the canvas.
//
// It replaces two things.
//
// The first is a §11 violation that has been shipping: `main.js` stepped the
// device pixel ratio up and down every 70 frames against a frame-time average.
// §11 is unambiguous — *"Adaptive quality mid-frame. Set once at init. Live
// changes pump visibly."* The old code half-knew it, holding resolution up
// during flown sequences "which is exactly when it must look like cinema."
// A tier is chosen once here, at init, and never moves again.
//
// The second is a scatter. Quality knobs had accumulated as one-off URL
// parameters — ?n, ?qk, ?qd, ?qr, ?vs, ?atm, ?ct, ?hy, ?vc — each with its own
// default buried at its own call site. Nothing tied them to a device, so there
// was no such thing as "the mobile configuration": there were nine independent
// dials and a hope. They are rows now.
//
// Every one of those parameters still works and still wins. §2.4 makes a URL a
// permanent address, and a link someone saved with ?qd=20 has to keep meaning
// what it meant. The table supplies the default; the URL overrides it.

const TIER_NAMES = ['low', 'mobile', 'desktop', 'ultra'];

/**
 * Four rows. Column meanings:
 *
 *   px          supersample factor on top of devicePixelRatio (§5)
 *   cosmic      tracer grid per axis — 68 ⇒ 68³ ≈ 314k particles
 *   quadSplit   quadtree tile budget: split aggression vs fidelity
 *   quadDepth   maximum quadtree depth
 *   tileRes     vertices per tile edge
 *   atmoSteps   single-scattering raymarch steps for the sky
 *   cities      the full metropolis generator
 *   volumetrics volumetric cloud deck and god rays
 *
 * Empty seats are deliberate: §M3's grass rings, wind render target and blade
 * tessellation belong here too and do not exist yet. When they arrive they
 * become columns, not new URL parameters.
 */
export const QUALITY = [
  { name: 'low', px: 0.85, cosmic: 44, quadSplit: 4.5, quadDepth: 14, tileRes: 25, atmoSteps: 6, cities: false, volumetrics: false },
  { name: 'mobile', px: 1.00, cosmic: 56, quadSplit: 5.5, quadDepth: 16, tileRes: 29, atmoSteps: 8, cities: true, volumetrics: false },
  { name: 'desktop', px: 1.12, cosmic: 68, quadSplit: 6.5, quadDepth: 18, tileRes: 33, atmoSteps: 12, cities: true, volumetrics: true },
  { name: 'ultra', px: 1.32, cosmic: 86, quadSplit: 8.0, quadDepth: 20, tileRes: 41, atmoSteps: 16, cities: true, volumetrics: true },
];

const param = (k) => {
  try { return new URL(window.location.href).searchParams.get(k); }
  catch { return null; }
};

/**
 * Which row this machine gets. Decided once, at import, before anything
 * allocates — and never revisited, which is the whole point (§11).
 *
 * The signals are weak individually and that is fine; the cost of being one row
 * wrong is a frame budget, and the cost of changing rows mid-flight is a
 * visibly pumping image. `?q=` settles it for anyone who disagrees.
 */
function chooseTier() {
  const explicit = param('q') ?? param('tier');
  const named = TIER_NAMES.indexOf(String(explicit));
  if (named >= 0) return named;
  if (explicit !== null && /^[0-3]$/.test(explicit)) return Number(explicit);

  try {
    // a software rasteriser is not a tier, it is a different machine
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return 0;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    if (/swiftshader|llvmpipe|software|basic render/i.test(renderer)) return 0;

    const cores = navigator.hardwareConcurrency || 4;
    const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    if (coarse) return cores >= 6 ? 1 : 0;
    if (cores >= 12) return 3;
    if (cores >= 6) return 2;
    return 1;
  } catch {
    return 1;
  }
}

export const TIER = chooseTier();
export const Q = QUALITY[TIER];

/** an integer knob: the URL wins, the row is the default */
export function qInt(key, column) {
  const v = parseInt(param(key));
  return Number.isFinite(v) ? v : Q[column];
}

/** a float knob: same contract */
export function qFloat(key, column) {
  const v = parseFloat(param(key));
  return Number.isFinite(v) ? v : Q[column];
}

/** a boolean knob: `?k=0` forces off, `?k=1` forces on, else the row decides */
export function qFlag(key, column) {
  const v = param(key);
  if (v === '0') return false;
  if (v === '1') return true;
  return Q[column];
}

/**
 * The pixel ratio to render at: the device's own, capped, times the row's
 * supersample factor. Above Low the factor is ≥ 1.0, so the composite always
 * resolves *down* to the canvas rather than up — which is the discipline §5
 * calls out in the reference, and the reason a soft image is a tier problem
 * rather than a filtering one.
 */
export function pixelRatio() {
  return Math.min(window.devicePixelRatio || 1, 2) * Q.px;
}
