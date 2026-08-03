// Far ridges as pure silhouette in haze — CLAUDE.md §M2's last clause, §9.7.
//
//   "Distant terrain: the reference renders far ridges as **pure haze, pure
//    shape** — silhouette only, no detail. Do the same; cheaper *and* better."
//
// ---------------------------------------------------------------------------
// The one place this must NOT be a transcription
//
// The reference builds its ridges from noise: `buildRidgeBand()` sums five
// octaves of `abs(noise2)` around the azimuth and calls the result a mountain.
// It is entitled to — its valley is 2400 m of authored ground and there is no
// terrain beyond it to be faithful to. The ridges are a backdrop because a
// backdrop is all that exists.
//
// AEON's height field is defined at every point on the planet. `heightAt(x, z)`
// answers at 40 km as readily as at 4 m. So inventing a horizon here would be
// *drawing a different mountain than the one you would reach if you walked* —
// which is §8 axis 8 (honesty) failed on the largest object in the frame, and
// it is the same class of defect §2.7 exists to prevent one scale down. The
// coast you saw from space has to be the coast you walk; the ridge you saw on
// the horizon has to be the ridge you climb.
//
// So the crest line here is **measured, not generated**. For each azimuth the
// ray marches the world's own height field and records the maximum elevation
// angle — which is what a skyline *is*: the upper envelope of the terrain along
// the line of sight, not the height at some chosen radius. The curtain is then
// drawn at a convenient radius with its height set to reproduce that angle
// exactly. A billboard at any distance can carry the true silhouette of terrain
// at any other distance, as long as the elevation angle is preserved; that is
// the whole trick, and it is why this is cheaper *without* being a lie.
//
// The consequence worth stating: **this module introduces no entropy at all.**
// There is no RNG, no seed, no hash. The horizon is a reading of the terrain,
// so it is deterministic for exactly the reason the terrain is (§2.3).
//
// ---------------------------------------------------------------------------
// Why this is cheaper — the measurement, not the assertion
//
// `surface.js` builds three nested terrain rings. Ring 2 spans 2212 m to 7000 m
// (9899 m at the corners) at 194 m per quad, and it runs the *full* terrain
// fragment shader over the entire horizon band: fbm octaves, four-layer
// triplanar under `?mat=1`, a shadow-map lookup under `?paint=1`.
//
// Under §9.3 that ring is almost entirely invisible. With `fogFar = 1700 m`,
// the fog fraction at ring 2's *inner* edge is already 0.987 at ground level;
// at its outer edge it is 1.000 to five figures. The ring contributes between
// 0.0% and 1.3% of its own colour and 100% of its cost. `saturationRadius()`
// below is that number computed rather than asserted, and it is the reason the
// ring is retired when — and only when — the arithmetic says it is invisible.
//
// On a thin-atmosphere world it is not invisible: `fogFar` scales as 1/atmo, so
// a Mars-like world sees 17 km and keeps its ring. On an airless world there is
// no extinction at all and the limit is the planet's own curvature. All three
// cases fall out of the same two functions with no branch, which is the check
// that the parameterisation is right and not fitted.

import { FOG_EXP, FOG_GAIN, HEIGHT_MIX } from './aerial.js';

const TAU = Math.PI * 2;

/** azimuthal segments per band — the reference's 220, and it is the right one:
 *  at 220 the angular step is 1.64°, which is under the ~2° at which a ridge
 *  line starts to read as a polygon rather than as a hill. */
export const RIDGE_SEGS = 220;

/** how far below the near terrain's own silhouette the curtain's foot sits, in
 *  units of tangent. 0.05 is 2.9°, comfortably more than the largest step the
 *  azimuthal sampling can miss between two adjacent columns. */
export const BASE_DROP = 0.05;

/** the most bands worth drawing. Beyond four the outermost are separated by
 *  less than one JND of haze, which is the definition of a wasted draw call. */
export const MAX_BANDS = 4;

