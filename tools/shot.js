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
 * How long to wait for the app to come up, in seconds.
 *
 * It was 120, hardcoded, which is generous on a GPU and nowhere near enough
 * elsewhere: `docs/notes/AGENT-PROTOCOL.md` §4 records that the surface scale
 * takes about seven minutes to build on a software rasteriser and says to use
 * twenty-minute timeouts. A tool that cannot be pointed at the machine it is
 * running on only works on one machine.
 *
 * The default is unchanged, so nothing about a run on real silicon moves.
 */
const readyMs = Number(arg('ready', 120)) * 1000;
/** what the route search is looking for: any rocky world, a living one, or one with an aurora */
const want = String(arg('want', scale === 'surface' ? 'life' : 'any'));
/**
 * What the route search is looking for.
 *
 * `meadow` exists because of a mistake this tool made easy. `life` takes the
 * first world with a biosphere, and on the default seed that is a **cool-star
 * ocean world with ice floes** — a legitimate AEON world and a useless one to
 * judge the art direction from, because the reference this project is being
 * compared against is a temperate green field under a sun-like star.
 *
 * Two captures were scored against sakura-realm before anyone noticed they were
 * of a different kind of place. The transfer was not wrong: at 2600 K
 * `airColours` genuinely returns a teal zenith over a yellow horizon, and the
 * frame was an honest photograph of an M-dwarf sky. It simply was not the
 * comparison anybody meant to make.
 *
 * So the comparison gets a name and a definition, rather than being whatever
 * the search happened to land on: a G-type star, a rocky world, liquid-water
 * temperatures, and something alive on it.
 */
