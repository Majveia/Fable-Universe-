// SCALE 2.5 — THE PLANET, WHOLE.
//
// Between the clockwork of the system view and the boots of the surface
// walk sits this: the entire globe as a streaming quadtree. You fall from
// orbit and the ground resolves under you tile by tile, built in a worker
// pool from the same height field the orbital shader paints — the continent
// you aimed at is the continent that rises to meet you. Speed scales with
// altitude (thousands of km/s at apoapsis, a stroll near the deck), and
// when you level off low over the terrain, the walkable surface takes the
// handoff without a cut in place.
//
// The fragment shader below is the orbital planet shader's solid branch,
// nearly line for line. That is deliberate: parity is the feature.

import * as THREE from 'three';
import { QuadtreePlanet } from './quadtree.js';
import { NOISE_GLSL, makeCloudMaterial } from './planet.js';
import { makeGalaxySkyFromWithin, makeSkyDome } from './starfield.js';
import { softDotTexture } from './nebula.js';
import { hash, RNG } from './rng.js';
import { snoise } from './terrain.js';
import { addLife } from './life.js';
import { addSettlement } from './settlement.js';
import { buildScatterLUTs } from './scatterlut.js';
import { addOrbitals } from './orbital.js';
import { solveWatershed } from './hydrology.js';
import { CityField } from './city.js';
import { addAurora } from './aurora.js';

const TILE_VERT = /* glsl */`
  uniform vec3 uCenter;     // tile center, planet frame (static per tile)
  uniform float uSplitD;    // this depth's split distance
  uniform float uMorphOn;
  attribute vec3 aMorph;    // this vertex, as the parent grid renders it
  attribute vec3 aMorphN;
  varying vec3 vDir;        // planet-frame direction — the noise domain
  varying vec3 vN;
  varying vec3 vView;       // view-space position: precise near the camera
  void main() {
    // geomorph: children spawn wearing the parent's shape (m=1 at twice the
    // split distance, where the swap happens) and relax into their own
    // detail as the camera closes — LOD transitions carry zero pop
    float d0 = length((modelViewMatrix * vec4(position, 1.0)).xyz);
    float m = uMorphOn * clamp((d0 / uSplitD - 1.05) / 0.8, 0.0, 1.0);
    vec3 p = mix(position, aMorph, m);
    vDir = uCenter + p;
    vN = normalize(mix(normal, aMorphN, m));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const TILE_FRAG = /* glsl */`
  precision highp float;
  uniform int   uType;
  uniform float uSeed;
  uniform vec3  uSunDir;
  uniform float uTime;
  uniform float uOcean;
  uniform float uCity;
  uniform float uIceCap;
  uniform vec3  uColA;
  uniform vec3  uColB;
  uniform vec3  uColC;
  uniform vec3  uHaze;
  uniform float uHazeK;
  uniform float uHasSea;
  uniform float uHasHydro;
  uniform sampler2D uHydro;
  uniform float uHydroN;
  uniform float uWet;
  uniform float uWetMode;   // 0 rain-slick · 1 snow-dust
  uniform float uFlow;      // live discharge: rivers widen after rain
  varying vec3 vDir;
  varying vec3 vN;
  varying vec3 vView;
  ${NOISE_GLSL}

  // the watershed corridor atlas — same arithmetic as the JS sampler
  float hydroAt(vec3 p) {
    vec3 ap = abs(p);
    float f; vec3 fr; vec3 fu; vec3 fn;
    if (ap.x >= ap.y && ap.x >= ap.z) {
      if (p.x > 0.0) { f = 0.0; fr = vec3(0.0, 0.0, -1.0); fu = vec3(0.0, 1.0, 0.0); fn = vec3(1.0, 0.0, 0.0); }
      else { f = 1.0; fr = vec3(0.0, 0.0, 1.0); fu = vec3(0.0, 1.0, 0.0); fn = vec3(-1.0, 0.0, 0.0); }
    } else if (ap.y >= ap.x && ap.y >= ap.z) {
      if (p.y > 0.0) { f = 2.0; fr = vec3(1.0, 0.0, 0.0); fu = vec3(0.0, 0.0, -1.0); fn = vec3(0.0, 1.0, 0.0); }
      else { f = 3.0; fr = vec3(1.0, 0.0, 0.0); fu = vec3(0.0, 0.0, 1.0); fn = vec3(0.0, -1.0, 0.0); }
    } else {
      if (p.z > 0.0) { f = 4.0; fr = vec3(1.0, 0.0, 0.0); fu = vec3(0.0, 1.0, 0.0); fn = vec3(0.0, 0.0, 1.0); }
      else { f = 5.0; fr = vec3(-1.0, 0.0, 0.0); fu = vec3(0.0, 1.0, 0.0); fn = vec3(0.0, 0.0, -1.0); }
    }
    float dn = dot(p, fn);
    float a = dot(p, fr) / dn;
    float b = dot(p, fu) / dn;
    float col5 = mod(f, 3.0);
    float row = floor(f / 3.0);
    float x = clamp((a + 1.0) * 0.5 * uHydroN - 0.5, 0.51, uHydroN - 1.51) + col5 * uHydroN + 0.5;
    float y = clamp((b + 1.0) * 0.5 * uHydroN - 0.5, 0.51, uHydroN - 1.51) + row * uHydroN + 0.5;
    return texture2D(uHydro, vec2(x / (3.0 * uHydroN), y / (2.0 * uHydroN))).r;
  }

  void main() {
    vec3 n = normalize(vN);
    vec3 p = normalize(vDir);
    vec3 sunDir = normalize(uSunDir);
    vec3 viewDir = normalize(-vView);
    float dCam = length(vView);
    float day = dot(n, sunDir);        // relief lighting + terminator
    float dayS = dot(p, sunDir);       // smooth sphere terminator
    float light = smoothstep(-0.12, 0.25, day);
    vec3 sd = vec3(uSeed * 17.31, uSeed * 9.17, uSeed * 31.7);
    float lat = p.y;
    vec3 col = vec3(0.0);
    vec3 emit = vec3(0.0);
    float spec = 0.0;

    // the same macro field the orbital shader draws and the worker meshes
    float cont = fbm(p * 2.3 + sd);
    float mount = ridged(p * 5.0 + sd * 1.7);
    float h = cont * 0.75 + mount * 0.45 - 0.28;
    float corridor = (uHasSea > 0.5 && uHasHydro > 0.5) ? hydroAt(p) : 1.0;

    if (uType == 4) {
      // lava world: black basalt, glowing fracture network
      float crack = ridged(p * 6.5 + sd);
      float glow = smoothstep(0.78, 0.95, crack) * (0.75 + 0.25 * sin(uTime * 0.7 + crack * 20.0));
      col = mix(vec3(0.02), uColA, smoothstep(-0.3, 0.6, h) * 0.35);
      emit = uColC * glow * 2.4;
    } else if (h < uOcean && uType != 3) {
      // sea — the mesh under this fragment is clamped flat at sea level
      float depth = clamp((uOcean - h) * 2.2, 0.0, 1.0);
      col = mix(uColC * 0.6, uColA * 0.35, depth);
      float ripple = 0.8 + 0.25 * snoise(p * 900.0 + vec3(uTime * 0.08));
      spec = pow(max(dot(reflect(-sunDir, n), viewDir), 0.0), 110.0) * 0.9 * ripple;
      // deltas: the deposition fans the mesher raised wear wet sand
      if (uHasHydro > 0.5 && corridor > 0.2) {
        float shoreD = 1.0 - min(abs(h - uOcean + 0.015) / 0.05, 1.0);
        if (shoreD > 0.0) {
          vec3 sand = mix(uColC, uColB, 0.55) * 0.9;
          col = mix(col, sand, min(corridor * shoreD * 1.2, 0.85));
          spec *= 0.35;
        }
      }
    } else {
      // land
      float above = h - uOcean;
      vec3 low = uType == 3 ? uColA : mix(uColC, uColA, smoothstep(0.0, 0.28, above));
      col = mix(low, uColB, smoothstep(0.18, 0.5, above + mount * 0.12));
      if (uType == 3) {
        float crack = smoothstep(0.82, 0.98, ridged(p * 7.0 + sd));
        col = mix(col, uColC, crack * 0.6);
        spec = pow(max(dot(reflect(-sunDir, n), viewDir), 0.0), 60.0) * 0.45;
      }
      // the snow line migrates with the season: the winter hemisphere's cap
      // reaches down while the summer one retreats — uSunDir.y IS the
      // subsolar latitude's sine, so the shader needs no extra uniform
      float capLine = uIceCap + sign(lat) * uSunDir.y * 0.8;
      float caps = smoothstep(capLine, capLine + 0.12, abs(lat) + h * 0.18);
      float snow = smoothstep(0.55, 0.7, above);
      col = mix(col, vec3(0.93, 0.95, 1.0), max(caps, snow));
      if (uCity > 0.5 && h >= uOcean) {
        float megac = smoothstep(0.35, 0.75, fbm3(p * 5.0 + sd * 2.3));
        float grid = smoothstep(0.55, 0.95, fbm(p * 26.0 + sd));
        float nightside = smoothstep(0.05, -0.22, dayS);
        emit += vec3(1.0, 0.72, 0.42) * megac * grid * nightside * 1.15;
      }
      // erosion history: trunk valleys read greener and their mouths wear
      // the fans the mesher deposited
      if (uHasSea > 0.5 && uHasHydro > 0.5) {
        float aboveE = h - uOcean;
        float vband = min(max((aboveE - 0.02) * 24.0, 0.0), 1.0) * min(max((0.5 - aboveE) * 4.0, 0.0), 1.0);
        col = mix(col, uColC, 0.30 * corridor * vband);
        float shoreE = 1.0 - min(abs(aboveE + 0.015) / 0.05, 1.0);
        if (corridor > 0.2 && shoreE > 0.0) {
          col = mix(col, mix(uColC, uColB, 0.55) * 0.9, min(corridor * shoreE, 0.8));
        }
      }
      // rivers: the same network the mesher carved — water lies in the beds,
      // and only where the watershed corridors say water actually flows
      if (uHasSea > 0.5) {
        float above = h - uOcean;
        if (above > 0.002 && above < 0.42) {
          if (corridor > 0.06) {
            vec3 sd2 = vec3(uSeed * 7.7, uSeed * 3.1, uSeed * 13.9);
            float rv = fbm(p * 45.0 + sd2);
            float w = (0.010 + 0.020 * max(1.0 - above * 3.5, 0.0)) * (0.35 + 0.9 * corridor) * uFlow;
            float t = abs(rv) / w;
            if (t < 1.2) {
              float wet = 1.0 - smoothstep(0.45, 0.75, t);
              float bank = 1.0 - smoothstep(0.75, 1.2, t);
              col = mix(col, col * 0.82, bank * 0.6);            // damp banks
              col = mix(col, mix(uColC * 0.55, uColA * 0.3, 0.4), wet);
              spec = max(spec, pow(max(dot(reflect(-sunDir, n), viewDir), 0.0), 90.0) * 0.7 * wet);
            }
          }
        }
      }
    }

    // ground detail fades in as you fall — bands anchored to the sphere
    float near1 = 1.0 - smoothstep(40.0, 420.0, dCam);
    if (near1 > 0.002 && uType != 4) {
      float d1 = snoise(p * 2400.0 + sd);
      float near2 = 1.0 - smoothstep(2.0, 42.0, dCam);
      float d2 = near2 > 0.002 ? snoise(p * 14000.0 + sd * 1.3) : 0.0;
      col *= 1.0 + d1 * 0.11 * near1 + d2 * 0.09 * near2;
    }

    // weather memory: rain slicks and darkens the land near you; snow dusts it
    if (uWet > 0.01 && h >= uOcean) {
      float flat5 = smoothstep(0.93, 1.0, dot(n, p));
      float nearW = 1.0 - smoothstep(2.0, 60.0, dCam);
      if (uWetMode < 0.5) {
        col *= 1.0 - 0.22 * uWet * nearW;
        spec = max(spec, pow(max(dot(reflect(-sunDir, n), viewDir), 0.0), 60.0) * 0.4 * uWet * flat5 * nearW);
      } else {
        col = mix(col, vec3(0.88, 0.9, 0.95), 0.35 * uWet * flat5 * nearW);
      }
    }

    float ambient = 0.012;
    vec3 lit = col * (light * 0.95 + ambient) + spec * light * vec3(1.0, 0.98, 0.9) + emit;

    // the air between you and the ground
    float fog = 1.0 - exp(-dCam * uHazeK);
    float sunUp = clamp(dayS * 0.85 + 0.25, 0.0, 1.0);
    lit = mix(lit, uHaze * sunUp, fog);
    gl_FragColor = vec4(lit, 1.0);
  }
