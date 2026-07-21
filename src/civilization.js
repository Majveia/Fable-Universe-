// Who lives here, and what they built.
//
// Not every world is a pastoral village. The resonance and the seed decide a
// civilization's character: the neon PORT that never sleeps (chrome and
// rain), the ancient MONUMENTAL capital of stone (the desert's counsel), or
// a SPACEFARING outpost with its landing field and a ship on the pad. Each
// keeps the lived-in town underneath — its roads, its folk, its smoke — and
// raises its own signature over it, so a descent can open on a farmhouse or
// a skyline or a launch tower.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture } from './nebula.js';
import { addSettlement } from './settlement.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const ARCHE_BIAS = {
  chrome: 'port', searemembers: 'port',
  counsel: 'monument', vault: 'monument', gold: 'monument',
  wanderers: 'pastoral', greenshade: 'pastoral', afternoon: 'pastoral',
};

export function pickArchetype(pp) {
  const r = new RNG(hash(pp.seed, 0xc1723));
  const bias = ARCHE_BIAS[pp.res?.id];
  if (bias && r.chance(0.7)) return bias;
  return ['pastoral', 'pastoral', 'port', 'monument', 'spaceport'][(r.next() * 5) | 0];
}

export function addCivilization(s) {
  const pp = s.pp;
  if (!pp.inhabited) return null;
  const town = addSettlement(s);
  if (!town) return null;
  const arche = pickArchetype(pp);
  town.archetype = arche;
  if (arche === 'pastoral') return town;

  const r = new RNG(hash(pp.seed, 0xc1723, 7));
  const site = town.site;
  const dry = (x, z, m = 2) => s.seaLevel === null || s.heightAt(x, z) > s.seaLevel + m;
  const d = new THREE.Object3D();
  const group = new THREE.Group();
  s.scene.add(group);
  let districtUpdate = null;

  if (arche === 'port') districtUpdate = buildPort(s, group, site, r, d, dry);
  else if (arche === 'monument') districtUpdate = buildMonument(s, group, site, r, d, dry);
  else if (arche === 'spaceport') districtUpdate = buildSpaceport(s, group, site, r, d, dry);

  const townUpdate = town.update;
  town.update = (dt, sunY) => { townUpdate(dt, sunY); districtUpdate?.(dt, sunY); };
  return town;
}

