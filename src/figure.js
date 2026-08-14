// The traveler's body — CLAUDE.md §4, §8 axis 1, §9.2.
//
// What was here before is four primitives: a cone, a sphere, a smaller cone and
// a plane, assembled into "a small cloaked figure". It has always been a
// placeholder. This file is the figure.
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
// hat and a squint you cannot see. Samus is a shape. Vader is a shape. Ashitaka
// is a red cloak on a red elk. Every one is recognisable at thumbnail size, in
// pure black, from behind — which is the definition of a silhouette. §8's first
// axis asks that question of everything in the frame; this file answers it.
//
// So the ruling this file is built on:
//
//   **Coolness is carried by silhouette, proportion, stance, gait and material.
//   Not by a face.** There is no face here — the hood holds a shadow void with
//   one horizontal light in it. That is a stronger read at 40 px than any face
//   could be, it is the only read that survives §2.1's zero-asset rule, and it
//   is what §4 was protecting in the first place.
//
// The reference frames supplied for this milestone make the same argument from
// the other end: their blossom tree reads entirely as a shape against a bright
// sky, with no interior detail at all. The figure has to survive standing in
// that, in grass that comes up past its hips.
//
// ---------------------------------------------------------------------------
// The four things the silhouette is built out of
//
// 1. **True human proportion — 7.5 heads, 1.80 m to the crown.** Not a stylistic
//    choice: `avatar.js` puts the eye at 1.68 m and the whole world is scaled to
//    that number. A figure of any other height makes the scale reference lie,
//    and §8 axis 8 fails on a frame where a person is the ruler and the ruler is
//    wrong. Every landmark in `P` below is measured off it, and the visor sits
//    at exactly 1.68 m — so the third-person figure's eye and the first-person
//    camera are the same height, and pressing C proves it.
//
// 2. **One heavy diagonal.** A left pauldron, a strap from that shoulder to the
//    opposite hip, a satchel on the right hip, a scarf off the left shoulder.
//    Nothing mirrors. A bilaterally symmetric figure reads as a mannequin from
//    every angle; one strong diagonal reads as a person who packed.
//
// 3. **A long coat, open at the front.** The coat is the mass — it is what makes
//    the shoulders wide, the waist narrow and the hem heavy. Open at the front
//    so the legs show through the gap: a closed skirt hides the gait, and the
//    gait is half of what says "person" at distance. It is also the surface the
//    wind acts on, which is §6 M3's thesis given a body to happen to.
//
// 4. **One cold accent in a warm world.** A 15 cm horizontal light inside the
//    hood. §8 axis 6 budgets three hue families plus one accent; the kit spends
//    them as violet-indigo (coat, suit, boots), bone-cream (pauldron) and rust
//    (scarf, lining, straps), and the visor is the accent. It dims at noon and
//    burns at dusk, so it is a *reading light* rather than a decal.
//
// ---------------------------------------------------------------------------
// Why the geometry is skinned on the CPU
//
// About 1100 vertices, seventeen bones, one draw call. The bone matrices are
// solved in JS and the vertices are transformed in JS into a preallocated
// buffer, rather than uploading bone matrices and skinning in the vertex shader.
//
// Three reasons, in order of weight:
//
//   · **The shadow pass gets it for free.** `shadow.js` renders casters under an
//     override material. A GPU-skinned mesh under an override material draws in
//     its rest pose — a T-posed shadow under a running figure — and fixing that
//     means a second skinned depth material kept permanently in step with the
//     first. Baked positions have no rest pose to fall back to.
//
//   · **Cloth is not skinning.** The coat hem and the scarf are not driven by
//     bones at all; they are driven by the wind field, the body's velocity and
//     the gait clock, and they have to be *generated*, not transformed. Once
//     half the mesh is written from the CPU every frame, the other half may as
//     well be, and then there is one code path rather than two that disagree.
//
//   · It is free. 1100 vertices × two bone influences is roughly 70 k flops a
//     frame against §5's 12 ms CPU budget. The meadow uploads two orders of
//     magnitude more than this every frame without anyone noticing.
//
// ---------------------------------------------------------------------------
// Determinism (§2.3)
//
// No `Math.random`, no clock. The mesh is a pure function of the seed; the pose
// is a pure function of the walker's state, `dt` and the wind field, all three
// of which are themselves deterministic. `?dt=` pins the figure exactly the way
// it pins the body.

import * as THREE from 'three';
import { RNG, hash } from './rng.js';
import { PAINT_GLSL } from './paint.js';
import { TIER } from './quality.js';
import { legPlant, solveLeg } from './avatar.js';

// ---------------------------------------------------------------------------
// proportion
//
// The canonical 7.5-head figure, in metres, with the eye pinned to `GAIT.eye`.
// A head is 1.80 / 7.5 = 0.24 m, which is a real head; the eye sits half a head
// below the crown, which is where a real eye sits; and 1.80 − 0.12 = 1.68 is
// `GAIT.eye` to the digit. The table exists so that identity holds exactly
// rather than approximately.

export const STATURE = 1.80;          // crown, metres
export const HEAD = STATURE / 7.5;    // 0.24 m

