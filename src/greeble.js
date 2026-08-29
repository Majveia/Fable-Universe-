// Surfaces for plated structures — CLAUDE.md §9.2, §8 axis 5, §11's "PBR instinct".
//
// Ported from `docs/reference/the-long-silence/src/gfx/greeble.js` (MIT, © 2026
// Anshu Chimala; provenance in that tree's README). Its geometry kit and its
// detail law come across close to verbatim, because both are good and neither
// has an opinion about light. Its *shading* does not come across at all, and
// the split is the whole design of this file — see "what did not port" below.
//
// ---------------------------------------------------------------------------
// The defect this answers
//
// `painted.js` opens by naming it in the general case: "the ground is a
// painting and the things standing on it are grey props." That file fixed the
// props on the ground. It did not fix the things in vacuum, because §9 is
// written about an atmosphere — four of its eight subsections assume air — and
// so nothing ever told a station what it was made of.
//
// `planetscale.js:_buildRing` is that sentence in one function: forty-four deck
// plates, eleven ribs, eleven lamps and two handrails, built as sixty-eight
// separate meshes across three `MeshStandardMaterial`s, on an object the
// visitor walks around *inside*. §8's blind run scored materials 1 and 2. It is
// unnameable from a still and it is sixty-eight draws for one prop.
//
// The reference fixes both halves with one idea, and it is worth stating why
// they are one idea rather than two. `place()` bakes a part's transform into
// its geometry, so `position` in the shader is the *object's* space and not the
// part's. That is what lets a hundred parts merge into one draw — and it is the
// same fact that lets a plate seam run continuously across a part boundary
// instead of restarting on every mesh. Merging is not an optimisation applied
// afterwards to something that already looked right. The surface only looks
// right *because* it merged.
//
// ---------------------------------------------------------------------------
// What did not port: their light
//
// The reference is physically based. `dress()` ends by writing
// `reflectedLight.directSpecular`, a Fresnel graze lobe and an analytic
// environment probe into three's standard lighting chain. All of that is
// exactly the instinct §11 lists by name, and §9.2 is not negotiable here:
// **one function decides every lit surface, and it is `paint()`.**
//
// So this module produces *inputs*, never colour:
//
//     plate albedo, groove, wear, grime, sun-bleach  ->  a tint on the three stops
//     the aHull bake's occlusion                     ->  paint()'s ao
//     the aHull bake's exposed edge                  ->  paint()'s jit
//     seam and pit relief                            ->  a perturbed normal
//
// The tint multiplies all three of §9.2's stops rather than replacing them, so
// a plate that faded in vacuum travels the same hue path as the plate beside
// it. That is §9.1's argument — one palette, roles not values — and the
// reference reached it independently: "a universe whose objects were shaded by
// five different authors reads as five different games."
//
// One term of theirs looked like something AEON lacked and was not. Their
// grazing rim exists, their comment says, because "a backlit hull collapses to
// a flat black cut-out no matter how bright the star is." §9.2 has had that
// term all along — `pow(1 - dot(N,V), 4.2)` gated on `smoothstep(0.05, 0.85,
// dot(V, -L))`, which the constitution calls "the connective tissue of the
// whole image". The fix is a higher `rim` in the look handed to
// `paintedStandard()`, not a second rim fighting the first.
//
// ---------------------------------------------------------------------------
// Determinism (§2.3, §11)
//
// The reference is clean: 2,169 lines, no `Math.random`, no clock read, no
// asset. Checked, not assumed. Everything below inherits that.
//
// The one clause worth writing down is §11's, because a reader will reach for
// it. The plate law decides, per fragment and from a hash: where a joint sits
// inside its cell, which one cell in eight has no joint, which two joints in
// three are bolted rather than welded, and which one bay in fourteen carries a
// hatch. Those are *branches*, and §11 says a branch decided by a transcendental
// is a different world.
//
// They are legal here for a reason that has to hold, not because nobody
// noticed: **every one of them terminates in a colour or a normal.** None
// reaches a count, an index, a placement or a URL. `hHash` is integer-domain
// `fract` arithmetic with no `sin`, `cos`, `exp` or `pow` in it, so it does not
// even touch the class §2.3 measures — but the guarantee is the one above, and
// it is the one to defend if this law ever decides how many of something to
// build. Part counts and placements come from `rng.js`. They always did.
//
// ---------------------------------------------------------------------------
// Units
//
// The reference models in metres and mounts at 1 unit = 1 km. AEON has no such
// constant — `planetscale.js` and `craft.js` disagree about what a unit is, and
// they are both right for their own scale. So the vertex shader converts once,
// `uGreebleU2M` object units to metres, and every constant below is the
// reference's own number in the reference's own unit. Do not re-tune them;
// tune the conversion.

import * as THREE from 'three';

const PARAM = (k) => {
  try { return new URL(window.location.href).searchParams.get(k); }
  catch { return null; }
};

/**
 * §7.4 — **shipped**, with an escape hatch. `?greeble=0` restores the old
 * surfaces so §2.4's saved URLs keep resolving.
 *
 * Flipped on the human's explicit instruction, and the shape of the evidence
 * behind it should be stated rather than implied. `tools/ringshot.js` shows the
 * station ring before and after and the difference is not subtle — but those
 * frames are SwiftShader, so `gateValid` is false and §8 has not scored them.
 * Two questions are open and recorded in `docs/captures/greeble/README.md`:
 * whether the lit stop is over-saturated, and whether the mid-distance speckle
 * is `gLod` not yet biting or the software rasteriser's `fwidth`.
 *
 * What is measured rather than looked at: 68 draws become 2 on the ring
 * (`tools/ringcensus.js`), and every §9.2 program compiles post-assembly
 * (`tools/paintcheck.js`). Those hold on any GPU.
 */
export const GREEBLE = PARAM('greeble') !== '0';

// ===========================================================================
// 1 · geometry — parts that merge
// ===========================================================================

/* A chamfer is not decoration. It is the only thing that makes an edge visible
   against a black sky: the key rakes across it and leaves a bright line where a
   knife edge leaves nothing at all. So the number that matters is not a
   proportion of the part, it is how many pixels the break subtends — and at the
   distance a hull is actually judged from, anything under about five
   centimetres is gone. The reference records losing a radiator leaf to this:
   34 mm of chamfer on a 4.6 m chord read as a sheet of card. */
const CHAMFER_FLOOR = 0.07;

/**
 * Bake a transform into a geometry so `position` stays the object's own space.
 *
 * This is the load-bearing function in the file. Because the transform is in
 * the vertices, the plate law downstream sees one continuous coordinate system
 * across every part, and the seams run across part boundaries instead of
 * restarting at each one.
 *
 * Everything is de-indexed on the way through: `ExtrudeGeometry` returns
 * non-indexed and the primitives return indexed, and a merge cannot take a
 * mixed list. Stray attributes go too — a merge compares the attribute *set*,
 * so one part carrying a leftover channel silently drops the whole batch.
 */
export function place(geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = null } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (scale) g.scale(scale[0], scale[1], scale[2]);
  if (rot[0]) g.rotateX(rot[0]);
  if (rot[1]) g.rotateY(rot[1]);
  if (rot[2]) g.rotateZ(rot[2]);
  g.translate(pos[0], pos[1], pos[2]);
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  g.morphAttributes = {};
  g.clearGroups();
  return g;
}

