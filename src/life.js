// Life, where the numbers allow it.
//
// Worlds that are terrestrial or ocean-class with equilibrium temperatures
// in the liquid-water band grow a biosphere: wind-brushed tufts and stands
// of alien trees in a palette seeded by the world itself, flocks of
// skimmers riding boid rules overhead, and — after dark on inhabited
// worlds — slow constellations of bioluminescent spores.

import * as THREE from 'three';
import { RNG, arand, hash } from './rng.js';
import { softDotTexture } from './nebula.js';
import { growTree, tipsOf } from './tree.js';
import {
  PETAL_GLSL, blossomsFor, petalFall, petalHue, seasonOpenness, seasonPhaseOf,
} from './blossom.js';
import { airDensity } from './precip.js';
import { gravityOf } from './avatar.js';
import { qInt } from './quality.js';

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

const PARAM = (k) => {
  try { return new URL(window.location.href).searchParams.get(k); }
  catch { return null; }
};

/**
 * Where this world is in its year — `blossom.js`'s law, with the URL attached.
 *
 * `?season=` overrides it, in the same spirit as `?sun=` and `?storm=`: a
 * visitor who wants the bloom should not have to hunt 10²⁸ worlds for it.
 */
export const seasonPhase = (pp) => seasonPhaseOf(pp?.M0, PARAM('season'));

