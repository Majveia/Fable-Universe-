// The air is alive too.
//
// Over the meadows a flock wheels — a loose boid swarm circling a slowly
// drifting attractor, each bird a little wing-beating chevron banking into
// the turn. And when the sun goes down, the low ground breathes light:
// fireflies (or drifting spores) rise out of the grass and hang glowing in
// the dark, thickest near the water. Both are cheap, both are instanced,
// both make a still evening feel occupied.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { isBiosphere } from './life.js';
import { softDotTexture } from './nebula.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

const BIRD_VERT = /* glsl */`
  attribute vec3 aPos;      // world position of the bird
  attribute float aPhase;   // wing-beat phase
  attribute float aBank;    // banking roll
  attribute float aHead;    // heading (radians)
  uniform float uTime;
  varying float vShade;
  void main() {
    // position.x = ±1 wingtip or 0 body; position.z = fore/aft
    float wing = position.x;
    float beat = sin(uTime * 9.0 + aPhase) * 0.55;
    // a chevron: wingtips rise and fall, tips swept back
    vec3 local = vec3(wing * 1.7, abs(wing) * beat + position.y, position.z - abs(wing) * 0.8);
    // roll about the heading axis for the bank
    float cb = cos(aBank), sb = sin(aBank);
    local = vec3(local.x * cb - local.y * sb, local.x * sb + local.y * cb, local.z);
    // yaw into the heading
    float ch = cos(aHead), sh = sin(aHead);
    vec3 world = aPos + vec3(local.x * ch - local.z * sh, local.y, local.x * sh + local.z * ch);
    vShade = 0.5 + 0.5 * abs(wing);
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;

const BIRD_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor;
  uniform float uDay;
  varying float vShade;
  void main() {
    gl_FragColor = vec4(uColor * (0.35 + vShade * 0.65) * (0.4 + 0.6 * uDay), 1.0);
  }
`;