/** A rounded slab — the workhorse for panels, pylons, decks and structure. */
export function slab(w, h, d, bevel = 0.12) {
  const s = new THREE.Shape();
  const hw = w / 2, hh = h / 2, b = Math.min(bevel, hw * 0.45, hh * 0.45);
  const c = Math.min(Math.max(b * 0.5, CHAMFER_FLOOR), b * 0.92, d * 0.42);
  s.moveTo(-hw + b, -hh);
  s.lineTo(hw - b, -hh); s.quadraticCurveTo(hw, -hh, hw, -hh + b);
  s.lineTo(hw, hh - b); s.quadraticCurveTo(hw, hh, hw - b, hh);
  s.lineTo(-hw + b, hh); s.quadraticCurveTo(-hw, hh, -hw, hh - b);
  s.lineTo(-hw, -hh + b); s.quadraticCurveTo(-hw, -hh, -hw + b, -hh);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: d, bevelEnabled: true, bevelSize: c, bevelThickness: c,
    bevelSegments: 2, curveSegments: 4,
  });
  g.translate(0, 0, -d / 2);
  return g;
}

/**
 * An arbitrary flat polygon, extruded and bevelled — a tapered fin, a bracket,
 * a swept vane. `slab()` can only make rectangles, and a structure built
 * entirely out of rectangles is what reads as a kit-bash: a *taper* is what
 * tells the eye a part was designed for its load rather than cut from stock.
 *
 * A bevel of zero turns the offset off outright, and that is not a shortcut.
 * The offset applies to the whole outline, so a profile whose own features are
 * shallower than the bevel — a corrugated sheet under a wide chamfer —
 * self-intersects and its ribs vanish into a swollen rectangle.
 *
 * @param {Array<[number,number]>} pts polygon in the XY plane, extruded along Z
 */
export function panel(pts, thick, bevel = 0.10) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1]);
  s.closePath();
  const off = bevel > 0;
  const b = Math.min(Math.max(bevel, CHAMFER_FLOOR), thick * 0.45);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: thick, bevelEnabled: off, bevelSize: b, bevelThickness: b,
    bevelSegments: 1, curveSegments: 2,
  });
  g.translate(0, 0, -thick / 2);
  return g;
}

/**
 * A chamfered rectangular section carried along +X — a boom that tapers into
 * what it carries, a pylon that steps where it leaves the hull.
 *
 * An extrusion has one constant depth by definition, so a pylon built from
 * `slab()` has the same section at the root as at the tip. That uniform section
 * is the loudest tell that a part was placed rather than designed: a real strut
 * is deepest where the bending moment is, and the eye knows it without being
 * able to say why.
 *
 * Stations are `[x, halfDepth(z), halfHeight(y), yOffset, zOffset]`, increasing
 * in x. The chamfer is in metres and held constant along the span the way a
 * real extrusion holds it, rather than as a fraction that opens out as the
 * section grows.
 */
export function loftBox(stations, cham = 0.18, capA = true, capB = true) {
  const N = 8;
  const rings = stations.map(([x, hz, hy, yo = 0, zo = 0]) => {
    const cz = Math.min(cham, hz * 0.62), cy = Math.min(cham, hy * 0.62);
    // counter-clockwise in the (z, y) plane, so the swept normal points out
    const S = [
      [hz, -hy + cy], [hz, hy - cy], [hz - cz, hy], [-hz + cz, hy],
      [-hz, hy - cy], [-hz, -hy + cy], [-hz + cz, -hy], [hz - cz, -hy],
    ];
    const p = new Float32Array(N * 3);
    for (let k = 0; k < N; k++) {
      p[k * 3] = x; p[k * 3 + 1] = S[k][1] + yo; p[k * 3 + 2] = S[k][0] + zo;
    }
    return p;
  });
  const m = rings.length;
  const tris = (m - 1) * N * 2 + (capA ? N - 2 : 0) + (capB ? N - 2 : 0);
  const pos = new Float32Array(tris * 9);
  const nrm = new Float32Array(tris * 9);
  const uvs = new Float32Array(tris * 6);
  let t = 0;
  const put = (r0, k0, r1, k1, r2, k2) => {
    const A = rings[r0], B = rings[r1], C = rings[r2];
    const ax = A[k0 * 3], ay = A[k0 * 3 + 1], az = A[k0 * 3 + 2];
    const bx = B[k1 * 3], by = B[k1 * 3 + 1], bz = B[k1 * 3 + 2];
    const cx = C[k2 * 3], cy2 = C[k2 * 3 + 1], cz2 = C[k2 * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy2 - ay, vz = cz2 - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const o = t * 9, q = t * 6;
    pos[o] = ax; pos[o + 1] = ay; pos[o + 2] = az;
    pos[o + 3] = bx; pos[o + 4] = by; pos[o + 5] = bz;
    pos[o + 6] = cx; pos[o + 7] = cy2; pos[o + 8] = cz2;
    for (let i = 0; i < 3; i++) {
      nrm[o + i * 3] = nx; nrm[o + i * 3 + 1] = ny; nrm[o + i * 3 + 2] = nz;
    }
    uvs[q] = k0 / N; uvs[q + 1] = r0 / (m - 1);
    uvs[q + 2] = k1 / N; uvs[q + 3] = r1 / (m - 1);
    uvs[q + 4] = k2 / N; uvs[q + 5] = r2 / (m - 1);
    t++;
  };
  for (let j = 0; j < m - 1; j++) {
    for (let k = 0; k < N; k++) {
      const k2 = (k + 1) % N;
      put(j, k, j + 1, k, j, k2);
      put(j, k2, j + 1, k, j + 1, k2);
    }
  }
  if (capA) for (let k = 1; k < N - 1; k++) put(0, 0, 0, k, 0, k + 1);
  if (capB) for (let k = 1; k < N - 1; k++) put(m - 1, 0, m - 1, k + 1, m - 1, k);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  return g;
}

/**
 * A tube between two points, with the end fittings that stop a strut reading as
 * a length of pipe somebody left in the frame.
 *
 * Euler angles are the wrong tool for a brace: it runs from a lug to a lug, and
 * the only things that matter are those two points. Returns a list ready to
 * merge.
 */
export function strut(a, b, r0, r1 = r0, seg = 12, collar = 0) {
  const A = new THREE.Vector3(a[0], a[1], a[2]);
  const d = new THREE.Vector3(b[0], b[1], b[2]).sub(A);
  const len = d.length();
  if (len < 1e-6) return [];
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), d.clone().multiplyScalar(1 / len));
  const out = [];
  const put = (geo, along) => {
    geo.applyQuaternion(q);
    geo.translate(A.x + d.x * along, A.y + d.y * along, A.z + d.z * along);
    out.push(place(geo));
  };
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.applyQuaternion(q);
  g.translate(A.x + d.x / 2, A.y + d.y / 2, A.z + d.z / 2);
  out.push(place(g));
  if (collar > 0) {
    // a clevis at each end: the joint is what says the member is bolted on
    // rather than grown out of the thing it braces
    const cl = Math.min(collar * 1.6, len * 0.14);
    put(new THREE.CylinderGeometry(r0 * 1.55, r0 * 1.15, cl, seg), 0.5 * cl / len);
    put(new THREE.CylinderGeometry(r1 * 1.15, r1 * 1.55, cl, seg), 1 - 0.5 * cl / len);
  }
  return out;
}

