// SCALE 3 — STANDING ON A WORLD
//
// Descend from orbit and the planet becomes a place: a heightfield carved by
// the same palette that painted it from space, under a sky whose sun is the
// system's actual star — correct color, correct angular size for this orbit.
// Walk (WASD, drag to look), or press F and fly. The day turns; when the sun
// sets on an inhabited world, the glow of cities rises over the ridgeline.

import * as THREE from 'three';
import { RNG, arand, hash } from './rng.js';
import { NOISE_GLSL, makeSurfaceMaterial, makeRingMaterial, makeAtmosphereMaterial } from './planet.js';
import { softDotTexture } from './nebula.js';
import { addLife, isBiosphere } from './life.js';
import { addCivilization } from './civilization.js';
import { addTraveler } from './traveler.js';
import { CONJURE_TIME, Conjuration } from './conjure.js';
import { launchFor, launchState, stepLaunch } from './climb.js';
import { addShips } from './ships.js';
import { addFlare } from './flare.js';
import { addGrass } from './grass.js';
import { addRuins } from './ruins.js';
import { addWildlife } from './wildlife.js';
import { addConstellations } from './constellations.js';
import { addCaravan } from './caravan.js';
import { addWeather } from './weather.js';
import { addFestival } from './festival.js';
import { addHerds } from './herds.js';
import { addMegafauna } from './megafauna.js';
import { addGodRays } from './godrays.js';
import { addRivers } from './rivers.js';
import { addInterior } from './interior.js';
import { findLandingSite } from './terrain.js';
import { solveLandingSite, SUN_BAND } from './landing.js';
import { PAINT_GLSL, lightFor } from './paint.js';
import { exposureFor, nightFraction, nightLight, skyLux } from './night.js';
import { AERIAL_GLSL, aerialParams, airFor, applyAerial, visibilityFor } from './aerial.js';
import { makeSurfaceSky } from './starfield.js';
import { makeCumulus } from './clouds.js';
import { addAurora } from './curtain.js';
import {
  NO_LIMIT, buildHorizon, ridgeAlbedo, saturationRadius, HORIZON_VERT,
  horizonFragment,
} from './horizon.js';
import { MATERIAL_GLSL, materialPalette, worldBias } from './material.js';
import {
  EXTINCTION as EXTINCTION_V, OCEAN_GLSL, buildWaves, significantHeight, waveUniforms,
} from './ocean.js';
import { GAIT, Walker, gravityOf } from './avatar.js';
import { ascentFraction, ascentState, handoff, releaseAltitude, stepAscent } from './ascent.js';
import { isThin, roomAddress, thinPoint } from './liminal.js';
import { CameraRig } from './camera.js';
import { attachKeyboard, input, jumpHeld, keys } from './input.js';
import { makeGround } from './ground.js';
import {
  CLOUD_SPEEDUP, CLOUD_VEER, makeWind, meanFlow, windAt,
} from './wind.js';
import { GrassRing, WindField } from './flora.js';
import { PART_RADIUS, RINGS } from './meadow.js';
import { HOVER } from './vehicle.js';
import { SHADOW_GLSL, SunShadow, markCaster } from './shadow.js';
import { Q, TIER, qArr, qInt } from './quality.js';

const PARAM = (k) => {
  try { return new URL(window.location.href).searchParams.get(k); }
  catch { return null; }
};

/** M2 — the print and the rebuilt bloom. **Default-on**; `?m2=0` goes back. */
const M2 = PARAM('m2') !== '0';

/**
 * §9.2's light model, act 3. It rides M2 because it is the same milestone, but
 * it is separable in *both* directions: `?m2=1&paint=0` is the print without
 * the lighting, and `?paint=1` is the lighting without the print. Without the
 * second of those, every measurement of the light model is taken through a
 * tonemap that lifts shadows 2.66× — which is how a debug frame meant to show
 * a shadow term came back reading white everywhere.
 *
 * §7.4 asks for a flag per change; one flag for three changes is the same
 * defect as no flag at all.
 */
/**
 * §9.2's light model — **still default-off**. `?paint=1` turns it on.
 *
 * This commit tried to flip it and put it back, which is worth recording in
 * full, because the reasoning that said it was ready was sound and the frame
 * disagreed.
 *
 * The original note said `?paint=1` flattens the terrain to a single pale
 * wash, and diagnosed it exactly: the three-stop ramp bands at `t = 0.17` and
 * `t = 0.58`, where `t` is the half-Lambert wrap `ndl·0.62 + 0.46`. That wrap
 * maps the whole lit hemisphere into 0.46–1.0, so at a +24° sun over open
 * ground every pixel lands above the upper band edge — one band occupied, one
 * colour out, every scrap of normal variation quantised away. It then named
 * two dependencies and said neither existed:
 *
 *   §9.7's 8–18° spawn sun, which is the geometry the ramp is tuned for;
 *   act 4's materials, which give the ramp three different stops to move
 *   between rather than three points on one line through one colour.
 *
 * Both existed, behind their own default-off flags. Both were supplied — the
 * sun band unconditionally (see `_sunPhaseFacing`'s call site) and `?mat=` by
 * default. The sun came out at +12°, in band, confirmed in the HUD.
 *
 * **It is still flat.** Three frames on seed 20250601 at Vindah II, 560×320,
 * grass off, everything else at ship defaults:
 *
 *   `?paint=0&mat=0`   mid-ground holds visible green mottling
 *   `?paint=0&mat=1`   indistinguishable from the above at this range
 *   `?paint=1&mat=1`   paler, and the mottling is gone
 *
 * So the dependency chain was necessary and not sufficient, and the remaining
 * cause is something the two fixes do not touch. The strongest candidate is
 * that the frame is fog-dominated long before the ramp gets a say: §9.3's
 * aerial perspective is carrying most of the lower half at a 1.68 m eye
 * height, so the light model is being asked to add contrast to pixels that
 * have already been lerped most of the way to the haze colour. That is a
 * measurement someone can take — sample the alpha channel §9.3 writes the fog
 * fraction into and see what fraction of the frame is past 0.8 — and it is not
 * this commit's to take.
 *
 * The flag therefore stays where the evidence puts it. `?mat=`, `?sea=`,
 * `?ridge=`, `?m3=` and `?m5=` all flipped on in the same commit and all stay
 * on; none of them showed a regression and every one of them showed a gain.
 * Flipping nine flags and keeping eight is the outcome, not a failure of it —
 * the alternative was flipping none, which is where this started.
 */
const PAINT = PARAM('paint') === '1';

/**
 * §9.3's aerial perspective, act 2. Separable both ways for the same reason
 * `?paint=` is: `?m2=1&aerial=0` is the print over the old one-line fog, and
 * `?aerial=1` is the depth cue without the print. One flag for three changes is
 * the same defect as no flag at all (§7.4).
 *
 * It also writes the fog fraction into the alpha channel, which is what §9.4
 * step 5 spends on distance-graded softening — so with `?aerial=0` the print
 * has no distance to read and that step is inert. That is the intended
 * behaviour of the flag, not a gap in it.
 */
const AERIAL = PARAM('aerial') === '1' || (M2 && PARAM('aerial') !== '0');

/**
 * §M4 — the body, the camera rig and the shared input axis. **Default-on**;
 * `?m4=0` restores the old inline walk.
 *
 * It keeps its own flag rather than riding M2's because it changes what the
 * frame *is* rather than how it is printed: eye height moves 1.80 → 1.68 m and
 * the field of view 62 → 52, which are §6 M4's numbers and the reference's.
 * Both move every existing capture, which is why the flip is this commit and
 * not the one that built them (§7.4).
 */
const M4 = PARAM('m4') !== '0';

/**
 * §M5 — traversal. **Now default-on**; `?m5=0` goes back.
 *
 * At this scale it is the continuous mount, the tested hover dynamics, the
 * short hop, and what the craft disturbs — dust, spray and grass, all through
 * the one wind field M3 act 6 established. The speed *governor* is planet
 * scale's, not this one's: a 1400 m tile is a fixed mesh with nothing to
 * stream, so there is nothing here to outrun.
 *
 * The gate it was waiting on is met — `tools/verify.js` carries the mount,
 * dismount, momentum-handover and eye-continuity checks, and they are green —
 * and a craft nobody can board is not traversal. §7.4's separate commit for
 * the flip is this one.
 */
const M5 = PARAM('m5') !== '0';

/**
 * **The worlds are wild.** `?built=1` puts the architecture back.
 *
 * §6 M6 built four tiers of settlement — towns, a port city, temples, houses
 * you can walk into — and it works. It is also the wrong thing to be standing
 * in. §3 already settled that "minimalism is a property of the chrome,
 * maximalism is a property of the world", and this is the human reading that
 * ruling one step further in session: the maximalism that belongs to a world of
 * this kind is *weather, light, grass and distance*, not masonry. A colonnade
 * on the horizon turns a place into a set, and a set is something you look at
 * rather than somewhere you are.
 *
 * §4 is the older half of the same argument — "this is a place, not a game
 * loop" — and a temple with a door is the beginning of a game loop whatever is
 * behind it.
 *
 * Nothing is deleted. `civilization.js`, `city.js`, `settlement.js`,
 * `ruins.js` and `interior.js` are untouched and every one of them is one URL
 * parameter away, which is the same bargain §2.4 makes everywhere else: the
 * default is a decision, not a demolition.
 */
const BUILT = PARAM('built') === '1';

/**
 * `?climb=1` — fly up and the ground lets go, instead of pressing Escape.
 *
 * Default-off (§7.4), and it is the only feature in this repo whose *purpose*
 * is to remove a §2.5 violation rather than to add something: the surface has
 * always been the one scale you leave by a menu action. `src/ascent.js` has the
 * law and the reasoning; this is the twelve lines that call it.
 */
const CLIMB = PARAM('climb') === '1';

/**
 * §9.6's painted sky and the cumulus deck that belongs to it. **Default-on**;
 * `?sky=0` restores the two-stop dome and the two sprite layers exactly (§2.4).
 *
 * It lands on rather than off, and that is a decision with a measurement behind
 * it. `starfield.js:makeSurfaceSky` and `clouds.js:makeCumulus` have been in the
 * tree, parsed, and reachable by nothing — the same condition `craft.js` was in.
 * The frame they replace measures 0.267 saturation at the zenith against
 * §9.1's 0.567, because nine of §9.1's ten sky stops were never read. Shipping
 * the fix behind a default-off flag would be the third time in this repo that a
 * finished feature waited for a flip nobody remembered to make, and §7.4's
 * separate commit for that flip is what this comment is.
 */
const SKY = PARAM('sky') !== '0';

/**
 * `?noclip=1` — the rooms between, entered from the ground. Default-off (§7.4).
 *
 * Only ~3.8% of worlds have anywhere to fall through, and that number is the
 * birthday problem rather than a setting (`src/liminal.js` §2). On the rest
 * this flag costs one `isThin` call at construction and then nothing at all.
 */
const NOCLIP = PARAM('noclip') === '1';

/** `?shdebug=1` — output the shadow term itself, so it can be looked at */
const SHADOW_DEBUG = PAINT && (PARAM('shdebug') === '1' || PARAM('shdebug') === '2');

/**
 * `?solve=1` — choose the opening frame with the §9.7 composition solver
 * instead of `findLandingSite`'s height-above-waterline heuristic.
 *
 * Default-off per §7.4, and this one has a specific reason to stay off: the
 * solve costs 127–337 ms of main thread, once, inside `_buildTerrain`. That is
 * 10–28× §5's 12 ms frame budget in the frame it lands, and §2.5 forbids
 * covering it with a cut. Flipping the default waits on either a measurement
 * showing the hyperzoom absorbs it or a change that slices the solve across
 * frames — a separate commit either way.
 */
const SOLVE = PARAM('solve') === '1';

/**
 * §M2 act 4 — four-layer triplanar materials. **Now default-on**; `?mat=0`
 * restores the slope/altitude colour ramp.
 *
 * It has two jobs. The first is the one §M2 states: ground you can name from a
 * still, which the ramp it replaces cannot give, because the same lerp
 * produces every surface and none of them has an identity. §M2's gate is
 * literally "every material nameable from a still" (§8 axis 5), and off by
 * default it could never be met in a shipped frame.
 *
 * The second is to unblock `?paint=`. §9.2's ramp was flattening the terrain
 * (docs/plans/M2.md §24.4) partly because its three stops were three points on
 * one line through one colour. `material.js` gives each of four layers its own
 * hue path, so the ramp has somewhere to go. That is why these two flip
 * together and not one at a time.
 */
const MAT = PARAM('mat') !== '0';

/**
 * §M2 act 5 — the sea. **Now default-on**; `?sea=0` goes back.
 *
 * Twelve Gerstner waves on a Pierson–Moskowitz spectrum, Beer–Lambert depth in
 * discrete bands, quantised glitter, and foam where the surface genuinely
 * overturns. What it replaces is two crossed sine waves, which have no crests:
 * a sine is symmetric about its own mean and the sea is not.
 */
const SEA = PARAM('sea') !== '0';

/**
 * §M2 act 6 — far ridges as pure silhouette in haze. **Now default-on**;
 * `?ridge=0` goes back.
 *
 * Concentric curtains whose crest line is the *measured* skyline of this
 * world's own height field — the maximum elevation angle along each azimuth,
 * reprojected onto a convenient radius. See `src/horizon.js` for why measuring
 * it matters rather than generating it, and for the arithmetic that decides
 * whether the outermost terrain ring is still contributing anything.
 *
 * This is also the only thing in the build that gives §8 axis 3 its third
 * depth plane: without it the 1400 m tile simply ends, and the frame has a
 * near ground and a sky and nothing between them.
 */
const RIDGE = PARAM('ridge') !== '0';

/**
 * §M3 — wind and grass. **Now default-on**; `?m3=0` returns to bare ground.
 *
 * The note here used to say "act 3 wires the first ring only", which was true
 * when it was written and has not been true since `_buildMeadow` grew its loop
 * over `RINGS`. All four are wired, the density law is one continuous
 * expression across them (`meadow.js` holds it to 0.27%), and the double
 * thinning is in. `?windview=1` still shows the field on its own.
 *
 * This is the flag whose absence was most visible: a "walkable surface" that
 * renders as an untextured dome of ground is not the milestone, and §M3's gate
 * — "grass reads as *meadow* at the horizon, not as a green plane" — cannot be
 * scored on a frame with no grass in it.
 */
const M3 = PARAM('m3') !== '0';

/**
 * §9.3 into the materials three.js owns, not just the three this file writes.
 * Default-off (§7.4) — flipping it is its own commit, with the measurement.
 * `?m2=1&airmat=1` is the whole village standing in the air rather than in
 * front of it.
 */
const AIRMAT = PARAM('airmat') === '1';

/**
 * The aurora curtain — src/curtain.js. Default-off (§7.4).
 *
 * `?sun=<degrees>` puts the sun at a chosen elevation and holds it there, which
 * this needs (an aurora is invisible above about −2°) and which §7.5 has wanted
 * all along: two captures of "the same frame" taken minutes apart had the sun
 * in different places, and every difference between them was that.
 */
const AURORA = PARAM('aurora') === '1';
const SUN_AT = PARAM('sun') === null ? null : Number(PARAM('sun'));
/**
 * `?storm=<0..1.6>` pins the substorm instead of letting it cycle. A capture
 * control like `?sun=`, and the only way to photograph the two ends of the
 * same display: at 0.3 an aurora is below the cone threshold and genuinely
 * colourless, at 1.4 it is full green. Both are the same physics.
 */
const STORM_AT = PARAM('storm') === null ? null : Number(PARAM('storm'));

const WINDVIEW = PARAM('windview') === '1';

const EXT = 1400;            // terrain extent, ~metres
const RES = 180;             // heightfield resolution
const EYE = 1.8;

// The JS fbm that used to live here now lives in `src/ground.js`, which owns
// the walkable ground outright. Leaving a copy behind would have recreated the
// exact fault this commit is removing — two definitions, free to drift.

// ------------------------------------------------------------ shaders ------
const TERRAIN_VERT = /* glsl */`
  varying vec3 vW;
  varying vec3 vN;
  void main() {
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }
`;

