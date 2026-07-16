// The metropolis.
//
// Wherever the night-lights fbm peaks hardest on an inhabited world, a
// full city stands — not a cluster of towers but a street grid with a
// name: avenues and cross streets clipped to an island-shaped ellipse, a
// diagonal boulevard cutting the grid, two districted skyline cores with
// glass supertalls falling away through masonry midrise to brick sprawl,
// a central park, a plaza the autopilot can land on, suspension bridges
// where an avenue meets water it can cross, piers where it can't, and a
// harbor working ferries between them.
//
// And it is alive at every scale: traffic streams the grid with headlight
// white and taillight red after dark, street lamps come up sodium-warm,
// windows ignite one by one as the dusk deepens (each keeps its own
// hour), ferries drag wakes across the water, and the tallest roofs
// blink their aircraft warnings. Everything is deterministic — the same
// seed grows the same city, block by block, forever — and everything is
// instanced: one draw call carries every building, one carries every
// car, one every lamp.
//
// Cities are discovered by quantizing the sphere into cells and asking
// each cell's RNG where its glow peaks; they stream in like terrain
// tiles (a budgeted generator builds blocks across frames, finishing
// long before the city is close enough to resolve) and are dropped with
// hysteresis on the way out. Before one stands up, it grades its ground
// into the shared height field (quadtree.addPad — the crater's civil
// twin), so streets, boots, workers and paint agree about the level city.

import * as THREE from 'three';
import { hash, RNG, cityName } from './rng.js';
import { softDotTexture } from './nebula.js';
import { planetHeight, fbm } from './terrain.js';
import { sampleHydro } from './tilebuild.js';

const CELL_Q = 10;              // sphere-cell lattice: ~one metro candidate per cell
const MASK_MIN = 0.27;          // how hard the glow must burn to earn a metro
const SPAWN_U = 26;             // build inside this camera distance (draw units)
const DROP_U = 36;              // drop outside this (hysteresis)
const PAD_U = 110;              // grade the ground from way out — the tile
                                // pipeline is cold up here, so nobody sees it
const ANIM_U = 8;               // cars/boats animate inside ~20 km; beyond
                                // that they are sub-pixel and sleep
const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const SAMPLE_M = 36;            // road polyline sampling step, metres
const MAX_BUILDINGS = 15000;
const MAX_ACTIVE = 2;

// ------------------------------------------------------------- shaders ----