/**
 * Average normals across a joint only where the two faces meet within `deg`.
 *
 * `place()` de-indexes, and `computeVertexNormals()` on de-indexed geometry can
 * only produce one normal per *triangle*. So everything welded here would come
 * out flat shaded whatever it was authored as: a cylinder is not a tube, it is
 * a prism with countable sides, and raising the segment count does nothing at
 * all. It is also why any coat keyed off the surface normal arrives on a drum
 * as hard vertical bands rather than as a gradient over its shoulder.
 *
 * Averaging everything is not the answer either — an averaged chamfer is a
 * fillet with no edge in it, and the hard bright line along a chamfer is the
 * entire reason the chamfer is there. So: a 96-sided drum steps under four
 * degrees and comes out round; a chamfer, a box corner and a bevel band meet at
 * forty-five or ninety and stay knife sharp.
 *
 * Weighting is by the unnormalised cross product, which is already twice the
 * triangle's area — free, and it stops a sliver at the end of a taper
 * outvoting the face it sits beside.
 */
export function creaseNormals(geo, deg = 32) {
  const pos = geo.attributes.position;
  if (!pos || geo.index) return geo;
  const a = pos.array, nv = pos.count, nt = (nv / 3) | 0;
  const fn = new Float32Array(nt * 3);   // area-weighted
  const fu = new Float32Array(nt * 3);   // unit
  for (let t = 0; t < nt; t++) {
    const i = t * 9;
    const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2];
    const vx = a[i + 6] - a[i], vy = a[i + 7] - a[i + 1], vz = a[i + 8] - a[i + 2];
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z) || 1;
    fn[t * 3] = x; fn[t * 3 + 1] = y; fn[t * 3 + 2] = z;
    fu[t * 3] = x / l; fu[t * 3 + 1] = y / l; fu[t * 3 + 2] = z / l;
  }
  // 16 bits an axis: +-128 m at 4 mm, and it stays inside a double
  const key = (x, y, z) => (
    ((Math.round(x * 256) + 32768) * 65536 + (Math.round(y * 256) + 32768)) * 65536
    + (Math.round(z * 256) + 32768));
  const at = new Map();
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const i = (t * 3 + k) * 3;
      const kk = key(a[i], a[i + 1], a[i + 2]);
      const b = at.get(kk);
      if (b === undefined) at.set(kk, [t]); else b.push(t);
    }
  }
  const lim = Math.cos(deg * Math.PI / 180);
  const out = new Float32Array(nv * 3);
  for (let t = 0; t < nt; t++) {
    const ux = fu[t * 3], uy = fu[t * 3 + 1], uz = fu[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const i = (t * 3 + k) * 3;
      const b = at.get(key(a[i], a[i + 1], a[i + 2]));
      let x = 0, y = 0, z = 0;
      for (let m = 0; m < b.length; m++) {
        const o = b[m] * 3;
        if (fu[o] * ux + fu[o + 1] * uy + fu[o + 2] * uz < lim) continue;
        x += fn[o]; y += fn[o + 1]; z += fn[o + 2];
      }
      const l = Math.hypot(x, y, z);
      if (l > 1e-12) { out[i] = x / l; out[i + 1] = y / l; out[i + 2] = z / l; }
      else { out[i] = ux; out[i + 1] = uy; out[i + 2] = uz; }
    }
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(out, 3));
  return geo;
}

/**
 * Concatenate placed geometries into one.
 *
 * The reference calls `mergeGeometries` from three's `BufferGeometryUtils`
 * addon. AEON does not vendor that addon, and adding it to buy one function
 * would be a poor trade: the general case handles indexed and non-indexed
 * mixing, morph targets, groups and interleaved buffers, and `place()` has
 * already guaranteed that none of those can occur. What is left is a
 * concatenation, and it is worth more as twenty lines that state their own
 * precondition than as a dependency that hides it.
 *
 * Returns null rather than throwing on a mismatched list — a station that
 * quietly loses its handrail is a bug report, a station that throws during
 * `_buildRing` is a black screen.
 */
export function mergeParts(list) {
  if (!list.length) return null;
  /* `aHull` is here rather than in the fixed list because it is *conditionally*
     present — `bakeSurface()` writes it, and a part set small enough not to
     want the bake never has it. Leaving it out of the merge was the first bug
     `paintcheck` caught: every part carried the channel, the merged geometry
     did not, and the surface rendered perfectly with no occlusion in it at all.
     Nothing throws when that happens, because `defaultAttributeValues` supplies
     (0,0) exactly so an un-baked object still draws. */
  const names = ['position', 'normal', 'uv'];
  const baked = list.every((g) => g.attributes.aHull);
  if (baked) names.push('aHull');
  else if (list.some((g) => g.attributes.aHull)) {
    // Half a baked list is worse than none: the merged buffer would carry the
    // channel with zeros where the un-baked parts landed, which reads as a
    // sharp occlusion boundary along a part seam.
    console.error('[greeble] mergeParts: some parts are baked and some are not — bake the whole list at once');
    return null;
  }
  let n = 0;
  for (const g of list) {
    if (g.index) { console.error('[greeble] mergeParts got indexed geometry — place() it first'); return null; }
    for (const k of names) {
      if (!g.attributes[k]) { console.error(`[greeble] mergeParts: a part has no ${k}`); return null; }
    }
    n += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  for (const k of names) {
    const a0 = list[0].attributes[k];
    const size = a0.itemSize;
    // aHull is a normalised Uint8 pair; the rest are plain floats. Preserving
    // both the array type and the normalised flag matters — a Float32 aHull
    // would arrive in the shader as 0..255 rather than 0..1.
    const buf = a0.normalized ? new Uint8Array(n * size) : new Float32Array(n * size);
    let o = 0;
    for (const g of list) {
      const a = g.attributes[k];
      buf.set(a.array.subarray(0, a.count * size), o);
      o += a.count * size;
    }
    out.setAttribute(k, new THREE.BufferAttribute(buf, size, a0.normalized));
  }
  return out;
}

/**
 * Merge a list of placed parts into one mesh and dispose the inputs.
 *
 * The `aHull` channel is picked up here rather than by the caller, because it
 * has to be baked across the *whole* list at once — see `bakeSurface()`. Pass
 * `bake: false` for a part set small enough that the two-shell walk is not
 * worth its milliseconds.
 */
export function weld(list, mat, parent, { bake = true, cell = 0.85 } = {}) {
  if (!list.length) return null;
  if (bake) bakeSurface(list, occupancy(list, cell));
  const g = mergeParts(list);
  if (!g) return null;
  creaseNormals(g, 32);
  const m = new THREE.Mesh(g, mat);
  list.forEach((x) => x.dispose());
  list.length = 0;
  if (parent) parent.add(m);
  return m;
}

// ===========================================================================
// 2 · the bake — what noise cannot know
// ===========================================================================

const _dirs = (() => {
  const d = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x || y || z) {
          const l = Math.hypot(x, y, z);
          d.push(x / l, y / l, z / l);
        }
      }
    }
  }
  return new Float32Array(d);
})();

/**
 * Coarse voxel occupancy of a set of placed geometries, in their shared space.
 * @param {THREE.BufferGeometry[]} geos
 * @param {number} cell voxel size in metres
 */