`;

// the ocean's vertex stage: same RTC + geomorph as the land, plus the
// primary swell train as true Gerstner displacement near the camera —
// crests sharpen, troughs flatten, silhouettes actually move
const OCEAN_VERT = /* glsl */`
  uniform vec3 uCenter;
  uniform float uSplitD;
  uniform float uMorphOn;
  uniform float uTime;
  attribute vec3 aMorph;
  attribute vec3 aMorphN;
  varying vec3 vDir;
  varying vec3 vN;
  varying vec3 vView;
  void main() {
    float d0 = length((modelViewMatrix * vec4(position, 1.0)).xyz);
    float m = uMorphOn * clamp((d0 / uSplitD - 1.05) / 0.8, 0.0, 1.0);
    vec3 p = mix(position, aMorph, m);
    vec3 pf = uCenter + p;
    vec3 dir = normalize(pf);
    float fade = 1.0 - smoothstep(8.0, 70.0, d0);
    if (fade > 0.001) {
      vec3 e1 = normalize(cross(abs(dir.y) > 0.94 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), dir));
      vec3 e2 = cross(dir, e1);
      float ph = dot(pf, e1) * 84.0 + dot(pf, e2) * 31.0 + uTime * 0.55;
      float A = 0.0016 * fade;
      vec2 dw = vec2(0.906, 0.423);   // the swell's travel direction
      p += (e1 * dw.x + e2 * dw.y) * (A * 0.8 * cos(ph));
      p += dir * (A * sin(ph));
    }
    vDir = uCenter + p;
    vN = normalize(mix(normal, aMorphN, m));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const OCEAN_FRAG = /* glsl */`
  precision highp float;
  uniform float uSeed;
  uniform vec3  uSunDir;
  uniform float uTime;
  uniform float uOcean;
  uniform vec3  uColA;      // deep water (the world's own palette)
  uniform vec3  uColC;      // shallows
  uniform vec3  uHaze;
  uniform float uHazeK;
  varying vec3 vDir;
  varying vec3 vN;
  varying vec3 vView;
  ${NOISE_GLSL}

  void main() {
    vec3 dir = normalize(vDir);
    vec3 viewDir = normalize(-vView);
    float dCam = length(vView);
    vec3 sunDir = normalize(uSunDir);
    float dayS = dot(dir, sunDir);
    float light = smoothstep(-0.12, 0.25, dayS);

    // waves: three trochoidal trains in the local tangent frame plus a
    // noise band for breakup — analytic slopes, no texture, no mesh cost
    vec3 e1 = normalize(cross(abs(dir.y) > 0.94 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0), dir));
    vec3 e2 = cross(dir, e1);
    float fade = 1.0 - smoothstep(30.0, 700.0, dCam);   // waves matter near you
    vec2 slope = vec2(0.0);
    if (fade > 0.001) {
      float x1 = dot(vDir, e1), x2 = dot(vDir, e2);
      slope += vec2(0.9, 0.42) * cos(x1 * 84.0 + x2 * 31.0 + uTime * 0.55) * 0.10;
      slope += vec2(-0.35, 0.83) * cos(x1 * -98.0 + x2 * 241.0 + uTime * 0.9) * 0.065;
      slope += vec2(0.6, -0.75) * cos(x1 * 590.0 + x2 * 214.0 + uTime * 1.6) * 0.045;
      float n1 = snoise(dir * 5200.0 + vec3(uTime * 0.12, uSeed, 0.0));
      slope += vec2(n1, -n1) * 0.05;
      slope *= fade;
    }
    vec3 n = normalize(dir + e1 * slope.x + e2 * slope.y);

    // what the water sits over: the true bathymetry, recomputed here
    vec3 sd = vec3(uSeed * 17.31, uSeed * 9.17, uSeed * 31.7);
    float h = fbm(dir * 2.3 + sd) * 0.75 + ridged(dir * 5.0 + sd * 1.7) * 0.45 - 0.28;
    float depth = clamp((uOcean - h) * 2.2, 0.0, 1.0);
    vec3 body = mix(uColC * 0.6, uColA * 0.35, depth) * (light * 0.9 + 0.012);

    // Fresnel against a procedural sky, sun glint on the wave normals
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
    vec3 refl = reflect(-viewDir, n);
    float elev = clamp(dot(refl, dir), 0.0, 1.0);
    float sunUp = clamp(dayS * 0.85 + 0.25, 0.0, 1.0);
    vec3 sky = mix(uHaze * 1.15, uHaze * 0.35, sqrt(elev)) * sunUp;
    float glintN = max(dot(refl, sunDir), 0.0);
    vec3 glint = vec3(1.0, 0.97, 0.9) * (pow(glintN, 420.0) * 1.6 + pow(glintN, 40.0) * 0.12) * light;

    vec3 col = mix(body, sky, F) + glint;
    float fog = 1.0 - exp(-dCam * uHazeK);
    col = mix(col, uHaze * sunUp, fog);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const ATMO2_VERT = /* glsl */`
  varying vec3 vRay;   // camera sits at the render origin: world pos = the ray
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vRay = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// Rayleigh + Mie, marched per sky pixel — with the atmosphere's memory in
// two precomputed tables: transmittance T(h,μ) replaces the nested sun
// march, and Hillaire's Ψ(h,μs) adds every scattering order past the first,
// which is what keeps the sky blue after the sun has set.
const ATMO2_FRAG = /* glsl */`
  precision highp float;
  uniform vec3  uCamPos;    // planet frame
  uniform vec3  uSunDir;
  uniform float uR;         // ground sphere
  uniform float uRa;        // top of atmosphere
  uniform vec3  uBetaR;
  uniform float uBetaM;
  uniform float uHr;
  uniform float uHm;
  uniform float uSunI;
  uniform sampler2D uTexT;
  uniform sampler2D uTexMS;
  uniform float uPsiScale;
  varying vec3 vRay;

  // ray/sphere: returns entry/exit distances along d from o, or -1s
  vec2 rsi(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    float c = dot(o, o) - r * r;
    float disc = b * b - c;
    if (disc < 0.0) return vec2(-1.0);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
  }

  vec2 lutUV(float h, float mu) {
    return vec2((mu + 0.3) / 1.3, h / (uRa - uR));
  }
  vec3 sunT(float h, float mu) {
    vec3 s = texture2D(uTexT, lutUV(h, mu)).rgb;
    return s * s;   // sqrt-encoded
  }
  vec3 psiMS(float h, float mu) {
    return texture2D(uTexMS, lutUV(h, mu)).rgb * uPsiScale;
  }

  void main() {
    vec3 dir = normalize(vRay);
    vec3 o = uCamPos;
    vec2 atm = rsi(o, dir, uRa);
    if (atm.y < 0.0) discard;
    float t0 = max(atm.x, 0.0);
    float t1 = atm.y;
    vec2 gnd = rsi(o, dir, uR);
    if (gnd.x > 0.0) t1 = min(t1, gnd.x);
    if (t1 <= t0) discard;

    const int N = 12;
    float dt = (t1 - t0) / float(N);
    vec3 sumR = vec3(0.0);
    vec3 sumM = vec3(0.0);
    vec3 msL = vec3(0.0);
    float odR = 0.0, odM = 0.0;
    for (int i = 0; i < N; i++) {
      vec3 x = o + dir * (t0 + (float(i) + 0.5) * dt);
      float xr = length(x);
      float h = xr - uR;
      float dR = exp(-h / uHr) * dt;
      float dM = exp(-h / uHm) * dt;
      odR += dR; odM += dM;
      vec3 Tv = exp(-uBetaR * odR - uBetaM * 1.1 * odM);
      float mus = dot(x, uSunDir) / xr;
      vec3 Ts = sunT(h, mus);
      sumR += Tv * Ts * dR;
      sumM += Tv * Ts * dM;
      msL += Tv * psiMS(h, mus) * (uBetaR * dR + vec3(uBetaM * dM));
    }
    float mu = dot(dir, uSunDir);
    float phR = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
    const float g = 0.76;
    float phM = 3.0 / (8.0 * 3.14159) * (1.0 - g * g) * (1.0 + mu * mu)
      / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    vec3 inscatter = (sumR * uBetaR * phR + sumM * uBetaM * phM + msL) * uSunI;
    vec3 T = exp(-uBetaR * odR - uBetaM * 1.1 * odM);
    float a = 1.0 - (T.r + T.g + T.b) / 3.0;
    gl_FragColor = vec4(inscatter, a);
  }
`;