function makeFlock(s) {
  const r = new RNG(hash(s.pp.seed, 0xb15d5));
  const N = COARSE ? 22 : 40;
  // one chevron: two wing triangles sharing a body vertex
  const verts = [
    0, 0, 0.6, -1, 0, -0.4, 0, 0.02, 0,
    0, 0, 0.6, 0, 0.02, 0, 1, 0, -0.4,
  ];
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.instanceCount = N;
  const aPos = new Float32Array(N * 3);
  const aPhase = new Float32Array(N);
  const aBank = new Float32Array(N);
  const aHead = new Float32Array(N);
  geo.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
  geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
  geo.setAttribute('aBank', new THREE.InstancedBufferAttribute(aBank, 1));
  geo.setAttribute('aHead', new THREE.InstancedBufferAttribute(aHead, 1));

  const birdCol = new THREE.Color().setHSL(r.float(0, 1), 0.3, 0.28).lerp(new THREE.Color(0.1, 0.1, 0.12), 0.5);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: s.uTime, uColor: { value: birdCol }, uDay: { value: 1 } },
    vertexShader: BIRD_VERT, fragmentShader: BIRD_FRAG, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  s.scene.add(mesh);

  // boid state: each bird chases the flock center + a moving attractor
  const pos = [], vel = [];
  const center = new THREE.Vector3(s.spawn.x, 0, s.spawn.z);
  for (let i = 0; i < N; i++) {
    pos.push(new THREE.Vector3(
      center.x + r.float(-60, 60), 0, center.z + r.float(-60, 60)));
    vel.push(new THREE.Vector3(r.float(-1, 1), 0, r.float(-1, 1)).normalize().multiplyScalar(12));
  }
  const attractor = center.clone();
  let attT = 0, prevHead = new Float32Array(N);
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();

  return {
    mat,
    update(dt, sunY) {
      mat.uniforms.uDay.value = Math.min(Math.max((sunY + 0.1) * 3, 0), 1);
      attT += dt;
      // the flock drifts a slow circle around wherever you are
      attractor.set(
        s.body.x + Math.cos(attT * 0.13) * 130,
        0,
        s.body.z + Math.sin(attT * 0.13) * 130);
      const cx = pos.reduce((a, p) => a + p.x, 0) / pos.length;
      const cz = pos.reduce((a, p) => a + p.z, 0) / pos.length;
      for (let i = 0; i < pos.length; i++) {
        const p = pos[i], v = vel[i];
        // cohesion to center, seek the attractor, gentle separation
        tmp.set(cx - p.x, 0, cz - p.z).multiplyScalar(0.0018);
        tmp2.set(attractor.x - p.x, 0, attractor.z - p.z).multiplyScalar(0.004);
        v.add(tmp).add(tmp2);
        for (let j = 0; j < pos.length; j++) {
          if (j === i) continue;
          const dx = p.x - pos[j].x, dz = p.z - pos[j].z;
          const d2 = dx * dx + dz * dz;
          if (d2 < 90 && d2 > 0.01) { const f = 0.9 / d2; v.x += dx * f; v.z += dz * f; }
        }
        const sp = Math.hypot(v.x, v.z) || 1;
        const desired = 16;
        v.x *= desired / sp; v.z *= desired / sp;
        p.addScaledVector(v, dt);
        // ride at a comfortable height above whatever ground is below
        const g = Math.max(s.heightAt(p.x, p.z), s.seaLevel === null ? -1e9 : s.seaLevel);
        p.y = g + 42 + Math.sin(attT * 0.7 + i) * 6;
        aPos[i * 3] = p.x; aPos[i * 3 + 1] = p.y; aPos[i * 3 + 2] = p.z;
        aPhase[i] = i * 0.7;
        const head = Math.atan2(v.x, v.z);
        // bank proportional to how fast the heading is turning
        let dh = head - prevHead[i];
        dh = ((dh + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        aBank[i] = Math.max(-0.7, Math.min(0.7, dh * 8));
        aHead[i] = head;
        prevHead[i] = head;
      }
      geo.attributes.aPos.needsUpdate = true;
      geo.attributes.aBank.needsUpdate = true;
      geo.attributes.aHead.needsUpdate = true;
    },
  };
}

function makeFireflies(s) {
  const r = new RNG(hash(s.pp.seed, 0xf17e5));
  const N = COARSE ? 60 : 120;
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const home = [];
  const phase = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    // scatter homes across the near field, biased toward low/wet ground
    let x = s.spawn.x + r.gauss() * 90, z = s.spawn.z + r.gauss() * 90;
    home.push({ x, z, r: r.float(1, 4), w: r.float(0.4, 1.1), a: r.float(0, 6.28) });
    phase[i] = r.float(0, 6.28);
    pos[i * 3] = x; pos[i * 3 + 2] = z;
    pos[i * 3 + 1] = s.heightAt(x, z) + r.float(0.5, 3);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const warm = new THREE.Color().setHSL(r.float(0.1, 0.42), 0.9, 0.6);
  const flies = new THREE.Points(geo, new THREE.PointsMaterial({
    map: softDotTexture(24), color: warm, size: 1.1,
    transparent: true, opacity: 0, depthWrite: false,
    blending: THREE.AdditiveBlending, sizeAttenuation: true,
  }));
  flies.frustumCulled = false;
  s.scene.add(flies);
  let t = 0;
  return {
    update(dt, sunY) {
      t += dt;
      const night = 1 - Math.min(Math.max((sunY + 0.05) * 4, 0), 1);
      flies.material.opacity = night;
      if (night < 0.02) return;
      for (let i = 0; i < N; i++) {
        const hm = home[i];
        // keep the swarm near you as you wander, but let each one wander too
        if (Math.hypot(hm.x - s.body.x, hm.z - s.body.z) > 150) {
          hm.x = s.body.x + r.gauss() * 70; hm.z = s.body.z + r.gauss() * 70;
        }
        const a = hm.a + t * hm.w;
        const x = hm.x + Math.cos(a) * hm.r;
        const z = hm.z + Math.sin(a * 1.3) * hm.r;
        pos[i * 3] = x;
        pos[i * 3 + 1] = s.heightAt(x, z) + 1.2 + Math.sin(t * 0.7 + phase[i]) * 0.8;
        pos[i * 3 + 2] = z;
      }
      geo.attributes.position.needsUpdate = true;
      // twinkle: modulate size a touch over time via material (cheap global)
      flies.material.size = 1.0 + 0.4 * Math.sin(t * 3.0);
    },
  };
}

export function addWildlife(s) {
  if (!isBiosphere(s.pp)) return null;
  const flock = makeFlock(s);
  const fireflies = makeFireflies(s);
  return {
    update(dt, sunY) {
      flock.update(dt, sunY);
      fireflies.update(dt, sunY);
    },
  };
}
