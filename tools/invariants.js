// The invariants, machine-checked — CLAUDE.md §2.
//
//   node tools/invariants.js [--quiet] [--census]
//
// §2 opens with a sentence no other gate in this directory acts on:
//
//   "Violating any of these is a revert, not a discussion."
//
// Nine clauses, described as non-negotiable, and until this file existed not
// one of them was checked by anything. `verify.js` proves the arithmetic,
// `parse.js` proves the modules parse, `shadercheck.js` proves the shaders
// assemble — and a commit adding a 4 MB PNG to `src/`, a `package.json` to the
// root, or a bare `Math.random()` to a generation path would have gone through
// all three green. The clauses that are hardest to walk back were the ones
// nothing was watching.
//
// So this is the cheapest gate in the repo and deliberately the first to run:
// no browser, no network, no install, under a second, and every failure names
// the clause it broke and the line that broke it.
//
// ---------------------------------------------------------------------------
// What it can and cannot decide
//
// Four clauses are decidable from the bytes on disk:
//
//   §2.1 zero runtime assets   — a file is an asset or it is not
//   §2.2 zero dependencies     — a manifest exists or it does not
//   §2.3 determinism           — an entropy source is called or it is not
//   §4   the removed mechanic  — a crater is carved on a keypress or it is not
//
// The rest are not, and this file must never imply otherwise. §2.4 (every place
// is a URL) needs the route walked; §2.5 (continuity) and §2.8 (black belongs
// to vacuum) need frames; §2.6 (precision discipline) needs the planet at
// walking scale; §2.7 (GLSL↔JS parity) is `tools/pixeldiff.js` and needs a GPU.
// `docs/notes/ci.md` keeps the map of which gate answers which clause —
// including the clauses no gate answers yet, which is the more useful half.
//
// ---------------------------------------------------------------------------
// §2.3 is a ratchet, not a ban
//
// The naive form — "no `performance.now()` in `src/`" — is wrong, and wrong in
// the direction that gets a lint deleted. `bench.js` has to read the clock; it
// measures frame time. `city.js` reads it to stop generating at a millisecond
// budget. `input.js` timestamps a pointer so a tap can be told from a drag.
// None of those is a determinism leak, and a gate that calls them one will be
// switched off inside a week.
//
// It is also wrong in the other direction, which matters more. §11 names the
// real failure: "any Math.random(), wall-clock read, or iteration-order
// dependency *in a generation path*." Whether a call site is in a generation
// path is a judgement, and no regex makes it.
//
// So the judgement is made once, by a human, and recorded here: every existing
// site listed with a count and a reason. The gate never asks whether a call is
// legitimate — it asks whether it is *new*. A new one fails, and the fix is
// either to delete it or to add a line to the table saying why it is not a
// leak. That is a five-second edit and a reviewable one, which is the whole
// design: the price of the exception is that somebody writes down the reason.
//
// `--census` prints every site it can see, which is how the table is kept
// honest when a file legitimately changes shape.
//
// ---------------------------------------------------------------------------
// Counting only code, and proving it
//
// Every check reads code — never comments, never strings. That is not
// fastidiousness. `src/` mentions `Math.random` eight times in prose, all of
// them in comments explaining why it is not used, so a grep-shaped gate would
// report the repo's own documentation of the rule as a violation of it. The
// GLSL is worse: `texelFetch(` lives inside template literals in nine modules
// and reads as a network call to anything scanning raw text.
//
// `strip()` replaces every comment, string and regex body with spaces of the
// same length, so line numbers survive and nothing inside quotes is ever seen.
// Template literals nest — ``${`${x}`}`` is code inside string inside code —
// and it tracks that with a stack. Regex literals are the hard case, because
// `/` is also division: it resolves them by expression position, which is the
// standard heuristic and is the reason `bench.js` and `quality.js` are scanned
// at all rather than skipped as untokenisable. Those two hold the only regex
// literals in `src/`, and they also hold five of the repo's clock reads, so
// "skip what I cannot parse" would have quietly excused exactly the file the
// §2.3 ratchet most needs to watch.
//
// A heuristic that decides how many clock reads a file is allowed has to be
// worth trusting, so it is tested before it is used: `SELFTEST` below runs
// twelve snippets — division against regex, a backtick in a comment, a comment
// marker inside a string, an interpolation inside a template inside an
// interpolation — through `strip()` on every run. If any of them comes out
// wrong the tool exits 2 and reports nothing. A count from a tokeniser that is
// guessing is worse than no count, because it looks like evidence.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { arg, REPO } from './lib.js';

