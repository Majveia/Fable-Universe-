// The shader compile gate (CLAUDE.md §M0, §11).
//
//   node tools/shadercheck.js [--timeout 600] [--json docs/captures/shaders.json]
//
// The rule it enforces: extract every shader string *as passed to
// gl.shaderSource* — not as it reads in the source file — and compile-check
// it. This codebase assembles shaders by template interpolation, and so does
// the reference; a defect in an interpolated chunk exists only after
// assembly, which is why reading the file proves nothing.
//
// Coverage comes from the bench route (?bench=1), which flies all six scales,
// so every scale's programs are forced to assemble. A run that fails to reach
// every scale is reported as incomplete rather than as a pass — a gate that
// silently checked four scales out of six is worse than no gate.
//
// It also flies the route once per *flag combination*, because §7.4 says
// milestone work is built behind a default-off flag. A single unflagged pass
// compiles the build nobody is iterating on and reports green while every new
// shader in the repo goes unchecked; that is exactly the failure mode §11 warns
// about, one level up. `--flags` takes a comma-separated list of query strings.
//
// ---------------------------------------------------------------------------
// Why there is a second traversal, and when to use it
//
// The bench route is a *flight*: it travels between scales continuously, which
// is the right coverage model because §2.5 says that is how the universe is
// actually entered. On real silicon it finishes well inside the timeout.
//
// On a software rasteriser it does not. Measured here, four passes each ran the
// full 600 s and every one of them reported `scalesVisited: ["blackhole"]` —
// 88 to 100 shaders compiled, zero failures, and the surface scale never
// reached. A gate that returns "0 failed" about scales it never visited is
// worse than no gate, which is why the tool already refuses to call that a
// pass. But refusing is not the same as being usable, and on a container with
// no GPU that left §M0's compile gate permanently unclosable.
//
// `--stations` is the second traversal: navigate straight to each scale's deep
// link and wait for frames, rather than flying between them. It gives up the
// transition shaders — which the flight covers and this cannot — and buys the
// deep scales, which the flight cannot reach here and this does in seconds.
// Neither subsumes the other, so both exist and the report says which ran.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { arg, launch, playwright, REPO, serve } from './lib.js';

const PROBE = () => {
  const log = [];
  window.__AEON_SHADERS = log;
  const sources = new WeakMap();
  const patch = (proto) => {
    if (!proto || proto.__aeonShaderProbe) return;
    proto.__aeonShaderProbe = true;
    const src = proto.shaderSource;
    proto.shaderSource = function (shader, string) {
      sources.set(shader, string);
      return src.call(this, shader, string);
    };
    const compile = proto.compileShader;
    proto.compileShader = function (shader) {
      const r = compile.call(this, shader);
      const type = this.getShaderParameter(shader, this.SHADER_TYPE);
      log.push({
        kind: type === this.VERTEX_SHADER ? 'vertex' : 'fragment',
        ok: !!this.getShaderParameter(shader, this.COMPILE_STATUS),
        info: this.getShaderInfoLog(shader) || '',
        source: sources.get(shader) || '',
      });
      return r;
    };
    const link = proto.linkProgram;
    proto.linkProgram = function (program) {
      const r = link.call(this, program);
      if (!this.getProgramParameter(program, this.LINK_STATUS)) {
        log.push({ kind: 'link', ok: false, info: this.getProgramInfoLog(program) || '', source: '' });
      }
      return r;
    };
  };
  patch(window.WebGLRenderingContext && WebGLRenderingContext.prototype);
  patch(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype);
};

function quote(source, info) {
  // GLSL says "ERROR: 0:123: ..." — show the line it means, in context
  const lines = source.split('\n');
  const out = [];
  for (const m of String(info).matchAll(/(?:ERROR|WARNING):\s*\d+:(\d+)/g)) {
    const n = parseInt(m[1], 10);
    for (let i = Math.max(1, n - 3); i <= Math.min(lines.length, n + 3); i++) {
      out.push(`${i === n ? '>' : ' '} ${String(i).padStart(5)} | ${lines[i - 1]}`);
    }
    out.push('');
  }
  return out.join('\n');
}

const timeoutMs = Number(arg('timeout', 600)) * 1000;
const jsonPath = resolve(REPO, String(arg('json', 'docs/captures/shaders.json')));
/** visit each scale by deep link instead of flying between them — see the note above */
const stationMode = arg('stations', false) !== false;
const stationSeed = Number(arg('seed', 20250601));
const stationFrames = Number(arg('frames', 90));
/**
 * Per-station navigation timeout, seconds.
 *
 * Playwright's default is 30 s, which is tuned for a page and not for a scale
 * that has just built four rings of grass on a software rasteriser. The
 * black-hole station timed out at exactly 30 s while the surface scale behind
 * it was still tearing down — a real cost, but not a shader defect, and a gate
 * that reports "not every scale was reached" because of it is telling the truth
 * about the wrong thing.
 */
