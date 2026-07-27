// The capture instrument (CLAUDE.md §M0, §7.5, §8).
//
//   node tools/capture.js --milestone M0
//   node tools/capture.js --milestone M0 --tiers desktop,mobile,low
//   node tools/capture.js --milestone M0 --seed 20250601 --settle 240
//   node tools/capture.js --milestone M0 --settle-cap 90 --bench-timeout 45
//
// One command, cold start, complete numbered set: PNGs of every scale plus a
// perf JSON per tier, into docs/captures/<milestone>/. This is the thing the
// critic (§8) scores and the thing a gate (§7.7) re-shoots — so it has to be
// boring, repeatable, and honest about the machine it ran on.
//
// Determinism: every station is a deep link (§2.4 — every place is a URL) at
// a pinned seed, settled for a fixed *frame count* rather than a fixed wall
// time. A slow machine takes longer and shoots the same frame.
//
// Honesty: §M0 requires a real GPU. A software rasteriser will happily
// produce a full, beautiful, worthless capture set, so every run records its
// renderer string and stamps gateValid:false when it sees one.

import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { arg, launch, playwright, REPO, serve, TIERS } from './lib.js';

const milestone = String(arg('milestone', 'M0'));
const seed = Number(arg('seed', 20250601));
const settle = Number(arg('settle', 220));
const settleCapMs = Number(arg('settle-cap', 90)) * 1000;
const benchTimeoutMs = Number(arg('bench-timeout', 45)) * 60 * 1000;
const tiers = String(arg('tiers', 'desktop')).split(',').map(s => s.trim()).filter(Boolean);
const outDir = resolve(REPO, 'docs/captures', milestone);

for (const t of tiers) if (!TIERS[t]) throw new Error(`unknown tier "${t}" — pick from ${Object.keys(TIERS)}`);

// ---------------------------------------------------------------- route ---
// Resolved in-page from the seed, using the same pure generators the universe
// uses, so the itinerary is a property of the seed rather than of this file.
const RESOLVE_ROUTE = async (origin) => `
  import { hash } from '${origin}/src/rng.js';
  import { galaxyParams } from '${origin}/src/galaxy.js';
  import { systemParams } from '${origin}/src/system.js';
  const galaxySeed = hash(${seed}, 0xbe0) >>> 0;
  const gp = galaxyParams(galaxySeed);
  for (let i = 0; i < 4096; i++) {
    const starSeed = hash(gp.seed, i, 0x57a9) >>> 0;
    const sp = systemParams(starSeed);
    const rocky = sp.planets.findIndex(p => p.typeId <= 4);
    const giant = sp.planets.findIndex(p => p.typeId >= 5);
    if (rocky >= 0) { window.__route = { galaxySeed, starSeed, rocky, giant }; break; }
  }
`;

/** the numbered set: what the critic looks at, in the order you fall */
function stations(route) {
  const { galaxySeed, starSeed, rocky, giant } = route;
  const base = `seed=${seed}`;
  const list = [
    ['cosmic-web', `${base}`],
    ['galaxy', `${base}&g=${galaxySeed}`],
    ['star-system', `${base}&g=${galaxySeed}&s=${starSeed}`],
    ['planet-orbit', `${base}&g=${galaxySeed}&s=${starSeed}&pl=${rocky}&quad=1&ap=0`],
    ['surface', `${base}&g=${galaxySeed}&s=${starSeed}&p=${rocky}`],
    ['black-hole', `${base}&g=${galaxySeed}&bh=1`],
  ];
  if (giant >= 0) list.push(['cloud-deck', `${base}&g=${galaxySeed}&s=${starSeed}&p=${giant}&cl=1`]);
  return list;
}