const quiet = arg('quiet') === true;
const census = arg('census') === true;
const problems = [];
const notes = [];
let checks = 0;

const fail = (clause, where, what, why) => problems.push({ clause, where, what, why });
const ok = (n = 1) => { checks += n; };

// ---------------------------------------------------------------------------
// the tokeniser

// After one of these, a `/` opens a regex literal. After anything else — an
// identifier, a number, `)`, `]` — it is division. `}` is the genuinely
// ambiguous one (block end vs. object literal end) and is treated as division,
// which is the common case; `src/` has no counter-example and `ambiguity()`
// below reports one if it ever appears.
const REGEX_AFTER = new Set([...'=(,:[!&|?{;+-*%<>~^', '\n', undefined]);
const REGEX_AFTER_WORD = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'case', 'do', 'else', 'yield', 'await', 'throw',
]);

/** comments, string bodies and regex bodies replaced by spaces; newlines kept,
 *  so a line number in the output still points at the line in the file */
function strip(src) {
  const out = Array.from(src);
  const blank = (a, b) => { for (let i = a; i < b && i < out.length; i++) if (out[i] !== '\n') out[i] = ' '; };
  const stack = [];                       // 'tpl' inside a template, 'code' inside its ${}
  let prev = undefined;                   // last significant code character
  let prevWord = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    const inString = stack.length > 0 && stack[stack.length - 1] === 'tpl';
    if (inString) {
      if (c === '\\') { blank(i, i + 2); i += 2; continue; }
      if (c === '`') { stack.pop(); out[i] = ' '; prev = '`'; prevWord = ''; i++; continue; }
      if (c === '$' && d === '{') { stack.push('code'); blank(i, i + 2); prev = '{'; prevWord = ''; i += 2; continue; }
      if (c !== '\n') out[i] = ' ';
      i++; continue;
    }
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      blank(i, j + 1); prev = c; prevWord = ''; i = j + 1; continue;
    }
    if (c === '`') { stack.push('tpl'); out[i] = ' '; i++; continue; }
    if (c === '}' && stack.length && stack[stack.length - 1] === 'code') { stack.pop(); out[i] = ' '; prev = '`'; prevWord = ''; i++; continue; }
    if (c === '/' && (REGEX_AFTER.has(prev) || REGEX_AFTER_WORD.has(prevWord))) {
      // a regex literal: run to the unescaped closing `/`, respecting classes
      let j = i + 1, cls = false, closed = false;
      for (; j < src.length && src[j] !== '\n'; j++) {
        const k = src[j];
        if (k === '\\') { j++; continue; }
        if (k === '[') cls = true;
        else if (k === ']') cls = false;
        else if (k === '/' && !cls) { closed = true; break; }
      }
      if (closed) {
        while (j + 1 < src.length && /[gimsuyd]/.test(src[j + 1])) j++;
        blank(i, j + 1); prev = ')'; prevWord = ''; i = j + 1; continue;
      }
      // unterminated on this line: it was division after all
    }
    if (/\S/.test(c)) { prev = c; prevWord = /[\w$]/.test(c) ? prevWord + c : ''; }
    i++;
  }
  return out.join('');
}

/** the one construct `strip()` guesses at: a `}` in code immediately followed
 *  by `/`, where block-end-then-regex and object-end-then-division look the
 *  same. Asked of the *stripped* text, so that `${x}/s` inside a template —
 *  planetscale.js has one — is not mistaken for the ambiguous case it is not. */
