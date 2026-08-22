// The silhouettes — CLAUDE.md §2.1, and the bug that made this file necessary.
//
// `ground-cover.js` builds every plant as a card — four vertices — and both it
// and `scatter.js` say in their own comments that the shape "lives in alpha,
// not in geometry." The alpha was never generated. The material carried
// `alphaTest: 0.35` with no alphaMap and no map, so alpha was uniformly 1.0,
// the test passed at every texel, and every plant on every world rendered as
// an opaque rectangle. A surface frame is a few hundred hard-edged dark quads
// at every angle, and it is the most conspicuous thing in one.
//
// §2.1 leaves exactly one way to fix that: "every texture is generated
// on-device at init from `hash(seed, …)`." So the silhouettes are drawn here,
// analytically.
//
// ---------------------------------------------------------------------------
// Why this is a module of its own, with no `three` in it
//
// The repo already draws this line and it is worth keeping: `scatter.js`
// decides what is on the ground and where and is a pure function that
// `tools/verify.js` imports and tests; `ground-cover.js` turns those numbers
// into meshes and is not testable in Node at all. Every module `verify.js`
// imports is three-free, and that is not an accident.
//
// A mask is arithmetic. Putting it beside the `DataTexture` that wraps it
// would have made the one genuinely novel thing here — six analytic shapes
// that have to come out looking like plants — the one thing no gate could
// reach. `suiteSilhouette` in `tools/verify.js` covers it instead, and it
// catches the failure that matters: a mask that comes back uniformly opaque is
// indistinguishable, in code, from the bug this file exists to fix.
//
// ---------------------------------------------------------------------------
// The contract
//
// Every mask is an implicit function of (u, v) in [0,1]^2 returning coverage in
// [0,1], evaluated per texel. Analytic rather than drawn, because §2.1 leaves
// no other option and because an implicit shape is antialiased for free: the
// distance field is already there, so an edge is a `smoothstep` rather than a
// staircase.
//
// `v = 0` is the root and `v = 1` is the tip. The card geometry is translated
// so a blade grows from its base, and a silhouette that is upside down is a
// very confusing thing to debug.

import { RNG, hash } from './rng.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** one tapering, leaning blade — the primitive most of the others are built from */
function blade(u, v, { lean = 0, w0 = 0.16, taper = 0.62, curve = 0.5, base = 0 }) {
  if (v < base) return 0;
  const t = (v - base) / Math.max(1 - base, 1e-3);
  // the spine: leans over as it rises, faster near the tip
  const spine = 0.5 + lean * Math.pow(t, 1.0 + curve);
  // width falls to nothing at the tip; `taper` sets how fast
  const w = w0 * Math.pow(1 - t, taper) * (0.35 + 0.65 * smoothstep(0, 0.12, t));
  return 1 - smoothstep(w * 0.55, w, Math.abs(u - spine));
}

/** an ellipse, rotated — the leaf primitive */
function petal(u, v, { cx, cy, rx, ry, rot }) {
  const c = Math.cos(rot), s = Math.sin(rot);
  const dx = u - cx, dy = v - cy;
  const x = (dx * c + dy * s) / Math.max(rx, 1e-3);
  const y = (-dx * s + dy * c) / Math.max(ry, 1e-3);
  return 1 - smoothstep(0.78, 1.0, Math.sqrt(x * x + y * y));
}

/**
 * The six species of `scatter.js`, as silhouettes.
 *
 * Each is a pure function of (u, v) and a seeded RNG, so the same species on
 * the same world is the same picture and two worlds differ (§2.3).
 */
