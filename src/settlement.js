// Somebody lives here — and now it's somewhere.
//
// Inhabited worlds carry a named town: pitched roofs around a plaza, warm
// windows that come on with the dark, chimney smoke drifting on the wind,
// terraced fields on the gentle slopes, a windmill turning on the rise, a
// belltower keeping the hours, and lantern-lit paths walking out to the
// hamlets. At the plaza's heart stands an old ring-gate nobody remembers
// raising; at dusk it hums with a light of its own. All of it is
// deterministic — return to the same world and the same town is waiting.

import * as THREE from 'three';
import { hash, RNG, cityName } from './rng.js';
import { softDotTexture } from './nebula.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const HOUSE_VERT = /* glsl */`
  attribute float aSeed;
  attribute vec2 aGrid;
  varying vec2 vUv;
  varying vec3 vN;
  varying float vSeed;
  varying vec2 vGrid;
  varying float vSide;   // 1 walls, 0 roof
  void main() {
    vUv = uv;
    vSeed = aSeed;
    vGrid = aGrid;
    vSide = 1.0 - step(0.45, abs(normal.y));
    #ifdef USE_INSTANCING
      vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
      vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
    #else
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 w = modelMatrix * vec4(position, 1.0);
    #endif
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const HOUSE_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uNight;
  uniform vec3 uFacade;
  uniform vec3 uRoof;
  varying vec2 vUv;
  varying vec3 vN;
  varying float vSeed;
  varying vec2 vGrid;
  varying float vSide;

  float hash2(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7)) + vSeed * 37.0) * 43758.5453);
  }

  void main() {
    float day = 1.0 - uNight;
    float diff = max(dot(vN, uSunDir), 0.0);
    // each house wears its own shade of the town's plaster
    vec3 base = mix(uFacade, uRoof, step(0.5, 1.0 - vSide));
    base *= 0.82 + 0.36 * fract(vSeed * 0.731);
    vec3 col = base * (0.05 + diff * day * 0.95 + 0.10 * day) * mix(vec3(1.0), uSunColor, 0.35);

    if (vSide > 0.5) {
      vec2 g = vUv * vGrid;
      vec2 cell = floor(g);
      vec2 f = fract(g);
      float win = step(0.24, f.x) * step(f.x, 0.76) * step(0.3, f.y) * step(f.y, 0.72);
      float on = step(0.35, hash2(cell)); // some homes are out tonight
      float flick = 0.85 + 0.15 * hash2(cell + 7.0);
      col += vec3(1.0, 0.7, 0.4) * win * on * flick * (uNight * 1.5 + 0.03);
      col = mix(col, col * 0.82, win * day); // glass reads darker by day
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

const FIELD_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uCropA;
  uniform vec3 uCropB;
  uniform float uRows;
  varying vec2 vUv;
  void main() {
    float day = smoothstep(-0.12, 0.2, uSunDir.y);
    float row = 0.5 + 0.5 * sin(vUv.y * uRows * 6.2831);
    vec3 col = mix(uCropA, uCropB, smoothstep(0.25, 0.75, row));
    col *= 0.12 + day * (0.75 + 0.25 * row);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** a little house: unit box (y 0..1) wearing a gabled roof (y 1..1.5) */
function houseGeometry() {
  const v = [], n = [], uv = [];
  const quad = (a, b, c, d, nx, ny, nz, us) => {
    for (const p of [a, b, c, a, c, d]) v.push(...p);
    for (let i = 0; i < 6; i++) n.push(nx, ny, nz);
    for (const q of [us[0], us[1], us[2], us[0], us[2], us[3]]) uv.push(...q);
  };
  const h = 0.5; // half width/depth
  // walls
  quad([-h, 0, h], [h, 0, h], [h, 1, h], [-h, 1, h], 0, 0, 1, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  quad([h, 0, -h], [-h, 0, -h], [-h, 1, -h], [h, 1, -h], 0, 0, -1, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  quad([h, 0, h], [h, 0, -h], [h, 1, -h], [h, 1, h], 1, 0, 0, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  quad([-h, 0, -h], [-h, 0, h], [-h, 1, h], [-h, 1, -h], -1, 0, 0, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // roof: ridge along x at y=1.5
  const s = 0.62; // eaves overhang
  const k = 1 / Math.hypot(0.5, s); // slope normal
  quad([-s, 1, s], [s, 1, s], [s, 1.5, 0], [-s, 1.5, 0], 0, s * k, 0.5 * k, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  quad([s, 1, -s], [-s, 1, -s], [-s, 1.5, 0], [s, 1.5, 0], 0, s * k, -0.5 * k, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // gable ends (triangles — they get little attic windows for free)
  v.push(h, 1, h, h, 1, -h, h, 1.5, 0); n.push(1, 0, 0, 1, 0, 0, 1, 0, 0); uv.push(0, 1, 1, 1, 0.5, 1.45);
  v.push(-h, 1, -h, -h, 1, h, -h, 1.5, 0); n.push(-1, 0, 0, -1, 0, 0, -1, 0, 0); uv.push(0, 1, 1, 1, 0.5, 1.45);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2));
  return geo;
}

export function addSettlement(s) {
  const pp = s.pp;
  if (!pp.inhabited) return null;
  const r = new RNG(hash(pp.seed, 0x5e771e));
  const dry = (x, z, m = 2.5) => s.seaLevel === null || s.heightAt(x, z) > s.seaLevel + m;

  // ------------------------------------------------------------- sites ----
  // the town wants flat, dry ground within a stroll of where you land
  const flatness = (x, z) => {
    const h = s.heightAt(x, z);
    return Math.max(
      Math.abs(s.heightAt(x + 45, z) - h), Math.abs(s.heightAt(x - 45, z) - h),
      Math.abs(s.heightAt(x, z + 45) - h), Math.abs(s.heightAt(x, z - 45) - h));
  };
  let site = null, bestVar = 1e9;
  for (let i = 0; i < 120; i++) {
    const th = r.float(0, 6.28), rad = r.float(150, 520);
    const x = s.spawn.x + Math.cos(th) * rad, z = s.spawn.z + Math.sin(th) * rad;
    if (!dry(x, z)) continue;
    const spread = flatness(x, z);
    if (spread < bestVar) { bestVar = spread; site = { x, z, h: s.heightAt(x, z) }; }
  }
  if (!site) return null;
  const name = cityName(pp.seed, 3, 7, 1);

  const group = new THREE.Group();
  s.scene.add(group);

  // town palette: plaster from the world's own light rock, terracotta roofs
  const rHue = r.float(0.015, 0.075);
  const facade = pp.colB.clone().lerp(new THREE.Color(0.85, 0.8, 0.72), 0.55);
  const roof = new THREE.Color().setHSL(rHue, 0.52, 0.3);

  const houseMat = new THREE.ShaderMaterial({
    uniforms: {
      uSunDir: s.uSunDir, uSunColor: s.uSunColor,
      uNight: { value: 0 },
      uFacade: { value: facade },
      uRoof: { value: roof },
    },
    vertexShader: HOUSE_VERT,
    fragmentShader: HOUSE_FRAG,
  });

  // ------------------------------------------------------------ houses ----
  // the town proper rings its plaza; hamlets sit out along the paths
  const hamlets = [];
  for (let i = 0; i < (COARSE ? 1 : 2); i++) {
    for (let tries = 0; tries < 40; tries++) {
      const th = r.float(0, 6.28), rad = r.float(520, 980);
      const x = site.x + Math.cos(th) * rad, z = site.z + Math.sin(th) * rad;
      if (!dry(x, z) || flatness(x, z) > 26) continue;
      hamlets.push({ x, z, n: r.int(4, 7) });
      break;
    }
  }
  const NT = COARSE ? 22 : 34;
  const N = NT + hamlets.reduce((a, hm) => a + hm.n, 0);
  const geo = houseGeometry();
  const seeds = new Float32Array(N);
  const grids = new Float32Array(N * 2);
  const town = new THREE.InstancedMesh(geo, houseMat, N);
  const d = new THREE.Object3D();
  const homes = []; // roof-ridge points, for the chimney smoke
  let hi = 0;
  const placeHouse = (cx, cz, radMax, plaza) => {
    const ang = r.float(0, 6.28);
    const rad = plaza + Math.abs(r.gauss()) * radMax;
    const x = cx + Math.cos(ang) * rad, z = cz + Math.sin(ang) * rad;
    if (!dry(x, z)) return;
    const h = s.heightAt(x, z);
    const tall = rad < radMax * 0.5 && r.chance(0.12);
    const w = r.float(7, 12), ht = tall ? r.float(14, 22) : r.float(5, 9), dp = r.float(7, 12);
    d.position.set(x, h - 0.6, z);
    // houses face the plaza the way houses do: mostly, not exactly
    d.rotation.set(0, -ang + Math.PI / 2 + r.float(-0.3, 0.3), 0);
    d.scale.set(w, ht, dp);
    d.updateMatrix();
    town.setMatrixAt(hi, d.matrix);
    seeds[hi] = r.float(0, 100);
    grids[hi * 2] = Math.max(Math.round(w * 0.4), 2);
    grids[hi * 2 + 1] = Math.max(Math.round(ht * 0.5), 2);
    homes.push({ x, y: h + ht * 1.42, z, w });
    hi++;
  };
  for (let i = 0; i < NT; i++) placeHouse(site.x, site.z, 95, 16);
  for (const hm of hamlets) for (let i = 0; i < hm.n; i++) placeHouse(hm.x, hm.z, 34, 6);
  town.count = hi;
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geo.setAttribute('aGrid', new THREE.InstancedBufferAttribute(grids, 2));
  group.add(town);

  // --------------------------------------------------------- belltower ----
  const towerH = 17;
  {
    const th = r.float(0, 6.28);
    const x = site.x + Math.cos(th) * 20, z = site.z + Math.sin(th) * 20;
    const h = s.heightAt(x, z);
    const body = new THREE.Mesh(new THREE.BoxGeometry(4.2, towerH, 4.2),
      new THREE.MeshStandardMaterial({ color: facade.clone().multiplyScalar(0.8), roughness: 0.9 }));
    body.position.set(x, h + towerH / 2 - 0.5, z);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.4, 3.4, 4),
      new THREE.MeshStandardMaterial({ color: roof, roughness: 0.85 }));
    cap.position.set(x, h + towerH + 1.2, z);
    cap.rotation.y = Math.PI / 4;
    group.add(body, cap);
  }

  // ---------------------------------------------------------- windmill ----
  // on the rise where the wind lives
  let mill = null;
  for (let tries = 0; tries < 50; tries++) {
    const th = r.float(0, 6.28), rad = r.float(130, 320);
    const x = site.x + Math.cos(th) * rad, z = site.z + Math.sin(th) * rad;
    const h = s.heightAt(x, z);
    if (!dry(x, z) || h < site.h + 4) continue;
    const towerHt = 13;
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.6, towerHt, 8),
      new THREE.MeshStandardMaterial({ color: facade.clone().multiplyScalar(0.75), roughness: 0.92 }));
    tower.position.set(x, h + towerHt / 2, z);
    const capm = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.2, 8),
      new THREE.MeshStandardMaterial({ color: roof, roughness: 0.85 }));
    capm.position.set(x, h + towerHt + 1, z);
    const rotor = new THREE.Group();
    const bladeM = new THREE.MeshStandardMaterial({ color: 0xcfc4ae, roughness: 0.8, side: THREE.DoubleSide });
    for (let b = 0; b < 4; b++) {
      const blade = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 7.4), bladeM);
      blade.position.y = 4.4;
      const arm = new THREE.Group();
      arm.add(blade);
      arm.rotation.z = b * Math.PI / 2;
      rotor.add(arm);
    }
    // face the town, tilted a touch skyward the way mills lean
    rotor.position.set(x, h + towerHt - 1.2, z);
    rotor.lookAt(site.x, h + towerHt + 8, site.z);
    group.add(tower, capm, rotor);
    mill = { rotor, speed: r.float(0.35, 0.7) };
    break;
  }

  // ------------------------------------------------------------ fields ----
  const crops = [
    new THREE.Color().setHSL(0.24 + r.float(-0.05, 0.05), 0.45, 0.32),
    new THREE.Color().setHSL(0.13 + r.float(-0.03, 0.05), 0.6, 0.4),
  ];
  let planted = 0;
  for (let tries = 0; tries < 60 && planted < (COARSE ? 4 : 7); tries++) {
    const th = r.float(0, 6.28), rad = r.float(90, 300);
    const x = site.x + Math.cos(th) * rad, z = site.z + Math.sin(th) * rad;
    if (!dry(x, z, 4) || flatness(x, z) > 16) continue;
    const w = r.float(26, 44), dp = r.float(16, 30);
    const fg = new THREE.PlaneGeometry(w, dp, 7, 5);
    fg.rotateX(-Math.PI / 2);
    const rot = r.float(0, 6.28);
    const pos = fg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i), lz = pos.getZ(i);
      const wx = x + lx * Math.cos(rot) - lz * Math.sin(rot);
      const wz = z + lx * Math.sin(rot) + lz * Math.cos(rot);
      pos.setY(i, s.heightAt(wx, wz) - s.heightAt(x, z) + 0.25);
    }
    const field = new THREE.Mesh(fg, new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: s.uSunDir,
        uCropA: { value: crops[0].clone().offsetHSL(r.float(-0.02, 0.02), 0, r.float(-0.04, 0.04)) },
        uCropB: { value: crops[1] },
        uRows: { value: r.int(5, 9) },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: FIELD_FRAG,
    }));
    field.position.set(x, 0, z);
    field.rotation.y = rot;
    group.add(field);
    planted++;
  }

  // ---------------------------------------------- paths, hung with light ----
  // lantern posts walk from the plaza out to the spawn and the hamlets
  const lampPts = [];
  const postGeo = new THREE.CylinderGeometry(0.09, 0.13, 2.8, 5);
  const targets = [{ x: s.spawn.x, z: s.spawn.z }, ...hamlets];
  const postXf = [];
  const routes = []; // the walkable polylines, for whoever walks them
  for (const t of targets) {
    const dx = t.x - site.x, dz = t.z - site.z;
    const len = Math.hypot(dx, dz);
    const steps = Math.floor(len / 26);
    const route = [{ x: site.x, z: site.z }];
    for (let i = 1; i < steps; i++) {
      const wob = Math.sin(i * 1.7) * 6; // paths wander a little
      const px = site.x + dx * (i / steps) - dz / len * wob;
      const pz = site.z + dz * (i / steps) + dx / len * wob;
      if (!dry(px, pz, 1.2)) break; // the path stops at the shore
      const h = s.heightAt(px, pz);
      postXf.push({ x: px, h, z: pz });
      lampPts.push(px, h + 3.05, pz);
      route.push({ x: px, z: pz });
    }
    if (route.length > 3) routes.push(route);
  }
  if (postXf.length) {
    const posts = new THREE.InstancedMesh(postGeo,
      new THREE.MeshStandardMaterial({ color: 0x27251f, roughness: 0.95 }), postXf.length);
    postXf.forEach((p, i) => {
      d.position.set(p.x, p.h + 1.4, p.z);
      d.rotation.set(0, 0, 0);
      d.scale.setScalar(1);
      d.updateMatrix();
      posts.setMatrixAt(i, d.matrix);
    });
    group.add(posts);
  }
  const lampGeo = new THREE.BufferGeometry();
  lampGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(lampPts), 3));
  const lamps = new THREE.Points(lampGeo, new THREE.PointsMaterial({
    map: softDotTexture(32), color: new THREE.Color(1.35, 0.85, 0.42),
    size: 3.2, transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  group.add(lamps);

  // ------------------------------------------------------ the ring-gate ----
  // the town square keeps an artifact older than the town
  const gate = new THREE.Group();
  {
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.1, 1.1, 10),
      new THREE.MeshStandardMaterial({ color: 0x3a3733, roughness: 0.9 }));
    plinth.position.y = 0.55;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.34, 8, 30),
      new THREE.MeshStandardMaterial({ color: 0x54504a, roughness: 0.55, metalness: 0.35 }));
    ring.position.y = 4.4;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(2.6, 26),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.5, 0.8, 1.2), transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
      }));
    glow.position.y = 4.4;
    gate.add(plinth, ring, glow);
    const gh = s.heightAt(site.x, site.z);
    gate.position.set(site.x, gh, site.z);
    gate.rotation.y = r.float(0, 6.28);
    group.add(gate);
    gate.userData.glow = glow;
  }

  // -------------------------------------------------- the market square ----
  // stalls under canvas awnings, crates stacked where crates get stacked:
  // many small honest pieces, which is what makes a town look worked-in
  {
    const crateN = COARSE ? 14 : 24;
    const crates = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x6b5233, roughness: 0.95 }), crateN);
    for (let i = 0; i < crateN; i++) {
      const hm = homes[r.int(0, Math.min(homes.length - 1, NT - 1))];
      const x = hm.x + r.gauss() * 7, z = hm.z + r.gauss() * 7;
      const sc = r.float(0.6, 1.2);
      d.position.set(x, s.heightAt(x, z) + sc / 2, z);
      d.rotation.set(0, r.float(0, 6.28), 0);
      d.scale.setScalar(sc);
      d.updateMatrix();
      crates.setMatrixAt(i, d.matrix);
    }
    group.add(crates);

    const awnMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(r.float(0, 1), 0.55, 0.5),
      roughness: 0.85, side: THREE.DoubleSide,
    });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x4a3d2c, roughness: 0.95 });
    for (let i = 0; i < (COARSE ? 2 : 4); i++) {
      const ang = r.float(0, 6.28), rad = r.float(9, 15);
      const x = site.x + Math.cos(ang) * rad, z = site.z + Math.sin(ang) * rad;
      const h = s.heightAt(x, z);
      const stall = new THREE.Group();
      for (const [ox, oz] of [[-1.4, -1], [1.4, -1], [-1.4, 1], [1.4, 1]]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 2.3, 5), poleMat);
        pole.position.set(ox, 1.15, oz);
        stall.add(pole);
      }
      const awning = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.6),
        i % 2 ? awnMat : awnMat.clone());
      if (i % 2 === 0) awning.material.color.setHSL(r.float(0, 1), 0.5, 0.52);
      awning.rotation.x = -Math.PI / 2 + 0.12;
      awning.position.y = 2.35;
      const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 1.6),
        new THREE.MeshStandardMaterial({ color: 0x7a6242, roughness: 0.9 }));
      counter.position.y = 0.4;
      stall.add(awning, counter);
      stall.position.set(x, h, z);
      stall.rotation.y = -ang;
      group.add(stall);
    }
  }

  // --------------------------------------------------------- townsfolk ----
  // people walk the lantern paths — to the hamlets in the morning, home
  // at dusk, lanterns swinging after dark. the town breathes
  const folk = [];
  const folkN = routes.length ? (COARSE ? 6 : 12) : 0;
  let folkMesh = null, folkLampPts = null, folkLamps = null;
  if (folkN) {
    // one little body: a cone of coat and a head, merged by scene graph
    const fGeo = (() => {
      const cone = new THREE.ConeGeometry(0.32, 1.15, 7);
      cone.translate(0, 0.58, 0);
      const headG = new THREE.SphereGeometry(0.13, 8, 6);
      headG.translate(0, 1.3, 0);
      const pos = new Float32Array((cone.attributes.position.count + headG.attributes.position.count) * 3);
      pos.set(cone.attributes.position.array, 0);
      pos.set(headG.attributes.position.array, cone.attributes.position.count * 3);
      const nrm = new Float32Array(pos.length);
      nrm.set(cone.attributes.normal.array, 0);
      nrm.set(headG.attributes.normal.array, cone.attributes.normal.count * 3);
      const idx = [];
      for (let i = 0; i < cone.index.count; i++) idx.push(cone.index.array[i]);
      const base = cone.attributes.position.count;
      for (let i = 0; i < headG.index.count; i++) idx.push(headG.index.array[i] + base);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      g.setIndex(idx);
      return g;
    })();
    folkMesh = new THREE.InstancedMesh(fGeo,
      new THREE.MeshStandardMaterial({ roughness: 0.9 }), folkN);
    const fColor = new THREE.Color();
    folkLampPts = new Float32Array(folkN * 3);
    for (let i = 0; i < folkN; i++) {
      const route = routes[i % routes.length];
      folk.push({
        route,
        u: r.float(0, route.length - 1.01),
        dir: r.sign(),
        pace: r.float(1.7, 3.1),
        sway: r.float(0, 6.28),
      });
      fColor.setHSL(r.float(0, 1), r.float(0.25, 0.5), r.float(0.28, 0.5));
      folkMesh.setColorAt(i, fColor);
    }
    group.add(folkMesh);
    const flGeo = new THREE.BufferGeometry();
    flGeo.setAttribute('position', new THREE.BufferAttribute(folkLampPts, 3));
    folkLamps = new THREE.Points(flGeo, new THREE.PointsMaterial({
      map: softDotTexture(32), color: new THREE.Color(1.3, 0.8, 0.4),
      size: 1.6, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    }));
    group.add(folkLamps);
  }

  // ---------------------------------------------------- chimney smoke ----
  // a handful of hearths breathe; their smoke leans with the wind
  const NSMOKE = COARSE ? 36 : 64;
  const hearths = homes.slice(0, COARSE ? 5 : 9);
  const smokeGeo = new THREE.BufferGeometry();
  const sPos = new Float32Array(NSMOKE * 3);
  const sAge = new Float32Array(NSMOKE);
  for (let i = 0; i < NSMOKE; i++) sAge[i] = (i / NSMOKE) * 9;
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const smoke = hearths.length ? new THREE.Points(smokeGeo, new THREE.PointsMaterial({
    map: softDotTexture(32), color: 0x9aa0a8, size: 4.5,
    transparent: true, opacity: 0.16, depthWrite: false, sizeAttenuation: true,
  })) : null;
  if (smoke) group.add(smoke);
  const windAng = r.float(0, 6.28);
  const wind = { x: Math.cos(windAng) * 1.7, z: Math.sin(windAng) * 1.7 };

  // beacon masts, blinking their slow red warning — the town has radios
  const beacons = [];
  const tex = softDotTexture(32);
  for (let i = 0; i < 2; i++) {
    const ang = r.float(0, 6.28);
    const x = site.x + Math.cos(ang) * r.float(90, 150), z = site.z + Math.sin(ang) * r.float(90, 150);
    if (!dry(x, z, 1)) continue;
    const h = s.heightAt(x, z);
    const mastH = r.float(30, 55);
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.6, mastH, 6),
      new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.9 }));
    mast.position.set(x, h + mastH / 2, z);
    group.add(mast);
    const lamp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(1.6, 0.12, 0.1),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    lamp.position.set(x, h + mastH + 1.5, z);
    lamp.scale.setScalar(6);
    group.add(lamp);
    beacons.push({ lamp, phase: r.float(0, 6.28) });
  }

  // a level spot at the plaza's edge where a skiff can wait
  const dockTh = r.float(0, 6.28);
  const dock = {
    x: site.x + Math.cos(dockTh) * 34,
    z: site.z + Math.sin(dockTh) * 34,
  };
  dock.y = s.heightAt(dock.x, dock.z);

  let time = 0;
  return {
    site, name, dock,
    update(dt, sunY) {
      time += dt;
      const night = 1 - Math.min(Math.max((sunY + 0.12) * 3.5, 0), 1);
      houseMat.uniforms.uNight.value = night;
      lamps.material.opacity = night * 0.85;
      if (folkMesh) {
        const dm = new THREE.Object3D();
        for (let i = 0; i < folk.length; i++) {
          const f = folk[i];
          f.u += f.dir * f.pace * dt / 26; // route points sit ~26 m apart
          if (f.u <= 0 || f.u >= f.route.length - 1.01) { f.dir *= -1; f.u = Math.min(Math.max(f.u, 0), f.route.length - 1.01); }
          const i0 = Math.floor(f.u), frac = f.u - i0;
          const a = f.route[i0], b = f.route[Math.min(i0 + 1, f.route.length - 1)];
          const x = a.x + (b.x - a.x) * frac, z = a.z + (b.z - a.z) * frac;
          const h = s.heightAt(x, z);
          dm.position.set(x, h + Math.abs(Math.sin(time * f.pace * 2.2 + f.sway)) * 0.06, z);
          dm.rotation.y = Math.atan2((b.x - a.x) * f.dir, (b.z - a.z) * f.dir);
          dm.updateMatrix();
          folkMesh.setMatrixAt(i, dm.matrix);
          // a hand-lantern leads each walker through the dark
          folkLampPts[i * 3] = x + Math.sin(dm.rotation.y) * 0.4;
          folkLampPts[i * 3 + 1] = h + 0.85;
          folkLampPts[i * 3 + 2] = z + Math.cos(dm.rotation.y) * 0.4;
        }
        folkMesh.instanceMatrix.needsUpdate = true;
        folkLamps.geometry.attributes.position.needsUpdate = true;
        folkLamps.material.opacity = night * 0.9;
      }
      if (mill) mill.rotor.rotateOnAxis(_axisZ, dt * mill.speed);
      // the gate hums brightest in the blue hour
      const dusk = Math.max(1 - Math.abs(sunY + 0.06) * 7, 0);
      gate.userData.glow.material.opacity = dusk * 0.5 + night * 0.12;
      if (smoke) {
        for (let i = 0; i < NSMOKE; i++) {
          sAge[i] += dt;
          if (sAge[i] > 9) sAge[i] -= 9;
          const a = sAge[i];
          const hm = hearths[i % hearths.length];
          const sway = Math.sin(a * 1.3 + i) * 0.6;
          sPos[i * 3] = hm.x + wind.x * a * 0.55 + sway;
          sPos[i * 3 + 1] = hm.y + a * 1.5;
          sPos[i * 3 + 2] = hm.z + wind.z * a * 0.55 + sway * 0.6;
        }
        smokeGeo.attributes.position.needsUpdate = true;
      }
      for (const b of beacons) {
        b.lamp.material.opacity = (Math.sin(time * 2.2 + b.phase) > 0.82 ? 1 : 0.06) * (0.4 + 0.6 * night);
      }
    },
  };
}

const _axisZ = new THREE.Vector3(0, 0, 1);
