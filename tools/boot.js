// Does the universe still boot?
//
//   node tools/boot.js [--timeout 120] [--only surface-in-bloom]
//
// This exists because of a bug that shipped green.
//
// `tree.js` renamed a local from `trunkMat` to `barkMat` and missed one
// reference two hundred lines down, inside `life.js`'s grove builder. Valid
// JavaScript. `node --check` passes it. `tools/parse.js` passes it — it checks
// syntax and import edges, and this is neither. `tools/verify.js` passes it,
// with 706 green checks, because every one of them tests a pure function and
// this defect is in the wiring between them. `tools/shadercheck.js` passes it,
// because the seed it walks does not land on a world with a biosphere.
//
// What it actually does is throw `ReferenceError` partway through building the
// surface scale of **every world that has life on it**, which aborts the
// constructor, which means no terrain, no grass, no sky. A black screen. The
// exact symptom that was reported from a phone, on a build whose CI was green.
//
// ---------------------------------------------------------------------------
// What this checks, and what it deliberately does not
//
// It navigates to a handful of deep links and asserts that **nothing throws**.
// That is all. It does not look at a pixel, does not measure a frame, does not
// score anything — `capture.js` and `docs/GPU-RUN.md` do that, they need real
// silicon, and they are not this.
//
// The point is that it is cheap enough to run on every push. A thrown exception
// during scene construction surfaces in the first second or two; the wait after
// that is only there to catch a throw from the first few frames of the update
// loop. Nothing here waits for terrain to finish streaming, because a black
// screen does not need streaming to be diagnosed.
//
// The station list matters more than the mechanism. Two rules:
//
//   · **every scale**, because each has its own constructor;
//   · **at least one world with a biosphere, in flower**, because that is the
//     branch the bug above lived in and a default seed does not reach it.
//
// A world in bloom is also the branch with the most construction in it — trees
// grown from the pipe model, ground cover, blossom, falling petals — so it is
// the cheapest single station that exercises the most new wiring.

import { arg, launch, playwright, serve } from './lib.js';

/**
 * The route. `q` is the query string; `wait` is what to watch for before
 * declaring the station up — a predicate evaluated in the page.
 *
 * `s=2309773419&p=2` is Kerune III, a 286 K terrestrial world with a biosphere,
 * found by scanning rather than chosen: `isBiosphere()` wants terrestrial or
 * ocean between 235 K and 330 K, and most worlds are not. `bloom=1` forces the
 * flowering regardless of where the world sits in its own year, which is the
 * only way to make this station deterministic — the season is seeded per world
 * and 68% of the orbit has no flower on it.
 */
const STATIONS = [
  ['cosmic-web', 'seed=20250601', 'CosmicScale'],
  ['galaxy', 'seed=20250601&g=1', 'GalaxyScale'],
  ['star-system', 'seed=20250601&g=1&s=2309773419', 'SystemScale'],
  ['black-hole', 'seed=20250601&g=1&bh=1', 'BlackHoleScale'],
  ['planet-orbit', 'seed=20250601&g=1&s=2309773419&pl=2&quad=1&ap=0', 'PlanetScale'],
  ['surface-in-bloom', 'g=1&s=2309773419&p=2&bloom=1&quad=0', 'SurfaceScale'],
];

// Two constructors this list does not reach, named rather than left as a
// silent hole: `CloudsScale` needs a gas giant and Kerune has none — its eight
// worlds are three terrestrials, two barren and three ice — and `RoomScale`
// needs a room key, which is generated rather than guessable. `capture.js`'s
// route covers the cloud deck; nothing covers the rooms yet.

const only = arg('only', null);
const waitMs = Number(arg('timeout', 120)) * 1000;
const settleMs = Number(arg('settle', 6)) * 1000;

const site = await serve();
const browser = await launch(await playwright());

let failed = 0;
console.log('\nboot · does anything throw on the way in?\n');

for (const [name, q, want] of STATIONS) {
  if (only && only !== name) continue;
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  // A console error is not always a defect — a driver warning is not a throw —
  // so only the ones that name an exception count. `pageerror` is the real
  // signal; this is the safety net for something caught and logged.
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' && /(Error|Exception|undefined is not|is not a function)/.test(t)) {
      errs.push('console: ' + t);
    }
  });

  let up = false;
  try {
    await page.goto(`${site.origin}/index.html?${q}`, { waitUntil: 'domcontentloaded' });
    // "the scale exists and has drawn at least one frame" — not "the world has
    // finished streaming", which is a different and much slower question
    await page.waitForFunction(
      () => !!(window.AEON?.stack?.length && window.AEON.frames > 0),
      null, { timeout: waitMs });
    up = true;
  } catch (e) {
    errs.push('never came up: ' + String(e).split('\n')[0]);
  }
  // let the update loop run: a throw on frame 2 is still a black screen
  if (up) await page.waitForTimeout(settleMs);

  const scale = up ? await page.evaluate(() => {
    const sc = window.AEON.stack[window.AEON.stack.length - 1];
    return sc?.constructor?.name ?? '?';
  }) : '—';

  // …and it has to be the scale the link asked for. `main.js` wraps the
  // deep-link restore in try/finally so the veil always lifts, which means a
  // throw inside a scale's constructor can leave you *on the scale above* with
  // frames ticking over happily. That is still a black screen as far as anyone
  // holding the phone is concerned, and without this line it reads as green.
  if (up && want && scale !== want) errs.push(`landed on ${scale}, expected ${want}`);

  const seen = [...new Set(errs)];
  if (seen.length) {
    failed++;
    console.log(`  FAIL ${name.padEnd(18)} ${scale}`);
    for (const e of seen.slice(0, 4)) console.log(`         ${e.split('\n')[0]}`);
  } else {
    console.log(`  ok   ${name.padEnd(18)} ${scale}`);
  }
  await page.close();
}

const ran = STATIONS.filter(([n]) => !only || only === n).length;
console.log(`\n${ran - failed}/${ran} stations boot clean`);

await browser.close();
await site.close();
process.exit(failed ? 1 : 0);