/** the fog fraction at which a surface is no longer distinguishable from the
 *  air in front of it. 0.995 is a 0.5% contribution — under half a code value
 *  at 8 bits, which is below the ordered dither §M1 adopted. */
export const SATURATION = 0.995;

/** §9.3 gives an airless world an extinction length of 1e9 m rather than an
 *  infinity, so that the same formula covers vacuum without a branch. Anything
 *  past this is that convention showing through, and means "no limit" — no
 *  world has a horizon a hundred kilometres out, let alone a hundred thousand. */
export const NO_LIMIT = 1e8;

// ---------------------------------------------------------------------------
// the two limits, both real

/**
 * The radius beyond which §9.3's own curve says nothing is visible.
 *
 * Inverts `f = 1 - exp(-((d-near)/far)^FOG_EXP · FOG_GAIN · hf)` for `d`, at the
 * height falloff a crest of `crestY` earns. The height matters enormously: a
 * crest 400 m up sits above most of the boundary-layer haze and sees roughly
 * twice as far as the valley floor it rises from, which is exactly why a ridge
 * line is visible when the ground beneath it is not.
 *
 * Returns `Infinity` for air thin enough that the curve never saturates —
 * the airless case, handled by returning the honest answer rather than a
 * sentinel.
 */
export function saturationRadius({ near, far }, crestY, hazeH, target = SATURATION) {
  const hf = 1 + (Math.exp(-Math.max(crestY - 6, 0) / Math.max(hazeH, 1e-3)) - 1) * HEIGHT_MIX;
  if (!(hf > 1e-9)) return Infinity;
  const u = -Math.log(1 - target) / (FOG_GAIN * hf);      // = ((d-near)/far)^FOG_EXP
  const d = near + far * Math.pow(u, 1 / FOG_EXP);
  return Number.isFinite(d) ? d : Infinity;
}

/**
 * The radius beyond which the planet itself has curved away.
 *
 * `sqrt(2Ry_eye) + sqrt(2Rh)` — the standard two-term horizon, exact for
 * `h << R`. `R` here is the world's *effective* radius as the height field
 * renders it, not its physical one: `ground.js` applies the curvature drop as
 * `(x² + z²) / (2·R·0.34)`, a deliberate 3× exaggeration, and the horizon has to
 * agree with the ground it is standing on rather than with the ephemeris.
 */
export function geometricHorizon(Reff, yEye, hMax) {
  const a = Math.sqrt(2 * Reff * Math.max(yEye, 0.1));
  const b = Math.sqrt(2 * Reff * Math.max(hMax, 0.1));
  return a + b;
}

/**
 * Where the bands go, and how many there are.
 *
 * `r0` is fixed by geometry: the curtain must sit beyond every triangle of
 * retained terrain, including the *corners* of the outermost retained ring,
 * or it will occlude ground that is in front of it. Everything past that is
 * a geometric progression out to `rMax`, at a ratio chosen so a band is added
 * only when there is a band's worth of haze to separate it from its neighbour.
 *
 * The band count is therefore a property of the world's air, not a constant:
 * a hazy temperate valley gets one soft band, a thin-atmosphere world gets
 * four, and both are the same three lines of arithmetic.
 */
export function bandPlan(r0, rMax, ratio = 1.5) {
  if (!(rMax > r0)) return [r0];
  const n = Math.min(MAX_BANDS, Math.max(1, Math.round(Math.log(rMax / r0) / Math.log(ratio))));
  const g = Math.pow(rMax / r0, 1 / n);
  const radii = [];
  for (let k = 0; k < n; k++) radii.push(r0 * Math.pow(g, k));
  return radii;
}

// ---------------------------------------------------------------------------
// the measurement

