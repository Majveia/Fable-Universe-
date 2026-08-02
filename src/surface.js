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
import { solveLandingSite } from './landing.js';
import { PAINT_GLSL, lightFor } from './paint.js';
import { AERIAL_GLSL, aerialUniforms, airFor, airPalette, syncAerialPalette } from './aerial.js';
import { makeGround } from './ground.js';
import { SHADOW_GLSL, SunShadow, markCaster } from './shadow.js';
import { makeWind } from './wind.js';
import { WindField } from './windfield.js';
import { qInt } from './quality.js';

const PARAM = (k) => {
  try { return new URL(window.location.href).searchParams.get(k); }
  catch { return null; }
};

/** M2 — the print and the rebuilt bloom. Default-off (§7.4). */
const M2 = PARAM('m2') === '1';

/**
 * M3 — one wind field, sampled by everything. Default-off (§7.4), and the
 * rollback docs/plans/M3.md §8 names: off restores the constant vector exactly,
 * because no consumer is converted until the field it reads is green.
 */
const WIND = PARAM('wind') === '1';

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
const PAINT = PARAM('paint') === '1' || (M2 && PARAM('paint') !== '0');

/**
 * §9.3's aerial perspective, act 2. Separable in both directions like `paint`,
 * and for a sharper reason than symmetry: it is the one change that writes the
 * *alpha* channel, so `?m2=1&aerial=0` is the build that isolates whether a
 * defect in the print came from the grade or from the distance it was handed.
 */
const AERIAL = PARAM('aerial') === '1' || (M2 && PARAM('aerial') !== '0');

/** `?shdebug=1` — output the shadow term itself, so it can be looked at */
const SHADOW_DEBUG = PAINT && (PARAM('shdebug') === '1' || PARAM('shdebug') === '2');

/**
 * `?airdebug=1` — the fog fraction as greyscale, from the surfaces that compute
 * it. It answers "is the depth cue shaped right", which is the question a still
 * cannot answer once the fog has been mixed into a colour.
 *
 * It does **not** answer §16.6's audit question — whether anything drawn
 * *without* `aerial()` corrupts the alpha channel — because a material that
 * writes garbage into alpha does not have this flag. That one is answered from
 * outside, by reading the composited render target back; see
 * `tools/alphaudit.js`.
 */
