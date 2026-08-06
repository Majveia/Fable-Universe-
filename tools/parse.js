// The parse gate.
//
//   node tools/parse.js [--dir src,tools] [--quiet]
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
//
// ---------------------------------------------------------------------------
// The second pass: undeclared built-ins in a RawShaderMaterial
//
// `ShaderMaterial` gets a preamble from three — `position`, `uv`, `normal`,
// `projectionMatrix`, `modelViewMatrix` and the rest are declared for you.
// `RawShaderMaterial` gets nothing, deliberately, and everything it uses it
// must declare itself.
//
// Forgetting one is a compile error that exists only after the material is
// instantiated, so it is invisible to every static tool and to any capture that
// does not reach the scale that builds it. It cost a full compile-gate run to
// find (`vUv = uv;` in a full-screen quad), and that run only found it because
// the gate had just been taught to reach the surface scale at all.
//
// This is the same check in two seconds instead of twenty minutes. It is a lint
// and it is deliberately conservative: it only looks at files that mention
// `RawShaderMaterial`, and only at template literals that write `gl_Position`.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { arg, REPO } from './lib.js';

const dirs = String(arg('dir', 'src,tools')).split(',').map((d) => join(REPO, d.trim()));
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
    // ...unless the marker is itself inside a comment. This file's own header
    // *illustrates* the defect, and the first version of this check duly
    // reported the illustration — a lint that cannot read a description of the
    // bug it looks for will be switched off by the first person it lies to.
    if (lines[s].trim().startsWith('//') || lines[s].trim().startsWith('*')) continue;
    for (let i = s + 1; i < lines.length; i++) {
      // An *escaped* backtick does not end a template, so it is not the defect.
      // src/material.js quotes identifiers that way inside its GLSL and this
      // check duly reported all three — a lint that cries wolf on correct code
      // is a lint somebody switches off, which costs more than it ever saved.
      const bare = lines[i].replace(/\\`/g, '');
      if (!bare.includes('`')) continue;
      if (lines[i].trim().startsWith('//')) hits.push({ line: i + 1, text: lines[i].trim() });
      break;   // backtick reached: the template ended here, one way or the other
    }
  }
  return hits;
}

const files = (await Promise.all(dirs.map(walk))).flat().sort();
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

// ---------------------------------------------------------------------------
// pass two — built-ins a RawShaderMaterial has to declare for itself

/** what three injects for a ShaderMaterial and withholds from a Raw one */
const BUILTINS = [
  'position', 'uv', 'normal', 'tangent', 'color',
  'projectionMatrix', 'modelViewMatrix', 'modelMatrix', 'viewMatrix',
  'normalMatrix', 'cameraPosition', 'instanceMatrix',
];

let lint = 0, linted = 0;
for (const f of files) {
  const rel = relative(REPO, f);
  const src = readFileSync(f, 'utf8');
  if (!src.includes('RawShaderMaterial')) continue;
  // every /* glsl */ template literal in the file that writes gl_Position
  for (const m of src.matchAll(/\/\* glsl \*\/`([\s\S]*?)`;/g)) {
    const body = m[1];
    if (!body.includes('gl_Position')) continue;
    linted++;
    // strip comments and interpolations — an interpolated chunk may legitimately
    // carry the declaration, and a comment is not a use
    const code = body
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const interpolated = /\$\{/.test(body);
    for (const name of BUILTINS) {
      const used = new RegExp(`\\b${name}\\b`).test(code.replace(
        new RegExp(`\\b(in|attribute|uniform|out|varying)\\s+\\w+\\s+${name}\\b`, 'g'), ''));
      if (!used) continue;
      const declared = new RegExp(`\\b(in|attribute|uniform)\\s+\\w+\\s+${name}\\b`).test(code);
      if (declared) continue;
      // an interpolated chunk might declare it; say so rather than failing
      if (interpolated) continue;
      lint++;
      console.error(`\n─── ${rel} ───`);
      console.error(`  RawShaderMaterial shader uses '${name}' without declaring it.`);
      console.error('  three injects nothing for a Raw material — declare it, or the');
      console.error('  program fails to compile the moment the material is built.');
    }
  }
}

console.log(`\nparse · ${files.length - failed}/${files.length} modules parse`
  + (failed ? ` · ${failed} FAILED` : '')
  + ` · ${linted} raw shaders linted`
  + (lint ? ` · ${lint} MISSING DECLARATIONS` : ''));
process.exit(failed || lint ? 1 : 0);
