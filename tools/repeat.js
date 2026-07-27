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
// cold, settles the same number of frames, and compares the two images at the
// tolerance §7.3 names.

import { arg, launch, playwright, serve } from './lib.js';
import { decodePNG } from './png.js';

const query = arg('url', 'seed=20250601') === true ? 'seed=20250601' : String(arg('url', 'seed=20250601'));
const frames = Number(arg('frames', 90));
const dtMs = Number(arg('dt', 1000 / 60));

const settle = (n) => new Promise((d) => {
  let i = 0;
  const tick = () => (++i >= n ? d(i) : requestAnimationFrame(tick));
  requestAnimationFrame(tick);
});

const pw = await playwright();
const site = await serve();
const browser = await launch(pw);

async function once() {
  const page = await browser.newPage({ viewport: { width: 640, height: 400 } });
  const url = `${site.origin}/index.html?${query}${query.includes('dt=') ? '' : `&dt=${dtMs}`}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction('window.AEON', null, { timeout: 60000 });
  await page.evaluate(() => document.querySelectorAll('.hud, #splash').forEach(e => { e.style.visibility = 'hidden'; }));
  await page.evaluate(settle, frames);
  const img = decodePNG(await page.screenshot({ type: 'png' }));
  await page.close();
  return img;
}

console.log(`\nrepeat · ?${query} · ${frames} frames at a ${dtMs.toFixed(3)} ms timestep\n`);

const a = await once();
const b = await once();

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
console.log(`  bit-identical pixels : ${pctIdentical.toFixed(2)}%`);
console.log(`  within 2/255         : ${pctWithin2.toFixed(2)}%   (§7.3 asks for ≥97%)`);
console.log(`  worst channel delta  : ${worst}/255`);

await browser.close();
await site.close();

// §7.3's own threshold, applied to the thing it was written about
const pass = pctWithin2 >= 97;
console.log(`\n  ${pass ? 'PASS' : 'FAIL'} — two loads of one URL ${pass ? 'agree' : 'do not agree'} to §7.3's tolerance\n`);
process.exit(pass ? 0 : 1);