const TERRAIN_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uColA;    // soil
  uniform vec3 uColB;    // rock
  uniform vec3 uColC;    // low / vegetation
  uniform vec3 uHorizon;
  uniform vec3 uCam;
  uniform float uSeed;
  uniform float uAmp;
  uniform float uSnow;
  uniform float uLava;
  uniform float uTime;
  uniform float uWet;    // 0 dry … 1 rain-soaked
  varying vec3 vW;
  varying vec3 vN;
  ${NOISE_GLSL}
  ${PAINT ? SHADOW_GLSL + PAINT_GLSL : ''}
  ${AERIAL ? AERIAL_GLSL : ''}
  ${MAT ? MATERIAL_GLSL : ''}

  uniform float uSea;    // sea level in world y, or -1e9 for a dry world

  void main() {
    vec3 n = normalize(vN);
    float hgt = vW.y / uAmp;
    float slope = 1.0 - n.y;

    float detail = fbm(vec3(vW.xz * 0.02, uSeed)) * 0.5 + 0.5;
    float micro  = fbm3(vec3(vW.xz * 0.35, uSeed * 2.0)) * 0.5 + 0.5;
    float grain  = fbm3(vec3(vW.xz * 1.7, uSeed * 5.0)) * 0.5 + 0.5;

    // detail normals: the ground is not a billboard — two noise octaves
    // tilt the surface so raking light finds texture everywhere
    float bumpF = 1.0 - smoothstep(60.0, 420.0, length(vW - uCam));
    vec3 nb = n;
    nb.xz += vec2(snoise(vec3(vW.xz * 0.23, uSeed + 3.0)),
                  snoise(vec3(vW.xz * 0.23 + 19.0, uSeed + 7.0))) * 0.22 * bumpF;
    nb.xz += vec2(snoise(vec3(vW.xz * 1.4, uSeed + 11.0)),
                  snoise(vec3(vW.xz * 1.4 + 6.0, uSeed + 13.0))) * 0.1 * bumpF;
    nb = normalize(nb);

    ${MAT ? /* glsl */`
    // §M2 act 4 · four layers, one blend law, triplanar so nothing smears.
    //
    // near = the detail LOD: 1 underfoot, 0 past 30 m. §M2 asks for
    // "generated detail arrays inside 30 m" and this is that budget spent as a
    // coherent branch instead of a texture upload — past 30 m the finest two
    // octaves are sub-pixel, and every instruction on them buys nothing.
    float near = 1.0 - smoothstep(6.0, 30.0, length(vW - uCam));
    Ground gm = groundAt(vW, nb, uSea, uWet, near);
    vec3 col = gm.mid;
    float shore = 1.0 - smoothstep(uSea + 1.2, uSea + 7.0, vW.y);
    // The glitter below wants to know where snow is. It used to ask a
    // hand-rolled snow line; the rime weight is the same question answered by
    // the blend that actually decides it, so the sparkle cannot land anywhere
    // the snow is not.
    float snowLine = gm.w.w;
    ` : /* glsl */`
    // material bands, low to high: shore sand · meadow · soil · rock · snow
    float shore = 1.0 - smoothstep(uSea + 1.2, uSea + 7.0, vW.y);
    vec3 sand = mix(uColB, vec3(0.86, 0.76, 0.58), 0.6) * (0.9 + grain * 0.2);
    // the meadow is a patchwork: green running gold in field-sized swells
    float pw = fbm(vec3(vW.xz * 0.006 + 31.0, uSeed)) * 0.5 + 0.5;
    vec3 meadow = mix(uColC, uColC * vec3(1.35, 1.12, 0.55), smoothstep(0.42, 0.75, pw) * 0.65);
    vec3 col = mix(meadow, uColA, smoothstep(0.02, 0.45, hgt + detail * 0.25));
    col = mix(col, uColB, smoothstep(0.35, 0.85, hgt) * 0.8);
    col = mix(col, uColB * 0.85, smoothstep(0.22, 0.55, slope));
    // sheer faces bare their rock: dark strata streaked down the cliff
    float cliff = smoothstep(0.5, 0.78, slope);
    vec3 strata = uColB * (0.32 + 0.3 * (fbm3(vec3(vW.y * 0.06, vW.xz * 0.01)) * 0.5 + 0.5));
    col = mix(col, strata, cliff);
    col = mix(col, sand, shore * (1.0 - smoothstep(0.18, 0.4, slope)));
    // snow blankets the high ground but slides off the sheer faces
    float snowLine = smoothstep(0.45, 0.72, hgt + micro * 0.1) * (1.0 - cliff * 0.85);
    col = mix(col, vec3(0.92, 0.95, 1.0), max(uSnow, smoothstep(0.62, 0.85, hgt) * 0.9) * snowLine);
    col *= 0.8 + 0.3 * detail * micro + 0.12 * grain;
    `}

    // rain darkens and deepens the ground, pooling colour into the low spots
    col *= mix(1.0, 0.66, uWet);

    float dusk = smoothstep(-0.12, 0.12, uSunDir.y);
    ${PAINT ? /* glsl */`
    // §9.2 · every lit surface goes through one function.
    //
    // The three ramp stops are a *material* property and materials are act 4,
    // so they are derived from the base colour here: the shade stop leans cool
    // toward the shadow tint, the lit stop leans warm toward the sun. That is
    // the shape §9.1's palettes have — a hue *path* from root to tip, not a
    // brightness ramp — and act 4 replaces this derivation with the real four
    // layers rather than replacing the model.
    Surf sf;
    sf.N = nb;
    sf.V = normalize(uCam - vW);
    sf.L = uSunDir;
    ${MAT ? /* glsl */`
    // The stops are the *material's* now, not three points on one line through
    // one colour — which is what act 4 was the blocker for. Each of the four
    // layers carries its own hue path (cool toward the shadow tint, warm toward
    // the sun, and for vegetation warm toward yellow-green), so the ramp has
    // somewhere to go instead of returning one colour at every band.
    sf.shade = gm.shade;
    sf.mid   = gm.mid;
    sf.lit   = gm.lit;
    ` : /* glsl */`
    sf.shade = mix(col * 0.55, uPaintShadowTint * dot(col, vec3(0.33)), 0.28);
    sf.mid   = col;
    sf.lit   = mix(col * 1.22, uPaintSun * dot(col, vec3(0.42)), 0.20);
    `}
    sf.soft  = 0.10;
    // the painterly wobble: the band edge is drawn, not computed, and it is
    // keyed in metres so it keeps its shape at every distance
    sf.jit   = (fbm3(vec3(vW.xz * 0.09, uSeed)) * 0.5) * 0.055;
    sf.shadow = sunShadow(vW, dot(nb, uSunDir));
    sf.trans = 0.0; sf.transCol = vec3(0.0);
    sf.rim = 0.55;
    sf.ao = 1.0;
    sf.ambient = 1.0;
    vec3 lit = paint(sf) * mix(0.35, 1.0, dusk);
    ${SHADOW_DEBUG ? (PARAM('shdebug') === '2' ? 'lit = shadowProbe(vW);' : 'lit = vec3(sf.shadow);') : ''}
    ` : /* glsl */`
    // light: wrapped diffuse so dusk rakes long and soft, like film
    float diff = clamp((dot(nb, uSunDir) + 0.3) / 1.3, 0.0, 1.0);
    vec3 lit = col * (uSunColor * diff * diff * 1.35 + vec3(0.012, 0.014, 0.02) + uHorizon * 0.26 * dusk);
    `}

    // wet earth holds a broad sheen of the sky and the sun
    if (uWet > 0.02) {
      vec3 view = normalize(uCam - vW);
      float wetSpec = pow(max(dot(reflect(-uSunDir, nb), view), 0.0), 24.0);
      lit += (uSunColor * wetSpec * 0.5 + uHorizon * 0.12) * uWet * (0.3 + dusk);
    }

    // sand and snow catch the sun in tiny mirrors
    float glintM = max(shore * (1.0 - smoothstep(0.18, 0.4, slope)), uSnow * snowLine);
    if (glintM > 0.02) {
      vec3 view = normalize(uCam - vW);
      float spec = pow(max(dot(reflect(-uSunDir, nb), view), 0.0), 60.0);
      float sparkle = step(0.93, fbm3(vec3(vW.xz * 6.0, uSeed))) * 3.0;
      lit += uSunColor * spec * (0.5 + sparkle) * glintM * dusk;
    }

    if (uLava > 0.5) {
      float crack = 0.0;
      { float v = 0.0; float a = 0.5; vec3 p = vec3(vW.xz * 0.03, uSeed);
        for (int i = 0; i < 4; i++) { v += a * (1.0 - abs(snoise(p))); p = p * 2.13 + 5.7; a *= 0.5; }
        crack = v; }
      float glow = smoothstep(0.82, 0.97, crack) * (0.7 + 0.3 * sin(uTime * 0.8 + crack * 25.0));
      lit += vec3(1.0, 0.3, 0.05) * glow * 2.0 * smoothstep(0.3, 0.0, hgt);
    }

    // aerial perspective
    float dist = length(vW - uCam);
    ${AERIAL ? /* glsl */`
    // §9.3. The alpha is not decoration: it is this pixel's distance, and
    // §9.4 step 5 spends it on the watercolour softening. Anything that
    // overwrites it — a blend mode, a pass that ignores it — turns every
    // pixel's "distance" into a lie the print then acts on.
    //
    // Night is handled on the uniform rather than here. The air's radiance
    // falls with the sun, but the air itself does not go away, so dimming the
    // four colours in _syncAerial keeps a midnight valley reading as depth.
    // Mixing the fog *fraction* toward zero instead would have deleted the
    // depth cue at exactly the hour the light stops carrying it.
    gl_FragColor = aerial(lit, dist, normalize(uCam - vW), uSunDir, vW.y);
    ` : /* glsl */`
    lit = mix(lit, uHorizon * max(dusk, 0.08), 1.0 - exp(-dist * 0.0007));
    gl_FragColor = vec4(lit, 1.0);
    `}
  }
`;

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
    gl_Position = p.xyww;   // pin to the far plane
  }
`;

const SKY_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform float uSunAng;    // angular radius of the star's disk (rad)
  uniform float uAtmo;      // 0 airless … 1 thick
  uniform float uSeed;
  varying vec3 vDir;

  float hash13(vec3 p){
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 d = normalize(vDir);
    float elev = uSunDir.y;
    float day = smoothstep(-0.18, 0.25, elev);
    float horiz = pow(1.0 - max(d.y, 0.0), 2.6);

    // scattered sky, fading with atmosphere thickness and daylight
    vec3 sky = mix(uZenith, uHorizon, horiz) * day * uAtmo;
    // sunset warms the horizon along the sun's azimuth
    float toward = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(uSunDir.x, 0.0, uSunDir.z))), 0.0);
    float sunset = smoothstep(0.35, -0.05, abs(elev)) * pow(toward, 3.0) * pow(1.0 - abs(d.y), 2.0);
    sky += vec3(1.0, 0.36, 0.12) * sunset * 0.5 * uAtmo;

    // the star itself: a true disk with glare
    float cosang = dot(d, uSunDir);
    float ang = acos(clamp(cosang, -1.0, 1.0));
    float disk = smoothstep(uSunAng * 1.12, uSunAng * 0.9, ang);
    float glare = exp(-max(ang - uSunAng, 0.0) * (26.0 / (0.25 + uAtmo))) * 0.55;
    vec3 sun = uSunColor * (disk * 5.0 + max(glare, 0.0) * day) * step(-0.03, elev + 0.05);

    // stars pierce through when the sky is dark
    float dark = 1.0 - day * uAtmo;
    vec3 dd = d * 300.0;
    vec3 cell = floor(dd);
    float h = hash13(cell);
    vec3 stars = vec3(0.0);
    if (h > 0.994 && d.y > -0.05) {
      float sd2 = length(dd - cell - 0.5);
      stars = vec3(0.9, 0.88, 1.0) * exp(-sd2 * sd2 * 3.5) * (h - 0.994) / 0.006 * dark;
    }

    // The one surface that has to declare its distance rather than inherit it.
    // Alpha is clarity (src/aerial.js): the sky is at infinity, so it is the
    // least clear thing in the frame and §9.4 step 5 gives it the full wash.
    // That is a decision, not an accident — a painted four-stop gradient is
    // exactly what wet-in-wet softening should be strongest on, and the sun
    // disc is already 3× oversize and deliberately soft-edged (§9.6).
    gl_FragColor = vec4(sky + sun + stars, ${AERIAL ? '0.0' : '1.0'});
  }
`;

const OCEAN_VERT = /* glsl */`
  uniform float uTime;
  uniform vec2 uWind;
  uniform float uHsHalf;      // half the significant wave height, for the crest term
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vQ;            // the undisplaced point — Gerstner's parameter domain
  ${SEA ? OCEAN_GLSL : ''}

  // two long swells travel with the wind; the mesh actually heaves
  float swell(vec2 p, float t) {
    return sin(dot(p, uWind) * 0.015 - t * 0.7) * 0.55
         + sin(dot(p, vec2(-uWind.y, uWind.x)) * 0.021 + t * 0.53) * 0.34;
  }

  void main() {
    vec3 w = (modelMatrix * vec4(position, 1.0)).xyz;
${SEA ? /* glsl */`
    // §M2 act 5. The horizontal displacement is what sharpens a crest, and the
    // Jacobian that comes with it is the only place foam is allowed to be.
    vec3 nrm; float jac;
    vQ = w.xz;
    vec3 d = gerstner(vQ, uTime, nrm, jac);
    w += d;
    vN = nrm;
` : /* glsl */`
    float h = swell(w.xz, uTime);
    w.y += h;
    float e = 2.0;
    float hx = swell(w.xz + vec2(e, 0.0), uTime) - h;
    float hz = swell(w.xz + vec2(0.0, e), uTime) - h;
    vN = normalize(vec3(-hx / e, 1.0, -hz / e));
    vQ = w.xz;
`}
    vW = w;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }
`;

const OCEAN_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uHorizon;
  uniform vec3 uDeep;
  uniform vec3 uCam;
  uniform float uTime;
  uniform float uSeed;
  uniform vec2 uWind;
  uniform float uWindSpeed;
  uniform float uSeaFloor;    // ground height under this point, for depth
  uniform float uHsHalf;
  varying vec3 vW;
  varying vec3 vN;
  varying vec2 vQ;
  ${NOISE_GLSL}
  ${AERIAL ? AERIAL_GLSL : ''}
  ${SEA ? OCEAN_GLSL : ''}

  void main() {
    // three bands of chop riding the swell, all drifting downwind
    vec2 drift = uWind * uTime;
    vec2 p = vW.xz * 0.06;
    vec3 n = normalize(vN + vec3(
      snoise(vec3(p - drift * 0.012, uTime * 0.14 + uSeed)) * 0.1 +
      snoise(vec3(p * 3.7 - drift * 0.03, uTime * 0.3)) * 0.05 +
      snoise(vec3(p * 11.0, uTime * 0.55)) * 0.022,
      0.0,
      snoise(vec3(p + 40.0 - drift * 0.017, uTime * 0.17)) * 0.1 +
      snoise(vec3(p * 5.1 + 9.0, uTime * 0.4)) * 0.04));
    vec3 view = normalize(uCam - vW);
    float day = smoothstep(-0.15, 0.25, uSunDir.y);
${SEA ? /* glsl */`
    // §M2 act 5 · Schlick rather than a tuned power. R0 = 0.02 is water's own
    // number, and it is why a lake is a window at your feet and a mirror at
    // the far shore.
    float fres = waterFresnel(max(dot(view, n), 0.0));
    // Beer–Lambert through however much water is under this point, banded.
    // Red is gone by two metres and blue survives to fifty; that asymmetry is
    // the whole reason the sea is blue, and picking a blue colour instead
    // keeps the result and throws away the reason.
    vec3 sky = uHorizon * day;
    vec3 col = mix(waterBody(max(vW.y - uSeaFloor, 0.0), sky), sky, fres);

    // Foam where the surface actually overturned, plus the crest shear that
    // makes every whitecap anyone has seen — see ocean.js for why the fold
    // alone leaves a gale glassy.
    //
    // And then broken into patches, which is the part the criterion cannot
    // supply. Whitecaps are not a ribbon along every crest: a wave breaks
    // where the short waves riding it happen to pile up, so a third of a crest
    // goes white and the rest does not. Applied unpatched it drew a continuous
    // line down every wave in the frame, which is what the first capture of
    // this act showed — the criterion was right and the distribution was not.
    // Evaluated per *pixel*, from Gerstner's own parameter domain, rather than
    // interpolated off the vertices. The foam band on an 81 m wave is about
    // 20 m wide and the quads are 37 m: a varying cannot resolve it, and what
    // came out instead was a thin diagonal sliver stretched across every
    // triangle. Twelve waves in the fragment is the price of the crest being
    // where the crest is.
    vec3 fn; float fjac;
    vec3 fd = gerstner(vQ, uTime, fn, fjac);
    // 'patch' is a reserved word in GLSL — it compiles fine in the CPU twin and
    // fails only in the driver, which is precisely the class of defect §M0's
    // compile gate exists to catch and the reason it checks the assembled string.
    float foamPatch = snoise(vec3(vW.xz * 0.021 - drift * 0.02, uTime * 0.11)) * 0.5 + 0.5;
    foamPatch *= snoise(vec3(vW.xz * 0.078 + 17.0 - drift * 0.05, uTime * 0.23)) * 0.5 + 0.5;
    float foam = whitecap(uWindSpeed, fjac, fd.y / max(uHsHalf, 1e-4))
      * smoothstep(0.10, 0.42, foamPatch);
    // the leading edge of a breaking crest is bright and its wake is thin
    col = mix(col, vec3(0.90, 0.94, 0.96) * (0.30 + 0.70 * day), foam * 0.72);

    col += uSunColor * glitter(n, view, uSunDir, 0.35) * day * (1.0 - foam);
` : /* glsl */`
    float fres = pow(1.0 - max(dot(view, n), 0.0), 3.0);
    vec3 col = mix(uDeep * (0.25 + 0.75 * day), uHorizon * day, fres * 0.85);

    // the glitter path: a lane of broken suns stretched toward the star
    vec3 r = reflect(-uSunDir, n);
    float spec = pow(max(dot(r, view), 0.0), 240.0);
    float lane = pow(max(dot(reflect(-uSunDir, normalize(vec3(n.x * 2.2, n.y, n.z * 2.2))), view), 0.0), 36.0);
    col += uSunColor * (spec * 2.2 + lane * 0.35 * smoothstep(0.35, -0.02, abs(uSunDir.y))) * day;

    // crests fleck white where the chop stands up
    float crest = smoothstep(0.985, 0.955, n.y) * smoothstep(0.4, 0.9,
      snoise(vec3(vW.xz * 0.4 - drift * 0.05, uTime * 0.6)) * 0.5 + 0.5);
    col += vec3(0.9, 0.95, 1.0) * crest * 0.18 * (0.25 + 0.75 * day);
`}

    float dist = length(vW - uCam);
    ${AERIAL ? /* glsl */`
    // The ocean plane runs to EXT*24, so without a real extinction curve its
    // far edge was the one place the old one-line fog visibly failed to close.
    gl_FragColor = aerial(col, dist, normalize(uCam - vW), uSunDir, vW.y);
    ` : /* glsl */`
    col = mix(col, uHorizon * max(day, 0.08), 1.0 - exp(-dist * 0.0007));
    gl_FragColor = vec4(col, 1.0);
    `}
  }
`;

// ------------------------------------------------------------- scale -------

