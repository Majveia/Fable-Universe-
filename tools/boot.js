// Does the universe still boot?
//
//   node tools/boot.js [--all] [--only <name>] [--timeout 240]
//
// This exists because of a bug that shipped green.
//
// `tree.js` renamed a local from `trunkMat` to `barkMat` and missed one
// reference two hundred lines down, inside `life.js`'s grove builder. Valid
// JavaScript. `node --check` passes it. `tools/parse.js` passes it — it checks
// syntax and import edges, and this is neither. `tools/verify.js` passes it,
// with 707 green checks, because every one of them tests a pure function and
// this defect is in the wiring between them. `tools/shadercheck.js` passes it,
// because the seed it walks does not land on a world with a biosphere.
//
// What it actually does is throw `ReferenceError` partway through building the
// surface scale of **every world that has life on it**, which aborts the
// constructor, which means no terrain, no grass, no sky. A black screen. The
// exact symptom that was reported from a phone, on a build whose CI was green.
//
// ---------------------------------------------------------------------------
// It waits for construction, not for a frame
//
// The first version waited for `frames > 0`, which meant waiting for a software
// rasteriser to paint a meadow — 160 seconds a station, and most of that time
// proving nothing. A `ReferenceError` in a builder throws while the scene is
// being *built*, which is CPU work: the same station settles in 9 seconds when
// you ask the right question. The biosphere worlds still cost about three
// minutes, because building them really is that much work, and that number is
// worth knowing on its own.
//
// It still waits briefly for frames afterwards, because a throw on frame two is
// also a black screen — but it does not *block* on them.
//
// ---------------------------------------------------------------------------
// What this checks, and what it deliberately does not
//
// It navigates to a set of deep links and asserts that **nothing throws** and
// that you land on the scale the link asked for. That is all. It does not look
// at a pixel, does not measure a frame, does not score anything — `capture.js`
// and `docs/GPU-RUN.md` do that, they need real silicon, and they are not this.
//
// ---------------------------------------------------------------------------
// Two tiers, because the worlds are not equally expensive
//
// Surveyed cost, measured here on a software rasteriser: a vacuum scale is 8–11
// seconds, a barren or ice world 9, a cold terrestrial 42, and a world with a
// biosphere in flower **174–198** — grass rings, a wind render target, trees
// grown from the pipe model, ground cover and blossom, all built before the
// first frame. Twenty of those on every push is not a gate anyone leaves on.
//
// So `core` is every scale plus the cheap world kinds plus **one** biosphere in
// bloom, which is the branch that has actually broken; it runs on every push.
// `--all` adds the rest of the world kinds and the awkward states — night,
// storm, a settlement, a moon, both ocean temperatures — and runs per pull
// request, where minutes are affordable.

import { arg, launch, playwright, serve } from './lib.js';

/**
 * `[name, query, expected scale, tier]`.
 *
 * `s=2309773419` is Kerune: barren, three terrestrials (357 K, 286 K, 210 K),
 * a barren and three ice worlds — one of almost everything, which is why it
 * carries most of the list. Planet 2 is the biosphere: 286 K and inhabited.
 * `s=424242` supplies the ocean worlds, which Kerune has none of.
 *
 * `bloom=1` forces the flowering regardless of where the world sits in its own
 * year. Without it the station is a coin toss — the season is seeded per world
 * and 68% of an orbit has no flower on it — and a gate that tests a different
 * thing on different days is not a gate.
 *
 * `giants=1` is needed for the cloud deck at all: gas giants are switched off
 * by default (`system.js`), so **`CloudsScale` is unreachable without it**. The
 * first version of this station omitted the flag, landed on `SurfaceScale`, and
 * passed — which is exactly the silent hole this file exists to close, so it is
 * now pinned to the scale it claims to visit.
 */
const STATIONS = [
  // --- the six scales -----------------------------------------------------
  ['cosmic-web', 'seed=20250601', 'CosmicScale', 'core'],
  ['galaxy', 'seed=20250601&g=1', 'GalaxyScale', 'core'],
  ['star-system', 'seed=20250601&g=1&s=2309773419', 'SystemScale', 'core'],
  ['black-hole', 'seed=20250601&g=1&bh=1', 'BlackHoleScale', 'core'],
  ['planet-orbit', 'seed=20250601&g=1&s=2309773419&pl=2&quad=1&ap=0', 'PlanetScale', 'core'],
  ['cloud-deck', 'giants=1&g=1&s=2309773419&p=5&cl=1', 'CloudsScale', 'core'],

  // --- the cheap worlds, and the one expensive one that matters -----------
  ['barren 454K', 'g=1&s=2309773419&p=0', 'SurfaceScale', 'core'],
  ['ice 26K', 'g=1&s=31337&p=5', 'SurfaceScale', 'core'],
  ['biosphere in bloom', 'g=1&s=2309773419&p=2&bloom=1', 'SurfaceScale', 'core'],

  // --- the rest of the world kinds, and the awkward states ----------------
  ['terrestrial 357K', 'g=1&s=2309773419&p=1', 'SurfaceScale', 'full'],
  ['terrestrial 210K', 'g=1&s=2309773419&p=3', 'SurfaceScale', 'full'],
  ['ice 115K', 'g=1&s=2309773419&p=5', 'SurfaceScale', 'full'],
  ['ocean 287K', 'g=1&s=424242&p=1', 'SurfaceScale', 'full'],
  ['ocean 228K', 'g=1&s=424242&p=2', 'SurfaceScale', 'full'],
  ['moon', 'g=1&s=2309773419&p=0&moon=0', 'SurfaceScale', 'full'],
  ['biosphere + town', 'g=1&s=2309773419&p=2&bloom=1&built=1', 'SurfaceScale', 'full'],
  ['biosphere at night', 'g=1&s=2309773419&p=2&bloom=1&sun=-8', 'SurfaceScale', 'full'],
  ['biosphere in storm', 'g=1&s=2309773419&p=2&bloom=1&storm=1', 'SurfaceScale', 'full'],
  // A giant has no ground, so `?pl=` on one used to fall off the end of
  // `main.js`'s restore chain and leave you on the system view. It now opens
  // the cloud deck, which is the only place on a giant there is — this station
  // is what caught that, by asserting the scale rather than just "no throw".
  ['ringed giant', 'giants=1&g=1&s=987654321&pl=3&quad=1&ap=0', 'CloudsScale', 'full'],
];

