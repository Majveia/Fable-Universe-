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

  console.log(`shadercheck · flying the bench route · ${label}`);
  await page.goto(`${site.origin}/index.html?bench=1&quad=1${flags ? '&' + flags : ''}`,
    { waitUntil: 'load' });

  let complete = true;
  try {
    await page.waitForFunction('window.AEON_BENCH_DONE === true', null, { timeout: timeoutMs });
  } catch {
    complete = false;
    console.warn(`shadercheck · route did not finish within ${timeoutMs / 1000}s — coverage is partial`);
  }

  const shaders = await page.evaluate(() => (window.__AEON_SHADERS || []).map(s => ({
    kind: s.kind, ok: s.ok, info: s.info, source: s.source,
  })));
  const visited = await page.evaluate(() =>
    (window.AEON_BENCH?.scales || []).map(s => s.kind)
      .concat(window.AEON ? [window.AEON.active().kind] : []));

  renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const d = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return gl ? String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : 'none';
  });

  await page.close();
  runs.push({ label, flags, complete, shaders, pageErrors, scales: [...new Set(visited)].sort() });
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
  schema: 'aeon-shadercheck/2',
  when: new Date().toISOString(),
  renderer,
  softwareRasterizer: /swiftshader|llvmpipe|software|basic render/i.test(renderer),
  passes: runs.map(r => ({
    flags: r.flags,
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