const SHAPES = {
  // a low spreading mat: many small leaves, wide and short
  cover(r) {
    // Seven rather than nine, and smaller: at nine the leaves overlapped into
    // one lozenge and the mat read as a puddle. A ground-cover plant is mostly
    // gaps seen from a standing eye.
    const leaves = [];
    for (let i = 0; i < 7; i++) {
      leaves.push({
        cx: r.float(0.14, 0.86), cy: r.float(0.05, 0.38),
        rx: r.float(0.075, 0.135), ry: r.float(0.038, 0.075), rot: r.float(-1.2, 1.2),
      });
    }
    return (u, v) => leaves.reduce((a, L) => Math.max(a, petal(u, v, L)), 0);
  },

  // a tuft of bent grass — the one that has to read as *meadow* at 40 m (§M3)
  bent(r) {
    const bl = [];
    for (let i = 0; i < 7; i++) {
      bl.push({
        lean: r.float(-0.34, 0.34), w0: r.float(0.045, 0.085),
        taper: r.float(0.55, 0.9), curve: r.float(0.3, 1.1), base: 0,
      });
    }
    return (u, v) => bl.reduce((a, b) => Math.max(a, blade(u, v, b)), 0);
  },

  // broadleaf: three or four big overlapping leaves on short petioles
  broad(r) {
    // Leaves on visible petioles, thrown further apart and made smaller than
    // the first version, which overlapped them into one mass. A broadleaf is
    // read from the notches between its leaves; without them it is a blob.
    const leaves = [];
    const n = r.int(3, 4);
    for (let i = 0; i < n; i++) {
      const rot = ((i + 0.5) / n - 0.5) * 2.6 + r.float(-0.16, 0.16);
      leaves.push({
        cx: 0.5 + Math.sin(rot) * 0.30, cy: 0.34 + Math.cos(rot) * 0.26 + r.float(-0.05, 0.05),
        rx: r.float(0.105, 0.155), ry: r.float(0.145, 0.205), rot,
      });
    }
    return (u, v) => Math.max(
      blade(u, v, { lean: 0, w0: 0.05, taper: 1.4, curve: 0.2 }),
      leaves.reduce((a, L) => Math.max(a, petal(u, v, L)), 0));
  },

  // a tall thin stem with a few narrow leaves, mostly vertical
  stalk(r) {
    // Anchored to the stem rather than floating beside it. The first version
    // drew each leaf at an independent offset and rotation, and half of them
    // came out detached — a plant with leaves hanging in the air next to it,
    // which is worse than no leaves. The leaf now starts at the stem and runs
    // outward along its own angle.
    const leaves = [];
    for (let i = 0; i < 4; i++) {
      const up = 0.28 + (i / 4) * 0.54 + r.float(-0.04, 0.04);
      const dir = r.sign();
      const rot = dir * r.float(0.25, 0.75);
      const rx = r.float(0.085, 0.135);
      leaves.push({
        // centre half a leaf-length out from the stem, so the inner end of the
        // ellipse lands on it
        cx: 0.5 + dir * Math.cos(rot) * rx * 0.82,
        cy: up + Math.sin(Math.abs(rot)) * rx * 0.5,
        rx, ry: r.float(0.026, 0.040), rot,
      });
    }
    return (u, v) => Math.max(
      blade(u, v, { lean: 0.06, w0: 0.042, taper: 0.35, curve: 0.4 }),
      leaves.reduce((a, L) => Math.max(a, petal(u, v, L)), 0));
  },

  // a stem carrying a flower head — the accent §9.1 allows exactly one of
  bloom(r) {
    const pet = [];
    const n = r.int(5, 7);
    const hy = r.float(0.72, 0.84);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r.float(-0.2, 0.2);
      pet.push({
        cx: 0.5 + Math.cos(a) * 0.11, cy: hy + Math.sin(a) * 0.11,
        rx: r.float(0.07, 0.10), ry: r.float(0.05, 0.075), rot: a,
      });
    }
    return (u, v) => Math.max(
      blade(u, v, { lean: 0.04, w0: 0.038, taper: 0.3, curve: 0.5 }),
      pet.reduce((a, P) => Math.max(a, petal(u, v, P)), 0));
  },

  // reeds: tall, straight, barely tapering, in a narrow clump
  reed(r) {
    // Four, not five, and splayed rather than parallel. Five near-vertical
    // blades at this width merge into one column with a rounded top — a
    // rectangle wearing a mask, which is the thing this file exists to stop
    // being. What makes a clump read as a clump is the sky between the blades.
    const bl = [];
    const n = r.int(3, 4);
    for (let i = 0; i < n; i++) {
      const spread = (i / Math.max(n - 1, 1) - 0.5) * 2;
      bl.push({
        lean: spread * r.float(0.16, 0.30), w0: r.float(0.030, 0.048),
        taper: r.float(0.55, 0.85), curve: r.float(0.9, 1.7), base: 0,
      });
    }
    return (u, v) => bl.reduce((a, b) => Math.max(a, blade(u, v, b)), 0);
  },

  /**
   * Not a plant. `ripple` is a 2.6 m quad lying flat on the ground — a sand
   * ripple, a dry crust, a salt pan — and as an opaque rectangle it is the
   * single most conspicuous artefact in a desert frame: a hard-edged sheet of
   * card on the floor, with a straight edge no landform has. A soft irregular
   * blob with a feathered rim is the same 4 vertices and reads as ground.
   */
  ripple(r) {
    const lobes = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      lobes.push({
        cx: 0.5 + Math.cos(a) * r.float(0.04, 0.16),
        cy: 0.5 + Math.sin(a) * r.float(0.04, 0.16),
        rx: r.float(0.22, 0.36), ry: r.float(0.20, 0.34), rot: r.float(0, 3.14),
      });
    }
    return (u, v) => {
      const m = lobes.reduce((a, L) => Math.max(a, petal(u, v, L)), 0);
      // feathered, not cut: a patch of sand has no edge, and `alphaTest` on a
      // hard edge is what makes a decal look like a sticker
      return m * m * (3 - 2 * m);
    };
  },
};


