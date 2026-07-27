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
// cold, waits for each to reach the same *app frame*, and compares the two
// images at the tolerance §7.3 names.
//
// "The same app frame" is load-bearing, and it used to be "90 requestAnimation-
// Frame ticks after `window.AEON` appeared", which is not the same thing. The
// render loop starts when App constructs; how many frames it gets through
// before an external observer attaches is a property of the machine, not of the
// universe. On a software rasteriser the first frame is slow enough that the
// observer always wins the race and the two runs land on the same frame — so
// the test passed at 100% bit-identical. On an RTX 3060 it does not, and the
// test reported 11.9%: two honest photographs of two different moments.
//
// A determinism test that cannot say which frame it photographed cannot tell a
// nondeterministic universe from a fast one. So it asks the app.

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
  if (await page.evaluate(() => typeof window.AEON.frames !== 'number')) {
    throw new Error('repeat: this build has no App.frames counter, so the frame '
      + 'this photograph was taken at is unknowable. See src/main.js _frame().');
  }
  await page.waitForFunction((n) => window.AEON.frames >= n, frames, { timeout: 120000 });
  const at = await page.evaluate(() => window.AEON.frames);
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