const WANT = {
  any: 'true',
  life: 'hit.alive',
  aurora: 'hit.alive && auroral(pl, starSeed, sp)',
  meadow: "hit.alive && pl.type === 'terrestrial'"
    + ' && sp.temp > 5200 && sp.temp < 6400'
    + ' && pl.Teq > 250 && pl.Teq < 305',
};

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
  import { findLandingSite } from '${origin}/src/terrain.js';
  import { auroralGeometry, magnetosphere } from '${origin}/src/magnetosphere.js';
  const galaxySeed = hash(${seed}, 0xbe0) >>> 0;
  const gp = galaxyParams(galaxySeed);

  // Whether a world has an aurora is not a preference, it is three facts about
  // it: a live dynamo, an atmosphere, and an observer standing near enough to
  // the oval. Most worlds fail at least one, so a search is the only way to
  // photograph the case — which is itself the point of the module.
  const auroral = (pl, starSeed, sp) => {
    if ((pl.atmo ?? 1) < 0.05) return false;
    const mag = magnetosphere(pl, { starT: sp.temp ?? 5778, auDist: pl.au ?? 1 });
    if (!mag.hasOval) return false;
    const dir = findLandingSite(pl, hash(pl.seed, 0x1a4d));
    const lat = Math.asin(Math.min(Math.max(dir[1], -1), 1)) * 180 / Math.PI;
    const g = auroralGeometry(pl, lat, mag, { RKm: Math.max((pl.radiusE ?? 1) * 6371, 200) });
    return g.gapKm <= 2600 && g.gapDeg >= -6;
  };

  let fallback = null;
  for (let i = 0; i < 8192; i++) {
    const starSeed = hash(gp.seed, i, 0x57a9) >>> 0;
    const sp = systemParams(starSeed);
    for (let p = 0; p < sp.planets.length; p++) {
      const pl = sp.planets[p];
      if (pl.typeId > 4) continue;
      const hit = { galaxySeed, starSeed, planet: p, alive: !!isBiosphere(pl), i };
      if (!fallback) fallback = hit;
      if (${want}) { window.__route = hit; break; }
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

/**
 * One frame's draw calls and triangles — **all of them**, which is not what
 * reading `renderer.info` after a halt gives you.
 *
 * The bug this replaces reported `1 calls · 0.00M tris` on a frame with a
 * continent in it, on every capture this tool has ever taken. three.js resets
 * `info` at the top of each `render()`, and `EffectComposer` calls `render()`
 * once per pass — so a read after the loop stops sees only whatever the *last*
 * pass did, which is the print's fullscreen quad. One call. No triangles.
 *
 * §5 makes the frame budget a correctness property and names ≤900 calls and
 * ≤2.2 M triangles at surface scale. A tool that answers "1" to both cannot
 * ever say that budget was missed, so the number was not merely wrong — it was
 * unfalsifiable, which is worse.
 *
 * The fix is the documented one: turn `autoReset` off, zero the counters, step
 * exactly one frame through the app's own `resume`/`haltAt` pair, and read the
 * accumulated total. One frame, every pass, no double count.
 */
const MEASURE = () => new Promise((done) => {
  const app = window.AEON;
  const info = app.renderer?.info;
  if (!info) return done(null);
  info.autoReset = false;
  info.reset();
  const target = app.frames + 1;
  app.haltAt(target);
  app.resume();
  app.haltAt(target);
  const tick = () => {
    if (app.halted > 0 || app.frames >= target) {
      const out = { calls: info.render.calls, tris: info.render.triangles };
      info.autoReset = true;
      // Stop the loop again before handing back. `resume()` above cleared
      // `_haltAt`, and a page still rendering is a page `page.screenshot()`
      // cannot get a stable frame out of — on a software rasteriser that is
      // not a race you win, it is a 30-second timeout every time.
      app.haltAt(app.frames);
      return done(out);
    }
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
// modules announce what they decided; a capture that shows nothing should say
// whether it drew nothing or drew something invisible
page.on('console', (m) => {
  const t = m.text();
  if (/^\[(aurora|§9\.7)\]/.test(t)) console.log('  ' + t);
});

await page.goto(`${site.origin}/index.html?seed=${seed}`, { waitUntil: 'load' });
await page.addScriptTag({ type: 'module', content: RESOLVE(site.origin, WANT[want] || WANT.any) });
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
  const tGo = Date.now();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.AEON && window.AEON.active && window.AEON.active()',
    null, { timeout: readyMs });
  // Where the time actually goes, because on a software rasteriser it is not
  // where anyone assumes. Building the world — streaming the quadtree, meshing
  // tiles in float64, instancing the meadow, growing the flora — is CPU work
  // that does not care how many pixels the frame has. Settling is fill, and
  // fill is the only half a smaller viewport makes cheaper.
  const tBuilt = Date.now();
  const how = await page.evaluate(SETTLE, [frames, capMs]);
  const tSettled = Date.now();
  const info = await page.evaluate(MEASURE);
  const name = (b || 'default').replace(/[^a-z0-9]+/gi, '-') + (how === 'timeout' ? '-PARTIAL' : '');
  const file = resolve(dir, name + '.png');
  // Playwright's default is 30 s, which is a fine number for a GPU and not for
  // this one: the frame under it is being rasterised on the CPU. Reuse the
  // per-build cap, which is already the caller's statement about how slow the
  // machine is.
  await writeFile(file, await page.screenshot({ timeout: Math.max(capMs, 60000) }));
  written.push(file);
  console.log(`  ${how === 'timeout' ? 'part' : 'ok  '} ${(b || 'default').padEnd(24)}`
    + ` ${String(info?.calls ?? '?').padStart(5)} calls`
    + ` ${((info?.tris ?? 0) / 1e6).toFixed(2).padStart(6)}M tris`
    + `  build ${((tBuilt - tGo) / 1000).toFixed(0)}s settle ${((tSettled - tBuilt) / 1000).toFixed(0)}s`
    + `  →  ${name}.png`);
}

await browser.close();
await site.close();
console.log('\n  ' + written.length + ' frame(s) in ' + dir);
