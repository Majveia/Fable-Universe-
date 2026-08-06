// Water finds the sea.
//
// From a spring high on the new landforms a river runs downhill — following
// the steepest descent of the very height field you walk — gathering into a
// silver thread that widens as it falls, cascading over the cliffs in
// WATERFALLS that throw spray and mist, until it reaches the coast. On worlds
// with no sea it pools in the lowest basin. The grandeur of moving water,
// threaded through the bones of the world.

import * as THREE from 'three';
import { RNG, arand, hash } from './rng.js';
import { NOISE_GLSL } from './planet.js';
import { softDotTexture } from './nebula.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const EXT = 1400;

const RIVER_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir, uSunColor, uHorizon, uDeep, uCam;
  uniform float uTime;
  varying vec3 vW;
  varying vec2 vUv;
  ${NOISE_GLSL}
  void main() {
    // ripples scroll downstream along v, with cross-current chop
    float flow = uTime * 0.6;
    vec3 n = normalize(vec3(
      snoise(vec3(vUv * vec2(9.0, 26.0) + vec2(0.0, -flow), 0.0)) * 0.35 +
      snoise(vec3(vUv * vec2(21.0, 60.0) + vec2(0.0, -flow*2.1), 3.0)) * 0.18,
      1.0,
      snoise(vec3(vUv * vec2(9.0, 26.0) + vec2(5.0, -flow), 1.0)) * 0.3));
    vec3 view = normalize(uCam - vW);
    float fres = pow(1.0 - max(dot(view, n), 0.0), 3.0);
    float day = smoothstep(-0.15, 0.25, uSunDir.y);
    vec3 col = mix(uDeep * (0.3 + 0.7*day), uHorizon * day, fres*0.8);
    float spec = pow(max(dot(reflect(-uSunDir, n), view), 0.0), 200.0);
    col += uSunColor * spec * 2.4 * day;
    // foam where the current tears (edges of v and fast noise)
    float foam = smoothstep(0.75, 1.0, snoise(vec3(vUv*vec2(14.0,40.0) - vec2(0.0,flow*1.6), 7.0))*0.5+0.5);
    col += vec3(0.9,0.95,1.0) * foam * 0.25 * (0.3+0.7*day);
    float dist = length(vW - uCam);
    col = mix(col, uHorizon*max(day,0.08), 1.0-exp(-dist*0.0007));
    gl_FragColor = vec4(col, 0.86);
  }
