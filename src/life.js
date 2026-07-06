// Life, where the numbers allow it.
//
// Worlds that are terrestrial or ocean-class with equilibrium temperatures
// in the liquid-water band grow a biosphere: wind-brushed tufts and stands
// of alien trees in a palette seeded by the world itself, flocks of
// skimmers riding boid rules overhead, and — after dark on inhabited
// worlds — slow constellations of bioluminescent spores.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture } from './nebula.js';

function bladeTexture(rng) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 128;
  const g = cv.getContext('2d');
  g.strokeStyle = 'rgba(255,255,255,0.9)';
  for (let i = 0; i < 11; i++) {
    const x = 12 + rng.next() * 104;
    const lean = (rng.next() - 0.5) * 38;
    const h = 50 + rng.next() * 70;
    g.lineWidth = 1.5 + rng.next() * 2.5;
    g.beginPath();
    g.moveTo(x, 128);
    g.quadraticCurveTo(x + lean * 0.4, 128 - h * 0.6, x + lean, 128 - h);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

export function isBiosphere(pp) {
  return (pp.type === 'terrestrial' || pp.type === 'ocean') && pp.Teq >= 235 && pp.Teq <= 330;
}

export function addLife(s) {
  const pp = s.pp;
  if (!isBiosphere(pp)) return null;
  const r = new RNG(hash(pp.seed, 0x11fe));
  const EXT = 1400;

  const vegColor = new THREE.Color().setHSL(r.float(0.06, 0.62), r.float(0.4, 0.65), r.float(0.22, 0.34));
  const canopyColor = vegColor.clone().offsetHSL(r.float(-0.05, 0.05), 0, r.float(-0.04, 0.08));

  const dryland = (x, z) => {
    const h = s.heightAt(x, z);
    if (s.seaLevel !== null && h < s.seaLevel + 1.5) return null;
    if (h > s.amp * 0.55) return null; // no meadows on the peaks
    return h;
  };

  // ---------------------------------------------------------- tufts ----
  const tuftGeo = (() => {
    const g1 = new THREE.PlaneGeometry(2.6, 2.2);
    const g2 = g1.clone().rotateY(Math.PI / 2);
    const pos = new Float32Array(g1.attributes.position.count * 3 * 2);
    const uv = new Float32Array(g1.attributes.uv.count * 2 * 2);
    pos.set(g1.attributes.position.array, 0);
    pos.set(g2.attributes.position.array, g1.attributes.position.count * 3);
    uv.set(g1.attributes.uv.array, 0);
    uv.set(g2.attributes.uv.array, g1.attributes.uv.count * 2);
    const idx = [];
    for (const [base, g] of [[0, g1], [g1.attributes.position.count, g2]]) {
      for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + base);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    g1.dispose(); g2.dispose();
    return geo;
  })();
  const tuftMat = new THREE.MeshBasicMaterial({
    map: bladeTexture(r), transparent: true, alphaTest: 0.3,
    color: vegColor.clone(), side: THREE.DoubleSide, depthWrite: true,
  });
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, 650);
  const d = new THREE.Object3D();
  let placed = 0;
  for (let i = 0; i < 2200 && placed < 650; i++) {
    const x = r.float(-EXT / 2, EXT / 2), z = r.float(-EXT / 2, EXT / 2);
    const h = dryland(x, z);
    if (h === null) continue;
    d.position.set(x, h + 0.9, z);
    d.rotation.y = r.float(0, Math.PI * 2);
    d.scale.setScalar(r.float(0.6, 2.1));
    d.updateMatrix();
    tufts.setMatrixAt(placed++, d.matrix);
  }
  tufts.count = placed;
  s.scene.add(tufts);

  // ---------------------------------------------------------- trees ----
  const trunkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.07, 0.3, 0.22), roughness: 1 });
  const canopyMat = new THREE.MeshStandardMaterial({ color: canopyColor, roughness: 0.9, flatShading: true });
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.3, 1, 5), trunkMat, 130);
  const canopies = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), canopyMat, 130);
  let t = 0;
  for (let i = 0; i < 1400 && t < 130; i++) {
    const x = r.float(-EXT / 2, EXT / 2), z = r.float(-EXT / 2, EXT / 2);
    const h = dryland(x, z);
    if (h === null) continue;
    const height = r.float(5, 13);
    d.position.set(x, h + height / 2, z);
    d.rotation.set(0, r.float(0, 6.28), r.float(-0.06, 0.06));
    d.scale.set(1, height, 1);
    d.updateMatrix();
    trunks.setMatrixAt(t, d.matrix);
    d.position.y = h + height * r.float(0.85, 1.05);
    const cw = r.float(2.2, 4.6);
    d.scale.set(cw, cw * r.float(0.5, 1.2), cw);
    d.updateMatrix();
    canopies.setMatrixAt(t, d.matrix);
    t++;
  }
  trunks.count = t; canopies.count = t;
  s.scene.add(trunks); s.scene.add(canopies);

  // -------------------------------------------------------- skimmers ----
  // real bodies now: a fuselage and two wings that beat in the vertex
  // shader, banking into their turns
  const NB = 30;
  const skimGeo = (() => {
    const verts = [
      // fuselage diamond (double-sided via DoubleSide)
      0, 0, -1.5, -0.24, 0, 0.15, 0.24, 0, 0.15,
      -0.24, 0, 0.15, 0, 0, 1.15, 0.24, 0, 0.15,
      // left wing
      -0.2, 0, -0.25, -1.75, 0.02, 0.5, -0.25, 0, 0.55,
      // right wing
      0.2, 0, -0.25, 0.25, 0, 0.55, 1.75, 0.02, 0.5,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
    return geo;
  })();
  const phases = new Float32Array(NB);
  for (let i = 0; i < NB; i++) phases[i] = r.float(0, 6.28);
  skimGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
  const skimMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0x16181d) } },
    vertexShader: /* glsl */`
      attribute float aPhase;
      uniform float uTime;
      varying float vShade;
      void main() {
        vec3 p = position;
        float wing = smoothstep(0.18, 0.5, abs(p.x));
        float flap = sin(uTime * (6.5 + fract(aPhase) * 2.5) + aPhase * 17.0);
        p.y += abs(p.x) * flap * 0.55 * wing;
        vShade = 0.75 + 0.25 * flap * wing;
        #ifdef USE_INSTANCING
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
        #else
          vec4 w = modelMatrix * vec4(p, 1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uColor;
      varying float vShade;
      void main() { gl_FragColor = vec4(uColor * vShade, 1.0); }`,
    side: THREE.DoubleSide,
  });
  const boids = new THREE.InstancedMesh(skimGeo, skimMat, NB);
  const bp = [], bv = [];
  const center = new THREE.Vector3(r.float(-200, 200), 60, r.float(-200, 200));
  for (let i = 0; i < NB; i++) {
    bp.push(center.clone().add(new THREE.Vector3(r.gauss() * 40, r.gauss() * 12, r.gauss() * 40)));
    bv.push(new THREE.Vector3(r.gauss(), 0, r.gauss()).normalize().multiplyScalar(12));
  }
  s.scene.add(boids);
  const wander = { t: 0 };

  // -------------------------------------------------------- striders ----
  // tall two-legged grazers, legs swinging in true antiphase
  let striders = null, strState = null;
  const strMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: canopyColor.clone().multiplyScalar(0.45) } },
    vertexShader: /* glsl */`
      attribute float aLimb;   // 0 body · +1 right leg · −1 left leg
      attribute float aPhase;
      uniform float uTime;
      varying float vShade;
      void main() {
        vec3 p = position;
        float gait = uTime * 3.1 + aPhase;
        if (abs(aLimb) > 0.5) {
          float sw = sin(gait + (aLimb > 0.0 ? 0.0 : 3.14159)) * 0.42;
          float hip = 2.3;
          vec2 rel = vec2(p.z, p.y - hip);
          p.z = rel.x * cos(sw) - rel.y * sin(sw);
          p.y = hip + rel.x * sin(sw) + rel.y * cos(sw);
        } else {
          p.y += 0.07 * sin(gait * 2.0); // the walk's bob
        }
        vShade = 0.65 + 0.35 * smoothstep(0.0, 3.4, p.y);
        #ifdef USE_INSTANCING
          vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
        #else
          vec4 w = modelMatrix * vec4(p, 1.0);
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uColor;
      varying float vShade;
      void main() { gl_FragColor = vec4(uColor * vShade, 1.0); }`,
    side: THREE.DoubleSide,
  });
  if (r.chance(0.7)) {
    const parts = [];
    const box = (w, h, dpt, cx, cy, cz, limb) => {
      const g = new THREE.BoxGeometry(w, h, dpt);
      g.translate(cx, cy, cz);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) parts.push([pos.getX(i), pos.getY(i), pos.getZ(i), limb]);
      for (const ii of g.index.array) partsIdx.push(ii + baseOffset);
      baseOffset += pos.count;
      g.dispose();
    };
    let partsIdx = [], baseOffset = 0;
    box(0.7, 0.55, 1.5, 0, 2.5, 0, 0);        // torso
    box(0.16, 1.1, 0.16, 0, 3.3, -0.75, 0);   // neck
    box(0.3, 0.22, 0.55, 0, 3.9, -0.95, 0);   // head
    box(0.13, 2.35, 0.2, 0.24, 1.18, 0, 1);   // right leg
    box(0.13, 2.35, 0.2, -0.24, 1.18, 0, -1); // left leg
    const NS = 5;
    const pArr = new Float32Array(parts.length * 3);
    const lArr = new Float32Array(parts.length);
    parts.forEach((v, i) => { pArr[i * 3] = v[0]; pArr[i * 3 + 1] = v[1]; pArr[i * 3 + 2] = v[2]; lArr[i] = v[3]; });
    const sgeo = new THREE.BufferGeometry();
    sgeo.setAttribute('position', new THREE.BufferAttribute(pArr, 3));
    sgeo.setAttribute('aLimb', new THREE.BufferAttribute(lArr, 1));
    sgeo.setIndex(partsIdx);
    const sph = new Float32Array(NS);
    for (let i = 0; i < NS; i++) sph[i] = r.float(0, 6.28);
    sgeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(sph, 1));
    striders = new THREE.InstancedMesh(sgeo, strMat, NS);
    strState = [];
    for (let i = 0; i < NS; i++) {
      let x = 0, z = 0, h = null;
      for (let tr = 0; tr < 60; tr++) {
        x = r.float(-450, 450); z = r.float(-450, 450);
        h = dryland(x, z);
        if (h !== null) break;
      }
      strState.push({ x, z, heading: r.float(0, 6.28), speed: r.float(0.8, 1.6), scale: r.float(0.9, 1.8) });
    }
    s.scene.add(striders);
  }

  // -------------------------------------------------- night spores ------
  let spores = null;
  if (pp.inhabited) {
    const tex = softDotTexture(32);
    spores = [];
    for (let i = 0; i < 46; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: new THREE.Color().setHSL(r.float(0.3, 0.55), 0.8, 0.6),
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0,
      }));
      const x = r.float(-500, 500), z = r.float(-500, 500);
      sp.position.set(x, (dryland(x, z) ?? 0) + r.float(2, 14), z);
      sp.scale.setScalar(r.float(0.5, 1.6));
      sp.userData.ph = r.float(0, 6.28);
      s.scene.add(sp);
      spores.push(sp);
    }
  }

  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  const acc = new THREE.Vector3(), diff = new THREE.Vector3();
  let time = 0;

  return {
    update(dt, sunY) {
      time += dt;
      const day = Math.min(Math.max((sunY + 0.1) * 3, 0), 1);
      tuftMat.color.copy(vegColor).multiplyScalar(0.15 + 0.85 * day);

      // boids
      const cdt = Math.min(dt, 0.08);
      wander.t += dt;
      center.x += Math.sin(wander.t * 0.11) * 9 * cdt;
      center.z += Math.cos(wander.t * 0.07) * 9 * cdt;
      for (let i = 0; i < NB; i++) {
        acc.set(0, 0, 0);
        let n = 0;
        for (let j = 0; j < NB; j++) {
          if (i === j) continue;
          diff.subVectors(bp[j], bp[i]);
          const dd = diff.lengthSq();
          if (dd < 900) { // near flock
            acc.addScaledVector(bv[j], 0.03);                 // align
            acc.addScaledVector(diff, 0.012);                 // cohere
            if (dd < 36) acc.addScaledVector(diff, -0.5);     // separate
            n++;
          }
        }
        diff.subVectors(center, bp[i]);
        acc.addScaledVector(diff, 0.02);
        const ground = s.heightAt(bp[i].x, bp[i].z) + 18;
        if (bp[i].y < ground) acc.y += (ground - bp[i].y) * 0.6;
        if (bp[i].y > ground + 70) acc.y -= (bp[i].y - ground - 70) * 0.2;
        bv[i].addScaledVector(acc, cdt * 8);
        const sp = bv[i].length();
        if (sp > 22) bv[i].multiplyScalar(22 / sp);
        if (sp < 7) bv[i].multiplyScalar(7 / Math.max(sp, 0.01));
        bp[i].addScaledVector(bv[i], cdt);
        // face the flight direction, bank into the turn; wings flap in-shader
        d.position.copy(bp[i]);
        d.lookAt(diff.copy(bp[i]).add(bv[i]));
        const right = diff.copy(bv[i]).cross(up).normalize();
        const bank = Math.min(Math.max(-acc.dot(right) * 0.05, -0.65), 0.65);
        d.rotateZ(bank);
        d.scale.setScalar(1.1);
        d.updateMatrix();
        boids.setMatrixAt(i, d.matrix);
      }
      boids.instanceMatrix.needsUpdate = true;
      skimMat.uniforms.uTime.value = time;

      if (striders) {
        strMat.uniforms.uTime.value = time;
        for (let i = 0; i < strState.length; i++) {
          const st = strState[i];
          st.heading += (Math.random() - 0.5) * dt * 0.6;
          // steer home if straying, turn from water and steep ground
          const dHome = Math.hypot(st.x, st.z);
          if (dHome > 520) st.heading = Math.atan2(-st.z, -st.x) + (Math.random() - 0.5);
          const nx = st.x + Math.cos(st.heading) * st.speed * dt * 4;
          const nz = st.z + Math.sin(st.heading) * st.speed * dt * 4;
          const nh = s.heightAt(nx, nz);
          if (s.seaLevel !== null && nh < s.seaLevel + 1.2) {
            st.heading += 1.7;
          } else {
            st.x = nx; st.z = nz;
          }
          d.position.set(st.x, s.heightAt(st.x, st.z), st.z);
          d.rotation.set(0, -st.heading - Math.PI / 2, 0);
          d.scale.setScalar(st.scale);
          d.updateMatrix();
          striders.setMatrixAt(i, d.matrix);
        }
        striders.instanceMatrix.needsUpdate = true;
      }

      if (spores) {
        const night = 1 - day;
        for (const sp of spores) {
          sp.material.opacity = night * (0.35 + 0.3 * Math.sin(time * 0.7 + sp.userData.ph));
          sp.position.y += Math.sin(time * 0.4 + sp.userData.ph) * dt * 0.6;
          sp.position.x += Math.cos(time * 0.23 + sp.userData.ph) * dt * 1.1;
        }
      }
    },
  };
}