export function occupancy(geos, cell = 0.85) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const g of geos) {
    const p = g.attributes.position;
    if (!p) continue;
    const a = p.array;
    for (let i = 0; i < a.length; i += 3) {
      if (a[i] < x0) x0 = a[i]; if (a[i] > x1) x1 = a[i];
      if (a[i + 1] < y0) y0 = a[i + 1]; if (a[i + 1] > y1) y1 = a[i + 1];
      if (a[i + 2] < z0) z0 = a[i + 2]; if (a[i + 2] > z1) z1 = a[i + 2];
    }
  }
  if (!isFinite(x0)) return null;
  // one voxel of margin, so a sample stepping off the surface lands in the grid
  const pad = cell * 5;
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  const inv = 1 / cell;
  const nx = Math.max(2, Math.min(200, Math.ceil((x1 - x0) * inv)));
  const ny = Math.max(2, Math.min(200, Math.ceil((y1 - y0) * inv)));
  const nz = Math.max(2, Math.min(200, Math.ceil((z1 - z0) * inv)));
  const data = new Uint8Array(nx * ny * nz);
  const grid = { x0, y0, z0, inv, nx, ny, nz, data, cell };

  const mark = (x, y, z) => {
    const i = ((x - x0) * inv) | 0, j = ((y - y0) * inv) | 0, k = ((z - z0) * inv) | 0;
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return;
    data[(k * ny + j) * nx + i] = 1;
  };
  // Rasterise every triangle at better than one sample per voxel. A station
  // ring is a few thousand square metres; at this cell size that is tens of
  // thousands of samples, not millions.
  for (const g of geos) {
    const p = g.attributes.position;
    if (!p) continue;
    const a = p.array;
    const idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : p.count;
    for (let t = 0; t + 2 < n; t += 3) {
      const i0 = (idx ? idx[t] : t) * 3;
      const i1 = (idx ? idx[t + 1] : t + 1) * 3;
      const i2 = (idx ? idx[t + 2] : t + 2) * 3;
      const ax = a[i0], ay = a[i0 + 1], az = a[i0 + 2];
      const bx = a[i1], by = a[i1 + 1], bz = a[i1 + 2];
      const cx = a[i2], cy = a[i2 + 1], cz = a[i2 + 2];
      const e = Math.max(
        Math.hypot(bx - ax, by - ay, bz - az),
        Math.hypot(cx - ax, cy - ay, cz - az),
        Math.hypot(cx - bx, cy - by, cz - bz));
      const s = Math.min(12, Math.max(1, Math.ceil(e * inv * 1.4)));
      for (let u = 0; u <= s; u++) {
        for (let v = 0; v <= s - u; v++) {
          const wu = u / s, wv = v / s, ww = 1 - wu - wv;
          mark(ax * ww + bx * wu + cx * wv,
            ay * ww + by * wu + cy * wv,
            az * ww + bz * wu + cz * wv);
        }
      }
    }
  }
  return grid;
}

/**
 * Write the `aHull` channel — (occlusion, exposed edge) — onto every geometry
 * in `geos`, from a grid built by `occupancy()`.
 *
 * This is the half of the surface that no amount of noise can reach.
 * `aHull.x` is how enclosed a point is: the inside of a collar, the angle where
 * a strut lands on a tube, the throat of a nozzle. `aHull.y` is the opposite —
 * a lip, a rim, a corner, the one place on a painted structure where bare alloy
 * is allowed to show.
 *
 * Calibrated across the whole list at once, so "flat plate" means the same
 * thing on all of them.
 */
export function bakeSurface(geos, grid) {
  if (!grid) return;
  const { x0, y0, z0, inv, nx, ny, nz, data, cell } = grid;
  const at = (x, y, z) => {
    const i = ((x - x0) * inv) | 0, j = ((y - y0) * inv) | 0, k = ((z - z0) * inv) | 0;
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return 0;
    return data[(k * ny + j) * nx + i];
  };
  // two shells: the near one finds a lip, the far one finds a pocket
  const R = [cell * 1.7, cell * 3.4];
  const W = [0.62, 0.38];
  const nd = _dirs.length / 3;

  // one value per distinct position — a merged, de-indexed part set carries
  // each corner three or four times over and the answer is the same every time
  const seen = new Map();
  const enc = [];
  const key = (x, y, z) => (
    (Math.round(x * 8) + 8192) * 16777216
    + (Math.round(y * 8) + 8192) * 4096
    + (Math.round(z * 8) + 8192));

  const perGeo = [];
  for (const g of geos) {
    const p = g.attributes.position;
    if (!p) { perGeo.push(null); continue; }
    const a = p.array, ids = new Int32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      const x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      const k = key(x, y, z);
      let id = seen.get(k);
      if (id === undefined) {
        id = enc.length;
        seen.set(k, id);
        let s = 0, tot = 0;
        for (let r = 0; r < R.length; r++) {
          const rr = R[r], w = W[r];
          for (let d = 0; d < nd; d++) {
            s += w * at(x + _dirs[d * 3] * rr, y + _dirs[d * 3 + 1] * rr, z + _dirs[d * 3 + 2] * rr);
            tot += w;
          }
        }
        enc.push(s / tot);
      }
      ids[i] = id;
    }
    perGeo.push(ids);
  }
  if (!enc.length) return;

  /* Calibrate off the distribution, but with a floor under the span.
     Percentiles alone adapt to *any* object, which is wrong: a handrail is
     nothing but tube, its enclosure values sit within a few per cent of each
     other, and stretching that to 0..1 paints the whole rail as an exposed
     edge. The absolute numbers are knowable — a flat plate sits near 0.3 of
     the shell occupied, a lip near 0.15, a crevice past 0.5 — so the ramp is
     never allowed to be narrower than that, and a uniform object comes out
     uniform. The curves are deliberately steep: wear belongs on a couple of
     per cent of a surface, not a third of it. */
  const sorted = Float32Array.from(enc).sort();
  const q = (t) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(t * (sorted.length - 1))))];
  const flatA = q(0.62), flatB = q(0.42);
  const deep = Math.max(flatA + 0.13, q(0.97));
  const lip = Math.min(flatB - 0.13, q(0.03));

  const out = new Float32Array(enc.length * 2);
  for (let i = 0; i < enc.length; i++) {
    const e = enc[i];
    const a = Math.min(1, Math.max(0, (e - flatA) / (deep - flatA)));
    const b = Math.min(1, Math.max(0, (flatB - e) / (flatB - lip)));
    out[i * 2] = a * a * (3 - 2 * a);
    out[i * 2 + 1] = Math.pow(b, 2.3);
  }

  for (let gi = 0; gi < geos.length; gi++) {
    const ids = perGeo[gi];
    if (!ids) continue;
    const buf = new Uint8Array(ids.length * 2);
    for (let i = 0; i < ids.length; i++) {
      buf[i * 2] = (out[ids[i] * 2] * 255) | 0;
      buf[i * 2 + 1] = (out[ids[i] * 2 + 1] * 255) | 0;
    }
    geos[gi].setAttribute('aHull', new THREE.BufferAttribute(buf, 2, true));
  }
}

// ===========================================================================
// 3 · the detail law — GLSL
//
// Everything here answers one question: what does this surface look like at
// this point, before anything decides how it is lit. It is ported from the
// reference's `HULL_PARS`, minus the terms that steer roughness and metalness,
// because §9.2 has neither.
// ===========================================================================

/**
 * The generators. Injected once into the fragment shader.
 *
 * `hHash` is deliberately transcendental-free — integer-domain `fract`
 * arithmetic, no `sin`, no `pow`. §11's per-architecture clause is about
 * `sin`, `cos`, `exp` and `pow`, and a plate law built on any of them would put
 * a *branch* (which cell has no joint, which bay has a hatch) one bit from
 * flipping across an arm64 build. This one is not near that line at all.
 */