export const P = {
  crown: STATURE,             // 1.800
  eye: STATURE - HEAD * 0.5,  // 1.680 — GAIT.eye, and the visor line
  chin: STATURE - HEAD,       // 1.560
  shoulder: 1.455,            // acromion: head + neck is about 1.4 heads
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
// A seed-derived kit would make the traveler a different person on every planet,
// and the traveler is the one thing in AEON that is the same across all 10²⁸ of
// them. The pigments are fixed; the *light* on them is entirely seed-derived,
// because `paint()`'s four light colours come from this world's own star through
// `starlight.js`. Same coat, different sun — which is what wearing a coat across
// a galaxy actually looks like.
//
// Each entry is a §9.2 three-stop hue *path*, not a lightness ramp: the shade
// stop is cooler and more violet than the mid, and the lit stop is warmer and
// desaturated toward the sky. That is what the ramp exists to walk along, and a
// ramp between three points on one line through one colour is the specific
// mistake `surface.js` documents as having flattened the terrain.

const hexLin = (h) => [1, 3, 5].map((i) => {
  const c = parseInt(h.slice(i, i + 2), 16) / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
});

/**
 * A material: three stops plus the four per-surface terms §9.2 takes.
 *
 * `rim` is the backlight weight. The reference annotates the rim as "the
 * connective tissue of the whole image", and on a dark figure standing against
 * a bright sky it is very nearly the entire read. Cloth gets the most of it;
 * hard shell gets less, because a ceramic edge does not glow.
 *
 * `ao` is baked cavity occlusion. There is no shadow map in the default build
 * (`?paint=` is off, for reasons `surface.js` sets out at length), so this
 * number is the only thing telling the eye that the inside of a hood is deeper
 * than the outside of it.
 */
const mat = (shade, mid, lit, { rim = 1.0, ao = 1.0, emis = 0, trans = 0 } = {}) => ({
  shade: hexLin(shade), mid: hexLin(mid), lit: hexLin(lit), rim, ao, emis, trans,
});

// ---------------------------------------------------------------------------
// On the values below, which are two stops darker than the first pass
//
// The first version of this table was built by eye, as a coat one would want to
// own. Captured at 17 m against this world's ground it was a **pale smudge the
// same value as the meadow** — no silhouette at all, which is §8 axis 1 scoring
// 2 and the benchmark's whole argument lost. Three causes, all in this file:
//
//   · §9.7 forces spawn into an 8–18° sun and §9.2's half-Lambert wrap maps the
//     entire lit hemisphere into 0.46–1.0. Above the ramp's upper edge at 0.58
//     everything resolves to the `lit` stop — so on a figure standing in open
//     sun, `lit` is not an accent, it is *most of the body*. A `lit` stop chosen
//     as "indigo in sunlight" has to be chosen as "the colour of the whole
//     coat", and #8B95BA is a colour a coat is never any part of.
//
//   · The rim was weighted 1.30. `pow(1 − dot(N,V), 4.2)` is large within about
//     20° of the silhouette edge, which at thirty metres is the entire figure —
//     so the term that exists to *draw* an edge was filling the shape.
//
//   · `paint()`'s hemispheric fill and sun gain both add, and neither subtracts.
//
// So: every stop down in value and up in chroma, the rims cut by roughly half,
// and a distance term in the shader that collapses the ramp toward `shade` (see
// `figFragment`). The pauldron is the one thing that stays bright, because it is
// the value contrast the silhouette is legible by.

export const KIT = {
  // the coat — deep indigo. Dark enough to read as a silhouette against a lit
  // sky, violet enough that §9.2's shadow blend never lands on grey.
  coat: mat('#10142A', '#1E2A50', '#4A5C90', { rim: 0.55 }),
  coatWorn: mat('#0D1124', '#1A2547', '#415282', { rim: 0.48, ao: 0.92 }),
  // the suit under it
  suit: mat('#0C0E18', '#161A2C', '#333A58', { rim: 0.45 }),
  // boots and gauntlets. Note the violet bias in the shade stop: leather this
  // dark is exactly where an achromatic black creeps in, and §M2's gate calls a
  // shadowed surface that has gone achromatic-dark a failure in those words.
  leather: mat('#0A0B12', '#141626', '#2C3048', { rim: 0.35, ao: 0.94 }),
  // the pauldron — bone ceramic. The one bright value on the figure, and the
  // reason the shoulder line survives at 40 px against a dark coat. Everything
  // else got darker; this deliberately did not.
  shell: mat('#514F46', '#9C957E', '#E8DCBC', { rim: 0.40 }),
  strap: mat('#1C130D', '#3A2718', '#6E5133', { rim: 0.40 }),
  // the scarf. Cloth, so it transmits: §9.2's subsurface term is what makes a
  // backlit scarf glow along its trailing edge instead of going flat.
  scarf: mat('#33100C', '#7A2417', '#C05334', { rim: 0.85, trans: 0.85 }),
  // the coat's lining, seen when the hem lifts or a panel blows open — and seen
  // on every back face, which is the rule the shader states once.
  lining: mat('#260C09', '#5C1D13', '#96432A', { rim: 0.60, trans: 0.55 }),
  // the void inside the hood. Dark, and never neutral.
  hollow: mat('#080914', '#0E101E', '#161A2A', { rim: 0.12, ao: 0.34 }),
  // the accent
  visor: mat('#123040', '#2E6E88', '#A8ECFF', { rim: 0.40, emis: 1 }),
};

// ---------------------------------------------------------------------------
// the coat's hanging shape
//
// Shared by the builder and by the cloth update, because they are the same
// surface and the first version wrote it out twice. Two copies of a
// parameterisation is exactly the drift §2.7 legislates against one scale up:
// change the flare in one and the rest pose and the live pose describe two
// different coats, and the seam between them lights wrong.

const COAT = {
  top: P.waist - 0.085,   // 0.995 — where the skirt leaves the torso
  drop: 0.640,            // hem at 0.355, a hand above the boot cuff
  r0: 0.176,
  flare: 0.250,           // 0.85 m across at the hem: the mass of the figure
  gap0: 0.34,             // nearly closed at the belt…
  gap1: 0.58,             // …and wide open over the legs
};

function coatRest(v, u) {
  const gap = COAT.gap0 + COAT.gap1 * v ** 1.3;
  return {
    a: FRONT + gap + u * (Math.PI * 2 - 2 * gap),
    r: COAT.r0 + COAT.flare * v ** 1.15,
    y: COAT.top - v * COAT.drop,
  };
}

// ---------------------------------------------------------------------------
// the skeleton
//
// Seventeen bones. Rest positions are absolute in figure space (+Y up, −Z
// forward, +X the figure's right, matching `traveler.js`'s `_face` convention);
// the constructor converts them to parent-relative offsets, so this table can be
// read straight off the proportion table rather than as a chain of deltas
// nobody can check against a body.

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
export const BONE = B;

// ---------------------------------------------------------------------------
// detail rows (§5)
//
// Its own small table rather than a column in `quality.js`, because the figure
// is one object and a column there is a promise made to every scale. One row
// change still reconfigures the whole figure, which is the shape §5 asks for.

const DETAIL = [
  { sides: 7, coatU: 13, coatV: 5, scarfN: 11, scarfW: 3 },  // low
  { sides: 8, coatU: 15, coatV: 6, scarfN: 13, scarfW: 3 },  // mobile
  { sides: 10, coatU: 19, coatV: 7, scarfN: 14, scarfW: 4 }, // desktop
  { sides: 12, coatU: 23, coatV: 8, scarfN: 17, scarfW: 4 }, // ultra
];

const FRONT = -Math.PI / 2;        // the azimuth the figure faces
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------------------
// the builder
//
// One primitive: a parametric grid. Everything — a limb, the hood, the coat, the
// scarf, a strap — is a function G(i, j) sampled over a rectangle, with normals
// taken analytically from the generator's own tangents.
//
// Taking the normal from the parameterisation rather than by accumulating face
// normals is not a micro-optimisation, it is what makes the winding *provable*.
// Fix the convention once — n = normalize(cross(∂G/∂i, ∂G/∂j)), and emit the
// triangle (i,j)→(i+1,j)→(i+1,j+1), whose own edge cross product is that same
// expression — and every surface in the figure is outward-facing by
// construction. Accumulated normals give no such guarantee, and one inverted
// normal reads as a lighting bug three files away from where it was made.

class Mesh {
  constructor() {
    this.pos = []; this.nrm = []; this.rest = [];
    this.shade = []; this.mid = []; this.lit = []; this.surf = [];
    this.bA = []; this.bB = []; this.bw = [];
    this.idx = [];
    this.cloth = [];
  }

  get count() { return this.pos.length / 3; }

  vert(p, n, m, bind, ao = 1) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.rest.push(p[0], p[1], p[2]);
    this.shade.push(m.shade[0], m.shade[1], m.shade[2]);
    this.mid.push(m.mid[0], m.mid[1], m.mid[2]);
    this.lit.push(m.lit[0], m.lit[1], m.lit[2]);
    this.surf.push(m.rim, m.ao * ao, m.emis, m.trans);
    this.bA.push(bind[0]); this.bB.push(bind[1]); this.bw.push(bind[2]);
  }

  /**
   * Sample `gen(i, j)` over an (ni × nj) grid and emit it.
   *
   * `wrap` closes the ring (a limb, a torso); without it the sheet has two free
   * edges (a coat panel, a strap). `flip` reverses the normal and the winding
   * *together*, which is the only way to reverse either of them safely.
   */
  grid(gen, ni, nj, at, { wrap = false, flip = 1, cloth = null } = {}) {
    const base = this.count;
    const G = [];
    for (let i = 0; i < ni; i++) {
      G.push([]);
      for (let j = 0; j < nj; j++) G[i].push(gen(i, j));
    }
    for (let i = 0; i < ni; i++) {
      for (let j = 0; j < nj; j++) {
        const a = G[Math.max(i - 1, 0)][j], b = G[Math.min(i + 1, ni - 1)][j];
        const jm = wrap ? (j - 1 + nj) % nj : Math.max(j - 1, 0);
        const jp = wrap ? (j + 1) % nj : Math.min(j + 1, nj - 1);
        const c = G[i][jm], d = G[i][jp];
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = d[0] - c[0], vy = d[1] - c[1], vz = d[2] - c[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx = flip * nx / l; ny = flip * ny / l; nz = flip * nz / l;
        const s = at(i, j);
        this.vert(G[i][j], [nx, ny, nz], s.m, s.bind, s.ao ?? 1);
      }
    }
    const jMax = wrap ? nj : nj - 1;
    for (let i = 0; i < ni - 1; i++) {
      for (let j = 0; j < jMax; j++) {
        const j2 = (j + 1) % nj;
        const a = base + i * nj + j, b = base + (i + 1) * nj + j;
        const c = base + (i + 1) * nj + j2, d = base + i * nj + j2;
        if (flip > 0) this.idx.push(a, b, c, a, c, d);
        else this.idx.push(a, c, b, a, d, c);
      }
    }
    if (cloth) this.cloth.push({ ...cloth, base, ni, nj, flip });
    return base;
  }

  /** a fan cap over row `row` of a grid emitted at `base` with `cols` columns */
  cap(centre, n, m, bind, base, cols, row, up) {
    const c = this.count;
    this.vert(centre, n, m, bind);
    for (let j = 0; j < cols; j++) {
      const a = base + row * cols + j, b = base + row * cols + (j + 1) % cols;
      if (up) this.idx.push(c, b, a); else this.idx.push(c, a, b);
    }
  }
}

/** a stack of elliptical rings, closed around the Y axis: every limb, and the torso */
function limb(M, rings, bindOf, matOf, sides, { capTop = true, capBot = true } = {}) {
  const gen = (i, j) => {
    const a = (j / sides) * Math.PI * 2;
    const r = rings[i];
    return [(r.cx ?? 0) + Math.cos(a) * r.rx, r.y, (r.cz ?? 0) + Math.sin(a) * r.rz];
  };
  const base = M.grid(gen, rings.length, sides,
    (i) => ({ m: matOf(i), bind: bindOf(i), ao: rings[i].ao ?? 1 }), { wrap: true });
  const n = rings.length;
  if (capTop) {
    const t = rings[n - 1];
    M.cap([t.cx ?? 0, t.y + t.rx * 0.35, t.cz ?? 0], [0, 1, 0], matOf(n - 1),
      bindOf(n - 1), base, sides, n - 1, true);
  }
  if (capBot) {
    const t = rings[0];
    M.cap([t.cx ?? 0, t.y - t.rx * 0.35, t.cz ?? 0], [0, -1, 0], matOf(0),
      bindOf(0), base, sides, 0, false);
  }
  return base;
}

// ---------------------------------------------------------------------------
// the figure, assembled
//
// Read what follows as a description of a person rather than as geometry. Every
// number is either the proportion table or a decision about what the shape says,
// and the ones that are decisions say so.

function buildGeometry(seed, D) {
  const M = new Mesh();
  const rng = new RNG(hash(seed, 0x1f16e));
  const bind = (a, b = a, w = 0) => [a, b, w];

  // --- torso ---------------------------------------------------------------
  // The coat *is* the torso: a coat over a chest is one silhouette, and
  // modelling them separately buys nothing at any distance this is ever seen
  // from. The waist is 0.161 against a 0.208 chest — that ratio is what reads as
  // "shoulders", and a straight cylinder reads as a barrel no matter how it is
  // shaded. The top ring collapses to 0.120 so the hood swallows it.
  const torso = [
    { y: 0.995, rx: 0.182, rz: 0.128 },
    { y: 1.080, rx: 0.161, rz: 0.116 },
    { y: 1.185, rx: 0.172, rz: 0.121 },
    { y: 1.300, rx: 0.198, rz: 0.132 },
    { y: 1.400, rx: 0.208, rz: 0.134 },
    { y: 1.470, rx: 0.120, rz: 0.100, ao: 0.9 },
  ];
  limb(M, torso, (i) => {
    if (i <= 1) return bind(B.root, B.spine, i === 1 ? 0.45 : 0.10);
    if (i === 2) return bind(B.spine, B.chest, 0.5);
    return bind(B.chest);
  }, (i) => (i <= 1 ? KIT.coatWorn : KIT.coat), D.sides);

  // --- hood ----------------------------------------------------------------
  // Not a ball on a stick. The rings lean forward through the brow and sweep
  // back to a point above the crown, so the head reads as a *direction* even
  // from behind — the cheapest possible statement of where a figure is looking,
  // and the one that survives to 40 px.
  //
  // The front of the brow and mouth rings is pulled inward by `rec`, cutting a
  // genuine concavity where a face would be. That hollow, not a face, is what
  // the eye reads as a head — and it is §4's clause satisfied by construction
  // rather than by restraint.
  const hood = [
    { y: 1.430, rx: 0.152, rz: 0.132, cz: 0.004 },
    { y: 1.520, rx: 0.134, rz: 0.138, cz: -0.014 },
    { y: 1.605, rx: 0.126, rz: 0.133, cz: -0.012 },
    { y: 1.690, rx: 0.119, rz: 0.125, cz: -0.004 },
    { y: 1.760, rx: 0.101, rz: 0.108, cz: 0.008 },
    { y: 1.802, rx: 0.062, rz: 0.070, cz: 0.020 },
    { y: 1.818, rx: 0.022, rz: 0.028, cz: 0.030 },
  ];
  // how far round the front an azimuth is: 1 dead ahead, 0 by ±60°
  const frontness = (a) => {
    const d = Math.atan2(Math.sin(a - FRONT), Math.cos(a - FRONT));
    return Math.max(0, 1 - Math.abs(d) / 1.05) ** 1.5;
  };
  const hoodDepth = [0.35, 1.0, 0.85, 0.42, 0, 0, 0];
  const hoodBase = M.grid((i, j) => {
    const a = (j / D.sides) * Math.PI * 2;
    const t = hood[i];
    const rec = 1 - frontness(a) * 0.40 * hoodDepth[i];
    return [Math.cos(a) * t.rx * rec, t.y, t.cz + Math.sin(a) * t.rz * rec];
  }, hood.length, D.sides, (i, j) => {
    const a = (j / D.sides) * Math.PI * 2;
    const f = frontness(a);
    const inVoid = f > 0.45 && i >= 1 && i <= 3;
    return {
      m: inVoid ? KIT.hollow : KIT.coat,
      bind: i === 0 ? bind(B.neck, B.head, 0.45) : bind(B.head),
      ao: inVoid ? 0.45 : 1 - f * 0.18,
    };
  }, { wrap: true });
  M.cap([0.030, 1.828, 0.030], [0, 1, 0], KIT.coat, bind(B.head),
    hoodBase, D.sides, hood.length - 1, true);

  // --- the collar ----------------------------------------------------------
  // High at the back, falling away at the front, rust on the inside — the back
  // face rule in the shader gives it a lining without a single extra vertex.
  // Its job is to separate the head from the shoulders in silhouette; without
  // it the hood and the coat merge into one blob from behind, which is exactly
  // what the figure it replaces did from every angle.
  const cA0 = FRONT + 0.62, cA1 = FRONT + Math.PI * 2 - 0.62;
  M.grid((i, j) => {
    const t = j / (D.sides + 2);
    const a = cA0 + (cA1 - cA0) * t;
    const tall = Math.sin(Math.PI * t) ** 0.8;
    const y = 1.408 + i * (0.055 + 0.145 * tall);
    const flare = 1 + i * (0.16 + 0.20 * (1 - tall));
    return [Math.cos(a) * 0.170 * flare, y, Math.sin(a) * 0.126 * flare];
  }, 3, D.sides + 3, () => ({ m: KIT.coat, bind: bind(B.chest, B.neck, 0.35) }));

  // --- the visor -----------------------------------------------------------
  // The entire accent budget, 15 cm wide, at exactly `P.eye`. It sits *inside*
  // the hood's recess, so the hood occludes it from above and from the sides and
  // it only reads when the figure is turned toward you — which is what makes it
  // feel like a look rather than a lamp.
  M.grid((i, j) => {
    const t = j / 6;
    const a = FRONT - 0.62 + 1.24 * t;
    const rr = 0.098 - 0.006 * Math.cos((t - 0.5) * Math.PI);
    return [Math.cos(a) * rr, P.eye + (i - 0.5) * 0.021, Math.sin(a) * rr];
  }, 2, 7, () => ({ m: KIT.visor, bind: bind(B.head) }));

  // --- arms ----------------------------------------------------------------
  // Sleeved to the wrist, then a gauntlet. The top of the upper arm is bound
  // half to the chest so the deltoid does not tear off the shoulder when the arm
  // swings — the cheapest possible substitute for a real shoulder weight map,
  // and at this size an indistinguishable one.
  for (const s of [1, -1]) {
    const sh = s > 0 ? B.armR : B.armL;
    const el = s > 0 ? B.elbowR : B.elbowL;
    const hd = s > 0 ? B.handR : B.handL;
    const x = s * P.shoulderHalf;
    limb(M, [
      { y: P.elbow + 0.012, rx: 0.049, rz: 0.052, cx: x + s * 0.018, cz: 0.012 },
      { y: 1.300, rx: 0.058, rz: 0.060, cx: x + s * 0.010, cz: 0.006 },
      { y: P.shoulder - 0.010, rx: 0.072, rz: 0.074, cx: x, cz: 0 },
      { y: P.shoulder + 0.048, rx: 0.068, rz: 0.068, cx: x - s * 0.006, cz: 0 },
    ], (i) => (i >= 3 ? bind(sh, B.chest, 0.55) : i === 2 ? bind(sh, B.chest, 0.22) : bind(sh)),
    () => KIT.coat, D.sides, { capBot: false });
    limb(M, [
      { y: P.wrist - 0.005, rx: 0.040, rz: 0.042, cx: x + s * 0.030, cz: 0.020 },
      { y: 1.020, rx: 0.046, rz: 0.048, cx: x + s * 0.025, cz: 0.017 },
      { y: P.elbow + 0.020, rx: 0.056, rz: 0.058, cx: x + s * 0.017, cz: 0.011 },
    ], (i) => (i === 2 ? bind(el, sh, 0.30) : bind(el)),
    (i) => (i === 2 ? KIT.coat : KIT.suit), D.sides, { capBot: false, capTop: false });
    limb(M, [
      { y: P.wrist - 0.175, rx: 0.030, rz: 0.038, cx: x + s * 0.034, cz: 0.030 },
      { y: P.wrist - 0.090, rx: 0.038, rz: 0.048, cx: x + s * 0.032, cz: 0.026 },
      { y: P.wrist + 0.012, rx: 0.045, rz: 0.048, cx: x + s * 0.029, cz: 0.019 },
    ], () => bind(hd), () => KIT.leather, D.sides);
  }

  // --- the pauldron: the asymmetry, and the one bright value ---------------
  // Left shoulder only. A hard bone-ceramic shell over an indigo coat is the
  // largest value contrast on the figure, and value contrast is what silhouette
  // legibility *is* at 40 px — the shape survives because one corner of it is
  // four stops brighter than the rest, not because the outline is complicated.
  // It is a *shell*, not a ball: the first pass read as a sphere on a shoulder
  // because the widest ring was the middle one and every ring was round. A
  // pauldron is a plate that flares out and *down* over the deltoid and stops on
  // a hard lip, so the widest ring is low, the sections are ovals wider
  // front-to-back than across, and the bottom ring is a dark strap that reads as
  // the edge the plate ends on.
  limb(M, [
    { y: 1.288, rx: 0.046, rz: 0.078, cx: -0.204, cz: 0.004 },
    { y: 1.332, rx: 0.084, rz: 0.112, cx: -0.232, cz: 0.002 },
    { y: 1.396, rx: 0.098, rz: 0.118, cx: -0.240, cz: 0 },
    { y: 1.456, rx: 0.088, rz: 0.104, cx: -0.226, cz: -0.002 },
    { y: 1.508, rx: 0.060, rz: 0.076, cx: -0.200, cz: -0.004 },
    { y: 1.534, rx: 0.026, rz: 0.036, cx: -0.184, cz: -0.004 },
  ], () => bind(B.armL, B.chest, 0.45), (i) => (i === 0 ? KIT.strap : KIT.shell), D.sides);

  // --- the strap: the diagonal --------------------------------------------
  // Left shoulder to right hip. One line across the chest is what stops the
  // torso reading as a slab, and it is what tells you which way the figure is
  // facing on every frame where the visor is not in view.
  M.grid((i, j) => {
    const t = i / 6;
    const a = FRONT - 0.30 - t * 1.15;
    const bulge = 1.012 + 0.02 * Math.sin(Math.PI * t);
    const rx = (0.176 + 0.030 * Math.sin(Math.PI * t)) * bulge;
    const rz = (0.122 + 0.016 * Math.sin(Math.PI * t)) * bulge;
    const w = (j - 0.5) * 0.052;
    return [Math.cos(a) * rx + w * 0.42, 1.470 - t * 0.44 + w * 0.86, Math.sin(a) * rz];
  }, 7, 2, (i) => ({
    m: KIT.strap, bind: i < 3 ? bind(B.chest) : bind(B.chest, B.spine, 0.5),
  }), { flip: -1 });

  // --- the satchel: the counterweight --------------------------------------
  limb(M, [
    { y: 0.905, rx: 0.072, rz: 0.048, cx: 0.196, cz: 0.026 },
    { y: 0.985, rx: 0.084, rz: 0.056, cx: 0.202, cz: 0.022 },
    { y: 1.062, rx: 0.070, rz: 0.046, cx: 0.196, cz: 0.018 },
  ], () => bind(B.root, B.spine, 0.25),
  (i) => (i === 2 ? KIT.strap : KIT.leather), Math.max(6, D.sides - 3));

  // --- legs ----------------------------------------------------------------
  // Present, and meant to be seen through the coat's front gap. The benchmark
  // meadow is waist-deep, so from most distances most of this is inside the
  // grass — which is precisely why the boot cuff is the widest thing on the leg.
  // It is the part that shows above the sward when the figure stands in it.
  for (const s of [1, -1]) {
    const hp = s > 0 ? B.hipR : B.hipL;
    const kn = s > 0 ? B.kneeR : B.kneeL;
    const ft = s > 0 ? B.footR : B.footL;
    const x = s * P.hipHalf;
    limb(M, [
      { y: P.knee + 0.010, rx: 0.056, rz: 0.060, cx: x + s * 0.006, cz: 0.006 },
      { y: 0.700, rx: 0.067, rz: 0.072, cx: x + s * 0.004, cz: 0.004 },
      { y: P.hip + 0.030, rx: 0.083, rz: 0.086, cx: x, cz: 0 },
    ], (i) => (i === 2 ? bind(hp, B.root, 0.4) : bind(hp)),
    () => KIT.suit, D.sides, { capBot: false, capTop: false });
    // the shin's top ring stands *above* the thigh's last one, so the sleeve
    // swallows the joint rather than leaving an annulus you can see through
    limb(M, [
      { y: 0.190, rx: 0.056, rz: 0.058, cx: x + s * 0.008, cz: 0.004 },
      { y: 0.300, rx: 0.048, rz: 0.050, cx: x + s * 0.008, cz: 0.006 },
      { y: 0.410, rx: 0.055, rz: 0.058, cx: x + s * 0.007, cz: 0.008 },
      { y: 0.512, rx: 0.064, rz: 0.067, cx: x + s * 0.006, cz: 0.005 },
    ], (i) => (i === 3 ? bind(kn, hp, 0.30) : bind(kn)),
    (i) => (i <= 1 ? KIT.leather : KIT.suit), D.sides, { capBot: false, capTop: false });
    limb(M, [
      { y: 0.012, rx: 0.060, rz: 0.090, cx: x + s * 0.008, cz: -0.026 },
      { y: 0.075, rx: 0.064, rz: 0.098, cx: x + s * 0.008, cz: -0.030 },
      { y: 0.150, rx: 0.062, rz: 0.072, cx: x + s * 0.008, cz: -0.006 },
      { y: 0.205, rx: 0.077, rz: 0.080, cx: x + s * 0.008, cz: 0.002 },
      { y: 0.242, rx: 0.066, rz: 0.070, cx: x + s * 0.008, cz: 0.004 },
    ], (i) => (i <= 1 ? bind(ft) : i === 2 ? bind(ft, kn, 0.5) : bind(kn)),
    (i) => (i === 3 ? KIT.strap : KIT.leather), D.sides, { capTop: false });
  }

  // --- the coat skirt: the cloth -------------------------------------------
  //
  // An open-fronted panel from the waist to below the knee. Registering it as
  // `cloth` hands every one of these vertices to the update pass, which rewrites
  // them from the wind field each frame; none of it is skinned.
  //
  // The gap widens as it descends — 0.34 rad at the belt to 0.92 at the hem — so
  // the coat is nearly closed at the waist and opens over the legs. A constant
  // gap reads as a cut-out; a widening one reads as a coat that hangs.
  // `flip: -1`, and it is not a taste. The grid convention is
  // n = cross(∂G/∂i, ∂G/∂j) with i running *up*; on this surface i runs down
  // the drop, so the cross product comes out inward. The first capture showed
  // it plainly: the coat's whole belly rendered in the rust lining, because
  // every outward-facing fragment was being told it was a back face.
  M.grid((i, j) => {
    const c = coatRest(i / (D.coatV - 1), j / (D.coatU - 1));
    return [Math.cos(c.a) * c.r, c.y, Math.sin(c.a) * c.r * 1.06];
  }, D.coatV, D.coatU, (i) => ({
    m: i >= D.coatV - 2 ? KIT.coatWorn : KIT.coat,
    bind: bind(B.root),
    ao: 1 - 0.10 * (i / (D.coatV - 1)),
  }), { flip: -1, cloth: { kind: 'coat' } });

  // --- the scarf: the motion read at distance ------------------------------
  //
  // Anchored over the pauldron. At 40 px in waist-deep grass the legs are gone
  // and the coat is half gone, and this is the only thing still moving — which
  // is why it is long, why it is the warmest thing in the kit, and why it
  // carries the highest rim and transmission weights in the table.
  M.grid((i, j) => {
    const t = i / (D.scarfN - 1);
    const w = j / (D.scarfW - 1) - 0.5;
    return [-0.150 + w * 0.10, 1.455 - t * 0.30, 0.020 + t * 0.360];
  }, D.scarfN, D.scarfW, (i) => ({
    m: KIT.scarf, bind: bind(B.chest), ao: 1 - 0.05 * (i / (D.scarfN - 1)),
  }), { cloth: { kind: 'scarf' } });

  // one wisp of per-traveler variation, drawn from the seed and nothing else
  // (§2.3): how far the scarf trails.
  return { M, scarfLen: 1.26 + rng.float(0, 0.36) };
}

// ---------------------------------------------------------------------------
// the shader
//
// §9.2 imported rather than restated — `PAINT_GLSL` is the light model and there
// is exactly one of it. What this adds is per-vertex stops (so one draw call
// carries nine materials), the back-face lining rule, and the visor.
//
// On fog: there is none, deliberately. §9.3's `fogNear` is 70 m and this object
// is the player — it is never further from the camera than the third-person
// boom, 4.6 m, where the fog fraction is identically zero. Writing `a = 1.0` is
// the correct answer under `AERIAL_ALPHA_IS_CLARITY`: alpha means *clear*, and
// the figure genuinely is. Importing the fog to multiply by zero would be
// ceremony, and it would couple this file to one being rewritten next door.

const FIG_VERT = /* glsl */`
  attribute vec3 aShade;
  attribute vec3 aMid;
  attribute vec3 aLit;
  attribute vec4 aSurf;      // rim, ao, emissive, transmission
  attribute vec3 aRest;      // rest-pose position — see the note on jit

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

const figFragment = (shadowGLSL) => /* glsl */`
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

  // The lining: every back face on the figure is the coat's rust interior.
  // Stated once, as a rule, rather than carried as a per-vertex attribute — the
  // only surfaces in this mesh with a visible back face are cloth, and cloth is
  // the only thing that has a lining.
  uniform vec3 uLineShade;
  uniform vec3 uLineMid;
  uniform vec3 uLineLit;

  ${PAINT_GLSL}
  ${shadowGLSL}

  void main() {
    vec3 N = normalize(vN);
    vec3 toEye = cameraPosition - vW;
    float dist = length(toEye);
    vec3 V = toEye / max(dist, 1e-4);

    // §M2 act 6 says far ridges are "pure haze, pure shape" and §9.5 says
    // across-blade detail should be dropped once a blade is two pixels wide.
    // The same statement, made about a body: at thirty metres a person is 30 px
    // tall, every stop above the shade one is sub-pixel, and the only thing that
    // survives is the outline. This term is what turns the figure into that
    // outline instead of letting it dissolve into ground of the same value.
    float far = smoothstep(9.0, 30.0, dist);

    vec3 shade = vShade, mid = vMid, lit = vLit;
    float rim = vSurf.x, trans = vSurf.w;
    if (!gl_FrontFacing) {
      N = -N;
      shade = uLineShade; mid = uLineMid; lit = uLineLit;
      rim = 0.60; trans = max(trans, 0.55);
    }
    // The rim draws an edge, and at range the whole figure is edge — so the
    // term that exists to separate a silhouette from its background stops
    // filling it in. This one line is most of the difference between a shape
    // and a smudge at 17 m.
    rim *= 1.0 - far * 0.88;

    Surf sf;
    sf.N = N; sf.V = V; sf.L = uSunDir;
    sf.shade = shade; sf.mid = mid; sf.lit = lit;
    // §9.2's band edges, and §11's warning about them: a PBR reflex widens this
    // until the bands disappear, and the bands are the art direction. 0.085 is
    // soft enough that the edge is drawn rather than stepped, and hard enough
    // that you can see where it is.
    sf.soft = 0.085;
    // the painterly wobble, locked to the REST pose. Keyed to the live position
    // it would crawl across the coat as the body moved, which is the one thing a
    // hand-painted band edge never does.
    sf.jit = (sin(vRest.y * 8.3 + vRest.x * 5.7) + sin(vRest.z * 6.1 - vRest.y * 3.3)) * 0.011;
    sf.shadow = ${shadowGLSL ? 'sunShadow(vW, dot(N, uSunDir))' : '1.0'};
    sf.trans = trans; sf.transCol = lit * 1.15;
    sf.rim = rim; sf.ao = vSurf.y; sf.ambient = 1.0;
    vec3 col = paint(sf);

    // wear: dust climbs the coat from the hem, rain darkens what it lands on.
    // Both keyed to the rest pose, so a coat that has been walked in stays dirty
    // in the same places rather than shimmering as the body moves.
    float dust = smoothstep(0.62, 0.16, vRest.y) * 0.16;
    col = mix(col, col * vec3(1.14, 1.05, 0.86), dust);
    col *= 1.0 - uWet * 0.18 * smoothstep(1.9, 0.4, vRest.y);

    // and the collapse toward shape. Note it is a mix toward the material's own
    // *shade* stop rather than toward black: §2.8 gives vacuum true black and
    // an atmosphere none, and a distant figure is emphatically inside an
    // atmosphere. It goes dark and violet, not dark and empty.
    col = mix(col, col * 0.38 + shade * 0.85, far);

    // the accent. It is a light, so it is added rather than mixed, and it is
    // gated on uGlow — bright noon does not need a lamp and dusk does. It is the
    // one thing that does *not* fade with distance: at 40 px the visor is the
    // pixel that says which way the figure is facing.
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
// audio, the grass the walker parts and now every limb all read the same number,
// so a foot cannot land at a different moment from the sound of it landing.

/** a bump on the unit circle; the gait curves are all sums of these */
const bump = (u, c, w) => {
  let d = u - c;
  d -= Math.round(d);
  return Math.exp(-(d * d) / (w * w));
};

/**
 * Knee flexion through one stride, as two bumps.
 *
 * A knee does not swing sinusoidally, and a sine is instantly readable as wrong:
 * real flexion has a small absorption bump just after heel strike and a large
 * one in mid-swing, with the leg nearly straight at contact. Two Gaussians
 * reproduce that to well inside what a 40-px figure can resolve — and unlike a
 * clip they are continuous in speed, so a walk becomes a run by moving two
 * amplitudes rather than by crossfading two animations that were never measured
 * against each other.
 */
const kneeCurve = (u, run) => bump(u, 0.14, 0.13) * (0.30 + 0.22 * run)
  + bump(u, 0.74, 0.15) * (1.02 + 0.55 * run);

/** the leg, as the three numbers `avatar.js`'s solve needs from `P` */
const LEG = { hip: P.hip, knee: P.knee, ankle: P.ankle };

export class Figure {
  /**
   * @param seed   the world seed. The kit is fixed; the scarf's trailing length
   *               is the traveler's own (§2.3).
   * @param sunDir the *same* uniform object the sky and the terrain hold, so the
   *               figure cannot be lit by yesterday's sun.
   * @param light  §9.2's four light colours for this world's star.
   */
  constructor({ seed = 1, sunDir, light, shadowGLSL = null, shadowUniforms = null }) {
    this.D = DETAIL[clamp(TIER, 0, 3)];
    const built = buildGeometry(seed, this.D);
    const M = built.M;
    this.scarfLen = built.scarfLen;
    this.nv = M.count;
    this.tris = M.idx.length / 3;

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
    // The bounding sphere is set by hand and never recomputed. Every vertex
    // moves every frame, and `computeBoundingSphere()` on a moving mesh is both
    // a per-frame cost and a source of culling pop; a 1.75 m sphere around the
    // navel contains every pose the body can reach, coat at full billow and
    // scarf at full stream included, so this is simply correct.
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.95, 0), 1.75);
    this.geometry = g;

    const v3 = (c) => ({ value: new THREE.Vector3(c[0], c[1], c[2]) });
    this.lightU = {
      uPaintSun: v3(light.sun), uPaintAmbSky: v3(light.ambSky),
      uPaintAmbGnd: v3(light.ambGnd), uPaintShadowTint: v3(light.shadowTint),
    };
    this.uGlow = { value: 0.4 };
    this.uWet = { value: 0 };
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        ...this.lightU,
        ...(shadowUniforms || {}),
        uSunDir: sunDir,
        uVisor: { value: new THREE.Vector3(...KIT.visor.lit).multiplyScalar(2.4) },
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

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = true;

    this.bones = BONES.map(([name, parent, x, y, z]) => {
      const p = parent >= 0 ? BONES[parent] : null;
      return {
        name,
        parent,
        off: new THREE.Vector3(x - (p ? p[2] : 0), y - (p ? p[3] : 0), z - (p ? p[4] : 0)),
        rot: new THREE.Euler(0, 0, 0, 'YXZ'),
        world: new THREE.Matrix4(),
        restInv: new THREE.Matrix4().makeTranslation(x, y, z).invert(),
      };
    });
    this.skin = new Float32Array(BONES.length * 12);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);

    this.clothBlocks = M.cloth;
    this.coat = M.cloth.find((c) => c.kind === 'coat');
    this.scarfBlk = M.cloth.find((c) => c.kind === 'scarf');

    // state that has to persist between frames: the hem lags the body, the
    // scarf's direction is inertial, and a landing decays
    this._hemX = 0; this._hemZ = 0;
    this._scarf = new THREE.Vector3(0, -0.4, 1).normalize();
    this._land = 0;
    this._air = 0;
    this._turn = 0;
    this._face = 0;
    this._rootY = 0;
    this._rootX = 0;
    this._landed = null;
    this._vy = 0;
    this._t = 0;
  }

  /** the world position of a named joint, in figure space — the lantern hangs here */
  joint(name, out = new THREE.Vector3()) {
    return out.setFromMatrixPosition(this.bones[B[name]].world);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }

  /** §9.2's four light colours, as the sun moves */
  setLight(L) {
    this.lightU.uPaintSun.value.set(L.sun[0], L.sun[1], L.sun[2]);
    this.lightU.uPaintAmbSky.value.set(L.ambSky[0], L.ambSky[1], L.ambSky[2]);
    this.lightU.uPaintAmbGnd.value.set(L.ambGnd[0], L.ambGnd[1], L.ambGnd[2]);
    this.lightU.uPaintShadowTint.value.set(L.shadowTint[0], L.shadowTint[1], L.shadowTint[2]);
  }

  /**
   * One frame. `st` is the whole of what the figure knows:
   *
   *   walker  — the §M4 controller, or null (then the gait is synthesised)
   *   speed   — horizontal m/s
   *   vel     — world velocity {x, y, z}
   *   face    — the yaw the mesh's group is rotated by
   *   wind    — `s.sampleWind()` at hem height
   *   windUp  — the same at shoulder height. The two together *are* the boundary
   *             layer, which is the only reason there are two of them.
   *   mode    — 'walk' | 'fly' | 'ride'
   *   sunY    — sin(sun elevation), for the visor
   *   wet     — the weather's wetness, 0..1
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
    // ground. Full at civil twilight, a fifth of that at noon — the same curve
    // the lantern uses, so the two accents rise together.
    const night = 1 - clamp((st.sunY + 0.10) * 3.2, 0, 1);
    this.uGlow.value = 0.22 + 0.95 * night;
    this.uWet.value = st.wet ?? 0;
  }

  // -------------------------------------------------------------- pose ----

  _pose(dt, st) {
    const bones = this.bones;
    for (const b of bones) b.rot.set(0, 0, 0);
    this._rootY = 0;
    this._rootX = 0;

    const w = st.walker;
    const spd = st.speed;
    const grounded = w ? w.grounded : true;

    // --- the impulses the pose is built on top of --------------------------
    //
    // Landing reads the controller's own `landed` counter rather than watching
    // `grounded` go true, so the figure absorbs exactly the landings the physics
    // recorded — including the ones a step-up deliberately does not count.
    if (w) {
      if (this._landed === null) this._landed = w.landed;
      if (w.landed !== this._landed) {
        this._land = clamp(Math.abs(this._vy) / 6.5, 0.25, 1.4);
        this._landed = w.landed;
      }
      this._vy = w.vel.y;
    }
    this._land *= Math.exp(-dt * 5.2);
    const airborne = st.mode === 'walk' && !grounded;
    this._air += ((airborne ? 1 : 0) - this._air) * clamp(dt * 9, 0, 1);

    // turning, banked into — anything carrying momentum through a curve leans
    let dF = st.face - this._face;
    dF = Math.atan2(Math.sin(dF), Math.cos(dF));
    this._face = st.face;
    this._turn += (clamp(dF / Math.max(dt, 1e-3), -3, 3) - this._turn) * clamp(dt * 6, 0, 1);

    if (st.mode === 'ride') return this._poseRide();
    if (st.mode === 'fly') return this._poseFly(st, spd);

    // --- the walk ----------------------------------------------------------
    const phase = w ? w.stepPhase : this._t * (0.58 + 0.34 * spd);
    const u = phase - Math.floor(phase);
    const gp = phase * Math.PI * 2;
    // 0 standing, 1 walking, and past that into the run blend. GAIT.walk is
    // 4.8 m/s and sprint ×3, so `run` reaches 1 at about 12 m/s — the amplitudes
    // move continuously between them rather than a state machine switching.
    const gait = clamp(spd / 3.2, 0, 1);
    const run = clamp((spd - 4.2) / 8.0, 0, 1);
    const air = this._air;
    const ground = 1 - air;
    // rising → 0, falling → 1. GAIT holds launch *speed* constant across worlds
    // now, so on a sixth-gravity moon the apex is 8.8 m and this pose is on
    // screen for ten seconds at a time. It has to be worth looking at.
    const vy = clamp((st.vel ? st.vel.y : 0) / 6.0, -1.2, 1.2);
    const tuck = smooth(0.6, -0.4, vy);

    // The legs are solved to a planted foot rather than posed — see `legPlant`.
    // `plant` is computed once for both, because the hip drop is a property of
    // the pair: whichever foot is reaching furthest owns it.
    const cadence = w && w.stepFreq > 1e-3 ? w.stepFreq : 0.58 + 0.34 * spd;
    const plant = legPlant(u, spd, cadence, st.gravity ?? 9.81, LEG);

    for (const s of [1, -1]) {
      const hip = bones[s > 0 ? B.hipR : B.hipL];
      const knee = bones[s > 0 ? B.kneeR : B.kneeL];
      const foot = bones[s > 0 ? B.footR : B.footL];
      const uu = s > 0 ? u : (u + 0.5) % 1;

      // The solve, blended in by `gait` so standing still is untouched: at zero
      // speed the stride is zero, every target is the rest position, and the
      // whole thing returns the pose that was already there.
      const tgt = plant[s > 0 ? 'R' : 'L'];
      const sol = solveLeg(tgt.z, tgt.y, plant.drop * gait, LEG);
      hip.rot.x = sol.hip * gait;
      hip.rot.z = s * 0.05 * gait * Math.sin(gp);
      knee.rot.x = sol.knee * gait;
      // The ankle keeps the sole flat through stance and points it into the
      // swing — `kneeCurve`'s toe-off bump survives because it is the one part
      // of the authored cycle the solve says nothing about.
      foot.rot.x = (-(sol.hip + sol.knee) * 0.55 - 0.06) * gait * tgt.down
        + (bump(uu, 0.80, 0.16) * 0.34) * gait;

      // airborne: the cycle stops and the legs take a jump shape — trailing and
      // tucked on the way up, reaching on the way down
      const jHip = s > 0 ? (0.62 - 0.95 * tuck) : (-0.30 + 0.42 * tuck);
      const jKnee = s > 0 ? -(1.15 - 0.75 * tuck) : -(0.55 + 0.30 * tuck);
      hip.rot.x = hip.rot.x * ground + jHip * air;
      knee.rot.x = knee.rot.x * ground + jKnee * air;
      foot.rot.x = foot.rot.x * ground + (-0.30 + 0.55 * tuck) * air;
      hip.rot.z *= ground;

      // the landing absorb, on top of whatever the cycle was doing
      knee.rot.x -= this._land * 0.85;
      hip.rot.x += this._land * 0.42;
      foot.rot.x += this._land * 0.30;

      // idle: weight on one leg, the other soft. A figure standing with both
      // knees locked and both feet square is a mannequin; this is the whole
      // difference between that and a person waiting, and it costs three lines.
      const idle = (1 - gait) * ground;
      hip.rot.x += (s > 0 ? 0.05 : -0.10) * idle;
      knee.rot.x -= (s > 0 ? 0.06 : 0.20) * idle;
      hip.rot.z += s * 0.03 * idle;
    }

    // the pelvis: transverse rotation toward the swinging leg, a rise twice per
    // stride, and a lateral shift onto the stance foot
    const root = bones[B.root];
    root.rot.y = 0.10 * gait * Math.cos(gp);
    root.rot.z = -0.055 * gait * Math.sin(gp) - clamp(this._turn * 0.09, -0.22, 0.22);
    root.rot.x = clamp(spd * 0.021, 0, 0.30) + this._land * 0.40 + air * 0.12
      + (w ? w.lean : 0);
    // ...and the rise is the compass drop the solve demanded, not a cosine:
    // the bob is now a consequence of the step length rather than a curve
    // tuned to look like one.
    this._rootY = -plant.drop * gait - this._land * 0.13 - air * 0.02;
    this._rootX = 0.030 * gait * Math.sin(gp);

    // spine and chest counter-rotate the pelvis. This is the single cue that
    // separates a walk from a shuffle: shoulders and hips out of phase.
    bones[B.spine].rot.y = -0.11 * gait * Math.cos(gp);
    bones[B.spine].rot.z = clamp(this._turn * 0.05, -0.12, 0.12);
    bones[B.chest].rot.y = -0.12 * gait * Math.cos(gp);
    bones[B.chest].rot.x = -clamp(spd * 0.008, 0, 0.10)
      + Math.sin((w ? w.breath : this._t) * 1.1) * 0.012;

    // the head holds the horizon. A head that rides the shoulders exactly is the
    // reason cheap walk cycles read as bobbing: real gaze is stabilised, so the
    // neck spends the whole stride cancelling the chest.
    bones[B.neck].rot.y = 0.16 * gait * Math.cos(gp);
    bones[B.head].rot.x = -root.rot.x * 0.55 - this._land * 0.25;
    bones[B.head].rot.y = 0.06 * gait * Math.cos(gp)
      + Math.sin(this._t * 0.21) * 0.10 * (1 - gait);

    // the arms counter the legs, and the elbow leads on the forward swing
    for (const s of [1, -1]) {
      const sh = bones[s > 0 ? B.armR : B.armL];
      const el = bones[s > 0 ? B.elbowR : B.elbowL];
      const uu = s > 0 ? u : (u + 0.5) % 1;
      const armSwing = (0.32 + 0.46 * run) * gait;
      sh.rot.x = -Math.cos(uu * Math.PI * 2) * armSwing;
      sh.rot.z = s * (0.13 + 0.07 * run + 0.05 * gait);
      el.rot.x = 0.22 + (0.36 + 0.55 * run) * gait * Math.max(0, -Math.cos(uu * Math.PI * 2))
        + this._land * 0.5;
      // airborne the arms come up and out — the balance reflex, and it reads as
      // weightlessness from any distance
      sh.rot.x = sh.rot.x * ground + (-0.75 + 0.35 * tuck) * air;
      sh.rot.z = sh.rot.z * ground + s * 0.60 * air;
      el.rot.x = el.rot.x * ground + 0.55 * air;
      const idle = (1 - gait) * ground;
      sh.rot.x += (s < 0 ? 0.06 : -0.02) * idle;
      el.rot.x += (s < 0 ? 0.55 : 0.16) * idle;
      sh.rot.z += s * 0.02 * Math.sin((w ? w.breath : this._t) * 1.1) * idle;
    }
  }

  /**
   * Flight — `GAIT.flyThrust` against `flyDrag`, so the body has mass and has to
   * be *aimed*. The pose says exactly that: the torso lies along the track, the
   * legs trail together, the arms sweep back, and the coat and the scarf stream
   * off the whole length of it. A walk cycle held in mid-air says the opposite,
   * which is what makes free-flight in most games read as a camera on rails.
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
    bones[B.spine].rot.x = 0.10 * commit;
    bones[B.chest].rot.x = 0.08 * commit;
    // the head stays level with the horizon however far the body has tipped: you
    // look where you are going, not where your chest happens to point
    bones[B.head].rot.x = -1.07 * commit + climb * 0.30;

    for (const s of [1, -1]) {
      bones[s > 0 ? B.hipR : B.hipL].rot.x = -0.30 * commit + (s > 0 ? 0.06 : -0.04);
      bones[s > 0 ? B.hipR : B.hipL].rot.z = -s * 0.05 * commit;
      bones[s > 0 ? B.kneeR : B.kneeL].rot.x = -(0.22 + 0.30 * commit)
        + (s > 0 ? -0.10 : 0.06) * commit;
      bones[s > 0 ? B.footR : B.footL].rot.x = -0.55 * commit;
      // arms back and in at speed, out and forward at a hover — a body with no
      // airspeed has nothing to streamline against
      bones[s > 0 ? B.armR : B.armL].rot.x = 0.55 * commit - 0.25 * (1 - commit);
      bones[s > 0 ? B.armR : B.armL].rot.z = s * (0.10 + 0.16 * (1 - commit));
      bones[s > 0 ? B.elbowR : B.elbowL].rot.x = 0.18 + 0.40 * (1 - commit);
    }
  }

  /** seated on the skiff: hips and knees folded, hands forward on the helm */
  _poseRide() {
    const bones = this.bones;
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
      // the root carries the gait's own translation: the rise and fall of the
      // centre of mass, and the sway onto the stance foot
      this._v.set(b.off.x + (i === 0 ? this._rootX : 0),
        b.off.y + (i === 0 ? this._rootY : 0), b.off.z);
      this._m.compose(this._v, this._q, this._one);
      if (b.parent >= 0) b.world.multiplyMatrices(bones[b.parent].world, this._m);
      else b.world.copy(this._m);
    }
    // the skin matrix — current world × inverse rest world, flattened to the 3×4
    // affine the inner loop actually uses
    const S = this.skin;
    for (let i = 0; i < bones.length; i++) {
      this._m.multiplyMatrices(bones[i].world, bones[i].restInv);
      const e = this._m.elements;    // column-major
      const o = i * 12;
      S[o] = e[0]; S[o + 1] = e[4]; S[o + 2] = e[8]; S[o + 3] = e[12];
      S[o + 4] = e[1]; S[o + 5] = e[5]; S[o + 6] = e[9]; S[o + 7] = e[13];
      S[o + 8] = e[2]; S[o + 9] = e[6]; S[o + 10] = e[10]; S[o + 11] = e[14];
    }
  }

  /** two-bone linear blend, positions and normals, into the live buffers */
  _skin() {
    const POS = this.posAttr.array, NRM = this.nrmAttr.array;
    const R = this.rest, RN = this.restN, S = this.skin;
    for (let i = 0; i < this.nv; i++) {
      const k = i * 3;
      const x = R[k], y = R[k + 1], z = R[k + 2];
      const nx = RN[k], ny = RN[k + 1], nz = RN[k + 2];
      const a = this.bA[i] * 12, w = this.bw[i];
      let px = S[a] * x + S[a + 1] * y + S[a + 2] * z + S[a + 3];
      let py = S[a + 4] * x + S[a + 5] * y + S[a + 6] * z + S[a + 7];
      let pz = S[a + 8] * x + S[a + 9] * y + S[a + 10] * z + S[a + 11];
      let mx = S[a] * nx + S[a + 1] * ny + S[a + 2] * nz;
      let my = S[a + 4] * nx + S[a + 5] * ny + S[a + 6] * nz;
      let mz = S[a + 8] * nx + S[a + 9] * ny + S[a + 10] * nz;
      if (w > 0.0005) {
        const b = this.bB[i] * 12;
        px += (S[b] * x + S[b + 1] * y + S[b + 2] * z + S[b + 3] - px) * w;
        py += (S[b + 4] * x + S[b + 5] * y + S[b + 6] * z + S[b + 7] - py) * w;
        pz += (S[b + 8] * x + S[b + 9] * y + S[b + 10] * z + S[b + 11] - pz) * w;
        mx += (S[b] * nx + S[b + 1] * ny + S[b + 2] * nz - mx) * w;
        my += (S[b + 4] * nx + S[b + 5] * ny + S[b + 6] * nz - my) * w;
        mz += (S[b + 8] * nx + S[b + 9] * ny + S[b + 10] * nz - mz) * w;
      }
      POS[k] = px; POS[k + 1] = py; POS[k + 2] = pz;
      const l = Math.hypot(mx, my, mz) || 1;
      NRM[k] = mx / l; NRM[k + 1] = my / l; NRM[k + 2] = mz / l;
    }
  }

  // ------------------------------------------------------------- cloth ----

  /**
   * The coat and the scarf, from the one wind field.
   *
   * §6 M3's thesis is that everything that moves samples one field — "grass,
   * foliage, dust, spores, **cloth**, water ripple, cloud advection, smoke". The
   * cloth is this file's entry on that list, and the field it reads is
   * `s.sampleWind()`, which is `wind.js`'s `windAt()`: the CPU mirror the GPU
   * pass is required to match, and the same reading the wake, the god rays, the
   * rain and the festival lanterns already take.
   *
   * On why this is a CPU sample where the grass takes a GPU one: the wind target
   * is 440 m across 256 texels, so one texel is 1.7 m. A coat is 0.6 m wide.
   * Every vertex of it lands in the same texel, so a per-vertex fetch in a
   * vertex shader would return the identical value at two hundred times the
   * cost — the *spatial* detail the grass needs across a chunk does not exist
   * across a garment. What is resolved at this scale is the *vertical* gradient,
   * which is why the caller passes two samples, hem and shoulder. That pair is
   * the boundary layer, and it is what makes the hem trail while the scarf whips.
   */
  _cloth(dt, st) {
    // The air the cloth actually feels: the wind, minus the body's own motion.
    // Running into still air is a headwind, and the only thing that tells a coat
    // the difference between that and standing in a gale is which way the gust
    // front is travelling — which this subtraction preserves exactly.
    const wLow = st.wind || { x: 0, z: 0 };
    const wHigh = st.windUp || wLow;
    const v = st.vel || { x: 0, y: 0, z: 0 };
    const cf = Math.cos(-st.face), sf = Math.sin(-st.face);
    const lx = (wLow.x - v.x) * cf + (wLow.z - v.z) * sf;
    const lz = -(wLow.x - v.x) * sf + (wLow.z - v.z) * cf;
    const hx = (wHigh.x - v.x) * cf + (wHigh.z - v.z) * sf;
    const hz = -(wHigh.x - v.x) * sf + (wHigh.z - v.z) * cf;
    // a fall is a vertical wind, and it is what makes a long jump on a
    // low-gravity world look like a long jump rather than a hop
    const vy = -(v.y || 0);

    this._coatCloth(dt, st, lx, lz, vy);
    this._scarfCloth(dt, st, hx, hz, vy);
    for (const blk of this.clothBlocks) this._clothNormals(blk);
  }

  _coatCloth(dt, st, wx, wz, vy) {
    const c = this.coat;
    if (!c) return;
    const POS = this.posAttr.array;
    const w = st.walker;
    const S = this.skin, ro = B.root * 12;
    const gait = clamp(st.speed / 3.2, 0, 1);
    const phase = w ? w.stepPhase : this._t;
    const gp = phase * Math.PI * 2;

    // The hem lags the body: a coat does not change direction when you do. One
    // exponential, and it is most of the reason the coat reads as heavy rather
    // than as a decal that happens to be attached to a person.
    const k = clamp(dt * 3.4, 0, 1);
    this._hemX += (wx - this._hemX) * k;
    this._hemZ += (wz - this._hemZ) * k;
    const air = Math.hypot(this._hemX, this._hemZ);
    const pushX = clamp(this._hemX * 0.030, -0.34, 0.34);
    const pushZ = clamp(this._hemZ * 0.030, -0.34, 0.34);
    // billow: fast air lifts a hem as well as pushing it
    const lift = clamp(air * 0.016 + Math.max(vy, 0) * 0.020, 0, 0.22);
    const flut = 0.006 + clamp(air * 0.0035, 0, 0.026) + (st.wind?.front ?? 0) * 0.010;

    for (let i = 0; i < c.ni; i++) {
      const vv = i / (c.ni - 1);
      const hinge = vv * vv;                    // the coat swings from the waist
      for (let j = 0; j < c.nj; j++) {
        const rest = coatRest(vv, j / (c.nj - 1));
        const a = rest.a, rr = rest.r, y0 = rest.y;
        const ca = Math.cos(a), sa = Math.sin(a);
        // the pelvis carries the top of the coat: the waist follows the body's
        // lean and turn, and the wind offset below is added on top in figure
        // space, where it belongs — the air does not rotate with the hips
        const rx = ca * rr, rz = sa * rr * 1.06;
        let x = S[ro] * rx + S[ro + 1] * y0 + S[ro + 2] * rz + S[ro + 3];
        let y = S[ro + 4] * rx + S[ro + 5] * y0 + S[ro + 6] * rz + S[ro + 7];
        let z = S[ro + 8] * rx + S[ro + 9] * y0 + S[ro + 10] * rz + S[ro + 11];

        // a panel only feels the air that pushes on its own face; a panel
        // edge-on to the flow is not pushed, it flutters
        const press = clamp(-(ca * this._hemX + sa * this._hemZ) * 0.010, -0.6, 1.0);
        const rip = Math.sin(a * 3.4 - this._t * 5.6 + vv * 3.1) * flut * hinge * 0.34;
        const radial = rip + press * 0.055 * hinge;
        // the gait: the front panels part around the leg on that side, and the
        // phase they part on is the one clock, so the coat opens on the stride
        const side = ca > 0 ? 0 : 0.5;
        const lu = (phase + side) % 1;
        const kick = Math.max(0, Math.cos(lu * Math.PI * 2)) * gait * 0.075 * hinge
          * Math.max(0, -sa);

        x += ca * radial + pushX * hinge;
        y += lift * hinge + Math.sin(gp * 2) * 0.006 * gait * hinge;
        z += sa * radial + pushZ * hinge - kick;
        const o = (c.base + i * c.nj + j) * 3;
        POS[o] = x; POS[o + 1] = y; POS[o + 2] = z;
      }
    }
  }

  _scarfCloth(dt, st, wx, wz, vy) {
    const c = this.scarfBlk;
    if (!c) return;
    const POS = this.posAttr.array;
    // tied over the pauldron, at the collar's lip — and carried by the chest
    // bone, so the anchor moves with the shoulder while the rest obeys the air
    const S = this.skin, co = B.chest * 12;
    const ax = -0.150, ay = 1.455, az = 0.020;
    let px = S[co] * ax + S[co + 1] * ay + S[co + 2] * az + S[co + 3];
    let py = S[co + 4] * ax + S[co + 5] * ay + S[co + 6] * az + S[co + 7];
    let pz = S[co + 8] * ax + S[co + 9] * ay + S[co + 10] * az + S[co + 11];

    // The direction the air is going, smoothed. A scarf is nearly massless so it
    // is almost pure air — but not instantly: the lag is what makes it crack
    // rather than snap, and it is the hem's exponential at a faster rate.
    const airSp = Math.hypot(wx, wz, vy);
    const drape = 1 / (1 + airSp * 0.55);          // 1 when still, toward 0 in a gale
    const tl = Math.max(airSp, 1e-4);
    const k = clamp(dt * 5.0, 0, 1);
    this._scarf.x += (wx / tl - this._scarf.x) * k;
    this._scarf.y += (vy / tl - this._scarf.y) * k;
    this._scarf.z += (wz / tl - this._scarf.z) * k;
    this._scarf.normalize();

    // ---- the chain ---------------------------------------------------------
    //
    // The first pass integrated a nearly-constant direction and produced a rigid
    // rod — which is what every capture showed, a 1.3 m wire sticking out of the
    // shoulder. Two things were missing and both are properties of a real
    // ribbon:
    //
    //   · **Compliance grows along the length.** The end at the knot remembers
    //     the shoulder; the free end remembers only the air. `follow` therefore
    //     rises with t, so the scarf *bends* out of its launch direction over
    //     its own length rather than translating along one.
    //
    //   · **Gravity is a per-segment acceleration, not a nudge.** It accumulates
    //     down the chain and it is strongest where the air is weakest, so the
    //     same code hangs the scarf at a standstill and streams it in a gust
    //     with nothing switching between the two.
    //
    // It leaves the shoulder pointing out and back regardless, because a scarf
    // is thrown over a shoulder and that is where the loose end starts.
    const seg = this.scarfLen / (c.ni - 1);
    let dx = -0.55, dy = -0.30, dz = 0.78;
    const dl0 = Math.hypot(dx, dy, dz);
    dx /= dl0; dy /= dl0; dz /= dl0;
    const grav = 0.42 * drape + 0.06;
    for (let i = 0; i < c.ni; i++) {
      const t = i / (c.ni - 1);
      if (i > 0) {
        const follow = (0.10 + 0.42 * t) * (1 - drape * 0.55);
        dx += (this._scarf.x - dx) * follow;
        dy += (this._scarf.y - dy) * follow;
        dz += (this._scarf.z - dz) * follow;
        dy -= grav * (0.30 + 1.15 * t) * 0.42;
        // the wave travels *along* the scarf, across the flow — the classic
        // ribbon read, and the reason it never looks like a rod with a texture
        const wob = Math.sin(t * 5.2 - this._t * 6.4) * (0.16 + 0.46 * (1 - drape)) * t;
        dx += -this._scarf.z * wob * 0.6;
        dz += this._scarf.x * wob * 0.6;
        const dl = Math.hypot(dx, dy, dz) || 1;
        dx /= dl; dy /= dl; dz /= dl;
        px += dx * seg; py += dy * seg; pz += dz * seg;
      }
      // the ribbon's cross section, perpendicular to the run, twisting as it
      // goes — a flat untwisted ribbon reads as tape
      let sx = -dz, sz = dx;
      const sl = Math.hypot(sx, sz) || 1;
      sx /= sl; sz /= sl;
      const tw = Math.sin(t * 4.2 - this._t * 3.4) * 0.62 * (1 - drape * 0.5);
      const ct = Math.cos(tw);
      const ux = sx * ct, uy = Math.sin(tw) * 0.9, uz = sz * ct;
      // wide enough to be cloth. The first pass was 0.11 m across and read as a
      // wire at every distance the figure is ever seen from.
      const half = 0.082 * (1 - t * 0.30);
      for (let j = 0; j < c.nj; j++) {
        const q = (j / (c.nj - 1) - 0.5) * 2;
        const o = (c.base + i * c.nj + j) * 3;
        POS[o] = px + ux * half * q;
        POS[o + 1] = py + uy * half * q;
        POS[o + 2] = pz + uz * half * q;
      }
    }
  }

  /**
   * Normals for a cloth block, by differencing the grid it was generated from.
   *
   * The same convention the builder uses — cross(∂P/∂i, ∂P/∂j) — so a cloth
   * vertex and a skinned vertex agree about which way is out. They have to: the
   * hem meets the coat's own back face along a shared silhouette, and a
   * disagreement there shows up as a seam that lights the wrong way.
   */
  _clothNormals(blk) {
    const POS = this.posAttr.array, NRM = this.nrmAttr.array;
    const { base, ni, nj, flip } = blk;
    const at = (i, j) => (base + i * nj + j) * 3;
    for (let i = 0; i < ni; i++) {
      for (let j = 0; j < nj; j++) {
        const i0 = at(Math.max(i - 1, 0), j), i1 = at(Math.min(i + 1, ni - 1), j);
        const j0 = at(i, Math.max(j - 1, 0)), j1 = at(i, Math.min(j + 1, nj - 1));
        const ux = POS[i1] - POS[i0], uy = POS[i1 + 1] - POS[i0 + 1], uz = POS[i1 + 2] - POS[i0 + 2];
        const vx = POS[j1] - POS[j0], vy = POS[j1 + 1] - POS[j0 + 1], vz = POS[j1 + 2] - POS[j0 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        const o = at(i, j);
        NRM[o] = flip * nx / l; NRM[o + 1] = flip * ny / l; NRM[o + 2] = flip * nz / l;
      }
    }
  }
}
