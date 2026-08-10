// The traveler's body — CLAUDE.md §4, §8 axis 1, §9.2.
//
// What was here before is four primitives: a cone, a sphere, a smaller cone and
// a plane, assembled into "a small cloaked figure". It is a placeholder and it
// has always been one. This file is the figure.
//
// ---------------------------------------------------------------------------
// The clause this file has to answer, and why it is not the constraint it looks
// like
//
// §4 says: *"No photoreal humanoid characters. Figures are silhouettes and
// scale references."* The brief for this work says: make the character look
// realistic and cool — a synthesis of the most iconic characters there are.
//
// Those read as opposites and are not, and §3's method — find the reading where
// both are right — settles it in one observation: **what makes a character
// iconic is almost never facial detail.** The Man With No Name is a poncho, a
// hat and a cigar. Samus is a shape. Vader is a shape. Ashitaka is a red cloak
// on a red elk. Every one of them is recognisable at thumbnail size, in pure
// black, from behind — which is precisely the definition of a silhouette. §8's
// first axis asks exactly this question ("readable subject at three distances")
// and asks it of everything in the frame.
//
// So the ruling this file is built on:
//
//   **Coolness is carried by silhouette, proportion, stance, gait and material.
//   Not by a face.** There is no face here — the hood holds a shadow void with
//   one horizontal light in it. That is a stronger read at 40 px than any face
//   could be, it is the only read that survives §2.1's zero-asset rule, and it
//   is what §4 was protecting in the first place.
//
// The reference frames the human supplied make the same argument from the other
// end: their blossom tree reads entirely as a shape against a bright sky, with
// no interior detail at all. The figure has to survive standing in that.
//
// ---------------------------------------------------------------------------
// The four things the silhouette is built out of
//
// 1. **True human proportion — 7.5 heads, 1.80 m to the crown.** Not a stylistic
//    choice: `avatar.js` puts the eye at 1.68 m and the entire world is scaled
//    to that number. A figure of any other height makes the scale reference lie,
//    and §8 axis 8 (honesty) fails on a frame where a person is the ruler and
//    the ruler is wrong. Every landmark below is measured from that: the visor
//    sits at exactly 1.68 m, so the third-person figure's eye and the
//    first-person camera are the same height, and pressing C proves it.
//
// 2. **One heavy diagonal.** A left pauldron, a strap from that shoulder to the
//    opposite hip, a satchel on the right hip, a scarf off the left shoulder.
//    Nothing mirrors. A bilaterally symmetric figure reads as a mannequin from
//    any angle; one strong diagonal reads as a person who packed.
//
// 3. **A long coat that is open at the front.** The coat is the mass — it is
//    what makes the shoulders wide, the waist narrow and the hem heavy. Open at
//    the front so the legs show through the gap: a closed skirt hides the gait
//    entirely, and the gait is half of what says "person" at distance. It is
//    also the surface the wind acts on, which is §6 M3's whole thesis given a
//    body to happen to.
//
// 4. **One cold accent in a warm world.** A 15 cm horizontal light inside the
//    hood. §8 axis 6 budgets three hue families plus one accent; the kit spends
//    them as violet-indigo (coat, suit, boots), bone-cream (pauldron) and rust
//    (scarf, lining, straps), and the visor is the accent. It dims in daylight
//    and burns at dusk, so it is a *reading light* rather than a decal.
//
// ---------------------------------------------------------------------------
// Why the geometry is skinned on the CPU
//
// Roughly 900 vertices, seventeen bones, one draw call. The bone matrices are
// solved in JS and the vertices are transformed in JS into a preallocated
// buffer, rather than uploading bone matrices and doing it in the vertex shader.
//
// Three reasons, in order of weight:
//
//   · **The shadow pass gets it for free.** `shadow.js` renders casters with an
//     override material. A GPU-skinned mesh under an override material draws in
//     its rest pose — a T-posed shadow under a running figure — and fixing that
//     means a second skinned depth material kept in step with the first. Baked
//     positions have no rest pose to fall back to.
//
//   · **Cloth is not skinning.** The coat hem and the scarf are not driven by
//     bones at all; they are driven by the wind field, the body's velocity and
//     the gait clock, and they need to be *generated*, not transformed. Once
//     half the mesh is written from the CPU each frame the other half may as
//     well be, and then there is one code path instead of two.
//
//   · It is free. 900 vertices × two bone influences is about 55 k flops per
//     frame, against §5's 12 ms CPU budget. The meadow uploads two orders of
//     magnitude more than this every frame without noticing.
//
// ---------------------------------------------------------------------------
// Determinism (§2.3)
//
// No `Math.random`, no clock. The mesh is a pure function of the seed; the pose
// is a pure function of the walker's state, `dt` and the wind field — all three
// of which are themselves deterministic. `?dt=` therefore pins the figure the
// same way it pins the body.

import * as THREE from 'three';
import { RNG, hash } from './rng.js';
import { PAINT_GLSL } from './paint.js';
import { TIER } from './quality.js';

// ---------------------------------------------------------------------------
// proportion
//
// The canonical 7.5-head figure, in metres, with the eye pinned to `GAIT.eye`.
// A head is 1.80 / 7.5 = 0.24 m, which is a real head; the eye sits half a head
// below the crown, which is where a real eye sits, and 1.80 − 0.12 = 1.68 is
// `GAIT.eye` exactly. The table is what makes that identity hold rather than
// approximately hold, so it is written down rather than inlined.

export const STATURE = 1.80;          // crown, metres
export const HEAD = STATURE / 7.5;    // 0.24 m

export const P = {
  crown: STATURE,             // 1.800
  eye: STATURE - HEAD * 0.5,  // 1.680 — GAIT.eye, and the visor line
  chin: STATURE - HEAD,       // 1.560
  shoulder: 1.455,            // acromion; head + neck ≈ 1.4 heads
  chest: 1.300,
  waist: 1.080,
  hip: 0.905,                 // greater trochanter — the leg's pivot
  knee: 0.487,
  ankle: 0.068,
  elbow: 1.170,
  wrist: 0.905,
  shoulderHalf: 0.185,        // biacromial 0.37 m; the coat reads 0.44 across
  hipHalf: 0.092,
};

// ---------------------------------------------------------------------------
// the kit
//
// §9.1's structure — every colour in one table, sRGB hex, linear at load. What
// is *not* §9.1's is that these do not vary by world, and that is deliberate.
//
// A seed-derived kit would mean the traveler is a different person on every
// planet, and the traveler is the one thing in AEON that is the same across all
// 10²⁸ of them. The pigments are fixed; the *light* on them is entirely
// seed-derived, because `paint()`'s four light colours come from this world's
// own star through `starlight.js`. Same coat, different sun — which is what
// wearing a coat across a galaxy actually looks like.
//
// Each entry is a §9.2 three-stop hue *path*, not a lightness ramp: the shade
// stop is cooler and more violet than the mid, the lit stop is warmer and
// desaturated toward the sky. That is what the ramp exists to walk along.