// ------------------------------------------------------------- the port ----
const NEON_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform float uNight;
  uniform vec3 uNeon;
  varying vec2 vUv;
  varying vec3 vN;
  varying float vSeed;
  varying float vSide;
  float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)) + vSeed*41.0)*43758.5); }
  void main(){
    float day = 1.0 - uNight;
    float diff = max(dot(normalize(vN), uSunDir), 0.0);
    vec3 col = vec3(0.05,0.06,0.08) * (0.12 + diff*day*0.7);
    if (vSide > 0.5) {
      vec2 g = vUv * vec2(4.0, 22.0);
      vec2 cell = floor(g); vec2 f = fract(g);
      float win = step(0.15,f.x)*step(f.x,0.85)*step(0.2,f.y)*step(f.y,0.85);
      float on = step(0.28, h2(cell));
      vec3 tint = mix(uNeon, vec3(1.0,0.8,0.5), step(0.6, h2(cell+3.0)));
      col += tint * win * on * (uNight*1.7 + 0.05);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;
const NEON_VERT = /* glsl */`
  attribute float aSeed;
  varying vec2 vUv; varying vec3 vN; varying float vSeed; varying float vSide;
  void main(){
    vUv = uv; vSeed = aSeed;
    vSide = 1.0 - step(0.5, abs(normal.y));
    #ifdef USE_INSTANCING
      vN = normalize(mat3(modelMatrix)*mat3(instanceMatrix)*normal);
      vec4 w = modelMatrix*instanceMatrix*vec4(position,1.0);
    #else
      vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0);
    #endif
    gl_Position = projectionMatrix*viewMatrix*w;
  }
`;

function buildPort(s, group, site, r, d, dry) {
  const N = COARSE ? 14 : 26;
  const neon = new THREE.Color().setHSL(r.float(0.5, 0.85), 0.9, 0.6);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: s.uSunDir, uNight: { value: 0 }, uNeon: { value: neon } },
    vertexShader: NEON_VERT, fragmentShader: NEON_FRAG,
  });
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const seeds = new Float32Array(N);
  const towers = new THREE.InstancedMesh(geo, mat, N);
  let placed = 0;
  for (let i = 0; i < N * 3 && placed < N; i++) {
    const ang = r.float(0, 6.28), rad = 30 + Math.abs(r.gauss()) * 90;
    const x = site.x + Math.cos(ang) * rad, z = site.z + Math.sin(ang) * rad;
    if (!dry(x, z)) continue;
    const h = s.heightAt(x, z);
    const w = r.float(6, 13), ht = r.float(26, 92), dp = r.float(6, 13);
    d.position.set(x, h + ht / 2 - 1, z);
    d.rotation.set(0, r.float(0, 6.28), 0);
    d.scale.set(w, ht, dp);
    d.updateMatrix();
    towers.setMatrixAt(placed, d.matrix);
    seeds[placed] = r.float(0, 100);
    placed++;
  }
  towers.count = placed;
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  group.add(towers);

  // holo-signage: a few big emissive panels glowing above the streets
  const signs = [];
  for (let i = 0; i < (COARSE ? 3 : 6); i++) {
    const ang = r.float(0, 6.28), rad = r.float(30, 100);
    const x = site.x + Math.cos(ang) * rad, z = site.z + Math.sin(ang) * rad;
    if (!dry(x, z)) continue;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(r.float(4, 9), r.float(6, 16)),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setHSL(r.float(0, 1), 0.9, 0.6),
        transparent: true, opacity: 0, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
    sign.position.set(x, s.heightAt(x, z) + r.float(16, 40), z);
    sign.rotation.y = r.float(0, 6.28);
    group.add(sign);
    signs.push({ sign, phase: r.float(0, 6.28) });
  }
  return (dt, sunY) => {
    const night = 1 - Math.min(Math.max((sunY + 0.12) * 3.5, 0), 1);
    mat.uniforms.uNight.value = night;
    const t = performance.now() * 0.001;
    for (const g of signs) g.sign.material.opacity = night * (0.4 + 0.35 * Math.sin(t * 1.5 + g.phase));
  };
}

// --------------------------------------------------------- the monument ----
function buildMonument(s, group, site, r, d, dry) {
  const stone = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.09, 0.2, 0.62), roughness: 0.95, flatShading: true,
  });
  const dark = stone.clone(); dark.color.multiplyScalar(0.7);

  // a stepped ziggurat at the heart
  const tiers = COARSE ? 4 : 6;
  for (let i = 0; i < tiers; i++) {
    const w = 60 - i * (44 / tiers);
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, 7, w), i % 2 ? dark : stone);
    box.position.set(site.x, s.heightAt(site.x, site.z) + 3.5 + i * 7, site.z);
    box.rotation.y = 0.02 * i;
    group.add(box);
  }
  // a colonnade avenue leading in, and a great obelisk
  const avenue = r.float(0, 6.28);
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 1; i <= (COARSE ? 5 : 9); i++) {
      const along = 46 + i * 12;
      const across = side * 14;
      const x = site.x + Math.cos(avenue) * along - Math.sin(avenue) * across;
      const z = site.z + Math.sin(avenue) * along + Math.cos(avenue) * across;
      if (!dry(x, z)) continue;
      const h = s.heightAt(x, z);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.9, r.float(14, 20), 8), stone);
      col.position.set(x, h + 9, z);
      group.add(col);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.6, 4.4), dark);
      cap.position.set(x, h + 18.5, z);
      group.add(cap);
    }
  }
  const obh = r.float(34, 52);
  const obel = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3.4, obh, 4), stone);
  const ox = site.x + Math.cos(avenue) * 150, oz = site.z + Math.sin(avenue) * 150;
  obel.position.set(ox, s.heightAt(ox, oz) + obh / 2, oz);
  obel.rotation.y = Math.PI / 4;
  group.add(obel);
  // a beacon at the obelisk's cap, lit at night
  const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture(32), color: new THREE.Color(1.3, 0.9, 0.5),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  beacon.position.set(ox, s.heightAt(ox, oz) + obh + 2, oz);
  beacon.scale.setScalar(6);
  group.add(beacon);
  return (dt, sunY) => {
    const night = 1 - Math.min(Math.max((sunY + 0.12) * 3.5, 0), 1);
    beacon.material.opacity = night * (0.6 + 0.4 * Math.sin(performance.now() * 0.002));
  };
}

