// SCALE 3½ — INSIDE A GIANT
//
// Gas giants have no ground to land on; what they have is weather the size
// of worlds. This scale drops you between the cloud decks: infinite
// procedural stratus sheets sampled from the planet's own palette, cumulus
// towers drifting past, haze in every direction, the star a smeared lamp
// overhead — and now and then, lightning somewhere below the deck.
// Fly toward where you look. There is no bottom you would ever reach.

import * as THREE from 'three';
import { RNG, arand, hash } from './rng.js';
import { NOISE_GLSL } from './planet.js';
import { nebulaTexture, softDotTexture } from './nebula.js';

const DECK_VERT = /* glsl */`
  varying vec3 vW;
  void main() {
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }
`;

const DECK_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uColA;      // lit cloud
  uniform vec3 uColB;      // shadowed cloud
  uniform vec3 uHaze;
  uniform vec3 uCam;
  uniform float uSeed;
  uniform float uTime;
  uniform float uDensity;
  uniform vec4 uFlash;     // xyz world pos, w intensity
  varying vec3 vW;
  ${NOISE_GLSL}

  void main() {
    vec2 p = vW.xz * 0.0016;
    vec2 drift = vec2(uTime * 0.004, uTime * 0.0007);
    float w = fbm3(vec3(p * 1.7 + drift * 0.5, uSeed)) * 0.8;
    float n = fbm(vec3(p + drift + w * 0.3, uSeed * 1.7));
    float a = smoothstep(0.5 - uDensity * 0.3, 0.75, n * 0.5 + 0.5);

    float lit = clamp(uSunDir.y, 0.05, 1.0);
    float shade = fbm3(vec3(p * 3.1 + drift, uSeed + 9.0)) * 0.5 + 0.5;
    vec3 col = mix(uColB * 0.5, uColA * 0.85, shade) * (0.22 + 0.65 * lit);

    // lightning: inverse-square glow from the strike point
    vec3 fd = vW - uFlash.xyz;
    col += vec3(0.75, 0.8, 1.0) * uFlash.w * 3.5 / (1.0 + dot(fd, fd) * 4e-6);

    // haze with distance
    float dist = length(vW - uCam);
    float fog = 1.0 - exp(-dist * 0.00026);
    col = mix(col, uHaze * (0.12 + 0.4 * lit), fog);
    a *= smoothstep(11000.0, 3500.0, dist) * 0.85;

    gl_FragColor = vec4(col, a);
  }