const hexLin = (h) => [1, 3, 5].map((i) => {
  const c = parseInt(h.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/**
 * A material: three stops, plus the four per-surface terms §9.2 takes.
 *
 * `rim` is the backlight weight — the reference calls the rim "the connective
 * tissue of the whole image", and on a figure standing against a bright sky it
 * is the entire read. Cloth gets the most of it; hard shell gets less, because
 * a ceramic edge does not glow.
 *
 * `ao` is baked cavity occlusion. There is no shadow map in the default build
 * (`?paint=` is off for reasons `surface.js` documents), so the only thing
 * telling the eye that the inside of a hood is deeper than the outside is this
 * number.
 */
const mat = (shade, mid, lit, { rim = 1.0, ao = 1.0, emis = 0, trans = 0 } = {}) => ({
  shade: hexLin(shade), mid: hexLin(mid), lit: hexLin(lit), rim, ao, emis, trans,
});

export const KIT = {
  // the coat — deep indigo. Dark enough to read as a silhouette against a lit
  // sky, violet enough that §9.2's shadow blend never lands on grey.
  coat: mat('#1E2440', '#364268', '#8B95BA', { rim: 1.30 }),
  coatWorn: mat('#1A2038', '#2F3A5C', '#7D88AC', { rim: 1.20, ao: 0.92 }),
  // the suit under it
  suit: mat('#171B2A', '#272D42', '#545C7A', { rim: 1.05 }),
  // boots and gauntlets. Note the violet bias in the shade stop: leather this
  // dark is where an achromatic black creeps in, and §M2's gate calls a
  // shadowed surface that has gone achromatic-dark a failure in those words.
  leather: mat('#14161F', '#24273A', '#4C5168', { rim: 0.85, ao: 0.94 }),
  // the pauldron — bone ceramic. The one bright value in the figure, and the
  // reason the shoulder line survives at 40 px against a dark coat.
  shell: mat('#6E6A5E', '#B5AE99', '#F2E8CC', { rim: 0.75 }),
  // straps and harness
  strap: mat('#2A1D14', '#513826', '#8E6A45', { rim: 0.95 }),
  // the scarf. Cloth, so it transmits: §9.2's subsurface term is what makes a
  // backlit scarf glow along its trailing edge rather than going flat.
  scarf: mat('#4A1712', '#9C3524', '#D9714A', { rim: 1.55, trans: 0.85 }),
  // the coat's lining, seen only when the hem lifts or a panel blows open —
  // and seen on every back face, which is the rule the shader states once.
  lining: mat('#3A1410', '#7E2B1E', '#C2603C', { rim: 1.25, trans: 0.55 }),
  // the void inside the hood. Dark, and never neutral.
  void: mat('#0E1020', '#14172A', '#1D2238', { rim: 0.30, ao: 0.34 }),
  // the accent
  visor: mat('#123040', '#2E6E88', '#A8ECFF', { rim: 0.4, emis: 1 }),
};

// ---------------------------------------------------------------------------
// the skeleton
//
// Seventeen bones. Rest positions are absolute in figure space (+Y up, −Z
// forward, +X the figure's right); the builder converts them to parent-relative
// offsets, so the table above can be read straight off the proportion table
// rather than as a chain of deltas nobody can check.

const BONES = [
  ['root', -1, 0, 0.945, 0],
  ['spine', 0, 0, 1.100, 0],
  ['chest', 1, 0, 1.300, 0],
  ['neck', 2, 0, 1.470, 0],
  ['head', 3, 0, 1.545, 0],

  ['armR', 2, P.shoulderHalf, P.shoulder, 0],
  ['elbowR', 5, P.shoulderHalf + 0.018, P.elbow, 0.012],
  ['handR', 6, P.shoulderHalf + 0.030, P.wrist, 0.020],

  ['armL', 2, -P.shoulderHalf, P.shoulder, 0],
  ['elbowL', 8, -(P.shoulderHalf + 0.018), P.elbow, 0.012],
  ['handL', 9, -(P.shoulderHalf + 0.030), P.wrist, 0.020],

  ['hipR', 0, P.hipHalf, P.hip, 0],
  ['kneeR', 11, P.hipHalf + 0.006, P.knee, 0.006],
  ['footR', 12, P.hipHalf + 0.008, P.ankle, 0],

  ['hipL', 0, -P.hipHalf, P.hip, 0],
  ['kneeL', 14, -(P.hipHalf + 0.006), P.knee, 0.006],
  ['footL', 15, -(P.hipHalf + 0.008), P.ankle, 0],
];

const B = {};
BONES.forEach(([n], i) => { B[n] = i; });
export const BONE_INDEX = B;

// ---------------------------------------------------------------------------
// detail rows (§5)
//
// Its own small table rather than a column in `quality.js`, because the figure
// is one object and a column there is a promise to every scale. One row change
// still reconfigures the whole figure, which is the shape §5 asks for.

const DETAIL = [
  { sides: 7, coatU: 13, coatV: 5, scarfN: 9, scarfW: 3 },   // low
  { sides: 8, coatU: 15, coatV: 6, scarfN: 11, scarfW: 3 },  // mobile
  { sides: 10, coatU: 19, coatV: 7, scarfN: 14, scarfW: 4 }, // desktop
  { sides: 12, coatU: 23, coatV: 8, scarfN: 17, scarfW: 4 }, // ultra
];

// ---------------------------------------------------------------------------
// the builder
//
// One primitive: a parametric grid. Everything — a limb, the hood, the coat,
// the scarf, a strap — is a function P(i, j) sampled over a rectangle, with
// normals taken analytically from the generator's own tangents.
//
// Taking the normal from the parameterisation rather than by accumulating face
// normals is not a micro-optimisation, it is what makes the winding provable.
// Fix the convention once — `n = normalize(cross(∂P/∂i, ∂P/∂j))`, and emit the
// triangle (i,j)→(i+1,j)→(i+1,j+1), whose own edge cross product is that same
// expression — and every surface in the figure is outward-facing by
// construction. Accumulated normals give no such guarantee, and an inverted
// normal on one part reads as a lighting bug three files away.

class Mesh {
  constructor() {
    this.pos = []; this.nrm = []; this.rest = [];
    this.shade = []; this.mid = []; this.lit = []; this.surf = [];
    this.bA = []; this.bB = []; this.bw = [];
    this.idx = [];
    this.cloth = [];      // vertex indices the cloth pass rewrites, in blocks
  }

  get count() { return this.pos.length / 3; }

  vert(p, n, m, bind, aoMul = 1) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.rest.push(p[0], p[1], p[2]);
    this.shade.push(m.shade[0], m.shade[1], m.shade[2]);
    this.mid.push(m.mid[0], m.mid[1], m.mid[2]);
    this.lit.push(m.lit[0], m.lit[1], m.lit[2]);
    this.surf.push(m.rim, m.ao * aoMul, m.emis, m.trans);
    this.bA.push(bind[0]); this.bB.push(bind[1]); this.bw.push(bind[2]);
  }

  /**
   * Sample `gen(i, j) -> [x, y, z]` over an (ni × nj) grid and emit it.
   *
   * `wrapJ` closes the ring (a limb, a torso); without it the sheet has two
   * free edges (a coat panel, a strap). `flip` reverses both the normal and the
   * winding together, which is the only way to reverse one of them safely.
   *
   * `at(i, j) -> { m, bind, ao }` supplies the material and the skin binding.
   */
  grid(gen, ni, nj, at, { wrapJ = false, flip = 1, cloth = null } = {}) {
    const base = this.count;
    const jn = wrapJ ? nj : nj;          // vertex columns emitted
    const P = [];
    for (let i = 0; i < ni; i++) {
      P.push([]);
      for (let j = 0; j < jn; j++) P[i].push(gen(i, j));
    }
    const dI = (i, j) => {
      const a = P[Math.max(i - 1, 0)][j], b = P[Math.min(i + 1, ni - 1)][j];
      return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    };
    const dJ = (i, j) => {
      const jm = wrapJ ? (j - 1 + jn) % jn : Math.max(j - 1, 0);
      const jp = wrapJ ? (j + 1) % jn : Math.min(j + 1, jn - 1);
      const a = P[i][jm], b = P[i][jp];
      return [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    };
    for (let i = 0; i < ni; i++) {
      for (let j = 0; j < jn; j++) {
        const u = dI(i, j), v = dJ(i, j);
        let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const l = Math.hypot(n[0], n[1], n[2]) || 1;
        n = [flip * n[0] / l, flip * n[1] / l, flip * n[2] / l];
        const a = at(i, j);
        this.vert(P[i][j], n, a.m, a.bind, a.ao ?? 1);
      }
    }
    const cols = jn;
    const jMax = wrapJ ? jn : jn - 1;
    for (let i = 0; i < ni - 1; i++) {
      for (let j = 0; j < jMax; j++) {
        const j2 = (j + 1) % jn;
        const a = base + i * cols + j, b = base + (i + 1) * cols + j;
        const c = base + (i + 1) * cols + j2, d = base + i * cols + j2;
        if (flip > 0) this.idx.push(a, b, c, a, c, d);
        else this.idx.push(a, c, b, a, d, c);
      }
    }
    if (cloth) this.cloth.push({ ...cloth, base, ni, nj: jn, wrapJ, flip });
    return base;
  }

  /** a fan cap: `centre` plus the ring already emitted at row `row` of a grid */
  cap(centre, n, m, bind, base, cols, row, up = true) {
    const c = this.count;
    this.vert(centre, n, m, bind);
    for (let j = 0; j < cols; j++) {
      const a = base + row * cols + j, b = base + row * cols + (j + 1) % cols;
      if (up) this.idx.push(c, b, a); else this.idx.push(c, a, b);
    }
  }
}

// a limb: a stack of ellipse rings, closed around, capped at both ends
function limb(M, rings, bindOf, matOf, sides, { capTop = true, capBot = true } = {}) {
  const gen = (i, j) => {
    const a = (j / sides) * Math.PI * 2;
    const r = rings[i];
    return [r.cx + Math.cos(a) * r.rx, r.y, r.cz + Math.sin(a) * r.rz];
  };
  const base = M.grid(gen, rings.length, sides,
    (i) => ({ m: matOf(i), bind: bindOf(i), ao: rings[i].ao ?? 1 }), { wrapJ: true });
  const top = rings[rings.length - 1], bot = rings[0];
  if (capTop) {
    M.cap([top.cx, top.y + top.rx * 0.35, top.cz], [0, 1, 0], matOf(rings.length - 1),
      bindOf(rings.length - 1), base, sides, rings.length - 1, true);
  }
  if (capBot) {
    M.cap([bot.cx, bot.y - bot.rx * 0.35, bot.cz], [0, -1, 0], matOf(0),
      bindOf(0), base, sides, 0, false);
  }
  return base;
}

// ---------------------------------------------------------------------------
// the figure, assembled
//
// Read this as a description of a person rather than as geometry: everything
// below is a decision about what the shape says, and the numbers are the
// proportion table.

function buildGeometry(seed, D) {
  const M = new Mesh();
  const r = new RNG(hash(seed, 0x1f16e));
  const bind = (a, b = a, w = 0) => [a, b, w];

  // --- torso ---------------------------------------------------------------
  // The coat *is* the torso: a coat over a chest is one silhouette and modelling
  // them separately buys nothing at any distance the figure is ever seen from.
  // The waist is 0.16 against a 0.21 chest, which is the ratio that reads as
  // "shoulders" — a straight cylinder reads as a barrel and no amount of
  // shading rescues it.
  const torsoRings = [
    { y: 0.995, rx: 0.182, rz: 0.128, w: 0 },
    { y: 1.080, rx: 0.161, rz: 0.116, w: 0 },
    { y: 1.185, rx: 0.172, rz: 0.121, w: 1 },
    { y: 1.300, rx: 0.198, rz: 0.132, w: 2 },
    { y: 1.400, rx: 0.208, rz: 0.134, w: 2 },
    { y: 1.462, rx: 0.176, rz: 0.120, w: 2, ao: 0.9 },
  ];
  limb(M, torsoRings, (i) => {
    const t = torsoRings[i];
    // blend across the waist so the spine bends rather than hinging
    if (t.w === 0) return bind(B.root, B.spine, i === 1 ? 0.45 : 0.1);
    if (t.w === 1) return bind(B.spine, B.chest, 0.5);
    return bind(B.chest);
  }, (i) => (i <= 1 ? KIT.coatWorn : KIT.coat), D.sides, { capBot: false, capTop: false });

  // --- hood ----------------------------------------------------------------
  // Not a ball on a stick. The rings lean forward through the brow line and
  // sweep back to a point above the crown, so the head reads as a *direction*
  // even from behind — which is the cheapest possible statement of where a
  // figure is looking, and the one that survives to 40 px.
  //
  // The front of the brow and mouth rings is pulled inward by `recess`, cutting
  // a genuine concavity where a face would be. That hollow, not a face, is what
  // the eye reads as a head.
  const hoodRings = [
    { y: 1.430, rx: 0.152, rz: 0.132, cz: 0.004 },
    { y: 1.520, rx: 0.134, rz: 0.138, cz: -0.014 },
    { y: 1.605, rx: 0.126, rz: 0.133, cz: -0.012 },
    { y: 1.690, rx: 0.119, rz: 0.125, cz: -0.004 },
    { y: 1.760, rx: 0.101, rz: 0.108, cz: 0.008 },
    { y: 1.802, rx: 0.062, rz: 0.070, cz: 0.020 },
    { y: 1.818, rx: 0.022, rz: 0.028, cz: 0.030 },
  ];
  const FRONT = -Math.PI / 2;
  // how far round the front an azimuth is, 1 dead ahead falling to 0 by ±60°
  const frontness = (a) => {
    let d = a - FRONT;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.max(0, 1 - Math.abs(d) / 1.05) ** 1.5;
  };
  const hoodGen = (i, j) => {
    const a = (j / D.sides) * Math.PI * 2;
    const t = hoodRings[i];
    // the recess is deepest at the brow and mouth rings and gone by the crown
    const depth = (i === 1 ? 1.0 : i === 2 ? 0.85 : i === 3 ? 0.42 : i === 0 ? 0.35 : 0.0);
    const rec = 1 - frontness(a) * 0.40 * depth;
    return [Math.cos(a) * t.rx * rec, t.y, (t.cz ?? 0) + Math.sin(a) * t.rz * rec];
  };
  const hoodBase = M.grid(hoodGen, hoodRings.length, D.sides, (i, j) => {
    const a = (j / D.sides) * Math.PI * 2;
    const f = frontness(a);
    const inVoid = f > 0.45 && i >= 1 && i <= 3;
    return {
      m: inVoid ? KIT.void : KIT.coat,
      bind: i === 0 ? bind(B.neck, B.head, 0.45) : bind(B.head),
      ao: inVoid ? 0.45 : 1 - f * 0.18,
    };
  }, { wrapJ: true });
  M.cap([0.030, 1.828, 0.030], [0, 1, 0], KIT.coat, bind(B.head),
    hoodBase, D.sides, hoodRings.length - 1, true);

  // --- the collar ----------------------------------------------------------
  // High at the back, falling away at the front, and lined in rust on the
  // inside — the back face rule in the shader means the inside of the collar is
  // lining without a single extra vertex. It is the piece that separates the
  // head from the shoulders in silhouette; without it the hood and the coat
  // merge into one blob from behind, which is exactly what the old figure did.
  const collarArc = [FRONT + 0.62, FRONT + Math.PI * 2 - 0.62];
  const collarGen = (i, j) => {
    const t = j / (D.sides + 2);
    const a = collarArc[0] + (collarArc[1] - collarArc[0]) * t;
    // tall at the back (t ≈ 0.5), low at the two front ends
    const tall = Math.sin(Math.PI * t) ** 0.8;
    const y = 1.408 + i * (0.055 + 0.145 * tall);
    const flare = 1 + i * (0.16 + 0.20 * (1 - tall));
    const rx = 0.170 * flare, rz = 0.126 * flare;
    return [Math.cos(a) * rx, y, Math.sin(a) * rz];
  };
  M.grid(collarGen, 3, D.sides + 3,
    () => ({ m: KIT.coat, bind: bind(B.chest, B.neck, 0.35) }), { flip: 1 });

  // --- the visor -----------------------------------------------------------
  // The whole accent budget, 15 cm wide, at exactly `P.eye`. It sits *inside*
  // the hood's recess, so the hood's own geometry occludes it from above and
  // from the sides and it only reads when the figure is facing you — which is
  // what makes it feel like a look rather than a lamp.
  const visorGen = (i, j) => {
    const t = j / 6;
    const a = FRONT - 0.62 + 1.24 * t;
    const rr = 0.098 - 0.006 * Math.cos((t - 0.5) * Math.PI);
    const y = P.eye + (i - 0.5) * 0.021;
    return [Math.cos(a) * rr, y, Math.sin(a) * rr];
  };
  M.grid(visorGen, 2, 7, () => ({ m: KIT.visor, bind: bind(B.head) }), { flip: -1 });

  // --- arms ----------------------------------------------------------------
  // Sleeved to the wrist, then a gauntlet. The upper arm is bound half to the
  // chest so the deltoid does not tear off the shoulder when the arm swings —
  // the cheapest possible substitute for a real shoulder weight map, and at
  // this size an indistinguishable one.
  for (const s of [1, -1]) {
    const sh = s > 0 ? B.armR : B.armL;
    const el = s > 0 ? B.elbowR : B.elbowL;
    const hd = s > 0 ? B.handR : B.handL;
    const x = s * P.shoulderHalf;
    const upper = [
      { y: P.elbow + 0.012, rx: 0.049, rz: 0.052, cx: x + s * 0.018, cz: 0.012 },
      { y: 1.300, rx: 0.058, rz: 0.060, cx: x + s * 0.010, cz: 0.006 },
      { y: P.shoulder - 0.010, rx: 0.072, rz: 0.074, cx: x, cz: 0 },
      { y: P.shoulder + 0.048, rx: 0.070, rz: 0.070, cx: x - s * 0.006, cz: 0 },
    ];
    limb(M, upper, (i) => (i >= 3 ? bind(sh, B.chest, 0.55) : i === 2 ? bind(sh, B.chest, 0.22) : bind(sh)),
      () => KIT.coat, D.sides, { capBot: false });
    const fore = [
      { y: P.wrist - 0.005, rx: 0.040, rz: 0.042, cx: x + s * 0.030, cz: 0.020 },
      { y: 1.020, rx: 0.046, rz: 0.048, cx: x + s * 0.025, cz: 0.017 },
      { y: P.elbow - 0.004, rx: 0.055, rz: 0.057, cx: x + s * 0.018, cz: 0.012 },
    ];
    limb(M, fore, (i) => (i === 2 ? bind(el, sh, 0.30) : bind(el)),
      () => (s < 0 ? KIT.coat : KIT.suit), D.sides, { capBot: false, capTop: false });
    const hand = [
      { y: P.wrist - 0.175, rx: 0.030, rz: 0.038, cx: x + s * 0.034, cz: 0.030 },
      { y: P.wrist - 0.090, rx: 0.038, rz: 0.048, cx: x + s * 0.032, cz: 0.026 },
      { y: P.wrist + 0.008, rx: 0.043, rz: 0.046, cx: x + s * 0.030, cz: 0.020 },
    ];
    limb(M, hand, () => bind(hd), () => KIT.leather, D.sides);
  }

  // --- the pauldron: asymmetry, and the one bright value ------------------
  // Left shoulder only. A hard bone-ceramic shell over an indigo coat is the
  // single largest value contrast on the figure, and value contrast is what
  // silhouette legibility actually is at 40 px — the shape survives because one
  // corner of it is four stops brighter than the rest, not because the outline
  // is complicated.
  const pauldron = [
    { y: 1.318, rx: 0.052, rz: 0.086, cx: -0.212, cz: 0.004 },
    { y: 1.372, rx: 0.078, rz: 0.106, cx: -0.222, cz: 0.002 },
    { y: 1.432, rx: 0.086, rz: 0.108, cx: -0.226, cz: 0 },
    { y: 1.487, rx: 0.070, rz: 0.092, cx: -0.212, cz: -0.002 },
    { y: 1.520, rx: 0.038, rz: 0.052, cx: -0.192, cz: -0.004 },
  ];
  limb(M, pauldron, () => bind(B.armL, B.chest, 0.45), (i) => (i === 0 ? KIT.strap : KIT.shell), D.sides);

  // --- the strap: the diagonal -------------------------------------------
  // Left shoulder to right hip. One line across the chest is what stops the
  // torso reading as a slab, and it is the piece that tells you which way the
  // figure is facing when the visor is not visible.
  const strapGen = (i, j) => {
    const t = i / 6;
    // a great-circle-ish sweep across the chest, riding the torso's surface
    const y = 1.470 - t * 0.44;
    const a = FRONT - 0.30 - t * 1.15;
    const rr = 1.012 + 0.02 * Math.sin(Math.PI * t);
    const rx = (0.176 + 0.030 * Math.sin(Math.PI * t)) * rr;
    const rz = (0.122 + 0.016 * Math.sin(Math.PI * t)) * rr;
    const w = (j - 0.5) * 0.052;
    return [Math.cos(a) * rx + w * 0.42, y + w * 0.86, Math.sin(a) * rz];
  };
  M.grid(strapGen, 7, 2, (i) => ({
    m: KIT.strap, bind: i < 3 ? bind(B.chest) : bind(B.chest, B.spine, 0.5),
  }), { flip: -1 });

  // --- the satchel: the counterweight -------------------------------------
  const satchel = [
    { y: 0.905, rx: 0.072, rz: 0.048, cx: 0.196, cz: 0.026 },
    { y: 0.985, rx: 0.084, rz: 0.056, cx: 0.202, cz: 0.022 },
    { y: 1.062, rx: 0.070, rz: 0.046, cx: 0.196, cz: 0.018 },
  ];
  limb(M, satchel, () => bind(B.root, B.spine, 0.25),
    (i) => (i === 2 ? KIT.strap : KIT.leather), Math.max(6, D.sides - 3));

  // --- legs ---------------------------------------------------------------
  // Present, and meant to be seen through the coat's front gap. The benchmark
  // meadow is waist-deep, so from any distance most of this is inside the
  // grass — which is exactly why the boot cuff is the widest thing on the leg:
  // it is the part that shows above the sward when the figure is standing in it.
  for (const s of [1, -1]) {
    const hp = s > 0 ? B.hipR : B.hipL;
    const kn = s > 0 ? B.kneeR : B.kneeL;
    const ft = s > 0 ? B.footR : B.footL;
    const x = s * P.hipHalf;
    const thigh = [
      { y: P.knee + 0.010, rx: 0.056, rz: 0.060, cx: x + s * 0.006, cz: 0.006 },
      { y: 0.700, rx: 0.067, rz: 0.072, cx: x + s * 0.004, cz: 0.004 },
      { y: P.hip + 0.030, rx: 0.083, rz: 0.086, cx: x, cz: 0 },
    ];
    limb(M, thigh, (i) => (i === 2 ? bind(hp, B.root, 0.4) : bind(hp)),
      () => KIT.suit, D.sides, { capBot: false, capTop: false });
    const shin = [
      { y: 0.190, rx: 0.056, rz: 0.058, cx: x + s * 0.008, cz: 0.004 },
      { y: 0.300, rx: 0.048, rz: 0.050, cx: x + s * 0.008, cz: 0.006 },
      { y: 0.410, rx: 0.055, rz: 0.058, cx: x + s * 0.007, cz: 0.008 },
      { y: P.knee - 0.006, rx: 0.061, rz: 0.064, cx: x + s * 0.006, cz: 0.006 },
    ];
    limb(M, shin, (i) => (i === 3 ? bind(kn, hp, 0.28) : bind(kn)),
      (i) => (i <= 1 ? KIT.leather : KIT.suit), D.sides, { capBot: false, capTop: false });
    // the boot, and its cuff: the widest thing below the knee
    const boot = [
      { y: 0.012, rx: 0.060, rz: 0.090, cx: x + s * 0.008, cz: -0.026 },
      { y: 0.075, rx: 0.064, rz: 0.098, cx: x + s * 0.008, cz: -0.030 },
      { y: 0.150, rx: 0.062, rz: 0.072, cx: x + s * 0.008, cz: -0.006 },
      { y: 0.205, rx: 0.075, rz: 0.078, cx: x + s * 0.008, cz: 0.002 },
      { y: 0.240, rx: 0.066, rz: 0.070, cx: x + s * 0.008, cz: 0.004 },
    ];
    limb(M, boot, (i) => (i <= 1 ? bind(ft) : i === 2 ? bind(ft, kn, 0.5) : bind(kn)),
      (i) => (i === 3 ? KIT.strap : KIT.leather), D.sides, { capTop: false });
  }

  // --- the coat skirt: the cloth ------------------------------------------
  //
  // An open-fronted panel from the waist to just below the knee. `cloth`
  // registers the block with the update pass, which rewrites every one of these
  // vertices from the wind field each frame; nothing here is skinned.
  //
  // The gap widens as it descends — 0.34 rad at the waist to 0.92 at the hem —
  // so the coat is nearly closed at the belt and opens over the legs. A
  // constant gap reads as a cut-out; a widening one reads as a coat that hangs.
  const coatBase = M.grid((i, j) => {
    const v = i / (D.coatV - 1);
    const u = j / (D.coatU - 1);
    const gap = 0.34 + 0.58 * v ** 1.3;
    const a = FRONT + gap + u * (Math.PI * 2 - 2 * gap);
    const rr = 0.176 + 0.190 * v ** 1.22;
    const y = P.waist - 0.085 - v * 0.660;
    return [Math.cos(a) * rr, y, Math.sin(a) * rr * 1.06];
  }, D.coatV, D.coatU, (i) => ({
    m: i >= D.coatV - 2 ? KIT.coatWorn : KIT.coat,
    bind: bind(B.root),
    ao: 1 - 0.10 * (i / (D.coatV - 1)),
  }), { flip: 1, cloth: { kind: 'coat' } });

  // --- the scarf: the motion read at distance -----------------------------
  //
  // 1.5 m of it, anchored over the pauldron. At 40 px in waist-deep grass the
  // legs are gone, the coat is half gone, and this is the only thing still
  // moving — which is why it is long, why it is the warmest thing in the kit,
  // and why it carries the highest rim and transmission weights in the table.
  M.grid((i, j) => {
    const t = i / (D.scarfN - 1);
    const w = (j / (D.scarfW - 1) - 0.5);
    return [-0.150 + w * 0.10, 1.455 - t * 0.30, 0.02 + t * 0.36];
  }, D.scarfN, D.scarfW, (i) => ({
    m: KIT.scarf, bind: bind(B.chest), ao: 1 - 0.05 * (i / (D.scarfN - 1)),
  }), { flip: 1, cloth: { kind: 'scarf' } });

  // one wisp of variation per traveler, drawn from the seed and nothing else:
  // how far the scarf trails and how worn the coat hem reads (§2.3)
  const scarfLen = 1.28 + r.float(0, 0.34);

  return { M, scarfLen, coatBase };
}

// ---------------------------------------------------------------------------
// the shader
//
// §9.2 imported rather than restated — `PAINT_GLSL` is the light model and
// there is one of it. What this adds is per-vertex stops (so one draw call
// carries nine materials), the back-face lining rule, and the visor.
//
// On fog: there is none, deliberately. §9.3's `fogNear` is 70 m and this object
// is the player — it is never further from the camera than the third-person
// boom, 4.6 m, where the fog fraction is identically zero. Writing `a = 1.0`
// is the correct answer under `AERIAL_ALPHA_IS_CLARITY`: alpha means *clear*,
// and the figure genuinely is.

const FIG_VERT = /* glsl */`
  attribute vec3 aShade;
  attribute vec3 aMid;
  attribute vec3 aLit;
  attribute vec4 aSurf;      // rim, ao, emissive, transmission
  attribute vec3 aRest;      // the rest-pose position — see the note on jit

  varying vec3 vW;
  varying vec3 vN;
  varying vec3 vShade;
  varying vec3 vMid;
  varying vec3 vLit;
  varying vec4 vSurf;
  varying vec3 vRest;

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vW = wp.xyz;
    vN = mat3(modelMatrix) * normal;
    vShade = aShade; vMid = aMid; vLit = aLit; vSurf = aSurf; vRest = aRest;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const figFragment = (shadow) => /* glsl */`
  precision highp float;

  varying vec3 vW;
  varying vec3 vN;
  varying vec3 vShade;
  varying vec3 vMid;
  varying vec3 vLit;
  varying vec4 vSurf;
  varying vec3 vRest;

  uniform vec3 uSunDir;
  uniform vec3 uVisor;
  uniform float uGlow;
  uniform float uWet;

  // the lining: every back face in the figure is the coat's rust interior.
  // Stated once, as a rule, rather than carried as a per-vertex attribute — the
  // only surfaces in the mesh with a visible back face are cloth, and cloth is
  // the only thing that has a lining.
  uniform vec3 uLineShade;
  uniform vec3 uLineMid;
  uniform vec3 uLineLit;

  ${PAINT_GLSL}
  ${shadow}

  void main() {
    vec3 N = normalize(vN);
    vec3 toEye = cameraPosition - vW;
    vec3 V = toEye / max(length(toEye), 1e-4);

    vec3 shade = vShade, mid = vMid, lit = vLit;
    float rim = vSurf.x, trans = vSurf.w;
    if (!gl_FrontFacing) {
      N = -N;
      shade = uLineShade; mid = uLineMid; lit = uLineLit;
      rim = 1.25; trans = max(trans, 0.55);
    }

    Surf sf;
    sf.N = N; sf.V = V; sf.L = uSunDir;
    sf.shade = shade; sf.mid = mid; sf.lit = lit;
    // §9.2's band edges, and §11's warning about them: a PBR reflex widens
    // `soft` until the bands disappear, and the bands are the art direction.
    // 0.085 is soft enough that the edge is drawn rather than stepped, and hard
    // enough that you can see where it is.
    sf.soft = 0.085;
    // the painterly wobble, locked to the REST pose. Keyed to the live position
    // it would crawl across the coat as the body moves, which is the one thing
    // a hand-painted band edge never does.
    sf.jit = (sin(vRest.y * 8.3 + vRest.x * 5.7) + sin(vRest.z * 6.1 - vRest.y * 3.3)) * 0.011;
    sf.shadow = ${shadow ? 'sunShadow(vW, dot(N, uSunDir))' : '1.0'};
    sf.trans = trans; sf.transCol = lit * 1.15;
    sf.rim = rim; sf.ao = vSurf.y; sf.ambient = 1.0;
    vec3 col = paint(sf);

    // wear: dust climbs the coat from the hem, and rain darkens what it lands
    // on. Both keyed to the rest pose, so a coat that has been walked in stays
    // dirty in the same places.
    float dust = smoothstep(0.62, 0.16, vRest.y) * 0.16;
    col = mix(col, col * vec3(1.14, 1.05, 0.86), dust);
    col *= 1.0 - uWet * 0.18 * smoothstep(1.9, 0.4, vRest.y);

    // the accent. It is a light, so it is added rather than mixed, and it is
    // gated on `uGlow` — bright noon does not need a lamp and dusk does.
    col += uVisor * vSurf.z * uGlow;

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// the pose
//
// Every angle below is a function of ONE clock — `walker.stepPhase` — plus the
// body's own velocity state. §6 M4 asks for that in those words, and the reason
// is that a second clock is a thing that can drift: the head bob, the footfall
// audio, the grass the walker parts and now every limb are all reading the same
// number, so a foot cannot land at a different time from the sound of it.

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
/** a bump on the unit circle: the gait curves are all sums of these */
const bump = (u, c, w) => {
  let d = u - c;
  d -= Math.round(d);
  return Math.exp(-(d * d) / (w * w));
};

/**
 * The knee through one stride, as two bumps.
 *
 * A knee does not swing sinusoidally and a sine is instantly readable as wrong:
 * real flexion has a small absorption bump just after heel strike and a large
 * one in mid-swing, with the leg nearly straight at contact. Two Gaussians
 * reproduce that to well inside what a 40-px figure can show, and — unlike a
 * clip — they are continuous in speed, so a walk becomes a run by moving two
 * amplitudes rather than by crossfading two animations that were never
 * measured against each other.
 */
const kneeCurve = (u, run) => bump(u, 0.14, 0.13) * (0.30 + 0.22 * run)
  + bump(u, 0.74, 0.15) * (1.02 + 0.55 * run);

export class Figure {
  /**
   * @param seed the world seed; the kit is fixed but the trailing length of the
   *   scarf and the wear pattern are the traveler's own (§2.3)
   * @param sunDir shared uniform object — the *same* one the sky and terrain
   *   hold, so the figure cannot be lit by yesterday's sun
   */
  constructor({ seed = 1, sunDir, lightFor, shadowGLSL = null, shadowUniforms = null }) {
    this.D = DETAIL[clamp(TIER, 0, 3)];
    const built = buildGeometry(seed, this.D);
    const M = built.M;
    this.scarfLen = built.scarfLen;
    this.nv = M.count;

    // --- static buffers ----------------------------------------------------
    this.rest = new Float32Array(M.rest);
    this.restN = new Float32Array(M.nrm);
    this.bA = new Uint8Array(M.bA);
    this.bB = new Uint8Array(M.bB);
    this.bw = new Float32Array(M.bw);

    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(new Float32Array(M.pos), 3);
    this.nrmAttr = new THREE.BufferAttribute(new Float32Array(M.nrm), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.nrmAttr);
    g.setAttribute('aShade', new THREE.BufferAttribute(new Float32Array(M.shade), 3));
    g.setAttribute('aMid', new THREE.BufferAttribute(new Float32Array(M.mid), 3));
    g.setAttribute('aLit', new THREE.BufferAttribute(new Float32Array(M.lit), 3));
    g.setAttribute('aSurf', new THREE.BufferAttribute(new Float32Array(M.surf), 4));
    g.setAttribute('aRest', new THREE.BufferAttribute(new Float32Array(M.rest), 3));
    g.setIndex(M.idx);
    // The bounding sphere is set by hand and never recomputed. The vertices
    // move every frame and `computeBoundingSphere()` on a moving mesh is both a
    // per-frame cost and a source of culling pop; a 1.6 m sphere around the
    // navel contains every pose the body can reach, including the coat at full
    // billow, so it is simply correct.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.75);
    this.geometry = g;

    const L = lightFor;
    const v3 = (c) => ({ value: new THREE.Vector3(c[0], c[1], c[2]) });
    this.lightU = {
      uPaintSun: v3(L.sun), uPaintAmbSky: v3(L.ambSky),
      uPaintAmbGnd: v3(L.ambGnd), uPaintShadowTint: v3(L.shadowTint),
    };
    this.uGlow = { value: 0.4 };
    this.uWet = { value: 0 };
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...this.lightU,
        ...(shadowUniforms || {}),
        uSunDir: sunDir,
        uVisor: { value: new THREE.Vector3(...KIT.visor.lit).multiplyScalar(2.6) },
        uGlow: this.uGlow,
        uWet: this.uWet,
        uLineShade: v3(KIT.lining.shade),
        uLineMid: v3(KIT.lining.mid),
        uLineLit: v3(KIT.lining.lit),
      },
      vertexShader: FIG_VERT,
      fragmentShader: figFragment(shadowGLSL || ''),
      // Cloth has two sides and the back of it is the lining. Closed solids
      // never show a back face, so this costs the figure nothing it does not
      // spend on purpose.
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = true;

    // --- the skeleton ------------------------------------------------------
    this.bones = BONES.map(([name, parent, x, y, z], i) => {
      const p = parent >= 0 ? BONES[parent] : null;
      return {
        name, parent, i,
        off: new THREE.Vector3(x - (p ? p[2] : 0), y - (p ? p[3] : 0), z - (p ? p[4] : 0)),
        rot: new THREE.Euler(0, 0, 0, 'YXZ'),
        world: new THREE.Matrix4(),
        restInv: new THREE.Matrix4().makeTranslation(x, y, z).invert(),
      };
    });
    this.skin = new Float32Array(BONES.length * 12);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._one = new THREE.Vector3(1, 1, 1);

    // --- cloth blocks ------------------------------------------------------
    this.clothBlocks = M.cloth;
    this.coat = M.cloth.find((c) => c.kind === 'coat');
    this.scarf = M.cloth.find((c) => c.kind === 'scarf');

    // cloth state that has to persist between frames: the scarf's direction is
    // an inertial quantity and the coat's swing lags the body
    this._scarfDir = new THREE.Vector3(0, -0.4, 1).normalize();
    this._hem = new THREE.Vector3();
    this._land = 0;
    this._air = 0;
    this._turn = 0;
    this._prevFace = 0;
    this._t = 0;
  }

  /** the world matrix of a named joint — the lantern hangs off this */
  jointWorld(name, out = new THREE.Vector3()) {
    const b = this.bones[B[name]];
    return out.setFromMatrixPosition(b.world);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }

  /**
   * One frame.
   *
   * `st` is the whole of what the figure knows:
   *   walker  — the M4 controller, or null (the pre-M4 path synthesises a gait)
   *   speed   — horizontal m/s
   *   vel     — world velocity {x,y,z}
   *   face    — the yaw the group is rotated by
   *   wind    — `s.sampleWind()` at hem height
   *   windUp  — the same at shoulder height; the two together *are* the
   *             boundary layer, which is why there are two of them
   *   mode    — 'walk' | 'fly' | 'ride'
   *   sunY    — the sun's elevation sine, for the visor
   */
  update(dt, st) {
    this._t += dt;
    this._pose(dt, st);
    this._solve();
    this._skin();
    this._cloth(dt, st);
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;

    // The visor is a light, and a light is only visible against a dark enough
    // ground. Full at civil twilight, a quarter of that at noon — the same
    // curve the lantern uses, so the two accents rise together.
    const night = 1 - clamp((st.sunY + 0.10) * 3.2, 0, 1);
    this.uGlow.value = 0.22 + 0.95 * night;
    this.uWet.value = st.wet ?? 0;
  }

  /** the light colours, as the sun moves — §9.2's four uniforms */
  setLight(L) {
    this.lightU.uPaintSun.value.set(L.sun[0], L.sun[1], L.sun[2]);
    this.lightU.uPaintAmbSky.value.set(L.ambSky[0], L.ambSky[1], L.ambSky[2]);
    this.lightU.uPaintAmbGnd.value.set(L.ambGnd[0], L.ambGnd[1], L.ambGnd[2]);
    this.lightU.uPaintShadowTint.value.set(L.shadowTint[0], L.shadowTint[1], L.shadowTint[2]);
  }

  // -------------------------------------------------------------- pose ----

  _pose(dt, st) {
    const w = st.walker;
    const bones = this.bones;
    for (const b of bones) b.rot.set(0, 0, 0);

    const spd = st.speed;
    const grounded = w ? w.grounded : true;
    const flying = st.mode === 'fly';
    const riding = st.mode === 'ride';

    // the one clock
    const phase = w ? w.stepPhase : this._t * (0.58 + 0.34 * spd);
    const u = phase - Math.floor(phase);
    const gp = phase * Math.PI * 2;
    // 0 at a standstill, 1 at a walk, and past 1 into a run: the run blend is
    // what moves the amplitudes rather than a state machine
    const gait = clamp(spd / 3.2, 0, 1);
    const run = clamp((spd - 4.2) / 8.0, 0, 1);

    // landing: an impulse fired by the controller's own counter, decaying over
    // a third of a second. Reading `landed` rather than watching `grounded`
    // means the figure absorbs exactly the landings the physics recorded.
    if (w) {
      if (this._landed === undefined) this._landed = w.landed;
      if (w.landed !== this._landed) {
        // how hard: the fall speed at contact, normalised against the jump's own
        this._land = clamp(Math.abs(this._vyPrev ?? 0) / 6.5, 0.25, 1.4);
        this._landed = w.landed;
      }
      this._vyPrev = w.vel.y;
    }
    this._land *= Math.exp(-dt * 5.2);
    this._air += ((grounded || riding ? 0 : 1) - this._air) * clamp(dt * 9, 0, 1);

    // turning: banked into, like anything that carries momentum through a curve
    let dFace = st.face - this._prevFace;
    dFace = Math.atan2(Math.sin(dFace), Math.cos(dFace));
    this._prevFace = st.face;
    this._turn += (clamp(dFace / Math.max(dt, 1e-3), -3, 3) - this._turn) * clamp(dt * 6, 0, 1);

    if (riding) return this._poseRide(st);
    if (flying) return this._poseFly(st, spd);

    // ---- the walk --------------------------------------------------------
    const air = this._air;
    const ground = 1 - air;

    // hips and knees, one leg each, half a cycle apart
    for (const s of [1, -1]) {
      const hip = bones[s > 0 ? B.hipR : B.hipL];
      const knee = bones[s > 0 ? B.kneeR : B.kneeL];
      const foot = bones[s > 0 ? B.footR : B.footL];
      const uu = s > 0 ? u : (u + 0.5) % 1;

      // the thigh: forward at contact, extended at toe-off. Amplitude grows
      // with the run blend, and a forward bias comes with it because a running
      // body's hip is in front of its foot for most of the cycle.
      const swing = (0.40 + 0.42 * run) * gait;
      hip.rot.x = Math.cos(uu * Math.PI * 2) * swing + 0.10 * gait * run;
      // the hip also lists: the pelvis drops a little on the swing side
      hip.rot.z = s * 0.05 * gait * Math.sin(gp);
      knee.rot.x = -kneeCurve(uu, run) * gait;
      // the ankle: dorsiflexed through swing, plantarflexed at toe-off
      foot.rot.x = (bump(uu, 0.52, 0.10) * -0.55 + bump(uu, 0.80, 0.16) * 0.34) * gait;

      // airborne: the legs stop cycling and take a jump shape. Rising, they
      // trail and tuck; falling, they reach. `GAIT.jumpHeight` is 1.45 m at 1 g
      // and the launch speed is held constant across worlds, so on a small moon
      // this pose is on screen for ten seconds and has to be worth looking at.
      const vy = clamp((st.vel?.y ?? 0) / 6.0, -1.2, 1.2);
      const tuck = smooth(0.6, -0.4, vy);           // 0 rising → 1 falling
      const jHip = s > 0 ? (0.62 - 0.95 * tuck) : (-0.30 + 0.42 * tuck);
      const jKnee = s > 0 ? -(1.15 - 0.75 * tuck) : -(0.55 + 0.30 * tuck);
      hip.rot.x = hip.rot.x * ground + jHip * air;
      knee.rot.x = knee.rot.x * ground + jKnee * air;
      foot.rot.x = foot.rot.x * ground + (-0.30 + 0.55 * tuck) * air;
      hip.rot.z *= ground;

      // the landing absorb, on top of everything
      knee.rot.x -= this._land * 0.85;
      hip.rot.x += this._land * 0.42;
      foot.rot.x += this._land * 0.30;

      // idle: weight on one leg, the other soft. A figure standing with both
      // knees locked and both feet square is a mannequin; this is the whole
      // difference and it costs two lines.
      const idle = (1 - gait) * ground;
      hip.rot.x += (s > 0 ? 0.05 : -0.10) * idle;
      knee.rot.x -= (s > 0 ? 0.06 : 0.20) * idle;
      hip.rot.z += s * 0.03 * idle;
    }

    // pelvis: transverse rotation toward the swinging leg, a vertical rise
    // twice per stride, and a lateral shift onto the stance foot
    const root = bones[B.root];
    root.rot.y = 0.10 * gait * Math.cos(gp);
    root.rot.z = -0.055 * gait * Math.sin(gp) - clamp(this._turn * 0.09, -0.22, 0.22);
    root.rot.x = clamp(spd * 0.021, 0, 0.30) + this._land * 0.40 + air * 0.12
      + (w ? w.lean : 0);
    this._rootY = (Math.cos(gp * 2) * 0.018 - 0.018) * gait
      - this._land * 0.13 - air * 0.02;
    this._rootX = 0.030 * gait * Math.sin(gp);

    // spine and chest counter-rotate the pelvis. This is the single cue that
    // separates a walk from a shuffle: shoulders and hips out of phase.
    bones[B.spine].rot.y = -0.11 * gait * Math.cos(gp);
    bones[B.chest].rot.y = -0.12 * gait * Math.cos(gp);
    bones[B.chest].rot.x = -clamp(spd * 0.008, 0, 0.10) + Math.sin((w ? w.breath : this._t) * 1.1) * 0.012;
    bones[B.spine].rot.z = clamp(this._turn * 0.05, -0.12, 0.12);

    // the head holds the horizon. A head that rides the shoulders exactly is
    // the reason cheap walk cycles read as bobbing: real gaze is stabilised, so
    // the neck spends the whole stride cancelling the chest.
    bones[B.neck].rot.y = 0.16 * gait * Math.cos(gp);
    bones[B.head].rot.x = -root.rot.x * 0.55 - this._land * 0.25;
    bones[B.head].rot.y = 0.06 * gait * Math.cos(gp)
      + Math.sin(this._t * 0.21) * 0.10 * (1 - gait);

    // arms counter the legs, and the elbow leads on the forward swing
    for (const s of [1, -1]) {
      const sh = bones[s > 0 ? B.armR : B.armL];
      const el = bones[s > 0 ? B.elbowR : B.elbowL];
      const uu = s > 0 ? u : (u + 0.5) % 1;
      const armSwing = (0.32 + 0.46 * run) * gait;
      sh.rot.x = -Math.cos(uu * Math.PI * 2) * armSwing;
      sh.rot.z = s * (0.13 + 0.07 * run + 0.05 * gait);
      el.rot.x = 0.22 + (0.36 + 0.55 * run) * gait * Math.max(0, -Math.cos(uu * Math.PI * 2))
        + this._land * 0.5;
      // airborne, the arms come up and out — the balance reflex, and it reads
      // as weightlessness from any distance
      sh.rot.x = sh.rot.x * ground + (-0.75 + 0.35 * this._air) * air;
      sh.rot.z = sh.rot.z * ground + s * (0.42 + 0.18) * air;
      el.rot.x = el.rot.x * ground + 0.55 * air;
      // idle: arms hang, one thumb hooked in the strap
      const idle = (1 - gait) * ground;
      sh.rot.x += (s < 0 ? 0.06 : -0.02) * idle;
      el.rot.x += (s < 0 ? 0.55 : 0.16) * idle;
      sh.rot.z += s * 0.02 * Math.sin((w ? w.breath : this._t) * 1.1) * idle;
    }
  }

  /**
   * Flight — `GAIT.flyThrust` against `flyDrag`, so the body has mass and has
   * to be *aimed*. The pose says that: the torso lies along the velocity, the
   * legs trail together, the arms sweep back, and the coat and scarf stream off
   * the whole length of it. A walk cycle held in mid-air would say the opposite.
   */
  _poseFly(st, spd) {
    const bones = this.bones;
    const v = st.vel || { x: 0, y: 0, z: 0 };
    const horiz = Math.hypot(v.x, v.z);
    // how far the body has tipped from standing to lying along its own track
    const commit = clamp(spd / 26, 0, 1);
    const climb = clamp(Math.atan2(v.y, Math.max(horiz, 0.1)), -1.2, 1.2);

    bones[B.root].rot.x = 1.30 * commit - climb * 0.55 * commit;
    bones[B.root].rot.z = -clamp(this._turn * 0.34, -0.5, 0.5);
    this._rootY = 0; this._rootX = 0;
    bones[B.spine].rot.x = 0.10 * commit;
    bones[B.chest].rot.x = 0.08 * commit;
    // the head stays level with the horizon however far the body has tipped —
    // you look where you are going, not where your chest is pointing
    bones[B.head].rot.x = -(1.48 * commit) * 0.72 + climb * 0.30;

    for (const s of [1, -1]) {
      const hip = bones[s > 0 ? B.hipR : B.hipL];
      const knee = bones[s > 0 ? B.kneeR : B.kneeL];
      const foot = bones[s > 0 ? B.footR : B.footL];
      hip.rot.x = -0.30 * commit + (s > 0 ? 0.06 : -0.04);
      hip.rot.z = -s * 0.05 * commit;
      knee.rot.x = -(0.22 + 0.30 * commit) + (s > 0 ? -0.10 : 0.06) * commit;
      foot.rot.x = -0.55 * commit;

      const sh = bones[s > 0 ? B.armR : B.armL];
      const el = bones[s > 0 ? B.elbowR : B.elbowL];
      // arms back and in at speed; out and forward when hovering, because a
      // body with no airspeed has nothing to streamline against
      sh.rot.x = 0.55 * commit - 0.25 * (1 - commit);
      sh.rot.z = s * (0.10 + 0.16 * (1 - commit));
      el.rot.x = 0.18 + 0.40 * (1 - commit);
    }
  }

  /** seated on the skiff: hips and knees folded, hands forward on the helm */
  _poseRide(st) {
    const bones = this.bones;
    this._rootY = 0; this._rootX = 0;
    bones[B.root].rot.x = 0.22;
    bones[B.chest].rot.x = 0.10;
    bones[B.head].rot.x = -0.26;
    for (const s of [1, -1]) {
      bones[s > 0 ? B.hipR : B.hipL].rot.x = 1.28;
      bones[s > 0 ? B.hipR : B.hipL].rot.z = -s * 0.10;
      bones[s > 0 ? B.kneeR : B.kneeL].rot.x = -1.42;
      bones[s > 0 ? B.footR : B.footL].rot.x = 0.28;
      bones[s > 0 ? B.armR : B.armL].rot.x = 0.62;
      bones[s > 0 ? B.armR : B.armL].rot.z = s * 0.18;
      bones[s > 0 ? B.elbowR : B.elbowL].rot.x = 0.72;
    }
  }

  // ------------------------------------------------------------- solve ----

  _solve() {
    const bones = this.bones;
    for (let i = 0; i < bones.length; i++) {
      const b = bones[i];
      this._q.setFromEuler(b.rot);
      const off = b.off;
      // the root carries the gait's own translation: the rise and fall of the
      // centre of mass, and the sway onto the stance foot
      const ox = i === 0 ? off.x + (this._rootX || 0) : off.x;
      const oy = i === 0 ? off.y + (this._rootY || 0) : off.y;
      this._m.compose(new THREE.Vector3(ox, oy, off.z), this._q, this._one);
      if (b.parent >= 0) b.world.multiplyMatrices(bones[b.parent].world, this._m);
      else b.world.copy(this._m);
    }
    // the skin matrix: current world × inverse rest world, flattened to the 3×4
    // affine the inner loop actually uses
    const S = this.skin;
    for (let i = 0; i < bones.length; i++) {
      this._m.multiplyMatrices(bones[i].world, bones[i].restInv);
      const e = this._m.elements;   // column-major
      const o = i * 12;
      S[o] = e[0]; S[o + 1] = e[4]; S[o + 2] = e[8]; S[o + 3] = e[12];
      S[o + 4] = e[1]; S[o + 5] = e[5]; S[o + 6] = e[9]; S[o + 7] = e[13];
      S[o + 8] = e[2]; S[o + 9] = e[6]; S[o + 10] = e[10]; S[o + 11] = e[14];
    }
  }

  /** two-bone linear blend, positions and normals, into the live buffers */
  _skin() {
    const P = this.posAttr.array, N = this.nrmAttr.array;
    const R = this.rest, RN = this.restN, S = this.skin;
    const bA = this.bA, bB = this.bB, bw = this.bw;
    for (let i = 0; i < this.nv; i++) {
      const i3 = i * 3;
      const x = R[i3], y = R[i3 + 1], z = R[i3 + 2];
      const nx = RN[i3], ny = RN[i3 + 1], nz = RN[i3 + 2];
      const a = bA[i] * 12, w = bw[i];
      let px = S[a] * x + S[a + 1] * y + S[a + 2] * z + S[a + 3];
      let py = S[a + 4] * x + S[a + 5] * y + S[a + 6] * z + S[a + 7];
      let pz = S[a + 8] * x + S[a + 9] * y + S[a + 10] * z + S[a + 11];
      let mx = S[a] * nx + S[a + 1] * ny + S[a + 2] * nz;
      let my = S[a + 4] * nx + S[a + 5] * ny + S[a + 6] * nz;
      let mz = S[a + 8] * nx + S[a + 9] * ny + S[a + 10] * nz;
      if (w > 0.0005) {
        const b = bB[i] * 12;
        const qx = S[b] * x + S[b + 1] * y + S[b + 2] * z + S[b + 3];
        const qy = S[b + 4] * x + S[b + 5] * y + S[b + 6] * z + S[b + 7];
        const qz = S[b + 8] * x + S[b + 9] * y + S[b + 10] * z + S[b + 11];
        px += (qx - px) * w; py += (qy - py) * w; pz += (qz - pz) * w;
        mx += (S[b] * nx + S[b + 1] * ny + S[b + 2] * nz - mx) * w;
        my += (S[b + 4] * nx + S[b + 5] * ny + S[b + 6] * nz - my) * w;
        mz += (S[b + 8] * nx + S[b + 9] * ny + S[b + 10] * nz - mz) * w;
      }
      P[i3] = px; P[i3 + 1] = py; P[i3 + 2] = pz;
      const l = Math.hypot(mx, my, mz) || 1;
      N[i3] = mx / l; N[i3 + 1] = my / l; N[i3 + 2] = mz / l;
    }
  }

  // ------------------------------------------------------------- cloth ----

  /**
   * The coat and the scarf, from the one wind field.
   *
   * §6 M3's thesis is that *everything* that moves samples one field — "grass,
   * foliage, dust, spores, **cloth**, water ripple, cloud advection, smoke". The
   * cloth is the entry on that list this file is responsible for, and the field
   * it reads is `s.sampleWind()`, which is `wind.js`'s `windAt()` — the CPU
   * mirror the GPU pass is required to match, and the same reading the wake, the
   * god rays, the rain and the festival lanterns all take.
   *
   * On why this is a CPU sample and the grass is a GPU one: the wind target is
   * 440 m across 256 texels, so a texel is 1.7 m. A coat is 0.6 m wide. Every
   * vertex of it lands in the same texel, so a per-vertex GPU fetch would return
   * the identical value at 200× the cost — the spatial detail the grass needs
   * across a chunk does not exist across a garment. What *is* resolved at this
   * scale is the vertical gradient, which is why the caller passes two samples,
   * hem and shoulder: that pair is the boundary layer, and it is what makes the
   * hem trail while the scarf whips.
   */
  _cloth(dt, st) {
    // the air the cloth actually feels: the wind, minus the body's own motion.
    // Running into still air is a headwind, and a coat knows the difference
    // between that and standing in a gale only by which way the gust front is
    // going — which is exactly what this subtraction preserves.
    const wLow = st.wind || { x: 0, z: 0, speed: 0, gust: 0, front: 0 };
    const wHigh = st.windUp || wLow;
    const v = st.vel || { x: 0, y: 0, z: 0 };
    const cf = Math.cos(-st.face), sf = Math.sin(-st.face);
    const toLocal = (x, z) => [x * cf + z * sf, -x * sf + z * cf];

    const [lx, lz] = toLocal(wLow.x - v.x, wLow.z - v.z);
    const [hx, hz] = toLocal(wHigh.x - v.x, wHigh.z - v.z);
    // a fall is a vertical wind, and it is the thing that makes a long jump on
    // a low-gravity world look like a long jump rather than a hop
    const vy = -(v.y || 0);

    this._coatCloth(dt, st, lx, lz, vy);
    this._scarfCloth(dt, st, hx, hz, vy);

    for (const blk of this.clothBlocks) this._clothNormals(blk);
  }

  _coatCloth(dt, st, wx, wz, vy) {
    const c = this.coat;
    if (!c) return;
    const P = this.posAttr.array;
    const D = this.D;
    const w = st.walker;
    const gait = clamp(st.speed / 3.2, 0, 1);
    const gp = (w ? w.stepPhase : this._t) * Math.PI * 2;
    const FRONTA = -Math.PI / 2;

    // the hem lags the body: a coat does not change direction when you do.
    // One exponential, and it is the whole reason the coat reads as heavy.
    this._hem.x += (wx - this._hem.x) * clamp(dt * 3.4, 0, 1);
    this._hem.z += (wz - this._hem.z) * clamp(dt * 3.4, 0, 1);
    const hx = clamp(this._hem.x * 0.030, -0.34, 0.34);
    const hz = clamp(this._hem.z * 0.030, -0.34, 0.34);
    const air = Math.hypot(this._hem.x, this._hem.z);
    // billow: fast air lifts a hem as well as pushing it
    const lift = clamp(air * 0.016 + Math.max(vy, 0) * 0.020, 0, 0.22);
    const flut = 0.006 + clamp(air * 0.0035, 0, 0.026) + (st.wind?.front ?? 0) * 0.010;

    for (let i = 0; i < c.ni; i++) {
      const vv = i / (c.ni - 1);
      const hinge = vv * vv;                       // the coat swings from the waist
      const gap = 0.34 + 0.58 * vv ** 1.3;
      const rr = 0.176 + 0.190 * vv ** 1.22;
      const y0 = P.length ? (1.080 - 0.085 - vv * 0.660) : 0;
      for (let j = 0; j < c.nj; j++) {
        const uu = j / (c.nj - 1);
        const a = FRONTA + gap + uu * (Math.PI * 2 - 2 * gap);
        const ca = Math.cos(a), sa = Math.sin(a);
        // the panel only feels the air that pushes on its own face; a panel
        // edge-on to the flow is not pushed, it flutters
        const facing = -(ca * this._hem.x + sa * this._hem.z);
        const press = clamp(facing * 0.010, -0.6, 1.0);
        // the travelling ripple, along the azimuth and down the drop
        const rip = Math.sin(a * 3.4 - this._t * 5.6 + vv * 3.1) * flut * hinge * 34;
        // the gait: the front panels part around the leg on that side
        const side = ca > 0 ? 1 : -1;
        const legU = side > 0 ? (w ? w.stepPhase : this._t) : (w ? w.stepPhase : this._t) + 0.5;
        const kick = Math.max(0, Math.cos((legU - Math.floor(legU)) * Math.PI * 2))
          * gait * 0.075 * hinge * Math.max(0, -sa);
        const rad = rr + rip * 0.010 + press * 0.055 * hinge;
        const x = ca * rad + hx * hinge;
        const z = sa * rad * 1.06 + hz * hinge - kick;
        const y = y0 + lift * hinge + Math.sin(gp * 2) * 0.006 * gait * hinge;
        const o = (c.base + i * c.nj + j) * 3;
        P[o] = x; P[o + 1] = y; P[o + 2] = z;
      }
    }
  }

  _scarfCloth(dt, st, wx, wz, vy) {
    const c = this.scarf;
    if (!c) return;
    const P = this.posAttr.array;
    // where it is tied: over the pauldron, at the collar's lip
    const anchor = this.jointWorld('chest');
    const ax = -0.150, ay = 1.455, az = 0.020;

    // the direction it streams. A scarf is nearly massless, so it is almost
    // pure air — but not instantly: the lag is what makes it crack rather than
    // snap, and it is the same exponential shape the hem uses at a faster rate.
    const airSp = Math.hypot(wx, wz, vy);
    const drape = 1 / (1 + airSp * 0.55);          // 1 when still, → 0 in a gale
    const tx = wx * 0.10, ty = vy * 0.10 - 1.35 * drape, tz = wz * 0.10 + 0.35 * drape;
    const tl = Math.hypot(tx, ty, tz) || 1;
    const k = clamp(dt * 5.0, 0, 1);
    this._scarfDir.x += (tx / tl - this._scarfDir.x) * k;
    this._scarfDir.y += (ty / tl - this._scarfDir.y) * k;
    this._scarfDir.z += (tz / tl - this._scarfDir.z) * k;
    this._scarfDir.normalize();

    const seg = this.scarfLen / (c.ni - 1);
    const gait = clamp(st.speed / 3.2, 0, 1);
    let px = ax, py = ay, pz = az;
    let dx = this._scarfDir.x, dy = this._scarfDir.y, dz = this._scarfDir.z;
    for (let i = 0; i < c.ni; i++) {
      const t = i / (c.ni - 1);
      if (i > 0) {
        // gravity pulls the far end down more than the near end, and the wave
        // travels *along* the scarf — the classic ribbon read, and the reason
        // it never looks like a rigid stick
        const sag = -0.9 * drape * (0.25 + t) * 0.5;
        const wob = Math.sin(t * 6.0 - this._t * 7.2) * (0.10 + 0.30 * (1 - drape)) * t;
        dy += sag * 0.30;
        dx += -this._scarfDir.z * wob * 0.5;
        dz += this._scarfDir.x * wob * 0.5;
        const dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl; dy /= dl; dz /= dl;
        px += dx * seg; py += dy * seg; pz += dz * seg;
      }
      // the ribbon's cross section: a side vector perpendicular to the run
      let sx = -dz, sy = 0, sz = dx;
      const sl = Math.hypot(sx, sy, sz) || 1;
      sx /= sl; sz /= sl;
      // it twists as it goes, which is what stops a flat ribbon reading as tape
      const tw = Math.sin(t * 4.2 - this._t * 3.4) * 0.55 * (1 - drape * 0.6);
      const ux = sx * Math.cos(tw), uy = Math.sin(tw) * 0.9, uz = sz * Math.cos(tw);
      const halfW = 0.055 * (1 - t * 0.35);
      for (let j = 0; j < c.nj; j++) {
        const q = (j / (c.nj - 1) - 0.5) * 2;
        const o = (c.base + i * c.nj + j) * 3;
        P[o] = px + ux * halfW * q;
        P[o + 1] = py + uy * halfW * q + Math.sin(gp0(this, gait)) * 0.0;
        P[o + 2] = pz + uz * halfW * q;
      }
    }
    // keep `anchor` referenced: the chest joint is what the scarf is tied to,
    // and reading it here is what will let a future pass hang it off the bone
    // rather than off a constant when the collar gains its own bone.
    void anchor;
  }

  /**
   * Normals for a cloth block, by differencing the grid it was generated from.
   *
   * The same convention the builder uses — `cross(∂P/∂i, ∂P/∂j)` — so a cloth
   * vertex and a skinned vertex agree about which way is out, which they must,
   * because the hem meets the coat's own back face along a shared silhouette.
   */
  _clothNormals(blk) {
    const P = this.posAttr.array, N = this.nrmAttr.array;
    const { base, ni, nj, flip } = blk;
    const at = (i, j) => (base + i * nj + j) * 3;
    for (let i = 0; i < ni; i++) {
      for (let j = 0; j < nj; j++) {
        const i0 = at(Math.max(i - 1, 0), j), i1 = at(Math.min(i + 1, ni - 1), j);
        const j0 = at(i, Math.max(j - 1, 0)), j1 = at(i, Math.min(j + 1, nj - 1));
        const ux = P[i1] - P[i0], uy = P[i1 + 1] - P[i0 + 1], uz = P[i1 + 2] - P[i0 + 2];
        const vx = P[j1] - P[j0], vy = P[j1 + 1] - P[j0 + 1], vz = P[j1 + 2] - P[j0 + 2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        const o = at(i, j);
        N[o] = flip * nx / l; N[o + 1] = flip * ny / l; N[o + 2] = flip * nz / l;
      }
    }
  }
}

// a tiny helper kept out of the hot loop's way; the scarf's vertical wobble is
// carried by the chain rather than by the cross section, so this is zero today
// and exists so the term has a name if it is ever wanted
function gp0() { return 0; }