const AIR_DEBUG = AERIAL && PARAM('airdebug') === '1';

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
    sf.shade = mix(col * 0.55, uPaintShadowTint * dot(col, vec3(0.33)), 0.28);
    sf.mid   = col;
    sf.lit   = mix(col * 1.22, uPaintSun * dot(col, vec3(0.42)), 0.20);
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

    ${AERIAL ? /* glsl */`
    // §9.3 · aerial perspective. Not one colour and not one exponent: the air
    // is warm toward the sun and cool away from it, it thins with altitude, and
    // mist pools where a valley floor is far enough away to have air over it.
    //
    // The fog fraction goes into **alpha**, which is the whole trick — it is how
    // the post chain learns each pixel's distance, and it is what §9.4 step 5
    // spends on distance-graded watercolour softening.
    vec4 air = aerial(lit, vW, uCam, uSunDir, vW.y - uAirBase);
    gl_FragColor = air;
    ${AIR_DEBUG ? 'gl_FragColor = vec4(vec3(air.a), 1.0);' : ''}
    ` : /* glsl */`
    // aerial perspective
    float dist = length(vW - uCam);
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

    // §16.6's audit, decided rather than inherited: the sky writes **alpha 1**,
    // maximally distant. Two reasons, and the second is the one that matters.
    // A painted sky is the furthest thing in frame, so it should take the full
    // wet-in-wet softening — that is how a watercolour wash behaves. And the
    // far terrain asymptotes to fog 1 at the horizon; if the sky wrote 0 there
    // would be a step discontinuity in the post chain's idea of distance
    // exactly along the horizon line, which is the most looked-at edge in the
    // frame. It was already 1.0 by accident. Now it is 1.0 on purpose.
    gl_FragColor = vec4(sky + sun + stars, 1.0);
  }
`;

const OCEAN_VERT = /* glsl */`
  uniform float uTime;
  uniform vec2 uWind;
  varying vec3 vW;
  varying vec3 vN;

  // two long swells travel with the wind; the mesh actually heaves
  float swell(vec2 p, float t) {
    return sin(dot(p, uWind) * 0.015 - t * 0.7) * 0.55
         + sin(dot(p, vec2(-uWind.y, uWind.x)) * 0.021 + t * 0.53) * 0.34;
  }

  void main() {
    vec3 w = (modelMatrix * vec4(position, 1.0)).xyz;
    float h = swell(w.xz, uTime);
    w.y += h;
    float e = 2.0;
    float hx = swell(w.xz + vec2(e, 0.0), uTime) - h;
    float hz = swell(w.xz + vec2(0.0, e), uTime) - h;
    vN = normalize(vec3(-hx / e, 1.0, -hz / e));
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
  varying vec3 vW;
  varying vec3 vN;
  ${NOISE_GLSL}
  ${AERIAL ? AERIAL_GLSL : ''}

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
    float fres = pow(1.0 - max(dot(view, n), 0.0), 3.0);
    float day = smoothstep(-0.15, 0.25, uSunDir.y);
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

    ${AERIAL ? /* glsl */`
    vec4 air = aerial(col, vW, uCam, uSunDir, vW.y - uAirBase);
    gl_FragColor = air;
    ${AIR_DEBUG ? 'gl_FragColor = vec4(vec3(air.a), 1.0);' : ''}
    ` : /* glsl */`
    float dist = length(vW - uCam);
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
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 30000);

    this.playing = true;
    this.speed = 1;
    // start mid-morning golden light
    this.sunPhase = 0.32;
    this.dayRate = (2 * Math.PI) / 420; // one local day ≈ 7 real minutes

    this.yaw = 0; this.pitch = -0.04;
    this.fly = false;
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
    // ...except that it is one *constant vector*, which docs/plans/M3.md §1
    // measures as the whole diagnosis: one direction, one strength, everywhere,
    // for the whole of time. §M3's field replaces it, behind `?wind=1` (§7.4),
    // and takes the same direction so the flag changes the wind's *behaviour*
    // and not the world's prevailing bearing.
    //
    // `meanDirDeg` is where the air comes *from*, the convention every weather
    // report uses and the opposite of `this.wind`, so the conversion is here
    // and stated rather than inlined.
    if (WIND) {
      // fwd = (cos a, sin a) and meanFlow builds fwd = (-sin dir, -cos dir),
      // so dir = atan2(-cos a, -sin a). Worth the two lines: a sign slip here
      // is invisible in a still and wrong in every frame.
      const fromDeg = (Math.atan2(-Math.cos(windAng), -Math.sin(windAng)) * 180) / Math.PI;
      const wr = new RNG(hash(pp.seed, 0x817e));
      this.air = makeWind(pp.seed, {
        // thicker air carries more of it; an airless world gets a token breeze
        // that nothing will sample, rather than a special case
        meanSpeed: 2.4 + 4.4 * atmoStrength * wr.float(0.55, 1.35),
        meanDirDeg: fromDeg,
        gustiness: wr.float(0.7, 1.35),
      });
      this.windField = new WindField(this.air);
    }
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
    this.settlement = addCivilization(this);
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
    this.grassField = addGrass(this);
    this.ruins = addRuins(this);
    this.wildlife = addWildlife(this);
    this.constellations = addConstellations(this);
    this.caravan = addCaravan(this);
    this.megafauna = addMegafauna(this);
    this.rivers = addRivers(this);
    this.interior = addInterior(this);
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
    this.controls = { // duck-typed for the hyperzoom
      enabled: false,
      target: new THREE.Vector3(spawn.x + 60, spawn.y + 4, spawn.z - 40),
      update: () => {},
    };
    this.camera.lookAt(this.controls.target);
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
    // quantised: this is re-derived every frame from the update loop (§5)
    const L = lightFor(T, Math.max(elev, 0.5), true);
    const v = (c) => ({ value: new THREE.Vector3(c[0], c[1], c[2]) });
    this._paintLight = { T, uniforms: { sun: v(L.sun), sky: v(L.ambSky), gnd: v(L.ambGnd), sh: v(L.shadowTint) } };
    return {
      uPaintSun: this._paintLight.uniforms.sun,
      uPaintAmbSky: this._paintLight.uniforms.sky,
      uPaintAmbGnd: this._paintLight.uniforms.gnd,
      uPaintShadowTint: this._paintLight.uniforms.sh,
      ...this.sunShadow.uniforms,
    };
  }

  /** the sun climbs, so the beam it sends reddens less — re-derive as it moves */
  _syncPaintLight() {
    if (!PAINT || !this._paintLight) return;
    const elev = (Math.asin(Math.min(Math.max(this.uSunDir.value.y, -1), 1)) * 180) / Math.PI;
    const L = lightFor(this._paintLight.T, Math.max(elev, 0.5), true);
    const u = this._paintLight.uniforms;
    u.sun.value.set(...L.sun);
    u.sky.value.set(...L.ambSky);
    u.gnd.value.set(...L.ambGnd);
    u.sh.value.set(...L.shadowTint);
  }

  /**
   * §9.3's air, as the two normalising numbers and four colours `aerial.js`
   * asks for. Everything here is the world's own: the atmosphere strength it
   * was generated with, its surface gravity and equilibrium temperature, and
   * the star it orbits.
   */
  _aerialUniforms() {
    const pp = this.pp;
    this._airT = this.ctx.system?.temp ?? 5778;
    this._air = airFor(pp, {
      atmo: this.atmo,
      hazeX: pp.res?.hazeX ?? 1,
      // §9.3 measures height from the valley floor. `seaLevel` is null on a dry
      // world, where the heightfield's own datum is zero — and a world whose
      // terrain sat at y = +400 would otherwise never pool any mist at all.
      base: this.seaLevel ?? 0,
    });
    this._airU = aerialUniforms(THREE.Vector3, this._air, this._airPalette());
    return this._airU;
  }

  /**
   * The air's colour for the sun where it is now, dimmed by how much of the sun
   * is above the horizon.
   *
   * The dimming is not a fade — it is the physics. Extinction does not care
   * whether it is night: the air is just as thick and occludes just as much, so
   * the fog *fraction* is untouched. What goes to zero after dark is
   * **in-scattering**, because there is no beam left to scatter. So night dims
   * the four colours and leaves alpha alone, which is strictly more correct
   * than the single `uHorizon * max(dusk, 0.08)` this replaces — and it falls
   * out of §9.3's split between the fraction and the colour rather than being
   * bolted onto it.
   *
   * The floor is not zero because a night sky is not black: stars, moons,
   * airglow, and on an inhabited world the cities themselves.
   */
  _airPalette() {
    const y = Math.min(Math.max(this.uSunDir.value.y, -1), 1);
    const elev = (Math.asin(y) * 180) / Math.PI;
    const p = airPalette(this._airT, Math.max(elev, 0.5), true);
    const t = Math.min(Math.max((y + 0.12) / 0.24, 0), 1);
    const night = Math.max(t * t * (3 - 2 * t), 0.06);
    const dim = (c) => [c[0] * night, c[1] * night, c[2] * night];
    return { haze: dim(p.haze), mist: dim(p.mist), horizonSun: dim(p.horizonSun), anti: dim(p.anti) };
  }

  _syncAerial() {
    if (!AERIAL || !this._airU) return;
    syncAerialPalette(this._airU, this._airPalette());
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
    const layers = [
      { size: 520, count: 9, o: 0.5 },
      { size: 300, count: 14, o: 0.38 },
    ];
    this.clouds = [];
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
    // enough vertices that the swell can actually lift them
    const geo = new THREE.PlaneGeometry(EXT * 24, EXT * 24, 140, 140);
    geo.rotateX(-Math.PI / 2);
    this.ocean = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: this.uSunDir, uSunColor: this.uSunColor,
        // the same uniform objects the terrain holds, not a second set: one
        // definition of this world's air, so the shore cannot disagree with the
        // sea about how far away the horizon is
        ...(AERIAL ? this._airU : {}),
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
    this.yaw -= (e.clientX - this._drag.x) * 0.0035;
    this.pitch = Math.min(Math.max(this.pitch - (e.clientY - this._drag.y) * 0.0032, -1.45), 1.45);
    this._drag = { x: e.clientX, y: e.clientY };
  }

  _syncAngles() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(Math.min(Math.max(d.y, -1), 1));
  }

  onKey(code) {
    if (code === 'KeyF') { this.fly = !this.fly; return true; }
    if (code === 'KeyC') {
      const third = this.traveler.toggleView();
      this.app.hud.setHint(third
        ? 'third person · the traveler walks · c returns to their eyes'
        : 'first person · c steps back outside');
      return true;
    }
    if (code === 'KeyE') {
      const res = this.traveler.tryMount();
      if (res === 'mounted') this.app.hud.setHint('the skiff has you · wasd flies it · shift opens it up · e steps off');
      else if (res === 'dismounted') this.app.hud.setHint('on foot · e reboards the skiff · c for first person');
      else this.app.hud.setHint('the skiff waits near the plaza — walk to it and press e');
      return true;
    }
    return false;
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
    if (this.clouds) {
      const day = Math.min(Math.max((elev + 0.15) * 3.2, 0), 1);
      for (let ci = 0; ci < this.clouds.length; ci++) {
        const c = this.clouds[ci];
        c.position.x += this._cloudWind * dt;
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
    // before anything samples it, and before the shadow pass, so the two
    // render-target passes sit together rather than either side of the scene
    if (this.windField) {
      this.windField.update(this.app.renderer, this.uTime.value,
        this.camera.position.x, this.camera.position.z);
    }
    if (this.sunShadow) {
      this.sunShadow.update(this.app.renderer, this.scene, this.camera,
        this.uSunDir.value, (x, z) => this.heightAt(x, z));
    }
    if (this.godrays) this.godrays.update(dt);
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
      if (this.traveler?.riding) {
        this.traveler.drive(dt);
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

      // stay inside the tile (the interior keeps its own bounds)
      if (!this.inside) {
        this.body.x = Math.min(Math.max(this.body.x, -EXT * 0.48), EXT * 0.48);
        this.body.z = Math.min(Math.max(this.body.z, -EXT * 0.48), EXT * 0.48);
      }
      this._doorCheck(dt);
      this.traveler.place(dt, this.camera);
    } else this._hadCtl = false;
    if (this.flare) this.flare.update(this.camera);
    if (this.interior) this.interior.update(dt, this.uSunDir.value.y, this.inside);
  }

  /** cross the threshold: walk into the shrine's door, or back out of it */
  _doorCheck(dt) {
    if (!this.interior) return;
    this._doorCool = Math.max(0, this._doorCool - dt);
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
  exit() { this.controls.enabled = false; this.app.hud.showDiscovery(null); this.app.audio?.surfaceScoreOff?.(); }
  resume() { this.controls.enabled = true; this.app.audio?.surfaceScore?.(this._scoreRoot); }

  dispose() {
    this.ruins?.dispose?.();
    // its target and quad live outside `this.scene`, so the traverse below
    // cannot reach them
    this.windField?.dispose?.();
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
