// SCALE 2 — STAR SYSTEM
//
// Every system is seeded from the star you clicked in the galaxy. The star's
// mass sets its temperature, luminosity and color through main-sequence
// scaling relations; planets obey Kepler. Positions come from solving
// Kepler's equation M = E − e·sin E by Newton iteration every frame — real
// two-body mechanics, with periods from Kepler's third law: P² = a³/M★.
// Orbital radii are gently compressed (r^0.62) so worlds stay visible;
// the HUD reports true values.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { hash, RNG, starName, planetName } from './rng.js';
import { makeSkyDome } from './starfield.js';
import { softDotTexture } from './nebula.js';
import {
  makeSurfaceMaterial, makeCloudMaterial, makeAtmosphereMaterial,
  makeStarSurfaceMaterial, makeRingMaterial, blackbodyRGB,
} from './planet.js';

const AU_DRAW = 46;      // display units at 1 AU
const R_EXP = 0.62;      // orbital compression exponent

const TYPE_IDS = { barren: 0, terrestrial: 1, ocean: 2, ice: 3, lava: 4, 'gas giant': 5, 'ice giant': 6 };

const drawR = (au) => AU_DRAW * Math.pow(Math.max(au, 0.01), R_EXP);

function spectralClass(T) {
  return T > 30000 ? 'O' : T > 10000 ? 'B' : T > 7500 ? 'A' : T > 6000 ? 'F'
    : T > 5200 ? 'G' : T > 3700 ? 'K' : 'M';
}

const CIV_NOTES = [
  'Radio chatter on a thousand frequencies. Somebody down there is arguing about sports.',
  'Night side lit like a circuit board. Customs asks that you declare all exotic matter.',
  'An old beacon still loops a lullaby in a dead language.',
  'Orbital lanes are busy tonight. Mind the tug traffic.',
  'They terraformed the coastlines twice and still complain about the weather.',
];
const DEAD_NOTES = [
  'No signals. Just weather, geology, and time.',
  'A world waiting for its first name to matter.',
  'Wind, rock, and a horizon nobody has ever seen.',
];

// ----------------------------------------------------------- generation ----

