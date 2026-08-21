// The other half of §2.3 — CLAUDE.md §2.3, §11.
//
//   node tools/digest.js
//   node tools/digest.js --json docs/captures/digest.json
//   node tools/digest.js --expect docs/captures/digest.json
//
// §2.3 makes two claims and the repo only ever checked one of them:
//
//   "Same seed + same code = same universe on every machine, forever."
//                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^
//
// `tools/repeat.js` proves *this* machine renders one URL the same way twice.
// `tools/invariants.js` proves no un-seeded entropy has crept into `src/`.
// Neither can see the interesting failure, because both run in one place: a
// generator that gives one answer on the runner and a different one on a
// laptop breaks every shared URL in the project, and passes both gates green.
//
// So this reduces the pure generation path to a single SHA-256 and lets two
// machines compare one string. `.github/workflows/determinism.yml` runs it on
// Linux, macOS and Windows and asserts all three agree — which is the actual
// shape of §2.3's claim, asked in the only way it can be asked.
//
// ---------------------------------------------------------------------------
// Why this can fail, which is the whole reason to run it
//
// IEEE-754 double arithmetic is exact and portable: `+ - * /` and `sqrt` give
// bit-identical answers on every conforming machine, and `hash()` and the noise
// lattice are built from those. Nothing in that half is at risk.
//
// The transcendental functions are a different story. `Math.sin`, `Math.cos`,
// `Math.pow`, `Math.exp`, `Math.log`, `Math.atan2` and `**` are *not* specified
// to the last bit by IEEE-754 or by ECMA-262, which requires only "an
// implementation-approximated result". V8 carries its own fdlibm port precisely
// so that the answer does not vary by platform, and that is why this passes
// today — but it is a property of the engine, not of the language, and the
// guarantee expires the moment two machines run different V8 versions.
//
// That matters here more than in most codebases. §9.6 derives the four sky
// stops from a star's blackbody spectrum through `planck()` — an `exp` in a
// tight loop over sixty wavelengths — and §M1 shimmers the cosmic web on a
// growth factor integrated with `pow`. A one-ulp difference in `exp` moves a
// sky colour by less than a 255th and moves nothing anybody can see. It also
// changes this digest, which is the point: the digest is not a rendering test,
// it is a tripwire on the assumption that the arithmetic is portable.
//
// So a red run here is not automatically a bug. It is a question with exactly
// three answers — the code changed, the engine changed, or §2.3's "forever"
// needs a footnote — and the workflow prints the Node and V8 versions of every
// machine so that whoever reads it can tell which.
//
// ---------------------------------------------------------------------------
// What is in it, and what deliberately is not
//
// Only pure functions of a seed, reachable in Node without a renderer: the
// hash, the noise lattice and the planet height field, the Zel'dovich modes,
// the blackbody transfer that §9.6 turns into sky stops, §M3's density law,
// the ecology logistic, the tree allometry. Together they touch every
// transcendental the generation path uses.
//
// Not in it: anything needing `three`, a GL context, a DOM, or a wall clock.
// Those are `boot.js` and `repeat.js`, and a digest that needed a browser would
// be a slower version of a test that already exists.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { arg, REPO } from './lib.js';

import { hash } from '../src/rng.js';
import { fbm, planetHeight, ridged, snoise } from '../src/terrain.js';
import { A_OPEN, A_START, COSMO } from '../src/cosmology.js';
import { buildModes, deformation, deltaLinear, displacement, eigenvalues, invariants } from '../src/zeldovich.js';
import { airmass, beamXYZ, planck, scatteredXYZ, toGamut, xyzToLinearSRGB } from '../src/starlight.js';
import { RINGS, density, keepProbability, ringB, ringK, shuffledIndices } from '../src/meadow.js';
import { ECO_RATE, ecologyAt, logistic, regionKey } from '../src/ecology.js';
import { WOOD, curvature, forkRadii, lengthOf, radiusForHeight } from '../src/tree.js';

// ---------------------------------------------------------------------------
// the accumulator
//
// Every number goes in as its eight IEEE bytes, so the digest is sensitive to
// the last bit rather than to however many decimals a formatter chose to print.

