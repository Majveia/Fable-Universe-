// SCALE 3 — STANDING ON A WORLD
//
// Descend from orbit and the planet becomes a place: a heightfield carved by
// the same palette that painted it from space, under a sky whose sun is the
// system's actual star — correct color, correct angular size for this orbit.
// Walk (WASD, drag to look), or press F and fly. The day turns; when the sun
// sets on an inhabited world, the glow of cities rises over the ridgeline.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { NOISE_GLSL, makeSurfaceMaterial, makeRingMaterial, makeAtmosphereMaterial } from './planet.js';
import { softDotTexture } from './nebula.js';

const EXT = 1400;            // terrain extent, ~metres
const RES = 180;             // heightfield resolution
const EYE = 1.8;

// ---------------------------------------------------------- JS fbm ---------
function makeNoise(seed) {
  const r = new RNG(hash(seed, 0x7e44));
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = r.int(0, i);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    return (1 - v) * ((1 - u) * grad(perm[a], x, y) + u * grad(perm[b], x - 1, y)) +
           v * ((1 - u) * grad(perm[a + 1], x, y - 1) + u * grad(perm[b + 1], x - 1, y - 1));
  };
}

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
  varying vec3 vW;
  varying vec3 vN;
  ${NOISE_GLSL}

  void main() {
    vec3 n = normalize(vN);
    float hgt = vW.y / uAmp;
    float slope = 1.0 - n.y;
    vec3 sd = vec3(uSeed * 3.7, uSeed * 1.3, uSeed * 9.2);

    float detail = fbm(vec3(vW.xz * 0.02, uSeed)) * 0.5 + 0.5;
    float micro  = fbm3(vec3(vW.xz * 0.35, uSeed * 2.0)) * 0.5 + 0.5;

    vec3 col = mix(uColC, uColA, smoothstep(0.02, 0.45, hgt + detail * 0.25));
    col = mix(col, uColB, smoothstep(0.35, 0.85, hgt) * 0.8);
    col = mix(col, uColB * 0.85, smoothstep(0.25, 0.6, slope));
    col = mix(col, vec3(0.92, 0.95, 1.0), uSnow * smoothstep(0.55, 0.8, hgt + micro * 0.1));
    col *= 0.82 + 0.36 * detail * micro;

    float diff = max(dot(n, uSunDir), 0.0);
    float dusk = smoothstep(-0.12, 0.12, uSunDir.y);
    vec3 lit = col * (uSunColor * diff * 1.15 + vec3(0.012, 0.014, 0.02) + uHorizon * 0.22 * dusk);

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
    lit = mix(lit, uHorizon * max(dusk, 0.08), 1.0 - exp(-dist * 0.0007));
    gl_FragColor = vec4(lit, 1.0);
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

    gl_FragColor = vec4(sky + sun + stars, 1.0);
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
  varying vec3 vW;
  varying vec3 vN;
  ${NOISE_GLSL}

  void main() {
    vec2 p = vW.xz * 0.06;
    vec3 n = normalize(vec3(
      snoise(vec3(p, uTime * 0.14 + uSeed)) * 0.06 +
      snoise(vec3(p * 3.7, uTime * 0.3)) * 0.025,
      1.0,
      snoise(vec3(p + 40.0, uTime * 0.17)) * 0.06));
    vec3 view = normalize(uCam - vW);
    float fres = pow(1.0 - max(dot(view, n), 0.0), 3.0);
    float day = smoothstep(-0.15, 0.25, uSunDir.y);
    vec3 col = mix(uDeep * (0.25 + 0.75 * day), uHorizon * day, fres * 0.85);
    float spec = pow(max(dot(reflect(-uSunDir, n), view), 0.0), 240.0);
    col += uSunColor * spec * 2.2 * day;
    float dist = length(vW - uCam);
    col = mix(col, uHorizon * max(day, 0.08), 1.0 - exp(-dist * 0.0007));
    gl_FragColor = vec4(col, 1.0);
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

    const atmoStrength = pp.typeId === 0 ? 0.25 : pp.typeId === 4 ? 0.4 : 1.0;
    this.atmo = atmoStrength;
    this.horizonColor = pp.atmoColor.clone().multiplyScalar(0.5).add(new THREE.Color(0.04, 0.04, 0.05));
    this.zenithColor = pp.atmoColor.clone().multiplyScalar(0.26);

    this._buildTerrain();
    this._buildSky();
    if (this.seaLevel !== null) this._buildOcean();
    this._buildRocks();
    if (pp.inhabited) this._buildCityGlow();
    if (ctx.parentGiant) this._buildParentGiant(ctx.parentGiant);
    this._buildSiblings();

    // spawn on land, eyes toward the sunrise
    const spawn = this._findSpawn();
    this.camera.position.set(spawn.x, spawn.y + EYE, spawn.z);
    this.controls = { // duck-typed for the hyperzoom
      enabled: false,
      target: new THREE.Vector3(spawn.x + 60, spawn.y + 4, spawn.z - 40),
      update: () => {},
    };
    this.camera.lookAt(this.controls.target);
    this._syncAngles();

    this.bloomSettings = { strength: 0.5, radius: 0.6, threshold: 0.35 };
    this._bindInput();
  }

  // --------------------------------------------------------- building ----
  _buildTerrain() {
    const pp = this.pp;
    const noise = makeNoise(pp.seed);
    const fbm = (x, y, oct, lac = 2.03) => {
      let v = 0, a = 0.5, f = 1;
      for (let o = 0; o < oct; o++) { v += a * noise(x * f, y * f); a *= 0.5; f *= lac; }
      return v;
    };

    const type = pp.typeId;
    this.amp = type === 0 ? 90 : type === 3 ? 45 : type === 4 ? 55 : type === 2 ? 60 : 75;
    const base = type === 2 ? -28 : -6;   // ocean worlds: mostly drowned
    this.seaLevel = (type === 1 && pp.oceanLevel > -0.5) || type === 2 ? 0 : null;
    if (type === 3 && Math.random() < 0) this.seaLevel = null; // ice: frozen, no sea

    const geo = new THREE.PlaneGeometry(EXT, EXT, RES - 1, RES - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    this.heights = new Float32Array(RES * RES);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      let h = fbm(x * 0.0016 + 7.3, z * 0.0016 - 2.1, 6) * this.amp * 1.6
        + fbm(x * 0.008 + 31.7, z * 0.008 + 11.3, 4) * this.amp * 0.22
        + base;
      if (type === 0) h += Math.abs(fbm(x * 0.004 - 9., z * 0.004 + 4., 3)) * this.amp * 0.5; // harsher relief
      pos.setY(i, h);
      this.heights[i] = h;
    }
    geo.computeVertexNormals();

    const snow = this.pp.iceCap < 1.5 || type === 3 ? (type === 3 ? 1 : 0.5) : 0;
    this.terrain = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: this.uSunDir, uSunColor: this.uSunColor,
        uColA: { value: pp.colA }, uColB: { value: pp.colB }, uColC: { value: pp.colC },
        uHorizon: { value: this.horizonColor },
        uCam: this.uCam,
        uSeed: { value: pp.noiseSeed },
        uAmp: { value: this.amp },
        uSnow: { value: snow },
        uLava: { value: type === 4 ? 1 : 0 },
        uTime: this.uTime,
      },
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
    }));
    this.scene.add(this.terrain);
  }

  heightAt(x, z) {
    const gx = (x / EXT + 0.5) * (RES - 1);
    const gz = (z / EXT + 0.5) * (RES - 1);
    const i = Math.min(Math.max(Math.floor(gx), 0), RES - 2);
    const j = Math.min(Math.max(Math.floor(gz), 0), RES - 2);
    const fx = gx - i, fz = gz - j;
    const at = (a, b) => this.heights[b * RES + a];
    return at(i, j) * (1 - fx) * (1 - fz) + at(i + 1, j) * fx * (1 - fz) +
           at(i, j + 1) * (1 - fx) * fz + at(i + 1, j + 1) * fx * fz;
  }

  _findSpawn() {
    // walk outward until we stand on dry, gentle ground
    for (let rad = 0; rad < EXT * 0.4; rad += 17) {
      for (let th = 0; th < 6.28; th += 0.9) {
        const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
        const h = this.heightAt(x, z);
        if ((this.seaLevel === null || h > this.seaLevel + 3) && h < this.amp * 0.7) {
          return new THREE.Vector3(x, h, z);
        }
      }
    }
    // waterlocked tile: raise the seabed until the highest point is a shore
    let bi = 0;
    for (let i = 1; i < this.heights.length; i++) if (this.heights[i] > this.heights[bi]) bi = i;
    if (this.seaLevel !== null && this.heights[bi] < this.seaLevel + 3) {
      const lift = this.seaLevel + 5 - this.heights[bi];
      const pos = this.terrain.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        this.heights[i] += lift;
        pos.setY(i, this.heights[i]);
      }
      pos.needsUpdate = true;
      this.terrain.geometry.computeVertexNormals();
    }
    const ix = bi % RES, iy = (bi / RES) | 0;
    const cell = EXT / (RES - 1);
    return new THREE.Vector3(-EXT / 2 + ix * cell, this.heights[bi], -EXT / 2 + iy * cell);
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
  }

  _buildOcean() {
    const geo = new THREE.PlaneGeometry(EXT * 4, EXT * 4, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.ocean = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: this.uSunDir, uSunColor: this.uSunColor,
        uHorizon: { value: this.horizonColor },
        uDeep: { value: this.pp.typeId === 2 ? this.pp.colA : new THREE.Color(0.02, 0.1, 0.2) },
        uCam: this.uCam,
        uTime: this.uTime,
        uSeed: { value: this.pp.noiseSeed },
      },
      vertexShader: TERRAIN_VERT,
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
  }

  _sunDirAt(ph, out) {
    return out.set(Math.cos(ph) * 0.9, Math.sin(ph), Math.sin(ph * 0.7) * 0.45 + 0.2).normalize();
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
    return false;
  }

  // ------------------------------------------------------------- loop ----
  update(dt) {
    if (this.playing) this.sunPhase += this.dayRate * dt * this.speed;
    this.uTime.value += dt;

    // sun path: tilted circle, so it rises and sets off-axis
    const ph = this.sunPhase;
    this._sunDirAt(ph, this.uSunDir.value);
    if (this.giant) {
      this.uSunPosFar.value.copy(this.uSunDir.value).multiplyScalar(1e7);
      this.giant.rotation.y += dt * 0.004; // the giant's own slow day
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

    // movement (skip while the hyperzoom still owns the camera)
    if (this.controls.enabled) {
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      const speed = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 60 : 16) * (this.fly ? 3 : 1);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      if (!this.fly) { fwd.y = 0; fwd.normalize(); }
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const acc = new THREE.Vector3();
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) acc.add(fwd);
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) acc.sub(fwd);
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) acc.add(right);
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) acc.sub(right);
      if (acc.lengthSq() > 0) acc.normalize().multiplyScalar(speed);
      this.vel.lerp(acc, 1 - Math.exp(-6 * dt));
      this.camera.position.addScaledVector(this.vel, dt);

      // stay inside the tile, feet on the ground
      const p = this.camera.position;
      p.x = Math.min(Math.max(p.x, -EXT * 0.48), EXT * 0.48);
      p.z = Math.min(Math.max(p.z, -EXT * 0.48), EXT * 0.48);
      const ground = Math.max(this.heightAt(p.x, p.z), this.seaLevel === null ? -1e9 : this.seaLevel) + EYE;
      if (this.fly) p.y = Math.max(p.y, ground);
      else p.y += (ground - p.y) * (1 - Math.exp(-12 * dt));
    }
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
      ['surface gravity', g.toFixed(2) + ' g'],
      ['equilibrium temp', pp.Teq + ' K'],
      ['mode', this.fly ? 'flight (f to walk)' : 'on foot (f to fly)'],
    ];
  }

  /** the hyperzoom lands us from the sky, not from underground */
  arriveFrom(rest) {
    return rest.clone().add(new THREE.Vector3(-40, 300, 160));
  }

  pick() { return null; }
  enter() { this.controls.enabled = true; }
  exit() { this.controls.enabled = false; }
  resume() { this.controls.enabled = true; }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

export const SURFACE_NOTE = `Boots on regolith. The terrain is the same noise field that painted this world from orbit; the sun overhead is the system's actual star — its color is its blackbody temperature and its apparent size follows from this orbit's true semi-major axis. Surface gravity in the readout is GM/R² from the world's real mass and radius. Walk with <em>WASD</em>, drag to look, <em>F</em> to fly, and let the day run: on inhabited worlds, the cities rise with the dark.`;
