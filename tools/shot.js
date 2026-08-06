// A photograph, of one place, under several builds — CLAUDE.md §7.5.
//
//   node tools/shot.js --builds "m2=1,m2=1&airmat=1" --out docs/captures/airmat
//   node tools/shot.js --scale system --frames 90
//
// `tools/capture.js` flies the whole deterministic route across all six scales
// and is the right tool for a milestone. This is the other thing you need
// constantly and it does not do: **the same frame, twice, under two flags**,
// so a change can be looked at rather than argued about.
//
// The difference matters more than it sounds. A route capture answers "does
// the universe still work"; an A/B answers "is this better", and §8's rubric is
// written entirely in the second kind of question — *name the specific pixel
// region that lost the point*. You cannot name a region you cannot put side by
// side.
//
// ---------------------------------------------------------------------------
// Three things it does that a screenshot does not
//
// **`dt` is pinned.** Without it the day clock runs on wall time and two
// "identical" frames have the sun in different places, so every difference in
// the pair is swamped by the light having moved. That cost real time before it
// was noticed (docs/plans/M2.md §24) and it is the first thing to check when an
// A/B looks inexplicable.
//
// **The route is resolved once and reused.** Both frames are the same world,
// the same star, the same planet, the same landing site — a seed alone does not
// guarantee that, because the search that picks a rocky world is a search.
//
// **It waits for frames, not for milliseconds.** A slow machine gets the same
// picture as a fast one, just later; a timeout returns whatever had settled and
// says so in the filename rather than silently photographing a half-built
// world.

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { arg, launch, playwright, serve, TIERS, REPO } from './lib.js';

const seed = Number(arg('seed', 1337146641));
const tier = String(arg('tier', 'low'));
const frames = Number(arg('frames', 60));
const capMs = Number(arg('cap', 300)) * 1000;
const outDir = String(arg('out', 'docs/captures/shot'));
const builds = String(arg('builds', 'm2=1')).split(',').map((b) => b.trim()).filter(Boolean);
const scale = String(arg('scale', 'surface'));

/**
 * Find a world worth photographing, in the page, from the same generators the
 * app uses. `biosphere` asks for one that has life on it, because a frame of
 * bare rock tells you nothing about how foliage or a village sits in the air.
 */
const RESOLVE = (origin, want) => `
  import { hash } from '${origin}/src/rng.js';
  import { galaxyParams } from '${origin}/src/galaxy.js';
  import { systemParams } from '${origin}/src/system.js';
  import { isBiosphere } from '${origin}/src/life.js';
  const galaxySeed = hash(${seed}, 0xbe0) >>> 0;
  const gp = galaxyParams(galaxySeed);
  let fallback = null;
  for (let i = 0; i < 8192; i++) {
    const starSeed = hash(gp.seed, i, 0x57a9) >>> 0;
    const sp = systemParams(starSeed);
    for (let p = 0; p < sp.planets.length; p++) {
      const pl = sp.planets[p];
      if (pl.typeId > 4) continue;
      const hit = { galaxySeed, starSeed, planet: p, alive: !!isBiosphere(pl) };
      if (!fallback) fallback = hit;
      if (${want ? 'hit.alive' : 'true'}) { window.__route = hit; break; }
    }
    if (window.__route) break;
  }
  window.__route = window.__route || fallback;
`;

/** wait for `n` rendered frames, or give up and say so */
const SETTLE = ([n, ms]) => new Promise((done) => {
  const app = window.AEON;
  const t0 = performance.now();
  const start = app.frames;
  app.haltAt(start + n);
  const tick = () => {
    if (app.halted > 0) return done('frames');
    if (performance.now() - t0 > ms) { app.haltAt(app.frames); return done('timeout'); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const pw = await playwright();
const site = await serve();
const browser = await launch(pw);
const cfg = TIERS[tier] || TIERS.low;
const ctx = await browser.newContext({ viewport: cfg.viewport, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('  page error: ' + e.message.split('\n')[0]));

await page.goto(`${site.origin}/index.html?seed=${seed}`, { waitUntil: 'load' });
await page.addScriptTag({ type: 'module', content: RESOLVE(site.origin, scale === 'surface') });
await page.waitForFunction('window.__route', null, { timeout: 60000 });
const route = await page.evaluate(() => window.__route);

const where = scale === 'surface'
  ? `g=${route.galaxySeed}&s=${route.starSeed}&p=${route.planet}`
  : scale === 'system' ? `g=${route.galaxySeed}&s=${route.starSeed}`
  : scale === 'galaxy' ? `g=${route.galaxySeed}` : '';

const dir = resolve(REPO, outDir);
await mkdir(dir, { recursive: true });
console.log(`shot · seed ${seed} · ${scale} · ${cfg.viewport.width}x${cfg.viewport.height}`);
console.log(`  world: galaxy ${route.galaxySeed} star ${route.starSeed} planet ${route.planet}`
  + (route.alive ? ' · biosphere' : ' · sterile'));

const written = [];
for (const b of builds) {
  const url = `${site.origin}/index.html?seed=${seed}&${where}${b ? '&' + b : ''}&dt=16.667`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.AEON && window.AEON.active && window.AEON.active()',
    null, { timeout: 120000 });
  const how = await page.evaluate(SETTLE, [frames, capMs]);
  const info = await page.evaluate(() => {
    const i = window.AEON.renderer?.info;
    return i ? { calls: i.render.calls, tris: i.render.triangles } : null;
  });
  const name = (b || 'default').replace(/[^a-z0-9]+/gi, '-') + (how === 'timeout' ? '-PARTIAL' : '');
  const file = resolve(dir, name + '.png');
  await writeFile(file, await page.screenshot());
  written.push(file);
  console.log(`  ${how === 'timeout' ? 'part' : 'ok  '} ${(b || 'default').padEnd(24)}`
    + ` ${String(info?.calls ?? '?').padStart(5)} calls`
    + ` ${((info?.tris ?? 0) / 1e6).toFixed(2).padStart(6)}M tris  →  ${name}.png`);
}

await browser.close();
await site.close();
console.log('\n  ' + written.length + ' frame(s) in ' + dir);
