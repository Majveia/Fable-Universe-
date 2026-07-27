// Does the same URL render the same frame twice?
//
//   node tools/repeat.js [--url "seed=20250601&m1=1"] [--frames 90]
//
// §2.3 makes a seeded universe a permanent public address, and §7.3 asks new
// shader math to survive "a pixel diff against the GPU output — ≥97% of pixels
// within 2/255". That second one was unrunnable for a long time: the universe
// was deterministic but the *frame* was not, because transient motion drew from
// Math.random() and a few animations read the wall clock. Both are seeded now
// (src/rng.js, src/clock.js), and a fixed timestep pins the order the draws
// come out in (?dt=).
//
// This is the test that says whether that worked. It loads one URL twice from
// cold, **halts** each at the same app frame, and compares the two images at
// the tolerance §7.3 names.
//
// Photographing a known frame is load-bearing, and getting it right took two
// goes — both of which passed at 100% on a software rasteriser and failed on
// real hardware, which is the whole argument for §M0's "real GPU, not CI
// SwiftShader".
//
//   1. It began as "90 requestAnimationFrame ticks after `window.AEON`
//      appeared". The render loop starts when App constructs, and how many
//      frames it completes before an external observer attaches is a property
//      of the machine. Reported 11.9%.
//   2. Counting the app's own frames fixed that and was still not enough,
//      because **the loop kept running while the screenshot was taken**. The
//      test would report, correctly, that both runs reached frame 94 — and then
//      photograph frame 94 in one and something later in the other. Reported
//      14.54%, worst channel delta 68/255.
//
// On a software rasteriser that second window holds zero or one extra frames
// and nothing has moved. At 1400 fps it holds dozens. Two honest photographs of
// two different moments, twice over.
//
// So the app is halted at frame N and photographed while stopped. A determinism
// test that cannot say which frame it photographed cannot tell a
// nondeterministic universe from a fast one.

import { arg, launch, playwright, serve } from './lib.js';
import { decodePNG } from './png.js';

const query = arg('url', 'seed=20250601') === true ? 'seed=20250601' : String(arg('url', 'seed=20250601'));
const frames = Number(arg('frames', 90));
const dtMs = Number(arg('dt', 1000 / 60));

const pw = await playwright();
const site = await serve();
const browser = await launch(pw);

async function once() {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const url = `${site.origin}/index.html?${query}${query.includes('dt=') ? '' : `&dt=${dtMs}`}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.AEON', null, { timeout: 60000 });
  await page.evaluate(() => document.querySelectorAll('.hud, #splash').forEach(e => { e.style.visibility = 'hidden'; }));
  if (await page.evaluate(() => typeof window.AEON.haltAt !== 'function')) {
    throw new Error('repeat: this build cannot be halted at a frame, so the frame '
      + 'this photograph was taken at is unknowable. See src/main.js haltAt().');
  }
  await page.evaluate((n) => window.AEON.haltAt(n), frames);
  await page.waitForFunction(() => window.AEON.halted > 0, null, { timeout: 120000 });
  const at = await page.evaluate(() => window.AEON.halted);
  const img = decodePNG(await page.screenshot({ type: 'png' }));
  await page.close();
  return { img, at };
}

console.log(`\nrepeat · ?${query} · app frame ${frames} at a ${dtMs.toFixed(3)} ms timestep\n`);

const first = await once();
const second = await once();
const a = first.img, b = second.img;

// If the two runs were not photographed at the same frame the comparison is
// meaningless — report that instead of a percentage, because a percentage would
// be believed.
if (first.at !== second.at) {
  console.error(`  photographed at frame ${first.at} and frame ${second.at}.`);
  console.error('  Nothing can be concluded from comparing them.\n');
  await browser.close();
  await site.close();
  process.exit(2);
}

let identical = 0, within2 = 0, worst = 0;
const n = a.width * a.height;
for (let i = 0; i < a.data.length; i += 4) {
  const d = Math.max(
    Math.abs(a.data[i] - b.data[i]),
    Math.abs(a.data[i + 1] - b.data[i + 1]),
    Math.abs(a.data[i + 2] - b.data[i + 2]));
  if (d === 0) identical++;
  if (d <= 2) within2++;
  if (d > worst) worst = d;
}

const pctIdentical = (identical / n) * 100;
const pctWithin2 = (within2 / n) * 100;
console.log(`  both runs at frame   : ${first.at}`);
console.log(`  bit-identical pixels : ${pctIdentical.toFixed(2)}%`);
console.log(`  within 2/255         : ${pctWithin2.toFixed(2)}%   (§7.3 asks for ≥97%)`);
console.log(`  worst channel delta  : ${worst}/255`);

await browser.close();
await site.close();

// §7.3's own threshold, applied to the thing it was written about
const pass = pctWithin2 >= 97;
console.log(`\n  ${pass ? 'PASS' : 'FAIL'} — two loads of one URL ${pass ? 'agree' : 'do not agree'} to §7.3's tolerance\n`);
process.exit(pass ? 0 : 1);