// Wait for N rendered frames, not N milliseconds — that is the whole point,
// and it is why a slow machine shoots the same frame as a fast one.
//
// And then *stop*, which is the other half and was missing. Counting frames and
// then screenshotting a still-running loop photographs whichever frame the
// compositor reached, which is a property of the machine: at 1400 fps dozens of
// frames pass between "N frames have been drawn" and the shutter. §7.7 asks
// every previous milestone to be re-shot and compared; that is not possible
// against a frame nobody can name. `App.haltAt()` stops the loop inside the
// frame loop itself, so the pixels on the canvas are frame N exactly.
//
// The wall-clock cap is the escape hatch, not the schedule: a scale whose
// frames cost seconds (a software rasteriser at 1440p, say) would otherwise
// hold the run open forever, and a capture tool that can hang is not an
// instrument. Which way the settle ended is recorded in the manifest, so a
// timed-out frame is never quietly filed next to a settled one.
const SETTLE = ([n, capMs]) => new Promise((done) => {
  const app = window.AEON;
  const t0 = performance.now();
  const start = app.frames;
  app.haltAt(start + n);
  const tick = () => {
    if (app.halted > 0) return done({ frames: app.halted - start, by: 'frames' });
    if (performance.now() - t0 > capMs) {
      // give up on the target, but still stop before the shutter: a capped
      // frame should be unsettled, never unidentifiable
      app.haltAt(app.frames);
      return done({ frames: app.frames - start, by: 'timeout' });
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const pw = await playwright();
const site = await serve();
const browser = await launch(pw);

await mkdir(outDir, { recursive: true });
// a capture set is a snapshot, not an accumulation: stale numbered frames
// from a previous route would read as part of this one
for (const f of await readdir(outDir).catch(() => [])) {
  if (/\.(png|json)$/.test(f)) await rm(join(outDir, f));
}

const manifest = { schema: 'aeon-capture/1', milestone, seed, when: new Date().toISOString(), tiers: {} };

for (const tier of tiers) {
  const cfg = TIERS[tier];
  console.log(`\n── ${tier} · ${cfg.label} ──`);
  const ctx = await browser.newContext({
    viewport: cfg.viewport, deviceScaleFactor: cfg.deviceScaleFactor,
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // ---- route resolution, from the seed itself
  await page.goto(`${site.origin}/index.html?seed=${seed}`, { waitUntil: 'load' });
  await page.addScriptTag({ type: 'module', content: await RESOLVE_ROUTE(site.origin) });
  await page.waitForFunction('window.__route', null, { timeout: 60000 });
  const route = await page.evaluate(() => window.__route);
  console.log(`route · galaxy ${route.galaxySeed} · star ${route.starSeed} · world #${route.rocky}`);

  // ---- the numbered set
  //
  // The screenshot is retried, because on real hardware it can fail where
  // nothing is wrong with the frame. The first RTX run to reach the surface
  // scale at 1440p came back with
  //
  //   05-desktop-surface.png  FAILED — Protocol error (Page.captureScreenshot):
  //                                    Unable to capture screenshot
  //
  // between two stations that shot cleanly on either side of it. A capture set
  // with a hole in it fails §M0's gate — "one command produces a *complete*
  // numbered capture set" — so one transient compositor hiccup costs the whole
  // run. Retry, settle a little between attempts, and record in the manifest
  // that a frame needed more than one: a retried frame should never be filed
  // silently next to a clean one.
  async function shoot(page, path, tries = 3) {
    for (let i = 1; ; i++) {
      try {
        await page.screenshot({ path, timeout: 60000 });
        return i;
      } catch (e) {
        if (i >= tries) throw e;
        console.error(`    screenshot attempt ${i} failed (${e.message || e}) — retrying`);
        await page.evaluate((n) => new Promise((d) => {
          let k = 0;
          const t = () => (++k >= n ? d() : requestAnimationFrame(t));
          requestAnimationFrame(t);
        }), 20);
      }
    }
  }

  const shots = [];
  let n = 0;
  for (const [name, query] of stations(route)) {
    const file = `${String(++n).padStart(2, '0')}-${tier}-${name}.png`;
    const url = `${site.origin}/index.html?${query}`;
    await page.goto(url, { waitUntil: 'load' });
    try {
      await page.waitForFunction('window.AEON && window.AEON.active()', null, { timeout: 60000 });
      // the HUD is chrome; §8 axis 7 asks whether the frame survives without
      // it, so the capture set answers that question by construction
      await page.evaluate(() => document.querySelectorAll('.hud, #splash, #touch')
        .forEach(el => { el.style.visibility = 'hidden'; }));
      const settled = await page.evaluate(SETTLE, [settle, settleCapMs]);
      const kind = await page.evaluate(() => window.AEON.active().kind);
      const attempts = await shoot(page, join(outDir, file));
      shots.push({
        file, name, kind, url: url.replace(site.origin, ''),
        settleFrames: settled.frames, settleTarget: settle, settledBy: settled.by,
        ...(attempts > 1 ? { screenshotAttempts: attempts } : {}),
      });
      console.log(`  ${file}  (${kind}, ${settled.frames} frames`
        + `${settled.by === 'timeout' ? ' — CAPPED, frame may be unsettled' : ''}`
        + `${attempts > 1 ? ` — ${attempts} screenshot attempts` : ''})`);
    } catch (e) {
      shots.push({ file, name, error: String(e.message || e) });
      console.error(`  ${file}  FAILED — ${e.message || e}`);
    }
  }

  // ---- the numbers, from the same cold start
  console.log('  bench · 600 frames…');
  await page.goto(`${site.origin}/index.html?bench=1&seed=${seed}&quad=1&tier=${tier}`, { waitUntil: 'load' });
  let perf = null;
  try {
    await page.waitForFunction('window.AEON_BENCH_DONE === true', null, { timeout: benchTimeoutMs });
    perf = await page.evaluate(() => window.AEON_BENCH);
    await writeFile(join(outDir, `perf-${tier}.json`), JSON.stringify(perf, null, 2) + '\n');
    const o = perf.overall;
    console.log(`  fps p50/p95/p99 ${o.fps.p50}/${o.fps.p95}/${o.fps.p99}`
      + ` · draws p95 ${o.drawCalls.p95} · tris p95 ${(o.triangles.p95 / 1e6).toFixed(2)}M`
      + ` · gpu ${perf.gpuMemoryMB.peak}MB`);
    if (!perf.device.gateValid) {
      console.warn(`  ⚠ ${perf.device.renderer} — software rasteriser. Shape valid, numbers are NOT gate-valid (§M0).`);
    }
  } catch (e) {
    console.error('  bench FAILED — ' + (e.message || e));
  }

  manifest.tiers[tier] = {
    label: cfg.label, viewport: cfg.viewport, deviceScaleFactor: cfg.deviceScaleFactor,
    route, shots, perf: perf ? `perf-${tier}.json` : null,
    gateValid: perf?.device?.gateValid ?? false,
    renderer: perf?.device?.renderer ?? null,
    errors,
  };
  if (errors.length) console.error(`  ${errors.length} page error(s):\n    ` + errors.join('\n    '));
  await ctx.close();
}

await writeFile(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await browser.close();
await site.close();

const anyErrors = Object.values(manifest.tiers).some(t => t.errors.length
  || t.shots.some(s => s.error) || !t.perf);
console.log(`\ncapture · wrote ${outDir}`);
if (Object.values(manifest.tiers).every(t => !t.gateValid)) {
  console.warn('capture · no tier ran on a real GPU: this set documents, it does not gate (§M0).');
}
process.exit(anyErrors ? 1 : 0);