// The cloud deck as a volume: a raymarched slab between two radii, fbm
// density with a bottom-heavy profile, wind drift, two sun taps with a
// powder term. Descend through it and the world whites out and returns —
// no billboard ever did that.
const VCLOUD_FRAG = /* glsl */`
  precision highp float;
  uniform vec3  uCamPos;
  uniform vec3  uSunDir;
  uniform float uR;
  uniform float uRb;
  uniform float uRt;
  uniform float uCov;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3  uSunCol;
  uniform float uSteps;
  varying vec3 vRay;
  ${NOISE_GLSL}

  vec2 rsi(vec3 o, vec3 d, float r) {
    float b = dot(o, d);
    float c = dot(o, o) - r * r;
    float disc = b * b - c;
    if (disc < 0.0) return vec2(-1.0);
    float s = sqrt(disc);
    return vec2(-b - s, -b + s);
  }

  float cloudDens(vec3 x) {
    float h01 = clamp((length(x) - uRb) / (uRt - uRb), 0.0, 1.0);
    // the wind: fronts arrive and leave on a watchable timescale
    vec3 q = x * (9.0 / uR) + vec3(uSeed * 3.1, uSeed * 7.7, uSeed * 1.3)
      + vec3(uTime * 0.024, 0.0, uTime * 0.0132);
    float f = fbm3(q);
    float profile = smoothstep(0.02, 0.22, h01) * (1.0 - smoothstep(0.55, 1.0, h01));
    return smoothstep(0.5 - uCov * 0.42, 0.62, f * 0.5 + 0.5) * profile;
  }

  void main() {
    vec3 dir = normalize(vRay);
    vec3 o = uCamPos;
    vec2 top = rsi(o, dir, uRt);
    if (top.y < 0.0) discard;
    vec2 base = rsi(o, dir, uRb);
    float r0 = length(o);
    float t0, t1;
    if (r0 > uRt) { t0 = max(top.x, 0.0); t1 = (base.x > 0.0) ? base.x : top.y; }
    else if (r0 > uRb) { t0 = 0.0; t1 = (base.x > 0.0) ? base.x : top.y; }
    else { t0 = base.y; t1 = top.y; }
    vec2 gnd = rsi(o, dir, uR);
    if (gnd.x > 0.0 && gnd.x < t0) discard;
    if (gnd.x > 0.0) t1 = min(t1, gnd.x);
    if (t1 <= t0) discard;
    t1 = min(t1, t0 + (uRt - uRb) * 14.0);   // cap the horizon-grazing march

    int N = int(uSteps);
    float dt = (t1 - t0) / float(N);
    vec3 acc = vec3(0.0);
    float T = 1.0;
    for (int i = 0; i < 24; i++) {
      if (i >= N) break;
      vec3 x = o + dir * (t0 + (float(i) + 0.5) * dt);
      float d = cloudDens(x);
      if (d < 0.004) continue;
      float s1 = cloudDens(x + uSunDir * (uRt - uRb) * 0.25);
      float s2 = cloudDens(x + uSunDir * (uRt - uRb) * 0.7);
      float Tsun = exp(-(s1 + s2) * 2.6);
      float powder = 1.0 - exp(-d * 8.0);
      float mu = dot(dir, uSunDir);
      float daylight = smoothstep(-0.08, 0.15, dot(normalize(x), uSunDir));
      vec3 cCol = uSunCol * ((Tsun * powder * (0.55 + 0.45 * mu) * 1.5 + 0.12) * daylight + 0.015);
      float a = 1.0 - exp(-d * dt * (30.0 / (uRt - uRb)));
      acc += T * a * cCol;
      T *= 1.0 - a;
      if (T < 0.02) break;
    }
    if (T > 0.995) discard;
    gl_FragColor = vec4(acc, 1.0 - T);
  }
`;

const MOON_VERT = /* glsl */`
  varying vec3 vN;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const MOON_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uCol;
  varying vec3 vN;
  void main() {
    float l = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
    gl_FragColor = vec4(uCol * (l * 0.95 + 0.03), 1.0);
  }
`;

const AMP_BY_TYPE = { 0: 15, 1: 11, 2: 7, 3: 14, 4: 13 };
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF'];

export class PlanetScale {
  constructor(app, ctx) {
    this.app = app;
    this.kind = 'planet';
    this.ctx = ctx;
    const pp = this.pp = ctx.planet;

    const url = new URL(window.location.href);
    this.R = 2600;
    this.amp = AMP_BY_TYPE[pp.typeId] ?? 11;
    this.unitKm = Math.max(pp.radiusE, 0.05) * 6371 / this.R;

    // the world's resonance: an art direction chosen at its birth
    const res = this.res = pp.res ?? { hazeX: 1, hazeTint: null, bloomX: 1, sunX: 1, rainX: 1, grade: null, line: null };

    this.scene = new THREE.Scene();
    // the camera never leaves the origin — the planet moves instead, so
    // float32 precision is always spent where you are looking
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.05, 60000);
    // park on the day side of the approach bearing, looking down at the globe
    const sunD = new THREE.Vector3().fromArray(ctx.sunDir || [1, 0.2, 0]).normalize();
    this.camPos = new THREE.Vector3()
      .fromArray(ctx.fromDir || [0.35, 0.3, 0.88]).normalize()
      .addScaledVector(sunD, 0.9).normalize()
      .multiplyScalar(this.R * 2.7);
    this.yaw = 0;
    this.pitch = -1.02;

    this.uSunDir = { value: new THREE.Vector3().fromArray(ctx.sunDir || [1, 0.2, 0]).normalize() };
    this.uTime = { value: 0 };
    this.uHazeK = { value: 0 };
    this.uWet = { value: 0 };
    this.uWetMode = { value: pp.Teq < 265 ? 1 : 0 };   // 1 = snow
    this.uFlow = { value: 1 };           // rivers swell while the ground is wet
    const atmoAmt = pp.typeId === 0 ? 0.25 : pp.typeId === 4 ? 0.4 : 1.0;
    this.hazeBase = 0.012 * atmoAmt * res.hazeX;
    this.uHazeCol = { value: pp.atmoColor.clone().multiplyScalar(0.9).add(new THREE.Color(0.02, 0.02, 0.03)) };
    if (res.hazeTint) this.uHazeCol.value.lerp(new THREE.Color(...res.hazeTint), 0.3);

