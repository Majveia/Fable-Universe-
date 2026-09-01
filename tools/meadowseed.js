// Which seeds land you in a meadow — CLAUDE.md §7.5, §16 rule 1.
//
//   node tools/meadowseed.js --count 6
//
// `tools/shot.js --want life` asks one question — `isBiosphere(pl)` — and that
// predicate is `type ∈ {terrestrial, ocean} && 235 ≤ Teq ≤ 330`. It is true of a
// 240 K ocean world with pack ice on it, and the first seed tried for
// `docs/plans/SURFACE-DENSITY.md` returned exactly that: CLASS OCEAN, 240 K, no
// land in the frustum and therefore no grass, no trees and nothing §9.5 or §9.7
// has an opinion about. A capture of that world is not evidence about a meadow.
//
// So this asks the longer question, in the page, from the same generators the
// app uses, and prints seeds rather than pictures. Cheap — no rendering, no
// surface build — so it runs in seconds where a capture runs in minutes.
//
// What a meadow world is, and why each clause is here rather than in taste:
//
//   · `terrestrial`, not `ocean`. The class is not a mood: `system.js` gives
//     ocean worlds `oceanLevel` 0.3–0.5 against terrestrial's -0.05–0.16, so an
//     ocean world drowns its own land and `life.js`'s `dryland()` returns null
//     over nearly all of it. No dryland, no trees.
//   · 265 ≤ Teq ≤ 305. `isBiosphere` opens at 235 K because life is not the
//     same question as *foliage*; a meadow wants liquid water where you are
//     standing, not somewhere on the planet.
//   · a G star. §9.6 derives the sky's four stops from the star's blackbody, so
//     the palette anchors in §9.1 are that transfer's output for a G-type star.
//     Photographing the light model under an M dwarf measures the transfer, not
//     the meadow.
//   · the solved landing site is above sea level. The last clause, and the only
//     one that needs the terrain: a world can be 70% land and still put you on
//     the water. `findLandingSite` is what `surface.js` falls back to and
//     `planetHeight` is the height field it lands in.
//
// Deterministic, and it has to be: the seed it prints is the seed a capture
// takes, and §2.3 is what makes that a promise rather than a coincidence.

import { arg, launch, playwright, serve } from './lib.js';

const first = Number(arg('from', 1));
const span = Number(arg('span', 400));
const want = Number(arg('count', 6));

const SEARCH = (origin, from, span, want) => `
  import { hash } from '${origin}/src/rng.js';
  import { galaxyParams } from '${origin}/src/galaxy.js';
  import { systemParams } from '${origin}/src/system.js';
  import { isBiosphere } from '${origin}/src/life.js';
  import { findLandingSite, planetHeight } from '${origin}/src/terrain.js';

  // A meadow world is a world whose FIRST biosphere hit is a meadow.
  //
  // The distinction is the whole reason this file is not a filter over all
  // planets. \`tools/shot.js --want life\` walks the galaxy's stars in order and
  // stops at the first \`isBiosphere(pl)\`; it has no way to be told "keep
  // looking". So a seed whose third biosphere is a temperate land world is
  // still a seed that photographs its first, and reporting it would be
  // reporting a world the capture will never visit. The walk below is that
  // walk, to the letter, and the test is applied to what it stops on.
  const meadow = (pl, sp) => {
    if (pl.type !== 'terrestrial') return false;          // ocean class drowns its land
    if (!(pl.Teq >= 265 && pl.Teq <= 305)) return false;  // liquid water where you stand
    if (!((pl.atmo ?? 1) >= 0.35)) return false;          // surface.js gates the meadow at 0.05
    const T = sp.temp ?? 5778;
    if (!(T >= 5200 && T <= 6100)) return false;          // §9.6's stops are a G star's
    const dir = findLandingSite(pl, hash(pl.seed, 0x1a4d));
    const h = planetHeight(dir[0], dir[1], dir[2], pl.noiseSeed);
    const ocean = pl.oceanLevel > -0.5 ? pl.oceanLevel : 0;
    return h - ocean > 0.012;                             // and you come down on land
  };

  const out = [];
  for (let s = ${from}; s < ${from + span} && out.length < ${want}; s++) {
    const galaxySeed = hash(s, 0xbe0) >>> 0;
    const gp = galaxyParams(galaxySeed);
    let hit = null, hitSp = null;
    outer:
    for (let i = 0; i < 8192; i++) {
      const starSeed = hash(gp.seed, i, 0x57a9) >>> 0;
      const sp = systemParams(starSeed);
      for (let p = 0; p < sp.planets.length; p++) {
        const pl = sp.planets[p];
        if (pl.typeId > 4) continue;
        if (!isBiosphere(pl)) continue;
        hit = { pl, star: starSeed, planet: p, i }; hitSp = sp;
        break outer;
      }
    }
    if (!hit || !meadow(hit.pl, hitSp)) continue;
    const pl = hit.pl;
    const dir = findLandingSite(pl, hash(pl.seed, 0x1a4d));
    const ocean = pl.oceanLevel > -0.5 ? pl.oceanLevel : 0;
    out.push({
      seed: s, star: hit.star, planet: hit.planet, idx: hit.i,
      starT: Math.round(hitSp.temp ?? 5778), Teq: pl.Teq,
      atmo: +(pl.atmo ?? 1).toFixed(2), ocean: +ocean.toFixed(3),
      land: +(planetHeight(dir[0], dir[1], dir[2], pl.noiseSeed) - ocean).toFixed(3),
      lat: +(Math.asin(Math.max(-1, Math.min(1, dir[1]))) * 180 / Math.PI).toFixed(1),
    });
  }
  window.__found = out;
`;

const pw = await playwright();
const site = await serve();
const browser = await launch(pw);
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('  page error: ' + e.message.split('\n')[0]));
await page.goto(`${site.origin}/index.html?seed=1`, { waitUntil: 'load' });
await page.addScriptTag({ type: 'module', content: SEARCH(site.origin, first, span, want) });
await page.waitForFunction(() => Array.isArray(window.__found), null, { timeout: 600000 });
const found = await page.evaluate(() => window.__found);
await browser.close();
await site.close();

console.log(`\n  seeds ${first}..${first + span - 1} · ${found.length} meadow world(s)\n`);
console.log(`  ${'seed'.padStart(10)} ${'star K'.padStart(7)} ${'Teq'.padStart(5)}`
  + ` ${'atmo'.padStart(5)} ${'sea'.padStart(7)} ${'land'.padStart(7)} ${'lat'.padStart(6)}  planet`);
for (const f of found) {
  console.log(`  ${String(f.seed).padStart(10)} ${String(f.starT).padStart(7)} ${String(f.Teq).padStart(5)}`
    + ` ${String(f.atmo).padStart(5)} ${String(f.ocean).padStart(7)} ${String(f.land).padStart(7)}`
    + ` ${String(f.lat).padStart(6)}  #${f.planet} of star ${f.star}`);
}
if (!found.length) console.log('  none — widen with --span or move --from');
console.log('');
