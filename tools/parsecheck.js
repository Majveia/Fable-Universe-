// Does every module in src/ and tools/ still parse as JavaScript?
//
// This exists because of a specific, repeatable, self-inflicted defect: this
// codebase assembles GLSL and CSS inside JS **template literals**, and a
// backtick written into a comment *inside* one of those literals terminates the
// string. The file then fails to parse, the scale that imports it never loads,
// and the only symptom is a blank frame plus one line in a console nobody is
// reading.
//
// It happened twice in one session — once in `src/touch.js`'s CSS block and
// once in `src/system.js`'s corona shader — both times in prose *about* the
// code rather than in the code, and both times invisible to every existing
// gate. `tools/shadercheck.js` compiles the shader strings, but it has to
// import the module to reach them, so a module that will not parse is exactly
// the case it cannot report. `tools/verify.js` imports about a third of the
// tree and would have caught those two; it does not import the other two
// thirds, which includes every file that only a browser ever loads.
//
// §11 already lists "shader strings — compile-check post-assembly" as a known
// trap. This is the trap one level below it: check that the file the shader
// lives in is a file at all.
//
//     node tools/parsecheck.js
//
// It shells out to `node --input-type=module --check` once per file rather than
// parsing in-process. `vm.SourceTextModule` would be faster and needs
// --experimental-vm-modules to exist at all, and a gate that silently degrades
// when you forget a flag is a gate that reports success by default. `new
// Function` is not an option either — it cannot parse top-level await or
// `import.meta`, both of which are in this tree. A subprocess is unambiguous:
// it is the same parser the browser's would have to agree with.

import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Parse one file as an ES module, via stdin.
 *
 * Stdin rather than a path argument, because `--input-type=module` and a file
 * argument are mutually exclusive — node rejects the pair outright. And the
 * flag is not optional: this repo has no `package.json` (§2.2, deliberately),
 * so node infers CommonJS for a bare `.js` path and every `import` in the tree
 * reads as a syntax error. Feeding the source in and declaring its type is the
 * only combination that asks the question actually being asked.
 */
const parses = (src) => new Promise((done) => {
  const p = spawn(process.execPath, ['--input-type=module', '--check'],
    { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => done(code === 0 ? null : err));
  p.stdin.end(src);
});

const REPO = resolve(fileURLToPath(new URL('../', import.meta.url)));
const DIRS = ['src', 'tools'];

const files = [];
for (const dir of DIRS) {
  for (const name of (await readdir(join(REPO, dir))).sort()) {
    if (name.endsWith('.js')) files.push([dir, name, join(REPO, dir, name)]);
  }
}

const results = await Promise.all(files.map(async ([dir, name, path]) => {
  const err = await parses(await readFile(path, 'utf8'));
  if (!err) return null;
  // node prints the offending line, a caret, and the reason; those three are
  // the whole of what a reader needs, and the stack below them is noise
  const msg = err.split('\n').filter((l) => l.trim())
    .filter((l) => !/^\s+at /.test(l)).slice(0, 3).join('\n        ');
  return [`${dir}/${name}`, msg];
}));

const bad = results.filter(Boolean);
for (const [f, msg] of bad) console.error(`  FAIL  ${f}\n        ${msg}`);
console.log(`\n${files.length - bad.length}/${files.length} modules parse`);
process.exit(bad.length ? 1 : 0);