const stationNavMs = Number(arg('nav', 120)) * 1000;

/**
 * The itinerary, resolved in-page from the seed with the same pure generators
 * the universe uses — lifted from `tools/capture.js` so the two tools cannot
 * disagree about where the seed's rocky world is.
 */
const RESOLVE_ROUTE = (origin) => `
  import { hash } from '${origin}/src/rng.js';
  import { galaxyParams } from '${origin}/src/galaxy.js';
  import { systemParams } from '${origin}/src/system.js';
  const galaxySeed = hash(${stationSeed}, 0xbe0) >>> 0;
  const gp = galaxyParams(galaxySeed);
  for (let i = 0; i < 4096; i++) {
    const starSeed = hash(gp.seed, i, 0x57a9) >>> 0;
    const sp = systemParams(starSeed);
    const rocky = sp.planets.findIndex(p => p.typeId <= 4);
    const giant = sp.planets.findIndex(p => p.typeId >= 5);
    if (rocky >= 0) { window.__route = { galaxySeed, starSeed, rocky, giant }; break; }
  }
`;

const stations = (r) => {
  const b = `seed=${stationSeed}`;
  const list = [
    ['cosmic-web', b],
    ['galaxy', `${b}&g=${r.galaxySeed}`],
    ['star-system', `${b}&g=${r.galaxySeed}&s=${r.starSeed}`],
    ['planet-orbit', `${b}&g=${r.galaxySeed}&s=${r.starSeed}&pl=${r.rocky}&quad=1&ap=0`],
    ['surface', `${b}&g=${r.galaxySeed}&s=${r.starSeed}&p=${r.rocky}`],
    ['black-hole', `${b}&g=${r.galaxySeed}&bh=1`],
  ];
  if (r.giant >= 0) list.push(['cloud-deck', `${b}&g=${r.galaxySeed}&s=${r.starSeed}&p=${r.giant}&cl=1`]);
  return list;
};