/**
 * March the world's height field and record the skyline.
 *
 * One pass per azimuth, log-spaced in radius so the radial step always matches
 * the azimuthal one — `r *= 1 + τ/segs` keeps a sample every 1.64° of arc at
 * every distance, which bounds the total work at `segs · ln(rMax/rNear)/0.0286`
 * regardless of how far the bands reach. On a temperate world that is about
 * 18k evaluations, against the 32k `_buildTerrain` already spends.
 *
 * Three things come back per azimuth:
 *
 *   `occ`     the maximum elevation angle of the terrain that is still being
 *             drawn. Everything at or below this angle along that ray is
 *             occluded by real ground — provable, because the terrain profile
 *             is continuous from the eye outward, so a ray at a shallower angle
 *             than the crest must strike the crest's near flank first. It is
 *             what lets the curtain's foot be placed with a guarantee rather
 *             than with a margin.
 *
 *   `tan`     per band, the maximum elevation angle over that band's annulus —
 *             the silhouette itself.
 *
 *   `hitY`/`hitD`  per band, the true height and true distance of the terrain
 *             that produced that angle. The curtain is drawn somewhere else
 *             entirely, so the fog has to be told what it is actually looking
 *             at; passing the reprojected position instead would have graded
 *             a 12 km peak as though it were 4 km away.
 */
export function marchSkyline(heightAt, opts) {
  const {
    yEye, radii, rMax, nearHalf,
    ox = 0, oz = 0, segs = RIDGE_SEGS, rNear = 24, seaLevel = null,
  } = opts;
  const nb = radii.length;
  const cols = segs + 1;                       // the last column closes the ring
  const occ = new Float64Array(cols).fill(-Infinity);
  const band = [];
  for (let k = 0; k < nb; k++) {
    band.push({
      tan: new Float64Array(cols).fill(-Infinity),
      hitY: new Float64Array(cols),
      hitD: new Float64Array(cols),
      lowY: new Float64Array(cols).fill(Infinity),
    });
  }

  const growth = 1 + TAU / segs;
  // The occlusion sweep runs at a third of the silhouette's radial resolution,
  // and the asymmetry is a proof rather than a saving.
  //
  // `occ` decides only how far *down* the curtain's foot goes, through
  // `min(occ, crest) - BASE_DROP`. Sampling it coarsely can only lower the
  // maximum it finds, which can only lower the foot, which can only mean the
  // curtain covers *more* than it needs to. Under-reading `occ` is safe in the
  // one direction that matters; over-reading it is what would open a seam. So
  // the leg that spends 90% of the march — from underfoot out to the ground's
  // own edge — is the leg that can afford to be cheap.
  const occGrowth = Math.pow(growth, 3);
  let maxCrestY = -Infinity, minCrestY = Infinity, samples = 0;

  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    // the retained rings are squares, so the ground's edge along this azimuth
    // is where the ray leaves the square — not a circle of radius `nearHalf`
    const rEdge = nearHalf / Math.max(Math.abs(ca), Math.abs(sa));

    // leg one: what the retained ground hides
    for (let r = rNear; r <= rEdge; r *= occGrowth) {
      let h = heightAt(ox + ca * r, oz + sa * r);
      if (seaLevel !== null && h < seaLevel) h = seaLevel;
      samples++;
      const ang = (h - yEye) / r;
      if (ang > occ[i]) occ[i] = ang;
    }

    // leg two: the silhouette. Gridded from the ground's edge rather than
    // continuing leg one's — the two legs run at different strides, and letting
    // the coarse one choose where the fine one starts leaves a gap of up to a
    // full coarse step at exactly the radius where the elevation angles are
    // largest, which is the one place a missed sample costs real silhouette.
    for (let r = rEdge; r <= rMax; r *= growth) {
      let h = heightAt(ox + ca * r, oz + sa * r);
      // a sea is a skyline too: where the land is drowned the horizon is the
      // water's, and islands rise out of it without a special case
      if (seaLevel !== null && h < seaLevel) h = seaLevel;
      samples++;
      // everything past the retained ground belongs to a band; the stretch
      // between the ground's edge and the first curtain belongs to the first
      let k = 0;
      for (let j = nb - 1; j >= 1; j--) if (r >= radii[j]) { k = j; break; }
      const b = band[k];
      const ang = (h - yEye) / r;
      if (ang > b.tan[i]) { b.tan[i] = ang; b.hitY[i] = h; b.hitD[i] = r; }
      if (h < b.lowY[i]) b.lowY[i] = h;
      if (h > maxCrestY) maxCrestY = h;
      if (h < minCrestY) minCrestY = h;
    }
  }

  // close the ring: the last column is the first, so the seam is exact rather
  // than nearly exact. A one-column mismatch here is a hairline of sky through
  // the horizon, and it would appear at a different azimuth on every world.
  const close = (arr) => { arr[segs] = arr[0]; };
  close(occ);
  for (const b of band) { close(b.tan); close(b.hitY); close(b.hitD); close(b.lowY); }

  return {
    occ, band, segs, samples,
    maxCrestY: Number.isFinite(maxCrestY) ? maxCrestY : yEye,
    minCrestY: Number.isFinite(minCrestY) ? minCrestY : yEye,
  };
}

