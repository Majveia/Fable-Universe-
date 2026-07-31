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
//
// ---------------------------------------------------------------------------
// And parsing is only half the guard, which cost a third run to find out
//
// The defect above is caught only when the corruption happens to produce
// *invalid* JavaScript. It often does not. This one parses clean:
//
//     float dist = (raw < 1.0e6) ? raw : 1.0e6;
//     // so `< 1e6` catches NaN and overflow in one step
//              ^ ends the template            ^ starts a tagged template
//
// The file is valid JavaScript. `node --check` passes it, this tool reported
// 61/61, and the module threw `1000000 is not a function` on import — a runtime
// error with no relationship to the line that caused it.
//
// So there is a second, text-level pass: **inside a GLSL template, a `//`
// comment containing a backtick is the defect.** A legitimate closing backtick
// is never inside a comment, and the prose convention in this repo is to quote
// identifiers in backticks — which is exactly why the two keep colliding.
//
// It stops scanning a template at the first line bearing a backtick, so a
// template whose interpolation opens a nested one on the same line is scanned
// only up to that point. That is a false negative and never a false positive,
// which is the right way round for a lint that gates a commit.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, rmSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
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

/** a backtick inside a `//` comment inside a GLSL template — see the header */
function strayBackticks(src) {
  const lines = src.split('\n');
  const hits = [];
  for (let s = 0; s < lines.length; s++) {
    if (!/\/\*\s*glsl\s*\*\/\s*`/.test(lines[s])) continue;
    for (let i = s + 1; i < lines.length; i++) {
      if (!lines[i].includes('`')) continue;
      if (lines[i].trim().startsWith('//')) hits.push({ line: i + 1, text: lines[i].trim() });
      break;   // backtick reached: the template ended here, one way or the other
    }
  }
  return hits;
}

const files = await walk(dir);
const tmp = mkdtempSync(join(tmpdir(), 'aeon-parse-'));
let failed = 0;

for (const f of files) {
  const rel = relative(REPO, f);
  const stray = strayBackticks(await readFile(f, 'utf8'));
  if (stray.length) {
    failed++;
    console.error(`\n─── ${rel} ───`);
    for (const h of stray) {
      console.error(`${rel}:${h.line}  a backtick in a comment inside a GLSL template`);
      console.error(`    ${h.text.slice(0, 96)}`);
    }
    console.error('  This ends the template. Whatever follows is parsed as JavaScript —\n'
      + '  sometimes invalidly, sometimes not, and the second kind reaches the browser.');
    continue;
  }
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