// --------------------------------------------------------- the spaceport ----
function buildSpaceport(s, group, site, r, d, dry) {
  const metal = new THREE.MeshStandardMaterial({ color: 0x7c848c, roughness: 0.5, metalness: 0.4 });
  const prefab = new THREE.MeshStandardMaterial({ color: 0x9aa0a2, roughness: 0.7 });
  const pads = [];
  // landing pads: low discs with an emissive ring of edge-lights
  for (let i = 0; i < (COARSE ? 2 : 3); i++) {
    const ang = r.float(0, 6.28), rad = r.float(40, 110);
    const x = site.x + Math.cos(ang) * rad, z = site.z + Math.sin(ang) * rad;
    if (!dry(x, z)) continue;
    const h = s.heightAt(x, z);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(11, 12, 1.2, 20), metal);
    disc.position.set(x, h + 0.6, z);
    group.add(disc);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(10, 0.5, 6, 28),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 0.8, 1.1), transparent: true,
        opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, h + 1.3, z);
    group.add(ring);
    pads.push({ x, z, h, ring });
  }
  // domes + antenna masts
  for (let i = 0; i < (COARSE ? 3 : 6); i++) {
    const ang = r.float(0, 6.28), rad = r.float(20, 70);
    const x = site.x + Math.cos(ang) * rad, z = site.z + Math.sin(ang) * rad;
    if (!dry(x, z)) continue;
    const h = s.heightAt(x, z);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r.float(4, 8), 12, 8, 0, 6.28, 0, Math.PI / 2), prefab);
    dome.position.set(x, h, z);
    group.add(dome);
    if (r.chance(0.5)) {
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, r.float(16, 28), 5), metal);
      mast.position.set(x + r.float(-6, 6), h + 10, z + r.float(-6, 6));
      group.add(mast);
    }
  }
  // the ship on the pad — a capsule hull on fins — that periodically launches
  const ship = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 8, 6, 12), prefab);
  hull.position.y = 8;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(2.4, 4, 12), metal);
  nose.position.y = 14;
  for (let f = 0; f < 3; f++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 3), metal);
    const a = f / 3 * 6.28;
    fin.position.set(Math.cos(a) * 2.2, 3, Math.sin(a) * 2.2);
    fin.rotation.y = -a;
    ship.add(fin);
  }
  const plume = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture(48), color: new THREE.Color(1.4, 1.1, 0.7),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  plume.scale.setScalar(10);
  ship.add(hull, nose, plume);
  const pad0 = pads[0] ?? { x: site.x, z: site.z, h: s.heightAt(site.x, site.z) };
  ship.position.set(pad0.x, pad0.h, pad0.z);
  group.add(ship);

  let cyc = r.float(10, 30), alt = 0, launching = false;
  return (dt, sunY) => {
    const night = 1 - Math.min(Math.max((sunY + 0.12) * 3.5, 0), 1);
    for (const p of pads) p.ring.material.opacity = 0.35 + 0.4 * night;
    cyc -= dt;
    if (cyc <= 0 && !launching) { launching = true; alt = 0; }
    if (launching) {
      alt += dt * (8 + alt * 0.35);        // accelerating climb
      ship.position.y = pad0.h + alt;
      plume.position.y = 2 - alt * 0.02;
      plume.material.opacity = Math.min(alt * 0.1, 1);
      plume.scale.setScalar(10 + Math.sin(performance.now() * 0.02) * 2);
      if (alt > 1400) { launching = false; ship.position.y = pad0.h; plume.material.opacity = 0; cyc = 22 + Math.random() * 26; }
    }
  };
}