export function systemParams(starSeed) {
  const r = new RNG(hash(starSeed, 0x5f5));
  const name = starName(starSeed);

  // star from the main sequence (with occasional evolved outliers)
  let mass = r.power(0.25, 5.0, 2.2);
  let temp = 5772 * Math.pow(mass, 0.54);
  let lum = Math.pow(mass, 3.6);
  let radiusSun = Math.pow(mass, 0.85);
  let stage = 'main sequence';
  const roll = r.next();
  if (roll < 0.07) { stage = 'red giant'; temp = r.float(3300, 4300); radiusSun = r.float(12, 45); lum = radiusSun * radiusSun * Math.pow(temp / 5772, 4); }
  else if (roll < 0.10) { stage = 'white dwarf'; temp = r.float(9000, 26000); radiusSun = 0.013; lum = 0.001 * (temp / 10000) ** 4; }

  const hz = Math.sqrt(lum);            // habitable-zone center, AU
  const frost = 2.7 * Math.sqrt(lum);   // frost line, AU

  const nPlanets = stage === 'white dwarf' ? r.int(0, 2) : r.int(2, 8);
  const planets = [];
  let a = r.float(0.28, 0.5) * Math.max(Math.sqrt(lum), 0.35);
  for (let i = 0; i < nPlanets; i++) {
    const pr = new RNG(hash(starSeed, 0x914, i));
    let type, massE, radiusE;
    if (a > frost) {
      const t = pr.next();
      type = t < 0.5 ? 'gas giant' : t < 0.78 ? 'ice giant' : 'ice';
    } else if (a > hz * 0.78 && a < hz * 1.6) {
      type = pr.next() < 0.62 ? 'terrestrial' : 'ocean';
    } else if (a < hz * 0.35) {
      type = pr.next() < 0.3 ? 'lava' : 'barren';
    } else {
      type = pr.next() < 0.75 ? 'barren' : 'terrestrial';
    }
    if (type === 'gas giant') { massE = pr.float(40, 380); radiusE = pr.float(8.5, 12.5); }
    else if (type === 'ice giant') { massE = pr.float(10, 30); radiusE = pr.float(3.4, 4.6); }
    else { massE = pr.power(0.1, 3.2, 1.8); radiusE = Math.pow(massE, 0.28); }

    const inhabited = (type === 'terrestrial' || type === 'ocean') && pr.chance(0.45);
    const e = Math.min(Math.abs(pr.gauss()) * 0.055 + 0.004 + (pr.chance(0.06) ? pr.float(0.15, 0.3) : 0), 0.42);
    const albedo = type === 'ice' ? 0.55 : type === 'ocean' ? 0.3 : 0.25;
    const Teq = Math.round(278 * Math.pow(lum, 0.25) / Math.sqrt(a) * Math.pow(1 - albedo, 0.25));

    // palette per species
    const hue = pr.next();
    let colA, colB, colC, atmoColor, oceanLevel = -1, clouds = 0, iceCap = 2.0, ringColor;
    switch (type) {
      case 'terrestrial':
        colA = new THREE.Color().setHSL(0.09 + hue * 0.05, 0.45, 0.32);   // soil
        colB = new THREE.Color().setHSL(0.07, 0.25, 0.55);                 // peaks
        colC = new THREE.Color().setHSL(0.32 + hue * 0.1, 0.5, inhabited ? 0.3 : 0.22); // veg/shallows
        atmoColor = new THREE.Color(0.28, 0.5, 1.0);
        oceanLevel = pr.float(-0.05, 0.16); clouds = pr.float(0.45, 0.75); iceCap = pr.float(0.72, 0.92);
        break;
      case 'ocean':
        colA = new THREE.Color(0.02, 0.09, 0.28); colB = new THREE.Color(0.5, 0.52, 0.5);
        colC = new THREE.Color(0.1, 0.35, 0.5);
        atmoColor = new THREE.Color(0.25, 0.55, 1.0);
        oceanLevel = pr.float(0.3, 0.5); clouds = pr.float(0.5, 0.85); iceCap = pr.float(0.8, 0.95);
        break;
      case 'ice':
        colA = new THREE.Color(0.75, 0.82, 0.9); colB = new THREE.Color(0.92, 0.96, 1.0);
        colC = new THREE.Color(0.3, 0.55, 0.75);
        atmoColor = new THREE.Color(0.5, 0.75, 1.0).multiplyScalar(0.5);
        clouds = pr.float(0, 0.25); iceCap = 0.0;
        break;
      case 'lava':
        colA = new THREE.Color(0.23, 0.16, 0.13); colB = new THREE.Color(0.1, 0.08, 0.08);
        colC = new THREE.Color(1.0, 0.32, 0.06);
        atmoColor = new THREE.Color(1.0, 0.4, 0.15).multiplyScalar(0.45);
        break;
      case 'gas giant': {
        const warm = pr.chance(0.6);
        colA = warm ? new THREE.Color().setHSL(0.07 + hue * 0.05, 0.5, 0.5) : new THREE.Color().setHSL(0.55 + hue * 0.1, 0.3, 0.45);
        colB = warm ? new THREE.Color().setHSL(0.1 + hue * 0.06, 0.45, 0.34) : new THREE.Color().setHSL(0.6 + hue * 0.08, 0.35, 0.3);
        colC = warm ? new THREE.Color(0.85, 0.5, 0.3) : new THREE.Color(0.8, 0.85, 0.95);
        atmoColor = colA.clone().multiplyScalar(0.55);
        ringColor = new THREE.Color().setHSL(0.08 + hue * 0.04, 0.2, 0.55);
        break;
      }
      case 'ice giant':
        colA = new THREE.Color().setHSL(0.5 + hue * 0.08, 0.55, 0.5);
        colB = new THREE.Color().setHSL(0.55 + hue * 0.08, 0.6, 0.35);
        colC = new THREE.Color(0.85, 0.92, 1.0);
        atmoColor = colA.clone().multiplyScalar(0.6);
        ringColor = new THREE.Color(0.55, 0.6, 0.7);
        break;
      default: // barren
        colA = new THREE.Color().setHSL(0.06 + hue * 0.06, 0.18, 0.32);
        colB = new THREE.Color().setHSL(0.08, 0.1, 0.5);
        colC = new THREE.Color().setHSL(0.05, 0.2, 0.2);
        atmoColor = new THREE.Color(0.4, 0.35, 0.3).multiplyScalar(0.15);
        iceCap = pr.chance(0.4) ? pr.float(0.85, 0.95) : 2.0;
    }

    planets.push({
      index: i,
      name: planetName(name, i, starSeed),
      type, typeId: TYPE_IDS[type],
      inhabited,
      a, e,
      inc: Math.abs(pr.gauss()) * 0.03,
      Omega: pr.float(0, Math.PI * 2),
      omega: pr.float(0, Math.PI * 2),
      M0: pr.float(0, Math.PI * 2),
      periodYears: Math.sqrt(a * a * a / mass),
      massE, radiusE,
      drawRadius: Math.min(1.35 * Math.pow(radiusE, 0.45), 6),
      spin: pr.float(0.02, 0.12) * pr.sign(),
      tilt: Math.abs(pr.gauss()) * 0.3,
      Teq,
      noiseSeed: pr.float(0, 100),
      colA, colB, colC, atmoColor, oceanLevel, clouds, iceCap,
      hasRings: (type === 'gas giant' && pr.chance(0.45)) || (type === 'ice giant' && pr.chance(0.25)),
      ringColor,
      moons: type.includes('giant') ? pr.int(1, 4) : (pr.chance(0.3) ? 1 : 0),
      note: inhabited ? CIV_NOTES[pr.int(0, CIV_NOTES.length - 1)] : DEAD_NOTES[pr.int(0, DEAD_NOTES.length - 1)],
      seed: hash(starSeed, 0x914, i),
    });
    a *= r.float(1.5, 1.95);
  }

  // asteroid belt in the widest gap (if any)
  let belt = null;
  if (planets.length >= 2 && r.chance(0.75)) {
    let gi = 0, gr = 0;
    for (let i = 0; i < planets.length - 1; i++) {
      const ratio = planets[i + 1].a / planets[i].a;
      if (ratio > gr) { gr = ratio; gi = i; }
    }
    if (gr > 1.7) belt = { a: Math.sqrt(planets[gi].a * planets[gi + 1].a), width: 0.16 };
  }

  return {
    seed: starSeed, name, mass, temp, lum, radiusSun, stage,
    spectral: spectralClass(temp), hz, frost, planets, belt,
    comet: r.chance(0.55) ? { a: Math.max(frost * 1.6, 3), e: r.float(0.86, 0.96), inc: r.float(0.2, 0.9), Omega: r.float(0, 6.28), omega: r.float(0, 6.28), M0: r.float(0, 6.28) } : null,
  };
}

