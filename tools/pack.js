// One file, the whole universe — CLAUDE.md §2.1, §2.2.
//
//   node tools/pack.js [--out docs/aeon.html] [--flags "cshade=1&wetline=1"]
//
// A *distribution* step, not a build step. `python3 -m http.server 8080` stays
// sufficient and nothing about how the repo runs changes; this exists so the
// universe can be handed to someone as a single page — an Artifact, an email
// attachment, a USB stick — and still be the universe.
//
// It is possible at all because of §2.1. Zero runtime assets means there is
// nothing to fetch: no images, no fonts, no audio, no network calls, so a page
// that inlines the code is complete. `src` is 2.1 MB and the vendored three is
// 1.3 MB, and that is the whole of it.
//
// ---------------------------------------------------------------------------
// Two things make this non-obvious, and neither is the concatenation
//
// **1 · Blob URLs behind an importmap, so the one cycle survives.**
//
// The dependency graph is 99 modules with exactly one cycle,
// `galaxy.js <-> collision.js`. Resolving imports to blob URLs in topological
// order — the obvious approach — cannot express a cycle: whichever module you
// mint first has to name a URL that does not exist yet.
//
// So every module gets a blob URL *first*, and an importmap injected before any
// module loads maps `aeon:x.js` to it. Cycles then resolve exactly as ESM
// intends, because the resolver is doing the work rather than the packer. The
// only source transform is rewriting `./x.js` to `aeon:x.js`, which is a
// specifier rename and not a bundle: no module is merged with another, live
// bindings are untouched, and evaluation order stays the resolver's.
//
// **2 · The one worker.**
//
// `quadtree.js` starts `tilebuild.js` as a module worker, and importmaps do not
// apply inside workers — a worker gets its own module map and there is no way
// to seed it. Its subgraph is `tilebuild.js -> terrain.js`, with no three and no
// cycle, so those two are resolved to blob URLs directly and the one `new
// Worker(new URL(...))` line reads the URL the loader stashed.
//
// ---------------------------------------------------------------------------
// Flags without a query string
//
// Every feature in this repo is a URL parameter (§7.4), and a page handed
// around as a file may lose its query string — or be embedded somewhere that
// will not give it one. The loader therefore does two things: it calls
// `history.replaceState` so §2.4's deep-link machinery keeps reading and
// writing the same URL it always did, and it installs `window.__AEON_FLAGS` as
// a fallback that the rewritten `searchParams.get` calls consult first.
//
// Belt and braces on purpose. `replaceState` is the one thing here that a
// sandboxed host could refuse, and the failure mode without the fallback is a
// page that boots perfectly with every feature silently off.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

/** every .js under a directory, repo-relative, sorted so the output is stable */
function walk(dir, out = []) {
  for (const e of readdirSync(dir).sort()) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith('.js')) out.push(relative(REPO, p));
  }
  return out;
}

/**
 * Rewrite one module's specifiers into the `aeon:` namespace.
 *
 * Only the specifier strings of static and dynamic imports and of re-exports.
 * Anything else that happens to look like a path is left alone, which is why
 * the pattern is anchored on `from '...'` / `import('...')` rather than on the
 * path shape.
 */
