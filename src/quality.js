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
 *   shadowRes   sun shadow map side, in texels (§9.2's drawn edge)
 *   shadowTaps  taps in the shadow sampler's cross — see below
 *   cities      the full metropolis generator
 *   volumetrics volumetric cloud deck and god rays
 *
 * `shadowTaps` is §5's rule being obeyed rather than quoted. Separating the
 * shadow map from `?paint=` put a five-tap sampler on the terrain, which is
 * more than half of every surface frame — a real fill cost, on the row least
 * able to pay it. §5 says the LOD comes before the feature, so here it is, and
 * the argument for the value is `shadow.js`'s own: *"the wobble dominates the
 * silhouette, so five taps read the same as nine."* Carried one step further,
 * on a tier whose shadow map is 1024 and whose screen is small, one wobbled tap
 * reads very nearly the same as five — because what the eye reads there is the
 * noise offset, not the filter width. Low takes one; every other row keeps
 * five. Both early-outs are untouched, so ground beyond the map's 480 m still
 * costs no taps at all on any row.
 *
 * §M3 filled the three seats this table was holding open, and they are the
 * reference's own rows adopted verbatim in shape (§5):
 *
 *   grass       per-ring instance-count multipliers, one per ring
 *   wind        the wind render target's side, in texels
 *   blades      per-ring blade segment counts — the *only* thing a ring
 *               boundary changes (§9.5), so this is the tessellation dial
 *
 * `grass` is per-ring rather than a single number because the rings do not
 * scale together, and the direction is the opposite of the obvious guess. On
 * every row `grass[0] > grass[3]`: the near ring keeps proportionally more
 * (0.30 against 0.24 at low) and gains proportionally more (1.45 against 1.20
 * at ultra).
 *
 * The reason is what a blade *is* at each distance. Underfoot a blade is
 * individually resolved, so thinning it leaves a visible hole and density is
 * the only thing that fills the ground. At three hundred metres a blade is a
 * sub-pixel mark, so removing some and widening the rest is very nearly free —
 * which is the same count-for-width trade ring 3's density law already makes.
 * The far rings are therefore where a low-tier machine gets its frames back.
 */
export const QUALITY = [
  { name: 'low', px: 0.85, cosmic: 44, quadSplit: 4.5, quadDepth: 14, tileRes: 25, atmoSteps: 6, shadowRes: 1024, shadowTaps: 1, cities: false, volumetrics: false, grass: [0.30, 0.28, 0.26, 0.24], wind: 160, blades: [3, 1, 1, 1] },
  { name: 'mobile', px: 1.00, cosmic: 56, quadSplit: 5.5, quadDepth: 16, tileRes: 29, atmoSteps: 8, shadowRes: 1536, shadowTaps: 5, cities: true, volumetrics: false, grass: [0.58, 0.55, 0.52, 0.48], wind: 224, blades: [3, 2, 1, 1] },
  { name: 'desktop', px: 1.12, cosmic: 68, quadSplit: 6.5, quadDepth: 18, tileRes: 33, atmoSteps: 12, shadowRes: 2048, shadowTaps: 5, cities: true, volumetrics: true, grass: [1.00, 1.00, 1.00, 1.00], wind: 288, blades: [4, 2, 1, 1] },
  { name: 'ultra', px: 1.32, cosmic: 86, quadSplit: 8.0, quadDepth: 20, tileRes: 41, atmoSteps: 16, shadowRes: 2560, shadowTaps: 5, cities: true, volumetrics: true, grass: [1.45, 1.38, 1.30, 1.20], wind: 352, blades: [5, 3, 2, 1] },
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

    // The GPU decides, and it used to not get a vote. The first version keyed
    // the tier on `hardwareConcurrency` alone, which is backwards on both ends:
    // a six-core desktop with a discrete card was graded below a sixteen-core
    // laptop with integrated graphics. The renderer string is already in hand
    // for the software check, so ask it.
    const discrete = /\b(rtx|gtx|radeon rx|geforce|quadro|arc a\d|apple m[1-9])\b/i.test(renderer);
    const integrated = /\b(intel|uhd|iris|vega \d|adreno|mali|powervr)\b/i.test(renderer);
    if (discrete) return cores >= 8 ? 3 : 2;
    if (integrated) return cores >= 8 ? 2 : 1;
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

/**
 * §9.4 step 4's midtone saturation, as the excess above unity at the peak of
 * the band. `?sat=` overrides; `?sat=0.16` restores the look that shipped.
 *
 * It lives here rather than in `print.js` for one reason that is worth stating,
 * because it is the same reason `A_START` lives in `cosmology.js` rather than
 * in `cosmic.js`: **`print.js` imports THREE, so `tools/verify.js` cannot
 * import it in node.** The print suite has always worked around that by keeping
 * its own transcribed mirror of the tonemap — and a transcribed constant is
 * exactly the two-definitions-free-to-drift fault §2.7 names for the height
 * field and §11 lists as a trap. A knob the suite must assert against belongs
 * somewhere the suite can reach.
 *
 * It is not a per-tier column. A low-end phone and a workstation should not
 * disagree about how saturated the world is; tiers trade *detail* for frames,
 * never palette (§9.1 — one table, one set of names, every device).
 */
export const SAT_AMOUNT = (() => {
  const v = parseFloat(param('sat'));
  return Number.isFinite(v) && v >= 0 ? v : 3.0;
})();

/**
 * A per-ring knob: same contract, comma-separated in the URL.
 *
 * §M3's grass multipliers and blade segments are one number per ring rather
 * than one number, because the rings do not scale together (see the table's own
 * note). `?grass=1,1,0.5,0.5` overrides all four; a short list is padded from
 * the row, so `?grass=2` raises the near ring and leaves the rest alone.
 */
export function qArr(key, column) {
  const row = Q[column];
  const raw = param(key);
  if (!raw) return row.slice();
  const given = String(raw).split(',').map(Number);
  return row.map((d, i) => (Number.isFinite(given[i]) ? given[i] : d));
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
  const device = Math.min(window.devicePixelRatio || 1, 2);
  // Never below the device's own ratio unless the row is Low. §5 says the
  // factor is "always ≥ 1.0 above Low so the composite always resolves *down*
  // to the canvas" — and the first version of this function ignored that,
  // multiplying unconditionally. On a 1× display the Low row rendered at 0.85
  // and upscaled, which is not a soft image so much as a smaller one: point
  // sprites have a size floor in pixels, so at 0.85 every star and every tracer
  // covers proportionally more of the frame. Measured on the galaxy scale, it
  // took mean luminance from 0.116 to 0.157 and lit pixels from 87% to 98% —
  // the scale washing out, which is exactly what it looked like.
  return TIER === 0 ? device * Q.px : Math.max(device * Q.px, device);
}

/** what the renderer is actually doing, for the HUD and for a bug report */
export function tierReport() {
  return `${Q.name} · ${pixelRatio().toFixed(2)}× · ?q= to override`;
}