`;

const SKYG_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const SKYG_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uUp;        // zenith haze
  uniform vec3 uDown;      // the deep below
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float t = d.y * 0.5 + 0.5;
    vec3 col = mix(uDown * 0.14, uUp, smoothstep(0.18, 0.75, t));
    // the star, smeared by kilometers of hydrogen
    float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
    col += uSunColor * exp(-ang * 5.5) * 0.4;
    col += uSunColor * exp(-ang * 26.0) * 1.1;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class CloudsScale {
  constructor(app, ctx) {
    this.app = app;
    this.kind = 'clouds';
    this.ctx = ctx;
    const pp = this.pp = ctx.planet;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, 1, 0.5, 40000);
    this.camera.position.set(0, 0, 0);

    this.playing = true;
    this.speed = 1;         // cruise multiplier
    this.yaw = 0.4; this.pitch = -0.04;
    this.time = 0;
    this._drag = null;

    this.uSunDir = { value: new THREE.Vector3(0.4, 0.55, 0.6).normalize() };
    this.uSunColor = { value: ctx.sunColor.clone() };
    this.uTime = { value: 0 };
    this.uCam = { value: this.camera.position };
    this.uFlash = { value: new THREE.Vector4(0, 0, 0, 0) };

    const r = new RNG(hash(pp.seed, 0xc10d));
    this.haze = pp.colA.clone().lerp(pp.colB, 0.4);

    this._buildSky();
    this._buildDecks(r);
    this._buildTowers(r);

    this._nextBolt = r.float(3, 8);

    this.controls = { // duck-typed for the hyperzoom
      enabled: false,
      target: new THREE.Vector3(600, -40, 260),
      update: () => {},
    };
    this.camera.lookAt(this.controls.target);
    this._syncAngles();

    this.bloomSettings = { strength: 0.5, radius: 0.7, threshold: 0.3 };
    this._bindKeys();
  }

  _buildSky() {
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(30000, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: this.uSunDir, uSunColor: this.uSunColor,
          uUp: { value: this.haze.clone().multiplyScalar(0.38) },
          uDown: { value: this.pp.colB.clone().multiplyScalar(0.2) },
        },
        vertexShader: SKYG_VERT, fragmentShader: SKYG_FRAG,
        side: THREE.BackSide, depthWrite: false,
      }));
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  _buildDecks(r) {
    this.decks = [];
    const levels = [340, 150, -170, -340, -520];
    for (let i = 0; i < levels.length; i++) {
      const geo = new THREE.PlaneGeometry(26000, 26000, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: this.uSunDir, uSunColor: this.uSunColor,
          uColA: { value: this.pp.colA.clone().lerp(new THREE.Color(1, 1, 1), 0.35) },
          uColB: { value: this.pp.colB.clone().multiplyScalar(0.75) },
          uHaze: { value: this.haze },
          uCam: this.uCam,
          uSeed: { value: this.pp.noiseSeed + i * 7.3 },
          uTime: this.uTime,
          uDensity: { value: r.float(0.5, 0.95) },
          uFlash: this.uFlash,
        },
        vertexShader: DECK_VERT, fragmentShader: DECK_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = levels[i];
      mesh.renderOrder = 10 - i; // farthest-below first
      this.scene.add(mesh);
      this.decks.push(mesh);
    }
  }

  _buildTowers(r) {
    // cumulus the size of continents, drifting past the hull
    this.towers = [];
    const tex = nebulaTexture(hash(this.pp.seed, 5), 256);
    const tint = this.pp.colA.clone().lerp(new THREE.Color(1, 1, 1), 0.25);
    for (let i = 0; i < 70; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: tint.clone().multiplyScalar(r.float(0.14, 0.3)),
        transparent: true, depthWrite: false, opacity: 0.6,
        rotation: r.float(0, Math.PI * 2),
      }));
      sp.position.set(r.float(-6000, 6000), r.float(-420, 300), r.float(-6000, 6000));
      sp.scale.set(r.float(700, 2100), r.float(500, 1400), 1);
      this.scene.add(sp);
      this.towers.push(sp);
    }
    // the strike glow itself
    this.boltSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDotTexture(), color: new THREE.Color(2.2, 2.3, 3.0),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
    }));
    this.boltSprite.scale.setScalar(900);
    this.scene.add(this.boltSprite);
  }

  _bindKeys() {
    this._keys = new Set();
    this._kd = (e) => this._keys.add(e.code);
    this._ku = (e) => this._keys.delete(e.code);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
  }

  onPointerDown(e) { this._drag = { x: e.clientX, y: e.clientY }; }
  onPointerUp() { this._drag = null; }
  onPointerMove(e) {
    if (!this._drag) return;
    this.yaw -= (e.clientX - this._drag.x) * 0.0032;
    this.pitch = Math.min(Math.max(this.pitch - (e.clientY - this._drag.y) * 0.003, -0.7), 0.7);
    this._drag = { x: e.clientX, y: e.clientY };
  }
  _syncAngles() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(Math.min(Math.max(d.y, -1), 1));
  }

  update(dt) {
    this.time += dt;
    this.uTime.value = this.time;

    if (this.controls.enabled) {
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      if (this.playing) {
        // cruise toward the gaze; W/S trims
        let v = 60 * this.speed;
        if (this._keys.has('KeyW')) v *= 2.2;
        if (this._keys.has('KeyS')) v *= 0.3;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this.camera.position.addScaledVector(fwd, v * dt);
        this.camera.position.y = Math.min(Math.max(this.camera.position.y, -560), 420);
      }
    }

    // decks and towers ride along; the noise field stays put in world space
    for (const d of this.decks) {
      d.position.x = this.camera.position.x;
      d.position.z = this.camera.position.z;
    }
    for (const t of this.towers) {
      const dx = t.position.x - this.camera.position.x;
      const dz = t.position.z - this.camera.position.z;
      if (Math.abs(dx) > 6500) t.position.x -= Math.sign(dx) * 13000;
      if (Math.abs(dz) > 6500) t.position.z -= Math.sign(dz) * 13000;
    }

    // the sun wheels slowly — fast rotators, these giants
    const az = this.time * 0.008 + 0.6;
    this.uSunDir.value.set(Math.cos(az) * 0.75, 0.5 + 0.2 * Math.sin(this.time * 0.01), Math.sin(az) * 0.75).normalize();

    // lightning
    this._nextBolt -= dt;
    const F = this.uFlash.value;
    if (this._nextBolt <= 0) {
      this._nextBolt = 3 + arand() * 11;
      const th = arand() * Math.PI * 2;
      const d = 1200 + arand() * 3800;
      F.set(
        this.camera.position.x + Math.cos(th) * d,
        -380 - arand() * 160,
        this.camera.position.z + Math.sin(th) * d,
        1.0);
      this.boltSprite.position.set(F.x, F.y, F.z);
    }
    if (F.w > 0) {
      F.w = Math.max(F.w - dt * 2.6, 0);
      // a couple of restrikes
      if (F.w > 0.25 && arand() < 0.09) F.w = Math.min(F.w + 0.5, 1);
      this.boltSprite.material.opacity = F.w;
    }
  }

  togglePlay() { this.playing = !this.playing; }
  speedUp() { this.speed = Math.min(this.speed * 1.6, 8); }
  slowDown() { this.speed = Math.max(this.speed / 1.6, 0.2); }
  timeReadout() { return `cruise ×${this.speed.toFixed(1)}`; }

  hudStats() {
    const pp = this.pp;
    const wind = Math.round(Math.abs(pp.spin) * 4800 + 300);
    return [
      ['world', pp.name],
      ['class', pp.type + ' — no surface, ever'],
      ['deck', '≈ 0.7 bar, ' + pp.Teq + ' K'],
      ['zonal winds', wind.toLocaleString() + ' km/h'],
      ['below', 'metallic hydrogen, ' + (pp.massE / 318).toFixed(2) + ' M♃ of it'],
    ];
  }

  /** hyperzoom: arrive falling out of the upper haze */
  arriveFrom(rest) {
    return rest.clone().add(new THREE.Vector3(-300, 1600, 500));
  }

  pick() { return null; }
  onKey() { return false; }
  enter() { this.controls.enabled = true; }
  exit() { this.controls.enabled = false; }
  resume() { this.controls.enabled = true; }

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

export const CLOUDS_NOTE = `There is nothing to stand on here and never will be: pressure just keeps rising until hydrogen forgets how to be a gas. So you fly. The decks are the planet's own palette breathing in world-space noise — steer into a cumulus tower and it swallows the view; wait long enough and lightning goes off below the deck, as it does on Jupiter, where single bolts carry a thousand times the energy of ours. The wind figure is honest for a fast rotator. The bottom of this world is thousands of kilometers of glowing metal.`;