export class SurfaceScale {
  constructor(app, ctx) {
    this.app = app;
    this.kind = 'surface';
    this.ctx = ctx;
    const pp = this.pp = ctx.planet;
    this.sys = ctx.system;

    this.scene = new THREE.Scene();
    // §6 M4's numbers, which the reference also uses to the digit: FOV 52, near
    // 0.12 m. The old 62/0.1 predate both documents.
    this.camera = new THREE.PerspectiveCamera(M4 ? GAIT.fov : 62,
      1, M4 ? 0.12 : 0.1, 30000);

    this.playing = true;
    this.speed = 1;
    // start mid-morning golden light
    this.sunPhase = 0.32;
    this.dayRate = (2 * Math.PI) / 420; // one local day ≈ 7 real minutes

    this.yaw = 0; this.pitch = -0.04;
    this.fly = false;
    /** `?climb=1`'s trigger — see src/ascent.js */
    this._ascent = ascentState();
    /** `?noclip=1` — where this world gives way, or null if it does not */
    this._fold = null;
    this._releaseAlt = releaseAltitude(EXT, GAIT.fov);
    this.vel = new THREE.Vector3();
    this.keys = new Set();

    this.uSunDir = { value: new THREE.Vector3(0, 1, 0) };
    this.uSunColor = { value: ctx.sunColor.clone() };
    this.uTime = { value: 0 };
    this.uCam = { value: this.camera.position };
    this.uWet = { value: 0 };   // the weather wets the ground

    const atmoStrength = pp.typeId === 0 ? 0.25 : pp.typeId === 4 ? 0.4 : 1.0;
    this.atmo = atmoStrength;
    // one wind owns this whole world: the sea, the grass, the petals
    const windAng = new RNG(hash(pp.seed, 0x817d)).float(0, 6.28);
    this.wind = new THREE.Vector2(Math.cos(windAng), Math.sin(windAng));
    this.horizonColor = pp.atmoColor.clone().multiplyScalar(0.5).add(new THREE.Color(0.04, 0.04, 0.05));
    this.zenithColor = pp.atmoColor.clone().multiplyScalar(0.26);
    // the magic hour needs somewhere to return from
    this._horizonBase = this.horizonColor.clone();
    this._zenithBase = this.zenithColor.clone();
    this._gold = new THREE.Color(1.0, 0.52, 0.22);
    this._duskZenith = new THREE.Color(0.16, 0.1, 0.22);

    this._buildTerrain();
    this._buildSky();
    if (this.seaLevel !== null) this._buildOcean();
    this._buildRocks();
    if (pp.inhabited) this._buildCityGlow();
    if (ctx.parentGiant) this._buildParentGiant(ctx.parentGiant);
    this._buildSiblings();
    this.settlement = BUILT ? addCivilization(this) : null;
    this.life = addLife(this);   // after the town, so the woods keep off its doorstep
    this.ships = addShips(this);
    this.flare = addFlare(this);
    this._initImpacts();

    // spawn on land, eyes toward the sunrise
    const spawn = this.spawn;
    this.camera.position.set(spawn.x, spawn.y + EYE, spawn.z);
    // the body walks; the camera is only sometimes in its head
    this.body = this.camera.position.clone();
    this.traveler = addTraveler(this);
    // The conjured craft. Built on the first summon rather than at spawn: a
    // world nobody tries to leave should not pay for a rocket, and `craftFor()`
    // is a rocket-equation solve rather than a lookup.
    this.conjure = null;
    this.conjureGrp = null;
    /** a climb-out in progress, or null — see `src/climb.js` */
    this.launch = null;
    // Two grass systems, and only one of them should ever be on screen.
    //
    // `grass.js` is the pre-M3 field: a few thousand wide instanced quads on a
    // wrap-around grid. `flora.js` is §9.5's meadow — one continuous density
    // law, four tessellation rings, millions of blades. M3 replaced the first
    // with the second and nothing ever stopped building the first, so both drew
    // together: proper blades in the middle distance with the old field's big
    // pale slabs standing through them in the near field. On glass that reads as
    // "the grass hasn't loaded yet", because half of it is the thing that used
    // to be there.
    //
    // §9.5 is one field, not two. The old one survives only for `?m3=0`.
    this.grassField = M3 ? null : addGrass(this);
    this.ruins = BUILT ? addRuins(this) : null;
    this.wildlife = addWildlife(this);
    this.constellations = addConstellations(this);
    this.caravan = addCaravan(this);
    this.megafauna = addMegafauna(this);
    this.rivers = addRivers(this);
    this.interior = BUILT ? addInterior(this) : null;
    this.inside = false;
    this._doorCool = 0;
    this.godrays = addGodRays(this);
    this.weather = addWeather(this);
    this.festival = addFestival(this);
    this.herds = addHerds(this);
    // a living score for the ground: it swells with the golden hour and
    // hushes at the ruins — tuned to this world's own resonance root
    this._scoreRoot = 130.8 * Math.pow(2, ((hash(pp.seed, 0x5c0e) % 5)) / 12);
    this.app.audio?.surfaceScore?.(this._scoreRoot);
    if (M4) {
      // §M4. The rig *is* the controls object — it implements the same
      // duck-typed `{ enabled, target, update() }` the hyperzoom has always
      // driven, so `transition.js` and every enter/exit/resume call site work
      // unchanged and there is no second code path to keep in step.
      this.walker = new Walker({
        heightAt: (x, z) => this.heightAt(x, z),
        gravity: gravityOf(pp),
        seaLevel: this.seaLevel,
      });
      this.walker.place(spawn.x, spawn.z, spawn.y);
      this.rig = new CameraRig({
        camera: this.camera,
        walker: this.walker,
        heightAt: (x, z) => this.heightAt(x, z),
      });
      this.rig.target = new THREE.Vector3(spawn.x + 60, spawn.y + 4, spawn.z - 40);
      this.controls = this.rig;
      this.camera.lookAt(this.rig.target);
      this.rig.syncFromCamera();
    } else {
      this.controls = { // duck-typed for the hyperzoom
        enabled: false,
        target: new THREE.Vector3(spawn.x + 60, spawn.y + 4, spawn.z - 40),
        update: () => {},
      };
      this.camera.lookAt(this.controls.target);
    }
    this._syncAngles();

    // §9.7 · face the solved heading, and put the sun where the solve assumed.
    //
    // Azimuth only. Pitch stays as it is: `lowHorizon` scores the skyline's
    // elevation *angle*, which is a property of the ground and not of where the
    // camera is pointed, so the solver has nothing to say about tilt and this
    // should not pretend otherwise. The existing 1.9° rise is art direction and
    // survives untouched.
    if (this.landingSolution) {
      const s = this.landingSolution;
      // the solver's +z is forward along its heading, +x to its right — the
      // same convention `scoreComposition` samples the ground in
      const fwd = new THREE.Vector3(Math.sin(s.heading), 0, Math.cos(s.heading));
      this.controls.target.copy(this.camera.position).addScaledVector(fwd, 72);
      this.controls.target.y = spawn.y + 4;
      this.camera.lookAt(this.controls.target);
      this._syncAngles();
      this.sunPhase = this._sunPhaseFacing(s.sunElev, fwd);
    } else {
      // §9.7's sun band, without §9.7's solver.
      //
      // The full composition solve is still `?solve=1`, and still default-off,
      // for the reason it always was: 127–337 ms of main thread inside
      // `_buildTerrain`. But *only one clause* of §9.7 was ever load-bearing
      // for anything else, and it is the cheapest one:
      //
      //     "Sun elevation at spawn forced into 8–18°. Golden hour is not a
      //      mood; it is the geometry the light model is tuned for."
      //
      // §9.2's three-stop ramp bands at t = 0.17 and 0.58 on the half-Lambert
      // wrap. At a +24° sun over open ground every pixel lands above the upper
      // edge, one band is occupied, and the ramp returns one flat colour — the
      // exact measurement that kept `?paint=` off. Inside the band the wrap
      // spreads across all three stops and the ramp does what it is for.
      //
      // Choosing the phase costs a 2000-step scan of a trig function the scale
      // already evaluates every frame. It is not the solve, it does not pick
      // where you stand or which way you face, and it has no measurable cost.
      // So the geometry §9.2 depends on stops being contingent on a flag that
      // is off, and the expensive half stays exactly where it was.
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-9) fwd.set(0, 0, -1); else fwd.normalize();
      this.sunPhase = this._sunPhaseFacing(
        SUN_BAND[0] + (SUN_BAND[1] - SUN_BAND[0]) * 0.5, fwd);
    }