/**
 * One species' silhouette as a `DataTexture`, ready for `alphaMap`.
 *
 * 64x64 is chosen against the thing it is for: a card is two or three pixels
 * wide by the time it is 30 m away (§9.5 makes exactly this argument about
 * blade width), and the near field is where the shape has to hold up. Sixteen
 * kilobytes per species buys that and nothing is spent on the far field, which
 * cannot resolve it.
 */
export function cardMask(kind, seed, size = 64) {
  const make = SHAPES[kind] || SHAPES.bent;
  const f = make(new RNG(hash(seed, 0x5eaf, kind.length, kind.charCodeAt(0))));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    // texture row 0 is the *bottom* of the card once the geometry is translated,
    // so v runs with y and the root stays at the root
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      const a = Math.round(clamp01(f(u, v)) * 255);
      const i = (y * size + x) * 4;
      // every channel, because alphamap_fragment reads .g and a mask that is
      // only in .a is a mask nothing looks at
      data[i] = a; data[i + 1] = a; data[i + 2] = a; data[i + 3] = a;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  // A card seen edge-on at 40 m is sampled at a grazing angle, and without
  // anisotropy the mip chain blurs a tuft into a grey smear — which reads as
  // haze sitting on the ground rather than as grass.
  tex.anisotropy = 4;
  return tex;
}


/** the species `scatter.js` places, plus the one mineral that is a card */
export const SILHOUETTES = Object.keys(SHAPES);

/**
 * One silhouette as raw RGBA bytes — pure, so `tools/verify.js` can look at it.
 *
 * 64x64 is chosen against the thing it is for: a card is two or three pixels
 * wide by the time it is 30 m away (§9.5 makes exactly this argument about
 * blade width), and the near field is where the shape has to hold up. Sixteen
 * kilobytes per species buys that, and nothing is spent on a far field that
 * cannot resolve it.
 *
 * Coverage goes in **every** channel, not only alpha. three r170's
 * `alphamap_fragment` reads green — `diffuseColor.a *= texture2D(alphaMap,
 * vAlphaMapUv).g` — and a mask written only to alpha is a mask nothing looks
 * at, which would have reproduced the original bug exactly.
 */
export function maskData(kind, seed, size = 64) {
  const make = SHAPES[kind] || SHAPES.bent;
  const f = make(new RNG(hash(seed, 0x5eaf, kind.length, kind.charCodeAt(0))));
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const a = Math.round(clamp01(f((x + 0.5) / size, v)) * 255);
      const i = (y * size + x) * 4;
      data[i] = a; data[i + 1] = a; data[i + 2] = a; data[i + 3] = a;
    }
  }
  return data;
}

/** mean coverage in [0,1] — what a gate can actually assert about a shape */
export function coverageOf(data) {
  let s = 0;
  for (let i = 1; i < data.length; i += 4) s += data[i];
  return s / (255 * (data.length / 4));
}
