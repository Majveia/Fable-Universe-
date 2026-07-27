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
    const dirty = git('status', '--porcelain').length > 0;
    let behind = null;
    try {
      const upstream = git('rev-parse', '--abbrev-ref', '@{upstream}');
      behind = Number(git('rev-list', '--count', `HEAD..${upstream}`));
    } catch { /* no upstream configured */ }
    return { head, subject, dirty, behind };
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

const steps = [
  ['verify', ['tools/verify.js'], 'the maths, against independent references (§7.3)'],
  ['shaders', ['tools/shadercheck.js'], 'every shader as the driver sees it (§M0)'],
  ['capture', ['tools/capture.js', '--milestone', milestone], 'the numbered set + perf JSON (§7.5)'],
  ['repeat', ['tools/repeat.js'], 'the same URL twice, to §7.3\'s tolerance'],
  ['gate', ['tools/gate.js', '--milestone', milestone, ...(extra ? ['--extra', extra] : [])],
    'the measurable gate clauses (§8)'],
];

const results = [];
for (const [name, args, what] of steps) {
  if (skip.includes(name)) { console.log(`\n· skipping ${name} — ${what}`); continue; }
  results.push(await run(`${name} — ${what}`, args));
}

// --------------------------------------------------------------- verdict ---

console.log(`\n${'═'.repeat(64)}\n  verdict\n${'═'.repeat(64)}`);
for (const r of results) {
  console.log(`  ${r.code === 0 ? 'pass' : 'FAIL'}  ${r.name.split(' — ')[0].padEnd(9)} ${String(r.secs).padStart(4)}s`
    + (r.code === 0 ? '' : `   exit ${r.code}`));
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
if (src) {
  console.log(`\n  commit  : ${src.head}${src.dirty ? ' + uncommitted changes' : ''}`);
  console.log(`            ${src.subject}`);
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
} else {
  console.log(`  hardware: ${gpu.name}`);
  console.log('  ✓ real GPU — these numbers count against §5 and the milestone gates.');
}

const failed = results.filter(r => r.code !== 0);
console.log();
process.exit(failed.length ? 1 : 0);