    // ?sun= overrides whatever chose the hour — the solver's golden-hour
    // constraint, or the default phase when the solver fell back — and stops
    // the clock. **Outside** the solver's branch on purpose: the first version
    // sat inside it and silently did nothing on every world the solver could
    // not compose, which is most ocean worlds. The HUD said SUN +20° in a frame
    // captured with ?sun=-14 and the flag looked like it had no effect at all.
    //
    // A capture of "the same frame" is only the same frame if the sun has not
    // moved between the two runs (§7.5).
    if (SUN_AT !== null && Number.isFinite(SUN_AT)) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1); else fwd.normalize();
      this.sunPhase = this._sunPhaseFacing(SUN_AT, fwd);
      this.playing = false;
    }

    // a touch more bloom so the sun, water-glitter, the colossus's jewel and
    // the corona crown the frame — enough to glow, not to swallow detail
    this.bloomSettings = { strength: 0.58, radius: 0.72, threshold: 0.34 };
    // the world's resonance grades the frame here too — same mood, same light
    this.gradeSettings = pp.res?.grade;
    this._bindInput();
  }

  // --------------------------------------------------------- building ----
  /**
   * The ground is the planet: a macro band sampled from the *same* height
   * function the orbital shader draws (exact JS port), which decides where
   * land, sea and mountains lie — plus medium and fine relief bands for
   * human-scale terrain. Three LOD rings carry it ~14 km to a horizon that
   * genuinely curves with the world's true radius.
   */
  /**
   * §9.2's four light colours, for this world's actual star.
   *
   * `starlight.js` derives them from the spectrum through §9.6's transfer, so a
   * world around an M dwarf gets a warmer sun *and* a warmer shadow, and one
   * around an A-type gets a colder both. The elevation is the sun's own at
   * spawn, because the beam reddens with the air it crosses — the same reason
   * the horizon is warm.
   */
  _paintUniforms() {
    this.sunShadow = new SunShadow({ res: qInt('shres', 'shadowRes') });
    const T = this.ctx.system?.temp ?? 5778;
    const elev = (Math.asin(Math.min(Math.max(this.uSunDir.value.y, -1), 1)) * 180) / Math.PI;
    const L = lightFor(T, Math.max(elev, 0.5));
    const v = (c) => ({ value: new THREE.Vector3(c[0], c[1], c[2]) });
    this._paintLight = { T, uniforms: {
      sun: v(L.sun), sky: v(L.ambSky), gnd: v(L.ambGnd), sh: v(L.shadowTint),
      exp: { value: 1 },
    } };
    return {
      uPaintSun: this._paintLight.uniforms.sun,
      uPaintAmbSky: this._paintLight.uniforms.sky,
      uPaintAmbGnd: this._paintLight.uniforms.gnd,
      uPaintShadowTint: this._paintLight.uniforms.sh,
      uPaintExposure: this._paintLight.uniforms.exp,
      ...this.sunShadow.uniforms,
    };
  }

  /**
   * §9.3's uniform block. One object, shared by every surface-scale material,
   * so the terrain and the ocean can never disagree about how far away the
   * horizon is — which is what "one shared chunk" in `M2.md` §16.2 buys.
   *
   * The three lengths come from `aerialParams()` and are physics (§16.3): a
   * property of this world's air, not of AEON's 1400 m tile.
   */
  _aerialUniforms() {
    if (this._airU) return this._airU;
    const T = this.ctx.system?.temp ?? 5778;
    // §9.3, with the two numbers it was missing. `visibilityFor` makes `fogFar`
    // a *weather* rather than a constant — 1700 m is WMO "mist" (1–2 km), which
    // AEON inherited from a reference that was one 2400 m valley wanting its far
    // wall dissolved, without the composition that justified it. `mistBase`
    // moves the valley-mist band off the planet datum and onto the valley floor;
    // measured against the datum, any land below 46 m read as "mist everywhere
    // past 420 m" — +0.16 fog and a 45% pull toward #D6DDD4, on the near field.
    const p = aerialParams(this.pp, this.atmo, 1, {
      visibility: visibilityFor(this.pp, this.atmo),
      mistBase: this.seaLevel !== null && this.seaLevel !== undefined
        ? this.seaLevel : (this.body ? this.heightAt(0, 0) : 0),
    });
    const v = (c) => ({ value: new THREE.Vector3(c[0], c[1], c[2]) });
    const air = airFor(T, 13.5);
    this._air = {
      T,
      u: {
        haze: v(air.haze), mist: v(air.mist),
        horizonSun: v(air.horizonSun), anti: v(air.anti),
      },
    };
    this._airU = {
      uAirHaze: this._air.u.haze,
      uAirMist: this._air.u.mist,
      uAirHorizonSun: this._air.u.horizonSun,
      uAirAnti: this._air.u.anti,
      uAirNear: { value: p.near },
      uAirFar: { value: p.far },
      uAirHazeH: { value: p.hazeH },
      uAirMistAmt: { value: p.mistAmt },
      uAirMistBase: { value: p.mistBase },
    };
    return this._airU;
  }

  /**
   * Aerial perspective, into every material three.js owns.
   *
   * `_aerialUniforms()` reaches the terrain, the sky and the ocean because this
   * file writes their shaders. It reaches nothing else, and "nothing else" is a
   * village, a herd, a wreck, a caravan, a ruin and every tree on the world —
   * forty-six built-in materials that render at full contrast at any distance
   * while the ground beneath them goes to haze.
   *
   * ---------------------------------------------------------------------------
   * The rule for what is sky, and why it is a measurement rather than a list
   *
   * A traversal has to answer one question — is this object *in* the air or
   * *beyond* it — and the honest answer is geometric. The fog saturates by
   * about two kilometres; a moon, a ring, a comet and the star field sit at
   * 1e4 to 1e7 metres, and the sky dome is a sphere kilometres across. So the
   * test is the object's own world bounding sphere: too big to be a thing, or
   * too far to be in this air, and it is sky.
   *
   * Written as a list of names instead, it would have been correct on the day
   * and wrong the first time somebody added a second moon. `userData.noAerial`
   * is the escape hatch for anything the geometry gets wrong.
   *
   * Idempotent by `userData.aerial`, so it can run again when a system builds
   * itself late — the festival lanterns arrive at dusk, an hour of game time
   * after this first runs.
   */
  _dressAerial() {
    if (!AIRMAT || !AERIAL || !this.scene) return 0;
    const u = { ...this._aerialUniforms(), uSunDir: this.uSunDir, uCam: this.uCam };
    const sphere = new THREE.Sphere();
    let dressed = 0;
    this.scene.traverse((o) => {
      if (!o.material || o.userData?.noAerial) return;
      if (!(o.isMesh || o.isPoints)) return;          // sprites have no project_vertex
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.every((m) => m.isShaderMaterial || m.userData?.aerial)) return;
      if (!o.geometry?.boundingSphere) o.geometry?.computeBoundingSphere?.();
      const bs = o.geometry?.boundingSphere;
      if (bs) {
        sphere.copy(bs).applyMatrix4(o.matrixWorld);
        if (sphere.radius > 3000 || sphere.center.length() > 8000) {
          for (const m of mats) (m.userData ||= {}).aerial = 'sky';
          return;
        }
      }
      // Additive and transparent surfaces keep their coverage: alpha there is
      // already carrying how much of the pixel the glow covers, and clarity
      // written over it makes a lantern opaque.
      const veil = mats.some((m) => m.transparent || m.blending === THREE.AdditiveBlending);
      for (const m of mats) { applyAerial(m, u, { bucket: veil ? 'veil' : 'solid' }); dressed++; }
    });
    return dressed;
  }

  /**
   * The air, as the sun moves. Two things change and they are not the same
   * thing: the *hue* follows the beam's path length through the air, so the
   * haze reddens as the sun drops; the *radiance* follows how much light is in
   * the air at all, which is what makes midnight fog dark instead of absent.
   *
   * Doing the second in the fragment shader — mixing the fog fraction toward
   * zero at dusk — would have removed the depth cue at exactly the hour §9.7
   * tunes the whole light model for.
   */
  _syncAerial() {
    if (!AERIAL || !this._air) return;
    const y = Math.min(Math.max(this.uSunDir.value.y, -1), 1);
    const elev = (Math.asin(y) * 180) / Math.PI;
    const air = airFor(this._air.T, Math.max(elev, 0.5));
    // Civil twilight is about −6°: below it the air is lit by scattered light
    // it no longer receives directly, and 0.06 is where the reference's own
    // night floor sits rather than zero — air is never a black wall.
    const lum = 0.06 + 0.94 * Math.min(Math.max((y + 0.10) / 0.28, 0), 1);
    const u = this._air.u;
    const set = (t, c) => t.value.set(c[0] * lum, c[1] * lum, c[2] * lum);
    set(u.haze, air.haze);
    set(u.mist, air.mist);
    set(u.horizonSun, air.horizonSun);
    set(u.anti, air.anti);
    // The far ridges' sunward arc is the same reading of the same air, so it
    // follows the same clock. Left fixed at the 13.5° it was built at, the
    // horizon would still be catching golden hour at midnight — and it is the
    // widest object in the frame, so it is the last place to leave a stale
    // colour that only a dusk capture could reveal.
    if (this._uRidgeWarm) {
      this._uRidgeWarm.value.set(air.horizonSun[0] * lum, air.horizonSun[1] * lum,
        air.horizonSun[2] * lum);
    }
  }

  /**
   * §M2 act 4's uniform block: four layers × three stops, plus the four scalars
   * the blend law reads.
   *
   * The stops come from `materialPalette()`, which derives them from the
   * world's own three palette colours and the star's own light — so a world
   * around an M dwarf gets rock lit by an M dwarf, and nothing here is a
   * literal (§9.1).
   */
  _materialUniforms() {
    if (this._matU) return this._matU;
    const T = this.ctx.system?.temp ?? 5778;
    const elev = (Math.asin(Math.min(Math.max(this.uSunDir.value.y, -1), 1)) * 180) / Math.PI;
    const pal = materialPalette(this.pp, lightFor(T, Math.max(elev, 0.5)));
    const bias = worldBias(this.pp);
    const v3 = (c) => new THREE.Vector3(c[0], c[1], c[2]);

    // |sin(latitude)| at the landing site. The frame's `dir` is the landing
    // point on the unit sphere, so its y *is* the sine of the latitude — the
    // snow line follows the world's geometry rather than a per-world roll.
    const lat = Math.abs(this.landingDir?.y ?? 0);

    this._matPal = pal;
    this._matU = {
      uMatShade: { value: pal.map((m) => v3(m.shade)) },
      uMatMid: { value: pal.map((m) => v3(m.mid)) },
      uMatLit: { value: pal.map((m) => v3(m.lit)) },
      uMatGrain: { value: pal.map((m) => m.grain) },
      uMatLat: { value: lat },
      uMatCold: { value: bias.cold },
      uMatRain: { value: bias.rain },
      // The relief the altitude term is a fraction of. `amp` is the landform's
      // own scale, so a flat world's snow line is not pinned to a mountain
      // world's metres.
      uMatRelief: { value: Math.max(this.amp, 1) },
    };
    return this._matU;
  }

  /**
   * §M2 act 5's wave set, from the wind this world already has.
   *
   * Nothing is tuned here. The wind speed picks the significant wave height
   * through Pierson–Moskowitz and the peak wavelength through the dispersion
   * relation, so a world with a strong wind has a big sea because it has a
   * strong wind — not because a number was raised to match.
   */
  _seaUniforms() {
    if (this._seaU) return this._seaU;
    // The world's own wind direction, and a speed from its weather. §M3 will
    // replace this scalar with the shared field; the waves already read a
    // direction and a speed, so that is a substitution rather than a rewrite.
    const dir = Math.atan2(this.wind.y, this.wind.x);
    const speed = 4 + (hash(this.pp.seed, 0x53ea) % 1000) / 1000 * 12;
    // Nyquist against the mesh: nothing shorter than two quads.
    const waves = buildWaves(speed, dir, this.pp.seed >>> 0, 0.86,
      (this._seaQuad ?? 37) * 2.2);
    const packed = waveUniforms(waves);
    this._seaU = {
      uWave: { value: packed.data },
      uWavePhase: { value: packed.phase },
      uExtinction: { value: new THREE.Vector3(...EXTINCTION_V) },
      uDeepCol: { value: new THREE.Color(0.015, 0.055, 0.11) },
      uShallowCol: { value: new THREE.Color(0.10, 0.30, 0.32) },
      uWindSpeed: { value: speed },
      uHsHalf: { value: significantHeight(speed) * 0.5 },
      // one sample of the ground under the sea plane; the depth term wants the
      // floor, and a flat sea over varying ground is what makes a shoreline
      uSeaFloor: { value: (this.seaLevel ?? 0) - 14 },
    };
    return this._seaU;
  }

  /** the materials are lit by the star too, so their stops move with the sun */
  _syncMaterial() {
    if (!MAT || !this._matU) return;
    const T = this.ctx.system?.temp ?? 5778;
    const elev = (Math.asin(Math.min(Math.max(this.uSunDir.value.y, -1), 1)) * 180) / Math.PI;
    const pal = materialPalette(this.pp, lightFor(T, Math.max(elev, 0.5)));
    for (let i = 0; i < 4; i++) {
      this._matU.uMatShade.value[i].set(...pal[i].shade);
      this._matU.uMatLit.value[i].set(...pal[i].lit);
    }
  }

  /** the sun climbs, so the beam it sends reddens less — re-derive as it moves */
  /**
   * The brightest moon that is up, as the night model wants it.
   *
   * The illuminated fraction is `(1 - dot(moon, sun)) / 2` — a moon opposite
   * the sun is full, a moon beside it is new — and the *brightest* rather than
   * the highest, because `moonLux` already weighs phase against elevation and
   * a fat moon low down beats a sliver overhead.
   */
  _brightestMoon() {
    if (!this.skyMoons || !this.skyMoons.length) return null;
    const sun = this.uSunDir.value;
    let best = null;
    for (const m of this.skyMoons) {
      const d = m.mesh.position;
      const len = d.length() || 1;
      const y = d.y / len;
      const illum = (1 - (d.x * sun.x + d.y * sun.y + d.z * sun.z) / len) * 0.5;
      const elev = (Math.asin(Math.min(Math.max(y, -1), 1)) * 180) / Math.PI;
      const lx = nightLight(this._paintLight.T,
        { moonIlluminated: illum, moonElevDeg: elev }).moonLux;
      if (!best || lx > best.lux) best = { illum, elev, lux: lx };
    }
    return best;
  }

  _syncPaintLight() {
    if (!PAINT || !this._paintLight) return;
    const elev = (Math.asin(Math.min(Math.max(this.uSunDir.value.y, -1), 1)) * 180) / Math.PI;
    const L = lightFor(this._paintLight.T, Math.max(elev, 0.5));
    const u = this._paintLight.uniforms;
    u.sun.value.set(...L.sun);
    u.sky.value.set(...L.ambSky);
    u.gnd.value.set(...L.ambGnd);
    u.sh.value.set(...L.shadowTint);

    // Night, which this line used to have no answer for. `lightFor` is only
    // defined for a sun above the horizon, so the clamp to 0.5° above meant
    // §9.2 painted a sunrise at three in the morning — the frame went dark
    // because the key light faded, while the ambient it was lit by stayed
    // dawn-coloured. src/night.js has the header on what actually lights a
    // moonless night, and airglow being the answer is the surprise.
    const nf = nightFraction(elev);
    if (nf > 0.001) {
      const moon = this._brightestMoon();
      const N = nightLight(this._paintLight.T, moon
        ? { moonIlluminated: moon.illum, moonElevDeg: moon.elev }
        : {});
      const mix = (v, a, b) => v.set(
        a[0] + (b[0] - a[0]) * nf, a[1] + (b[1] - a[1]) * nf, a[2] + (b[2] - a[2]) * nf);
      mix(u.sun.value, L.sun, N.sun);
      mix(u.sky.value, L.ambSky, N.ambSky);
      mix(u.gnd.value, L.ambGnd, N.ambGnd);
      mix(u.sh.value, L.shadowTint, N.shadowTint);
      this._nightLux = N.lux;
    } else {
      this._nightLux = 0;
    }
    // How much light there is, which §9.2 never asked. One number across the
    // whole day so there is no seam between a day branch and a night one.
    u.exp.value = exposureFor(skyLux(elev, this._nightLux || undefined));

    // The aurora is a light, not only a picture of one.
    //
    // It enters as a **hemispheric sky term** and not as a directional light,
    // and that is the physically correct model rather than the cheap one: a
    // curtain subtends tens of degrees of sky, so what reaches the ground is a
    // broad wash from one half of the hemisphere. A directional light would
    // give it a hard shadow, and an aurora does not cast one until IBC IV.
    //
    // It also tints the shadow, at a third of the strength. §9.2: *"shadows
    // change hue, they do not go black."* On a night lit by an aurora the
    // shadows are the greenest thing in the frame, because there is nothing
    // else in them.
    if (this.aurora) {
      const a = this.aurora.illumination();
      if (a.moons > 1e-3) {
        // Calibrated against the scene's own night, not against nothing. The
        // ambient floor here is an AmbientLight at 0.35 — already far above
        // physical starlight, because §M8's exposure adaptation does not exist
        // yet — so the aurora is placed *relative to that floor*: one full moon
        // of aurora roughly doubles the available light, which is about what a
        // full moon does to a starlit night.
        //
        // The first pass used 0.55 here and 0.9 on the hemisphere below, and
        // 0.85 moons rendered a tower as a flat saturated green slab. An aurora
        // at IBC IV lets you read a newspaper with difficulty; it does not
        // floodlight a building.
        // This coefficient is much larger than the hemisphere light's below,
        // and the reason is §9.2 rather than taste. Its first hemi term is
        //
        //     hueOnly = hemi / dot(hemi, luma)
        //
        // — the magnitude is divided straight back out, because §9.2 wants the
        // ambient to *tint* and never to wash. So adding brightness to ambSky
        // does nothing at all; what moves the frame is the tint's share of the
        // resulting **hue**, and to get a share you have to be comparable to
        // what is already there. `ambSky` is #9EC6E6, luminance about 0.5, so
        // 0.45 at one moon rotates it roughly halfway to green.
        //
        // Measured, not assumed: at 0.18 the terrain moved by 0/255 while the
        // props moved by 14, and the frame had an aurora that lit the buildings
        // and not the ground it stood on.
        const k = Math.min(a.moons, 1.4) * 0.45;
        u.sky.value.set(
          L.ambSky[0] + a.rgb[0] * k, L.ambSky[1] + a.rgb[1] * k, L.ambSky[2] + a.rgb[2] * k);
        u.sh.value.set(
          L.shadowTint[0] + a.rgb[0] * k * 0.34,
          L.shadowTint[1] + a.rgb[1] * k * 0.34,
          L.shadowTint[2] + a.rgb[2] * k * 0.34);
      }
    }
  }

  _buildTerrain() {
    const pp = this.pp;

    // The landing frame and the walkable ground both come from `src/ground.js`
    // now — one definition, so the solver below can score the ground a person
    // will actually stand on rather than the planet-scale field (§2.7).
    //
    // §9.7 · the opening frame is solved, not stumbled into. The solver picks
    // where to stand, which way to face and where the sun is, together, because
    // a perfect viewpoint facing the wrong way is the failure being fixed.
    // `ctx.landingDir` still wins: an explicit deep-link is a destination, and
    // §2.4 says every place is a URL.
    this.landingSolution = null;
    if (SOLVE && !this.ctx.landingDir) {
      const t0 = performance.now();   // logged only — never read into generation (§2.3)
      const s = solveLandingSite(pp, hash(pp.seed, 0x1a4d), {
        wind: this.wind, eye: EYE, fov: this.camera.fov,
      });
      if (!s.fallback) this.landingSolution = s;
      console.info(`[§9.7] landing solved in ${(performance.now() - t0) | 0} ms · `
        + `score ${s.total.toFixed(3)}`
        + (s.terms ? ' · ' + Object.entries(s.terms)
          .map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' ') : ' · fallback'));
    }
    const ld = this.ctx.landingDir || this.landingSolution?.dir
      || findLandingSite(pp, hash(pp.seed, 0x1a4d));
    // Kept because it is the observer's place on the sphere, and latitude is
    // what decides whether the aurora is overhead, on the horizon, or absent.
    this._landingDir = ld;
    if (NOCLIP) this._findFold();
    const g = this.ground = makeGround(pp, ld, { wind: this.wind });
    const type = pp.typeId;
    const noise = g.noise;
    const fbm2 = g.fbm2;
    const ocean = g.ocean;
    const Rworld = g.Rworld;
    this.landform = g.landform;
    this.amp = g.amp;
    this.seaLevel = g.seaLevel;
    const dir = new THREE.Vector3(...g.frame.dir);
    const east = new THREE.Vector3(...g.frame.east);
    const north = new THREE.Vector3(...g.frame.north);
    this.landingDir = dir;
    this.impacts = g.impacts;
    this._heightFn = g.heightAt;

    // spawn scan BEFORE meshing, so a waterlocked lift bakes into the rings
    this.spawn = this._findSpawn();

    const snow = pp.iceCap < 1.5 || type === 3 ? (type === 3 ? 1 : 0.5) : 0;
    this.terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: this.uSunDir, uSunColor: this.uSunColor,
        ...(PAINT ? this._paintUniforms() : {}),
        ...(AERIAL ? this._aerialUniforms() : {}),
        ...(MAT ? this._materialUniforms() : {}),
        uColA: { value: pp.colA }, uColB: { value: pp.colB }, uColC: { value: pp.colC },
        uHorizon: { value: this.horizonColor },
        uCam: this.uCam,
        uSeed: { value: pp.noiseSeed },
        uAmp: { value: this.amp },
        uSnow: { value: snow },
        uLava: { value: type === 4 ? 1 : 0 },
        uTime: this.uTime,
        uSea: { value: this.seaLevel ?? -1e9 },
        uWet: this.uWet,
      },
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
    });

    // three nested rings: fine underfoot, vast to the horizon
    const rings = [
      { size: EXT, res: 168, hole: 0 },
      { size: EXT * 3.3, res: 104, hole: EXT * 0.48 },
      { size: EXT * 10, res: 72, hole: EXT * 1.58 },
    ];

    // §M2 act 6 · the outermost ring is retired only where the air says it is
    // invisible, and the air is asked rather than assumed.
    //
    // Ring 2 spans 2212 m to 9899 m at the corners, at 194 m per quad, running
    // the full terrain fragment shader — noise octaves, four triplanar layers
    // under ?mat=1, a shadow lookup under ?paint=1 — across the whole horizon
    // band. Under §9.3's `fogFar` it contributes almost nothing: on a temperate
    // world the fog fraction has already reached 0.987 at its inner edge.
    //
    // `saturationRadius()` is that judgement computed. A thin-atmosphere world
    // sees 17 km and keeps the ring; an airless one has no extinction at all
    // and keeps it too. Only where the arithmetic says the ring is invisible do
    // the curtains take its place, which is what makes this cheaper *and*
    // better rather than one at the expense of the other.
    this._ridgeStats = null;
    if (RIDGE) {
      const ap = aerialParams(pp, this.atmo, 1);
      const probeY = this.amp * 0.55;
      const sat = saturationRadius(ap, probeY, ap.hazeH);
      const ring2Corner = rings[2].size * 0.5 * Math.SQRT2;
      this._ridgeStats = { sat, ring2Corner, dropped: sat < ring2Corner, probeY };
      if (sat < ring2Corner) rings.length = 2;
    }

    this.terrain = new THREE.Group();
    for (let ri = 0; ri < rings.length; ri++) {
      const { size, res, hole } = rings[ri];
      const geo = this._gridWithHole(size, res, hole);
      const pos = geo.attributes.position;
      const drop = ri * 0.5; // hide ring seams under the finer ring
      for (let i = 0; i < pos.count; i++) {
        pos.setY(i, this._heightFn(pos.getX(i), pos.getZ(i)) - drop);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.terrainMat);
      mesh.userData.drop = drop;
      this.terrain.add(mesh);
    }
    this.scene.add(this.terrain);
    // §9.2's shadow needs its occluders named — casting is opt-in (src/shadow.js)
    // — and only the **finest ring** may cast.
    //
    // The other two are LOD, and LOD is a lie that only works at a distance.
    // Ring 2 is 14 km across at 72 segments: 194 m per quad. A quad that coarse
    // sits tens of metres above the dune it approximates, and from a 20° sun it
    // therefore shadows everything behind it. Measured, with all three casting:
    // every fragment of the near ground came back 0.017 deeper than the map
    // recorded — a uniform 25 m deficit across 33,420 samples, 100% shadowed.
    //
    // Ring 0 is 1400 m across against a 480 m shadow span, so the finest ring
    // covers the whole map on its own. This is the reference's `uCullR` in a
    // different shape: an occluder that is not resolved at the map's scale is
    // not an occluder.
    if (PAINT) markCaster(this.terrain.children[0]);

    if (RIDGE) this._buildHorizon(rings);
    // §M3's meadow, and the question nobody was asking it: **can anything grow
    // here?**
    //
    // The only gate on this was the flag. So every world in the universe grew a
    // three-and-a-half-million-blade sward — ice worlds at 28 K, lava worlds,
    // barren rock, airless moons. On an ice world it is unmistakable, because
    // `system.js` gives ice a pale blue-white `colC` and `grassPalette()` runs
    // that up to 2.55×: metres of washed blue grass standing in frozen sand.
    //
    // `grass.js` — the field M3 replaced — imports `isBiosphere` and has always
    // asked. The meadow never did, and while M3 was behind a default-off flag
    // nobody found out. Flipping it on is what exposed a check that had been
    // missing since it was written.
    //
    // Same shape as the gate in `scatter.js` and `precip.js`: life needs a
    // temperate world *and* air, and a world without either grows nothing,
    // which is an answer rather than a fallback.
    // an empty meadow rather than an absent one, so nothing downstream has to
    // know whether this world grows anything
    this.meadow = [];
    if (M3 && isBiosphere(this.pp) && this.atmo >= 0.05) this._buildMeadow();
  }

  /**
   * §M3 acts 1–3 · the field, the ground it reads, and one ring of blades.
   *
   * The wind is built from this world's own numbers, so an airless moon gets a
   * nominal breeze and nothing to push with (`wind.force`), and the grass
   * simply does not bend. That falls out of `windForceScale()` rather than a
   * branch here, which is the check that the parameterisation is right.
   */
  _buildMeadow() {
    const t0 = performance.now();     // logged only — never read into generation (§2.3)
    // `windSys`, not `wind`. `this.wind` is already a THREE.Vector2 — the
    // prevailing direction, set at construction and read by grass.js's petals,
    // weather.js's rain slant, the landform picker and a `uWind` vec2 uniform.
    // Assigning the wind *system* over it did not throw: it made `s.wind.x`
    // undefined, so three called uniform2fv on an object with no iterator and
    // NaN propagated silently into two unrelated systems. §11's own trap, in a
    // shape it does not list — a name collision rather than a bad number.
    // the field inherits the world's existing prevailing direction, so the
    // grass, the rain, the petals and the landform all agree — §6 M3's whole
    // thesis is one field, and two directions would be two fields
    this.windSys = makeWind(hash(this.pp.seed, 0x3117), this.pp, this.atmo,
      { dir: Math.atan2(this.wind.x, this.wind.y) });
    this.windField = new WindField(this.app.renderer, this.windSys, {
      heightAt: this._heightFn,
      extent: EXT,
      size: qInt('wind', 'wind'),
    });
    // one pass before the first frame: a target nobody has written to is not
    // slow, it is wrong, and every blade would read a zero velocity from it
    this.windField.update(0, this.spawn.x, this.spawn.z, { force: true });

    const grassMul = qArr('grass', 'grass');
    const segs = qArr('blades', 'blades');
    // §9.1 · one base colour, and grassPalette() derives the ramp from it. The
    // nine greens are the world's, not the reference's.
    const palette = { base: [this.pp.colC.r, this.pp.colC.g, this.pp.colC.b] };
    // All four rings. §9.5: they exist *only* to switch tessellation, so the
    // only thing that differs between them here is `seg` and the row's own
    // per-ring multiplier — the density is one continuous law across all of
    // them, which is what `meadow.js`'s suite holds to 0.27%.
    this.meadow = [];
    for (let r = 0; r < RINGS.length; r++) {
      this.meadow.push(new GrassRing(r, this.windField, {
        seed: hash(this.pp.seed, 0x9ea6 + r),
        seg: segs[r],
        density: grassMul[r],
        palette,
        // the *same* uniform objects the sky and terrain hold, so the grass
        // cannot be lit by yesterday's sun — §6 M3's one-field doctrine
        // applied to light rather than to wind
        sunDir: this.uSunDir,
        sunColor: this.uSunColor,
        skyColor: { value: this.horizonColor },
      }));
    }
    for (const ring of this.meadow) this.scene.add(ring.group);
    this._frustum = new THREE.Frustum();
    this._pm = new THREE.Matrix4();

    const chunks = this.meadow.reduce((a, m) => a + m.chunks.length, 0);
    console.info(`[§M3] meadow · wind ${this.windSys.base.toFixed(2)} m/s at 10 m · `
      + `force ${this.windSys.force.toFixed(3)} of Earth · ${this.meadow.length} rings · `
      + `${chunks} chunks · seg ${segs.join('/')} · density ${grassMul.join('/')} · `
      + `${this.windField.size}² field · ${(performance.now() - t0) | 0} ms`);
  }

  /**
   * §M2 act 6 · the far ridges.
   *
   * Anchored at the spawn rather than at the terrain's origin, because §9.7's
   * opening frame is composed from the spawn and the silhouette is the largest
   * thing in it. Walking away costs a bearing error, and at the haze fractions
   * these bands live at — 0.99 and above on a temperate world — a bearing error
   * is not a visible quantity.
   *
   * **Altitude is the sharper case and it is not covered.** `F` puts the walker
   * in flight, and from several hundred metres up the real skyline moves both
   * outward and down while this curtain stays where a 1.68 m eye put it. The
   * fix is an incremental re-march on a frame budget — `marchSkyline` is
   * per-azimuth and resumable, so N columns a frame retires the error without
   * the ~80 ms hitch a rebuild costs — and it belongs with M4's camera, which
   * is where the flying eye is actually specified. Until then `?ridge=1` is
   * honest on foot and approximate in flight (docs/plans/M2.md §27.7).
   */
  _buildHorizon(rings) {
    const t0 = performance.now();     // logged only — never read into generation (§2.3)
    const outer = rings[rings.length - 1];
    const ap = aerialParams(this.pp, this.atmo, 1);
    const sp = this.spawn;
    const yEye = sp.y + EYE;

    const h = buildHorizon(this._heightFn, {
      yEye,
      eyeH: EYE,
      required: this._ridgeStats.dropped,
      ox: sp.x, oz: sp.z,
      eyeR: Math.hypot(sp.x, sp.z),
      // the curtain must clear the *corner* of the outermost ring that is still
      // being drawn, not its edge — a circle inscribed in a square leaves four
      // wedges of terrain outside it, and each one would be occluded by the
      // thing that is supposed to stand behind it
      nearHalf: outer.size * 0.5,
      params: ap,
      Reff: this.ground.Rworld * 0.34,
      seaLevel: this.seaLevel,
    });
    this._horizon = h;
    if (!h.bands.length) {
      // Two ways to get here, and both are the right answer rather than a
      // failure to build one. Either the ring is still there and the world has
      // curved away inside its corner — a band past that would be a mountain
      // range over the horizon — or every planned band was pruned because the
      // near ground already stands taller than anything behind it. Neither
      // leaves a hole: a ray above what the near ground hides finds nothing to
      // draw, which is exactly the pruning test.
      console.info(`[§M2.6] horizon · nothing visible beyond ${h.r0 | 0} m `
        + `(limit ${Math.min(h.sat, h.geo) | 0} m) — no bands`);
      return;
    }

    const snow = this.pp.iceCap < 1.5 || this.pp.typeId === 3 ? (this.pp.typeId === 3 ? 1 : 0.5) : 0;
    const toArr = (c) => [c.r, c.g, c.b];
    const alb = ridgeAlbedo(toArr(this.pp.colA), toArr(this.pp.colB), toArr(this.pp.colC), snow);
    const warm = AERIAL ? airFor(this._air?.T ?? this.ctx.system?.temp ?? 5778, 13.5).horizonSun
      : [this.horizonColor.r, this.horizonColor.g, this.horizonColor.b];
    this._uRidgeWarm = { value: new THREE.Vector3(warm[0], warm[1], warm[2]) };

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: this.uSunDir,
        uCam: this.uCam,
        // the *same* uniform objects the terrain holds, not copies — `_syncAerial`
        // writes each air colour once, and a horizon graded by yesterday's air
        // while the ground uses today's is a seam that only appears at dusk
        ...(AERIAL ? this._aerialUniforms() : {}),
        uRidge: { value: new THREE.Vector3(alb[0], alb[1], alb[2]) },
        // held so `_syncAerial` can walk it with the sun — see the note there
        uRidgeWarm: this._uRidgeWarm,
        uHorizon: { value: this.horizonColor },
        uCentre: { value: new THREE.Vector2(sp.x, sp.z) },
      },
      vertexShader: HORIZON_VERT,
      fragmentShader: horizonFragment(AERIAL ? AERIAL_GLSL : ''),
      side: THREE.DoubleSide,
    });
    this.horizonMat = mat;

    this.horizon = new THREE.Group();
    let tris = 0;
    for (const b of h.bands) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(b.position, 3));
      geo.setAttribute('aH', new THREE.BufferAttribute(b.aH, 1));
      geo.setAttribute('aTrueD', new THREE.BufferAttribute(b.aTrueD, 1));
      geo.setAttribute('aTrueY', new THREE.BufferAttribute(b.aTrueY, 1));
      geo.setIndex(new THREE.BufferAttribute(b.index, 1));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(sp.x, sp.y, sp.z), b.radius * 1.6);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      // behind everything that is real, in front of the sky. Depth still
      // decides — this only spares the fragments a terrain that will overdraw
      // them anyway, which on a horizon band is most of them.
      mesh.renderOrder = 0;
      mesh.userData.noCast = true;
      this.horizon.add(mesh);
      tris += b.index.length / 3;
    }
    this.scene.add(this.horizon);

    const st = this._ridgeStats;
    console.info(`[§M2.6] horizon · ${h.bands.length} band${h.bands.length > 1 ? 's' : ''} `
      + `${h.radii.map((r) => (r | 0)).join('/')} m → ${h.rMax | 0} m · ${tris} tris · `
      + `${h.sky.samples} height samples · ${(performance.now() - t0) | 0} ms · `
      + `saturation ${st.sat < NO_LIMIT ? `${st.sat | 0} m` : 'none'} vs ring2 corner `
      + `${st.ring2Corner | 0} m → outer ring ${st.dropped ? 'retired' : 'kept'}`);
  }

  _gridWithHole(size, res, hole) {
    const half = size / 2, cell = size / res;
    const verts = [], uvs = [];
    for (let j = 0; j <= res; j++) {
      for (let i = 0; i <= res; i++) {
        verts.push(-half + i * cell, 0, -half + j * cell);
        uvs.push(i / res, j / res);
      }
    }
    const idx = [];
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const cx = -half + (i + 0.5) * cell, cz = -half + (j + 0.5) * cell;
        if (hole > 0 && Math.abs(cx) < hole && Math.abs(cz) < hole) continue;
        const a = j * (res + 1) + i, b = a + 1, c = a + res + 1, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(idx);
    return geo;
  }

  heightAt(x, z) { return this._heightFn(x, z); }

  /**
   * §6 M3's thesis, as one method: *"one global wind field sampled by
   * everything — grass, foliage, dust, spores, cloth, water ripple, cloud
   * advection, smoke."*
   *
   * Before this, the surface scale had **three** winds. `this.wind`, a static
   * Vector2 chosen once at construction, drove the rain, the lanterns and the
   * god rays. `_cloudWind` was a separate random scalar that drifted the cloud
   * deck along x only, at a speed unrelated to anything. And the grass, once
   * M3 arrived, read a real field. So the clouds already blew a different way
   * from the rain, and neither knew what the grass was doing.
   *
   * `heightAt` is deliberately optional and off by default here. The terrain
   * coupling costs six height lookups per sample, which is right for a blade
   * rooted in the ground and pointless for a raindrop at forty metres — the
   * speed-up over a crest is a boundary-layer effect and a raindrop is not in
   * the boundary layer.
   */
  sampleWind(x, z, height, couple = false) {
    if (this.windSys) {
      return windAt(this.windSys, x, z, this.uTime.value, height,
        couple ? this._heightFn : null);
    }
    // the pre-M3 path: one direction, one speed, no gusts
    const p = height === undefined ? 1 : 1;
    return { x: this.wind.x * 4 * p, z: this.wind.y * 4 * p, speed: 4 * p, gust: 0, front: 0 };
  }

  /**
   * The cloud deck's wind. The reference's own relation: it *"runs faster and
   * slightly veered from the surface wind"* — 2.35× and +0.19 rad, which is the
   * Ekman spiral, the same physics that turns the wind as you climb out of the
   * friction layer. Above the boundary layer the flow is geostrophic: faster,
   * because the ground is no longer dragging on it, and backed toward the
   * pressure gradient it was always trying to follow.
   */
  cloudWind() {
    if (!this.windSys) return { x: this.wind.x * 4, z: this.wind.y * 4 };
    const m = meanFlow(this.windSys, this.uTime.value);
    const a = m.dir + CLOUD_VEER;
    const sp = m.speed * CLOUD_SPEEDUP;
    return { x: Math.sin(a) * sp, z: Math.cos(a) * sp };
  }

  _findSpawn() {
    // score candidates: dry, flat, and not up a mountain — so dramatic
    // landforms never strand you on a spire or a sheer face
    const slopeAt = (x, z, h) => Math.max(
      Math.abs(this._heightFn(x + 24, z) - h), Math.abs(this._heightFn(x - 24, z) - h),
      Math.abs(this._heightFn(x, z + 24) - h), Math.abs(this._heightFn(x, z - 24) - h));
    let best = null, bestScore = -1e9;
    for (let rad = 0; rad < EXT * 0.42; rad += 15) {
      for (let th = 0; th < 6.28; th += 0.55) {
        const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
        const h = this._heightFn(x, z);
        if (this.seaLevel !== null && h < this.seaLevel + 3) continue;   // dry only
        const slope = slopeAt(x, z, h);
        // flat is good, low is good, near the landing is good
        const score = -slope * 2.5 - Math.max(0, h - 200) * 0.02 - rad * 0.01;
        if (score > bestScore) { bestScore = score; best = new THREE.Vector3(x, h, z); }
      }
    }
    if (best) return best;

    // waterlocked: raise the crust until the highest nearby point is a shore
    let bx = 0, bz = 0, bh = -1e9;
    for (let rad = 0; rad < EXT * 0.45; rad += 23) {
      for (let th = 0; th < 6.28; th += 0.7) {
        const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
        const h = this._heightFn(x, z);
        if (h > bh) { bh = h; bx = x; bz = z; }
      }
    }
    if (this.seaLevel !== null && bh < this.seaLevel + 3) {
      this.ground.lift = this.seaLevel + 5 - bh;
      bh += this.ground.lift;
    }
    return new THREE.Vector3(bx, bh, bz);
  }

  _buildSky() {
    // true angular size of this star from this orbit
    const rStarAU = this.sys.radiusSun * 0.00465;
    const angRad = Math.min(Math.atan(rStarAU / this.pp.a) * 3, 0.3); // ×3: cinematic sun
    if (SKY) {
      // §9.6 · the painted four-stop wash, with all ten of §9.1's stops derived
      // from *this star's* spectrum by the transfer in `starlight.js`.
      //
      // What it replaces was two stops — `pp.atmoColor · 0.26` at the zenith and
      // `· 0.5 + (0.04,0.04,0.05)` at the horizon — and the measurement is the
      // whole argument for the change: shipped zenith saturation 0.267 against
      // §9.1's `#4E80B4` at 0.567. **47% of spec.** Nine of the ten stops were
      // never read, though `starlight.js` has been computing every one of them
      // from the star's spectrum since M2 act 2. That is most of "the worlds
      // look washed out", and it was a wiring fault rather than a palette one.
      this.skyDome = makeSurfaceSky({
        sunDir: this.uSunDir,
        T: this.ctx.system?.temp ?? 5778,
        atmo: this.atmo,
        sunAng: Math.max(angRad, 0.012),
        cirrus: Math.min((this.pp.clouds ?? 0.3) * 1.1, 0.9),
        tier: Q.name,
      });
      this.sky = this.skyDome.mesh;
    } else {
      this.sky = new THREE.Mesh(
        new THREE.SphereGeometry(20000, 32, 16),
        new THREE.ShaderMaterial({
          uniforms: {
            uSunDir: this.uSunDir, uSunColor: this.uSunColor,
            uZenith: { value: this.zenithColor },
            uHorizon: { value: this.horizonColor },
            uSunAng: { value: Math.max(angRad, 0.012) },
            uAtmo: { value: this.atmo },
            uSeed: { value: this.pp.noiseSeed },
          },
          vertexShader: SKY_VERT,
          fragmentShader: SKY_FRAG,
          side: THREE.BackSide,
          depthWrite: false,
        }));
    }
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this._buildClouds();
    this._buildNightSky();
  }

  /** painterly cumulus, drifting the way clouds actually spend a day */
  _buildClouds() {
    const pp = this.pp;
    if (this.atmo < 0.5 || (pp.clouds ?? 0) < 0.22 || pp.typeId > 2) return;
    const r = new RNG(hash(pp.seed, 0xc1a0d5));
    if (SKY) {
      this.cumulus = makeCumulus({
        sunDir: this.uSunDir,
        camPos: this._uCamPos || (this._uCamPos = { value: new THREE.Vector3() }),
        seed: pp.seed, rand: () => r.next(), tier: Q.name,
        T: this.ctx.system?.temp ?? 5778,
        // The lifting condensation level. Every cloud in a field shares it —
        // they condensed out of the same air at the same dew point — which is
        // why a real cumulus sky looks ruled along its bases, and why two
        // independently scattered sprite layers never could.
        base: 620 + 900 * (1 - Math.min(pp.clouds ?? 0.4, 1)),
        amount: Math.min(Math.max((pp.clouds ?? 0.4) * 1.35, 0.12), 0.95),
        aerialGLSL: AERIAL ? AERIAL_GLSL : '',
        aerialUniforms: AERIAL ? this._aerialUniforms() : {},
      });
      this.scene.add(this.cumulus.mesh);
      return;
    }
    const layers = [
      { size: 520, count: 9, o: 0.5 },
      { size: 300, count: 14, o: 0.38 },
    ];
    this.clouds = [];
    // kept only for the pre-M3 path; `cloudWind()` supersedes it under ?m3=1
    this._cloudWind = r.float(2.5, 5.5) * (r.chance(0.5) ? 1 : -1);
    for (const L of layers) {
      const pts = [];
      for (let c = 0; c < L.count; c++) {
        const cx = r.float(-4200, 4200), cz = r.float(-4200, 4200);
        const cy = r.float(300, 520), puffs = r.int(4, 8);
        for (let p = 0; p < puffs; p++) {
          pts.push(cx + r.gauss() * 130, cy + r.gauss() * 26, cz + r.gauss() * 90);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
      const mat = new THREE.PointsMaterial({
        map: softDotTexture(64), size: L.size, transparent: true,
        opacity: L.o, depthWrite: false, sizeAttenuation: true,
        color: 0xffffff,
      });
      const cloud = new THREE.Points(geo, mat);
      cloud.renderOrder = 2;
      cloud.frustumCulled = false;
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
  }

  /** the night is not a wall: colored stars, the galaxy's milk, meteors */
  _buildNightSky() {
    const r = new RNG(hash(this.pp.seed, 0x57a88));
    const N = 2400, NB = 700;
    const pos = new Float32Array((N + NB) * 3);
    const col = new Float32Array((N + NB) * 3);
    const size = new Float32Array(N + NB);
    const ph = new Float32Array(N + NB);
    // a great circle for the galaxy to lie along
    const bandN = new THREE.Vector3(r.gauss(), r.gauss() * 0.4 + 0.8, r.gauss()).normalize();
    const v = new THREE.Vector3();
    for (let i = 0; i < N + NB; i++) {
      const band = i >= N;
      do {
        v.set(r.gauss(), r.gauss(), r.gauss()).normalize();
        if (band) v.addScaledVector(bandN, -v.dot(bandN) * r.float(0.86, 0.97)).normalize();
      } while (v.y < -0.12);
      v.multiplyScalar(16000);
      pos.set([v.x, v.y, v.z], i * 3);
      // stellar colors: most white, the rest gold, ember, blue
      const roll = r.next();
      const c = band ? new THREE.Color(0.55, 0.55, 0.75).offsetHSL(r.float(-0.06, 0.06), 0, r.float(-0.1, 0.1))
        : roll < 0.62 ? new THREE.Color(0.9, 0.9, 1.0)
        : roll < 0.78 ? new THREE.Color(1.0, 0.82, 0.55)
        : roll < 0.9 ? new THREE.Color(0.65, 0.75, 1.0)
        : new THREE.Color(1.0, 0.5, 0.35);
      c.multiplyScalar(band ? 0.2 : r.float(0.55, 1));
      col.set([c.r, c.g, c.b], i * 3);
      size[i] = band ? r.float(7, 16) : r.power(2.2, 7.5, 2.4);
      ph[i] = r.float(0, 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    geo.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    this._starDark = { value: 0 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime, uDark: this._starDark },
      vertexShader: /* glsl */`
        attribute vec3 aCol;
        attribute float aSize;
        attribute float aPh;
        uniform float uTime;
        uniform float uDark;
        varying vec3 vCol;
        varying float vA;
        void main() {
          vCol = aCol;
          float tw = 0.74 + 0.26 * sin(uTime * (0.5 + aPh * 2.2) + aPh * 41.0);
          vA = uDark * tw;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (900.0 / -mv.z) * 20.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        precision highp float;
        varying vec3 vCol;
        varying float vA;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.1, d) * vA;
          gl_FragColor = vec4(vCol * a, a);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.nightStars = new THREE.Points(geo, mat);
    this.nightStars.renderOrder = 1;
    this.nightStars.frustumCulled = false;
    this.scene.add(this.nightStars);

    // The aurora, if this world has a magnetosphere to draw one with. `null`
    // is the common answer and the honest one — see src/magnetosphere.js.
    if (AURORA) {
      const ld = this._landingDir || [0, 1, 0];
      const latDeg = (Math.asin(Math.min(Math.max(ld[1], -1), 1)) * 180) / Math.PI;
      this.aurora = addAurora(this.pp, {
        latDeg,
        starT: this.ctx.system?.temp ?? 5778,
        auDist: this.pp.au ?? 1,
        RKm: Math.max((this.pp.radiusE ?? 1) * 6371, 200),
        hScale: Math.max(this.atmo, 0.2),
        skyR: 12000,
      });
      if (this.aurora) {
        // Face it: the ribbon's own -Z, turned onto the camera's opening
        // heading plus its seeded offset (§9.7 — see src/curtain.js).
        const f2 = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this.aurora.mesh.rotation.y = Math.atan2(-f2.x, -f2.z)
          + this.aurora.mesh.userData.bearingJitter;
        this.scene.add(this.aurora.mesh);
        console.info(`[aurora] oval at ${(90 - this.aurora.mag.colat).toFixed(1)}°`
          + ` magnetic latitude · standoff ${this.aurora.mag.standoff.toFixed(1)} R_p`
          + ` · ${this.aurora.geom.gapKm.toFixed(0)} km away`
          + ` · lines ${this.aurora.lines.map((l) => l.nm).join('/')} nm`);
      } else {
        console.info('[aurora] none — no dynamo, no air, or the oval is out of range');
      }
    }

    // a meteor sprite waits offstage for its half-second
    this._shoot = {
      sp: new THREE.Sprite(new THREE.SpriteMaterial({
        map: softDotTexture(32), color: new THREE.Color(1.6, 1.5, 1.2),
        transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      })),
      t: -1, next: 5,
      from: new THREE.Vector3(), dirV: new THREE.Vector3(),
    };
    this._shoot.sp.scale.set(160, 7, 1);
    this.scene.add(this._shoot.sp);
  }

  _buildOcean() {
    // Enough vertices that the swell can actually lift them — and, under
    // §M2 act 5, enough that it can lift them *without aliasing*. A geometric
    // wave shorter than twice its quad turns into diagonal slashes tracking
    // the grid, so the plane shrank and the grid grew: 240 m per quad became
    // 37 m, which resolves the peak wavelength an 8 m/s wind raises.
    //
    // The plane could shrink because §9.3's fog now closes long before its
    // edge — extinction saturates by about 8 km and this reaches 11.2.
    const span = SEA ? EXT * 8 : EXT * 24;
    const segs = SEA ? 300 : 140;
    const geo = new THREE.PlaneGeometry(span, span, segs, segs);
    this._seaQuad = span / segs;
    geo.rotateX(-Math.PI / 2);
    this.ocean = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: this.uSunDir, uSunColor: this.uSunColor,
        // the same objects the terrain holds, not a copy — §16.2's "one shared
        // chunk" is only true if the uniforms are shared too, and `_syncAerial`
        // writes each colour once for every material that reads it
        ...(AERIAL ? this._aerialUniforms() : {}),
        ...(SEA ? this._seaUniforms() : {}),
        uHorizon: { value: this.horizonColor },
        uDeep: { value: this.pp.typeId === 2 ? this.pp.colA : new THREE.Color(0.02, 0.1, 0.2) },
        uCam: this.uCam,
        uTime: this.uTime,
        uSeed: { value: this.pp.noiseSeed },
        uWind: { value: this.wind },
      },
      vertexShader: OCEAN_VERT,
      fragmentShader: OCEAN_FRAG,
    }));
    this.ocean.position.y = this.seaLevel;
    this.scene.add(this.ocean);
  }

  _buildRocks() {
    const r = new RNG(hash(this.pp.seed, 0x70c5));
    const N = 260;
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: this.pp.colB.clone().multiplyScalar(0.55), roughness: 0.95, metalness: 0,
    });
    const rocks = new THREE.InstancedMesh(geo, mat, N);
    const d = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < N * 3 && placed < N; i++) {
      const x = r.float(-EXT / 2, EXT / 2), z = r.float(-EXT / 2, EXT / 2);
      const h = this.heightAt(x, z);
      if (this.seaLevel !== null && h < this.seaLevel + 1) continue;
      d.position.set(x, h, z);
      d.rotation.set(r.float(0, 3), r.float(0, 3), r.float(0, 3));
      d.scale.setScalar(r.power(0.4, 6, 2.2));
      d.updateMatrix();
      rocks.setMatrixAt(placed++, d.matrix);
    }
    rocks.count = placed;
    this.scene.add(rocks);
    // MeshStandardMaterial needs real lights:
    this.dirLight = new THREE.DirectionalLight(0xffffff, 2);
    this.scene.add(this.dirLight);
    this.scene.add(new THREE.AmbientLight(0x223344, 0.35));
    // Everything three.js lights for us — settlements, herds, ruins, ships —
    // gets the aurora the same way, as a hemisphere from above. Black below,
    // because the ground is not emitting it.
    this.auroraLight = new THREE.HemisphereLight(0x000000, 0x000000, 0);
    this.scene.add(this.auroraLight);
  }

  _buildCityGlow() {
    const r = new RNG(hash(this.pp.seed, 0xc17e));
    this.cityGlows = [];
    const tex = (() => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const g = cv.getContext('2d');
      const grad = g.createRadialGradient(64, 100, 4, 64, 100, 70);
      grad.addColorStop(0, 'rgba(255,190,120,0.9)');
      grad.addColorStop(1, 'rgba(255,190,120,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      return new THREE.CanvasTexture(cv);
    })();
    for (let i = 0; i < 3; i++) {
      const th = r.float(0, 6.28);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      }));
      sp.position.set(Math.cos(th) * EXT * 1.4, 60, Math.sin(th) * EXT * 1.4);
      sp.scale.set(900, 320, 1);
      this.scene.add(sp);
      this.cityGlows.push(sp);
    }
  }

  /**
   * Standing on a moon: the parent world hangs vast and tidally fixed in the
   * sky, rendered with its real surface shader and lit by the local sun — so
   * it runs through true phases as the day turns. Rings included.
   */
  _buildParentGiant(pg) {
    const pp = pg.pp;
    this.uSunPosFar = { value: new THREE.Vector3(0, 1e7, 0) };
    const dist = 10000;
    const R = dist * Math.tan(0.21); // ~24° of sky
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(R, 72, 48),
      makeSurfaceMaterial(pp, this.uSunPosFar, this.uCam, this.uTime));
    const az = 0.85, el = 0.4;
    mesh.position.set(
      Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)
    ).multiplyScalar(dist);
    mesh.rotation.z = 0.35;
    this.scene.add(mesh);
    this.giant = mesh;

    const posUniform = { value: mesh.position };
    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.05, 48, 32),
      makeAtmosphereMaterial(pp, this.uSunPosFar, this.uCam, posUniform));
    atmo.position.copy(mesh.position);
    this.scene.add(atmo);

    if (pp.hasRings) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(R * 1.45, R * 2.6, 160, 1),
        makeRingMaterial(pp, this.uSunPosFar, posUniform, R * 1.45, R * 2.6, R));
      ring.position.copy(mesh.position);
      // oblique seat: keep our line of sight well out of the ring plane
      const n = mesh.position.clone().normalize().add(new THREE.Vector3(0, 1.35, 0)).normalize();
      ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      this.scene.add(ring);
    }
  }

  /**
   * The rest of the system, visible from the ground: sibling worlds placed
   * along the sun's arc at their true elongations (inner worlds hug the sun;
   * outer ones can stand at opposition), brightness ∝ r²/d².
   */
  _buildSiblings() {
    const sys = this.app.stack.find(s => s.kind === 'system');
    const hostIdx = this.ctx.hostIndex;
    if (!sys || hostIdx === undefined) return;
    const host = sys.planetNodes[hostIdx];
    if (!host) return;
    const p0 = host.group.position;
    const aSun = Math.atan2(-p0.z, -p0.x);
    const tex = softDotTexture(64);
    this.siblings = [];
    for (const node of sys.planetNodes) {
      if (node.pp.index === hostIdx) continue;
      const d = node.group.position.clone().sub(p0);
      const dist = Math.max(d.length(), 1);
      let off = Math.atan2(d.z, d.x) - aSun;
      off = ((off + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const b = Math.min(900 * node.pp.drawRadius ** 2 / (dist * dist), 0.85);
      if (b < 0.004) continue;
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex,
        color: node.pp.colA.clone().lerp(new THREE.Color(1, 1, 1), 0.55).multiplyScalar(b),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }));
      sp.scale.setScalar(120 + 380 * Math.min(b, 1));
      this.scene.add(sp);
      this.siblings.push({ sp, off, tilt: node.pp.inc * 4 + 0.02 });
    }

    // a comet near perihelion hangs in the sky, tail swept from the sun
    if (sys.cometHead && sys.cometR !== undefined && sys.cometR < 3.2) {
      const d = sys.cometHead.position.clone().sub(p0);
      let off = Math.atan2(d.z, d.x) - aSun;
      off = ((off + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const activity = Math.min(5 / (sys.cometR * sys.cometR), 1);
      if (activity > 0.12) {
        const coma = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex, color: new THREE.Color(0.65, 0.8, 1.0).multiplyScalar(0.5 + 0.5 * activity),
          blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        }));
        coma.scale.setScalar(200 + 260 * activity);
        this.scene.add(coma);
        // tail: a world-oriented plane, bright at the head, fading anti-sunward
        const tailTex = (() => {
          const cv = document.createElement('canvas');
          cv.width = 256; cv.height = 64;
          const g = cv.getContext('2d');
          const img = g.createImageData(256, 64);
          for (let y = 0; y < 64; y++) {
            for (let x = 0; x < 256; x++) {
              const u = x / 256, vv = (y - 32) / 32;
              const a = Math.pow(1 - u, 1.7) * Math.exp(-vv * vv * (2.2 + u * 7));
              const k = (y * 256 + x) * 4;
              img.data[k] = 190; img.data[k + 1] = 215; img.data[k + 2] = 255;
              img.data[k + 3] = a * 210;
            }
          }
          g.putImageData(img, 0, 0);
          return new THREE.CanvasTexture(cv);
        })();
        const geo = new THREE.PlaneGeometry(1, 1);
        geo.translate(0.5, 0, 0); // head at the origin edge
        const tail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
          map: tailTex, transparent: true, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        }));
        this.scene.add(tail);
        this.skyComet = { coma, tail, off, tilt: 0.14, activity };
      }
    }

    // our own moons: real discs with real phases, riding the same arc
    this.skyMoons = [];
    if (!this.ctx.parentGiant) {
      this.uSunPosFar = this.uSunPosFar || { value: new THREE.Vector3(0, 1e7, 0) };
      for (const moon of host.moons || []) {
        const ud = moon.userData;
        const thM = ud.phase + ud.rate * sys.days;
        let off = thM - aSun;
        off = ((off + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        const dist = 13000;
        const ang = Math.min(Math.max(ud.drawR / ud.dist, 0.012), 0.09) * 1.5;
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(dist * ang, 40, 26),
          makeSurfaceMaterial({
            typeId: ud.icy ? 3 : 0, noiseSeed: ud.noiseSeed, oceanLevel: -1, inhabited: false,
            colA: ud.icy ? new THREE.Color(0.68, 0.74, 0.82) : new THREE.Color(0.42, 0.41, 0.39),
            colB: ud.icy ? new THREE.Color(0.88, 0.92, 0.98) : new THREE.Color(0.6, 0.58, 0.55),
            colC: ud.icy ? new THREE.Color(0.3, 0.45, 0.6) : new THREE.Color(0.27, 0.26, 0.25),
            iceCap: ud.icy ? 0.0 : 2.0,
          }, this.uSunPosFar, this.uCam, this.uTime));
        this.scene.add(mesh);
        this.skyMoons.push({ mesh, off, tilt: 0.06 + 0.05 * ud.moonIndex, dist });
      }
    }
  }

  _sunDirAt(ph, out) {
    return out.set(Math.cos(ph) * 0.9, Math.sin(ph), Math.sin(ph * 0.7) * 0.45 + 0.2).normalize();
  }

  /**
   * The day phase that puts the sun at `elevDeg` — and, among the phases that
   * do, the one that puts it most nearly *ahead* of `fwd`.
   *
   * §9.7 forces 8–18° and the solver hands back a target inside it. But the sun
   * path is a tilted circle, so an elevation is generally reached twice a day —
   * once climbing, once falling — and those two phases sit on opposite sides of
   * the sky. §9.2 calls the backlight rim "the connective tissue of the whole
   * image" and it only fires looking toward the sun, so the choice between them
   * is the difference between the light model's best term firing and not.
   *
   * Inverted by scan rather than algebra: the path mixes `sin(ph)` with
   * `sin(0.7·ph)` and has no closed form. 2000 steps resolves the phase to
   * 0.003 rad, well inside the band. Deterministic, and cheap enough to be
   * unmeasurable next to the solve that precedes it.
   */
  _sunPhaseFacing(elevDeg, fwd) {
    const target = Math.sin(elevDeg * Math.PI / 180);
    const v = new THREE.Vector3();
    let best = this.sunPhase, bestErr = Infinity, bestFace = -Infinity;
    for (let i = 0; i < 2000; i++) {
      const ph = (i / 2000) * Math.PI * 2;
      this._sunDirAt(ph, v);
      const err = Math.abs(v.y - target);
      if (err > 0.01) continue;                      // ~0.6° of elevation
      const face = (v.x * fwd.x + v.z * fwd.z) / (Math.hypot(v.x, v.z) || 1);
      // prefer facing the sun; fall back to closest elevation if none qualify
      if (face > bestFace + 1e-6) { bestFace = face; bestErr = err; best = ph; }
    }
    if (bestFace === -Infinity) {                    // the band is unreachable
      for (let i = 0; i < 2000; i++) {
        const ph = (i / 2000) * Math.PI * 2;
        const err = Math.abs(this._sunDirAt(ph, v).y - target);
        if (err < bestErr) { bestErr = err; best = ph; }
      }
    }
    return best;
  }

  // ------------------------------------------------------- impacts -------
  _initImpacts() {
    const pp = this.pp;
    // airless/barren worlds arrive already cratered — history, not weather
    const airless = pp.typeId === 0 || pp.typeId === 3;
    this.craterGroup = new THREE.Group();
    this.scene.add(this.craterGroup);

    // ancient craters already on airless ground, so you don't arrive blank
    if (airless) {
      const r = new RNG(hash(pp.seed, 0x0cae));
      const n = r.int(3, 7);
      for (let i = 0; i < n; i++) {
        const th = r.float(0, 6.28), rad = r.float(120, 620);
        this._carveCrater(Math.cos(th) * rad, Math.sin(th) * rad, r.float(28, 90), 1, false);
      }
    }
  }

  _carveCrater(x, z, radius, grown, scorch) {
    const im = { x, z, r: radius, depth: radius * 0.28, grown };
    this.impacts.push(im);
    this._retessellateAround(x, z, radius * 2.3);
    // charred ejecta ring on the surface
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.55, radius * 1.7, 40, 1),
      new THREE.MeshBasicMaterial({
        color: scorch ? 0x120a08 : 0x1a140f, transparent: true,
        opacity: scorch ? 0.55 : 0.32, side: THREE.DoubleSide, depthWrite: false,
      }));
    ring.position.set(x, 0, z);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 2;
    this.craterGroup.add(ring);
    ring.userData.follow = () => { ring.position.y = this.heightAt(x, z) + 0.6; };
    // the ground just moved under every ring — reseat them once, here,
    // instead of re-evaluating the height field per frame for static decals
    for (const c of this.craterGroup.children) c.userData.follow();
    return im;
  }

  /** rebuild the vertices of any ring mesh near (x,z) so a fresh crater shows */
  _retessellateAround(x, z, reach) {
    for (const mesh of this.terrain.children) {
      const pos = mesh.geometry.attributes.position;
      let touched = false;
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), pz = pos.getZ(i);
        if (Math.abs(px - x) < reach && Math.abs(pz - z) < reach) {
          pos.setY(i, this._heightFn(px, pz) - mesh.userData.drop);
          touched = true;
        }
      }
      if (touched) { pos.needsUpdate = true; mesh.geometry.computeVertexNormals(); }
    }
  }

  // ------------------------------------------------------------ input ----
  _bindInput() {
    if (M4) {
      // One shared source, attached once and idempotent, instead of a private
      // pair of listeners per scale. It also brings the two this scale never
      // had: a `keyup` that survives the scale being popped, and a `blur`
      // handler — without which a key held across an alt-tab stays held and
      // the body walks into the horizon while the tab is hidden.
      attachKeyboard();
      this._drag = null;
      return;
    }
    this._onKeyDown = (e) => this.keys.add(e.code);
    this._onKeyUp = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    this._drag = null;
  }
  onPointerDown(e) { this._drag = { x: e.clientX, y: e.clientY }; }
  onPointerUp() { this._drag = null; }
  onPointerMove(e) {
    if (!this._drag) return;
    const dx = e.clientX - this._drag.x, dy = e.clientY - this._drag.y;
    this._drag = { x: e.clientX, y: e.clientY };
    if (M4) {
      // one sensitivity and one clamp, where three scales each had their own
      this.rig.look(dx, dy);
      this.yaw = this.rig.yaw; this.pitch = this.rig.pitch;
      return;
    }
    this.yaw -= dx * 0.0035;
    this.pitch = Math.min(Math.max(this.pitch - dy * 0.0032, -1.45), 1.45);
  }

  /**
   * §M4's step, and the bridge back to everything that was written against the
   * old one.
   *
   * Twenty-odd things in this file and its neighbours read `this.body` and
   * `this.vel` — the door check, the tile clamp, the audio, the traveler's
   * figure, the discovery captions. Rather than convert all of them in the same
   * commit that introduces the controller, the controller's state is written
   * back into those two fields each frame. `this.body` keeps meaning what it
   * always meant: the *eye*, not the feet.
   */
  _stepBody(dt) {
    const w = this.walker;
    w.fly = this.fly;
    w.seaLevel = this.seaLevel;

    if (this.inside) {
      // A shrine has a floor of its own and walls that hold you; the height
      // field says nothing about either. The controller is handed the interior
      // as its ground for as long as you are in it, so stepping through the
      // door does not mean stepping into a second movement model.
      const c = this.interior.bounds.clamp(w.pos.x, w.pos.z);
      w.pos.x = c.x; w.pos.z = c.z;
      w.pos.y += (this.interior.floorY - w.pos.y) * (1 - Math.exp(-12 * dt));
      w.vel.y = 0;
      w.grounded = true;
    }

    // Pitch is handed to the controller as well as to the lens now. On the
    // ground it is ignored — you do not walk uphill by looking up — but in
    // flight it is the whole aiming model: thrust runs along the look vector,
    // so "you fly where you look" is a property of the integrator rather than
    // a special case somewhere above it (see `Walker._flyStep`).
    w.step(dt, {
      move: input.move,
      jump: jumpHeld(),
      sprint: input.down('sprint'),
      up: (input.down('up') ? 1 : 0) - (input.down('down') ? 1 : 0),
    }, this.rig.yaw, this.rig.pitch);

    // write back, so nothing downstream has to know any of this changed
    this.body.set(w.pos.x, w.eyeY(), w.pos.z);
    this.vel.set(w.vel.x, w.vel.y, w.vel.z);
    this.yaw = this.rig.yaw;
    this.pitch = this.rig.pitch;
  }

  /**
   * Adopt whatever the camera is currently pointing at. This is the handoff
   * primitive — the hyperzoom flies the camera and then hands it back, and
   * without this the view would snap to wherever the controller last thought
   * it was looking, which is a cut (§2.5).
   */
  _syncAngles() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(Math.min(Math.max(d.y, -1), 1));
    if (this.rig) { this.rig.yaw = this.yaw; this.rig.pitch = this.pitch; }
  }

  onKey(code) {
    // §2.4 · Space belongs to pause-time globally (`main.js:421`) and a saved
    // link expects it to pause. So jump takes the scale-first path already
    // established for KeyB: this scale claims Space while it is walking, and
    // an unhandled press still falls through to `togglePlay`.
    // …and under §M5 it claims it while *riding* too, because the short hop is
    // the same button as the jump. That is deliberate: one thing a rider
    // already knows, transferred rather than relearned. A press with neither a
    // body nor a craft under it still falls through to `togglePlay`.
    if (M4 && code === 'Space' && this.controls.enabled
      && (M5 || !this.traveler?.riding)) return true;
    if (code === 'KeyF') { this.fly = !this.fly; return true; }
    if (code === 'KeyC') {
      const third = this.traveler.toggleView();
      // the rig and the figure agree about which person we are in, always
      if (this.rig) this.rig.third = third;
      this.app.hud.setHint(third
        ? 'third person · the traveler walks · c returns to their eyes'
        : 'first person · c steps back outside');
      return true;
    }
    if (code === 'KeyE') {
      // One key, one meaning: get into whatever is here. A conjured craft is
      // asked first only because it is the thing you just called and are
      // standing next to; when there is none, this is the skiff's key exactly
      // as it has always been.
      if (this._board()) return true;
      const res = this.traveler.tryMount();
      if (res === 'mounted') this.app.hud.setHint('the skiff has you · wasd flies it · shift opens it up · e steps off');
      else if (res === 'dismounted') this.app.hud.setHint('on foot · e reboards the skiff · c for first person');
      else this.app.hud.setHint('the skiff waits near the plaza — walk to it and press e');
      return true;
    }
    // §2.4 · `KeyV` is free: `main.js`'s switch claims H, M, B, U, G, J and N,
    // and this scale claims Space, F, C and E. Nothing else in the repo binds V.
    if (code === 'KeyV') { this._summon(); return true; }
    return false;
  }

  /**
   * Conjure a craft, or find out that you cannot.
   *
   * §2.1 forbids an asset and §4 forbids an inventory, so the craft is not
   * fetched — it is solved. `craft.js` asks how much velocity this world costs
   * to leave and what the rocket equation says a vehicle able to buy it must
   * weigh; `conjure.js` turns that into parts. On a small moon you get a dart.
   * On an Earth you get 110 m and five engines, because that is a Saturn V and
   * that is what leaving Earth costs.
   *
   * On a heavy world with air the answer is that **no chemical rocket leaves**,
   * and the conjuring refuses with the number. That is the best thing the
   * mechanic does and the interface must not soften it (§8 axis 8).
   */
  _summon() {
    if (this.conjure && this.conjure.phase !== 'idle' && this.conjure.phase !== 'refused') {
      // already standing there, or on its way: dismiss rather than stacking a
      // second. A summon during `gather` is a mind changed, not a second craft.
      this.conjure.dismiss();
      if (this.conjureGrp) this.conjureGrp.visible = false;
      this.app.hud.setHint('the craft returns to wherever conjured things wait · v calls it back');
      return;
    }
    if (!this.conjure) {
      this.conjure = new Conjuration({
        massE: this.pp.massE, radiusE: this.pp.radiusE, atmo: this.atmo,
      }, this.pp.seed);
    }
    if (!this.conjure.summon()) {
      // the world is one-way, and the reason is arithmetic
      this.app.hud.setHint(this.conjure.result.why);
      return;
    }
    if (!this.conjureGrp) this.conjureGrp = this._buildCraft(this.conjure);
    this.conjureGrp.visible = true;
    // Beside you, not on you. The offset is the craft's own base radius plus a
    // walk — a 3.9 m dart stands close enough to reach and a 33 m super-earth
    // stack stands clear of its own fins, which one fixed 18 m cannot do both of.
    const a = this.yaw + 1.1;
    const clear = 14 + this.conjure.craft.diameter * 1.4;
    const x = this.body.x + Math.sin(a) * clear, z = this.body.z + Math.cos(a) * clear;
    this.conjureGrp.position.set(x, this._padY(x, z), z);
    this.app.hud.setHint(`${this.conjure.craft.why} · ${CONJURE_TIME.toFixed(1)} s to build · v dismisses`);
  }

  /**
   * Where the pad is. Sea level counts as ground for this the same way it does
   * for the skiff — a rocket conjured over water stands on the water rather
   * than under it, which is the same lie the hover-skiff already tells and a
   * much smaller one than a launch from the seabed.
   */
  _padY(x, z) {
    const h = this.heightAt(x, z);
    return this.seaLevel === null ? h : Math.max(h, this.seaLevel);
  }

  /**
   * Build the meshes once, from the descriptors.
   *
   * `conjure.js` emits geometry as numbers so it can be checked offline; this
   * is the only place that turns those numbers into three, and it is
   * deliberately dumb — a switch on `kind` and a material per `role`. Anything
   * clever here would be a second opinion about the shape, and the shape has an
   * owner.
   */
  _buildCraft(conj) {
    const g = new THREE.Group();
    const mk = (c, rough, metal) => new THREE.MeshStandardMaterial({
      color: c, roughness: rough, metalness: metal, transparent: true, opacity: 0,
    });
    const mats = {
      tank: mk(0xd8d2c2, 0.45, 0.25),
      interstage: mk(0x6d6a63, 0.70, 0.30),
      capsule: mk(0xe8e2d2, 0.35, 0.40),
      engine: mk(0x4a4640, 0.55, 0.60),
      fin: mk(0xb9432f, 0.60, 0.20),
    };
    mats.fin.side = THREE.DoubleSide;
    for (const p of conj.parts) {
      let geo, part = p;
      if (p.kind === 'cylinder') geo = new THREE.CylinderGeometry(p.radius, p.radius, p.height, 18);
      else if (p.kind === 'cone') geo = new THREE.ConeGeometry(p.radius, p.height, 18);
      else {
        // Fins, and two things the descriptor cannot express on its own.
        //
        // **The span grows outward, not through the hull.** A box of width
        // `span` centred on the tank wall is half inside the tank: Earth's fin
        // spans 21 m centred at radius 8.1, so it reaches 2.4 m past the far
        // side of its own rocket. Translating the geometry so its inner edge is
        // the origin makes `span` mean what the word means.
        //
        // **And it must point at the axis.** A rotation of `a` about Y sends
        // local +x to `(cos a, 0, −sin a)`, while the descriptor places the fin
        // at `(cos φ·R, y, sin φ·R)` — so the angle that lays the span along the
        // radius is `−φ`, not `+φ`. With `+φ` the fins splay tangentially and
        // only the two at φ = 0 and π look right, which is exactly the kind of
        // thing that reads as correct from one camera angle. Taking φ from the
        // part's own position rather than from a stored angle means the two can
        // never disagree.
        geo = new THREE.BoxGeometry(p.span, p.height, Math.max(p.span * 0.06, 0.2));
        geo.translate(p.span / 2, 0, 0);
        part = { ...p, ry: -Math.atan2(p.z, p.x) };
      }
      const m = new THREE.Mesh(geo, mats[p.role] ?? mats.tank);
      m.userData.part = part;
      g.add(m);
    }
    // §9.2's shadow is opt-in by layer, and a 110 m tower at a 13° sun is the
    // longest occluder this scale will ever have. Casting it is most of what
    // makes the craft belong to the valley rather than sit on top of it.
    markCaster(g);
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  /**
   * Board the craft, if there is one and you are standing at it.
   *
   * Returns false when there is nothing to board, so `KeyE` can fall through to
   * the skiff and one key keeps meaning "get in whatever is here".
   *
   * The eye goes to the capsule. That is a decision and it is worth naming: a
   * launch seen from outside would need the third-person spring to know how wide
   * a 16 m stack is, and it would put the camera inside the hull on any world
   * whose answer is a fat rocket. From the capsule there is nothing to collide
   * with, and what you get instead is the shot the whole scale exists for — the
   * valley falling away through its own aerial perspective, continuously, with
   * no cut anywhere between standing in the grass and being in orbit (§2.5).
   */
  _board() {
    const c = this.conjure;
    if (!c || c.phase !== 'ready' || !this.conjureGrp) return false;
    const g = this.conjureGrp.position;
    const reach = 6 + c.craft.diameter;
    if (Math.hypot(this.body.x - g.x, this.body.z - g.z) > reach) {
      this.app.hud.setHint(`the craft stands ${Math.round(Math.hypot(this.body.x - g.x, this.body.z - g.z))} m off · walk to it and press e`);
      return true;
    }
    this.launch = {
      p: launchFor(c.craft, { massE: this.pp.massE, radiusE: this.pp.radiusE, atmo: this.atmo }),
      s: launchState(),
      // downrange is whichever way you were facing when you climbed in, so the
      // pitch-over carries the frame you already composed rather than a constant
      az: this.yaw,
      pad: { x: g.x, y: g.y, z: g.z },
      // the eye sits at the capsule, which `conjure.js` puts at the top of the
      // stack minus half its own length
      eye: c.craft.height - 4.5,
    };
    this.fly = false;
    if (this.traveler) { this.traveler.third = false; this.traveler.riding = false; }
    if (this.rig) this.rig.third = false;
    this.app.hud.setHint(`ignition · ${c.craft.why} · the ground lets go at ${Math.round(this._releaseAlt)} m`);
    this.app.audio?.warp?.('ascend');
    return true;
  }

  /**
   * The climb-out. `src/climb.js` owns every number; this owns the scene graph
   * and the one moment the scale changes.
   *
   * The handover is `ascent.js`'s, unchanged and not duplicated: the same
   * `handoff()` decomposition and the same `popTo` the walker's climb already
   * uses (§2.4 — this adds no new kind of location). What is different is only
   * who asked, which is the entire reason `_climbCheck` and this can be separate
   * without being two code paths.
   */
  _updateLaunch(dt) {
    const L = this.launch;
    L.s = stepLaunch(L.s, L.p, dt, this._releaseAlt);
    const s = L.s;
    const dx = Math.sin(L.az) * s.down, dz = Math.cos(L.az) * s.down;
    if (this.conjureGrp) {
      this.conjureGrp.position.set(L.pad.x + dx, L.pad.y + s.h, L.pad.z + dz);
      // lean into the turn — the stack flies pointed, which is the visible form
      // of the gravity turn and the only place the pitch angle appears at all
      this.conjureGrp.rotation.set(Math.cos(L.az) * s.theta, 0, -Math.sin(L.az) * s.theta);
    }
    this.body.set(L.pad.x + dx, L.pad.y + s.h + L.eye, L.pad.z + dz);
    this.vel.set(s.vHor * Math.sin(L.az), s.vUp, s.vHor * Math.cos(L.az));
    if (this.walker) {
      // the walker is along for the ride, so a dismount at any point starts
      // from where the body actually is rather than from the pad
      this.walker.pos.x = this.body.x;
      this.walker.pos.z = this.body.z;
      this.walker.pos.y = L.pad.y + s.h;
      this.walker.vel.x = this.vel.x; this.walker.vel.y = this.vel.y; this.walker.vel.z = this.vel.z;
      this.walker.grounded = false;
    }
    this._climbFrac = Math.min(s.h / Math.max(this._releaseAlt, 1), 1);
    // `gone`, not `released`.
    //
    // `released` is a one-frame edge and `popTo` can refuse: it returns early
    // while another transition is in flight, and it returns early on a stack
    // too short to pop. Consuming the edge and clearing `this.launch` before
    // finding out whether the pop was accepted strands the body at 1435 m with
    // the craft state already destroyed and nothing left to fire again — the
    // latch that stops the edge firing twice is exactly what makes that
    // unrecoverable. Reading the latch instead retries every frame until the
    // app is free, and clearing `launch` on success is what stops it repeating.
    if (!s.gone) return;
    const depth = this.app.stack.length - 2;
    if (this.app._warping || depth < 0) return;
    // §M5's gate: the camera inherits the velocity. Local frame, as `ascent.js`
    // requires — the walker's axes have +y up at the landing site by
    // construction, and `_landingDir` is that site's normal in *planet* space.
    this.app._ascentHandoff = handoff(this.vel, [0, 1, 0]);
    this.launch = null;
    this.app.popTo(depth);
  }

  /** advance the materialisation; call once per frame from `update()` */
  _updateConjure(dt) {
    const c = this.conjure;
    if (!c || !this.conjureGrp || c.phase === 'idle' || c.phase === 'refused') return;
    c.update(dt);
    const poses = c.poses();
    const kids = this.conjureGrp.children;
    for (let i = 0; i < kids.length && i < poses.length; i++) {
      const m = kids[i], p = m.userData.part, o = poses[i];
      m.position.set(p.x + o.dx, p.y + o.dy, p.z + o.dz);
      m.rotation.set(
        (p.flip ? Math.PI : 0) + o.rx,
        (p.ry ?? 0) + o.ry,
        o.rz);
      m.material.opacity = o.opacity;
      // the seam glows as it closes — the one part of this that is not a
      // rigid-body motion, and the reason it reads as conjuring rather than as
      // a crate being assembled
      m.material.emissive?.setRGB(o.glow * 0.9, o.glow * 0.75, o.glow * 0.45);
    }
  }

  // ------------------------------------------------------------- loop ----
  update(dt) {
    if (this.playing) this.sunPhase += this.dayRate * dt * this.speed;
    this.uTime.value += dt;

    // sun path: tilted circle, so it rises and sets off-axis
    const ph = this.sunPhase;
    this._sunDirAt(ph, this.uSunDir.value);
    if (this.uSunPosFar) this.uSunPosFar.value.copy(this.uSunDir.value).multiplyScalar(1e7);
    if (this.giant) this.giant.rotation.y += dt * 0.004; // the giant's own slow day
    if (this.skyMoons) {
      const dir = new THREE.Vector3();
      for (const m of this.skyMoons) {
        this._sunDirAt(ph + m.off, dir);
        dir.y += m.tilt;
        m.mesh.position.copy(dir.normalize()).multiplyScalar(m.dist);
      }
    }
    if (this.skyComet) {
      const c = this.skyComet;
      const head = this._sunDirAt(ph + c.off, new THREE.Vector3());
      head.y += c.tilt;
      head.normalize();
      // tangent on the sky sphere pointing away from the sun
      const t = head.clone().sub(this.uSunDir.value);
      t.addScaledVector(head, -t.dot(head));
      if (t.lengthSq() > 1e-6) {
        t.normalize();
        const bi = new THREE.Vector3().crossVectors(head, t);
        const m = new THREE.Matrix4().makeBasis(t, bi, head);
        c.tail.quaternion.setFromRotationMatrix(m);
      }
      const night = 1 - Math.min(Math.max((this.uSunDir.value.y + 0.1) * 3, 0), 1) * 0.7;
      c.coma.position.copy(head).multiplyScalar(14600);
      c.coma.material.opacity = night;
      c.tail.position.copy(c.coma.position);
      c.tail.scale.set(3200 + 4200 * c.activity, 800 + 900 * c.activity, 1);
      c.tail.material.opacity = night * (0.35 + 0.65 * c.activity);
    }
    if (this.siblings) {
      const night = 1 - Math.min(Math.max((this.uSunDir.value.y + 0.1) * 3, 0), 1) * 0.75;
      const dir = new THREE.Vector3();
      for (const s of this.siblings) {
        this._sunDirAt(ph + s.off, dir);
        dir.y += s.tilt;
        s.sp.position.copy(dir.normalize()).multiplyScalar(15500);
        s.sp.material.opacity = night;
      }
    }
    if (this.dirLight) {
      this.dirLight.position.copy(this.uSunDir.value).multiplyScalar(100);
      const day = Math.max(this.uSunDir.value.y, 0);
      this.dirLight.intensity = 2.2 * Math.min(day * 4, 1);
      this.dirLight.color.copy(this.uSunColor.value);
    }
    if (this.cityGlows) {
      const night = 1 - Math.min(Math.max((this.uSunDir.value.y + 0.15) * 4, 0), 1);
      for (const g of this.cityGlows) g.material.opacity = night * 0.5;
    }

    // the sky lives: magic hour bleeding into the fog, cumulus on the wind,
    // and when the dark comes, the stars come out in color
    const elev = this.uSunDir.value.y;
    const dusk = Math.max(1 - Math.abs(elev - 0.02) * 5.5, 0) * this.atmo;
    this.horizonColor.copy(this._horizonBase).lerp(this._gold, dusk * 0.75);
    this.zenithColor.copy(this._zenithBase).lerp(this._duskZenith, dusk * 0.55);
    if (this.skyDome || this.cumulus) {
      const elevDeg = (Math.asin(Math.min(Math.max(elev, -1), 1)) * 180) / Math.PI;
      // One wind, one drift, one clock — shared by the deck and the cirrus, so
      // the two halves of the sky cannot disagree about the weather (§6 M3's
      // whole point: everything that moves samples the one field). `_cw` is
      // already computed once a frame for the grass, so the deck's wind costs
      // nothing extra; `cloudWind()` is the fallback for the pre-M3 path.
      const cw = this._cw || this.cloudWind();
      this._cloudDrift = this._cloudDrift || { x: 0, y: 0 };
      this._cloudDrift.x += cw.x * dt;
      this._cloudDrift.y += cw.z * dt;
      if (this.skyDome) {
        this.skyDome.update(elevDeg, {
          cirrusDrift: this._cloudDrift,
          cirrusDir: { x: cw.x, y: cw.z },
        });
      }
      if (this.cumulus) {
        this.cumulus.update(elevDeg, this._cloudDrift);
        if (this._uCamPos) this._uCamPos.value.copy(this.camera.position);
      }
    }
    if (this.clouds) {
      const day = Math.min(Math.max((elev + 0.15) * 3.2, 0), 1);
      for (let ci = 0; ci < this.clouds.length; ci++) {
        const c = this.clouds[ci];
        // §6 M3 · the deck rides the same field the grass does, veered and
        // sped up by the Ekman spiral rather than by a random scalar
        if (this.windSys) {
          const cw = this._cw || (this._cw = { x: 0, z: 0 });
          c.position.x += cw.x * dt;
          c.position.z += cw.z * dt;
        } else {
          c.position.x += this._cloudWind * dt;
        }
        if (c.position.x > 4600) c.position.x -= 9200;
        if (c.position.x < -4600) c.position.x += 9200;
        c.material.color.setRGB(0.2 + day * 0.85, 0.2 + day * 0.85, 0.24 + day * 0.88)
          .lerp(this._gold, dusk * 0.55);
        c.material.opacity = (ci === 0 ? 0.5 : 0.38) * (0.35 + 0.65 * Math.max(day, 0.15));
      }
    }
    if (this.nightStars) {
      this._starDark.value = Math.max(1 - Math.max(elev + 0.08, 0) * 4 * this.atmo, 0);
      const sh = this._shoot;
      if (sh.t < 0) {
        sh.next -= dt;
        if (sh.next <= 0 && this._starDark.value > 0.5) {
          sh.t = 0;
          const az = arand() * Math.PI * 2, el = 0.35 + arand() * 0.75;
          sh.from.setFromSphericalCoords(9000, Math.PI / 2 - el, az);
          sh.dirV.set(arand() - 0.5, -0.25 - arand() * 0.3, arand() - 0.5)
            .normalize().multiplyScalar(6500);
          sh.sp.material.rotation = Math.atan2(-sh.dirV.y, Math.hypot(sh.dirV.x, sh.dirV.z));
          sh.next = 5 + arand() * 14;
        }
      } else {
        sh.t += dt;
        const u = sh.t / 0.8;
        if (u >= 1) { sh.t = -1; sh.sp.material.opacity = 0; }
        else {
          sh.sp.position.copy(sh.from).addScaledVector(sh.dirV, u);
          sh.sp.material.opacity = Math.sin(u * Math.PI) * this._starDark.value;
        }
      }
    }
    if (this.life) this.life.update(dt, this.uSunDir.value.y);
    if (this.settlement) this.settlement.update(dt, this.uSunDir.value.y);
    if (this.ships) this.ships.update(dt, this.uSunDir.value.y);
    if (this.grassField) this.grassField.update(dt, this.uSunDir.value.y);
    if (this.ruins) this.ruins.update(dt, this.uSunDir.value.y);
    if (this.wildlife) this.wildlife.update(dt, this.uSunDir.value.y);
    if (this.constellations) this.constellations.update(dt, this.uSunDir.value.y);
    if (this.caravan) this.caravan.update(dt, this.uSunDir.value.y);
    if (this.weather) this.weather.update(dt, this.uSunDir.value.y);
    if (this.megafauna) this.megafauna.update(dt, this.uSunDir.value.y);
    this._syncPaintLight();
    this._syncAerial();
    // Every half second rather than every frame, and not as thrift: systems
    // build themselves late — the festival lanterns arrive at dusk, weather
    // when it turns — so this is a sweep for anything new, and the guard in
    // `applyAerial` makes re-running it free.
    if ((this._airTick = (this._airTick ?? 0) + 1) % 30 === 0) this._dressAerial();
    if (this.aurora) {
      this.aurora.update(this.uTime.value, this.uSunDir.value.y, STORM_AT);
      const a = this.aurora.illumination();
      // The tint leaves `illumination()` normalised to unit *luminance*, which
      // puts its brightest channel above 1. A three light multiplies colour by
      // intensity, so passing it straight through counts the brightness twice.
      // Renormalise to peak 1 and let intensity carry it alone.
      const peak = Math.max(...a.rgb, 1e-6);
      this.auroraLight.color.setRGB(a.rgb[0] / peak, a.rgb[1] / peak, a.rgb[2] / peak);
      // A hemisphere light delivers roughly intensity x luminance(colour) to an
      // up-facing surface; the tint is peak-normalised so its luminance is
      // about 0.85. 0.09 x 0.85 = 0.077, against the night ambient's 0.066.
      this.auroraLight.intensity = Math.min(a.moons, 1.4) * 0.09;
    }
    this._syncMaterial();
    if (this.sunShadow) {
      this.sunShadow.update(this.app.renderer, this.scene, this.camera,
        this.uSunDir.value, (x, z) => this.heightAt(x, z));
    }
    if (this.windField) {
      // the reference's interleave: one auxiliary pass a frame rather than all
      // of them every frame, since the eye cannot follow a gust at 60 Hz any
      // better than at 20
      this.windField.update(this.uTime.value, this.body.x, this.body.z);
      // one frustum, built once, shared by every ring — four rings each
      // deriving the same six planes would be the same arithmetic four times
      this._pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._pm);
      let blades = 0, drawn = 0;
      // one evaluation of the deck's wind a frame, shared by every cloud
      this._cw = this.cloudWind();
      const dusk = Math.min(Math.max((this.uSunDir.value.y + 0.12) / 0.24, 0), 1);
      // §6 M3's last gate clause, driven by §6 M4's single gait clock: one
      // phase already runs the head bob and the footstep audio, so the grass
      // the walker parts cannot drift out of sync with either — there is only
      // one of them. A footfall pushes harder than the swing between, which is
      // the difference between walking through grass and dragging a circle
      // through it.
      const w = this.walker;
      const foot = w ? 0.62 + 0.38 * Math.abs(Math.cos(w.stepPhase * Math.PI)) : 1;
      const hv = M5 ? this.traveler?.hover : null;
      const riding = !!this.traveler?.riding;
      // §6 M5 · the craft parts the grass too, and it is the same function at a
      // wider radius rather than a second one. What differs is the *cause*: a
      // walker's push comes off the gait clock, a skiff's off its skirt — so it
      // is steady where a footfall is periodic, and it fades as the craft rises
      // out of ground effect, because a hovercraft two body-lengths up is not
      // touching the meadow at all.
      let walker;
      if (riding && hv) {
        const ride = Math.max(hv.pos.y - this.heightAt(hv.pos.x, hv.pos.z), 0);
        const effect = Math.max(0, 1 - ride / (HOVER.ride * 2.2));
        walker = {
          x: hv.pos.x,
          y: hv.pos.y - HOVER.ride,
          z: hv.pos.z,
          radius: 4.2,
          push: 0.95 * effect * Math.min(1, hv.speed() / 12 + 0.45),
        };
      } else {
        walker = {
          x: this.body.x,
          y: this.body.y - EYE,
          z: this.body.z,
          radius: PART_RADIUS,
          // nothing to part while flying, and nothing to part while still
          push: (this.fly || riding) ? 0
            : 0.75 * foot * Math.min(1, Math.hypot(this.vel?.x ?? 0, this.vel?.z ?? 0) / 1.5 + 0.35),
        };
      }
      for (const ring of this.meadow) {
        ring.update(this.body.x, this.body.z, this.body.y, this.uTime.value,
          this._frustum, dusk, walker);
        blades += ring.blades;
        drawn += ring.drawn;
      }
      this._bladeCount = blades;
      this._grassDraws = drawn;
    }
    if (this.godrays) this.godrays.update(dt);
    // after whatever moved `this.body`, so a craft conjured this frame is
    // placed against the position the walker actually ended on
    if (this.conjure) this._updateConjure(dt);
    if (this.rivers) this.rivers.update(dt);
    if (this.festival) this.festival.update(dt, this.uSunDir.value.y);
    if (this.herds) this.herds.update(dt, this.uSunDir.value.y);
    // the score breathes with the light: it peaks as the sun rides low and
    // gold, thins at high noon and deep night, and hushes near a monument
    if (this.app.audio?.surfaceScore) {
      const e = this.uSunDir.value.y;
      const swell = Math.max(0, 1 - Math.abs(e - 0.08) * 4.5) * this.atmo;
      this.app.audio.surfaceSwell(swell, this.ruins?.hush ?? 0);
    }

    // movement (skip while the hyperzoom still owns the camera)
    if (this.controls.enabled) {
      if (!this._hadCtl) {
        // the zoom just handed us the camera: the body picks up where it landed
        this._hadCtl = true;
        if (!this.traveler?.third) this.body.copy(this.camera.position);
        if (this.traveler) this.traveler._camSet = false;
      }
      if (this.launch) {
        this._updateLaunch(dt);
      } else if (this.traveler?.riding) {
        this.traveler.drive(dt);
      } else if (M4) {
        this._stepBody(dt);
      } else {
        const view = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
        const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 60 : 16) * (this.fly ? 3 : 1);
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(view);
        if (!this.fly) { fwd.y = 0; fwd.normalize(); }
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(view);
        const acc = new THREE.Vector3();
        if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) acc.add(fwd);
        if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) acc.sub(fwd);
        if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) acc.add(right);
        if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) acc.sub(right);
        if (acc.lengthSq() > 0) acc.normalize().multiplyScalar(speed);
        this.vel.lerp(acc, 1 - Math.exp(-6 * dt));
        this.body.addScaledVector(this.vel, dt);
        if (this.inside) {
          // stone walls hold you; the floor is the shrine's, not the land's
          const c = this.interior.bounds.clamp(this.body.x, this.body.z);
          this.body.x = c.x; this.body.z = c.z;
          this.body.y += (this.interior.floorY + EYE - this.body.y) * (1 - Math.exp(-12 * dt));
        } else {
          const ground = Math.max(this.heightAt(this.body.x, this.body.z),
            this.seaLevel === null ? -1e9 : this.seaLevel) + EYE;
          if (this.fly) this.body.y = Math.max(this.body.y, ground);
          else this.body.y += (ground - this.body.y) * (1 - Math.exp(-12 * dt));
        }
      }

      // stay inside the tile (the interior keeps its own bounds). A launch is
      // exempt: the clamp is for a body that would walk off a 1400 m mesh, and
      // a vehicle that has already left it vertically is the scale above's.
      if (!this.inside && !this.launch) {
        this.body.x = Math.min(Math.max(this.body.x, -EXT * 0.48), EXT * 0.48);
        this.body.z = Math.min(Math.max(this.body.z, -EXT * 0.48), EXT * 0.48);
        // and the craft owns the clamp too, or the body stops at the edge while
        // the hover integrates on past it and the skiff flies out from under you
        const hv = this.traveler?.hover;
        if (hv && this.traveler.riding) {
          if (hv.pos.x !== this.body.x) { hv.pos.x = this.body.x; hv.vel.x = 0; }
          if (hv.pos.z !== this.body.z) { hv.pos.z = this.body.z; hv.vel.z = 0; }
        }
      }
      if (M4 && !this.traveler?.riding && !this.launch) {
        // the body owns the tile clamp too, so the two cannot disagree
        this.walker.pos.x = this.body.x;
        this.walker.pos.z = this.body.z;
      }
      this._climbCheck(dt);
      this._foldCheck();
      this._doorCheck(dt);
      // The rig places the camera in M4; `traveler.place` still runs so the
      // avatar mesh keeps following, but it is told not to touch the camera.
      if (M4 && !this.traveler?.riding) {
        this.traveler.place(dt, null);
        this.rig.place(dt);
        // §M5's handover runs after the rig, for the same reason it runs after
        // the traveler's own arm: it closes a gap, it does not own a camera.
        this.traveler.applyMount?.(dt, this.camera);
      } else {
        this.traveler.place(dt, this.camera);
      }
    } else this._hadCtl = false;
    if (this.flare) this.flare.update(this.camera);
    if (this.interior) this.interior.update(dt, this.uSunDir.value.y, this.inside);
  }

  /** cross the threshold: walk into the shrine's door, or back out of it */
  /**
   * Does this world have a fold in it, and where?
   *
   * Called once, at construction. A world is thin when its star seed shares
   * enough high bits with another for the generator to be unable to tell them
   * apart (`src/liminal.js` §2), and roughly one world in twenty-six is —
   * which is the birthday problem, not a setting.
   */
  _findFold() {
    // The surface's own context carries the *system* and the host index, not
    // the seeds that addressed it — so ask the scales it is standing on. That
    // is not a workaround: the galaxy knows its seed and the system knows its
    // star, and re-deriving either here would be a second opinion about an
    // address, which is the one thing this whole feature cannot afford.
    let galaxySeed = null, starSeed = this.ctx?.system?.seed;
    for (const sc of this.app?.stack ?? []) {
      if (Number.isFinite(sc?.ctx?.galaxySeed)) galaxySeed = sc.ctx.galaxySeed;
      if (Number.isFinite(sc?.ctx?.starSeed)) starSeed = sc.ctx.starSeed;
    }
    if (!Number.isFinite(galaxySeed)) galaxySeed = hash(this.app?.seed ?? 0, 0xbe0) >>> 0;
    if (!Number.isFinite(starSeed)) return;
    // the index this star sits at is what `isThin` needs; the scale carries the
    // seed rather than the index, so recover it from the generator's own map
    let index = -1;
    for (let i = 0; i < 4096; i++) {
      if ((hash(galaxySeed >>> 0, i, 0x57a9) >>> 0) === (starSeed >>> 0)) { index = i; break; }
    }
    if (index < 0) return;
    const t = isThin(galaxySeed >>> 0, index, 4096);
    if (!t.thin) return;
    const addr = roomAddress(t.seed, t.neighbourSeed);
    const pt = thinPoint(addr, EXT, t.depth);
    this._fold = { ...pt, addr, galaxySeed: galaxySeed >>> 0 };
    console.info(`[noclip] this world is thin — ${(pt.radius).toFixed(1)} m fold at`
      + ` ${pt.x.toFixed(0)}, ${pt.z.toFixed(0)} · opens on room ${addr.prefix.toString(16)}.${addr.depth}`);
  }

  /**
   * Walk into the fold and the floor is not there.
   *
   * No prompt, no marker, no key. §4 forbids a game loop and a "press E to
   * noclip" would be one; the fold is a place, and places do not ask. What it
   * does instead is what a floor that is not there does: you are in the room.
   */
  _foldCheck() {
    if (!this._fold || this._used || !this.walker || this.inside) return;
    const f = this._fold;
    if (Math.hypot(this.walker.pos.x - f.x, this.walker.pos.z - f.z) > f.radius) return;
    this._used = true;
    this.app.enterRoom?.(f.galaxySeed, f.addr);
  }

  /**
   * `?climb=1` — has the ground let go?
   *
   * Everything that decides is in `src/ascent.js` and under test; what is here
   * is the three numbers it needs and the one call it earns. `popTo` is the
   * *existing* seamless single-level ascend — the one Escape already runs — so
   * this adds no transition, no second code path and no new kind of location
   * (§2.4). It changes who asks for it.
   */
  _climbCheck(dt) {
    if (!CLIMB || !this.walker || this.inside || this.traveler?.riding) return;
    const w = this.walker;
    const alt = w.pos.y - this.heightAt(w.pos.x, w.pos.z);
    this._ascent = stepAscent(this._ascent, {
      alt, climb: w.vel.y, release: this._releaseAlt, dt,
      // The clause the suite had to teach me: a 400 m leap on Luna sustains a
      // climb for twenty-two seconds, so duration cannot separate a jump from
      // a departure. Thrust can, and the controller already knows.
      powered: this.fly,
    });
    this._climbFrac = ascentFraction(this._ascent, { alt, climb: w.vel.y, release: this._releaseAlt });
    if (!this._ascent.released) return;
    // §M5's gate: the camera inherits the velocity.
    //
    // The `up` here is **local**, not `_landingDir`. That distinction cost a
    // wrong number and the number is the only reason it was noticed: a purely
    // vertical 60 m/s climb came out as 6.7 m/s of climb, because the walker's
    // velocity is in the surface scale's own axes — where +y is up at the
    // landing site by construction — and `_landingDir` is that site's normal in
    // *planet* space. Dotting one against the other is a frame error that
    // returns a plausible number for every world and the right one for none.
    //
    // What comes out of this is therefore in the site's local frame. Rotating
    // it into planet space needs the full basis rather than the normal alone,
    // and it belongs to whichever scale consumes it — which is why this hands
    // over a labelled decomposition instead of a bare vector.
    this.app._ascentHandoff = handoff(w.vel, [0, 1, 0]);
    this.app.popTo(this.app.stack.length - 2);
  }

  _doorCheck(dt) {
    if (!this.interior) return;
    this._doorCool = Math.max(0, this._doorCool - dt);
    // ...and a body that is crouching to launch, or already 300 m up, is not
    // walking through the shrine door either
    if (this._doorCool > 0 || this.fly || this.traveler?.riding) { this._nearDoor = false; return; }
    const atDoor = Math.hypot(this.body.x - this.interior.doorThresh.x, this.body.z - this.interior.doorThresh.z) < 4.5;
    this._nearDoor = atDoor && !this.inside;
    if (atDoor && !this._warping2) this._crossThreshold(!this.inside);
  }

  _crossThreshold(entering) {
    this._warping2 = true;
    this.app.hud.warp(() => {
      this.inside = entering;
      const to = entering ? this.interior.inPlace : this.interior.outPlace;
      this.body.set(to.x, (entering ? this.interior.floorY : this.heightAt(to.x, to.z)) + EYE, to.z);
      this.vel.set(0, 0, 0);
      this._doorCool = 1.6;
      this._warping2 = false;
      this.app.hud.setHint(entering
        ? 'inside the shrine · walk to the door or press esc to leave'
        : 'the country again · the shrine keeps its flame');
    });
  }

  /** Escape while inside leaves the shrine instead of the world */
  exitInterior() {
    if (!this.inside || this._warping2) return false;
    this._crossThreshold(false);
    return true;
  }

  togglePlay() { this.playing = !this.playing; }
  speedUp() { this.speed = Math.min(this.speed * 1.7, 30); }
  slowDown() { this.speed = Math.max(this.speed / 1.7, 0.1); }
  timeReadout() {
    const elev = Math.asin(this.uSunDir.value.y) * 57.29;
    return `sun ${elev >= 0 ? '+' : ''}${elev.toFixed(0)}° · day ×${this.speed.toFixed(1)}`;
  }

  hudStats() {
    const pp = this.pp;
    const g = pp.massE / (pp.radiusE * pp.radiusE);
    return [
      ['world', pp.name],
      ['class', pp.type + (pp.inhabited ? ' · inhabited' : '')],
      ...(this.settlement ? [['settlement', this.settlement.name + ({
        port: ' · port city', monument: ' · old capital', spaceport: ' · spaceport',
      }[this.settlement.archetype] ?? '')]] : []),
      ['biosphere', this.life ? 'flora + fauna' : '—'],
      ...(pp.res?.line ? [['mood', pp.res.line]] : []),
      ['craters', this.impacts.length ? String(this.impacts.length) : '—'],
      ['surface gravity', g.toFixed(2) + ' g'],
      ['equilibrium temp', pp.Teq + ' K'],
      ['mode', this.traveler?.riding ? 'hover-skiff (e steps off)'
        : this.fly ? 'flight (f to walk)' : 'on foot (f to fly)'],
      ['view', this.traveler?.third ? 'third person (c)' : 'first person (c)'],
    ];
  }

  /** the hyperzoom lands us from high in the sky — a real descent */
  arriveFrom(rest) {
    return rest.clone().add(new THREE.Vector3(-140, 950, 430));
  }

  pick() { return null; }
  enter() { this.controls.enabled = true; }
  exit() {
    this.controls.enabled = false;
    this.app.hud.showDiscovery(null);
    this.app.audio?.surfaceScoreOff?.();
  }

  resume() {
    this.controls.enabled = true;
    this.app.audio?.surfaceScore?.(this._scoreRoot);
  }

  dispose() {
    this.ruins?.dispose?.();
    this.app.audio?.surfaceScoreOff?.();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

export const SURFACE_NOTE = `Boots on regolith. The terrain is the same noise field that painted this world from orbit; the sun overhead is the system's actual star — its color is its blackbody temperature and its apparent size follows from this orbit's true semi-major axis. Surface gravity in the readout is GM/R² from the world's real mass and radius. Walk with <em>WASD</em>, drag to look, <em>F</em> to fly, <em>C</em> to step outside yourself, and let the day run: on inhabited worlds, the lanterns rise with the dark.`;