// `RoomScale` is the one constructor nothing here reaches: it needs a room key,
// which is generated rather than guessable. Named rather than left as a silent
// hole — the whole lesson of this file is that an unvisited branch reads
// exactly like a working one.

const all = arg('all', false) !== false;
const only = arg('only', null);
const buildMs = Number(arg('timeout', 300)) * 1000;
const frameMs = Number(arg('frames', 25)) * 1000;

const chosen = STATIONS.filter(([n, , , tier]) =>
  (only ? only === n : true) && (all || tier === 'core' || only));

const site = await serve();
const browser = await launch(await playwright());
// One page, reused. A fresh context per station makes the browser churn while
// the rasteriser is still winding down the last one, and the *navigation*
// starts timing out — which reads as a defect and is not one.
const page = await browser.newPage({ viewport: { width: 96, height: 64 } });
page.setDefaultNavigationTimeout(buildMs);

let errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
// A console error is not always a defect — a driver warning is not a throw — so
// only the ones that name an exception count.
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && /(Error|Exception|undefined is not|is not a function)/.test(t)) {
    errs.push('console: ' + t);
  }
});

let failed = 0;
console.log(`\nboot · does anything throw on the way in? · ${chosen.length} stations`
  + `${all ? ' (--all)' : ''}\n`);

for (const [name, q, want] of chosen) {
  const t0 = Date.now();
  errs = [];
  let info = { scale: '—', frames: 0 };
  try {
    await page.goto(`${site.origin}/index.html?${q}`, { waitUntil: 'domcontentloaded' });
    // built — the question this tool actually asks
    await page.waitForFunction(
      () => !!(window.AEON && window.AEON.stack && window.AEON.stack.length
        && window.AEON.stack[window.AEON.stack.length - 1]),
      null, { timeout: buildMs });
    // …and then a little of the update loop, without blocking on it
    await page.waitForFunction(() => window.AEON.frames > 0, null, { timeout: frameMs })
      .catch(() => {});
    await page.waitForTimeout(3000);
    info = await page.evaluate(() => {
      const sc = window.AEON.stack[window.AEON.stack.length - 1];
      let inst = 0, flowers = 0;
      if (sc.scene && sc.scene.traverse) {
        sc.scene.traverse((o) => {
          if (!o.isInstancedMesh) return;
          inst += o.count;
          if (o.geometry && o.geometry.type === 'CircleGeometry') flowers += o.count;
        });
      }
      return { scale: sc.constructor.name, inst, flowers, frames: window.AEON.frames };
    });
  } catch (e) {
    errs.push('never constructed: ' + String(e).split('\n')[0]);
  }

  // …and it has to be the scale the link asked for. `main.js` wraps the
  // deep-link restore in try/finally so the veil always lifts, which means a
  // throw inside a scale's constructor can leave you *on the scale above* with
  // frames ticking over happily. That is still a black screen as far as anyone
  // holding the phone is concerned, and without this line it reads as green.
  if (want && info.scale !== want && info.scale !== '—') {
    errs.push(`landed on ${info.scale}, expected ${want}`);
  }

  const seen = [...new Set(errs)];
  if (seen.length) failed++;
  console.log(`  ${seen.length ? 'FAIL' : 'ok  '} ${name.padEnd(20)} ${String(info.scale).padEnd(15)}`
    + ` inst=${String(info.inst ?? 0).padStart(6)}`
    + ` flowers=${String(info.flowers ?? 0).padStart(5)}`
    + ` f=${String(info.frames ?? 0).padStart(3)}`
    + ` ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  for (const e of seen.slice(0, 4)) console.log(`         ${e}`);
}

console.log(`\n${chosen.length - failed}/${chosen.length} stations boot clean`);

await browser.close();
await site.close();
process.exit(failed ? 1 : 0);