/**
 * A band's foot, per azimuth.
 *
 * Not the reference's single negative constant per band (`y: -40 … -260`) — a
 * per-column value derived from what the near terrain actually hides along that
 * column. Two properties fall out of `min(occ, crest) - BASE_DROP` and both are
 * assertions rather than hopes:
 *
 *   · the foot is never above the near terrain's silhouette, so no sky can show
 *     between the ground's edge and the curtain;
 *   · the foot is never above the crest, so the strip never inverts, even where
 *     a near hill stands taller than everything behind it (there the band
 *     collapses to nothing, which is correct — it is entirely hidden).
 */
export function baseAngles(occ, tan, drop = BASE_DROP) {
  const out = new Float64Array(tan.length);
  for (let i = 0; i < tan.length; i++) {
    const o = Number.isFinite(occ[i]) ? occ[i] : tan[i];
    out[i] = Math.min(o, tan[i]) - drop;
  }
  return out;
}

// ---------------------------------------------------------------------------
// the geometry

/**
 * One band, as plain typed arrays. No three import — this module has to be
 * runnable in node so `tools/verify.js` can assert the occlusion property
 * against the same height field the browser uses (§7.3).
 *
 * Two vertices per column, two triangles per segment: 220 segments is 442
 * vertices and 440 triangles per band. Four bands is 1760 triangles against
 * ring 2's ~9000, and the fragment shader they carry evaluates **no noise and
 * samples no texture** — against the terrain fragment's 20 noise call sites and
 * 6 shadow-map samples under `?mat=1&paint=1`, several of those triplanar and
 * therefore three lookups each. That, rather than a ratio nobody measured, is
 * why this is cheap: there is nothing in it to be expensive.
 */