export function addLife(s) {
  const pp = s.pp;
  if (!isBiosphere(pp)) return null;
  const r = new RNG(hash(pp.seed, 0x11fe));
  const EXT = 1400;
  // ecology: the host may carry a persistent regional population; without
  // one (moons, classic surface) the old defaults stand
  const eco = s.eco ?? null;
  // downtown the wild things keep to the parks; overgrown moods run riot
  const vegF = (eco?.veg ?? 1) * (s.urban ? 0.2 : 1) * (pp.res?.vegX ?? 1);

  const vegH = r.float(0.06, 0.62);
  const vegColor = new THREE.Color().setHSL(vegH, r.float(0.4, 0.65), r.float(0.22, 0.34));
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
  const nTufts = Math.max(80, Math.round(650 * vegF));
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, nTufts);
  const d = new THREE.Object3D();
  let placed = 0;
  for (let i = 0; i < 2200 && placed < nTufts; i++) {
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
  //
  // This was `CylinderGeometry(0.14, 0.3, 1, 5)` under `IcosahedronGeometry(1, 1)`
  // — a five-sided stick with a faceted ball — and on a phone it read as
  // exactly that. `src/tree.js` grows the wood instead, from the pipe model,
  // one allometry and beam curvature; see its header for the four laws and for
  // what AEON adds to them.
  //
  // One merged geometry per world rather than one mesh per tree. A grown tree
  // is 300–900 segments and there are up to 130 of them, so instancing the
  // *tree* is not available — but every segment is the same tapered ring, so
  // what gets instanced is the segment, once, across every tree on the world.
  // That is one draw call for the whole wood (§5's 900-call surface budget).
  const nTrees = Math.max(20, Math.round(130 * vegF));
  // §5's lever: the tier decides how much wood a tree may spend, and `tree.js`
  // spends it thickest-first so a low tier gets a smaller tree rather than a
  // half-drawn one.
  const budget = qInt('twig', 'shadowRes') > 1500 ? 520 : 240;
  const gwork = gravityOf(s.pp);
  // trunk + branch: one tapered unit ring, instanced per segment
  const segGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true);
  segGeo.translate(0, 0.5, 0);            // origin at the base, so a segment is a bone
  const barkMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.07, 0.3, 0.22), roughness: 1, flatShading: true,
  });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: canopyColor, roughness: 0.9, flatShading: true,
  });

  // Where the wood stands, and why it is not uniform.
  //
  // 130 trees spread evenly over 1.96 km² is one tree per 15 000 m², which
  // means you can walk for a minute without passing one and the whole system —
  // the pipe model, the blossom, all of it — is something you see at a
  // kilometre as specks. §9.7 asks for a hero landmark in the *opening
  // frustum*, and a stand of trees is exactly that.
  //
  // So over half of them cluster on the landing site with a 130 m spread and
  // the rest scatter across the world. You step out into a wood; the horizon
  // still has trees on it.
  const sites = [];
  const sp = s.spawn ?? { x: 0, z: 0 };
  for (let i = 0; i < 3000 && sites.length < nTrees; i++) {
    const near = i % 100 < 58;
    const x = near ? sp.x + r.gauss() * 130 : r.float(-EXT / 2, EXT / 2);
    const z = near ? sp.z + r.gauss() * 130 : r.float(-EXT / 2, EXT / 2);
    // …but not standing in the doorway. §9.7 wants the landmark in the frustum,
    // not through it, and a trunk 3 m from the eye is a wall.
    if (Math.hypot(x - sp.x, z - sp.z) < 14) continue;
    const h = dryland(x, z);
    if (h === null) continue;
    sites.push({ x, y: h, z, height: r.float(5, 13), yaw: r.float(0, 6.28), seed: r.int(1, 1e9) });
  }

  // grow them all first, so the instance count is known before the buffer is
  const grown = sites.map((p) => growTree({
    seed: p.seed, gravity: gwork, height: p.height, budget,
  }));
  const segTotal = grown.reduce((a, t) => a + t.segments, 0);
  const wood = new THREE.InstancedMesh(segGeo, barkMat, Math.max(segTotal, 1));
  const tipsAll = [];
  const woodUp = new THREE.Vector3(0, 1, 0);
  const woodDir = new THREE.Vector3();
  const woodQ = new THREE.Quaternion();
  let w = 0;
  for (let ti = 0; ti < grown.length; ti++) {
    const t = grown[ti], p = sites[ti];
    const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
    const g2 = t.seg;
    for (let i = 0; i < t.segments; i++) {
      // the tree's own frame, rotated into the world by the trunk's yaw
      const ax = g2.x0[i] * cy - g2.z0[i] * sy, az = g2.x0[i] * sy + g2.z0[i] * cy;
      const bx = g2.x1[i] * cy - g2.z1[i] * sy, bz = g2.x1[i] * sy + g2.z1[i] * cy;
      woodDir.set(bx - ax, g2.y1[i] - g2.y0[i], bz - az);
      const len = woodDir.length() || 1e-4;
      woodQ.setFromUnitVectors(woodUp, woodDir.divideScalar(len));
      const rr = (g2.r0[i] + g2.r1[i]) * 0.5;
      d.position.set(p.x + ax, p.y + g2.y0[i], p.z + az);
      d.quaternion.copy(woodQ);
      d.scale.set(rr, len, rr);
      d.updateMatrix();
      wood.setMatrixAt(w++, d.matrix);
    }
    for (const tip of tipsOf(t, 0.018)) {
      const tx = tip.x * cy - tip.z * sy, tz = tip.x * sy + tip.z * cy;
      tipsAll.push(p.x + tx, p.y + tip.y, p.z + tz);
    }
  }
  wood.count = w;
  wood.instanceMatrix.needsUpdate = true;
  s.scene.add(wood);

  // Foliage hangs on the tips the wood actually ended at, rather than being a
  // ball centred above a stick. That is the whole difference between a canopy
  // and a hat: the outline of the leaves is the outline of the branching.
  if (tipsAll.length) {
    const leafGeo = new THREE.IcosahedronGeometry(1, 0);
    const leaves = new THREE.InstancedMesh(leafGeo, canopyMat, tipsAll.length / 3);
    for (let i = 0, n = tipsAll.length / 3; i < n; i++) {
      const cw = r.float(0.55, 1.15);
      d.position.set(tipsAll[i * 3], tipsAll[i * 3 + 1], tipsAll[i * 3 + 2]);
      d.rotation.set(r.float(0, 3.1), r.float(0, 6.28), 0);
      d.scale.set(cw, cw * r.float(0.6, 0.95), cw);
      d.updateMatrix();
      leaves.setMatrixAt(i, d.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;
    s.scene.add(leaves);
  }

  // -------------------------------------------------------- blossom ----
  //
  // `src/blossom.js` decides *where* on a tree flowers open — Beer's law over
  // two light paths, which is what makes a canopy in bloom a cloud several
  // metres thick instead of a shell on a bubble — and *whether* this world is
  // in flower at all, from its own place in its own orbit. This is only the
  // drawing of it.
  //
  // Most worlds are not in bloom when you arrive, and that is the point: a
  // season you can miss is the only kind worth catching. `?season=0.5` puts any
  // world at the centre of its own, for anyone who does not want to wait for a
  // planet whose year is four of ours.
  const openness = seasonOpenness(seasonPhase(pp), pp.seed >>> 0);
  let petalDrift = null;
  if (openness > 0.02 && grown.length) {
    const ph = petalHue(vegH, pp.seed >>> 0);
    const petalCol = new THREE.Color().setHSL(ph.h, ph.s, ph.l);
    // A five-petal flower is a pentagon in silhouette, and silhouette is all a
    // blossom is ever worth: at 20 m one is three pixels across. Five triangles
    // buys the whole shape; a modelled corolla would buy sub-pixel noise.
    //
    // 7.6 cm across at unit scale, against a real cherry blossom's 3. Painted
    // oversize on the same warrant §9.6 gives the sun disc, and for the same
    // reason: below about two pixels the shape stops being a shape and starts
    // being aliasing. It is the one dimension in this file that is not honest,
    // and it is the honest one that looks wrong.
    const flGeo = new THREE.CircleGeometry(0.038, 5);
    // §5: one draw call for every flower on the world, capped by tier. The cap
    // is shared out per tree rather than spent first-come, so the near trees do
    // not eat the budget and leave the skyline bare.
    const cap = budget > 300 ? 44000 : 13000;
    const per = Math.max(24, Math.floor(cap / grown.length));
    const fx = [], frec = [];
    for (let ti = 0; ti < grown.length && fx.length / 3 < cap; ti++) {
      const t = grown[ti], p = sites[ti];
      const sy = Math.sin(p.yaw), cy = Math.cos(p.yaw);
      for (const f of blossomsFor(t, { seed: p.seed, openness, budget: per })) {
        fx.push(p.x + f.x * cy - f.z * sy, p.y + f.y, p.z + f.x * sy + f.z * cy);
        f.crown = t.crown;
        f.worldYaw = p.yaw;
        frec.push(f);
      }
    }
    if (frec.length) {
      const flMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.86, side: THREE.DoubleSide,
        // §9.2's subsurface term, as a material property rather than a shader:
        // a petal is one cell thick and light comes *through* it, so the ones
        // facing away from the sun are not black — they are lit from behind.
        emissive: petalCol.clone().multiplyScalar(0.16),
      });
      const blossom = new THREE.InstancedMesh(flGeo, flMat, frec.length);
      const tintCol = new THREE.Color();
      // A flower faces the way the light came in, and `floweringAt` has already
      // said which way that is: outward along the crown envelope's own normal,
      // which is straight up at the apex and straight out at the flank. Facing
      // them all one way — the first version — makes a canopy of stickers.
      const FACE = new THREE.Vector3(0, 0, 1), UPV = new THREE.Vector3(0, 1, 0);
      const nrm = new THREE.Vector3();
      for (let i = 0; i < frec.length; i++) {
        const f = frec[i], t = f.crown;
        nrm.set(f.x / (t.r * t.r), (f.y - t.y) / (t.up * t.up), f.z / (t.r * t.r));
        if (nrm.lengthSq() < 1e-12) nrm.set(0, 1, 0);
        // −yaw: the wood loop rotates by (x·c − z·s, x·s + z·c), which is
        // `applyAxisAngle(+Y, −θ)`. Matching the sign is not a detail — the
        // flowers would have faced the mirror image of where they grew.
        nrm.normalize().applyAxisAngle(UPV, -f.worldYaw);
        d.position.set(fx[i * 3], fx[i * 3 + 1], fx[i * 3 + 2]);
        d.quaternion.setFromUnitVectors(FACE, nrm);
        d.rotateZ(f.yaw);                       // spin in its own plane
        d.rotateX(f.tilt * 0.55);               // and never quite square on
        d.scale.setScalar(f.size);
        d.updateMatrix();
        blossom.setMatrixAt(i, d.matrix);
        // no two flowers the same colour, and the deeper ones stay duskier —
        // `lit` is the light that opened them, so it is already the right lever
        tintCol.copy(petalCol).offsetHSL((f.tint - 0.5) * 0.05, 0,
          -0.06 + 0.10 * f.lit + (f.tint - 0.5) * 0.07);
        blossom.setColorAt(i, tintCol);
      }
      blossom.instanceMatrix.needsUpdate = true;
      if (blossom.instanceColor) blossom.instanceColor.needsUpdate = true;
      s.scene.add(blossom);
    }

    // ------------------------------------------------------- petal fall ---
    //
    // The signature of the whole thing, and it costs one draw call and no CPU.
    // `blossom.js` asks `precip.js` how a petal falls, so this is the same drag
    // law the snow uses and petals cannot disagree with snow about the same
    // air: thin air drops them fast and straight, thick air makes them hang.
    //
    // Position is `f(seed, t)` in the vertex shader — `precip.js` idea 2 — and
    // the box is *wrapped* around the camera rather than respawned, idea 1, so
    // the density is exactly constant while you walk through it and nothing
    // trails behind you.
    if (openness > 0.22) {
      const nP = budget > 300 ? 1500 : 520;
      const BOX = 44, BOXY = 26;
      const base = new Float32Array(nP * 3), phs = new Float32Array(nP * 2);
      for (let i = 0; i < nP; i++) {
        base[i * 3] = r.float(-BOX / 2, BOX / 2);
        base[i * 3 + 1] = r.float(-BOXY / 2, BOXY / 2);
        base[i * 3 + 2] = r.float(-BOX / 2, BOX / 2);
        phs[i * 2] = r.float(0, 6.28318);
        phs[i * 2 + 1] = r.float(0, 6.28318);
      }
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.BufferAttribute(base, 3));
      fg.setAttribute('aPh', new THREE.BufferAttribute(phs, 2));
      // the same air `precip.js` drops rain and snow through
      const pf = petalFall({ gravity: gwork, rhoAir: airDensity(s.atmo ?? 1, pp.Teq) });
      const fallMat = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 }, uCam: { value: new THREE.Vector3() },
          uBox: { value: BOX }, uBoxY: { value: BOXY },
          uSpeed: { value: pf.speed }, uFlutter: { value: pf.flutter },
          uPeriod: { value: pf.period },
          uColor: { value: petalCol.clone() }, uDay: { value: 1 },
          uOpen: { value: openness },
          // A petal is 6 cm across; the shader recovers the scene's scale from
          // the model-view matrix, so this stays a world radius (see PETAL_GLSL).
          uR: { value: 0.03 },
          uH: { value: Math.max((typeof window !== 'undefined'
            ? window.innerHeight * Math.min(window.devicePixelRatio || 1, 2) : 900), 200) },
          // §6 M3: one wind owns this world, and the petals are in it. This
          // carries the *integral* of the gusty field rather than a mean, so a
          // front crossing the meadow shoves the blossom across with it.
          uDrift: { value: new THREE.Vector2() },
        },
        vertexShader: PETAL_GLSL.vert,
        fragmentShader: PETAL_GLSL.frag,
        transparent: true, depthWrite: false,
        // §9.3's alpha is the *clarity* channel, not a second opacity, and
        // `clouds.js` already worked out what a soft-edged transparent thing
        // owes it: over-composite on colour, plain coverage on alpha, so a
        // petal covering 10% of a pixel moves that pixel's clarity 10% toward
        // near and leaves the other 90% reading the hillside's distance.
        // Three's NormalBlending would use SrcAlpha on the alpha channel too,
        // squaring it — which reads as "very distant" and makes the print
        // smear a soft halo around every falling petal.
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
        blendSrcAlpha: THREE.OneFactor,
        blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      });
      petalDrift = new THREE.Points(fg, fallMat);
      // No `aerial()` in the shader, deliberately: the wrap box is 44 m across
      // and centred on the eye, so no petal is ever further off than 22 m —
      // inside §9.3's 70 m `fogNear`, where the air contributes nothing. A fog
      // term here would be arithmetic that always evaluates to zero.
      petalDrift.frustumCulled = false;      // the shader moves it out of its box
      petalDrift.renderOrder = 3;            // after the cloud deck, before HUD
      s.scene.add(petalDrift);
    }
  }

  // ---------------------------------------------------------- groves ----
  // the lone trees were scouts; these are the woods they were scouting
  // for. clustered stands with real crowns — puffy triple-canopy
  // broadleaves in the warm bands, spired conifers where the year is cold
  const conifer = pp.Teq < 268;
  const COARSE = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  const nGrove = Math.round((COARSE ? 260 : 520) * vegF);
  if (nGrove > 24) {
    const gTrunks = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.12, 0.26, 1, 5), trunkMat, nGrove);
    const crownGeo = conifer ? new THREE.ConeGeometry(1, 2.6, 7) : new THREE.IcosahedronGeometry(1, 1);
    const gCrowns = new THREE.InstancedMesh(crownGeo, canopyMat, nGrove * (conifer ? 1 : 3));
    let gt = 0, gc = 0;
    const centers = [];
    for (let i = 0; i < 90 && centers.length < 9; i++) {
      const x = r.float(-EXT / 2, EXT / 2), z = r.float(-EXT / 2, EXT / 2);
      if (dryland(x, z) === null) continue;
      // groves keep off the town's doorstep
      if (s.settlement && Math.hypot(x - s.settlement.site.x, z - s.settlement.site.z) < 160) continue;
      centers.push({ x, z, spread: r.float(55, 120), hue: r.float(-0.045, 0.045) });
    }
    for (let i = 0; i < nGrove * 3 && gt < nGrove; i++) {
      const c = centers[i % Math.max(centers.length, 1)];
      if (!c) break;
      const x = c.x + r.gauss() * c.spread, z = c.z + r.gauss() * c.spread;
      const h = dryland(x, z);
      if (h === null) continue;
      const height = conifer ? r.float(8, 16) : r.float(6, 12);
      d.position.set(x, h + height / 2, z);
      d.rotation.set(0, r.float(0, 6.28), r.float(-0.05, 0.05));
      d.scale.set(1, height, 1);
      d.updateMatrix();
      gTrunks.setMatrixAt(gt, d.matrix);
      if (conifer) {
        d.position.y = h + height * 0.62;
        const cw = r.float(1.6, 2.6);
        d.scale.set(cw, height * 0.55, cw);
        d.rotation.set(0, r.float(0, 6.28), 0);
        d.updateMatrix();
        gCrowns.setMatrixAt(gc++, d.matrix);
      } else {
        // three overlapping crowns make a real head of foliage
        for (let k = 0; k < 3; k++) {
          const cw = r.float(1.8, 3.4);
          d.position.set(
            x + r.gauss() * cw * 0.5,
            h + height * r.float(0.8, 1.05) + r.gauss() * cw * 0.24,
            z + r.gauss() * cw * 0.5);
          d.scale.set(cw, cw * r.float(0.55, 0.95), cw);
          d.rotation.set(0, r.float(0, 6.28), 0);
          d.updateMatrix();
          gCrowns.setMatrixAt(gc++, d.matrix);
        }
      }
      gt++;
    }
    gTrunks.count = gt;
    gCrowns.count = gc;
    s.scene.add(gTrunks, gCrowns);
  }

  // --------------------------------------------------------- flowers ----
  // meadow patches: small bright crosses in two species colors, the kind
  // of color Ghibli scatters an entire hillside with
  const nFlow = Math.round((COARSE ? 240 : 460) * vegF);
  if (nFlow > 30) {
    const fGeo = new THREE.PlaneGeometry(0.55, 0.55);
    const fMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
    });
    const flowers = new THREE.InstancedMesh(fGeo, fMat, nFlow);
    flowers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nFlow * 3), 3);
    const speciesA = new THREE.Color().setHSL(r.float(0, 1), 0.75, 0.62);
    const speciesB = new THREE.Color().setHSL(r.float(0, 1), 0.7, 0.66);
    const fc = new THREE.Color();
    let pf = 0;
    const patches = [];
    for (let i = 0; i < 40 && patches.length < 7; i++) {
      const x = r.float(-EXT / 2, EXT / 2), z = r.float(-EXT / 2, EXT / 2);
      if (dryland(x, z) !== null) patches.push({ x, z, spread: r.float(20, 55) });
    }
    for (let i = 0; i < nFlow * 3 && pf < nFlow; i++) {
      const c = patches[i % Math.max(patches.length, 1)];
      if (!c) break;
      const x = c.x + r.gauss() * c.spread, z = c.z + r.gauss() * c.spread;
      const h = dryland(x, z);
      if (h === null) continue;
      d.position.set(x, h + 0.32, z);
      d.rotation.set(r.float(-0.4, 0.4), r.float(0, 6.28), 0);
      d.scale.setScalar(r.float(0.6, 1.4));
      d.updateMatrix();
      flowers.setMatrixAt(pf, d.matrix);
      fc.copy(r.chance(0.6) ? speciesA : speciesB).offsetHSL(r.float(-0.03, 0.03), 0, r.float(-0.06, 0.06));
      flowers.setColorAt(pf, fc);
      pf++;
    }
    flowers.count = pf;
    s.scene.add(flowers);
  }

  // -------------------------------------------------------- skimmers ----
  // real bodies now: a fuselage and two wings that beat in the vertex
  // shader, banking into their turns
  const NB = eco ? Math.max(4, Math.min(44, eco.skimmers)) : 30;
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
  const NS_WANT = eco ? Math.min(eco.striders, 9) : (r.chance(0.7) ? 5 : 0);
  if (NS_WANT > 0) {
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
    const NS = NS_WANT;
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
      // no dry ground found — this one doesn't get dropped into the sea
      if (h === null) continue;
      strState.push({ x, z, heading: r.float(0, 6.28), speed: r.float(0.8, 1.6), scale: r.float(0.9, 1.8) });
    }
    striders.count = strState.length;
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
  const drift = new THREE.Vector2();
  let time = 0;

  return {
    openness,
    update(dt, sunY) {
      time += dt;
      const day = Math.min(Math.max((sunY + 0.1) * 3, 0), 1);
      tuftMat.color.copy(vegColor).multiplyScalar(0.15 + 0.85 * day);
      if (petalDrift) {
        const u = petalDrift.material.uniforms;
        u.uTime.value = time;
        u.uDay.value = 0.25 + 0.75 * day;
        const c = s.camLocal?.();
        if (c) u.uCam.value.set(c.x, c.y, c.z);
        const w = s.sampleWind?.(c ? c.x : 0, c ? c.z : 0, 6);
        if (w) {
          drift.x += w.x * dt;
          drift.y += w.z * dt;
          u.uDrift.value.copy(drift);
        }
      }

      // the wild reacts to you: your position in local metres, if the host
      // knows it, plus a fright flag (meteor strikes scatter everything)
      const cam = s.camLocal?.();
      const scared = s.scared?.() ?? false;

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
        // give the visitor a wide berth
        if (cam) {
          diff.set(bp[i].x - cam.x, bp[i].y - cam.y, bp[i].z - cam.z);
          const dc = diff.length();
          if (dc < 45) acc.addScaledVector(diff.normalize(), (scared ? 2.2 : 0.9) * (1 - dc / 45) * 8);
        }
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
          st.heading += (arand() - 0.5) * dt * 0.6;
          // steer home if straying, turn from water and steep ground
          const dHome = Math.hypot(st.x, st.z);
          if (dHome > 520) st.heading = Math.atan2(-st.z, -st.x) + (arand() - 0.5);
          // flee the visitor — but a flee-er blocked by water slides along
          // the shore instead of re-aiming into it forever
          let hurry = 1;
          if (cam) {
            const fx = st.x - cam.x, fz = st.z - cam.z;
            const d2 = fx * fx + fz * fz;
            if (d2 < 55 * 55 || scared) {
              if (!st.blocked) st.heading = Math.atan2(fz, fx) + (arand() - 0.5) * 0.4;
              hurry = 4;
            }
          } else if (scared) {
            hurry = 3;
          }
          const nx = st.x + Math.cos(st.heading) * st.speed * dt * 4 * hurry;
          const nz = st.z + Math.sin(st.heading) * st.speed * dt * 4 * hurry;
          const nh = s.heightAt(nx, nz);
          if (s.seaLevel !== null && nh < s.seaLevel + 1.2) {
            st.heading += 1.7;
            st.blocked = 3;
          } else {
            st.x = nx; st.z = nz;
            if (st.blocked) st.blocked--;
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