function ambiguity(src) {
  return /\}\s*\/(?![/*=\s])/.test(strip(src));
}

// ---------------------------------------------------------------------------
// twelve snippets, run on every invocation. See the header: a count from a
// tokeniser that is guessing is worse than no count.

const SELFTEST = [
  ['const a = b / c / d;', 'b', 'keeps division'],
  ['if (!/webgl/i.test(s)) x();', '!', 'blanks a regex after !'],
  ['const r = /swift|llvm/i;', 'const r =', 'blanks a regex after ='],
  ['x = y & /^[0-3]$/.test(z);', '&', 'blanks a regex with a character class'],
  ['const s = "a // b"; c();', 'c()', 'a comment marker inside a string is not a comment'],
  ["const s = 'it\\'s'; c();", 'c()', 'an escaped quote does not end a string'],
  ['// Math.random() in prose\nq();', 'q()', 'a comment is not code'],
  ['/* Math.random() */ q();', 'q()', 'a block comment is not code'],
  ['const g = `a ${b} c`; q();', 'q()', 'a template is not code'],
  ['const g = `a ${ `${d}` } c`; q();', 'q()', 'templates nest'],
  ['const g = `// ` + q();', 'q()', 'a comment marker inside a template does not comment out the rest'],
  ['const g = `x` / 2; q();', 'q()', 'division straight after a template'],
];

const BANNED = /Math\s*\.\s*random|webgl|swift|llvm|\^\[0-3\]|it\\?'s|\/\/ b/;
for (const [snippet, must, why] of SELFTEST) {
  const got = strip(snippet);
  if (got.length !== snippet.length || !got.includes(must) || BANNED.test(got)) {
    console.error('tokeniser self-test failed: ' + why);
    console.error('  in   ' + JSON.stringify(snippet));
    console.error('  out  ' + JSON.stringify(got));
    console.error('\nEvery count below would be a guess. Fix strip() before trusting this gate.');
    process.exit(2);
  }
}
ok(SELFTEST.length);

/** every match of `re` in the *code* of `src`, as {line, text} */
function sites(src, re) {
  const code = strip(src);
  const lines = src.split('\n');
  const hits = [];
  for (const m of code.matchAll(re)) {
    const line = code.slice(0, m.index).split('\n').length;
    hits.push({ line, text: (lines[line - 1] || '').trim().slice(0, 88) });
  }
  return hits;
}

function walk(dir, pred = () => true) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, pred));
    else if (pred(p)) out.push(p);
  }
  return out.sort();
}

const rel = (p) => relative(REPO, p).replace(/\\/g, '/');
const js = (p) => p.endsWith('.js');

// everything a browser reaches when it loads AEON. Deliberately not `docs/`,
// which carries the art reference, the capture sets and the plans — none of
// which ship, and one of which is a 280 KB HTML file full of the very
// constructs this gate forbids.
const SHIPPED_DIRS = [join(REPO, 'src'), join(REPO, 'vendor')];
const SHIPPED = [join(REPO, 'index.html'), ...SHIPPED_DIRS.flatMap((d) => walk(d))];

const source = new Map();
const read = (p) => { if (!source.has(p)) source.set(p, readFileSync(p, 'utf8')); return source.get(p); };

for (const f of SHIPPED.filter(js)) {
  if (ambiguity(read(f))) notes.push(`${rel(f)}: '}' followed by '/' — strip() reads it as division; check that it is`);
}

// ---------------------------------------------------------------------------
// §2.1 · zero runtime assets
//
//   "No image files, no GLTF, no audio samples, no web fonts, no network
//    calls. Every texture is generated on-device at init from hash(seed, …)."
//
// Extension *and* magic bytes, because the interesting way this breaks is not
// somebody committing `grass.png` — it is a 900 KB height map arriving as
// `heights.dat`, or as base64 inside a string, where nothing about the name
// says what it is.

const ASSET_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.tga', '.tif', '.tiff',
  '.hdr', '.exr', '.dds', '.ktx', '.ktx2', '.basis', '.bin', '.glb', '.gltf', '.fbx',
  '.obj', '.dae', '.stl', '.ply', '.mp3', '.ogg', '.wav', '.flac', '.m4a', '.opus',
  '.mp4', '.webm', '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