export function buildBand(prof, base, { radius, yEye, ox = 0, oz = 0 }) {
  const cols = prof.tan.length;
  const segs = cols - 1;
  const position = new Float32Array(cols * 2 * 3);
  const aH = new Float32Array(cols * 2);
  const aTrueD = new Float32Array(cols * 2);
  const aTrueY = new Float32Array(cols * 2);
  const index = new Uint32Array(segs * 6);

  for (let i = 0; i < cols; i++) {
    const a = (i / segs) * TAU;
    const x = ox + Math.cos(a) * radius;
    const z = oz + Math.sin(a) * radius;
    // §11 · a column the march never reached would put a −Infinity into the
    // vertex buffer, and a NaN in geometry is the same class of failure as a
    // NaN in the bloom pyramid: it is smeared over a neighbourhood by the
    // rasteriser and survives everything downstream. The march always reaches
    // every column on both call paths — this is here so that staying true is
    // not a precondition of the buffer being finite.
    const tTop = Number.isFinite(prof.tan[i]) ? prof.tan[i] : 0;
    const tBot = Number.isFinite(base[i]) ? Math.min(base[i], tTop) : tTop - BASE_DROP;
    // the reprojection: a curtain at `radius` carries the true silhouette of
    // terrain at `hitD` because it preserves the elevation angle exactly
    const yTop = yEye + radius * tTop;
    const yBot = yEye + radius * tBot;
    const b = i * 6, t = b + 3;
    position[b] = x; position[b + 1] = yBot; position[b + 2] = z;
    position[t] = x; position[t + 1] = yTop; position[t + 2] = z;
    aH[i * 2] = 0; aH[i * 2 + 1] = 1;
    // both vertices report the distance of the terrain the column stands for;
    // only the height differs, because the foot represents the low ground the
    // crest rises out of and §9.3's falloff is what turns that into a gradient
    const d = prof.hitD[i] || radius;
    aTrueD[i * 2] = d; aTrueD[i * 2 + 1] = d;
    aTrueY[i * 2] = Number.isFinite(prof.lowY[i]) ? prof.lowY[i] : prof.hitY[i];
    aTrueY[i * 2 + 1] = prof.hitY[i];
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2, bI = a + 1, c = a + 2, d = a + 3;
    const o = i * 6;
    index[o] = a; index[o + 1] = bI; index[o + 2] = c;
    index[o + 3] = c; index[o + 4] = bI; index[o + 5] = d;
  }
  return { position, aH, aTrueD, aTrueY, index, radius, segs };
}

/**
 * The whole horizon, from a height field and a world.
 *
 * `nearHalf` is the half-extent of the outermost *retained* terrain ring, and
 * `r0` clears its corner — `nearHalf·√2` — plus however far the eye stands from
 * the anchor, plus a margin. Anchoring at the eye rather than at the terrain's
 * origin is what makes the opening frame exactly right (§9.7); it costs a
 * bounded parallax error as the walker leaves the spawn, and at 99% haze that
 * error is not a visible quantity.
 */
export function buildHorizon(heightAt, opts) {
  const {
    yEye, nearHalf, params, Reff, seaLevel = null,
    ox = 0, oz = 0, eyeR = 0, eyeH = 1.68, segs = RIDGE_SEGS, margin = 200,
    probeCrest = null, required = true,
  } = opts;

  const r0 = nearHalf * Math.SQRT2 + eyeR + margin;

  // The crest height the limits are computed at. A cheap coarse probe rather
  // than a guess: the two limits both depend on how tall the tallest thing out
  // there is, and assuming a number would make the band count a constant again.
  const crest = probeCrest ?? probeMaxHeight(heightAt, { ox, oz, r0, rProbe: r0 * 4, seaLevel });
  const sat = saturationRadius(params, Math.max(crest - yEye, 0), params.hazeH);
  // Both terms are heights above the *local surface*, which is what the
  // two-term horizon formula means by them — not heights above the eye, and not
  // heights above the datum. Standing on a 500 m summit does not shorten your
  // horizon, and a peak 200 m below you is still over it at some distance;
  // measuring either from the wrong origin gets both of those backwards.
  const groundY = yEye - eyeH;
  const geo = geometricHorizon(Reff, eyeH, crest - groundY);
  const limit = Math.min(sat, geo);

  // Two different reasons to draw a horizon, and they need different answers
  // when there is nothing out there to draw.
  //
  //   required — the outermost terrain ring has been retired, so the ground now
  //     stops in mid-air at `r0` and *something* has to close the gap between
  //     its edge and the sky. A band is drawn even when the air saturates
  //     before it, because at that point the band is the only thing standing
  //     between the viewer and a hard geometric edge.
  //
  //   optional — the ring is still there and doing its job. A band is worth
  //     adding only if there is genuinely visible ground beyond where the ring
  //     stops, which on a world with thin air and tall mountains there often
  //     is. Where there is not, the honest answer is no geometry at all.
  const rMax = required ? Math.max(limit, r0 * 1.15) : limit;
  if (!required && rMax <= r0 * 1.05) {
    return { bands: [], radii: [], r0, rMax, sat, geo, crest, sky: null };
  }

  const radii = bandPlan(r0, rMax);
  const sky = marchSkyline(heightAt, {
    yEye, radii, rMax, nearHalf, ox, oz, segs, seaLevel,
  });

  // Each band's foot only has to clear what is actually in front of it, and
  // after the first band that includes the previous band's own crest. Measured
  // against a shared `occ` instead, the outer bands on a mountainous world were
  // each drawn 15° tall so their feet could reach a valley floor that three
  // nearer curtains already covered — fourteen degrees of pure overdraw, on the
  // widest geometry in the frame.
  const occRun = Float64Array.from(sky.occ);
  const bands = [], kept = [];
  for (let k = 0; k < radii.length; k++) {
    const prof = sky.band[k];
    // A band that rises nowhere above what is already in front of it is
    // invisible, and the air has no say in that — occlusion does. Without this,
    // a world whose nearest ridge is also its tallest drew four curtains and
    // showed one, which is the failure mode `bandPlan` cannot see from the
    // extinction curve alone.
    let rises = false;
    for (let i = 0; i < prof.tan.length; i++) {
      if (prof.tan[i] > occRun[i] + 1e-9) { rises = true; break; }
    }
    if (!rises) continue;
    bands.push(buildBand(prof, baseAngles(occRun, prof.tan), { radius: radii[k], yEye, ox, oz }));
    kept.push(k);
    for (let i = 0; i < prof.tan.length; i++) {
      if (prof.tan[i] > occRun[i]) occRun[i] = prof.tan[i];
    }
  }

  return { bands, radii: kept.map((k) => radii[k]), planned: radii, kept, r0, rMax, sat, geo, crest, sky };
}