/** Kepler's equation solver → position in the orbital plane (real AU) */
function keplerPos(el, tYears, massStar, out) {
  const n = (2 * Math.PI) / Math.sqrt(el.a ** 3 / massStar); // rad / yr
  const M = el.M0 + n * tYears;
  let E = M;
  for (let i = 0; i < 6; i++) E -= (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
  const rAU = el.a * (1 - el.e * Math.cos(E));
  // perifocal → ecliptic (Ω, i, ω)
  const co = Math.cos(el.omega + nu), so = Math.sin(el.omega + nu);
  const cO = Math.cos(el.Omega), sO = Math.sin(el.Omega);
  const ci = Math.cos(el.inc), si = Math.sin(el.inc);
  const x = cO * co - sO * so * ci;
  const z = sO * co + cO * so * ci;
  const y = so * si;
  const rd = drawR(rAU);
  out.set(x * rd, y * rd, z * rd);
  out.rAU = rAU;
  return out;
}

// ------------------------------------------------------------- the scale ----

export class SystemScale {
  constructor(app, ctx) {
    this.app = app;
    this.kind = 'system';
    this.ctx = ctx;
    this.params = systemParams(ctx.starSeed);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 60000);

    this.days = 0;
    this.speedDays = 12;      // sim-days per real second
    this.playing = true;
    this.focusIndex = -1;     // -1 = star
    this.selection = null;

    this.uSunPos = { value: new THREE.Vector3(0, 0, 0) };
    this.uCamPos = { value: this.camera.position };
    this.uTime = { value: 0 };

    this._build();

    const far = this.params.planets.length
      ? drawR(this.params.planets[this.params.planets.length - 1].a) : AU_DRAW * 2;
    this.camera.position.set(far * 0.5, far * 0.42, far * 1.15);

    this.controls = new OrbitControls(this.camera, app.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.55;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = far * 4 + 200;
    this._prevTarget = new THREE.Vector3();

    this.bloomSettings = { strength: 0.75, radius: 0.65, threshold: 0.0 };
  }

  _build() {
    const P = this.params;
    const r = new RNG(hash(P.seed, 0xb01d));

    // -- sky
    this.scene.add(makeSkyDome(P.seed, 18000));

    // -- star
    this.starColor = blackbodyRGB(P.temp);
    this.starDrawR = Math.min(Math.max(5.5 * Math.pow(P.radiusSun, 0.5), 2.2), 30);
    const starGeo = new THREE.SphereGeometry(this.starDrawR, 64, 48);
    this.starMesh = new THREE.Mesh(starGeo, makeStarSurfaceMaterial(this.starColor, r.float(0, 90), this.uCamPos, this.uTime));
    this.scene.add(this.starMesh);
    const glowTex = softDotTexture();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: this.starColor.clone().multiplyScalar(0.8),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    glow.scale.setScalar(this.starDrawR * 10);
    this.scene.add(glow);

    // -- planets
    this.planetNodes = [];
    for (const pp of P.planets) {
      const group = new THREE.Group();
      const geo = new THREE.SphereGeometry(pp.drawRadius, 72, 48);
      const mesh = new THREE.Mesh(geo, makeSurfaceMaterial(pp, this.uSunPos, this.uCamPos, this.uTime));
      mesh.rotation.z = pp.tilt;
      mesh.userData.planet = pp;
      group.add(mesh);

      let cloudMesh = null;
      if (pp.clouds > 0.05) {
        cloudMesh = new THREE.Mesh(
          new THREE.SphereGeometry(pp.drawRadius * 1.018, 64, 40),
          makeCloudMaterial(pp, this.uSunPos, this.uTime));
        group.add(cloudMesh);
      }
      const posUniform = { value: group.position };
      {
        const atmo = new THREE.Mesh(
          new THREE.SphereGeometry(pp.drawRadius * 1.07, 48, 32),
          makeAtmosphereMaterial(pp, this.uSunPos, this.uCamPos, posUniform));
        group.add(atmo);
      }
      if (pp.hasRings) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(pp.drawRadius * 1.45, pp.drawRadius * 2.6, 128, 1),
          makeRingMaterial(pp, this.uSunPos, posUniform));
        ring.rotation.x = Math.PI / 2 + pp.tilt * 0.6;
        group.add(ring);
      }
      // moons
      const moons = [];
      const mr = new RNG(hash(pp.seed, 0x30e));
      for (let m = 0; m < pp.moons; m++) {
        const md = pp.drawRadius * mr.float(2.2, 4.6) + m * pp.drawRadius * 0.9;
        const ms = Math.max(pp.drawRadius * mr.float(0.08, 0.2), 0.12);
        const moon = new THREE.Mesh(
          new THREE.SphereGeometry(ms, 20, 14),
          makeSurfaceMaterial({
            typeId: 0, noiseSeed: mr.float(0, 100), oceanLevel: -1, inhabited: false,
            colA: new THREE.Color(0.38, 0.37, 0.36), colB: new THREE.Color(0.55, 0.54, 0.52),
            colC: new THREE.Color(0.25, 0.24, 0.23), iceCap: 2.0,
          }, this.uSunPos, this.uCamPos, this.uTime));
        moon.userData.dist = md;
        moon.userData.rate = 2 * Math.PI / (mr.float(4, 40));        // rad per sim-day
        moon.userData.phase = mr.float(0, Math.PI * 2);
        group.add(moon);
        moons.push(moon);
      }
      this.scene.add(group);
      this.planetNodes.push({ pp, group, mesh, cloudMesh, moons });

      // orbit line in draw space
      const seg = 220, lp = new Float32Array(seg * 3);
      const tmp = new THREE.Vector3();
      for (let s = 0; s < seg; s++) {
        // sweep eccentric anomaly for an even line
        const E = (s / seg) * Math.PI * 2;
        const nu = 2 * Math.atan2(Math.sqrt(1 + pp.e) * Math.sin(E / 2), Math.sqrt(1 - pp.e) * Math.cos(E / 2));
        const rAU = pp.a * (1 - pp.e * Math.cos(E));
        const co = Math.cos(pp.omega + nu), so = Math.sin(pp.omega + nu);
        const cO = Math.cos(pp.Omega), sO = Math.sin(pp.Omega);
        const ci = Math.cos(pp.inc), si = Math.sin(pp.inc);
        tmp.set(cO * co - sO * so * ci, so * si, sO * co + cO * so * ci).multiplyScalar(drawR(rAU));
        lp[s * 3] = tmp.x; lp[s * 3 + 1] = tmp.y; lp[s * 3 + 2] = tmp.z;
      }
      const lgeo = new THREE.BufferGeometry();
      lgeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
      const line = new THREE.LineLoop(lgeo, new THREE.LineBasicMaterial({
        color: pp.inhabited ? 0x3a5a7a : 0x2a2f3a, transparent: true, opacity: 0.55,
      }));
      this.scene.add(line);
    }

    // -- asteroid belt
    if (P.belt) this._buildBelt(P.belt, r);
    if (P.comet) this._buildComet(P.comet, r);
  }

  _buildBelt(belt, r) {
    const N = 3200;
    const geo = new THREE.IcosahedronGeometry(0.16, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0x8a827a });
    // basic material — lit look faked by distance dimming below
    this.beltMesh = new THREE.InstancedMesh(geo, mat, N);
    this.beltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beltData = [];
    for (let i = 0; i < N; i++) {
      const a = belt.a * (1 + r.gauss() * belt.width);
      this.beltData.push({
        a: Math.max(a, 0.1),
        phase: r.float(0, Math.PI * 2),
        n: (2 * Math.PI) / (Math.sqrt(a * a * a / this.params.mass) * 365.25), // rad/day
        y: r.gauss() * drawR(a) * 0.02,
        s: r.float(0.4, 1.7),
        rot: r.float(0, Math.PI * 2),
      });
    }
    this._dummy = new THREE.Object3D();
    this.scene.add(this.beltMesh);

    const colors = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const b = 0.35 + 0.3 * r.next();
      colors[i * 3] = b; colors[i * 3 + 1] = b * 0.95; colors[i * 3 + 2] = b * 0.88;
    }
    // per-instance color for variety
    this.beltMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  }

  _buildComet(el, r) {
    this.cometEl = el;
    const tex = softDotTexture(64);
    this.cometHead = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(0.7, 0.85, 1.0),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.cometHead.scale.setScalar(3);
    this.scene.add(this.cometHead);

    const N = 260;
    this.cometTail = new THREE.BufferGeometry();
    this.cometTailPos = new Float32Array(N * 3);
    this.cometTailT = new Float32Array(N).fill(Math.random());
    for (let i = 0; i < N; i++) this.cometTailT[i] = i / N;
    this.cometTail.setAttribute('position', new THREE.BufferAttribute(this.cometTailPos, 3));
    const pts = new THREE.Points(this.cometTail, new THREE.PointsMaterial({
      color: new THREE.Color(0.4, 0.6, 0.9), size: 1.6, map: tex, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, opacity: 0.7,
    }));
    this.scene.add(pts);
  }

  // ------------------------------------------------------------- loop ----
  update(dt) {
    if (this.playing) this.days += dt * this.speedDays;
    const tY = this.days / 365.25;
    this.uTime.value += dt;

    const v = new THREE.Vector3();
    for (const node of this.planetNodes) {
      keplerPos(node.pp, tY, this.params.mass, v);
      node.group.position.copy(v);
      node.mesh.rotation.y += node.pp.spin * dt * this.speedDays * 0.35;
      if (node.cloudMesh) node.cloudMesh.rotation.y += node.pp.spin * dt * this.speedDays * 0.42;
      for (const moon of node.moons) {
        const th = moon.userData.phase + moon.userData.rate * this.days;
        moon.position.set(Math.cos(th) * moon.userData.dist, 0, Math.sin(th) * moon.userData.dist);
      }
    }

    if (this.beltMesh) {
      const d = this._dummy;
      for (let i = 0; i < this.beltData.length; i++) {
        const b = this.beltData[i];
        const th = b.phase + b.n * this.days;
        const rd = drawR(b.a);
        d.position.set(Math.cos(th) * rd, b.y, Math.sin(th) * rd);
        d.rotation.set(b.rot + this.days * 0.01, th, 0);
        d.scale.setScalar(b.s);
        d.updateMatrix();
        this.beltMesh.setMatrixAt(i, d.matrix);
      }
      this.beltMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.cometEl) {
      keplerPos(this.cometEl, tY, this.params.mass, v);
      this.cometHead.position.copy(v);
      const rAU = v.rAU;
      const activity = Math.min(6 / (rAU * rAU), 1);
      this.cometHead.material.opacity = 0.25 + 0.75 * activity;
      const away = v.clone().normalize();
      const N = this.cometTailT.length;
      const len = 10 + 60 * activity;
      for (let i = 0; i < N; i++) {
        const f = this.cometTailT[i];
        const spread = f * len * 0.16;
        this.cometTailPos[i * 3] = v.x + away.x * f * len + Math.sin(i * 12.9898) * spread;
        this.cometTailPos[i * 3 + 1] = v.y + away.y * f * len + Math.cos(i * 78.233) * spread;
        this.cometTailPos[i * 3 + 2] = v.z + away.z * f * len + Math.sin(i * 39.4) * spread;
      }
      this.cometTail.attributes.position.needsUpdate = true;
    }

    // follow focused planet
    if (this.focusIndex >= 0) {
      const p = this.planetNodes[this.focusIndex].group.position;
      const delta = v.copy(p).sub(this._prevTarget);
      this.camera.position.add(delta);
      this.controls.target.copy(p);
      this._prevTarget.copy(p);
    }
    this.controls.update();
  }

  // ------------------------------------------------------------- time ----
  togglePlay() { this.playing = !this.playing; }
  speedUp() { this.speedDays = Math.min(this.speedDays * 1.8, 4000); }
  slowDown() { this.speedDays = Math.max(this.speedDays / 1.8, 0.2); }
  timeReadout() {
    const y = this.days / 365.25;
    const t = y >= 1 ? y.toFixed(2) + ' yr' : this.days.toFixed(0) + ' d';
    return `T+${t} · ${this.speedDays.toFixed(0)} d/s`;
  }

  hudStats() {
    const P = this.params;
    return [
      ['system', P.name],
      ['star', `${P.spectral}-class ${P.stage}`],
      ['mass', P.mass.toFixed(2) + ' M☉'],
      ['temperature', Math.round(P.temp).toLocaleString() + ' K'],
      ['luminosity', P.lum >= 100 ? P.lum.toFixed(0) + ' L☉' : P.lum.toFixed(2) + ' L☉'],
      ['worlds', String(P.planets.length) + (P.belt ? ' + belt' : '')],
    ];
  }

  // ------------------------------------------------------------ input ----
  pick(raycaster) {
    const meshes = this.planetNodes.map(n => n.mesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const pp = hits[0].object.userData.planet;
      return { type: 'planet', planet: pp, index: pp.index };
    }
    const sHit = raycaster.intersectObject(this.starMesh, false);
    if (sHit.length) return { type: 'sun' };
    return null;
  }

  focusPlanet(index) {
    this.focusIndex = index;
    if (index < 0) {
      this.controls.target.set(0, 0, 0);
      this._prevTarget.set(0, 0, 0);
      return;
    }
    const node = this.planetNodes[index];
    const p = node.group.position;
    this._prevTarget.copy(p);
    this.controls.target.copy(p);
    // glide the camera to a close orbit
    const dir = this.camera.position.clone().sub(p).normalize();
    const dist = node.pp.drawRadius * 4.2;
    this._glideTo = p.clone().addScaledVector(dir, dist);
    this._glideT = 0;
  }

  glide(dt) {
    if (this._glideTo == null) return;
    this._glideT += dt;
    const k = 1 - Math.exp(-3.2 * dt);
    this.camera.position.lerp(this._glideTo, k);
    if (this.focusIndex >= 0) {
      const p = this.planetNodes[this.focusIndex].group.position;
      const dir = this.camera.position.clone().sub(p).normalize();
      this._glideTo.copy(p).addScaledVector(dir, this.planetNodes[this.focusIndex].pp.drawRadius * 4.2);
    }
    if (this._glideT > 2.4) this._glideTo = null;
  }

  onKey() { return false; }
  enter() {}
  exit() { this.controls.enabled = false; }
  resume() { this.controls.enabled = true; }

  dispose() {
    this.controls.dispose();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

export const SYSTEM_NOTE = `Every orbit here is honest mechanics: periods follow Kepler's third law (<em>P² = a³/M★</em>) and positions come from solving Kepler's equation <em>M = E − e·sin E</em> by Newton's method each frame. The star's color is its blackbody spectrum; its temperature and luminosity follow main-sequence scaling from the mass this seed drew. Radial distances are gently compressed for visibility — the numbers in the cards are the true ones. Click a world to read it; click again to enter orbit. Speed up time and watch the inner worlds whirl while the outer giants creep.`;
