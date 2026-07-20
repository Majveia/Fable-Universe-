// The wild lands remember.
//
// Scattered across the country, away from the town, stand monuments older
// than anyone living: rings of leaning stones, a fallen arch, a watchstone
// whose glyphs still catch a light at night. Come near one and the land
// offers up its name and a fragment of a story nobody finished — a caption
// that breathes in, then lets you go. Deterministic per world: the same
// stones wait in the same fields every time you return.

import * as THREE from 'three';
import { hash, RNG, ruinName, ruinLore } from './rng.js';
import { softDotTexture } from './nebula.js';

const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
const EXT = 1400;

export function addRuins(s) {
  const pp = s.pp;
  // airless and molten worlds keep their monuments too — ruin is universal —
  // but skip the truly hostile gas/ice cases handled elsewhere
  if (pp.typeId > 4) return null;
  const r = new RNG(hash(pp.seed, 0x2b1c5));

  const dry = (x, z, m = 3) =>
    (s.seaLevel === null || s.heightAt(x, z) > s.seaLevel + m) && s.heightAt(x, z) < s.amp * 0.5;

  // find a few clearings in the wilds, well away from town and each other
  const sites = [];
  const want = COARSE ? 2 : (r.chance(0.5) ? 4 : 3);
  for (let i = 0; i < 400 && sites.length < want; i++) {
    const th = i * 2.399963, rad = 180 + (i / 400) * EXT * 1.0;
    const x = s.spawn.x + Math.cos(th) * rad, z = s.spawn.z + Math.sin(th) * rad;
    if (!dry(x, z, 4)) continue;
    if (s.settlement && Math.hypot(x - s.settlement.site.x, z - s.settlement.site.z) < 260) continue;
    if (sites.some(o => Math.hypot(o.x - x, o.z - z) < 320)) continue;
    sites.push({ x, z, h: s.heightAt(x, z) });
  }
  if (!sites.length) return null;

  // weathered stone: the world's rock, gone grey and lichen-flecked
  const stoneCol = pp.colB.clone().lerp(new THREE.Color(0.4, 0.42, 0.4), 0.6);
  const stoneMat = new THREE.MeshStandardMaterial({ color: stoneCol, roughness: 0.96, metalness: 0.02, flatShading: true });
  const mossMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.24, 0.32, 0.2), roughness: 1, flatShading: true });
  const glyphTex = softDotTexture(32);

  const group = new THREE.Group();
  s.scene.add(group);
  const monuments = [];
  const glowSprites = [];
  const d = new THREE.Object3D();

  const kinds = ['ring', 'arch', 'watchstone', 'throne'];
  sites.forEach((site, si) => {
    const rr = new RNG(hash(pp.seed, si, 0x9a11));
    const kind = rr.pick(kinds);
    const name = ruinName(pp.seed, si);
    const lore = ruinLore(pp.seed, si);
    const gh = site.h;
    let radius = 40;

    if (kind === 'ring') {
      // a ring of menhirs, some upright, some leaning, a couple toppled
      const n = rr.int(7, 12);
      const ringR = rr.float(9, 16);
      radius = ringR + 40;
      const stones = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stoneMat, n);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rr.float(-0.1, 0.1);
        const x = site.x + Math.cos(a) * ringR, z = site.z + Math.sin(a) * ringR;
        const h = s.heightAt(x, z);
        const toppled = rr.chance(0.18);
        const tall = rr.float(4, 8);
        const w = rr.float(1.4, 2.6), th = rr.float(0.7, 1.3);
        if (toppled) {
          d.position.set(x, h + th / 2, z);
          d.rotation.set(Math.PI / 2 * rr.float(0.7, 1), a + rr.float(-0.4, 0.4), 0);
          d.scale.set(w, tall, th);
        } else {
          d.position.set(x, h + tall / 2 - 0.4, z);
          d.rotation.set(rr.float(-0.12, 0.12), a, rr.float(-0.14, 0.14));
          d.scale.set(w, tall, th);
        }
        d.updateMatrix();
        stones.setMatrixAt(i, d.matrix);
      }
      group.add(stones);
      // a low altar-stone at the center
      const altar = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 1, 8), mossMat);
      altar.position.set(site.x, gh + 0.4, site.z);
      group.add(altar);

    } else if (kind === 'arch') {
      // two leaning pillars and a lintel that has half fallen
      const span = rr.float(6, 10);
      radius = span + 42;
      const ph = rr.float(7, 12), pw = rr.float(1.6, 2.4);
      for (const sgn of [-1, 1]) {
        const x = site.x + sgn * span / 2, z = site.z;
        const h = s.heightAt(x, z);
        const pil = new THREE.Mesh(new THREE.BoxGeometry(pw, ph, pw), stoneMat);
        pil.position.set(x, h + ph / 2, z);
        pil.rotation.z = sgn * rr.float(0.02, 0.08);
        group.add(pil);
      }
      // the lintel, tilted, one end slipped
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(span + pw, pw, pw * 1.1), stoneMat);
      lintel.position.set(site.x, gh + ph - pw * 0.4, site.z);
      lintel.rotation.z = rr.float(-0.12, -0.04);
      group.add(lintel);
      // a fallen block below
      const block = new THREE.Mesh(new THREE.BoxGeometry(pw, pw * 0.8, pw * 2), mossMat);
      block.position.set(site.x + rr.float(-4, 4), gh + pw * 0.4, site.z + rr.float(3, 6));
      block.rotation.set(rr.float(0, 1), rr.float(0, 6), rr.float(0, 1));
      group.add(block);

    } else if (kind === 'watchstone') {
      // a tall tapered monolith, glyph-cap catching a light after dark
      const ht = rr.float(11, 18);
      radius = 44;
      const obel = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 2.0, ht, 5), stoneMat);
      obel.position.set(site.x, gh + ht / 2, site.z);
      obel.rotation.y = rr.float(0, 6.28);
      obel.rotation.z = rr.float(-0.05, 0.05);
      group.add(obel);
      // a base ring of small stones
      const bn = rr.int(4, 7);
      const base = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), stoneMat, bn);
      for (let i = 0; i < bn; i++) {
        const a = (i / bn) * Math.PI * 2;
        const x = site.x + Math.cos(a) * 4, z = site.z + Math.sin(a) * 4;
        d.position.set(x, s.heightAt(x, z) + 0.6, z);
        d.rotation.set(0, a, rr.float(-0.2, 0.2));
        d.scale.set(1.2, rr.float(1.4, 2.4), 1.2);
        d.updateMatrix();
        base.setMatrixAt(i, d.matrix);
      }
      group.add(base);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glyphTex, color: new THREE.Color(0.5, 0.85, 1.1),
        transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      glow.position.set(site.x, gh + ht - 1, site.z);
      glow.scale.setScalar(5);
      group.add(glow);
      glowSprites.push(glow);

    } else {
      // a broken throne / seat on a stepped dais
      radius = 42;
      for (let step = 0; step < 3; step++) {
        const sz = 9 - step * 2.4;
        const slab = new THREE.Mesh(new THREE.BoxGeometry(sz, 0.7, sz), step === 2 ? mossMat : stoneMat);
        slab.position.set(site.x, gh + 0.35 + step * 0.7, site.z);
        slab.rotation.y = rr.float(-0.1, 0.1);
        group.add(slab);
      }
      const seat = new THREE.Mesh(new THREE.BoxGeometry(3, 4, 1.2), stoneMat);
      seat.position.set(site.x, gh + 2 + 1.6, site.z - 1.6);
      seat.rotation.x = rr.float(0.05, 0.16); // tipped back with age
      group.add(seat);
      for (const sgn of [-1, 1]) {
        const arm = new THREE.Mesh(new THREE.BoxGeometry(0.9, 2, 2.6), stoneMat);
        arm.position.set(site.x + sgn * 1.6, gh + 2 + 1, site.z - 1);
        group.add(arm);
      }
    }

    monuments.push({ x: site.x, z: site.z, name, lore, radius });
  });

  let near = null;
  return {
    monuments,
    update(dt, sunY) {
      const night = 1 - Math.min(Math.max((sunY + 0.12) * 3.5, 0), 1);
      for (const g of glowSprites) {
        g.material.opacity = night * (0.55 + 0.45 * Math.sin(performance.now() * 0.0011 + g.position.x));
      }
      // which monument, if any, are we standing within the memory of?
      let found = null, bestD = 1e9;
      for (const m of monuments) {
        const dd = Math.hypot(s.body.x - m.x, s.body.z - m.z);
        if (dd < m.radius && dd < bestD) { bestD = dd; found = m; }
      }
      if (found !== near) {
        near = found;
        s.app.hud.showDiscovery(found?.name ?? null, found?.lore ?? null);
      }
    },
    dispose() { s.app.hud.showDiscovery(null); },
  };
}