/** a coarse ring probe for the tallest thing beyond the retained terrain */
export function probeMaxHeight(heightAt, { ox, oz, r0, rProbe, seaLevel = null, n = 48, m = 10 }) {
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j <= m; j++) {
      const r = r0 * Math.pow(rProbe / r0, j / m);
      let h = heightAt(ox + ca * r, oz + sa * r);
      if (seaLevel !== null && h < seaLevel) h = seaLevel;
      if (h > hi) hi = h;
    }
  }
  return Number.isFinite(hi) ? hi : 0;
}

// ---------------------------------------------------------------------------
// the colour

const lum = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

/**
 * A mountain six kilometres away is not the colour of the rock it is made of.
 * It is the area average of rock, vegetation, snow, shadowed gully and lit
 * flank over several hectares — which is darker and very much less saturated
 * than any of its ingredients. Painting a ridge in the terrain's own albedo is
 * the single most common way a distant hill ends up looking like a cardboard
 * cutout of a near one.
 *
 * So: mix the world's own three terrain colours in the proportion a slope
 * actually presents them, desaturate toward that mixture's own luminance, and
 * scale for the half of every ridge that faces away from a low sun. Snow, when
 * the world has it, goes back on top — it is the one ingredient that survives
 * area-averaging, because it covers rather than speckles.
 */
export function ridgeAlbedo(colA, colB, colC, snow = 0) {
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  let c = mix(colB, colA, 0.35);         // rock, with soil in the gullies
  c = mix(c, colC, 0.20);                // and whatever grows on the shoulders
  const g = lum(c);
  c = mix(c, [g, g, g], 0.45);           // hectares average to grey
  c = c.map((v) => v * 0.62);            // half of every ridge is in its own shadow
  if (snow > 0) c = mix(c, [0.88, 0.91, 0.96], Math.min(snow, 1) * 0.30);
  return c;
}

// ---------------------------------------------------------------------------
// the shaders