export const GREEBLE_PARS = /* glsl */`
  varying vec3 vGPos;          // metres, object space
  varying vec3 vGNrm;
  varying vec2 vGHull;         // baked: x occlusion, y exposed edge

  float gHash(vec3 p){
    p = fract(p*0.3183099 + vec3(0.71, 0.113, 0.419));
    p *= 17.0;
    return fract(p.x*p.y*p.z*(p.x+p.y+p.z));
  }
  float gNoise(vec3 x){
    vec3 i = floor(x), f = fract(x);
    f = f*f*(3.0-2.0*f);
    return mix(mix(mix(gHash(i+vec3(0,0,0)), gHash(i+vec3(1,0,0)), f.x),
                   mix(gHash(i+vec3(0,1,0)), gHash(i+vec3(1,1,0)), f.x), f.y),
               mix(mix(gHash(i+vec3(0,0,1)), gHash(i+vec3(1,0,1)), f.x),
                   mix(gHash(i+vec3(0,1,1)), gHash(i+vec3(1,1,1)), f.x), f.y), f.z);
  }
  /* Three octaves, and the fourth and fifth are not missing by accident. This
     shader pays for its noise three times over, and the later octaves of a
     nine-metre blotch mask, a two-metre flow streak and a forty-centimetre
     paint tooth all land under a pixel from anywhere anyone looks. */
  float gFbm3(vec3 p){
    float s = 0.0, a = 0.5;
    for(int i=0;i<3;i++){ s += a*gNoise(p); p *= 2.07; a *= 0.5; }
    return s;
  }

  /* ---- how big a pixel is, in metres of surface -------------------------
     Procedural detail has no mip chain. Nothing prefilters it, and MSAA
     antialiases coverage rather than shading, so a feature that lands under a
     pixel does not read as fine detail — it reads as an answer that changes
     completely from one pixel to the next, which the print's chroma bleed
     (§9.4 step 5) then pulls apart into a crawling fringe.

     So every sub-plate feature below is multiplied by this: a fastener head
     thirty millimetres across fades out at exactly the distance it stops being
     resolvable instead of sparkling to the horizon. §11 calls this quantising
     before the value crosses into something visible, and it is the same rule
     that fixes a blade count decided by a last bit.

     It also buys back most of what the detail costs, because the branches it
     gates are screen-coherent and skip whole tiles at once. */
  float gLod(float s, float px){ return clamp(s/(px*3.2) - 0.55, 0.0, 1.0); }

  /* ---- one plate edge ---------------------------------------------------
     A dark groove with a burnished lip either side, not a flat dark stripe.
     The groove sits at a jittered place inside its cell and one edge in eight
     is missing altogether, because plates of exactly one length in a perfect
     grid is the definition of the brick-pattern read.

     Two joints in three are bolted and carry a row of fastener heads just
     outboard of the gap; the rest are welded, which is a *raised bead* and no
     gap at all. Mixing the two is most of what stops a surface reading as one
     repeated panel.

     reg is registration. At 0 the joint sits somewhere inside its cell, one
     cell in eight is skipped, and two joints in three are bolted — right for a
     butt strap, where the yard put the joint wherever the stock ran out. At 1
     the joint is at the same place in every cell, none is skipped, and all are
     bolted: that is a structural frame, and a frame ring is at its station
     because the thing was designed around it.

     Out: gv = (groove, lip); dt = (fastener, weld bead, dirt washing out). */
  void gSeam(float x, float y, float w, float fine, float reg, out vec2 gv, out vec3 dt){
    float c = floor(x);
    float j = gHash(vec3(c, 7.7, 1.3));
    float sp = mix(0.33 + 0.34*j, 0.5, reg);
    float d = fract(x) - sp;
    float g = abs(d);
    float keep = max(step(0.12, gHash(vec3(c, 3.1, 9.2))), reg);
    float bolt = max(step(0.34, gHash(vec3(c, 11.3, 4.9))), reg);
    // a welded joint still shows, but as a line rather than as a gap
    float core = (1.0 - smoothstep(0.0, w, g)) * keep * mix(0.42, 1.0, bolt);
    // The lip must stay NARROWER than the groove. Wider and every plate
    // acquires a bright border, which reads as quilting rather than as metal.
    float lip = smoothstep(w*2.0, w*1.05, g) * (1.0 - core) * keep;
    gv = vec2(core, lip);

    float riv = 0.0, bead = 0.0;
    if (fine > 0.002){
      // A head is three centimetres on a two-and-a-half metre plate. The
      // reference records making this band six times too wide, and the row
      // read as a soft lump beside the seam rather than as hardware.
      float band = 1.0 - smoothstep(w*0.30, w*0.95, abs(g - w*2.3));
      float fy = fract(y*6.0) - 0.5;
      riv = band * (1.0 - smoothstep(0.05, 0.15, abs(fy))) * bolt * keep * fine;
      // a weld bead, wandering along its length the way a hand-run bead does
      float wob = (gNoise(vec3(y*2.6, c*0.7, 4.0)) - 0.5) * w*1.4;
      bead = (1.0 - smoothstep(w*0.7, w*2.2, abs(d - wob))) * (1.0 - bolt) * keep * fine;
    }
    /* Dirt washes out of a gap and dies within one plate. Unlike fbm staining
       this is registered to the panel grid, which is the whole reason it reads
       as coming from the seam.

       The onset is a ramp across the gap rather than a hard step. As a stain
       that is merely more honest. As HEIGHT it is the difference between a lap
       joint and a defect: a hard step in a height field is an infinite
       screen-space gradient, and an infinite gradient through a derivative
       bump is one pixel of arbitrary normal down the centre of every seam —
       at 1:1 a bright dotted chain, and in motion a crawling one. */
    float wash = keep * smoothstep(-w*1.3, w*1.3, d) * exp2(-max(d, 0.0)*6.5)
               * (0.25 + 0.75*gHash(vec3(c, floor(y*2.3), 5.1)));
    dt = vec3(riv, bead, wash);
  }

  /* Seams follow the form, and the form is read off the surface normal.
     A pressure vessel is rolled plate: rings around it and stringers along it
     in its own cylindrical frame. A deck, a fin or a bulkhead is cut plate: a
     rectangular grid in the plane it actually lies in. Running the cylindrical
     law over everything turns a flat plate on the centreline into vertical
     dashes on a plain field, because it has no radius to run rings around.

     Plate SIZE varies by surface class, which is the fix for the tiled read: a
     barrel is plated in sheets that scale with its radius, flanks and fins
     finer than decks. One cell size over a whole structure is a texture; four
     is architecture.

     fr turns the transverse family into real frames and opens the hatch field.

     Out: sm = (groove, lip, plate seed) — the seed matters most, because no
     two panels were rolled in the same year or faded by the same amount;
     dt = (fastener, weld bead, gap wash); hd = (hatch recess, hatch rim). */
  void gPlate(vec3 p, vec3 n, float S, float w, float fine, float fr,
              out vec3 sm, out vec3 dt, out vec2 hd){
    vec3 an = abs(n);
    float rad = length(p.xy);
    float ln = length(n.xy);
    float radial = (rad > 0.05 && ln > 0.02) ? dot(p.xy/rad, n.xy/ln) : 0.0;
    // rolled plate only where the surface genuinely wraps a barrel
    float cw = smoothstep(0.60, 0.92, radial) * smoothstep(1.2, 2.6, rad)
             * (1.0 - an.z*an.z);

    vec2 gv = vec2(0.0), g0, g1;
    vec3 dd = vec3(0.0), d0, d1;
    float seed = 0.5;
    vec2 puv = vec2(0.0);        // the plate coordinate of whichever law won

    /* cylindrical: rings across, stringers around, and the stringers stagger
       by bay so the joints never line up into one long ladder — which is how
       plating is actually laid and the reason it does not read as brick. The
       rings wobble, but SMOOTHLY: jittering them per angular cell shatters
       every ring into staggered dashes.

       Under fr the wobble stops and the stagger goes to exactly half a plate.
       A rolled barrel is built on frames, and a frame is a ring of the same
       section at the same station all the way round: the wobble was there to
       stop a perfect grid reading as a texture and it does the opposite,
       because a line that drifts has no station to be at. */
    if (cw > 0.004){
      float Sc = S / clamp(rad*0.23, 0.60, 1.55);
      float ang = atan(p.y, p.x) * (1.55 + rad*0.045);
      float uCyl = p.z*Sc + gNoise(vec3(ang*0.30, 0.0, 0.0))*0.17*(1.0 - fr);
      float vCyl = ang*2.0 + floor(p.z*Sc)*mix(0.41, 0.5, fr);
      gSeam(uCyl, vCyl, w,     fine, fr,  g0, d0);   // frames
      gSeam(vCyl, uCyl, w*1.4, fine, 0.0, g1, d1);   // butt straps
      gv = max(g0, g1*0.85);
      dd = vec3(max(d0.xy, d1.xy*0.85), d0.z);
      puv = vec2(uCyl, vCyl);
      seed = gHash(vec3(floor(puv), 2.7));
    }

    /* cut plate, in whichever plane the surface lies in. Only the frames that
       actually carry weight are evaluated: an axis-aligned face has one, and
       computing the other two for it triples the cost for a contribution
       under half a per cent. */
    if (cw < 0.996){
      float wx = an.x*an.x*an.x, wy = an.y*an.y*an.y, wz = an.z*an.z*an.z;
      float ws = wx + wy + wz + 1e-4;
      vec2 cg = vec2(0.0); vec3 cd = vec3(0.0);
      vec2 cc = vec2(0.0); float best = -1.0;
      if (wx > 0.004*ws){
        float Sx = S*1.34;                       // flanks and fins: fine plate
        vec2 u = vec2(p.z*Sx + 0.31, p.y*Sx*1.3 + floor(p.z*Sx)*mix(0.37, 0.5, fr));
        gSeam(u.x, u.y, w,     fine, fr,  g0, d0);
        gSeam(u.y, u.x, w*1.3, fine, 0.0, g1, d1);
        cg += max(g0, g1*0.85)*wx;
        cd += vec3(max(d0.xy, d1.xy*0.85), d0.z)*wx;
        cc = u; best = wx;
      }
      if (wy > 0.004*ws){
        float Sy = S*0.71;                       // decks and roofs: long sheets
        vec2 u = vec2(p.z*Sy + 0.13, p.x*Sy*1.3 + floor(p.z*Sy)*mix(0.29, 0.5, fr));
        gSeam(u.x, u.y, w,     fine, fr,  g0, d0);
        gSeam(u.y, u.x, w*1.3, fine, 0.0, g1, d1);
        cg += max(g0, g1*0.85)*wy;
        cd += vec3(max(d0.xy, d1.xy*0.85), d0.z)*wy;
        if (wy > best){ cc = u; best = wy; }
      }
      if (wz > 0.004*ws){
        vec2 u = vec2(p.x*S + 0.57, p.y*S*1.3 + floor(p.x*S)*mix(0.23, 0.5, fr));
        gSeam(u.x, u.y, w,     fine, fr,  g0, d0);
        gSeam(u.y, u.x, w*1.3, fine, 0.0, g1, d1);
        cg += max(g0, g1*0.85)*wz;
        cd += vec3(max(d0.xy, d1.xy*0.85), 0.0)*wz;   // a face plate has no aft
        if (wz > best){ cc = u; best = wz; }
      }
      cg /= ws; cd /= ws;
      /* One plate identity, taken from whichever frame actually won rather
         than blended between them — a blended hash is a smooth gradient, which
         is the one thing a plate boundary must never be. */
      float cSeed = gHash(vec3(floor(cc), 2.7));
      gv = mix(cg, gv, cw);
      dd = mix(cd, dd, cw);
      seed = mix(cSeed, seed, step(0.5, cw));
      puv = mix(cc, puv, step(0.5, cw));
    }

    /* ---- doors, hatches and access panels.
       The plate law can say where a joint is. What it cannot say is that
       something was CUT OUT and hinged, and that difference is most of what
       separates a structure from a shape with lines drawn on it.

       A hatch fills its own bay. That is not a simplification, it is how one is
       built: an opening interrupts the plating, so it is framed by the seams
       already there rather than laid across them, and its size comes out of the
       material's own plate gauge. hd.y is the perimeter, handed to the fastener
       channel so the dogs round the edge answer the key exactly as the
       fasteners on a plate joint do. */
    hd = vec2(0.0);
    if (fr > 0.5){
      float dh = gHash(vec3(floor(puv), 31.7));
      float on = step(0.928, dh);              // about one bay in fourteen
      vec2 f2 = abs(fract(puv) - 0.5) - vec2(0.30, 0.26);
      float e = max(f2.x, f2.y);
      // A soft-shouldered step, for the same reason the gap wash has one.
      hd = vec2(on * (1.0 - smoothstep(-0.020, 0.020, e)),
                on * (1.0 - smoothstep(0.0, 0.034, abs(e))));
    }

    sm = vec3(gv, seed);
    dt = dd;
  }

  /* ---- micrometeoroid pitting -------------------------------------------
     Anything that has been in vacuum for a few years is not flat between its
     seams. Every square metre has been sandblasted by grit at fifteen
     kilometres a second, and what that leaves is a scatter of shallow dishes a
     few centimetres across with the ejecta burr still standing round the rim.
     It is the one piece of surface history that cannot be painted on: a crater
     has RELIEF, and under a raking key it is a bright crescent against a dark
     one, which is what an albedo blotch can never do.

     One cell owns one crater and neighbours are not consulted. Eight more hash
     lookups would let them overlap; at four to ten centimetres across nothing
     is ever close enough to notice that they do not. */
  float gPit(vec3 p, float sc){
    vec3 c = floor(p*sc);
    float h = gHash(c + 3.7);
    vec3 j = vec3(gHash(c + 1.3), gHash(c + 5.9), gHash(c + 9.1));
    // centre and radius both held clear of the cell wall, so a crater is never
    // sliced in half by the grid it was drawn in
    float rad = 0.13 + 0.16*fract(h*23.0);
    float d = length(fract(p*sc) - (0.35 + j*0.30)) / rad;
    // A crater is a bowl, not a dimple: deepest in the middle and STEEPEST at
    // the rim, which is the opposite of the smoothstep shape reached for first
    // and the reason that one read as a soft smudge.
    float dd = min(d, 1.0);
    float e = (d - 1.0)*5.0;
    return step(0.72, h) * (dd*dd - 1.0 + exp2(-e*e*1.44)*0.26);
  }

  /* ---- doublers, standoffs and access pads ------------------------------
     Small plates laid ON the surface and bolted down. Every real vehicle is
     covered in them, and between its seams this one was a plane — which is
     what leaves the largest, palest and most-looked-at surfaces with nothing
     in them for the key to find. The plate law can only draw where a joint IS;
     this draws what was later bolted over one.

     A box in object space cuts a rectangle out of any surface it meets, so one
     cell distance answers this for a flank, a deck and a barrel alike. And
     stretching that box along the SURFACE NORMAL is what turns it from a cube
     into a plate lying on the surface: without the stretch a two-dimensional
     surface misses a three-dimensional cube two times in three, and the field
     reads as one pad every few metres instead of a thing covered in them. */
  float gPad(vec3 p, vec3 n, float sc){
    vec3 c = floor(p*sc);
    float h = gHash(c + 21.3);
    vec3 j = vec3(gHash(c + 2.9), gHash(c + 7.1), gHash(c + 13.7));
    vec3 d = abs(fract(p*sc) - (0.35 + j*0.30));
    // deliberately unequal in the three axes, so a pad is a rectangle rather
    // than the square that gives a cell grid away
    vec3 hs = vec3(0.09 + 0.15*fract(h*13.0), 0.09 + 0.15*fract(h*29.0),
                   0.09 + 0.15*fract(h*53.0)) + abs(n)*0.42;
    float e = max(max(d.x - hs.x, d.y - hs.y), d.z - hs.z);
    return step(0.62, h) * (1.0 - smoothstep(-0.012, 0.012, e));
  }

  /* Height into normal, from screen derivatives. Without it the seams are a
     printed pattern: they change the colour and never catch the key, which is
     why a panel line at a raking angle looks drawn on rather than cut in.

     The height must arrive in the same units as vpos, which is view space and
     not metres — a groove authored at twenty millimetres and handed to a
     derivative taken in kilometres perturbs the normal by a factor of a
     thousand, and the whole surface dissolves into crawling static. That is
     what uGreebleBump is for, and why the call site owns it. */
  vec3 gBump(vec3 N, vec3 vpos, float h, float k){
    vec3 dpx = dFdx(vpos), dpy = dFdy(vpos);
    vec2 dH = vec2(dFdx(h), dFdy(h)) * k;
    vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
    float det = dot(dpx, r1);
    vec3 grad = sign(det) * (dH.x*r1 + dH.y*r2);
    return normalize(abs(det)*N - grad);
  }
`;

