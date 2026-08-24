// What the station ring actually costs, both ways — CLAUDE.md §5, §M0, §8 axis 5.
//
//   node tools/ringcensus.js
//
// Act 1 of the Long Silence port claims a number: the habitat ring goes from
// sixty-eight draws to two. `tools/drawcensus.js` is the right instrument for
// that claim and cannot make it, because it navigates by deep link and **being
// aboard the ring is not a URL**. That is a real §2.4 gap — "every place is a
// URL", and the ring is a place a visitor stands in — but it is a gap this
// change did not open and does not close.
//
// So this measures the two builders directly instead. Both are called as
// methods on a stub carrying the five things they reach through `this`, which
// means the functions under test are the shipped ones rather than transcriptions
// of them. A count is not a claim about how a frame looks (§16 rule 1) — it is a
// count, and this is where it comes from.
import { arg, launch, playwright, serve } from './lib.js';

const pw = await playwright();
const { origin, close } = await serve();
const browser = await launch(pw);
const page = await browser.newPage({ viewport: { width: 200, height: 200 } });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon|404/i.test(t)) errors.push(t.slice(0, 300));
});

await page.goto(origin + '/tools/ringcensus.html', { waitUntil: 'load' });
await page.waitForFunction(() => window.__result !== undefined, null,
  { timeout: Number(arg('timeout', 120)) * 1000 }).catch(() => {});
const r = await page.evaluate(() => window.__result);
await browser.close();
await close();

if (!r) {
  console.error('ringcensus · the fixture never finished — nothing was built, so nothing was counted');
  process.exit(2);
}
if (!r.haveClass) {
  console.error('ringcensus · could not find the PlanetScale class in src/planetscale.js');
  process.exit(2);
}

let bad = 0;
for (const f of r.fails) { bad = 1; console.error('  fail  ' + f); }
for (const e of errors) { bad = 1; console.error('  page error: ' + e); }

const row = (n, v) => v
  ? `  ${n.padEnd(7)} ${String(v.meshes).padStart(3)} draws · ${String(v.materials)} material(s) · ${v.verts.toLocaleString()} verts`
  : `  ${n.padEnd(7)} —`;
console.log(row('stock', r.out.stock));
console.log(row('plated', r.out.plated));

const a = r.out.stock, b = r.out.plated;
if (a && b) {
  if (b.meshes >= a.meshes) {
    bad = 1;
    console.error(`\nthe plated ring is not cheaper to submit — ${b.meshes} draws against ${a.meshes}.\n`
      + 'The merge is the whole reason the seams run across part boundaries; if it\n'
      + 'did not happen, the surface law is drawing on unmerged parts and restarting\n'
      + 'the plate grid at every one of them.');
  } else {
    console.log(`\n  ${a.meshes} draws -> ${b.meshes}, a factor of ${(a.meshes / b.meshes).toFixed(1)}`);
  }
}
console.log(`\nringcensus · ${bad ? 'FAILED' : 'clean'}`);
process.exit(bad);
