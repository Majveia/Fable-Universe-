// The whole instrument, in one command.
//
//   node tools/check.js                     # everything, current milestone
//   node tools/check.js --milestone M1 --extra "m1=1&slab=1"
//   node tools/check.js --skip capture      # the fast half
//
// §7 runs offline-validate → capture → critique → gate in that order, and each
// of those already has a tool. This just runs them in the right order, stops
// caring about the ones that cannot fail, and prints one verdict — because the
// gate that matters is "does the whole thing still hold", and asking that four
// separate ways invites answering it three times.
//
// The verdict is honest about hardware. Everything here runs anywhere; only
// some of it *means* anything without a GPU, and the summary says which.

import { execFileSync, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { arg, REPO } from './lib.js';

/**
 * Which commit is being measured, and is it the current one?
 *
 * A run of stale code produces perfectly valid numbers about the wrong thing,
 * and nothing in the output would say so — the first two real-GPU runs of this
 * project were both taken from a branch that predated the fixes they were
 * meant to test, and the only clue was a missing word in a header. Same
 * discipline as `gateValid`: if the artefact cannot be trusted, the artefact
 * should say why.
 */
function provenance() {
  const git = (...a) => execFileSync('git', a, { cwd: REPO, encoding: 'utf8' }).trim();
  try {
    const head = git('rev-parse', '--short', 'HEAD');
    const subject = git('log', '-1', '--format=%s');
    // Which files differ matters more than whether any do. A dirty docs/ tree
    // changes nothing about a frame; a dirty src/ or tools/ tree means the
    // commit named above did not produce these numbers, and the first real-GPU
    // run of this project lost most of its value to exactly that — it reported
    // a §M1 clause failing with a message that had been deleted two commits
    // earlier, and a draw count the harness had already been fixed to get right.
    const status = git('status', '--porcelain');
    const touched = status.split('\n').filter(Boolean)
      .map((l) => l.slice(3).trim())
      .filter((p) => p.startsWith('src/') || p.startsWith('tools/'));
    let behind = null;
    try {
      const upstream = git('rev-parse', '--abbrev-ref', '@{upstream}');
      behind = Number(git('rev-list', '--count', `HEAD..${upstream}`));
    } catch { /* no upstream configured */ }
    return { head, subject, dirty: status.length > 0, touched, behind };
  } catch {
    return null;
  }
}

const milestone = String(arg('milestone', 'M1'));
const extra = arg('extra', '') === true ? '' : String(arg('extra', ''));
const skip = String(arg('skip', '') === true ? '' : arg('skip', '')).split(',').filter(Boolean);

const run = (name, args) => new Promise((done) => {
  console.log(`\n${'─'.repeat(64)}\n▶ ${name}\n${'─'.repeat(64)}`);
  const t0 = Date.now();
  const p = spawn(process.execPath, args, { cwd: REPO, stdio: 'inherit' });
  p.on('close', (code) => done({ name, code, secs: Math.round((Date.now() - t0) / 1000) }));
});

/**
 * A step may be **known-open**: a gate that fails today for a reason already
 * written down. §7.6 says a run below gate goes back to step 4 and, after five
 * iterations, escalates "with a written account of the blocking axis" — so the
 * account should live in the instrument rather than in somebody's memory.
 *
 * A known-open step reports `open` instead of `FAIL` and does not set the exit
 * code, which is the easy half. The half that matters is the other one: when it
 * starts *passing*, the verdict says so and tells you to delete the entry.
 * Otherwise a gate that was fixed months ago stays marked open forever, and the
 * list stops being an account of anything.
 */
const steps = [
  // first, because every step below it launches a browser to discover the same
  // thing more slowly: a module that does not parse looks exactly like a page
  // that would not boot
  ['parse', ['tools/parse.js', '--quiet'], 'every module the browser loads, parsed'],
  ['verify', ['tools/verify.js'], 'the maths, against independent references (§7.3)'],
  // §7.3 has two halves and this is the second: `verify` proves the CPU
  // reference has the properties §9 asks for, `pixeldiff` proves the shader
  // computes the same function. Neither implies the other — a chunk can be a
  // perfect port of a wrong reference, or a wrong port of a right one.
  ['pixeldiff', ['tools/pixeldiff.js'], '§2.7, on the exact gradient path (§7.3)'],
  // §2.7 on the path the build actually ships. Split out rather than folded
  // into the step above, so that one `open` is not covering two questions —
  // which is how a known-open entry stops being an account of anything.
  ['parity', ['tools/pixeldiff.js', '--suite', 'terrain'],
    '§2.7 on the shipped float gradient path',
    'the seven zero-h gradient cells: float32 and float64 land on opposite'
    + ' sides of all seven, so the pair disagrees on ~18% of samples. Closed by'
    + ' `?intnoise=1` and measured green there (the step above runs it); flipping'
    + ' the default moves every world once and re-takes the `ground` goldens,'
    + ' which docs/plans/M2.md §28.7 leaves to a human.'],
  ['shaders', ['tools/shadercheck.js'], 'every shader as the driver sees it (§M0)'],
  ['capture', ['tools/capture.js', '--milestone', milestone], 'the numbered set + perf JSON (§7.5)'],
  ['repeat', ['tools/repeat.js'], 'the same URL twice, to §7.3\'s tolerance'],
  // Held out of the run by the 2026-08-06 merge rather than deleted. It asserts
  // that alpha carries §9.3's **fog fraction**, and the `aerial()` this branch
  // kept writes **clarity** — the inverse. Re-pointing it is a few lines, but a
  // gate that measures the opposite of what ships is worse than an absent one,
  // so it waits for the same follow-up that ports `applyAerial`.
  // ['alphaudit', ['tools/alphaudit.js', ...(extra ? ['--extra', extra] : [])],
  //   '§9.3\'s fog fraction, composited (§16.6)'],
  ['gate', ['tools/gate.js', '--milestone', milestone, ...(extra ? ['--extra', extra] : [])],
    'the measurable gate clauses (§8)'],
];

const results = [];
for (const [name, args, what, open] of steps) {
  if (skip.includes(name)) { console.log(`\n· skipping ${name} — ${what}`); continue; }
  results.push({ ...await run(`${name} — ${what}`, args), open });
}

// --------------------------------------------------------------- verdict ---

console.log(`\n${'═'.repeat(64)}\n  verdict\n${'═'.repeat(64)}`);
for (const r of results) {
  const label = r.code === 0 ? 'pass' : (r.open ? 'open' : 'FAIL');
  console.log(`  ${label}  ${r.name.split(' — ')[0].padEnd(9)} ${String(r.secs).padStart(4)}s`
    + (r.code === 0 ? '' : `   exit ${r.code}`));
  if (r.code !== 0 && r.open) console.log(`          ${r.open}`);
}

// The half that keeps the open list honest.
const fixed = results.filter((r) => r.open && r.code === 0);
if (fixed.length) {
  console.log('\n  ✓ known-open, and now passing — remove the entry in tools/check.js:');
  for (const r of fixed) console.log(`      ${r.name.split(' — ')[0]}`);
}

// did any of it run on real silicon?
let gpu = null;
for (const f of [`docs/captures/${milestone}/perf-desktop.json`, 'docs/captures/shaders.json']) {
  try {
    const j = JSON.parse(await readFile(join(REPO, f), 'utf8'));
    const name = j.device?.renderer ?? j.renderer;
    if (name) { gpu = { name, software: j.device?.softwareRasterizer ?? j.softwareRasterizer }; break; }
  } catch { /* not written this run */ }
}

const src = provenance();
// A run is *attributable* when the numbers can be pinned to a commit. Editing
// and re-running is the normal loop, so a dirty tree is not a failure — but it
// does mean this run cannot score a gate, and saying so is the whole point.
const attributable = !src || (!src.touched.length && !(src.behind > 0));

if (src) {
  console.log(`\n  commit  : ${src.head}${src.dirty ? ' + uncommitted changes' : ''}`);
  console.log(`            ${src.subject}`);
  if (src.touched.length) {
    const show = src.touched.slice(0, 6).join(' · ');
    console.log(`  ⚠ ${src.touched.length} file${src.touched.length === 1 ? '' : 's'}`
      + ' under src/ or tools/ differ from that commit:');
    console.log(`      ${show}${src.touched.length > 6 ? ` · +${src.touched.length - 6} more` : ''}`);
    console.log('    Every number below describes those files, not the commit.');
  }
  if (src.behind > 0) {
    console.log(`  ⚠ this checkout is ${src.behind} commit${src.behind === 1 ? '' : 's'} behind its upstream.`);
    console.log('    The numbers below are real and describe code that has moved on.');
    console.log('    git pull, then run this again.');
  }
}

console.log();
if (!gpu) {
  console.log('  hardware: unknown — no run wrote a renderer string.');
} else if (gpu.software) {
  console.log(`  hardware: ${gpu.name}`);
  console.log('  ⚠ software rasteriser. Shapes are real, numbers are not.');
  console.log('    §M0 asks for a real GPU, and every artefact from this run is');
  console.log('    stamped gateValid:false. Do not quote it against §5.');
} else if (!attributable) {
  console.log(`  hardware: ${gpu.name}`);
  console.log('  ⚠ real GPU, but not this commit. The numbers are honest about the');
  console.log('    working tree that produced them and say nothing about the branch.');
  console.log('    Fine for iterating; it cannot score §5 or a milestone gate.');
} else {
  console.log(`  hardware: ${gpu.name}`);
  console.log('  ✓ real GPU, clean tree — these numbers count against §5 and the gates.');
}

// a known-open step is a recorded finding, not a regression
const failed = results.filter((r) => r.code !== 0 && !r.open);
console.log();
process.exit(failed.length ? 1 : 0);