/**
 * Object position and normal, in metres, plus the bake.
 *
 * `axis` names which way the object's barrels run, and it exists because the
 * plate law's cylindrical branch is not symmetric: it reads a radius as
 * `length(p.xy)` and an angle as `atan(p.y, p.x)`, so it assumes barrels run
 * along **z**. That is the reference's convention, where every hull is a ship
 * flying nose-first down z.
 *
 * AEON has objects that stand up. A conjured rocket's tanks are three's
 * `CylinderGeometry`, which runs along **y**, and handing those to the z-law
 * gives every tank a radius measured across its own length: the barrel test
 * fails, the cut-plate branch wins everywhere, and a pressure vessel gets
 * plated like a deck. A swizzle in the vertex shader is the whole fix, and it
 * is free — the law downstream never learns it happened.
 */
export function greebleVert(axis = 'z') {
  const sw = axis === 'y' ? '.xzy' : '';
  return /* glsl */`
  #include <begin_vertex>
  vGPos = (position * uGreebleU2M)${sw};
  vGNrm = normalize(normal)${sw};
  vGHull = aHull;
`;
}

/** The z-axis default, for call sites that do not care. */
export const GREEBLE_VERT = greebleVert('z');

// ===========================================================================
// 4 · the bridge — detail becomes §9.2's inputs
// ===========================================================================

