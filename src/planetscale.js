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
  varying vec3 vDir;
  varying vec3 vN;
  varying vec3 vView;
  ${NOISE_GLSL}

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
      float caps = smoothstep(uIceCap, uIceCap + 0.12, abs(lat) + h * 0.18);
      float snow = smoothstep(0.55, 0.7, above);
      col = mix(col, vec3(0.93, 0.95, 1.0), max(caps, snow));
      if (uCity > 0.5 && h >= uOcean) {
        float megac = smoothstep(0.35, 0.75, fbm3(p * 5.0 + sd * 2.3));
        float grid = smoothstep(0.55, 0.95, fbm(p * 26.0 + sd));
        float nightside = smoothstep(0.05, -0.22, dayS);
        emit += vec3(1.0, 0.72, 0.42) * megac * grid * nightside * 1.15;
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

    float ambient = 0.012;
    vec3 lit = col * (light * 0.95 + ambient) + spec * light * vec3(1.0, 0.98, 0.9) + emit;

    // the air between you and the ground
    float fog = 1.0 - exp(-dCam * uHazeK);
    float sunUp = clamp(dayS * 0.85 + 0.25, 0.0, 1.0);
    lit = mix(lit, uHaze * sunUp, fog);
    gl_FragColor = vec4(lit, 1.0);
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

// Single-scattering Rayleigh + Mie, marched per sky pixel (Nishita).
// Terrain pixels are depth-culled, so this shades only the sky and the limb:
// blue noon, red terminator, and stars that fade up through the residual
// transmittance at dusk — no lookup tables, no faked gradients.
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
    float sumM = 0.0;
    float odR = 0.0, odM = 0.0;
    for (int i = 0; i < N; i++) {
      vec3 x = o + dir * (t0 + (float(i) + 0.5) * dt);
      float h = length(x) - uR;
      float dR = exp(-h / uHr) * dt;
      float dM = exp(-h / uHm) * dt;
      odR += dR; odM += dM;
      // optical depth toward the sun — zero if the planet is in the way
      vec2 sg = rsi(x, uSunDir, uR);
      if (sg.x > 0.0) continue;
      float st1 = rsi(x, uSunDir, uRa).y;
      float sodR = 0.0, sodM = 0.0;
      const int M = 4;
      float sdt = st1 / float(M);
      for (int j = 0; j < M; j++) {
        vec3 y = x + uSunDir * (float(j) + 0.5) * sdt;
        float hy = length(y) - uR;
        sodR += exp(-hy / uHr) * sdt;
        sodM += exp(-hy / uHm) * sdt;
      }
      vec3 T = exp(-uBetaR * (odR + sodR) - uBetaM * 1.1 * (odM + sodM));
      sumR += T * dR;
      sumM += (T.r + T.g + T.b) / 3.0 * dM;
    }
    float mu = dot(dir, uSunDir);
    float phR = 3.0 / (16.0 * 3.14159) * (1.0 + mu * mu);
    const float g = 0.76;
    float phM = 3.0 / (8.0 * 3.14159) * (1.0 - g * g) * (1.0 + mu * mu)
      / ((2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * mu, 1.5));
    vec3 inscatter = (sumR * uBetaR * phR + vec3(sumM * uBetaM * phM)) * uSunI;
    vec3 T = exp(-uBetaR * odR - uBetaM * 1.1 * odM);
    float a = 1.0 - (T.r + T.g + T.b) / 3.0;
    gl_FragColor = vec4(inscatter, a);
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
    const atmoAmt = pp.typeId === 0 ? 0.25 : pp.typeId === 4 ? 0.4 : 1.0;
    this.hazeBase = 0.012 * atmoAmt;
    this.uHazeCol = { value: pp.atmoColor.clone().multiplyScalar(0.9).add(new THREE.Color(0.02, 0.02, 0.03)) };

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
      },
      vertexShader: TILE_VERT,
      fragmentShader: TILE_FRAG,
    });

    const hasSea = (pp.typeId === 1 || pp.typeId === 2) && pp.oceanLevel > -0.5;
    const qres = parseInt(url.searchParams.get('qr')) || 33;
    const qdepth = parseInt(url.searchParams.get('qd')) || 18;
    const qsplit = parseFloat(url.searchParams.get('qk')) || 0;
    this.quad = new QuadtreePlanet(pp, {
      R: this.R, amp: this.amp,
      res: qres, maxDepth: qdepth, splitK: qsplit,
      skirtK: url.searchParams.has('sk') ? parseFloat(url.searchParams.get('sk')) : 1,
      bathy: hasSea,
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
        vertexShader: TILE_VERT,
        fragmentShader: OCEAN_FRAG,
      });
      this.ocean = new QuadtreePlanet(pp, {
        R: this.R, amp: this.amp,
        res: qres, maxDepth: Math.min(qdepth, 12), splitK: qsplit,
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
      Math.min(Math.max(340 * Math.sqrt(lum) / Math.max(pp.a, 0.2), 150), 950));
    this.scene.add(this.sunSprite);

    // -- the sky is computed, not painted: single-scattering raymarch
    const atmoAmt2 = pp.typeId === 0 ? 0.2 : pp.typeId === 4 ? 0.5 : 1.0;
    this._camPlanet = { value: new THREE.Vector3() };
    if (url.searchParams.get('atm') !== '0' && atmoAmt2 > 0.05) {
      const beta = pp.atmoColor.clone().multiplyScalar(0.0095 * atmoAmt2);
      this.atmoShell = new THREE.Mesh(
        new THREE.SphereGeometry(this.R * 1.06, 64, 48),
        new THREE.ShaderMaterial({
          uniforms: {
            uCamPos: this._camPlanet,
            uSunDir: this.uSunDir,
            uR: { value: this.R },
            uRa: { value: this.R * 1.06 },
            uBetaR: { value: new THREE.Vector3(Math.max(beta.r, 5e-4), Math.max(beta.g, 5e-4), Math.max(beta.b, 5e-4)) },
            uBetaM: { value: 2.2e-4 * atmoAmt2 },
            uHr: { value: this.R * 0.012 },
            uHm: { value: this.R * 0.0032 },
            uSunI: { value: 15 },
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
      this.cloudMesh = new THREE.Mesh(
        new THREE.SphereGeometry(this.R * 1.014, 96, 64),
        makeCloudMaterial(pp, this._sunPosBig, this.uTime));
      this._cloudAmt = this.cloudMesh.material.uniforms.uAmt;
      this.cloudMesh.renderOrder = 1;
      this.planetGroup.add(this.cloudMesh);
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

    this.days = 0;
    this.speedDays = 12;
    this.playing = true;
    this.keys = new Set();
    this._kd = (e) => this.keys.add(e.code);
    this._ku = (e) => this.keys.delete(e.code);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);

    // duck-typed for the hyperzoom
    this.controls = { enabled: true, target: new THREE.Vector3(), update: () => {} };

    this.bloomSettings = { strength: 0.28, radius: 0.55, threshold: 0.7 };
    this._spd = 0;
    this._landing = false;
    this.walk = false;                 // on foot: gravity holds you to the crust
    this.eyeH = 0.0009;                // ~2.2 m in draw units
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
    if (!this.walk && alt < this.eyeH * 2.2) this.walk = true;
    if (this.walk && this.keys.has('KeyR')) { this.walk = false; this.camPos.addScaledVector(up, 0.004); }

    const boost = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) ? 3.4 : 1;
    this._spd = 0;
    const fwd = _fwd.copy(north).multiplyScalar(Math.cos(this.yaw)).addScaledVector(east, Math.sin(this.yaw));
    fwd.multiplyScalar(Math.cos(this.pitch)).addScaledVector(up, Math.sin(this.pitch)).normalize();
    const right = _right.crossVectors(fwd, up).normalize();
    if (this.walk) {
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

    // the tour flies itself down
    if (this.tourAutopilot && !this.walk) {
      this.yaw += dt * 0.03;
      this.pitch += (-0.35 - this.pitch) * Math.min(dt * 0.6, 1);
      const drop = (alt * 0.085 + 0.4) * dt;
      this.camPos.setLength(Math.max(this.camPos.length() - drop, surfR + 1.2));
      this._spd = alt * 0.085 + 0.4;
    }

    // never through the crust or under the waves (walking stands exactly on them)
    if (!this.walk) {
      const floor = this._groundR(_up.copy(this.camPos).normalize()) + this.eyeH;
      if (this.camPos.length() < floor) this.camPos.setLength(floor);
    }

    // the near plane follows your altitude: centimetres on foot, tens of
    // units in orbit — float depth is always spent where you are
    const near = Math.min(Math.max(alt * 0.25, 0.0004), 30);
    if (Math.abs(near - this.camera.near) > this.camera.near * 0.25) {
      this.camera.near = near;
      this.camera.updateProjectionMatrix();
    }

    // orient: local horizon stays level
    this.camera.up.copy(up);
    this.camera.lookAt(fwd);

    // camera-relative world: the planet wears the negative camera position
    this.planetGroup.position.copy(this.camPos).negate();
    this.quad.update(this.camPos);
    if (this.ocean) this.ocean.update(this.camPos);

    // -- environment
    this.uTime.value += dt;
    if (this.playing) this.days += dt * this.speedDays;
    this.uSunDir.value.applyAxisAngle(Y_AXIS, dt * 0.004);
    this._sunPosBig.value.copy(this.uSunDir.value).multiplyScalar(1e7);
    this._camPlanet.value.copy(this.camPos);
    this.sunSprite.position.copy(this.uSunDir.value).multiplyScalar(9000);
    this.uHazeK.value = this.hazeBase * Math.exp(-Math.max(alt, 0) / (this.R * 0.012));
    if (this.cloudMesh) {
      this.cloudMesh.rotation.y += dt * 0.0004;
      const deckH = this.R * 0.014;
      // thinner than the orbital ball's deck — the ground is the show here
      this._cloudAmt.value = this.pp.clouds * 0.55 *
        Math.min(Math.max((alt - deckH * 0.3) / deckH, 0.1), 1);
    }
    for (const m of this.moons) {
      const th = m.phase + m.rate * this.days;
      m.mesh.position.set(Math.cos(th) * m.dist, 0, Math.sin(th) * m.dist);
    }

  }

  landNow() {
    if (this._landing) return;
    if (this.altUnits > 420) {
      this.app.hud.setHint('too high to land — dive with f first');
      return;
    }
    this._landing = true;
    this.app.landFromPlanet(this);
  }

  // ------------------------------------------------------------ input ----
  onWheel(e) {
    // scroll = altitude, multiplicative — the Google-Earth feel
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
  }
  onKey(code) {
    if (code === 'KeyL') { this.landNow(); return true; }
    return false;
  }
  pick() { return null; }

  // -------------------------------------------------------------- hud ----
  _fmtKm(km) {
    if (km >= 100) return Math.round(km).toLocaleString() + ' km';
    if (km >= 1) return km.toFixed(1) + ' km';
    return (km * 1000).toFixed(0) + ' m';
  }

  hudStats() {
    const S = this.quad.stats;
    const spacing = this.R * (Math.PI / 2) / (1 << S.maxDepth) / (this.quad.res - 1) * this.unitKm;
    return [
      ['world', this.pp.name],
      ['class', this.pp.type + (this.pp.inhabited ? ' · inhabited' : '')],
      ['radius', Math.round(this.pp.radiusE * 6371).toLocaleString() + ' km'],
      ['mode', this.walk ? 'on foot' : 'flight'],
      ['altitude', this._fmtKm(Math.max(this.altUnits ?? 0, 0) * this.unitKm)],
      ['speed', this._spd > 0 ? this._fmtKm(this._spd * this.unitKm) + '/s' : '—'],
      ['terrain tiles', `${S.drawn} drawn · ${S.cached} cached${S.pending ? ` · ${S.pending} streaming` : ''}`],
      ...(this.ocean ? [['sea tiles', `${this.ocean.stats.drawn} drawn · ${this.ocean.stats.cached} cached`]] : []),
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
    this.quad.dispose();
    if (this.ocean) this.ocean.dispose();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

// scratch vectors
const _up = new THREE.Vector3();
const _east = new THREE.Vector3();
const _north = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();

export const PLANET_NOTE = `One continuous scale, orbit to boots. The planet is a <b>chunked-LOD quadtree</b> on a tangent-warped cube sphere: six root tiles splitting wherever the view demands, meshed in a <b>Web Worker pool</b> from one height field — macro continents plus kilometre and metre relief bands — shared verbatim with the collision code, so what streams in is exactly what you stand on. <b>Geomorphing</b> lerps every vertex toward its parent-grid shape by view distance, so LOD transitions carry zero pop. Seas are a second quadtree wearing <b>Fresnel water</b> with analytic wave trains over true bathymetry; the sky is a <b>single-scattering raymarch</b> (Rayleigh + Mie), so noon is blue, the terminator burns red, and stars fade up through the real transmittance at dusk. The camera never leaves the origin — the planet carries the negative camera position in double precision, and the near plane follows your altitude from centimetres to orbit. Touch down and you are walking; <em>R</em> lifts off; <em>L</em> steps into the wild.`;