/** wait for N presented frames, so a slow rasteriser compiles the same set */
const SETTLE = (n) => new Promise((res) => {
  let i = 0;
  const tick = () => (++i >= n ? res(true) : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
});

// Default: the shipped build, then every milestone flag at once. The second
// pass is the one that matters today — src/print.js and the M1 cosmic shaders
// exist only when their flag is set, so an unflagged run never sees them.
const passes = String(arg('flags', ',m1=1&m2=1&slab=1')).split(',');

const pw = await playwright();
const site = await serve();
const browser = await launch(pw);

// a shader compiles against *a* driver, not against all of them — so the
// report names the one that judged it
let renderer = 'none';
const runs = [];

for (const flags of passes) {
  const label = flags || '(default build)';
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(PROBE);

  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });

  let complete = true;
  let visited = [];
  const collected = [];

  if (stationMode) {
    console.log(`shadercheck · visiting each scale by deep link · ${label}`);
    await page.goto(`${site.origin}/index.html?seed=${stationSeed}`, { waitUntil: 'load' });
    await page.addScriptTag({ type: 'module', content: RESOLVE_ROUTE(site.origin) });
    await page.waitForFunction('window.__route', null, { timeout: 60000 });
    const route = await page.evaluate(() => window.__route);
    for (const [name, q] of stations(route)) {
      const url = `${site.origin}/index.html?${q}${flags ? '&' + flags : ''}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: stationNavMs });
        await page.evaluate(SETTLE, stationFrames);
        // Harvest before the next navigation. `addInitScript` re-runs on every
        // goto, so `window.__AEON_SHADERS` is a *fresh* array per station —
        // reading it once at the end reports the last station's shaders and
        // calls it the whole run. That is the same false green the flight
        // produces when it times out, arrived at from the other direction.
        collected.push(...await page.evaluate(() => (window.__AEON_SHADERS || []).map(s => ({
          kind: s.kind, ok: s.ok, info: s.info, source: s.source,
        }))));
        // the driver's name, taken from the first station that yields one —
        // it cannot change between stations, and asking early avoids racing a
        // navigation at the end of the run
        if (renderer === 'none') {
          renderer = await page.evaluate(() => {
            const gl = document.createElement('canvas').getContext('webgl2');
            const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
            return gl ? String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none';
          });
        }
        // a scale that reports a different kind than the link asked for is a
        // redirect, not a visit — record what actually loaded
        visited.push(await page.evaluate(() => window.AEON?.active?.()?.kind ?? null) || name);
      } catch (e) {
        complete = false;
        pageErrors.push(`station ${name}: ${e.message}`);
      }
    }
    const want = stations(route).length;
    if (visited.filter(Boolean).length < want) complete = false;
  } else {
    console.log(`shadercheck · flying the bench route · ${label}`);
    await page.goto(`${site.origin}/index.html?bench=1&quad=1${flags ? '&' + flags : ''}`,
      { waitUntil: 'load' });
    try {
      await page.waitForFunction('window.AEON_BENCH_DONE === true', null, { timeout: timeoutMs });
    } catch {
      complete = false;
      console.warn(`shadercheck · route did not finish within ${timeoutMs / 1000}s — coverage is partial`);
    }
    visited = await page.evaluate(() =>
      (window.AEON_BENCH?.scales || []).map(s => s.kind)
        .concat(window.AEON ? [window.AEON.active().kind] : []));
  }

  const shaders = stationMode ? collected
    : await page.evaluate(() => (window.__AEON_SHADERS || []).map(s => ({
      kind: s.kind, ok: s.ok, info: s.info, source: s.source,
    })));

  // The driver's name, best-effort and late-bound.
  //
  // This used to run unguarded after the station loop, and it crashed the whole
  // gate: §2.4 makes every place a URL, so the app rewrites its address as
  // scales change, and an evaluate racing a navigation loses its execution
  // context. A gate that dies reporting nothing is worse than one that reports
  // "renderer unknown" — the shaders were already collected by this point, and
  // throwing them away over a cosmetic string is the wrong trade.
  if (renderer === 'none') {
    try {
      renderer = await page.evaluate(() => {
        const gl = document.createElement('canvas').getContext('webgl2');
        const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
        return gl ? String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none';
      });
    } catch (e) {
      pageErrors.push(`renderer probe: ${e.message}`);
    }
  }

  try { await page.close(); } catch { /* already gone with its context */ }
  runs.push({ label, flags, complete, shaders, pageErrors, mode: stationMode ? 'stations' : 'flight',
    scales: [...new Set(visited.filter(Boolean))].sort() });
}

await browser.close();
await site.close();

let failed = 0, errored = 0, incomplete = 0;
for (const r of runs) {
  const failures = r.shaders.filter(s => !s.ok);
  const warnings = r.shaders.filter(s => s.ok && /WARNING/i.test(s.info));
  r.failures = failures.length;
  r.warnings = warnings.length;

  for (const f of failures) {
    console.error(`\n─── [${r.label}] ${f.kind} shader failed to compile ───\n${f.info.trim()}`);
    if (f.source) console.error(quote(f.source, f.info));
  }
  for (const e of r.pageErrors) console.error(`page error · [${r.label}] ` + e);

  failed += failures.length;
  errored += r.pageErrors.length;
  if (!r.complete) incomplete++;
}

const report = {
  schema: 'aeon-shadercheck/3',
  when: new Date().toISOString(),
  renderer,
  softwareRasterizer: /swiftshader|llvmpipe|software|basic render/i.test(renderer),
  passes: runs.map(r => ({
    flags: r.flags,
    // which traversal ran. The flight covers the transitions between scales and
    // cannot reach the deep ones on a software rasteriser; stations reach every
    // scale and cover no transitions. Neither subsumes the other, so a report
    // that does not say which one ran is not a result.
    mode: r.mode,
    complete: r.complete,
    shadersCompiled: r.shaders.length,
    failures: r.failures,
    warnings: r.warnings,
    scalesVisited: r.scales,
    pageErrors: r.pageErrors,
    detail: r.shaders.filter(s => !s.ok).map(f => ({ kind: f.kind, info: f.info })),
  })),
};
await mkdir(dirname(jsonPath), { recursive: true });
await writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n');

console.log('');
for (const r of runs) {
  console.log(`shadercheck · ${r.label} · ${r.shaders.length} shaders · ${r.failures} failed`
    + ` · ${r.warnings} with warnings · scales: ${r.scales.join(', ') || 'none'}`);
}
console.log('shadercheck · wrote ' + jsonPath);

if (failed || errored) process.exit(1);
if (incomplete) { console.error('shadercheck · INCOMPLETE: not every scale was reached'); process.exit(2); }
console.log('shadercheck · green');