class Tape {
  constructor() { this.h = createHash('sha256'); this.n = 0; this.buf = new DataView(new ArrayBuffer(8)); }
  push(v) {
    if (typeof v !== 'number') throw new TypeError(`not a number: ${String(v)}`);
    if (Number.isNaN(v)) throw new RangeError(`NaN at sample ${this.n}`);
    // −0 and +0 are the same number and must not be two different digests
    this.buf.setFloat64(0, v === 0 ? 0 : v, false);
    this.h.update(new Uint8Array(this.buf.buffer));
    this.n++;
    return this;
  }
  all(xs) { for (const v of xs) this.push(v); return this; }
  /** a generated *name* is part of the universe too — regionKey returns one */
  str(v) { this.h.update(`\u0000${v}\u0000`); this.n++; return this; }
  get digest() { return this.h.digest('hex'); }
}

const SEEDS = [1138, 20250601, 1337146641, 0x5eed, 987654321];

// ---------------------------------------------------------------------------
// the suites. Each returns a Tape; each is a pure function of the constants
// above and of `src/`, and none of them may read a clock, a file or an
// environment variable.

const SUITES = {
  // exact integer arithmetic — this one should never move, and if it does the
  // problem is not the platform
  'hash · §2.3' () {
    const t = new Tape();
    for (const s of SEEDS) for (let i = 0; i < 64; i++) t.push(hash(s, i) >>> 0).push(hash(s, i, i * 7) >>> 0);
    return t;
  },

  // the height field §2.7 ports to GLSL, and the trap §11 names by name
  'terrain · §2.7' () {
    const t = new Tape();
    for (let i = 0; i < 400; i++) {
      const a = i * 0.0173, b = i * 0.0411, c = i * 0.0629;
      t.push(snoise(a, b, c)).push(fbm(a, b, c)).push(ridged(a, b, c));
      const l = Math.hypot(a + 1, b + 1, c + 1);
      t.push(planetHeight((a + 1) / l, (b + 1) / l, (c + 1) / l, 20250601));
    }
    return t;
  },

  // exp and pow in a loop, over the deep-time lever
  'cosmology · §M1' () {
    const t = new Tape();
    t.push(A_START).push(A_OPEN);
    for (const k of Object.keys(COSMO).sort()) if (typeof COSMO[k] === 'number') t.push(COSMO[k]);
    // the deep-time lever, swept: D(a) is what §M1 drives the shimmer from, and
    // growthRate is a bare `pow(x, 0.55)` — the single most exposed
    // transcendental in the project
    for (let a = A_START; a <= 3; a *= 1.06) {
      t.push(COSMO.growth(a)).push(COSMO.age(a)).push(COSMO.z(a))
        .push(COSMO.growthRate(a)).push(COSMO.E(a));
    }
    return t;
  },

  // the displacement field, its tensor, and the eigen-decomposition §M1 colours
  'zeldovich · §M1' () {
    const t = new Tape();
    const modes = buildModes(20250601, 1);
    const M = new Float64Array(6), ev = [0, 0, 0], d = [0, 0, 0];
    for (let i = 0; i < 120; i++) {
      const q = [(i % 7) / 7, ((i * 3) % 11) / 11, ((i * 5) % 13) / 13];
      t.all(displacement(modes, q, d));
      deformation(modes, q, M);
      t.all(M);
      t.all(eigenvalues(M, ev));
      t.push(deltaLinear(modes, q, 0.62));
      const inv = invariants(M, 0.62);
      t.all(Object.keys(inv).sort().map((k) => inv[k]).filter((v) => typeof v === 'number'));
    }
    return t;
  },

  // §9.6's transfer: the four sky stops are this function's output, and this is
  // where a libm difference would land first
  'starlight · §9.6' () {
    const t = new Tape();
    for (const T of [2400, 3800, 5778, 7200, 11000, 24000]) {
      for (let nm = 380; nm <= 730; nm += 10) t.push(planck(nm, T));
      for (const elev of [3, 8, 13.5, 24, 61]) {
        t.push(airmass(elev));
        t.all(toGamut(xyzToLinearSRGB(beamXYZ(T, elev))));
        for (const view of [0, 18, 45, 90]) t.all(toGamut(xyzToLinearSRGB(scatteredXYZ(T, elev, view))));
      }
    }
    return t;
  },

  // §M3's continuous density law — `pow(x, 1.5)` against the shader's
  // `x·x·inversesqrt(x)`, which is the identity the whole ring scheme rests on
  'meadow · §M3' () {
    const t = new Tape();
    for (let r = 0; r < RINGS.length; r++) {
      t.push(ringB(r)).push(ringK(r));
      for (let d = 0.5; d < 240; d *= 1.4) t.push(density(r, d)).push(keepProbability(r, d, 0.5));
    }
    t.all(shuffledIndices(20250601, 96));
    return t;
  },

  'ecology · §M6' () {
    const t = new Tape();
    t.push(ECO_RATE);
    for (let i = 0; i < 60; i++) {
      const l = Math.hypot(i + 1, i * 2 + 3, i * 3 + 5);
      const dir = [(i + 1) / l, (i * 2 + 3) / l, (i * 3 + 5) / l];
      t.str(regionKey(dir, 20250601));
      const e = ecologyAt(dir, 20250601, i * 11);
      t.all(Object.keys(e).sort().map((k) => e[k]).filter((v) => typeof v === 'number'));
      t.push(logistic(3, 900, i * 11));
    }
    return t;
  },

  'tree · §M2' () {
    const t = new Tape();
    for (const k of Object.keys(WOOD).sort()) if (typeof WOOD[k] === 'number') t.push(WOOD[k]);
    for (let h = 1; h < 40; h += 0.7) {
      const r = radiusForHeight(h);
      t.push(r).push(lengthOf(r)).push(curvature(r, h * 40));
      t.all(forkRadii(r, [0.6, 0.4]));
    }
    return t;
  },
};

