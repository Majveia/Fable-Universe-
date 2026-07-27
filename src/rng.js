// Deterministic hashing + RNG. The entire universe unfolds from one integer.
//
// Two kinds of randomness live here, and the difference matters.
//
// An `RNG` stream is *structural*: it decides where a galaxy sits, what a world
// is made of, which star has a name. Those draws are addressed by seed, and
// §2.3 makes them permanent — every seeded universe is a public address.
//
// The ambient stream below is *transient*: a spark's velocity, a petal's spawn
// point, which way a car turns at a junction. None of it is the shape of the
// universe, so none of it was ever seeded, and for a long time that looked
// harmless. It is not quite: it means two loads of the same URL do not produce
// the same frame, which is the reason §7.3's pixel diff ("≥97% of pixels within
// 2/255") and §7.7's re-shoot of every previous milestone could only ever be
// scored by eye. Seeding it costs nothing and buys both.

/** Robust integer hash (xxhash-style avalanche) over any number of ints. */
export function hash(...ns) {
  let h = 0x811c9dc5;
  for (let i = 0; i < ns.length; i++) {
    let x = ns[i] | 0;
    x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    h = Math.imul(h ^ (x ^ (x >>> 16)), 0x27d4eb2f);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

/** mulberry32 PRNG stream. */
export class RNG {
  constructor(seed) { this.s = seed >>> 0; }
  next() {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return a + Math.floor(this.next() * (b - a + 1)); }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  gauss() { // Box–Muller
    const u = Math.max(this.next(), 1e-9), v = this.next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  /** power-law sample x^-alpha on [a,b] */
  power(a, b, alpha) {
    const u = this.next(), g = 1 - alpha;
    return Math.pow(Math.pow(a, g) + u * (Math.pow(b, g) - Math.pow(a, g)), 1 / g);
  }
}

// ------------------------------------------------------------- ambient ----

/**
 * The ambient stream: transient motion, seeded once per universe.
 *
 * Deliberately one shared stream rather than one per module. Per-module streams
 * would be tidier to reason about and no more reproducible — what actually
 * makes a frame repeatable is that the whole program consumes draws in the same
 * order, which needs a fixed timestep (see `src/clock.js`), not more streams.
 */
let ambientStream = new RNG(0x9e3779b9);

/** re-seed the ambient stream; called once at boot from the universe seed */
export function seedAmbient(...ns) { ambientStream = new RNG(hash(...ns)); }

/** a transient random in [0,1) — the seeded replacement for Math.random() */
export function arand() { return ambientStream.next(); }

// ---------------------------------------------------------------- names ----

const G_PRE = ['Aeth', 'Vor', 'Tha', 'Ny', 'Ka', 'Ser', 'Om', 'Ily', 'Zau', 'Mor', 'Eri', 'Qel', 'Hal', 'Ves', 'Ur', 'Sza', 'Tal', 'Ao'];
const G_MID = ['ari', 'end', 'ilo', 'uma', 'ess', 'ath', 'ori', 'yne', 'ara', 'ith', 'osk', 'ell', 'und', 'eia'];
const G_END = ['a', 'is', 'ea', 'os', 'ion', 'ara', 'um', 'ir', 'ax', 'ys'];

const S_PRE = ['Kel', 'Tau', 'Rig', 'Ald', 'Ver', 'Sol', 'Mira', 'Zet', 'Alk', 'Deneb', 'Cor', 'Vind', 'Aza', 'Pol', 'Nash', 'Sadr', 'Ker', 'Yed', 'Ankaa', 'Thu'];
const S_END = ['ar', 'eth', 'ari', 'an', 'is', 'or', 'ah', 'une', 'ex', 'il', 'a', 'os', 'ia', 'ur'];

const P_PRE = ['Vel', 'Or', 'Teg', 'Nim', 'Cal', 'Bre', 'Dus', 'Yav', 'Kor', 'Mal', 'Ser', 'Osh', 'Ith', 'Lan', 'Ryn', 'Ei'];
const P_END = ['ora', 'une', 'eth', 'ia', 'os', 'ath', 'im', 'ir', 'ova', 'ael', 'ys', 'on'];

const GREEK = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Sigma', 'Tau', 'Upsilon', 'Omega'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export function galaxyName(seed) {
  const r = new RNG(hash(seed, 0x6a1, 77));
  if (r.chance(0.42)) return 'NGC ' + r.int(1000, 7999);
  let n = r.pick(G_PRE) + r.pick(G_MID);
  if (r.chance(0.5)) n += r.pick(G_END);
  return n;
}

export function starName(seed) {
  const r = new RNG(hash(seed, 0x57a2, 19));
  const base = r.pick(S_PRE) + r.pick(S_END);
  const roll = r.next();
  if (roll < 0.25) return r.pick(GREEK) + ' ' + base;
  if (roll < 0.45) return base + ' ' + String.fromCharCode(65 + r.int(0, 25)) + '-' + r.int(2, 98);
  return base;
}

export function planetName(systemName, index, seed) {
  const r = new RNG(hash(seed, index * 31 + 5, 0x91a));
  if (r.chance(0.55)) return systemName + ' ' + ROMAN[index];
  return r.pick(P_PRE) + r.pick(P_END);
}

export function romanNumeral(i) { return ROMAN[Math.min(i, ROMAN.length - 1)]; }

const C_PRE = ['Kor', 'Vel', 'Nar', 'Osh', 'Tir', 'Mal', 'Ess', 'Dra', 'Yel', 'Cal', 'Rho', 'Sab', 'Ith', 'Ques', 'Bre', 'Zan'];
const C_END = ['veth', 'mora', 'dan', 'ossa', 'rin', 'thal', 'ex', 'una', 'gard', 'ive', 'ath', 'olis', ' port', 'esh'];
const C_TITLE = ['New ', 'Port ', 'Cape ', 'High ', 'Old ', 'Grand '];

/** metropolis names: the biggest lights on the night side get called something */
export function cityName(seed, ci, cj, ck) {
  const r = new RNG(hash(seed, ci, cj, ck, 0xc17a));
  let n = r.pick(C_PRE) + r.pick(C_END);
  if (r.chance(0.3)) n = r.pick(C_TITLE) + n;
  return n;
}

// the bestiary needs names: every world calls its creatures something
const FAUNA_ADJ = ['pale', 'reed', 'dusk', 'glass', 'long-legged', 'moss', 'silver', 'ember', 'quiet', 'six-eyed', 'lantern', 'salt'];

export function faunaNames(seed) {
  const r = new RNG(hash(seed, 0xbea57));
  return {
    strider: r.pick(FAUNA_ADJ) + ' strider',
    skimmer: r.pick(FAUNA_ADJ) + ' skimmer',
  };
}

// every universe opens on its own line — the fable frame
const EPIGRAPHS = [
  'every light you see is an address',
  'the void remembers where it put things',
  'somewhere in here, somebody is home',
  'all of this happened, somewhere else',
  'matter is patient · light is not',
  'begin anywhere · it all connects',
  'the filaments were first to know',
  'gravity is just a long memory',
  'nothing here was drawn twice',
  'a story told in three hundred thousand lights',
];

export function universeEpigraph(seed) {
  const r = new RNG(hash(seed, 0xfab1e));
  return r.pick(EPIGRAPHS);
}

// ------------------------------------------------------------- the ruins ---
// the wild lands remember. every monument gets a name and a fragment of a
// story nobody finished telling — assembled so no two worlds read alike.
const RUIN_THE = ['The Weeping', 'The Sunken', 'The Hollow', 'The Broken', 'The Last',
  'The Silent', 'The Drowned', 'The Ninefold', 'The Patient', 'The Waiting', 'The Ashen', 'The Kind'];
const RUIN_NOUN = ['Arch', 'Gate', 'Vault', 'Spire', 'Ring', 'Throne', 'Beacon', 'Sundial',
  'Observatory', 'Reliquary', 'Watchstone', 'Causeway', 'Lantern', 'Choir'];
const RUIN_OF = ['of Vel', 'of the First Kings', 'of the Tide-Wardens', 'of Nine Winters',
  'of the Star-Menders', 'of the Long Afternoon', 'of the Salt Covenant', 'of the Hushed',
  'of the Cartographers', 'of the Unremembered', 'of the Green Dawn', 'of the Sky-Wrights'];

export function ruinName(seed, i) {
  const r = new RNG(hash(seed, i, 0x2b1c));
  const kind = r.next();
  if (kind < 0.4) return r.pick(RUIN_THE) + ' ' + r.pick(RUIN_NOUN);
  if (kind < 0.75) return r.pick(RUIN_NOUN) + ' ' + r.pick(RUIN_OF);
  return r.pick(RUIN_THE) + ' ' + r.pick(RUIN_NOUN) + ' ' + r.pick(RUIN_OF);
}

const LORE_A = [
  'They raised it to watch a star that has since gone out.',
  'A people slept here once, and dreamed the same dream.',
  'The stones were carried from a coast no map still names.',
  'It was old before the first town below took a name.',
  'Pilgrims came for a thousand years, then simply stopped.',
  'They say the wind here still answers, if you ask it right.',
  'Every equinox its shadow finds the same forgotten door.',
  'Whoever built it left in a hurry, and left the lamps lit.',
  'It marked a border between two things nobody remembers.',
  'The last keeper carved her name, then wore it smooth again.',
  'Sailors set their course by it before there were sailors.',
  'It has outlasted three seas and will outlast this one.',
];

export function ruinLore(seed, i) {
  return new RNG(hash(seed, i, 0x10e7)).pick(LORE_A);
}

// ----------------------------------------------------- the constellations ---
// every world's people looked up and drew their own figures in the dark
const CONS_THE = ['The', 'The Old', 'The Far', 'The Winter', 'The Drowned', 'The Kindled'];
const CONS_FIG = ['Ferryman', 'Long Net', 'Sleeping Hound', 'Broken Crown', 'Two Sisters',
  'Lantern-Bearer', 'Serpent', 'Weaver', 'Watchman', 'Great Elk', 'Kite', 'Reaper',
  'Anchor', 'Hunter', 'Empty Throne', 'Wanderer', 'Scholar', 'Nine Coins', 'Owl', 'Bridge'];

export function constellationName(seed, i) {
  const r = new RNG(hash(seed, i, 0xc0a5));
  return (r.chance(0.55) ? r.pick(CONS_THE) + ' ' : 'The ') + r.pick(CONS_FIG);
}