const MAGIC = [
  ['PNG', [0x89, 0x50, 0x4e, 0x47]],
  ['JPEG', [0xff, 0xd8, 0xff]],
  ['GIF', [0x47, 0x49, 0x46, 0x38]],
  ['glTF binary', [0x67, 0x6c, 0x54, 0x46]],
  ['OGG', [0x4f, 0x67, 0x67, 0x53]],
  ['RIFF — wav or webp', [0x52, 0x49, 0x46, 0x46]],
  ['WOFF', [0x77, 0x4f, 0x46, 0x46]],
  ['WOFF2', [0x77, 0x4f, 0x46, 0x32]],
  ['TrueType', [0x00, 0x01, 0x00, 0x00, 0x00]],
  ['a zip container — ktx2, or a font', [0x50, 0x4b, 0x03, 0x04]],
];

for (const f of SHIPPED) {
  ok();
  const ext = extname(f).toLowerCase();
  if (ASSET_EXT.has(ext)) {
    fail('§2.1', rel(f), `a ${ext} asset in the shipped tree`,
      'Every texture is generated on-device from hash(seed, …). A file like this is bytes shipped.');
    continue;
  }
  const head = readFileSync(f).subarray(0, 8);
  for (const [name, sig] of MAGIC) {
    if (sig.every((b, k) => head[k] === b)) {
      fail('§2.1', rel(f), `${name} data under a source extension`,
        'Renaming an asset does not make it generated. §2.1 is about the bytes, not the suffix.');
    }
  }
}

// a texture smuggled in as base64. index.html's favicon is a 150-byte inline
// SVG and is not what this looks for; anything kilobytes long is an asset
// wearing a string.
const DATA_URI_MAX = 2048;
for (const f of SHIPPED.filter((p) => js(p) || p.endsWith('.html'))) {
  ok();
  for (const m of read(f).matchAll(/data:([a-z/+-]+);base64,([A-Za-z0-9+/=]+)/g)) {
    if (m[2].length <= DATA_URI_MAX) continue;
    fail('§2.1', rel(f), `a ${(m[2].length / 1024).toFixed(1)} KB base64 ${m[1]} data URI`,
      'Zero assets means zero asset *bytes*, however they are spelled.');
  }
}