    this._morphOn = { value: url.searchParams.get('gm') === '0' ? 0 : 1 };
    const makeMaterial = (center, splitD) => new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: center },
        uSplitD: { value: splitD },
        uMorphOn: this._morphOn,
        uType: { value: pp.typeId },
        uSeed: { value: pp.noiseSeed },
        uSunDir: this.uSunDir,
        uTime: this.uTime,
        uOcean: { value: pp.oceanLevel },
        uCity: { value: pp.inhabited ? 1 : 0 },
        uIceCap: { value: pp.iceCap },
        uColA: { value: pp.colA },
        uColB: { value: pp.colB },
        uColC: { value: pp.colC },
        uHaze: this.uHazeCol,
        uHazeK: this.uHazeK,
        // evaluated at tile-build time, safely after hasSea is set below
        uHasSea: { value: hasSea ? 1 : 0 },
        uHasHydro: { value: this.hydro ? 1 : 0 },
        uHydro: { value: this._hydroTex },
        uHydroN: { value: this.hydro ? this.hydro.n : 1 },
        uWet: this.uWet,
        uWetMode: this.uWetMode,
        uFlow: this.uFlow,
      },
      vertexShader: TILE_VERT,
      fragmentShader: TILE_FRAG,
    });

    const hasSea = (pp.typeId === 1 || pp.typeId === 2) && pp.oceanLevel > -0.5;
    const qres = parseInt(url.searchParams.get('qr')) || 33;
    const qdepth = parseInt(url.searchParams.get('qd')) || 18;
    const qsplit = parseFloat(url.searchParams.get('qk')) || 0;

    // ancient scars: airless worlds carry their bombardment in the field
    // itself, so every LOD and the collision agree about every crater
    let craters = null;
    if (pp.typeId === 0 || pp.typeId === 3) {
      const cr = new RNG(hash(pp.seed, 0x0cae));
      craters = [];
      const n = cr.int(26, 46);
      for (let i = 0; i < n; i++) {
        const z = cr.float(-1, 1), th = cr.float(0, Math.PI * 2);
        const q = Math.sqrt(1 - z * z);
        const rad = cr.power(0.05, 0.9, 1.6);
        craters.push(q * Math.cos(th), z, q * Math.sin(th), rad / this.R, rad * 0.28);
      }
    }

    // the watershed: a real global flow solve, baked once (~1 s), gating
    // every river the worker carves and the fragment paints
    this.hydro = hasSea && url.searchParams.get('hy') !== '0'
      ? solveWatershed(pp.noiseSeed, pp.oceanLevel, this.amp) : null;
    if (this.hydro) {
      this._hydroTex = new THREE.DataTexture(
        this.hydro.atlas, 3 * this.hydro.n, 2 * this.hydro.n,
        THREE.RedFormat, THREE.UnsignedByteType);
      this._hydroTex.magFilter = this._hydroTex.minFilter = THREE.LinearFilter;
      this._hydroTex.unpackAlignment = 1;
      this._hydroTex.needsUpdate = true;
    } else {
      this._hydroTex = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
      this._hydroTex.needsUpdate = true;
    }

    this.quad = new QuadtreePlanet(pp, {
      R: this.R, amp: this.amp,
      res: qres, maxDepth: qdepth, splitK: qsplit,
      skirtK: url.searchParams.has('sk') ? parseFloat(url.searchParams.get('sk')) : 1,
      bathy: hasSea,
      craters,
      hydro: this.hydro ? { atlas: this.hydro.atlas, n: this.hydro.n } : null,
      makeMaterial,
    });
    this.planetGroup = new THREE.Group();
    this.planetGroup.add(this.quad.group);
    this.scene.add(this.planetGroup);

    // -- the sea: a second quadtree, flat at sea level, wearing water
    this.seaR = hasSea ? this.R + this.amp * pp.oceanLevel : -1;
    if (hasSea) {
      const makeOcean = (center, splitD) => new THREE.ShaderMaterial({
        uniforms: {
          uCenter: { value: center },
          uSplitD: { value: splitD },
          uMorphOn: this._morphOn,
          uSeed: { value: pp.noiseSeed },
          uSunDir: this.uSunDir,
          uTime: this.uTime,
          uOcean: { value: pp.oceanLevel },
          uColA: { value: pp.colA },
          uColC: { value: pp.colC },
          uHaze: this.uHazeCol,
          uHazeK: this.uHazeK,
        },
        vertexShader: OCEAN_VERT,
        fragmentShader: OCEAN_FRAG,
      });
      this.ocean = new QuadtreePlanet(pp, {
        R: this.R, amp: this.amp,
        res: qres, maxDepth: Math.min(qdepth, 14), splitK: qsplit,
        flat: pp.oceanLevel, workers: 2,
        makeMaterial: makeOcean,
      });
      this.planetGroup.add(this.ocean.group);
    }

    // -- the true sky, carried down from the system view
    const gv = ctx.gview;
    this.scene.add(gv
      ? makeGalaxySkyFromWithin(gv.starData, gv.time, gv.vrot, gv.pos, 17000)
      : makeSkyDome(pp.seed, 18000));

    // -- the sun: right color, right bearing, roughly right size
    this._sunPosBig = { value: this.uSunDir.value.clone().multiplyScalar(1e7) };
    const glowTex = softDotTexture();
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: ctx.sunColor.clone(),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    const lum = ctx.system?.lum ?? 1;
    this.sunSprite.scale.setScalar(
      Math.min(Math.max(340 * Math.sqrt(lum) / Math.max(pp.a, 0.2), 150), 950) * res.sunX);
    this.scene.add(this.sunSprite);

    // -- the sky is computed, not painted: single-scattering raymarch
    const atmoAmt2 = pp.typeId === 0 ? 0.2 : pp.typeId === 4 ? 0.5 : 1.0;
    this._camPlanet = { value: new THREE.Vector3() };
    if (url.searchParams.get('atm') !== '0' && atmoAmt2 > 0.05) {
      const beta = pp.atmoColor.clone().multiplyScalar(0.0095 * atmoAmt2);
      const betaR = new THREE.Vector3(Math.max(beta.r, 5e-4), Math.max(beta.g, 5e-4), Math.max(beta.b, 5e-4));
      const betaM = 2.2e-4 * atmoAmt2;
      const luts = buildScatterLUTs({
        R: this.R, Ra: this.R * 1.06, betaR, betaM,
        Hr: this.R * 0.012, Hm: this.R * 0.0032,
      });
      this.atmoShell = new THREE.Mesh(
        new THREE.SphereGeometry(this.R * 1.06, 64, 48),
        new THREE.ShaderMaterial({
          uniforms: {
            uCamPos: this._camPlanet,
            uSunDir: this.uSunDir,
            uR: { value: this.R },
            uRa: { value: this.R * 1.06 },
            uBetaR: { value: betaR },
            uBetaM: { value: betaM },
            uHr: { value: this.R * 0.012 },
            uHm: { value: this.R * 0.0032 },
            uSunI: { value: 15 },
            uTexT: { value: luts.texT },
            uTexMS: { value: luts.texMS },
            uPsiScale: { value: luts.psiScale },
          },
          vertexShader: ATMO2_VERT,
          fragmentShader: ATMO2_FRAG,
          side: THREE.BackSide,
          transparent: true,
          premultipliedAlpha: true,
          depthWrite: false,
        }));
      this.atmoShell.renderOrder = 3;
      this.planetGroup.add(this.atmoShell);
    }
    if (pp.clouds > 0.05) {
      if (url.searchParams.get('vc') !== '0') {
        // the volumetric deck
        this.cloudMesh = new THREE.Mesh(
          new THREE.SphereGeometry(this.R * 1.024, 48, 32),
          new THREE.ShaderMaterial({
            uniforms: {
              uCamPos: this._camPlanet,
              uSunDir: this.uSunDir,
              uR: { value: this.R },
              uRb: { value: this.R * 1.010 },
              uRt: { value: this.R * 1.020 },
              uCov: { value: pp.clouds },
              uTime: this.uTime,
              uSeed: { value: pp.noiseSeed },
              uSunCol: { value: (ctx.sunColor ?? new THREE.Color(1, 1, 1)).clone() },
              uSteps: { value: parseInt(url.searchParams.get('vs'))
                || (window.matchMedia && matchMedia('(pointer: coarse)').matches ? 10 : 16) },
            },
            vertexShader: ATMO2_VERT,
            fragmentShader: VCLOUD_FRAG,
            side: THREE.BackSide,
            transparent: true,
            premultipliedAlpha: true,
            depthWrite: false,
            depthTest: false,
          }));
        this.cloudMesh.renderOrder = 2;
        this.planetGroup.add(this.cloudMesh);
        this._cloudAmt = null;
        // the deck deserves detail when you fly through it
        this._vSteps = this.cloudMesh.material.uniforms.uSteps;
        this._vStepsBase = this._vSteps.value;
      } else {
        // legacy billboard shell
        this.cloudMesh = new THREE.Mesh(
          new THREE.SphereGeometry(this.R * 1.014, 96, 64),
          makeCloudMaterial(pp, this._sunPosBig, this.uTime));
        this._cloudAmt = this.cloudMesh.material.uniforms.uAmt;
        this.cloudMesh.renderOrder = 1;
        this.planetGroup.add(this.cloudMesh);
      }
    }

    // -- moons, keeping their system-scale orbits (rescaled)
    this.moons = [];
    const scaleF = this.R / Math.max(pp.drawRadius, 0.01);
    for (const m of ctx.moons || []) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(Math.max(m.drawR * scaleF * 0.9, 20), 48, 32),
        new THREE.ShaderMaterial({
          uniforms: { uSunDir: this.uSunDir, uCol: { value: new THREE.Color(0.5, 0.49, 0.47) } },
          vertexShader: MOON_VERT, fragmentShader: MOON_FRAG,
        }));
      this.planetGroup.add(mesh);
      this.moons.push({ mesh, dist: m.dist * scaleF, phase: m.phase, rate: m.rate });
    }

    // civilization overhead: stations and ship traffic (inhabited worlds)
    this.orbitals = addOrbitals(this);

    // civilization underfoot: full metropolises where the night-lights
    // burn hardest — street grids, skylines, bridges, harbors (?ct=0 skips)
    this.cities = pp.inhabited && url.searchParams.get('ct') !== '0'
      ? new CityField(this) : null;

    // winter-light worlds hang curtains over their poles after dark
    this.aurora = res.aurora ? addAurora(this) : null;

    // seasons: every world leans. The sun's declination follows the orbital
    // phase (the days counter — Space pauses it, . and , bend it), so the
    // time lever is planetary now: speed the clock and watch winter come.
    const tr = new RNG(hash(pp.seed, 0x5ea5));
    this.tilt = tr.float(0.06, 0.5);
    this.yearDays = Math.max(pp.periodYears * 365.25, 20);
    const sd0 = new THREE.Vector3().fromArray(ctx.sunDir || [1, 0.2, 0]).normalize();
    this._sunLon = Math.atan2(sd0.z, sd0.x);
    // seat the year so today's declination matches the approach geometry
    const decl0 = Math.asin(Math.min(Math.max(sd0.y, -0.95), 0.95));
    const orb0 = Math.asin(Math.min(Math.max(decl0 / this.tilt, -1), 1));
    this.days = (orb0 / (Math.PI * 2)) * this.yearDays;
    this.speedDays = 12;
    this.playing = true;
    this.keys = new Set();
    this._kd = (e) => this.keys.add(e.code);
    this._ku = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);

    // duck-typed for the hyperzoom
    this.controls = { enabled: true, target: new THREE.Vector3(), update: () => {} };

    this.bloomSettings = { strength: 0.28 * res.bloomX, radius: 0.55, threshold: 0.7 };
    this.gradeSettings = res.grade;
    this._spd = 0;
    this._landing = false;
    this.walk = false;                 // on foot: gravity holds you to the crust
    this.eyeH = 0.0009;                // ~2.2 m in draw units

    // lights for the standard-material life (trees, masts) at the anchor
    this.dirLight = new THREE.DirectionalLight(0xffffff, 1.25);
    this.planetGroup.add(this.dirLight);
    this.planetGroup.add(this.dirLight.target);
    this.scene.add(new THREE.AmbientLight(0x404855, 0.4));

    this.anchor = null;                // the local pocket of life underfoot
    this._anchorT = 0;
    this.meteor = null;
    this._flash = null;
    this._scareT = 0;

    // weather: driven by the SAME cloud field the volumetric deck renders
    this.wx = { wet: 0, raining: false, storm: false, snow: pp.Teq < 265 };
    this._rain = null;
    this._bolt = null;
    this.ride = null;                    // aboard a shuttle to the station
    this.inside = null;                  // walking the station's ring deck
    this._ring = null;

    // the descent director: arriving from the system view, the ship flies
    // itself down — one graceful fall, orbit to standing, yours to take
    // over the moment you touch a control (?ap=0 keeps the helm manual)
    this.auto = null;
    this._autoHint = false;
    this.asc = null;                     // the climb-out, mirror of the fall
    if (url.searchParams.get('ap') !== '0') this._engageAutopilot();
  }

  // ------------------------------------------------------------ ascent ----
  /** Esc low over the world: fly the climb-out, then hand off to the
   *  system view. Returns true if the director took the key. */
  beginAscent() {
    if (this.asc) { this.asc = null; return false; }   // Esc again: skip up
    if (this.ride || this.inside) return false;
    if (this.camPos.length() - this.R > this.R * 0.9) return false; // already high
    this.walk = false;
    this.auto = null;
    this.asc = { t: 0, dur: 13, r0: this.camPos.length(), look: 0 };
    this.app.hud.setHint('climbing out · esc again to skip · any key keeps you here');
    if (this.app.audio) this.app.audio.warp('ascend');
    return true;
  }

  _cancelAscent() {
    if (!this.asc) return;
    this.asc = null;
    this.app.hud.setHint('you have the helm · wasd fly · r/f climb & dive · esc to orbit');
  }

  _updateAscent(dt) {
    const A = this.asc;
    A.t += dt / A.dur;
    if (A.look > 0) A.look -= dt;
    const u = Math.min(A.t, 1);
    if (u >= 1) {
      this.asc = null;
      this.app.popTo(this.app.stack.length - 2);
      return;
    }
    // slow liftoff, hard burn at the top
    const e = u * u * (0.35 + 0.65 * u);
    const prev = this.camPos.length();
    this.camPos.setLength(A.r0 + (this.R * 2.55 - A.r0) * e);
    this._spd = (this.camPos.length() - prev) / Math.max(dt, 1e-6);
    if (A.look <= 0) {
      // eyes: nose up through the climb, then roll over to watch the
      // world shrink — the pose the system view receives you in
      const pitchT = u < 0.5 ? 0.55 : -1.05;
      this.pitch += (pitchT - this.pitch) * Math.min(dt * (u < 0.5 ? 0.8 : 1.3), 1);
      this.yaw += dt * 0.05;
    }
  }

  // -------------------------------------------------------- autopilot ----
  /** pick a landing site and fly the whole descent: orbit to boots */
  _engageAutopilot(dur = 44) {
    if (this.walk || this.ride || this.auto) return;
    const sun = this.uSunDir.value;
    const from = this.camPos.clone().normalize();
    // the site: sunlit, dry, scenic — and on inhabited worlds, the lights
    let best = null, bs = -1e9;
    for (let i = 0; i < 380; i++) {
      const z = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const q = Math.sqrt(1 - z * z);
      _t5.set(q * Math.cos(th), z, q * Math.sin(th));
      const day = _t5.dot(sun);
      if (day < 0.15) continue;                  // touch down in daylight
      const arc = from.angleTo(_t5);
      if (arc > 1.35) continue;                  // stay on this face
      const h = this.quad.heightAt(_t5);
      if (this.seaR > 0 && h < this.seaR + 0.02) continue;   // dry ground
      let score = day * 1.5 + (h - this.R) / this.amp - Math.abs(_t5.y) * 0.7 - arc * 0.4;
      if (this.pp.inhabited) score += this._cityMask(_t5) * 4;
      if (score > bs) { bs = score; best = _t5.clone(); }
    }
    // on inhabited worlds the lights won: put the wheels down on the
    // metropolis plaza itself, not merely near the glow — and grade its
    // ground now, from orbit, while the tile pipeline has nothing to lose
    if (best && this.cities) {
      const site = this.cities.siteNear(best);
      if (site && site.dir.angleTo(best) < 0.28 && site.landing.dot(sun) > 0.05) {
        best = site.landing.clone();
        this.cities._installPad(site);
      }
    }
    this.auto = {
      t: 0, dur,
      from, site: best ?? from.clone(),          // all-sea worlds: straight down
      alt0: Math.max(this.camPos.length() - this._groundR(from), 1),
      look: 0,                                   // free-look window after a drag
    };
  }

  _cancelAuto(hint) {
    if (!this.auto) return;
    this.auto = null;
    this.app.hud.setHint(hint ?? 'you have the helm · wasd fly · r/f climb & dive · b boards a shuttle · esc to orbit');
  }

  _updateAuto(dt) {
    const A = this.auto;
    A.t += dt / A.dur;
    if (A.look > 0) A.look -= dt;
    // the ground must be drawn before the flare: hold short of touchdown
    // until the tiles under the site converge (ten seconds at the most) —
    // never again a touchdown waist-deep in a parent-level mesh
    if (A.t > 0.93) {
      const depth = this.quad.depthAt(A.site);
      if (depth >= 0 && depth < 14 && (A.hold = (A.hold ?? 0) + dt) < 10) A.t = 0.93;
    }
    const u = Math.min(A.t, 1);
    // bearing: a great-circle glide toward the site, front-loaded — the
    // transit happens up high, then you drift down onto the destination
    const sm = 1 - Math.pow(1 - u, 2.2);
    const dir = _t5.copy(A.from).multiplyScalar(1 - sm).addScaledVector(A.site, sm).normalize();
    // altitude: fast out of orbit, through the deck mid-way, a long low
    // final glide that follows the terrain, then the flare
    const alt = A.alt0 * Math.pow(1 - u, 3.2) * Math.exp(-6 * u);
    const clearance = this.eyeH + 0.9 * Math.pow(1 - u, 1.35);
    const gr = this._groundR(dir);
    const prev = _t7.copy(this.camPos);
    this.camPos.copy(dir).multiplyScalar(gr + Math.max(alt, clearance));
    // the ground you are falling toward streams in ahead of you: keep the
    // quadtree's focus a step below the ship, over the landing site
    this._descentFocus = (this._descentFocus ?? new THREE.Vector3())
      .copy(A.site).multiplyScalar(this._groundR(A.site) + Math.max(alt * 0.25, 0.003));
    const vel = _t6.copy(this.camPos).sub(prev);
    this._spd = vel.length() / Math.max(dt, 1e-6);
    if (u >= 1) {
      // touchdown: boots take it from here
      const upT = _a1.copy(this.camPos).normalize();
      this.camPos.copy(upT).multiplyScalar(this._groundR(upT) + this.eyeH);
      this.auto = null;
      this.walk = true;
      this.app.hud.setHint('touchdown · wasd to walk · r lifts off · b boards a shuttle');
      return;
    }
    if (A.look <= 0) {
      // eyes follow the ground track, easing level as the ground rises
      const upN = _a1.copy(this.camPos).normalize();
      let eastN = _a2.crossVectors(Y_AXIS, upN);
      if (eastN.lengthSq() < 1e-6) eastN = _a2.crossVectors(Z_AXIS, upN);
      eastN.normalize();
      const northN = _a3.crossVectors(upN, eastN);
      if (vel.lengthSq() > 1e-14) {
        const yawT = Math.atan2(vel.dot(eastN), vel.dot(northN));
        const dy = ((yawT - this.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        this.yaw += dy * Math.min(dt * 1.4, 1);
      }
      const pitchT = -0.07 - 0.95 * Math.pow(1 - u, 1.7);
      this.pitch += (pitchT - this.pitch) * Math.min(dt * 0.9, 1);
    }
  }

  // ---------------------------------------------------------- boarding ----
  /** B calls a shuttle, both ways: from the ground it rides the corridor
   *  up to the station; from altitude (or the station itself) it rides
   *  home — to the nearest metro plaza if one is in reach, else to dry
   *  ground below. */
  boardShuttle() {
    if (this.ride) return;
    // fresh altitude — the cached readout can be a frame stale
    const upNow = _t7.copy(this.camPos).normalize();
    const alt = this.camPos.length() - this._groundR(upNow);
    if (alt < 6) {
      if (!this.orbitals) return;
      const dock = this.orbitals.board();
      if (!dock) return;
      this._beginRide(dock, 'riding the corridor · drag to look · b to bail');
      return;
    }
    // homeward: pick the pad — a city plaza when the lights are near
    const up = this.camPos.clone().normalize();
    let dir = null;
    const site = this.cities?.siteNear(up);
    if (site && site.dir.angleTo(up) < 0.5) {
      dir = site.landing.clone();
      this.cities._installPad(site);
    }
    if (!dir) {
      dir = up.clone();
      for (let i = 0; i < 40 && this.seaR > 0 && this.quad.heightAt(dir) < this.seaR + 0.001; i++) {
        dir.copy(up).addScaledVector(_t6.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), 0.02 * (i + 1)).normalize();
      }
    }
    const groundDir = dir;
    const dock = {
      kind: 'ground',
      pos: (out) => out.copy(groundDir).multiplyScalar(this._groundR(groundDir) + this.eyeH),
    };
    if (this.inside) this._exitInside();
    this._beginRide(dock, 'shuttle home · drag to look · b to bail');
  }

  _beginRide(dock, hint) {
    const craft = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.ConeGeometry(0.0012, 0.005, 6),
      new THREE.MeshStandardMaterial({ color: 0xb8bec7, roughness: 0.4, metalness: 0.7 }));
    hull.rotation.x = Math.PI / 2;
    craft.add(hull);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDotTexture(), color: new THREE.Color(1.6, 1.1, 0.5),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    glow.scale.setScalar(0.004);
    glow.position.z = -0.003;
    craft.add(glow);
    this.planetGroup.add(craft);
    this.ride = { t: 0, dur: 46, from: this.camPos.clone(), dock, craft };
    this.walk = false;
    this.auto = null;
    this.asc = null;
    this.app.hud.setHint(hint);
    if (this.app.audio) this.app.audio.warp('dive');
  }

  _endRide(docked) {
    const r = this.ride;
    if (!r) return;
    this.planetGroup.remove(r.craft);
    r.craft.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    this.ride = null;
    this.app.hud.setHint(docked ? 'docked · you have the helm' : '');
  }

  _updateRide(dt, up) {
    const r = this.ride;
    if (!r) return;
    r.t += dt / r.dur;
    const to = _t5;
    r.dock.pos(to);
    if (r.dock.kind === 'ground') {
      // the shuttle home streams its landing zone ahead, and holds its
      // final approach until the drawn ground has converged
      this._descentFocus = (this._descentFocus ?? new THREE.Vector3()).copy(to);
      if (r.t > 0.96) {
        const d = _t6.copy(to).normalize();
        const depth = this.quad.depthAt(d);
        if (depth >= 0 && depth < 14 && (r.hold = (r.hold ?? 0) + dt) < 10) r.t = 0.96;
      }
    }
    if (r.t >= 1) {
      const dock = r.dock;
      this.camPos.copy(to);
      this._endRide(true);
      if (dock.kind === 'ground') {
        // wheels down: boots take it from here
        this.walk = true;
        this.app.hud.setHint('touchdown · wasd to walk · r lifts off · b boards a shuttle');
      } else {
        // docked: step through the airlock onto the ring deck
        this._enterInside(dock);
      }
      return;
    }
    const sm = r.t * r.t * (3 - 2 * r.t);
    const r0 = r.from.length(), r1 = to.length();
    const dir = _t6.copy(r.from).multiplyScalar(1 - sm).addScaledVector(to, sm).normalize();
    const rad = r0 * (1 - sm) + r1 * sm + Math.sin(Math.PI * sm) * this.R * 0.03;
    const prev = _t7.copy(this.camPos);
    this.camPos.copy(dir).multiplyScalar(rad);
    // the craft rides just ahead of your view, nose along the velocity
    const vel = _t6.copy(this.camPos).sub(prev);
    r.craft.position.copy(this.camPos)
      .addScaledVector(up, -0.0022)
      .addScaledVector(vel.lengthSq() > 0 ? vel.clone().normalize() : up, 0.006);
    if (vel.lengthSq() > 1e-12) r.craft.lookAt(_t7.copy(r.craft.position).add(vel));
  }

  /** the volumetric deck's density formula, mirrored in JS — sampled at
   *  the zenith to decide whether it is raining where you stand */
  _cloudAt(dir) {
    if (!this.cloudMesh || this._cloudAmt) return 0;   // volumetrics only
    const Rb = this.R * 1.010, Rt = this.R * 1.020;
    const rad = (Rb + Rt) / 2;
    const t = this.uTime.value;
    const s = this.pp.noiseSeed;
    const k = 9 / this.R;
    let px = dir.x * rad * k + s * 3.1 + t * 0.024;
    let py = dir.y * rad * k + s * 7.7;
    let pz = dir.z * rad * k + s * 1.3 + t * 0.0132;
    let v = 0, a = 0.5;
    for (let o = 0; o < 3; o++) {
      v += a * snoise(px, py, pz);
      px = px * 2.07 + 11.3; py = py * 2.07 + 11.3; pz = pz * 2.07 + 11.3;
      a *= 0.5;
    }
    const f = v * 0.5 + 0.5;
    const cov = this.pp.clouds;
    const lo = 0.5 - cov * 0.42;
    const d = Math.min(Math.max((f - lo) / (0.62 - lo), 0), 1);
    return d * 0.8;   // mid-deck height profile ≈ 0.8
  }

  _buildRain() {
    const N = 420;
    const pos = new Float32Array(N * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
    const mat = new THREE.LineBasicMaterial({
      color: this.wx.snow ? 0xdde4ee : 0x9fb4c8, transparent: true, opacity: 0,
    });
    const lines = new THREE.LineSegments(geo, mat);
    lines.frustumCulled = false;
    this.scene.add(lines);   // camera-frame: the camera sits at the origin
    const drops = [];
    for (let i = 0; i < N; i++) {
      drops.push(new THREE.Vector3(
        (Math.random() - 0.5) * 0.03,
        Math.random() * 0.03 - 0.01,
        (Math.random() - 0.5) * 0.03));
    }
    this._rain = { lines, geo, pos, drops, N };
  }

  _updateRain(dt, up) {
    if (!this._rain && this.wx.wet <= 0) return;
    if (!this._rain) this._buildRain();
    const R = this._rain;
    const vis = this.wx.raining ? Math.min(this.wx.wet * 3, 1) : 0;
    R.lines.material.opacity = vis * 0.55;
    R.lines.material.color.set(this.wx.snow ? 0xdde4ee : 0x9fb4c8);
    R.lines.visible = vis > 0.01;
    if (!R.lines.visible) return;
    const fall = this.wx.snow ? 0.0016 : 0.012;         // m/s scaled to units
    const len = this.wx.snow ? 0.00025 : 0.0022;
    const sway = this.wx.snow ? 0.0012 : 0.0002;
    const t = this.uTime.value;
    for (let i = 0; i < R.N; i++) {
      const d = R.drops[i];
      d.addScaledVector(up, -fall * dt);
      d.x += Math.sin(t * 1.3 + i) * sway * dt * 60;
      if (d.dot(up) < -0.012) d.addScaledVector(up, 0.028);
      const o = i * 6;
      R.pos[o] = d.x; R.pos[o + 1] = d.y; R.pos[o + 2] = d.z;
      R.pos[o + 3] = d.x + up.x * len; R.pos[o + 4] = d.y + up.y * len; R.pos[o + 5] = d.z + up.z * len;
    }
    R.geo.attributes.position.needsUpdate = true;
  }

  // ---------------------------------------------------- the ring deck ----
  /** the interior: a walkable catwalk ring inside the habitat torus. The
   *  hull culls itself from within (backfaces), so the whole sky — the
   *  planet, the stars, the traffic — wheels past as the station spins. */
  _buildRing(dock) {
    const g = new THREE.Group();
    const R0 = dock.ringR, tube = dock.tubeR;
    const rf = R0 + tube * 0.55;             // spinward is down: the floor
    const N = 44;
    const plateGeo = new THREE.BoxGeometry(tube * 1.15, tube * 0.06, (2 * Math.PI * rf / N) * 1.06);
    const plateMat = new THREE.MeshStandardMaterial({ color: 0x39404a, roughness: 0.85, metalness: 0.3 });
    const ribGeo = new THREE.TorusGeometry(tube * 0.96, tube * 0.035, 6, 28);
    const ribMat = new THREE.MeshStandardMaterial({ color: 0x555d68, roughness: 0.5, metalness: 0.7 });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xcfdce8 });
    const X = new THREE.Vector3(1, 0, 0);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2;
      const rho = new THREE.Vector3(0, Math.sin(th), -Math.cos(th));
      const tau = new THREE.Vector3(0, Math.cos(th), Math.sin(th));
      const q = new THREE.Quaternion().setFromRotationMatrix(m4.makeBasis(X, rho, tau));
      const plate = new THREE.Mesh(plateGeo, plateMat);
      plate.position.copy(rho).multiplyScalar(rf);
      plate.quaternion.copy(q);
      g.add(plate);
      if (i % 4 === 0) {
        const rib = new THREE.Mesh(ribGeo, ribMat);   // structure, for parallax
        rib.position.copy(rho).multiplyScalar(R0);
        rib.quaternion.copy(q);
        g.add(rib);
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(tube * 0.12, tube * 0.02, tube * 0.12), glowMat);
        lamp.position.copy(rho).multiplyScalar(R0 - tube * 0.5);   // the ceiling
        lamp.quaternion.copy(q);
        g.add(lamp);
      }
    }
    // handrails: two continuous rings at waist height
    const railGeo = new THREE.TorusGeometry(rf - tube * 0.1, tube * 0.012, 5, 96);
    for (const sx of [-0.42, 0.42]) {
      const rail = new THREE.Mesh(railGeo, ribMat);
      rail.position.x = tube * sx;
      rail.rotation.y = Math.PI / 2;           // into the ring's YZ plane
      g.add(rail);
    }
    this.planetGroup.add(g);
    this._ring = g;
  }

  _enterInside(dock) {
    if (!dock.obj) return;                     // an old handle: stay outside
    if (!this._ring) this._buildRing(dock);
    this._ring.visible = true;
    this.inside = { dock, theta: 0, lat: 0 };
    this.walk = false;
    this.pitch = 0;
    this.app.hud.setHint('aboard the ring · w/s walk the deck · a/d cross it · b calls the shuttle home · esc leaves for orbit');
  }

  _exitInside() {
    const I = this.inside;
    this.inside = null;
    if (this._ring) this._ring.visible = false;
    const out = _t5;
    I.dock.pos(out);
    const away = _t6.copy(out).normalize();
    this.camPos.copy(out).addScaledVector(away, 2.2);
    this.pitch = -0.5;
    this.app.hud.setHint('back outside · you have the helm · esc to orbit');
  }

  _updateInside(dt) {
    const I = this.inside;
    const st = I.dock.obj;
    this._ring.position.copy(st.position);
    this._ring.quaternion.copy(st.quaternion);
    // walk: w/s along the deck (the way you face), a/d across it
    const boost = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) ? 2.6 : 1;
    const spd = 0.0016 * boost;
    const rf = I.dock.ringR + I.dock.tubeR * 0.55;
    let mv = 0, sv = 0;
    if (this.keys.has('KeyW')) mv += 1;
    if (this.keys.has('KeyS')) mv -= 1;
    if (this.keys.has('KeyA')) sv -= 1;
    if (this.keys.has('KeyD')) sv += 1;
    const fwdSign = Math.cos(this.yaw) >= 0 ? 1 : -1;
    I.theta += (mv * fwdSign * spd * dt) / rf;
    I.lat = Math.min(Math.max(I.lat + sv * spd * dt, -I.dock.tubeR * 0.42), I.dock.tubeR * 0.42);
    this._spd = (mv || sv) ? spd : 0;
    // the local frame, spun by the live station
    const rho = _a1.set(0, Math.sin(I.theta), -Math.cos(I.theta)).applyQuaternion(st.quaternion);
    const tau = _a2.set(0, Math.cos(I.theta), Math.sin(I.theta)).applyQuaternion(st.quaternion);
    const ex = _a3.set(1, 0, 0).applyQuaternion(st.quaternion);
    this.camPos.copy(st.position)
      .addScaledVector(rho, rf - 0.0007)       // eyes 1.7 m over the deck
      .addScaledVector(ex, I.lat);
    // spin gravity: down is outward, up is toward the hub
    const upI = _up.copy(rho).negate();
    const fwd = _fwd.copy(tau).multiplyScalar(Math.cos(this.yaw)).addScaledVector(ex, Math.sin(this.yaw));
    fwd.multiplyScalar(Math.cos(this.pitch)).addScaledVector(upI, Math.sin(this.pitch)).normalize();
    this.camera.up.copy(upI);
    this.camera.lookAt(fwd);
    this.planetGroup.position.copy(this.camPos).negate();
  }

  /** lightning: a flash inside the deck over a dense cell near the zenith,
   *  and a point light that throws the strike across the wet ground */
  _spawnBolt(up) {
    const e1 = new THREE.Vector3(0, 1, 0).cross(up);
    if (e1.lengthSq() < 1e-6) e1.set(1, 0, 0).cross(up);
    e1.normalize();
    const e2 = new THREE.Vector3().crossVectors(up, e1);
    let dir = null;
    for (let i = 0; i < 6; i++) {
      const d = up.clone()
        .addScaledVector(e1, (Math.random() - 0.5) * 0.05)
        .addScaledVector(e2, (Math.random() - 0.5) * 0.05).normalize();
      if (this._cloudAt(d) > 0.5) { dir = d; break; }
    }
    if (!dir) return;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDotTexture(), color: new THREE.Color(1.9, 2.1, 2.6),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
    }));
    sprite.scale.setScalar(22);
    sprite.position.copy(dir).multiplyScalar(this.R * 1.0105);
    const light = new THREE.PointLight(0xcfdcff, 0, 0, 2);
    light.position.copy(dir).multiplyScalar(this._groundR(dir) + 3);
    this.planetGroup.add(sprite, light);
    this._bolt = { t: 0, sprite, light };
  }

  _updateBolt(dt) {
    const B = this._bolt;
    B.t += dt;
    const t = B.t;   // the classic double hit: strike, dark beat, re-strike
    const o = t < 0.07 ? 1 : t < 0.13 ? 0.25 : t < 0.2 ? 0.85 : Math.max(1 - (t - 0.2) / 0.22, 0);
    B.sprite.material.opacity = o;
    B.light.intensity = o * 260;
    if (t > 0.45) {
      this.planetGroup.remove(B.sprite, B.light);
      B.sprite.material.map.dispose();
      B.sprite.material.dispose();
      this._bolt = null;
    }
  }

  /** the same fbm the night-lights shader keys cities to — land on a glow,
   *  find the towers */
  _cityMask(dir) {
    const s = this.pp.noiseSeed;
    let px = dir.x * 5 + s * 17.31 * 2.3, py = dir.y * 5 + s * 9.17 * 2.3, pz = dir.z * 5 + s * 31.7 * 2.3;
    let v = 0, a = 0.5;
    for (let o = 0; o < 3; o++) {
      v += a * snoise(px, py, pz);
      px = px * 2.07 + 11.3; py = py * 2.07 + 11.3; pz = pz * 2.07 + 11.3;
      a *= 0.5;
    }
    return Math.min(Math.max((v - 0.35) / 0.4, 0), 1);
  }

  /**
   * Ecology: the sphere is quantized into regions, each with a
   * deterministic carrying capacity (regional richness) and a persisted
   * population that grows logistically between your visits. Come back in
   * an hour and the herd has changed.
   */
  _ecoFor(a) {
    const q = 28;
    const key = (hash(Math.round(a.x * q), Math.round(a.y * q), Math.round(a.z * q), this.pp.seed) >>> 0).toString(36);
    const rng = new RNG(parseInt(key, 36) >>> 0);
    const veg = 0.4 + 0.6 * rng.next();
    const K = { s: Math.round(2 + veg * 7), k: Math.round(10 + veg * 30) };
    let db = {};
    try { db = JSON.parse(localStorage.getItem('aeon-eco-v1') || '{}'); } catch { /* fresh */ }
    const now = Date.now();
    let st = db[key];
    if (!st) {
      st = { s: Math.round(K.s * rng.float(0.35, 1)), k: Math.round(K.k * rng.float(0.35, 1)), t: now };
    } else {
      // logistic growth over the hours you were away, capped at a month
      const dtH = Math.min(Math.max((now - st.t) / 3.6e6, 0), 720);
      const grow = (n, cap) => Math.min(cap, Math.round(n + (n + 0.5) * 0.08 * dtH * (1 - n / cap)));
      st.s = grow(st.s, K.s); st.k = grow(st.k, K.k); st.t = now;
    }
    db[key] = st;
    try { localStorage.setItem('aeon-eco-v1', JSON.stringify(db)); } catch { /* full */ }
    return { striders: st.s, skimmers: st.k, veg, key };
  }

  /**
   * A biome anchor: a planet-frame group at the ground point under you,
   * oriented east/up/north and scaled metres→units, exposing exactly the
   * host contract the classic surface gave life.js and settlement.js.
   */
  _buildAnchor(upDir) {
    const a = upDir.clone();
    const aR = this._groundR(a);
    const mpu = this.unitKm * 1000;
    let east = new THREE.Vector3(0, 1, 0).cross(a);
    if (east.lengthSq() < 1e-6) east = new THREE.Vector3(1, 0, 0).cross(a);
    east.normalize();
    // right-handed: east × up = north, or the quaternion becomes a mirror
    const north = new THREE.Vector3().crossVectors(east, a);
    const group = new THREE.Group();
    group.position.copy(a).multiplyScalar(aR);
    group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, a, north));
    group.scale.setScalar(1 / mpu);
    this.planetGroup.add(group);
    const anchorPos = group.position.clone();
    const hv = new THREE.Vector3();
    const host = {
      pp: this.pp,
      scene: group,
      spawn: { x: 0, z: 0 },
      seaLevel: this.seaR > 0 ? (this.seaR - aR) * mpu : null,
      amp: 280,
      uSunDir: this.uSunDir,
      uSunColor: { value: (this.ctx.sunColor ?? new THREE.Color(1, 1, 1)).clone() },
      heightAt: (x, z) => {
        hv.copy(anchorPos).addScaledVector(east, x / mpu).addScaledVector(north, z / mpu).normalize();
        return (this.quad.heightAt(hv) * hv.dot(a) - aR) * mpu;
      },
      eco: this._ecoFor(a),
      urban: this.cities?.insideCity(a) ?? false,
      camLocal: () => {
        _hc.copy(this.camPos).sub(anchorPos);
        return { x: _hc.dot(east) * mpu, y: _hc.dot(a) * mpu, z: _hc.dot(north) * mpu };
      },
      scared: () => this._scareT > 0,
    };
    this.anchor = {
      a, aR, mpu, group, east, north, pos: anchorPos, eco: host.eco,
      life: addLife(host),
      // any spot the night-lights shader would glow gets its towers —
      // unless a true metropolis already owns this ground
      settlement: this._cityMask(a) > 0.02 && !host.urban ? addSettlement(host) : null,
    };
  }

  _dropAnchor() {
    if (!this.anchor) return;
    this.planetGroup.remove(this.anchor.group);
    this.anchor.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    this.anchor = null;
  }

  /** the radius you can stand on: terrain, or the sea surface over it */
  _groundR(dir) {
    return Math.max(this.quad.heightAt(dir), this.seaR);
  }

  // ------------------------------------------------------------- loop ----
  update(dt) {
    const up = _up.copy(this.camPos).normalize();
    let east = _east.crossVectors(Y_AXIS, up);
    if (east.lengthSq() < 1e-6) east = _east.crossVectors(Z_AXIS, up);
    east.normalize();
    const north = _north.crossVectors(up, east);

    const surfR = this._groundR(up);
    const alt = this.camPos.length() - surfR;
    this.altUnits = alt;

    // walking begins where flying bottoms out; R lifts you back into flight
    // (the climb-out gets one frame of grace, or boots recapture the ship)
    if (!this.walk && !this.ride && !this.asc && alt < this.eyeH * 2.2) this.walk = true;
    if (this.walk && this.keys.has('KeyR')) { this.walk = false; this.camPos.addScaledVector(up, 0.004); }

    // the autopilot yields to any hand on the stick
    if (this.auto && !this._autoHint) {
      this._autoHint = true;
      this.app.hud.setHint('autopilot has the ship · drag to look around · any key takes the helm');
    }
    if (this.auto || this.asc) {
      for (const k of MOVE_KEYS) {
        if (this.keys.has(k)) { this._cancelAuto(); this._cancelAscent(); break; }
      }
    }

    const boost = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) ? 3.4 : 1;
    this._spd = 0;
    const fwd = _fwd.copy(north).multiplyScalar(Math.cos(this.yaw)).addScaledVector(east, Math.sin(this.yaw));
    fwd.multiplyScalar(Math.cos(this.pitch)).addScaledVector(up, Math.sin(this.pitch)).normalize();
    const right = _right.crossVectors(fwd, up).normalize();
    if (this.ride) {
      this._updateRide(dt, up);
      this._spd = this.ride ? (this.R * 0.4) / this.ride.dur : 0;
    } else if (this.inside) {
      // the deck walk happens after the station has moved this frame
      this._spd = 0;
    } else if (this.walk) {
      // on foot: tangential steps at human speed, boots glued to the field
      const spd = 0.0026 * boost;
      const fwdT = _north.copy(fwd).addScaledVector(up, -fwd.dot(up)).normalize();
      if (this.keys.has('KeyW')) { this.camPos.addScaledVector(fwdT, spd * dt); this._spd = spd; }
      if (this.keys.has('KeyS')) { this.camPos.addScaledVector(fwdT, -spd * dt); this._spd = spd; }
      if (this.keys.has('KeyA')) { this.camPos.addScaledVector(right, -spd * dt); this._spd = spd; }
      if (this.keys.has('KeyD')) { this.camPos.addScaledVector(right, spd * dt); this._spd = spd; }
      const upNow = _up.copy(this.camPos).normalize();
      this.camPos.copy(upNow).multiplyScalar(this._groundR(upNow) + this.eyeH);
    } else {
      // in flight: the throttle is your altitude
      const spd = Math.min(Math.max(alt * 0.8, 0.008), 1600) * boost;
      if (this.keys.has('KeyW')) { this.camPos.addScaledVector(fwd, spd * dt); this._spd = spd; }
      if (this.keys.has('KeyS')) { this.camPos.addScaledVector(fwd, -spd * dt); this._spd = spd; }
      if (this.keys.has('KeyA')) { this.camPos.addScaledVector(right, -spd * dt); this._spd = spd; }
      if (this.keys.has('KeyD')) { this.camPos.addScaledVector(right, spd * dt); this._spd = spd; }
      if (this.keys.has('KeyR')) { this.camPos.addScaledVector(up, spd * dt); this._spd = spd; }
      if (this.keys.has('KeyF')) { this.camPos.addScaledVector(up, -spd * dt); this._spd = spd; }
    }

    // the descent director: the approach engages it, the tour asks for it
    if (this.tourAutopilot && !this.auto && !this.walk && !this.ride && !this.inside) this._engageAutopilot(34);
    if (this.auto && (this.walk || this.ride)) {
      this.auto = null;
      if (this.walk) this.app.hud.setHint('touchdown · wasd to walk · r lifts off · b boards a shuttle');
    }
    if (this.auto) this._updateAuto(dt);
    if (this.asc && (this.walk || this.ride)) this.asc = null;
    if (this.asc) this._updateAscent(dt);
    if (this.tourAutopilot && this.walk) {
      this.pitch += (-0.03 - this.pitch) * Math.min(dt * 0.8, 1);
    }

    // never through the crust or under the waves (walking stands exactly on
    // them; the ride's arc and the ring deck are trusted)
    if (!this.walk && !this.ride && !this.inside) {
      const floor = this._groundR(_up.copy(this.camPos).normalize()) + this.eyeH;
      if (this.camPos.length() < floor) this.camPos.setLength(floor);
    }

    // the near plane follows your altitude: centimetres on foot, tens of
    // units in orbit — float depth is always spent where you are. Indoors
    // everything is metres away, whatever the altitude says.
    const near = this.inside ? 0.0004 : Math.min(Math.max(alt * 0.25, 0.0004), 30);
    if (Math.abs(near - this.camera.near) > this.camera.near * 0.25) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }

    // orient: local horizon stays level
    this.camera.up.copy(up);
    this.camera.lookAt(fwd);

    // camera-relative world: the planet wears the negative camera position
    this.planetGroup.position.copy(this.camPos).negate();
    if (!this.auto && this.ride?.dock?.kind !== 'ground') this._descentFocus = null;
    this.quad.update(this.camPos, this._descentFocus);
    if (this.ocean) this.ocean.update(this.camPos);

    // life on the ground: a pocket of creatures and buildings follows you
    this._anchorT -= dt;
    if (alt < 8) {
      const driftU = this.anchor ? this.anchor.a.distanceTo(up) * this.R : 1e9;
      if (driftU > 0.6 / this.unitKm && this._anchorT <= 0) {
        this._dropAnchor();
        this._buildAnchor(up.clone());
        this._anchorT = 2.5;
      }
    } else if (alt > 20 && this.anchor) {
      this._dropAnchor();
    }
    if (this.anchor) {
      const sunY = this.uSunDir.value.dot(this.anchor.a);
      this.anchor.life?.update(dt, sunY);
      this.anchor.settlement?.update(dt, sunY);
    }
    if (this._scareT > 0) this._scareT -= dt;
    this.orbitals?.update(dt);
    this.cities?.update(dt);
    // aboard: the camera rides the live ring, after the station has moved
    if (this.inside) this._updateInside(dt);

    // weather: overcast overhead and you below the deck = precipitation;
    // the ground remembers the rain for a while after the sky clears
    const deckBase = this.R * 1.010;
    const dens = this._cloudAt(up);
    // the resonance sets the weather's temperament: rain-forward worlds
    // rain at thinner decks, desert moods hold out for real overcast
    const rX = this.res.rainX ?? 1;
    this.wx.storm = dens > 0.55 / rX;    // the densest cells carry lightning
    this.wx.raining = this.camPos.length() < deckBase - 1 && dens > 0.3 / rX;
    this.wx.wet = Math.min(Math.max(
      this.wx.wet + (this.wx.raining ? dt / 18 : -dt / 30), 0), 1);
    this.uWet.value = this.wx.wet;
    this.uFlow.value = 1 + this.wx.wet * 0.8;   // the rivers answer the rain
    this._updateRain(dt, up);
    if (!this._bolt && this.wx.raining && this.wx.storm && Math.random() < dt / 5) {
      this._spawnBolt(up);
    }
    if (this._bolt) this._updateBolt(dt);

    // meteors: on demand (X) — and, on airless worlds, the sky's own idea
    this._updateMeteor(dt);
    if (this._flash) {
      this._flash.t += dt;
      const g = 1 - this._flash.t / 0.8;
      this._flash.sp.material.opacity = Math.max(g, 0);
      this._flash.sp.scale.multiplyScalar(1 + dt * 1.4);
      if (g <= 0) {
        this.planetGroup.remove(this._flash.sp);
        this._flash.sp.material.dispose();
        this._flash = null;
      }
    }
    if ((this.pp.typeId === 0 || this.pp.typeId === 3) && alt < 6 && !this.meteor && Math.random() < dt / 28) {
      this.strikeMeteor(true);
    }

    // -- environment
    this.uTime.value += dt;
    if (this.playing) this.days += dt * this.speedDays;
    // the sun: daily sweep in longitude, seasonal sweep in declination
    this._sunLon += dt * 0.004;
    const orb = (this.days / this.yearDays) * Math.PI * 2;
    const decl = this.tilt * Math.sin(orb);
    const cosD = Math.cos(decl);
    this.uSunDir.value.set(
      Math.cos(this._sunLon) * cosD, Math.sin(decl), Math.sin(this._sunLon) * cosD);
    // seasonal snow: temperate worlds trade rain for snow in local winter
    const camLat = up.y;
    this.wx.snow = this.pp.Teq < 265
      || (this.pp.Teq < 300 && Math.abs(camLat) > 0.35 && -Math.sign(camLat) * decl > 0.04);
    this.uWetMode.value = this.wx.snow ? 1 : 0;
    this._decl = decl;
    this._orb = orb;
    this._sunPosBig.value.copy(this.uSunDir.value).multiplyScalar(1e7);
    this._camPlanet.value.copy(this.camPos);
    this.dirLight.position.copy(this.uSunDir.value).multiplyScalar(6000);
    this.sunSprite.position.copy(this.uSunDir.value).multiplyScalar(9000);
    this.uHazeK.value = this.hazeBase * Math.exp(-Math.max(alt, 0) / (this.R * 0.012));
    // near and inside the cloud deck, the volumetric march earns more steps
    if (this._vSteps) {
      this._vSteps.value = Math.min(Math.round(this._vStepsBase * (alt < this.R * 0.06 ? 1.6 : 1)), 26);
    }
    if (this.cloudMesh && this._cloudAmt) {
      // legacy shell only: the volumetric deck needs no fade tricks
      this.cloudMesh.rotation.y += dt * 0.0004;
      const deckH = this.R * 0.014;
      this._cloudAmt.value = this.pp.clouds * 0.55 *
        Math.min(Math.max((alt - deckH * 0.3) / deckH, 0.1), 1);
    }
    for (const m of this.moons) {
      const th = m.phase + m.rate * this.days;
      m.mesh.position.set(Math.cos(th) * m.dist, 0, Math.sin(th) * m.dist);
    }

  }

  // ---------------------------------------------------------- meteors ----
  strikeMeteor(auto) {
    if (this.meteor) return;
    let dirT;
    if (auto) {
      const up = this.camPos.clone().normalize();
      dirT = up.addScaledVector(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), 0.0012).normalize();
    } else {
      const look = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      dirT = this.camPos.clone()
        .addScaledVector(look, Math.max(this.altUnits ?? 1, 0.2) * 2 + 0.7).normalize();
    }
    const target = dirT.clone().multiplyScalar(this.quad.heightAt(dirT));
    const from = target.clone()
      .addScaledVector(dirT, 22)
      .addScaledVector(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), 11);
    const head = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDotTexture(), color: new THREE.Color(2.0, 1.5, 0.9),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    head.scale.setScalar(0.35);
    this.planetGroup.add(head);
    const trailGeo = new THREE.BufferGeometry().setFromPoints([from, from]);
    const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
      color: 0xffd9a0, transparent: true, opacity: 0.8,
    }));
    this.planetGroup.add(trail);
    this.meteor = { t: 0, dur: 1.15, from, target, dirT, head, trail };
  }

  _updateMeteor(dt) {
    const m = this.meteor;
    if (!m) return;
    m.t += dt;
    const f = Math.min(m.t / m.dur, 1);
    m.head.position.lerpVectors(m.from, m.target, f * f);
    const tail = m.head.position.clone().lerp(m.from, 0.16);
    m.trail.geometry.setFromPoints([tail, m.head.position]);
    if (f >= 1) {
      this.planetGroup.remove(m.head); this.planetGroup.remove(m.trail);
      m.head.material.dispose(); m.trail.geometry.dispose(); m.trail.material.dispose();
      const rad = 0.02 + Math.random() * 0.06;
      const evicted = this.quad.addCrater(m.dirT.x, m.dirT.y, m.dirT.z, rad, rad * 0.28);
      this._scareT = 9;   // everything nearby bolts
      const flash = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softDotTexture(), color: new THREE.Color(2.4, 1.9, 1.2),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      }));
      flash.position.copy(m.target).addScaledVector(m.dirT, rad);
      flash.scale.setScalar(rad * 7);
      this.planetGroup.add(flash);
      this._flash = { sp: flash, t: 0 };
      this._lastStrike = { evicted, rad };
      this.meteor = null;
      if (this.app.audio) this.app.audio.warp('dive');
    }
  }

  // ------------------------------------------------------------ input ----
  onWheel(e) {
    // scroll = altitude, multiplicative — the Google-Earth feel
    this._cancelAuto();
    this._cancelAscent();
    if (this.walk) { if (e.deltaY < 0) this.walk = false; else return; }
    this.camPos.multiplyScalar(1 + Math.sign(e.deltaY) * 0.055);
    if (this.camPos.length() > this.R * 5) this.camPos.setLength(this.R * 5);
  }
  onPointerDown(e) { this._drag = { x: e.clientX, y: e.clientY }; }
  onPointerUp() { this._drag = null; }
  onPointerMove(e) {
    if (!this._drag) return;
    const dx = (e.clientX - this._drag.x) * 0.0024;
    const dy = (e.clientY - this._drag.y) * 0.0024;
    this._drag = { x: e.clientX, y: e.clientY };
    this.yaw += dx;
    this.pitch = Math.min(Math.max(this.pitch - dy, -1.5), 1.5);
    // dragging during a flown leg is free look — the ship keeps flying
    if (this.auto) this.auto.look = 3;
    if (this.asc) this.asc.look = 3;
  }
  onKey(code) {
    if (code === 'KeyX') { this.strikeMeteor(false); return true; }
    if (code === 'KeyB') {
      if (this.inside) this.boardShuttle();       // homeward, from the deck
      else if (this.ride) this._endRide(false);
      else this.boardShuttle();                   // up from the ground, home from the sky
      return true;
    }
    return false;
  }
  pick() { return null; }

  // -------------------------------------------------------------- hud ----
  _fmtKm(km) {
    if (km >= 100) return Math.round(km).toLocaleString() + ' km';
    if (km >= 1) return km.toFixed(1) + ' km';
    return (km * 1000).toFixed(0) + ' m';
  }

  _seasonLabel() {
    const hemi = this.camPos.y >= 0 ? 1 : -1;
    const x = Math.sin(this._orb ?? 0) * hemi;
    const rising = Math.cos(this._orb ?? 0) * hemi > 0;
    const name = x > 0.5 ? 'summer' : x < -0.5 ? 'winter' : rising ? 'spring' : 'autumn';
    return `${name} · subsolar ${((this._decl ?? 0) * 180 / Math.PI).toFixed(0)}°`;
  }

  hudStats() {
    const S = this.quad.stats;
    const spacing = this.R * (Math.PI / 2) / (1 << S.maxDepth) / (this.quad.res - 1) * this.unitKm;
    return [
      ['world', this.pp.name],
      ['class', this.pp.type + (this.pp.inhabited ? ' · inhabited' : '')],
      ['radius', Math.round(this.pp.radiusE * 6371).toLocaleString() + ' km'],
      ['mode', this.inside ? 'aboard · ring deck'
        : this.ride ? 'shuttle · corridor'
        : this.asc ? 'autopilot · ascent'
        : this.auto ? 'autopilot · descent'
        : this.walk ? 'on foot' : 'flight'],
      ['altitude', this._fmtKm(Math.max(this.altUnits ?? 0, 0) * this.unitKm)],
      ['speed', this._spd > 0 ? this._fmtKm(this._spd * this.unitKm) + '/s' : '—'],
      ['terrain tiles', `${S.drawn} drawn · ${S.cached} cached${S.pending ? ` · ${S.pending} streaming` : ''}`],
      ...(this.ocean ? [['sea tiles', `${this.ocean.stats.drawn} drawn · ${this.ocean.stats.cached} cached`]] : []),
      ...(this.quad.job.craters ? [['craters', String(this.quad.job.craters.length / 5)]] : []),
      ...(this.anchor?.eco ? [['regional fauna', `${this.anchor.eco.striders} striders · ${this.anchor.eco.skimmers} skimmers`]] : []),
      ...(this.cities?.hudRows() ?? []),
      ...(this.cloudMesh && !this._cloudAmt ? [['weather', this.wx.raining
        ? (this.wx.storm ? (this.wx.snow ? 'blizzard' : 'thunderstorm')
          : (this.wx.snow ? 'snowing' : 'raining'))
        : this.wx.wet > 0.05 ? 'clearing · ground wet' : 'fair']] : []),
      ['season', this._seasonLabel()],
      ...(this.res.line ? [['mood', this.res.line]] : []),
      ['triangles', S.tris >= 1e6 ? (S.tris / 1e6).toFixed(2) + ' M' : Math.round(S.tris / 1e3) + ' k'],
      ['finest grid', this._fmtKm(spacing)],
    ];
  }

  timeReadout() {
    const S = this.quad.stats;
    return `alt ${this._fmtKm(Math.max(this.altUnits ?? 0, 0) * this.unitKm)} · ${S.drawn} tiles${S.pending ? ' · streaming' : ''}`;
  }
  togglePlay() { this.playing = !this.playing; }
  speedUp() { this.speedDays = Math.min(this.speedDays * 1.8, 4000); }
  slowDown() { this.speedDays = Math.max(this.speedDays / 1.8, 0.2); }

  enter() {}
  exit() {}
  resume() {
    // climbing out of the classic surface: lift to a low hover
    const surfR = this._groundR(_up.copy(this.camPos).normalize());
    if (this.camPos.length() < surfR + 40) this.camPos.setLength(surfR + 40);
    this._landing = false;
    this.walk = false;
  }

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    this._dropAnchor();
    this.orbitals?.dispose();
    this.cities?.dispose();
    this.aurora?.dispose();
    this.quad.dispose();
    if (this.ocean) this.ocean.dispose();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