export const HORIZON_VERT = /* glsl */`
  attribute float aH;
  attribute float aTrueD;
  attribute float aTrueY;
  varying float vH;
  varying float vTrueD;
  varying float vTrueY;
  varying vec3 vW;
  void main() {
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    vH = aH; vTrueD = aTrueD; vTrueY = aTrueY;
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }
`;

/**
 * The fragment shader, assembled. `aerial` is `AERIAL_GLSL` or an empty string —
 * the same chunk the terrain uses, because a horizon graded by a *different*
 * fog than the ground in front of it is a seam you cannot unsee once you have.
 *
 * There is no normal here and there is deliberately no attempt to fake one.
 * §M2 asks for pure shape; a shading term invented for a surface that has no
 * geometry is the exact "PBR instinct" §11 warns about, and it would put
 * lighting detail on the one object in the frame whose entire job is to have
 * none. Two cues only, and both are readings of something real:
 *
 *   · the sunward arc of the horizon is warmer, because those slopes face the
 *     sun — a ring-scale fact that survives having no normals;
 *   · the crest is lighter than the foot, which §9.3's height falloff produces
 *     on its own from the true heights the vertices carry. The reference paints
 *     that gradient by hand (`mix(0.72, 0.30, t)`); here it is derived, and it
 *     therefore changes correctly when the air does.
 */
export function horizonFragment(aerialChunk = '') {
  return /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uCam;
  uniform vec3 uRidge;      // this world's distant ground, area-averaged
  uniform vec3 uRidgeWarm;  // what the sunward arc catches
  uniform vec3 uHorizon;
  uniform vec2 uCentre;     // the bands' anchor in xz
  varying float vH;
  varying float vTrueD;
  varying float vTrueY;
  varying vec3 vW;
  ${aerialChunk}

  void main() {
    vec3 col = uRidge;
    // The same dusk term the terrain uses, derived here rather than passed:
    // a uniform is a thing that can fail to be synced, and the horizon going
    // on shining after the ground has gone dark is a defect nothing in a
    // daylight capture would reveal.
    float dusk = smoothstep(-0.12, 0.12, uSunDir.y);

    // The sunward arc. Guarded on the sun's azimuthal length: at zenith the
    // sun has no azimuth, normalize() of a zero vector is a NaN, and a NaN here
    // reaches the bloom pyramid and comes back as a solid block (§11).
    vec2 sxz = uSunDir.xz;
    float sl = length(sxz);
    vec2 outward = vW.xz - uCentre;
    float ol = length(outward);
    float side = 0.5;
    if (sl > 1e-4 && ol > 1e-4) {
      side = mix(0.5, clamp(dot(outward / ol, sxz / sl) * 0.5 + 0.5, 0.0, 1.0),
                 smoothstep(0.0, 0.16, sl));
    }
    col = mix(col * 0.94, mix(col, uRidgeWarm, 0.34), side);

    // ridgelines are lighter than their bases — the part of that which is
    // backlight rather than haze, since §9.3 supplies the haze part itself
    col = mix(col, col * 1.06, smoothstep(0.55, 1.0, vH));
    col *= mix(0.35, 1.0, dusk);

    // The distance the fog is told is the *terrain's*, not the curtain's,
    // corrected for wherever the camera has walked to since the anchor was
    // chosen. Feeding it the curtain's own distance would grade a 12 km peak
    // as though it stood at 4 km, which is the entire reason the true distance
    // rides along as an attribute.
    float dCam = length(vW - uCam);
    float dAnchor = length(vW.xz - uCentre);
    float dist = max(vTrueD + (dCam - dAnchor), 1.0);
    ${aerialChunk ? /* glsl */`
    gl_FragColor = aerial(col, dist, normalize(uCam - vW), uSunDir, vTrueY);
    ` : /* glsl */`
    col = mix(col, uHorizon * max(dusk, 0.08), 1.0 - exp(-dist * 0.0007));
    gl_FragColor = vec4(col, 1.0);
    `}
  }
`;
}