// ---------------------------------------------------------------------------

const per = {};
const failures = [];
const roll = createHash('sha256');
let samples = 0;

for (const name of Object.keys(SUITES)) {
  try {
    const tape = SUITES[name]();
    per[name] = { sha256: tape.digest, samples: tape.n };
    samples += tape.n;
    roll.update(`${name}:${per[name].sha256}\n`);
    console.log(`  ${per[name].sha256.slice(0, 16)}  ${String(tape.n).padStart(6)} samples  ${name}`);
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
    console.error(`  ${'·'.repeat(16)}  ${'—'.padStart(6)}          ${name}  ← ${e.message}`);
  }
}

const report = {
  // the digest itself
  sha256: roll.digest('hex'),
  suites: per,
  samples,
  // and the machine, so a mismatch is a diagnosis rather than a mystery
  machine: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    endianness: (new Uint8Array(new Uint32Array([1]).buffer))[0] === 1 ? 'LE' : 'BE',
  },
};

if (failures.length) {
  console.error('\nA suite threw. The digest below is incomplete and must not be compared.');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(2);
}

console.log(`\ndigest · ${report.sha256}`);
console.log(`  ${samples} samples · ${report.machine.node} · V8 ${report.machine.v8}`
  + ` · ${report.machine.platform}/${report.machine.arch}`);

/** a path from the command line: absolute as given, relative to the repo
 *  otherwise. `join(REPO, '/tmp/x')` is `REPO/tmp/x`, which is a surprising
 *  place to write a file somebody asked for by absolute path. */
const where = (p) => (isAbsolute(String(p)) ? String(p) : join(REPO, String(p)));

const out = arg('json');
if (out) {
  const path = where(out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(`  written to ${out}`);
}

const expect = arg('expect');
if (expect) {
  const path = where(expect);
  if (!existsSync(path)) {
    console.error(`\nno baseline at ${expect} — write one with --json before asking for --expect`);
    process.exit(2);
  }
  const was = JSON.parse(readFileSync(path, 'utf8'));
  if (was.sha256 === report.sha256) {
    console.log(`  matches ${expect}, recorded on ${was.machine.node} · V8 ${was.machine.v8}`
      + ` · ${was.machine.platform}/${was.machine.arch}`);
  } else {
    console.error(`\n─── the universe moved ───`);
    console.error(`  baseline  ${was.sha256}   ${was.machine.node} V8 ${was.machine.v8} ${was.machine.platform}/${was.machine.arch}`);
    console.error(`  here      ${report.sha256}   ${report.machine.node} V8 ${report.machine.v8} ${report.machine.platform}/${report.machine.arch}`);
    for (const name of Object.keys(SUITES)) {
      const a = was.suites?.[name]?.sha256, b = per[name]?.sha256;
      if (a !== b) console.error(`  moved     ${name}${a ? '' : '   (not in the baseline)'}`);
    }
    console.error('\nThree things this can mean, and the versions above say which:');
    console.error('  · the generators changed — then update the baseline in the same commit');
    console.error('  · the engine changed — then §2.3\'s "forever" has a footnote worth writing down');
    console.error('  · a real determinism leak — then §11 called it, and every shared URL just moved');
    process.exit(1);
  }
}