// scratch vectors
const _hc = new THREE.Vector3();
const _t5 = new THREE.Vector3();
const _t6 = new THREE.Vector3();
const _t7 = new THREE.Vector3();
const _a1 = new THREE.Vector3();
const _a2 = new THREE.Vector3();
const _a3 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

export const PLANET_NOTE = `One continuous scale, orbit to boots. The planet is a <b>chunked-LOD quadtree</b> on a tangent-warped cube sphere: six root tiles splitting wherever the view demands, meshed in a <b>Web Worker pool</b> from one height field — macro continents plus kilometre and metre relief bands — shared verbatim with the collision code, so what streams in is exactly what you stand on. <b>Geomorphing</b> lerps every vertex toward its parent-grid shape by view distance, so LOD transitions carry zero pop. Seas are a second quadtree wearing <b>Fresnel water</b> with analytic wave trains over true bathymetry; the sky is a <b>single-scattering raymarch</b> (Rayleigh + Mie), so noon is blue, the terminator burns red, and stars fade up through the real transmittance at dusk. The camera never leaves the origin — the planet carries the negative camera position in double precision, and the near plane follows your altitude from centimetres to orbit. Touch down and you are walking among the creatures and towers that live here — settlements rise exactly where the night-lights mask glows from orbit, craters are stamped into the field itself, and <em>X</em> calls a new one down. <em>R</em> lifts off.`;