/**
 * Build the fragment block that runs the law above and hands the answer to
 * `paint()`.
 *
 * Four channels leave here, and the choice of four is the whole argument with
 * the reference. Theirs writes `diffuseColor`, `roughness`, `metalness` and a
 * specular lobe, because it is a PBR renderer. §9.2 has no roughness and no
 * specular: it has three colour stops, a band position, an ambient rotation
 * and a rim. So the detail has to arrive as things that law can actually use.
 *
 *   `gDetailTint`  multiplies all three stops. A groove, a grimy plate and a
 *                  panel rolled in a different year are all *the same colour
 *                  travelling the same hue path, darker* — which is what they
 *                  are, and which keeps §9.1's one-palette rule intact. It is
 *                  emphatically not a second albedo.
 *   `gDetailFade`  desaturates the stops toward their own luminance. Sun-bleach
 *                  is not a multiply: paint that has chalked in vacuum has lost
 *                  its chroma, not its value, and multiplying can only ever
 *                  make it darker. This is the one channel that had to be
 *                  invented rather than ported, because the reference expresses
 *                  it as a blend toward an absolute grey, and an absolute grey
 *                  is exactly what a seed-derived palette cannot contain.
 *   `gDetailAO`    multiplies paint()'s ao. The bake's occlusion plus the
 *                  groove's own cavity — a groove is geometry the mesh does not
 *                  have, so it has to occlude the ambient itself or the fill
 *                  floods straight back in and the plating reads as a printed
 *                  pattern rather than a surface.
 *   `gDetailJit`   adds to the painterly wobble on the band edges. The bake's
 *                  exposed-edge channel drives it, so the wobble is largest
 *                  exactly where a real edge is chipped and the paint boundary
 *                  is ragged. §9.2 calls the wobble the largest single
 *                  contributor to the illustrated look; this gives it a reason
 *                  to be where it is instead of being uniform.
 *
 * And the normal is perturbed in place, which is the fifth thing and the one
 * that matters most: without it every seam is a printed pattern that changes
 * the colour and never catches the key.
 *
 * @param {object} o
 *   plate   mean plate size, metres (2.2 is a pressure hull, 1.15 a fairing)
 *   frame   true for a structural grid — fixed pitch, no skipped joints, hatches
 *   soot    0..1 how much exhaust and handling stain it carries
 *   bleach  0..1 how far the sky-facing paint has chalked
 *   glare   0..1 strength of the anti-glare coat on upward faces
 *   rivet   0..1 fastener and weld-bead gain
 *   bump    relief gain, before uGreebleBump converts units
 *   ao      0..1 how much of the bake's occlusion to believe
 *   pit     0..1 micrometeoroid pitting
 *   axis    'z' (default) or 'y' — which way this object's barrels run
 */