// §2.1's other half: no network calls. Code only — `texelFetch(` in the GLSL is
// a texture read, lives inside a template literal, and strip() has removed it.
const NETWORK = [
  [/(?<![\w.$])fetch\s*\(/g, 'fetch()'],
  [/\bnew\s+XMLHttpRequest\b/g, 'XMLHttpRequest'],
  [/\bnew\s+WebSocket\b/g, 'WebSocket'],
  [/\bnew\s+EventSource\b/g, 'EventSource'],
  [/\bnavigator\s*\.\s*sendBeacon\b/g, 'sendBeacon'],
  [/\bimportScripts\s*\(/g, 'importScripts()'],
];
//
// `vendor/` is exempt from this one and only this one, and the reason is worth
// stating rather than quietly excluding a directory: three r170 ships a
// `FileLoader` and it calls `fetch`. AEON never constructs one. The meaningful
// question is not whether the library *contains* a loader — it does, it is a
// library — but whether AEON ever reaches it, and that is asked below, of
// `src/`, where it can be answered.
for (const f of SHIPPED.filter(js).filter((p) => !rel(p).startsWith('vendor/'))) {
  ok();
  for (const [re, what] of NETWORK) {
    for (const h of sites(read(f), re)) {
      fail('§2.1', `${rel(f)}:${h.line}`, `${what} in shipped code`,
        'AEON makes no network calls. Whatever this wants, generate it.');
    }
  }
}

// three's loaders, which is how the network would actually get in. Not one of
// these is constructed anywhere in `src/` today; every texture is built from
// `hash(seed, …)` into a DataTexture, which is §2.1 working as designed.
const LOADERS = /\bnew\s+(?:THREE\s*\.\s*)?(FileLoader|TextureLoader|ImageLoader|ImageBitmapLoader|CubeTextureLoader|DataTextureLoader|AudioLoader|FontLoader|ObjectLoader|MaterialLoader|BufferGeometryLoader|GLTFLoader|OBJLoader|FBXLoader|DRACOLoader|KTX2Loader|RGBELoader|EXRLoader)\b/g;
for (const f of walk(join(REPO, 'src'), js)) {
  ok();
  for (const h of sites(read(f), LOADERS)) {
    fail('§2.1', `${rel(f)}:${h.line}`, h.text.match(LOADERS)?.[0] ?? 'a three loader',
      'A loader loads something, and there is nothing to load. §2.1: every texture is generated on-device at init.');
  }
}

// a URL that is *loaded* rather than merely mentioned: a stylesheet, a font, an
// importmap entry. Prose in a comment is not a violation, and strip() has
// already dropped it.
for (const f of SHIPPED.filter((p) => p.endsWith('.html'))) {
  ok();
  const src = read(f);
  if (/@font-face/i.test(src)) {
    fail('§2.1', rel(f), '@font-face', 'A web font is an asset, and §2.1 names it.');
  }
  for (const m of src.matchAll(/<link[^>]+href\s*=\s*["']https?:\/\/[^"']+/gi)) {
    fail('§2.1', rel(f), m[0].slice(0, 70), 'A remote stylesheet or font is a network call at first paint.');
  }
  for (const m of src.matchAll(/"(three[^"]*)"\s*:\s*"(https?:\/\/[^"]+)"/g)) {
    fail('§2.2', rel(f), `importmap '${m[1]}' → ${m[2]}`,
      'The importmap must point into /vendor. A CDN entry is a dependency and a network call at once.');
  }
}

// ---------------------------------------------------------------------------
// §2.2 · zero dependencies
//
//   "Zero dependencies beyond vendored three@r170 in /vendor. No npm at
//    runtime, no bundler. `python3 -m http.server 8080` must remain
//    sufficient, forever."
//
// `tools/README.md` puts it more sharply: "the moment this directory grows a
// manifest, somebody starts believing the repo has a build step." So the
// manifest itself is the violation, wherever it lands.

const MANIFESTS = [
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb',
  'tsconfig.json', 'jsconfig.json', 'vite.config.js', 'webpack.config.js',
  'rollup.config.js', 'esbuild.config.js', '.babelrc', 'babel.config.js',
];
for (const name of MANIFESTS) {
  ok();
  for (const dir of [REPO, join(REPO, 'src'), join(REPO, 'tools'), join(REPO, 'vendor')]) {
    if (!existsSync(join(dir, name))) continue;
    fail('§2.2', rel(join(dir, name)), 'a package manifest',
      'No manifest, no lockfile, no build step. A static server must remain sufficient, forever.');
  }
}
ok();
if (existsSync(join(REPO, 'node_modules'))) {
  fail('§2.2', 'node_modules/', 'installed dependencies inside the repo',
    'The instruments install globally, deliberately. Nothing is installed *into* AEON.');
}

// every specifier the browser will have to resolve. Relative paths are files on
// disk; `three` and `three/addons/` are the importmap. Anything else is a bare
// specifier no browser can resolve — which means a broken page, or a bundler
// nobody agreed to.
const IMPORTMAP_KEYS = ['three', 'three/addons/'];
for (const f of SHIPPED.filter(js)) {
  ok();
  for (const h of sites(read(f), /(?:^|[\s;}])(?:import|export)\b[^;\n]*?from\s*['"][^'"]+['"]/gm)) {
    const spec = (h.text.match(/from\s*['"]([^'"]+)['"]/) || [])[1];
    if (!spec || spec.startsWith('.') || spec.startsWith('/')) continue;
    if (IMPORTMAP_KEYS.some((k) => spec === k || spec.startsWith(k))) continue;
    fail('§2.2', `${rel(f)}:${h.line}`, `bare specifier '${spec}'`,
      'Not relative, and not in the importmap. The browser cannot resolve this without a bundler.');
  }
}

// ---------------------------------------------------------------------------
// §2.3 · determinism
//
//   "Same seed + same code = same universe on every machine, forever. No
//    Math.random(), no Date.now(), no un-seeded performance.now() in any
//    generation path. src/rng.js is the only entropy source."
//
// The table is the ratchet described in the header: one row per file that
// legitimately reads entropy, with a count and a reason.

const ENTROPY = [
  [/(?<![\w.$])Math\s*\.\s*random\s*\(/g, 'Math.random()'],
  [/(?<![\w.$])Date\s*\.\s*now\s*\(/g, 'Date.now()'],
  [/(?<![\w.$])performance\s*\.\s*now\s*\(/g, 'performance.now()'],
  [/(?<![\w.$])new\s+Date\s*\(\s*\)/g, 'new Date()'],
  [/(?<![\w.$])crypto\s*\.\s*getRandomValues\s*\(/g, 'crypto.getRandomValues()'],
];

// file → [ceiling, why]. A ceiling rather than an exact count, so that adding a
// *sixth* clock read to a file that legitimately has five still asks somebody
// the question.
const ENTROPY_ALLOWED = {
  'src/main.js': [3, 'one crypto draw picks which universe an unpinned visit lands in — everything after it is a function of that seed — plus frame pacing and the logbook timestamp §4 sanctions'],
  'src/bench.js': [4, 'the harness measures frame time; a clock is the instrument (§5)'],
  'src/surface.js': [6, 'landing, wind and horizon solve timings, logged only — every site carries the §2.3 note in place'],
  'src/city.js': [2, 'generation runs against a millisecond budget and stops; the clock bounds the work, it never enters the result'],
  'src/quadtree.js': [2, 'worker build time, reported to the HUD, never read back into a tile'],
  'src/input.js': [2, 'a pointer timestamp, so a tap can be told from a drag'],
  'src/touch.js': [3, 'the same question on the M7 layer: a tap, a drag, and the idle fade'],
};

// Two absences worth recording, because both look like oversights and are not.
// `src/hud.js` fades the chrome after four seconds (§3) and reads no clock to
// do it — it runs on dt from the frame loop. `src/clock.js`, the module whose
// whole subject is time, reads nothing either: it is an accumulator, and its
// own header explains the distinction this table is built on — a wall-clock
// read that measures *elapsed real time* is a different thing from one that
// enters a frame. Neither file has a row, and neither should acquire one.

for (const f of walk(join(REPO, 'src'), js)) {
  ok();
  const src = read(f);
  const name = rel(f);
  const found = ENTROPY.flatMap(([re, what]) => sites(src, re).map((h) => ({ ...h, what })));
  if (census && found.length) {
    console.log(`  census  ${name} — ${found.length}`);
    for (const h of found) console.log(`            :${h.line}  ${h.what}  ${h.text}`);
  }
  const [allowed, why] = ENTROPY_ALLOWED[name] || [0, null];
  if (found.length <= allowed) {
    if (allowed && found.length < allowed) {
      notes.push(`${name}: ${found.length} of ${allowed} allowed entropy sites — the allowance can ratchet down`);
    }
    continue;
  }
  for (const h of found.slice(allowed)) {
    fail('§2.3', `${name}:${h.line}`, `${h.what} — beyond this file's allowance of ${allowed}`,
      why
        ? `${name} is allowed ${allowed}: ${why}. This one is extra. Remove it, or raise the count in tools/invariants.js and say why.`
        : 'src/rng.js is the only entropy source. If this is not a generation path, add the file to ENTROPY_ALLOWED with a reason.');
  }
}

// ---------------------------------------------------------------------------
// §4 · the mechanic that was removed stays removed
//
//   "No meteor-strike mechanic. Remove the X impact + runtime crater-baking
//    path from src/surface.js. Ancient craters on airless worlds stay —
//    generation, not mechanics."
//
// A clause that says "remove" needs a guard, or it is a note about one
// afternoon. And the distinction §4 draws is exact enough to check: craters may
// be carved by world generation and by nothing else. `_initImpacts` stamps them
// into an airless world at build time; a second caller — or any mention of the
// carve from an input layer — is the mechanic coming back.

{
  ok();
  const src = strip(read(join(REPO, 'src/surface.js')));
  const mentions = [...src.matchAll(/_carveCrater\s*\(/g)].length;
  const definition = /_carveCrater\s*\(\s*x\s*,/.test(src) ? 1 : 0;
  if (mentions - definition > 1) {
    fail('§4', 'src/surface.js', `${mentions - definition} callers of _carveCrater`,
      'One, from _initImpacts, is generation — history the ground remembers. A second is weather, and §4 deleted it.');
  }
  for (const f of ['src/input.js', 'src/main.js', 'src/hud.js', 'src/touch.js']) {
    ok();
    if (/carveCrater|meteorStrike|strikeAt/.test(strip(read(join(REPO, f))))) {
      fail('§4', f, 'an input path reaching the crater code',
        'A key that makes a crater is the mechanic §4 removed. The verbs are travel and look.');
    }
  }
}

// ---------------------------------------------------------------------------
// §10 · provenance — the reference has to be the file somebody actually read
//
// §9 defers to it outright: "When this section and the reference disagree, the
// reference wins — read it." §10 and `docs/reference/README.md` both turn on
// the file being byte-exact with the export, and the README records the SHA-256
// that says so. Nothing checked it, which makes it a claim rather than a fact.
//
// The hashes are read *out of the README* rather than copied here, so the
// record stays in one place and this is a comparison rather than a second copy
// to keep in sync.

{
  const readmePath = join(REPO, 'docs/reference/README.md');
  if (existsSync(readmePath)) {
    const readme = read(readmePath);
    const want = new Map();
    const solo = readme.match(/\*\*SHA-256\*\*\s*\|\s*`([0-9a-f]{64})`/);
    if (solo) want.set('docs/reference/hoshi-no-tani.html', solo[1]);
    for (const m of readme.matchAll(/`(vendor\/[^`]+)`\s*\|\s*[\d,]+\s*B\s*·\s*`([0-9a-f]{64})`/g)) {
      want.set(`docs/reference/${m[1]}`, m[2]);
    }
    if (!want.size) {
      fail('§10', 'docs/reference/README.md', 'no SHA-256 could be read from the provenance record',
        'The record is the check that nobody quietly edited the source of truth. A record this gate cannot read is not one.');
    }
    for (const [path, sha] of want) {
      ok();
      const full = join(REPO, path);
      if (!existsSync(full)) {
        fail('§10', path, 'named in docs/reference/README.md, absent from disk',
          'The provenance record points at a file that is not there.');
        continue;
      }
      const got = createHash('sha256').update(readFileSync(full)).digest('hex');
      if (got !== sha) {
        fail('§10', path, 'SHA-256 does not match the provenance record',
          `README says ${sha.slice(0, 16)}…, disk says ${got.slice(0, 16)}…. Either somebody edited `
          + 'the source of truth, or the record is stale — and both deserve a commit message that says so.');
      }
    }
    ok();
    const bytes = readme.match(/\*\*Bytes\*\*\s*\|\s*([\d,]+)/);
    const ref = join(REPO, 'docs/reference/hoshi-no-tani.html');
    if (bytes && existsSync(ref)) {
      const wantBytes = +bytes[1].replace(/,/g, '');
      const gotBytes = statSync(ref).size;
      if (wantBytes !== gotBytes) {
        fail('§10', 'docs/reference/hoshi-no-tani.html', `${gotBytes} bytes on disk, ${wantBytes} in the record`,
          'The byte count is part of the same record, and it moved with the file.');
      }
    }
  }
}

// ---------------------------------------------------------------------------

if (!quiet) for (const n of notes) console.log(`  note  ${n}`);

if (problems.length) {
  const byClause = new Map();
  for (const p of problems) byClause.set(p.clause, [...(byClause.get(p.clause) || []), p]);
  for (const [clause, list] of byClause) {
    console.error(`\n─── ${clause} ───`);
    for (const p of list) {
      console.error(`  ${p.where}`);
      console.error(`      ${p.what}`);
      console.error(`      ${p.why}`);
    }
  }
  console.error('\n§2 opens: "Violating any of these is a revert, not a discussion."');
}

console.log(`\ninvariants · ${checks} checks · §2.1 assets · §2.2 dependencies · §2.3 entropy`
  + ` · §4 · §10 provenance`
  + (problems.length ? ` · ${problems.length} VIOLATION${problems.length > 1 ? 'S' : ''}` : ' · clean'));
process.exit(problems.length ? 1 : 0);