`;

export function addRivers(s) {
  const pp = s.pp;
  if (pp.typeId === 4 || s.atmo < 0.3) return null;   // no rivers on molten/airless
  const rr = new RNG(hash(pp.seed, 0x21e5));

  const ground = (x, z) => s.heightAt(x, z);
  const seaY = s.seaLevel;

  // ---- trace the river: steepest descent from a high dry spring ----
  const paths = [];
  const springs = COARSE ? 1 : (rr.chance(0.5) ? 2 : 1);
  for (let sp = 0; sp < springs; sp++) {
    // find the highest dry ground around — the river's spring
    let start = null, bh = -1e9;
    for (let i = 0; i < 500; i++) {
      const th = rr.float(0, 6.28), rad = rr.float(200, EXT * 0.7);
      const x = s.spawn.x + Math.cos(th) * rad, z = s.spawn.z + Math.sin(th) * rad;
      const h = ground(x, z);
      if (h > bh) { bh = h; start = { x, z }; }
    }
    // needs a real height to fall from; otherwise this world has no rivers
    if (!start || (seaY !== null && bh < seaY + 12)) continue;
    // smoothed height for path-finding, so micro-bumps don't trap the flow
    const step = 22;
    const gsm = (x, z) => (ground(x, z) + ground(x + step, z) + ground(x - step, z)
      + ground(x, z + step) + ground(x, z - step)) * 0.2;
    const path = [{ x: start.x, z: start.z, h: bh }];
    let x = start.x, z = start.z, dirx = 0, dirz = 0, stuck = 0;
    for (let i = 0; i < 450; i++) {
      const h = gsm(x, z);
      if (seaY !== null && ground(x, z) <= seaY + 0.5) break;   // reached the sea
      // steepest descent, lightly biased to keep flowing, and willing to
      // climb a small lip to spill out of a basin (fill-and-spill)
      let best = null, bestScore = -1e9;
      for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2, cx = Math.cos(a), cz = Math.sin(a);
        const nh = gsm(x + cx * step, z + cz * step);
        const score = (h - nh) + (cx * dirx + cz * dirz) * step * 0.05;
        if (score > bestScore) { bestScore = score; best = { cx, cz, nh, drop: h - nh }; }
      }
      if (best.drop < -step * 0.6) { if (++stuck > 5) break; } else stuck = 0;  // a true ridge
      dirx = best.cx; dirz = best.cz;
      x += best.cx * step; z += best.cz * step;
      path.push({ x, z, h: ground(x, z) });
      if (Math.abs(x - s.spawn.x) > EXT * 1.2 || Math.abs(z - s.spawn.z) > EXT * 1.2) break;
    }
    if (path.length > 5) paths.push(path);
  }
  if (!paths.length) return null;

  const group = new THREE.Group();
  s.scene.add(group);
  const uni = {
    uSunDir: s.uSunDir, uSunColor: s.uSunColor,
    uHorizon: { value: s.horizonColor }, uCam: s.uCam, uTime: s.uTime,
    uDeep: { value: new THREE.Color(0.05, 0.16, 0.24) },
  };
  const waterMat = new THREE.ShaderMaterial({
    uniforms: uni, vertexShader: RIVER_VERT, fragmentShader: RIVER_FRAG,
    transparent: true, side: THREE.DoubleSide,
  });

  const falls = [];   // {x,y0,y1,z,mesh,spray}
  for (const path of paths) {
    // build a ribbon that widens downstream, sunk a touch into its bed
    const verts = [], uvs = [], idx = [];
    const N = path.length;
    for (let i = 0; i < N; i++) {
      const p = path[i];
      const pv = path[Math.max(i - 1, 0)], nx2 = path[Math.min(i + 1, N - 1)];
      const dx = nx2.x - pv.x, dz = nx2.z - pv.z, L = Math.hypot(dx, dz) || 1;
      const px = -dz / L, pz = dx / L;              // across-flow
      const width = 4 + (i / N) * 16;               // widens toward the mouth
      const y = p.h - 0.4;
      verts.push(p.x + px * width, y, p.z + pz * width);
      verts.push(p.x - px * width, y, p.z - pz * width);
      uvs.push(0, i / N); uvs.push(1, i / N);
      // detect a waterfall: a steep drop between this point and the next
      if (i < N - 1) {
        const drop = p.h - path[i + 1].h;
        const run = Math.hypot(path[i + 1].x - p.x, path[i + 1].z - p.z) || 1;
        if (drop > 12 && drop / run > 0.7) {
          falls.push({ x: (p.x + path[i + 1].x) / 2, z: (p.z + path[i + 1].z) / 2,
            top: p.h, bot: path[i + 1].h, w: width, px, pz });
        }
      }
    }
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const ribbon = new THREE.Mesh(geo, waterMat);
    ribbon.renderOrder = 1;
    group.add(ribbon);
  }

  // ---- waterfalls: a falling sheet + spray at the base ----
  const sprayGeo = new THREE.BufferGeometry();
  const sprayList = [];
  for (const f of falls.slice(0, COARSE ? 3 : 8)) {
    const h = f.top - f.bot;
    const sheet = new THREE.Mesh(new THREE.PlaneGeometry(f.w * 2, h, 1, 1), waterMat);
    sheet.position.set(f.x, (f.top + f.bot) / 2, f.z);
    sheet.lookAt(f.x + f.px, (f.top + f.bot) / 2, f.z + f.pz);
    group.add(sheet);
    // spray + mist at the plunge pool
    for (let i = 0; i < (COARSE ? 10 : 22); i++)
      sprayList.push({ x: f.x, y: f.bot, z: f.z, w: f.w, vy: arand() * 6, life: arand() * 1.5 });
  }
  const sPos = new Float32Array(Math.max(sprayList.length, 1) * 3);
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  const spray = new THREE.Points(sprayGeo, new THREE.PointsMaterial({
    map: softDotTexture(32), color: 0xdfe8ee, size: 3.5, transparent: true,
    opacity: 0.5, depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true,
  }));
  spray.frustumCulled = false;
  group.add(spray);

  return {
    paths, falls,   // exposed for framing/verification
    update(dt) {
      for (let i = 0; i < sprayList.length; i++) {
        const p = sprayList[i];
        p.life -= dt;
        if (p.life <= 0) { p.life = 0.6 + arand() * 1.4; p.vy = 2 + arand() * 6; }
        p.vy -= dt * 6;
        sPos[i * 3] = p.x + (arand() - 0.5) * p.w * 2;
        sPos[i * 3 + 1] = p.y + Math.max(p.vy, 0) * 2 + arand() * 4;
        sPos[i * 3 + 2] = p.z + (arand() - 0.5) * p.w * 2;
      }
      if (sprayList.length) sprayGeo.attributes.position.needsUpdate = true;
    },
  };
}

const RIVER_VERT = /* glsl */`
  varying vec3 vW;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }
`;