export function greebleDetail(o = {}) {
  const plate = o.plate ?? 2.2;
  const frame = o.frame ? 1 : 0;
  const soot = o.soot ?? 0.5;
  const bleach = o.bleach ?? 0.7;
  const glare = o.glare ?? 0.55;
  const rivet = o.rivet ?? 1.0;
  const bump = o.bump ?? 1.0;
  const aoK = o.ao ?? 1.0;
  const pit = o.pit ?? 1.0;
  const axis = o.axis === 'y' ? 'y' : 'z';
  const f = (n) => Number(n).toFixed(4);

  const fragment = /* glsl */`
  {
    float mpp = max(length(fwidth(vGPos)), 1e-6);   // metres per pixel

    /* Plate size is not one number. It varies by surface class already — a
       barrel is plated to its radius, a flank finer than a deck — but within a
       class it was one grid over the whole object, and at 1:1 that is what
       gives away a tiled texture. A slow draw over about twenty metres puts a
       different sheet size on each module without ever putting a seam between
       them, which a per-part id could not do anyway: the whole thing is one
       merged mesh.

       Except that a structural grid cannot drift. A bay pitch wandering by a
       third over twenty metres is why a flank reads as an arbitrary scatter
       rather than as panelling: no two seams are parallel and no run of plates
       is one length, so there is no station for a frame to be at. */
    float S = ${f(1.0 / plate)}${frame ? '' : ` * (0.84 + 0.30*gNoise(vGPos*0.046 + 17.0))`};
    // a fastener head is about 30 mm and a weld bead about 60; both are gone
    // long before the plate they sit on is
    float fine = gLod(${f(0.055 * plate)}, mpp) * ${f(rivet)};

    vec3 sm, dt, fnm = vec3(0.0, 0.0, 0.5), fdt;
    vec2 hd, fhd;
    gPlate(vGPos, vGNrm, S, 0.026, fine, ${frame ? '1.0' : '0.0'}, sm, dt, hd);
    ${frame ? '' : 'hd = vec2(0.0);   // no frames, so nothing cut into them'}
    // The second, finer octave is a whole traversal of the law; at any
    // distance where it lands under a pixel there is no reason to walk it.
    float fLod = gLod(${f(0.30 * plate)}, mpp);
    if (fLod > 0.004) gPlate(vGPos + 41.0, vGNrm, S*3.1, 0.040, 0.0, 0.0, fnm, fdt, fhd);

    /* The hatch perimeter folds straight into the seam channel rather than
       being shaded on its own, because that is what it physically is: the gap
       round a door leaf is a plate joint, and every term downstream — the dark
       groove, the burnished lip, the dirt washing out of it, the cavity, the
       relief — is already written for one. Shading it separately is how a
       hatch ends up as a drawn rectangle with a hairline bevel. */
    float pl  = max(sm.x, hd.y*0.85), px = fnm.x * fLod;
    float lip = sm.y*0.55 + fnm.y*0.20*fLod;
    float seed = sm.z;
    float rivets = max(dt.x, hd.y*fine*0.9), bead = dt.y, wash = dt.z;
    float door = hd.x;

    // band limits — see gLod. The gauge for each is the feature's own
    // wavelength in metres.
    float lodT = gLod(0.40, mpp);                     // paint tooth
    float lodP = gLod(${f(0.052 * plate)}, mpp);      // one plate groove
    float det  = gLod(0.25, mpp);                     // a wear patch

    // weathering at three scales: broad blotching from vacuum exposure,
    // streaks that run with the flow, and a fine tooth so the paint never
    // reads as a flat fill
    float blotch = gFbm3(vGPos*0.09);
    float streak = gFbm3(vec3(vGPos.x*0.55, vGPos.y*0.55, vGPos.z*0.055));
    float tooth  = mix(0.5, gFbm3(vGPos*2.6), lodT);
    /* One patchiness draw read at several scales. Three separate fetches for
       three masks that are all "some places, not others" is twenty-four hashes
       a fragment for a difference nobody can see. */
    float mottle = gNoise(vGPos*0.62 + 5.0);

    // what the bake knows that no amount of noise does
    float occ = vGHull.x * ${f(aoK)};
    float exposed = vGHull.y;

    vec3 tint = vec3(1.0);

    /* Anti-glare coat on everything that faces the sky. Two-tone is what gives
       an object value contrast; without it every surface sits in the same
       narrow band and the whole thing reads as one moulded piece. Keying off
       the NORMAL means it wraps the curves correctly and needs no UVs across
       the merged geometry.

       The reference blends toward an absolute dark blue-grey. Here it is a
       multiply toward dark-and-cool instead, because the stops carry the
       palette and §9.1 does not allow a second one to be smuggled in. */
    float up  = clamp(vGNrm.y, 0.0, 1.0);
    float top = smoothstep(0.42, 0.86, up + (blotch-0.5)*0.22);
    tint *= mix(vec3(1.0), vec3(0.46, 0.52, 0.63), top*${f(glare)});

    // Sun-bleaching, applied after the coat so the dark panel chalks rather
    // than staying showroom-fresh. Chroma, not value — see gDetailFade.
    gDetailFade = clamp(pow(up, 1.9) * ${f(bleach)} * (0.55 + blotch*0.7) * 0.75, 0.0, 1.0);

    /* Grime. One layer, and it is most of what separates a vehicle from a
       render of one.

       It needs a DIRECTION, and a thing in vacuum has two: thrust carries the
       exhaust wash aft on every burn, and every hour spent standing on its gear
       runs the same dirt down toward the pads. So the flow is aft and down, and
       the noise is squashed across that axis rather than sampled round it,
       which is the difference between a streak and a blotch.

       And it needs a SOURCE. Dirt does not appear in the middle of a clean
       plate: it comes out of a gap — the wash term, registered to the panel
       grid, already dying within one plate of the seam it left — or out of the
       fold where a fitting lands, which is the occlusion the bake found and
       which no amount of noise knows. Source times flow is the effect; either
       one alone is a stain map. */
    vec3 FLOW = vec3(0.0, -0.5289, 0.8487);            // aft and down
    vec3 sp = vGPos - FLOW*dot(vGPos, FLOW)*0.86;
    float run  = gFbm3(sp*0.62 + 11.0);
    // a surface streaks when the flow runs across it; one facing straight into
    // it is scoured instead, and one facing away is dry
    float face = 1.0 - abs(dot(vGNrm, FLOW));
    float pool = smoothstep(0.05, 0.44, occ);
    float src  = clamp(wash*1.20 + pool*0.90 + pl*0.35, 0.0, 1.0);
    float drip = smoothstep(0.28, 0.80, run) * face * (0.26 + 0.95*src);
    // and it cakes in the folds whether anything ran out of them or not.
    // Scaled by the material's own staining number, because a ceramic radiator
    // has to stay the brightest thing in frame and a drive shroud is allowed to
    // be filthy — one grime layer, but not one amount of it.
    drip = clamp(drip*1.30 + pool*0.34, 0.0, 1.0) * ${f(0.34 + 0.66 * soot)};
    tint *= mix(vec3(1.0), vec3(0.62, 0.60, 0.56), drip*0.55);

    /* Per-plate colour. This is the whole difference between a structure and a
       moulded shell, and it is the thing a plate law that only knows where the
       seams are can never express: it has to know which SIDE of one it is on.
       Two independent draws — one for the panel, one for the batch around it —
       so a drum reads as sections of plate rather than as static. */
    float batch = gHash(floor(vGPos*0.11) + 8.3);
    tint *= mix(0.93, 1.07, seed) * mix(0.965, 1.035, batch);
    // the fine tooth, so paint is never a flat fill
    tint *= 0.94 + 0.12*tooth;

    // The groove itself: dark, and dirtier than the plate face. The lip either
    // side of it is burnished by handling, so it comes back up.
    tint *= 1.0 - pl*0.58 - px*0.14 + lip*0.055;
    // bare alloy where the bake found a real edge — brighter and cooler
    tint *= mix(vec3(1.0), vec3(1.18, 1.20, 1.24), exposed*det*0.55);

    gDetailTint = max(tint, vec3(0.0));

    /* A groove is geometry the mesh does not have, so it has to occlude the
       indirect term itself. Without this the ambient floods back into every
       seam and the plating reads as a pattern printed on a plane. */
    gDetailAO = clamp((1.0 - pl*0.55 - door*0.30) * (1.0 - occ*0.62), 0.0, 1.0);

    /* The painterly wobble, largest where the bake found an edge. §9.2 makes
       jit per-fragment so a band edge is never a contour line drawn across the
       field; this additionally makes it per-*place*, so the ragged paint
       boundary lands on the corners that are actually chipped. */
    gDetailJit = exposed*det*0.55 + pl*0.25;

    /* Relief. Everything that is physically cut into or bolted onto the
       surface, summed as a height and turned into a normal by screen
       derivatives. Every term is already band-limited by its own gLod above,
       so this fades to a flat plate at distance rather than to crawling
       static. */
    float relief = -pl*0.85 + lip*0.22 + rivets*0.55 + bead*0.45 - door*0.35
                 - px*0.18*fLod;
    ${pit > 0 ? `relief += (gPit(vGPos, 9.0)*0.35 + gPad(vGPos, vGNrm, 0.42)*0.22)
                          * det * ${f(pit)};` : ''}
    relief *= ${f(bump)} * lodP;
    normal = gBump(normal, -vViewPosition, relief, uGreebleBump);
  }`;

  return {
    pars: GREEBLE_PARS,
    vertex: greebleVert(axis),
    fragment,
    // Cache key: two materials that compile to different programs must not
    // share one. Every number above is interpolated into the source, so the
    // options ARE the key.
    key: `greeble-v1_${axis}_${plate}_${frame}_${soot}_${bleach}_${glare}_${rivet}_${bump}_${aoK}_${pit}`,
  };
}