const CITY_BLDG_VERT = /* glsl */`
  attribute float aSeed;
  attribute vec2 aGrid;
  attribute vec3 aTint;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vView;
  varying float vSeed;
  varying vec2 vGrid;
  varying vec3 vTint;
  varying float vSide;
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vGrid = aGrid;
    vTint = aTint;
    vSide = 1.0 - step(0.5, abs(normal.y));
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    vec4 mv = viewMatrix * w;
    vView = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const CITY_BLDG_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNight;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vView;
  varying float vSeed;
  varying vec2 vGrid;
  varying vec3 vTint;
  varying float vSide;

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed * 37.0) * 43758.5453);
  }

  void main() {
    float day = 1.0 - uNight;
    vec3 sun = normalize(uSunDir);
    float diff = max(dot(vN, sun), 0.0);
    vec3 col = vTint * (0.05 + diff * day * 0.95 + 0.10 * day);

    if (vSide > 0.5) {
      vec2 g = vUv * vGrid;
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float win = step(0.20, f.x) * step(f.x, 0.80) * step(0.28, f.y) * step(f.y, 0.78);
      // dusk is progressive: each window keeps its own hour, igniting as
      // the night deepens — the required showpiece
      float on = step(1.0 - hash2(cell) * 0.96, uNight * 1.2);
      float flick = 0.8 + 0.2 * hash2(cell + 7.0);
      float warm = 0.9 + 0.25 * hash2(cell + 13.0);
      col += vec3(1.0, 0.70 * warm, 0.40 * warm) * win * on * flick * (uNight * 1.5 + 0.02);
      // by day the glass goes dark — and throws the sun back in mirrors
      col = mix(col, col * 0.8, win * day);
      vec3 view = normalize(-vView);
      float glint = pow(max(dot(reflect(-sun, vN), view), 0.0), 90.0);
      col += uSunColor * glint * win * day * 0.55;
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const CAR_VERT = /* glsl */`
  attribute vec3 aTint;
  varying vec3 vN;
  varying vec3 vTint;
  varying float vNose;    // +1 at the headlights, -1 at the tail
  void main() {
    vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
    vTint = aTint;
    vNose = position.x * 2.0;
    vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const CAR_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform float uNight;
  varying vec3 vN;
  varying vec3 vTint;
  varying float vNose;
  void main() {
    float day = 1.0 - uNight;
    float diff = max(dot(vN, normalize(uSunDir)), 0.0);
    vec3 col = vTint * (0.06 + diff * day * 0.9);
    // headlight white ahead, taillight red behind — the avenue reads as
    // paired streams of light after dark
    col += vec3(1.5, 1.4, 1.2) * smoothstep(0.55, 0.95, vNose) * uNight;
    col += vec3(1.4, 0.10, 0.06) * smoothstep(0.55, 0.95, -vNose) * uNight;
    gl_FragColor = vec4(col, 1.0);
  }
`;

// roads, park lawns and plazas share one flat-lit vertex-colored material
const GROUND_VERT = /* glsl */`
  varying vec3 vCol;
  varying vec3 vN;
  void main() {
    vCol = color;
    vN = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const GROUND_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  varying vec3 vCol;
  varying vec3 vN;
  void main() {
    float light = max(dot(normalize(vN), normalize(uSunDir)), 0.0);
    gl_FragColor = vec4(vCol * (0.04 + light * 0.96), 1.0);
  }
`;

// ---------------------------------------------------------------- city ----

class City {
  constructor(ps, site) {
    this.ps = ps;
    this.site = site;
    const pp = ps.pp;
    this.rng = new RNG(hash(pp.seed, site.ci, site.cj, site.ck, 0xC17E));
    const r = this.rng;

    // local tangent frame at the city center, metres inside (the anchor's
    // exact construction — +x east, +y up, +z the east×up axis)
    const a = this.a = site.dir.clone();
    this.aR = ps.quad.heightAt(a);
    this.mpu = ps.unitKm * 1000;
    let east = new THREE.Vector3(0, 1, 0).cross(a);
    if (east.lengthSq() < 1e-6) east = new THREE.Vector3(1, 0, 0).cross(a);
    east.normalize();
    const north = new THREE.Vector3().crossVectors(east, a);
    this.east = east; this.north = north;
    this.group = new THREE.Group();
    this.group.position.copy(a).multiplyScalar(this.aR);
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(east, a, north));
    this.group.scale.setScalar(1 / this.mpu);
    ps.planetGroup.add(this.group);
    this.pos = this.group.position.clone();

    this.seaM = ps.seaR > 0 ? (ps.seaR - this.aR) * this.mpu : null;

    // the plan: an island-shaped ellipse of grid, long axis by the seed
    this.Rc = site.radiusM;
    this.aEll = this.Rc;
    this.bEll = this.Rc * r.float(0.62, 0.8);
    this.theta = r.float(0, Math.PI);
    this.cosT = Math.cos(this.theta); this.sinT = Math.sin(this.theta);
    this.Sav = r.float(240, 290);          // avenue pitch across the island
    this.Sst = r.float(78, 96);            // street pitch along it
    this.wAv = 24; this.wSt = 12; this.wBl = 30;
    this.Hmax = 80 + site.mask * r.float(190, 260);   // supertall ceiling
    // two skyline cores — downtown near the tip, midtown past center
    this.c1 = { u: -this.aEll * r.float(0.30, 0.42), v: this.bEll * r.float(-0.1, 0.1), s: this.Rc * 0.30, k: r.float(0.65, 0.85) };
    this.c2 = { u: this.aEll * r.float(0.10, 0.26), v: this.bEll * r.float(-0.12, 0.12), s: this.Rc * 0.38, k: 1.0 };
    // the park: a green rectangle mid-island
    this.park = {
      u: this.aEll * r.float(0.32, 0.48), v: this.bEll * r.float(-0.15, 0.15),
      lu: r.float(500, 800), lv: r.float(280, 420),
    };

    this.name = cityName(pp.seed, site.ci, site.cj, site.ck);
    this.pop = 0;
    this.built = false;
    this._iter = this._build();
    this._time = r.float(0, 100);
    this._meshes = [];

    // filled by the build
    this.roads = [];        // { pts: Float32Array xyz, n, w, cls }
    this.bridges = [];
    this.piers = [];
    this._bldg = { mats: [], seeds: [], grids: [], tints: [] };
    this._treePts = [];
    this._lampPts = [];
    this.cars = null;
    this.boats = null;
    this._spr = [];
  }

  hAt(x, z) {
    _hv.copy(this.pos)
      .addScaledVector(this.east, x / this.mpu)
      .addScaledVector(this.north, z / this.mpu).normalize();
    return (this.ps.quad.heightAt(_hv) * _hv.dot(this.a) - this.aR) * this.mpu;
  }

  /** normalized distance into the local river channel (<1 is water) — the
   *  same corridor-gated fbm the mesher carves and the fragment paints */
  riverT(x, z) {
    const ps = this.ps;
    if (!ps.hydro || ps.seaR <= 0) return 9;
    _hv.copy(this.pos)
      .addScaledVector(this.east, x / this.mpu)
      .addScaledVector(this.north, z / this.mpu).normalize();
    const s = ps.pp.noiseSeed;
    const above = planetHeight(_hv.x, _hv.y, _hv.z, s) - ps.pp.oceanLevel;
    if (above <= 0.002 || above >= 0.42) return 9;
    const corridor = sampleHydro(ps.hydro.atlas, ps.hydro.n, _hv.x, _hv.y, _hv.z);
    if (corridor <= 0.06) return 9;
    const rv = fbm(_hv.x * 45 + s * 7.7, _hv.y * 45 + s * 3.1, _hv.z * 45 + s * 13.9);
    const w = (0.010 + 0.020 * Math.max(1 - above * 3.5, 0)) * (0.35 + 0.9 * corridor);
    return Math.abs(rv) / w;
  }

  _uvToXZ(u, v, out) {
    out.x = u * this.cosT - v * this.sinT;
    out.z = u * this.sinT + v * this.cosT;
    return out;
  }

  /** pump the budgeted build; returns true when the city stands */
  step(budgetMs = 4) {
    if (this.built) return true;
    const t0 = performance.now();
    while (performance.now() - t0 < budgetMs) {
      if (this._iter.next().done) { this._finalize(); this.built = true; return true; }
    }
    return false;
  }

  // ------------------------------------------------------------ build ----
  * _build() {
    const r = this.rng;
    const sea = this.seaM;
    const wet = (h) => sea !== null && h < sea - 1.2;

    // ---- roads: streets across, avenues along, one diagonal boulevard --
    const lines = [];
    const nAv = Math.floor(this.bEll * 2 / this.Sav);
    for (let k = 0; k <= nAv; k++) {
      const v = -this.bEll + this.Sav * 0.5 + k * this.Sav;
      if (Math.abs(v) >= this.bEll * 0.98) continue;
      const half = this.aEll * Math.sqrt(Math.max(1 - (v / this.bEll) ** 2, 0));
      lines.push({ axis: 'u', off: v, lo: -half, hi: half, w: this.wAv, cls: 2 });
    }
    const nSt = Math.floor(this.aEll * 2 / this.Sst);
    for (let k = 0; k <= nSt; k++) {
      const u = -this.aEll + this.Sst * 0.5 + k * this.Sst;
      if (Math.abs(u) >= this.aEll * 0.98) continue;
      const half = this.bEll * Math.sqrt(Math.max(1 - (u / this.aEll) ** 2, 0));
      lines.push({ axis: 'v', off: u, lo: -half, hi: half, w: this.wSt, cls: 1 });
    }
    // the Broadway: a diagonal cutting the whole grid
    lines.push({ axis: 'd', off: 0, lo: -this.Rc, hi: this.Rc, w: this.wBl, cls: 3, ang: this.theta + r.float(0.42, 0.6) });
    yield;

    // sample each line over the terrain; split at unbridgeable water,
    // deck the bridgeable gaps
    const p = new THREE.Vector3();
    for (const L of lines) {
      const n = Math.max(Math.floor((L.hi - L.lo) / SAMPLE_M), 2);
      const xs = new Float64Array(n + 1), zs = new Float64Array(n + 1);
      const gs = new Float64Array(n + 1);
      const rv = new Uint8Array(n + 1);       // 1 = a river runs here
      for (let i = 0; i <= n; i++) {
        const t = L.lo + (L.hi - L.lo) * (i / n);
        if (L.axis === 'u') this._uvToXZ(t, L.off, p);
        else if (L.axis === 'v') this._uvToXZ(L.off, t, p);
        else { p.x = Math.cos(L.ang) * t; p.z = Math.sin(L.ang) * t; }
        xs[i] = p.x; zs[i] = p.z;
        gs[i] = this.hAt(p.x, p.z);
        rv[i] = this.riverT(p.x, p.z) < 1.05 ? 1 : 0;
        if ((i & 31) === 31) yield;
      }
      // ellipse clip for the diagonal
      const inside = (i) => {
        if (L.axis !== 'd') return true;
        const u = xs[i] * this.cosT + zs[i] * this.sinT;
        const v = -xs[i] * this.sinT + zs[i] * this.cosT;
        return (u / this.aEll) ** 2 + (v / this.bEll) ** 2 <= 1;
      };
      // walk the samples into land runs; deck water runs on the wide roads
      let run = [];
      const flush = () => {
        if (run.length >= 6) {
          const pts = new Float32Array(run.length * 3);
          for (let i = 0; i < run.length; i++) {
            pts[i * 3] = run[i][0]; pts[i * 3 + 1] = run[i][1]; pts[i * 3 + 2] = run[i][2];
          }
          this.roads.push({ pts, n: run.length, w: L.w, cls: L.cls });
        }
        run = [];
      };
      let i = 0;
      while (i <= n) {
        if (!inside(i)) { flush(); i++; continue; }
        if (!wet(gs[i]) && !rv[i]) {
          run.push([xs[i], gs[i] + 0.3 + L.cls * 0.12, zs[i]]);
          i++;
          continue;
        }
        // a water run begins — sea inlet or river: measure it
        let j = i, anySea = false;
        while (j <= n && (wet(gs[j]) || rv[j] || !inside(j))) {
          if (wet(gs[j])) anySea = true;
          j++;
        }
        const gapM = (j - i) * SAMPLE_M;
        if (L.cls >= 2 && j <= n && i > 0 && gapM >= 70 && gapM <= 1100 && run.length) {
          // bridge it: tall decks over the harbor for the boats to pass,
          // low arched spans over the rivers
          const y0 = gs[i - 1] + 0.6, y1 = gs[j] + 0.6;
          const deck = anySea
            ? Math.max(sea + 13, Math.max(y0, y1) + 2)
            : Math.max(y0, y1) + 3;
          const spanPts = [];
          for (let k2 = i; k2 < j; k2++) {
            const t = (k2 - i + 1) / (j - i + 1);
            const ramp = Math.min(t * 3, (1 - t) * 3, 1);
            const y = (y0 + (y1 - y0) * t) * (1 - ramp) + (deck + Math.sin(t * Math.PI) * (anySea ? 4 : 2)) * ramp;
            run.push([xs[k2], y, zs[k2]]);
            spanPts.push([xs[k2], y, zs[k2]]);
          }
          this.bridges.push({ span: spanPts, w: L.w, sea: anySea ? sea : null });
        } else {
          // no crossing: the road ends at the shore — with a pier stub
          if (run.length >= 6 && L.cls >= 2 && sea !== null && anySea) {
            const last = run[run.length - 1];
            this.piers.push({ x: xs[i], z: zs[i], hx: xs[i] - last[0], hz: zs[i] - last[1] });
            run.push([xs[i], sea + 3.5, zs[i]]);
          }
          flush();
        }
        i = j;
      }
      flush();
      yield;
    }

    // ---- blocks: district, park, plaza, lots ---------------------------
    const d = new THREE.Object3D();
    const landing = this.site.landingLocal;   // keep this plaza clear
    const inPark = (u, v) =>
      Math.abs(u - this.park.u) < this.park.lu / 2 && Math.abs(v - this.park.v) < this.park.lv / 2;
    const B = this._bldg;
    const patches = this._patches = [];
    let nB = 0;
    const u0 = -this.aEll + this.Sst * 0.5, v0 = -this.bEll + this.Sav * 0.5;
    for (let jv = 0; jv * this.Sav + v0 < this.bEll - this.Sav; jv++) {
      for (let iu = 0; iu * this.Sst + u0 < this.aEll - this.Sst; iu++) {
        const bu = u0 + iu * this.Sst + this.Sst / 2;
        const bv = v0 + jv * this.Sav + this.Sav / 2;
        const rho = Math.sqrt((bu / this.aEll) ** 2 + (bv / this.bEll) ** 2);
        if (rho > 1) continue;
        const br = new RNG(hash(this.ps.pp.seed, this.site.ci * 7 + iu, this.site.cj * 13 + jv, 0xB10C));
        // the edge of town frays organically
        if (rho > 0.72 && br.next() < (rho - 0.72) / 0.28 * 0.9) continue;
        this._uvToXZ(bu, bv, d.position);
        const bx = d.position.x, bz = d.position.z;
        const h = this.hAt(bx, bz);
        if (wet(h) || (this.seaM !== null && h < this.seaM + 1.6)) continue;
        // riverbanks stay green — the water keeps its right of way
        if (this.riverT(bx, bz) < 1.5) {
          if (br.chance(0.5)) this._treePts.push([bx + br.float(-30, 30), 0, bz + br.float(-30, 30)]);
          continue;
        }
        // steep blocks stay green hillside
        const spread = Math.max(
          Math.abs(this.hAt(bx + 34, bz) - h), Math.abs(this.hAt(bx - 34, bz) - h),
          Math.abs(this.hAt(bx, bz + 34) - h), Math.abs(this.hAt(bx, bz - 34) - h));
        if (spread > 22) {
          if (br.chance(0.4)) this._treePts.push([bx + br.float(-30, 30), h, bz + br.float(-30, 30)]);
          continue;
        }
        // the park is a world of its own; pocket parks dot the grid
        const park = inPark(bu, bv) || br.chance(0.035);
        const nearLanding = landing &&
          Math.hypot(bx - landing.x, bz - landing.z) < 120;
        if (park || nearLanding) {
          patches.push({ u: bu, v: bv, h, green: !nearLanding });
          if (!nearLanding) {
            const nT = br.int(4, 9);
            for (let t = 0; t < nT; t++) {
              this._treePts.push([
                bx + br.float(-this.Sst / 2 + 8, this.Sst / 2 - 8), 0,
                bz + br.float(-this.Sav / 2 + 12, this.Sav / 2 - 12)]);
            }
          }
          continue;
        }
        if (nB >= MAX_BUILDINGS) continue;
        // district by distance to the skyline cores
        const g1 = Math.exp(-(((bu - this.c1.u) ** 2 + (bv - this.c1.v) ** 2)) / (2 * this.c1.s ** 2)) * this.c1.k;
        const g2 = Math.exp(-(((bu - this.c2.u) ** 2 + (bv - this.c2.v) ** 2)) / (2 * this.c2.s ** 2)) * this.c2.k;
        const core = Math.max(g1, g2);
        const lotU = this.Sst - this.wSt - 6, lotV = this.Sav - this.wAv - 8;
        const rows = core > 0.6 ? 1 : 2;
        const cols = core > 0.6 ? br.int(1, 2) : core > 0.25 ? 2 : 3;
        for (let rw = 0; rw < rows; rw++) {
          for (let cl = 0; cl < cols; cl++) {
            if (nB >= MAX_BUILDINGS) break;
            if (rho > 0.55 && br.chance(0.18)) continue;   // vacant lots outward
            const fw = lotU / cols, fd = lotV / rows;
            const cu = bu - lotU / 2 + fw * (cl + 0.5) + br.float(-2, 2);
            const cv = bv - lotV / 2 + fd * (rw + 0.5) + br.float(-2, 2);
            this._uvToXZ(cu, cv, d.position);
            const lx = d.position.x, lz = d.position.z;
            if (landing && Math.hypot(lx - landing.x, lz - landing.z) < 110) continue;
            const w = fw * br.float(0.62, 0.85), dp = fd * br.float(0.6, 0.85);
            const ln = Math.exp(br.gauss() * 0.5);
            let H = (10 + this.Hmax * core * ln) * br.float(0.75, 1.2);
            if (core < 0.25) H = Math.min(H, br.float(9, 34));   // the sprawl stays low
            H = Math.max(H, 7);
            const hB = H > 60 ? this.hAt(lx, lz) : h;   // the talls deserve their own footing
            d.position.set(lx, hB + H / 2 - 2, lz);
            d.rotation.set(0, -this.theta, 0);
            d.scale.set(w, H, dp);
            d.updateMatrix();
            B.mats.push(d.matrix.clone());
            B.seeds.push(br.float(0, 100));
            B.grids.push(Math.max(Math.round(w / 3.4), 2), Math.max(Math.round(H / 3.3), 2));
            // era by district: glass cores, masonry midrise, brick sprawl
            const tint = core > 0.5
              ? [0.10 + br.float(0, 0.05), 0.12 + br.float(0, 0.05), 0.16 + br.float(0, 0.06)]
              : core > 0.22
                ? (br.chance(0.5) ? [0.34, 0.28, 0.22] : [0.42, 0.40, 0.36])
                : (br.chance(0.6) ? [0.30, 0.16, 0.12] : [0.26, 0.22, 0.18]);
            B.tints.push(tint[0] * br.float(0.8, 1.2), tint[1] * br.float(0.8, 1.2), tint[2] * br.float(0.8, 1.2));
            this.pop += (w * dp * H) / 38;
            if (H > this.Hmax * 0.72 && this._spr.length < 10) {
              this._spr.push({ x: lx, y: hB + H - 1, z: lz, phase: br.float(0, 6.28) });
            }
            nB++;
          }
        }
        if ((iu & 15) === 15) yield;   // fine-grained: rows got heavy with the river test
      }
      yield;
    }

    // ---- street lamps along the wide roads ----------------------------
    for (const rd of this.roads) {
      if (rd.cls < 2) continue;
      for (let i = 2; i < rd.n - 2; i += 2) {
        const x = rd.pts[i * 3], y = rd.pts[i * 3 + 1], z = rd.pts[i * 3 + 2];
        const dx = rd.pts[(i + 1) * 3] - x, dz = rd.pts[(i + 1) * 3 + 2] - z;
        const il = 1 / Math.max(Math.hypot(dx, dz), 1e-6);
        const px = -dz * il, pz = dx * il;
        const off = rd.w / 2 - 1.5;
        this._lampPts.push([x + px * off, y + 8.5, z + pz * off], [x - px * off, y + 8.5, z - pz * off]);
      }
      yield;
    }

    // ---- the harbor: piers and offshore marks become ferry routes ------
    if (this.seaM !== null) {
      const marks = [];
      for (let i = 0; i < 24 && marks.length < 5; i++) {
        const ang = r.float(0, Math.PI * 2);
        const rad = this.Rc * r.float(1.15, 1.7);
        const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
        if (this.hAt(x, z) < this.seaM - 5) marks.push([x, z]);
        if ((i & 7) === 7) yield;
      }
      const ends = this.piers.map(pi => [pi.x, pi.z]).concat(marks);
      if (ends.length >= 2) {
        // a ferry keeps to the water: reject legs that would cross land
        const clear = (A, B2) => {
          for (let t = 0.18; t < 1; t += 0.16) {
            const x = A[0] * (1 - t) + B2[0] * t, z = A[1] * (1 - t) + B2[1] * t;
            if (this.hAt(x, z) > this.seaM - 2) return false;
          }
          return true;
        };
        const routes = [];
        for (let i = 0; i < 26 && routes.length < 10; i++) {
          const a2 = r.int(0, ends.length - 1);
          let b2 = r.int(0, ends.length - 1);
          if (b2 === a2) b2 = (b2 + 1) % ends.length;
          if (clear(ends[a2], ends[b2])) routes.push([ends[a2], ends[b2]]);
          if ((i & 7) === 7) yield;
        }
        if (routes.length) this._routes = routes;
      }
    }
  }

  // --------------------------------------------------------- finalize ----
  _finalize() {
    const ps = this.ps, r = this.rng;
    const uNight = this.uNight = { value: 0 };
    const uSunColor = { value: (ps.ctx.sunColor ?? new THREE.Color(1, 1, 1)).clone() };
    const add = (m) => { m.frustumCulled = false; this.group.add(m); this._meshes.push(m); return m; };

    // ---- ground: roads, lawns, plazas in one vertex-colored mesh -------
    const gp = [], gn = [], gc = [], gi = [];
    const pushQuad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx2, dy2, dz2, col) => {
      const base = gp.length / 3;
      gp.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx2, dy2, dz2);
      for (let k = 0; k < 4; k++) { gn.push(0, 1, 0); gc.push(col[0], col[1], col[2]); }
      gi.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    };
    const ASPHALT = [0.045, 0.047, 0.052], BLVD = [0.06, 0.058, 0.062];
    for (const rd of this.roads) {
      const col = rd.cls === 3 ? BLVD : ASPHALT;
      for (let i = 0; i < rd.n - 1; i++) {
        const x0 = rd.pts[i * 3], y0 = rd.pts[i * 3 + 1], z0 = rd.pts[i * 3 + 2];
        const x1 = rd.pts[(i + 1) * 3], y1 = rd.pts[(i + 1) * 3 + 1], z1 = rd.pts[(i + 1) * 3 + 2];
        const dx = x1 - x0, dz = z1 - z0;
        const il = 1 / Math.max(Math.hypot(dx, dz), 1e-6);
        const px = -dz * il * rd.w / 2, pz = dx * il * rd.w / 2;
        pushQuad(x0 + px, y0, z0 + pz, x0 - px, y0, z0 - pz, x1 + px, y1, z1 + pz, x1 - px, y1, z1 - pz, col);
      }
    }
    const LAWN = [0.055, 0.14, 0.05], PLAZA = [0.30, 0.29, 0.27];
    const pv = new THREE.Vector3();
    for (const pa of this._patches ?? []) {
      // each patch is one block: a 2×2 sampled sheet hugging the ground
      const hu = (this.Sst - this.wSt) / 2, hv2 = (this.Sav - this.wAv) / 2;
      const col = pa.green ? LAWN : PLAZA;
      for (let sv = -1; sv < 1; sv++) {
        for (let su = -1; su < 1; su++) {
          const corners = [];
          for (const [eu, ev] of [[su, sv], [su + 1, sv], [su, sv + 1], [su + 1, sv + 1]]) {
            this._uvToXZ(pa.u + eu * hu, pa.v + ev * hv2, pv);
            corners.push([pv.x, this.hAt(pv.x, pv.z) + 0.22, pv.z]);
          }
          pushQuad(...corners[0], ...corners[1], ...corners[2], ...corners[3], col);
        }
      }
    }
    // pier decks
    for (const pi of this.piers) {
      const il = 1 / Math.max(Math.hypot(pi.hx, pi.hz), 1e-6);
      const hx = pi.hx * il, hz = pi.hz * il;
      const px = -hz * 14, pz = hx * 14;
      const y = (this.seaM ?? 0) + 3.5;
      pushQuad(
        pi.x + px, y, pi.z + pz, pi.x - px, y, pi.z - pz,
        pi.x + px + hx * 90, y, pi.z + pz + hz * 90, pi.x - px + hx * 90, y, pi.z - pz + hz * 90,
        [0.22, 0.19, 0.16]);
    }
    if (gp.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(gn, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
      geo.setIndex(gi);
      add(new THREE.Mesh(geo, new THREE.ShaderMaterial({
        uniforms: { uSunDir: ps.uSunDir },
        vertexShader: GROUND_VERT, fragmentShader: GROUND_FRAG, vertexColors: true,
      })));
    }

    // ---- every building, one draw call ---------------------------------
    const B = this._bldg, nB = B.mats.length;
    if (nB) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(B.seeds), 1));
      geo.setAttribute('aGrid', new THREE.InstancedBufferAttribute(new Float32Array(B.grids), 2));
      geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(B.tints), 3));
      const mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
        uniforms: { uSunDir: ps.uSunDir, uSunColor, uNight },
        vertexShader: CITY_BLDG_VERT, fragmentShader: CITY_BLDG_FRAG,
      }), nB);
      for (let i = 0; i < nB; i++) mesh.setMatrixAt(i, B.mats[i]);
      add(mesh);
      this._bldg = null;   // the matrices live on the GPU now
    }

    // ---- park trees -----------------------------------------------------
    if (this._treePts.length) {
      const green = new THREE.Color().setHSL(r.float(0.2, 0.38), r.float(0.45, 0.6), r.float(0.16, 0.24));
      const canopy = new THREE.InstancedMesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshStandardMaterial({ color: green, roughness: 0.95, flatShading: true }),
        this._treePts.length);
      const d = new THREE.Object3D();
      for (let i = 0; i < this._treePts.length; i++) {
        const [x, , z] = this._treePts[i];
        const h = this.hAt(x, z);
        const cw = r.float(3.5, 7);
        d.position.set(x, h + cw * 0.9, z);
        d.scale.set(cw, cw * r.float(0.7, 1.1), cw);
        d.rotation.y = r.float(0, 6.28);
        d.updateMatrix();
        canopy.setMatrixAt(i, d.matrix);
      }
      add(canopy);
    }

    // ---- bridges: towers, cables, night necklaces ----------------------
    if (this.bridges.length) {
      const towerMat = new THREE.MeshStandardMaterial({ color: 0x424a52, roughness: 0.7, metalness: 0.4 });
      const towers = [];
      const cableP = [];
      const neckP = [];
      for (const br2 of this.bridges) {
        const s = br2.span;
        if (s.length < 6) continue;
        const iA = Math.floor(s.length * 0.16), iB = Math.floor(s.length * 0.84);
        const topH = 26 + (s.length * SAMPLE_M) * 0.03;
        for (const idx of [iA, iB]) {
          towers.push([s[idx][0], s[idx][1], s[idx][2], topH]);
        }
        // main cables: tower top to tower top, dipping to the deck amid-span
        const [ax, ay, az] = s[iA], [bx, by, bz] = s[iB];
        const dx = bx - ax, dz = bz - az;
        const il = 1 / Math.max(Math.hypot(dx, dz), 1e-6);
        const px = -dz * il * (br2.w / 2 - 0.8), pz = dx * il * (br2.w / 2 - 0.8);
        for (const sgn of [1, -1]) {
          let prev = null;
          for (let k = 0; k <= 16; k++) {
            const t = k / 16;
            const x = ax + dx * t + px * sgn, z = az + dz * t + pz * sgn;
            const yTop = (ay + topH) * (1 - t) + (by + topH) * t;
            const deckY = ay * (1 - t) + by * t + 2;
            const y = yTop - (yTop - deckY) * (1 - (2 * t - 1) ** 2);
            if (prev) cableP.push(prev[0], prev[1], prev[2], x, y, z);
            if (k % 2 === 0) neckP.push(x, y + 1.2, z);
            prev = [x, y, z];
          }
        }
      }
      if (towers.length) {
        const tw = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), towerMat, towers.length);
        const d = new THREE.Object3D();
        for (let i = 0; i < towers.length; i++) {
          const [x, y, z, th] = towers[i];
          d.position.set(x, y + th / 2 - 4, z);
          d.scale.set(5, th + 8, 5);
          d.rotation.y = 0;
          d.updateMatrix();
          tw.setMatrixAt(i, d.matrix);
        }
        add(tw);
        const cGeo = new THREE.BufferGeometry();
        cGeo.setAttribute('position', new THREE.Float32BufferAttribute(cableP, 3));
        add(new THREE.LineSegments(cGeo, new THREE.LineBasicMaterial({ color: 0x30363c })));
        this.neck = this._points(neckP, 4.5, new THREE.Color(1.3, 1.25, 1.0));
      }
    }

    // ---- street lamps: sodium by default, or the resonance's color -------
    if (this._lampPts.length) {
      const flat = [];
      for (const q of this._lampPts) flat.push(q[0], q[1], q[2]);
      const lampCol = ps.pp.res?.lamp ?? [1.5, 1.05, 0.5];
      this.lamps = this._points(flat, 6, new THREE.Color(...lampCol));
      this._lampPts = null;
    }

    // ---- traffic ---------------------------------------------------------
    const wide = this.roads.filter(rd => rd.n > 10);
    if (wide.length) {
      const nCars = Math.round(Math.min(Math.round(140 * (this.Rc / 1000) ** 1.6), 780) * (COARSE ? 0.55 : 1));
      const geo = new THREE.BoxGeometry(4.4, 1.5, 1.9);
      geo.translate(0, 0.75, 0);
      const tints = new Float32Array(nCars * 3);
      const mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({
        uniforms: { uSunDir: ps.uSunDir, uNight },
        vertexShader: CAR_VERT, fragmentShader: CAR_FRAG,
      }), nCars);
      const agents = [];
      for (let i = 0; i < nCars; i++) {
        const rd = wide[r.int(0, wide.length - 1)];
        agents.push({
          rd, s: r.float(1, rd.n - 2), dir: r.sign(),
          spd: r.float(7, 16) / SAMPLE_M, lane: (rd.w / 4) * r.sign() * r.float(0.6, 1),
        });
        // taxi yellow at true Manhattan concentration; the rest muted
        const taxi = r.chance(0.15);
        tints[i * 3] = taxi ? 0.85 : r.float(0.08, 0.5);
        tints[i * 3 + 1] = taxi ? 0.65 : tints[i * 3] * r.float(0.85, 1.1);
        tints[i * 3 + 2] = taxi ? 0.08 : tints[i * 3] * r.float(0.85, 1.15);
      }
      geo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
      add(mesh);
      this.cars = { mesh, agents };
    }

    // ---- ferries and their wakes ----------------------------------------
    if (this._routes?.length) {
      const M = this._routes.length;
      const hullGeo = new THREE.BoxGeometry(24, 4.5, 7);
      hullGeo.translate(0, 1.5, 0);
      const hulls = new THREE.InstancedMesh(hullGeo,
        new THREE.MeshStandardMaterial({ color: 0xdde0dd, roughness: 0.6 }), M);
      const cabGeo = new THREE.BoxGeometry(10, 3.4, 5);
      cabGeo.translate(-1, 5.4, 0);
      const cabs = new THREE.InstancedMesh(cabGeo,
        new THREE.MeshStandardMaterial({ color: 0x2c4a5a, roughness: 0.5 }), M);
      const wakeGeo = new THREE.PlaneGeometry(70, 10);
      wakeGeo.rotateX(-Math.PI / 2);
      wakeGeo.translate(-46, 0, 0);
      const wakes = new THREE.InstancedMesh(wakeGeo, new THREE.MeshBasicMaterial({
        map: softDotTexture(64), color: new THREE.Color(0.5, 0.6, 0.65),
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      }), M);
      add(hulls); add(cabs); add(wakes);
      const boats = [];
      for (let i = 0; i < M; i++) {
        const [A, Bp] = this._routes[i];
        const len = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
        boats.push({ A, B: Bp, t: r.float(0, 1), dir: r.sign(), spd: 7 / Math.max(len, 60), phase: r.float(0, 6.28) });
      }
      this.boats = { hulls, cabs, wakes, boats };
    }

    // ---- rooftop aircraft warnings --------------------------------------
    if (this._spr.length) {
      const tex = softDotTexture(32);
      for (const s of this._spr) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: tex, color: new THREE.Color(1.7, 0.12, 0.1),
          blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        }));
        sp.position.set(s.x, s.y + 3, s.z);
        sp.scale.setScalar(7);
        this.group.add(sp);
        s.sprite = sp;
      }
    }

    this.roadsMeshedM = this.roads.reduce((s2, rd) => s2 + rd.n * SAMPLE_M, 0);
  }

  _points(flat, sizeM, color) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3));
    const mat = new THREE.PointsMaterial({
      // size is spent in scene units — the group is metres scaled by 1/mpu
      map: softDotTexture(32), color, size: sizeM / this.mpu,
      transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
      depthWrite: false, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    this.group.add(pts);
    this._meshes.push(pts);
    return pts;
  }

  // ------------------------------------------------------------ update ----
  update(dt) {
    if (!this.built) { this.step(); return; }
    this._time += dt;
    const sunY = this.ps.uSunDir.value.dot(this.a);
    const night = 1 - Math.min(Math.max((sunY + 0.12) * 3.5, 0), 1);
    if (this.uNight) this.uNight.value = night;
    if (this.lamps) this.lamps.material.opacity = night * 0.9;
    if (this.neck) this.neck.material.opacity = 0.15 + night * 0.85;

    // beyond ~20 km the traffic is sub-pixel: let it sleep
    const nearby = this.pos.distanceTo(this.ps.camPos) < ANIM_U;

    if (nearby && this.cars) {
      const { mesh, agents } = this.cars;
      const d = _car;
      for (let i = 0; i < agents.length; i++) {
        const c = agents[i];
        c.s += c.dir * c.spd * dt;   // spd is stored in segments/s
        if (c.s <= 1 || c.s >= c.rd.n - 2) {
          // the end of the road: turn around, or take another one
          if (Math.random() < 0.5) c.dir *= -1;
          else {
            const all = this.roads;
            c.rd = all[(Math.random() * all.length) | 0];
            c.dir = Math.random() < 0.5 ? 1 : -1;
          }
          c.s = Math.min(Math.max(c.s, 1.01), c.rd.n - 2.01);
        }
        const i0 = Math.floor(c.s), f = c.s - i0;
        const P = c.rd.pts;
        const x = P[i0 * 3] * (1 - f) + P[(i0 + 1) * 3] * f;
        const y = P[i0 * 3 + 1] * (1 - f) + P[(i0 + 1) * 3 + 1] * f;
        const z = P[i0 * 3 + 2] * (1 - f) + P[(i0 + 1) * 3 + 2] * f;
        const hx = (P[(i0 + 1) * 3] - P[i0 * 3]) * c.dir, hz = (P[(i0 + 1) * 3 + 2] - P[i0 * 3 + 2]) * c.dir;
        const il = 1 / Math.max(Math.hypot(hx, hz), 1e-6);
        d.position.set(x - hz * il * c.lane, y + 0.15, z + hx * il * c.lane);
        d.rotation.set(0, Math.atan2(-hz * il, hx * il), 0);
        d.updateMatrix();
        mesh.setMatrixAt(i, d.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    if (nearby && this.boats) {
      const { hulls, cabs, wakes, boats } = this.boats;
      const d = _car;
      for (let i = 0; i < boats.length; i++) {
        const b = boats[i];
        b.t += b.dir * b.spd * dt;
        if (b.t > 1) { b.t = 1; b.dir = -1; }
        if (b.t < 0) { b.t = 0; b.dir = 1; }
        const x = b.A[0] * (1 - b.t) + b.B[0] * b.t;
        const z = b.A[1] * (1 - b.t) + b.B[1] * b.t;
        const hx = (b.B[0] - b.A[0]) * b.dir, hz = (b.B[1] - b.A[1]) * b.dir;
        const yaw = Math.atan2(-hz, hx);
        const y = (this.seaM ?? 0) + 1.2 + Math.sin(this._time * 0.9 + b.phase) * 0.5;
        d.position.set(x, y, z);
        d.rotation.set(Math.sin(this._time * 0.7 + b.phase) * 0.02, yaw, 0);
        d.updateMatrix();
        hulls.setMatrixAt(i, d.matrix);
        cabs.setMatrixAt(i, d.matrix);
        d.position.y = (this.seaM ?? 0) + 0.7;
        d.rotation.set(0, yaw, 0);
        d.updateMatrix();
        wakes.setMatrixAt(i, d.matrix);
      }
      hulls.instanceMatrix.needsUpdate = true;
      cabs.instanceMatrix.needsUpdate = true;
      wakes.instanceMatrix.needsUpdate = true;
    }

    for (const s of this._spr) {
      if (s.sprite) s.sprite.material.opacity =
        (Math.sin(this._time * 1.8 + s.phase) > 0.75 ? 1 : 0.04) * (0.25 + 0.75 * night);
    }
  }

  dispose() {
    this.ps.planetGroup.remove(this.group);
    this.group.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

// --------------------------------------------------------------- field ----

export class CityField {
  constructor(ps) {
    this.ps = ps;
    this._sites = new Map();     // cell key → site | null
    this.active = new Map();     // cell key → City
    this._scanT = 0;
  }

  /** the deterministic metro candidate of one sphere cell, or null */
  _siteFor(ci, cj, ck) {
    const key = ci + ',' + cj + ',' + ck;
    if (this._sites.has(key)) return this._sites.get(key);
    const ps = this.ps;
    let site = null;
    const r = new RNG(hash(ps.pp.seed, ci, cj, ck, 0x517e));
    const base = _sv.set(ci, cj, ck);
    if (base.lengthSq() > 1e-6) {
      base.multiplyScalar(1 / CELL_Q).normalize();
      // ask the glow where it burns hardest in this cell
      const mpu = ps.unitKm * 1000;
      let best = null, bm = 0;
      for (let i = 0; i < 12; i++) {
        _sv2.set(ci + r.float(-0.45, 0.45), cj + r.float(-0.45, 0.45), ck + r.float(-0.45, 0.45))
          .multiplyScalar(1 / CELL_Q).normalize();
        const m = ps._cityMask(_sv2);
        if (m > bm) { bm = m; best = _sv2.clone(); }
      }
      if (best && bm >= MASK_MIN) {
        const radiusM = 1400 + bm * r.float(2200, 3000);
        // the shore pulls: if water lies within reach, slide the center so
        // the waterline crosses the city — port cities have always won
        if (ps.seaR > 0) {
          let east = _sv3.set(0, 1, 0).cross(best);
          if (east.lengthSq() < 1e-6) east = _sv3.set(1, 0, 0).cross(best);
          east.normalize();
          const north = _sv4.crossVectors(east, best);
          let wetAng = null, wetD = 0;
          for (const distM of [3200, 6400, 9600, 12800, 16000]) {
            for (let k = 0; k < 10; k++) {
              const ang = (k / 10) * Math.PI * 2 + distM * 0.001;
              _sv5.copy(best)
                .addScaledVector(east, Math.cos(ang) * distM / mpu / ps.R)
                .addScaledVector(north, Math.sin(ang) * distM / mpu / ps.R).normalize();
              if (ps.quad.heightAt(_sv5) < ps.seaR - 1.5 / mpu) { wetAng = ang; wetD = distM; break; }
            }
            if (wetAng !== null) break;
          }
          if (wetAng !== null && wetD > radiusM * 0.55) {
            const shift = wetD - radiusM * 0.55;    // bring the water to ~half a radius out
            _sv5.copy(best)
              .addScaledVector(east, Math.cos(wetAng) * shift / mpu / ps.R)
              .addScaledVector(north, Math.sin(wetAng) * shift / mpu / ps.R).normalize();
            // only move to ground that can still hold a downtown
            if (ps.quad.heightAt(_sv5) > ps.seaR + 3 / mpu) best.copy(_sv5);
          }
        }
        const h = ps.quad.heightAt(best);
        const dryM = ps.seaR > 0 ? (h - ps.seaR) * ps.unitKm * 1000 : 100;
        if (dryM > 3 && dryM < 900) {
          site = {
            dir: best, ci, cj, ck, mask: bm, radiusM,
            key, name: cityName(ps.pp.seed, ci, cj, ck),
          };
          this._findLanding(site);
        }
      }
    }
    this._sites.set(key, site);
    return site;
  }

  /** a flat, dry plaza near the center for the descent director */
  _findLanding(site) {
    const ps = this.ps;
    const mpu = ps.unitKm * 1000;
    let bestD = null, bestS = 1e9, bestLocal = null;
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2 + site.mask * 7;
      const rad = site.radiusM * (0.10 + 0.012 * i);
      const ox = Math.cos(ang) * rad, oz = Math.sin(ang) * rad;
      let east = _sv2.set(0, 1, 0).cross(site.dir);
      if (east.lengthSq() < 1e-6) east = _sv2.set(1, 0, 0).cross(site.dir);
      east.normalize();
      const north = _sv3.crossVectors(east, site.dir);
      const d = _sv4.copy(site.dir).addScaledVector(east, ox / mpu / ps.quad.heightAt(site.dir))
        .addScaledVector(north, oz / mpu / ps.quad.heightAt(site.dir)).normalize();
      const h = ps.quad.heightAt(d);
      if (ps.seaR > 0 && h < ps.seaR + 3 / mpu) continue;
      const spreadU = Math.abs(ps.quad.heightAt(_sv5.copy(d).addScaledVector(east, 50 / mpu / h).normalize()) - h);
      const s = spreadU * mpu;
      if (s < bestS) { bestS = s; bestD = d.clone(); bestLocal = { x: ox, z: oz }; }
    }
    site.landing = bestD ?? site.dir.clone();
    site.landingLocal = bestLocal ?? { x: 0, z: 0 };
  }

  /** nearest metro to a direction, searching the surrounding cells */
  siteNear(dir) {
    const ci0 = Math.round(dir.x * CELL_Q), cj0 = Math.round(dir.y * CELL_Q), ck0 = Math.round(dir.z * CELL_Q);
    let best = null, bd = 1e9;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const s = this._siteFor(ci0 + dx, cj0 + dy, ck0 + dz);
          if (!s) continue;
          const d = s.dir.angleTo(dir);
          if (d < bd) { bd = d; best = s; }
        }
      }
    }
    return best;
  }

  /** true within a metro footprint — the anchor's hamlet stands down there */
  insideCity(dir) {
    const s = this.siteNear(dir);
    if (!s) return false;
    return s.dir.angleTo(dir) * this.ps.R * this.ps.unitKm * 1000 < s.radiusM * 1.2;
  }

  update(dt) {
    const ps = this.ps;
    this._scanT -= dt;
    if (this._scanT <= 0) {
      this._scanT = 0.7;
      // own scratch: _siteFor spends _sv while the search runs
      const up = _sv6.copy(ps.camPos).normalize();
      const near = this.siteNear(up);
      if (near && !this.active.has(near.key)) {
        const dU = _sv2.copy(near.dir).multiplyScalar(ps.quad.heightAt(near.dir)).distanceTo(ps.camPos);
        // grade the ground from far out, while the tile pipeline is cold —
        // installing it mid-descent evicts the very tiles streaming in
        if (dU < PAD_U) this._installPad(near);
        if (dU < SPAWN_U) {
          this.active.set(near.key, new City(ps, near));
          // never more than two cities resident: drop the farthest
          if (this.active.size > MAX_ACTIVE) {
            let farK = null, farD = -1;
            for (const [k, c] of this.active) {
              const d = c.pos.distanceTo(ps.camPos);
              if (d > farD) { farD = d; farK = k; }
            }
            if (farK) { this.active.get(farK).dispose(); this.active.delete(farK); }
          }
        }
      }
      for (const [k, c] of [...this.active]) {
        if (c.pos.distanceTo(ps.camPos) > DROP_U) { c.dispose(); this.active.delete(k); }
      }
    }
    for (const c of this.active.values()) c.update(dt);
  }

  /** grade the ground before the city stands on it — installed once,
   *  deterministic (raw-field target), tiles under it restream */
  _installPad(site) {
    if (site.padded) return;
    site.padded = true;
    const ps = this.ps;
    const target = ps.quad.heightAt(site.dir);
    ps.quad.addPad(site.dir.x, site.dir.y, site.dir.z,
      site.radiusM * 1.5 / (ps.unitKm * 1000), target);
  }

  /** the HUD line: nearest resident city, named and measured */
  hudRows() {
    const ps = this.ps;
    let best = null, bd = 1e9;
    for (const c of this.active.values()) {
      const d = c.pos.distanceTo(ps.camPos);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return [];
    const popM = best.pop >= 1e6 ? (best.pop / 1e6).toFixed(1) + ' M' : Math.round(best.pop / 1e3) + ' k';
    const rows = [['city', `${best.name} · pop ${popM} · ${ps._fmtKm(bd * ps.unitKm)}`]];
    if (best.built && best.cars) {
      rows.push(['downtown', `${best.cars.agents.length} vehicles · ${best.boats?.boats.length ?? 0} ferries · ${best.bridges.length} bridges`]);
    }
    return rows;
  }

  dispose() {
    for (const c of this.active.values()) c.dispose();
    this.active.clear();
  }
}

// scratch
const _hv = new THREE.Vector3();
const _sv = new THREE.Vector3();
const _sv2 = new THREE.Vector3();
const _sv3 = new THREE.Vector3();
const _sv4 = new THREE.Vector3();
const _sv5 = new THREE.Vector3();
const _sv6 = new THREE.Vector3();
const _car = new THREE.Object3D();