function rewrite(src, selfPath) {
  const dir = dirname(selfPath);
  const key = (spec) => {
    if (spec === 'three') return 'aeon:vendor/three.module.js';
    if (spec.startsWith('three/addons/')) {
      return 'aeon:vendor/addons/' + spec.slice('three/addons/'.length);
    }
    if (spec.startsWith('./') || spec.startsWith('../')) {
      return 'aeon:' + relative(REPO, resolve(REPO, dir, spec)).split('\\').join('/');
    }
    return spec;
  };
  return src
    .replace(/(\bfrom\s*)(['"])([^'"]+)\2/g, (m, a, q, spec) => `${a}${q}${key(spec)}${q}`)
    .replace(/(\bimport\s*\(\s*)(['"])([^'"]+)\2/g, (m, a, q, spec) => `${a}${q}${key(spec)}${q}`)
    // §7.4's flags, with a fallback for a page that has lost its query string
    .replace(/new URL\(window\.location\.href\)\.searchParams/g,
      '__aeonParams()');
}

/**
 * The worker, resolved by hand.
 *
 * An importmap does not reach inside a worker, so `tilebuild.js` and the one
 * module it imports are minted as blob URLs by the loader and the `new Worker`
 * line is pointed at the first of them. Two files and one edit — the whole
 * reason it is this small is that the worker's subgraph is this small, and if
 * it ever grows a third file this function should fail loudly rather than
 * quietly ship a worker that cannot resolve its imports.
 */
const WORKER_ENTRY = 'src/tilebuild.js';
const WORKER_DEPS = ['src/terrain.js'];

function workerSubgraph(sources) {
  const seen = new Set();
  const visit = (p) => {
    if (seen.has(p)) return;
    seen.add(p);
    for (const m of sources.get(p).matchAll(/\bfrom\s*['"](\.\/[^'"]+)['"]/g)) {
      visit('src/' + m[1].slice(2));
    }
  };
  visit(WORKER_ENTRY);
  const got = [...seen].filter((p) => p !== WORKER_ENTRY).sort();
  const want = [...WORKER_DEPS].sort();
  if (got.join('|') !== want.join('|')) {
    throw new Error(
      `the worker's dependency graph has moved: expected [${want}] and found `
      + `[${got}]. tools/pack.js resolves those by hand because an importmap `
      + `does not reach inside a worker — teach it the new set, do not widen `
      + `this check.`);
  }
  return [WORKER_ENTRY, ...got];
}

function main() {
  const outPath = resolve(REPO, arg('out', 'docs/aeon.html'));
  // `?paint=1` is in here and is default-*off* in the repo (§7.4, and
  // RECKONING's ledger calls it the last big one). A packed page is a build
  // someone was handed to look at, so it carries the frame the work was aimed
  // at rather than the frame that ships — and the panel turns it off, which is
  // the A/B the ledger has been asking for.
  const defaults = arg('flags',
    'cshade=1&wetline=1&shafts=1&m3=1&mat=1&sea=1&ridge=1&paint=1');

  /**
   * Places worth standing in, as deep links (§2.4).
   *
   * `--place "a temperate world|seed=1019&g=..&s=..&p=0"`, repeatable. The
   * values are found by running the generator, which is the only way to find
   * them — and they stay found, because §2.3 says the same seed is the same
   * universe forever.
   */
  const places = [];
  process.argv.forEach((a, i) => {
    if (a !== '--place') return;
    const v = process.argv[i + 1] || '';
    const cut = v.indexOf('|');
    if (cut > 0) places.push({ name: v.slice(0, cut), q: v.slice(cut + 1) });
  });

  // ---- gather -----------------------------------------------------------
  const files = [...walk(resolve(REPO, 'src')), ...walk(resolve(REPO, 'vendor'))];
  const sources = new Map();
  for (const f of files) sources.set(f, readFileSync(resolve(REPO, f), 'utf8'));

  const workerFiles = workerSubgraph(sources);

  const modules = {};
  for (const [f, src] of sources) modules[f] = rewrite(src, f);

  // Anything the rewrite did not reach. Three shapes cannot survive in a
  // correctly rewritten module, and each is a specifier the browser would try
  // to resolve against a blob: URL — which has no path, so it fails at the
  // moment that module is first imported and not before. On the surface scale
  // that could be several minutes and one scale transition after load, which
  // is the worst possible time to find out.
  //
  // `import './x.js'` for its side effects is the one this repo does not
  // currently contain and the one most likely to be added without anyone
  // thinking about this file.
  const missed = [];
  for (const [f, src] of Object.entries(modules)) {
    for (const [re, what] of [
      [/^[ \t]*import\s+['"][^'"]+['"]/m, 'a side-effect-only import'],
      [/\bfrom\s*['"]\.\.?\//, 'an unrewritten relative specifier'],
      [/\bfrom\s*['"]three(\/|['"])/, 'an unrewritten bare three specifier'],
      [/\bimport\s*\(\s*[^'")]/, 'a computed dynamic import'],
    ]) if (re.test(src)) missed.push(`${f}: ${what}`);
  }
  if (missed.length) {
    throw new Error('tools/pack.js cannot rewrite these, and a packed build '
      + 'would fail at the moment each module is first imported rather than at '
      + 'load:\n  ' + missed.join('\n  '));
  }

  // The worker entry reads the URL the loader stashed. `new URL(x,
  // import.meta.url)` inside a blob module resolves against a blob URL, which
  // has no path — so this is not an optimisation, it is the only form that
  // works.
  const qt = 'src/quadtree.js';
  const before = modules[qt];
  modules[qt] = modules[qt].replace(
    "new Worker(new URL('./tilebuild.js', import.meta.url), { type: 'module' })",
    'new Worker(self.__AEON_WORKER_URL, { type: \'module\' })');
  if (modules[qt] === before) {
    throw new Error('src/quadtree.js no longer starts the tile worker the way '
      + 'tools/pack.js expects. The packed build would fall back to the main '
      + 'thread silently, so this is a hard stop.');
  }

  // ---- the shell --------------------------------------------------------
  const html = readFileSync(resolve(REPO, 'index.html'), 'utf8');
  const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>') + 8);
  const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
    .replace(/<script type="module"[^>]*><\/script>/, '')
    .trim();

  const page = `<title>AEON</title>
${style}
${PANEL_CSS}
${body}
${panelHtml(places)}
<script type="application/json" id="aeon-src">${
  JSON.stringify(modules).replace(/</g, '\\u003c')
}</script>
<script>${loader(workerFiles, defaults)}</script>
`;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, page);
  const mb = (page.length / 1048576).toFixed(2);
  console.log(`pack · ${Object.keys(modules).length} modules · ${workerFiles.length}`
    + ` in the worker · ${mb} MB · ${relative(REPO, outPath)}`);
  if (page.length > 16 * 1048576) {
    console.error('pack · over the 16 MB artifact cap');
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// the loader — a classic script, so it runs before any module does

function loader(workerFiles, defaults) {
  return `
(function () {
  var SRC = JSON.parse(document.getElementById('aeon-src').textContent);
  var STORE = 'aeon-flags-v1';

  // ---- §7.4's flags -----------------------------------------------------
  //
  // The URL is the base, so §2.4's deep links keep working: seed, g, s, p and
  // the rest arrive and are honoured. The panel's choices are then overlaid on
  // top of it, key by key, because a host that will not let the page navigate
  // would otherwise leave the panel doing nothing — and a toggle that silently
  // does nothing is worse than no toggle.
  // Defaults first, then the URL, then the panel's store — and the order is
  // load-bearing. A deep link from the panel carries seed, g, s and p and no
  // flags at all, so starting from the URL would have every one of these
  // features silently off the moment you followed one. Starting from the
  // defaults means a link is a *place*, and the flags are the build's.
  var params = new URLSearchParams(${JSON.stringify(defaults)});
  new URLSearchParams(location.search.replace(/^\\?/, ''))
    .forEach(function (v, k) { params.set(k, v); });
  try {
    new URLSearchParams(localStorage.getItem(STORE) || '')
      .forEach(function (v, k) { params.set(k, v); });
  } catch (e) { /* private window */ }

  window.__AEON_FLAGS = params;
  window.__aeonParams = function () {
    // The live URL wins for anything it actually carries, so §2.4's deep links
    // still resolve and still update as you travel; the packed defaults fill in
    // for everything it does not.
    try {
      var live = new URL(window.location.href).searchParams;
      return {
        get: function (k) {
          var v = live.get(k);
          return v === null ? window.__AEON_FLAGS.get(k) : v;
        },
      };
    } catch (e) { return window.__AEON_FLAGS; }
  };
  try { history.replaceState(null, '', '?' + params.toString()); } catch (e) { /* sandboxed */ }

  // ---- blob URLs, all of them, before any module resolves ---------------
  var url = {};
  for (var k in SRC) {
    url[k] = URL.createObjectURL(new Blob([SRC[k]], { type: 'text/javascript' }));
  }

  // the worker's own graph, resolved by hand — an importmap does not reach
  // inside a worker
  var W = ${JSON.stringify(workerFiles)};
  var wsrc = {};
  for (var i = W.length - 1; i >= 0; i--) {
    var s = SRC[W[i]];
    for (var j = 0; j < W.length; j++) {
      s = s.split("'aeon:" + W[j] + "'").join("'" + (wsrc[W[j]] || url[W[j]]) + "'");
    }
    wsrc[W[i]] = URL.createObjectURL(new Blob([s], { type: 'text/javascript' }));
  }
  self.__AEON_WORKER_URL = wsrc[W[0]];

  // ---- the importmap, then the entry ------------------------------------
  var map = { imports: {} };
  for (var k2 in url) map.imports['aeon:' + k2] = url[k2];
  var im = document.createElement('script');
  im.type = 'importmap';
  im.textContent = JSON.stringify(map);
  document.head.appendChild(im);

  var boot = document.createElement('script');
  boot.type = 'module';
  boot.textContent = "import 'aeon:src/main.js';";
  document.head.appendChild(boot);

  // ---- if it does not come up, say why ----------------------------------
  //
  // The splash is a black screen with the word AEON on it, and a black screen
  // is what a failed boot looks like too. Nothing about this page can phone
  // home, so the only place a diagnostic can go is the page — and the one
  // thing most likely to go wrong in an unfamiliar host is a policy refusing
  // one of the two mechanisms this loader is built on.
  var firstError = null;
  window.addEventListener('error', function (e) {
    if (!firstError) firstError = (e.message || String(e.error || e)).slice(0, 300);
  });
  setTimeout(function () {
    if (document.querySelector('#app canvas')) return;
    var sp = document.getElementById('splash');
    if (!sp) return;
    var p = sp.querySelector('p');
    if (!p) return;
    p.style.cssText = 'max-width:min(620px,84vw);text-align:center;line-height:2;'
      + 'letter-spacing:.12em;text-transform:none;font-size:12px;'
      + 'color:rgba(255,255,255,.55)';
    p.textContent = firstError
      ? 'the universe did not start — ' + firstError
      : 'the universe did not start. This page loads its 112 modules from blob: '
        + 'URLs behind an importmap; a content policy that refuses either will '
        + 'stop it here, with nothing in the console but a refusal.';
  }, 12000);

  // ---- the panel --------------------------------------------------------
  var panel = document.getElementById('flags');
  if (panel) {
    var toggle = document.getElementById('flags-toggle');
    toggle.onclick = function () { panel.classList.toggle('open'); };
    [].forEach.call(panel.querySelectorAll('input[type=checkbox]'), function (box) {
      box.checked = params.get(box.name) === '1';
      box.onchange = function () {
        // Only the panel's own keys go to the store. A deep link's seed and
        // route stay the URL's business, or a toggle would pin you to whatever
        // world you happened to be standing on when you pressed it.
        var keep = new URLSearchParams();
        try { keep = new URLSearchParams(localStorage.getItem(STORE) || ''); } catch (e) { /* private */ }
        keep.set(box.name, box.checked ? '1' : '0');
        try { localStorage.setItem(STORE, keep.toString()); } catch (e) { /* private */ }
        // A flag decides how a shader is *assembled* (§7.4, §11 — quality is set
        // once at init), so it cannot be toggled live. Reload, and take the URL
        // with us where the host allows it.
        try {
          var next = new URLSearchParams(location.search.replace(/^\\?/, ''));
          keep.forEach(function (v, k) { next.set(k, v); });
          location.search = '?' + next.toString();
        } catch (e) { location.reload(); }
      };
    });
  }
}());
`;
}

const PANEL_CSS = `<style>
  #flags-toggle{ position:fixed; right:26px; top:64px; z-index:26;
    width:30px; height:30px; border-radius:50%; cursor:pointer;
    background:none; border:1px solid rgba(255,255,255,.14);
    color:rgba(255,255,255,.55); font-size:13px; line-height:1;
    transition:border-color .25s, color .25s; }
  #flags-toggle:hover{ border-color:rgba(255,255,255,.55); color:#fff; }
  #flags{ position:fixed; right:26px; top:104px; z-index:26;
    display:none; flex-direction:column; gap:9px; padding:15px 17px;
    background:rgba(8,11,15,.82); border:1px solid rgba(255,255,255,.14);
    border-radius:10px; backdrop-filter:blur(8px);
    font-size:10px; letter-spacing:.2em; text-transform:uppercase;
    color:rgba(255,255,255,.55); }
  #flags.open{ display:flex; }
  #flags label{ display:flex; align-items:center; gap:9px; cursor:pointer;
    white-space:nowrap; }
  #flags label:hover{ color:rgba(255,255,255,.92); }
  #flags .sec{ margin-top:5px; padding-top:8px; font-size:9px;
    border-top:1px solid rgba(255,255,255,.14); color:rgba(255,255,255,.28); }
  #flags .sec:first-child{ margin-top:0; padding-top:0; border-top:none; }
  #flags input{ accent-color:#9ecbff; }
  #flags .go{ color:#9ecbff; text-decoration:none; padding:1px 0;
    border-bottom:1px solid transparent; }
  #flags .go:hover{ border-bottom-color:#9ecbff; color:#fff; }
  #flags .note{ max-width:240px; font-size:10px; letter-spacing:.04em;
    line-height:1.9; text-transform:none; color:rgba(255,255,255,.4); }
</style>`;

const panelHtml = (places) => `
<button id="flags-toggle" title="what is switched on">&#9673;</button>
<div id="flags">
  <div class="sec">the sky reaches the ground</div>
  <label><input type="checkbox" name="cshade"> cloud shadows</label>
  <label><input type="checkbox" name="wetline"> the water's record</label>
  <label><input type="checkbox" name="shafts"> crepuscular light</label>
  <div class="sec">the rest of the frame</div>
  <label><input type="checkbox" name="m3"> wind and grass</label>
  <label><input type="checkbox" name="mat"> ground materials</label>
  <label><input type="checkbox" name="sea"> the gerstner sea</label>
  <label><input type="checkbox" name="ridge"> far ridges as silhouette</label>
  <label><input type="checkbox" name="paint"> the light model</label>
${places.length ? `  <div class="sec">somewhere to stand</div>
${places.map((pl) => `  <a class="go" href="?${pl.q.replace(/&/g, '&amp;')}">${pl.name}</a>`).join('\n')}` : ''}
  <div class="sec">what to look for</div>
  <div class="note">Stand still at golden hour and wait. A shadow crosses the
  valley as a front — it darkens the grass without draining it, and the sheen
  in the wet hollow goes out and comes back. Look up: the gap that did it is
  overhead. How sharp the edge is belongs to the star — under a white dwarf it
  is cut paper.</div>
</div>`;

main();
