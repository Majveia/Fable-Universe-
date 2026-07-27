// The parse gate.
//
//   node tools/parse.js [--dir src] [--quiet]
//
// Every .js the browser loads, parsed before anything is launched. It exists
// because of one specific defect that has now cost two runs:
//
//     fragmentShader: /* glsl */`
//       ...
//       // a hand-rolled `fract(sin(...))` noise lands elsewhere
//                        ^ this backtick ends the template
//
// A backtick inside a GLSL template literal — in a *comment*, where nothing
// looks wrong — silently terminates the string and turns the rest of the
// shader into JavaScript. The module then fails to parse, `window.AEON` never
// appears, and every downstream tool reports the same useless symptom: the
// page did not boot. §11 already lists "shader strings" as a trap; this is the
// layer below it, where the string is not even a string yet.
//
// `node --check` is not the guard it looks like. Given a file containing an
// `import` statement it detects ESM, declines to parse, and exits 0 — so a
// broken module passes. Copying to .mjs makes it check for real, which is the
// whole trick here.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { arg, REPO } from './lib.js';

const dir = join(REPO, String(arg('dir', 'src')));
const quiet = arg('quiet') === true;

async function walk(d) {
  const out = [];
  for (const e of await readdir(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) out.push(...await walk(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out.sort();
}

const files = await walk(dir);
const tmp = mkdtempSync(join(tmpdir(), 'aeon-parse-'));
let failed = 0;

for (const f of files) {
  const rel = relative(REPO, f);
  // .mjs, so node parses it as a module instead of waving it through
  const shim = join(tmp, rel.replace(/[/\\]/g, '__').replace(/\.js$/, '.mjs'));
  copyFileSync(f, shim);
  const r = spawnSync(process.execPath, ['--check', shim], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed++;
    // node reports the shim's path and line; the line is right, the path is not
    console.error(`\n─── ${rel} ───`);
    console.error(String(r.stderr).split('\n').slice(0, 8)
      .map((l) => l.replace(shim, rel)).join('\n'));
  } else if (!quiet) {
    console.log(`  ok   ${rel}`);
  }
}

rmSync(tmp, { recursive: true, force: true });

console.log(`\nparse · ${files.length - failed}/${files.length} modules parse`
  + (failed ? ` · ${failed} FAILED` : ''));
process.exit(failed ? 1 : 0);
