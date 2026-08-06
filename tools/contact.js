// The contact sheet — CLAUDE.md §8.
//
//   node tools/contact.js --in docs/captures/airmat --out docs/captures/airmat/sheet.png
//   node tools/contact.js --in a.png,b.png --zoom 250,180,300,200 --diff
//
// §8's rubric is unusually specific about what a review has to be: *"One
// sentence per axis naming the specific pixel region that lost the point.
// 'Looks good' is a failed review."* You cannot name a region you cannot point
// at, and two PNGs in a folder are not something you can point at — the eye
// forgets a frame in the two seconds it takes to open the next one.
//
// So this composites them: labelled, aligned, at the same scale, optionally
// with a zoom inset on the region under argument and a difference plate that
// says where the change actually is rather than where it feels like it is.
//
// ---------------------------------------------------------------------------
// The browser is the compositor, and that is not a workaround
//
// §2.2 forbids a runtime dependency and the spirit of it reaches the tools:
// nothing here should need an image library installed to look at a picture.
// Chromium is already present for every capture, it has a canvas, and a canvas
// encodes PNG. So the sheet is drawn in a page and screenshotted — the same
// trick, and the same justification, as every other tool in this directory
// getting its numbers from the real renderer instead of from a model of one.
//
// ---------------------------------------------------------------------------
// The difference plate is amplified, and says by how much
//
// A raw `|a - b|` of two frames that differ by a fifth of a channel is a black
// rectangle, which reads as "nothing changed" and is the opposite of the truth.
// So the difference is scaled by `--gain` and the factor is printed on the
// plate, because an amplified image that does not say it is amplified is a lie
// told in a legend-free chart.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, basename, resolve } from 'node:path';
import { arg, launch, playwright, REPO } from './lib.js';

const inArg = String(arg('in', 'docs/captures/shot'));
const outArg = String(arg('out', ''));
const zoom = String(arg('zoom', '') === true ? '' : arg('zoom', ''));
const gain = Number(arg('gain', 6));
const wantDiff = arg('diff') === true;
const cols = Number(arg('cols', 0));
const title = String(arg('title', '') === true ? '' : arg('title', ''));

/** either a folder of PNGs, or a comma list of them */
async function inputs() {
  if (inArg.includes(',') || inArg.endsWith('.png')) {
    return inArg.split(',').map((f) => resolve(REPO, f.trim()));
  }
  const { readdir } = await import('node:fs/promises');
  const dir = resolve(REPO, inArg);
  const names = (await readdir(dir)).filter((f) => f.endsWith('.png') && f !== 'sheet.png');
  names.sort();
  return names.map((f) => resolve(dir, f));
}

const files = await inputs();
if (!files.length) { console.error('contact · no PNGs found in ' + inArg); process.exit(1); }

const plates = [];
for (const f of files) {
  plates.push({
    label: basename(f, '.png').replace(/-/g, ' '),
    data: 'data:image/png;base64,' + (await readFile(f)).toString('base64'),
  });
}

const SHEET = ({ plates, zoom, gain, wantDiff, cols, title }) => new Promise((done) => {
  const PAD = 18, LABEL = 30, GUTTER = 14;
  const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });

  Promise.all(plates.map((p) => load(p.data))).then(async (imgs) => {
    const z = zoom ? zoom.split(',').map(Number) : null;   // x,y,w,h in source pixels
    const W0 = imgs[0].width, H0 = imgs[0].height;
    // The sheet is drawn at source resolution and the page is sized to it, so
    // nothing is resampled twice — a comparison that softens both plates
    // equally still destroys the thing being compared.
    const list = imgs.map((im, i) => ({ im, label: plates[i].label }));

    if (wantDiff && imgs.length >= 2) {
      const a = document.createElement('canvas'); a.width = W0; a.height = H0;
      const b = document.createElement('canvas'); b.width = W0; b.height = H0;
      a.getContext('2d').drawImage(imgs[0], 0, 0);
      b.getContext('2d').drawImage(imgs[imgs.length - 1], 0, 0);
      const A = a.getContext('2d').getImageData(0, 0, W0, H0);
      const B = b.getContext('2d').getImageData(0, 0, W0, H0);
      const D = new ImageData(W0, H0);
      let moved = 0;
      for (let i = 0; i < A.data.length; i += 4) {
        let m = 0;
        for (let k = 0; k < 3; k++) {
          const d = Math.min(255, Math.abs(A.data[i + k] - B.data[i + k]) * gain);
          D.data[i + k] = d; if (d > m) m = d;
        }
        D.data[i + 3] = 255;
        if (m > 2 * gain) moved++;
      }
      const c = document.createElement('canvas'); c.width = W0; c.height = H0;
      c.getContext('2d').putImageData(D, 0, 0);
      const im = await load(c.toDataURL());
      list.push({ im, label: `difference x${gain} · ${((moved / (W0 * H0)) * 100).toFixed(2)}% of frame moved` });
    }

    const n = list.length;
    const nc = cols || (n <= 2 ? 1 : 2);
    const nr = Math.ceil(n / nc);
    const zw = z ? Math.round(W0 * 0.34) : 0;
    const zh = z ? Math.round(zw * (z[3] / z[2])) : 0;
    const cellW = W0 + (z ? GUTTER + zw : 0);
    const cellH = Math.max(H0, z ? zh : 0) + LABEL;

    const cv = document.createElement('canvas');
    const TITLE = title ? 44 : 0;
    cv.width = PAD * 2 + nc * cellW + (nc - 1) * GUTTER;
    cv.height = PAD * 2 + TITLE + nr * cellH + (nr - 1) * GUTTER;
    const g = cv.getContext('2d');
    g.fillStyle = '#0b0d10'; g.fillRect(0, 0, cv.width, cv.height);

    if (title) {
      g.fillStyle = '#e8e4dc';
      g.font = '600 22px ui-monospace, SFMono-Regular, Menlo, monospace';
      g.fillText(title, PAD, PAD + 26);
    }

    list.forEach((p, i) => {
      const cx = PAD + (i % nc) * (cellW + GUTTER);
      const cy = PAD + TITLE + Math.floor(i / nc) * (cellH + GUTTER);
      g.drawImage(p.im, cx, cy, W0, H0);
      if (z) {
        // the inset, nearest-neighbour so a zoom shows pixels rather than a guess
        g.imageSmoothingEnabled = false;
        g.drawImage(p.im, z[0], z[1], z[2], z[3], cx + W0 + GUTTER, cy, zw, zh);
        g.imageSmoothingEnabled = true;
        g.strokeStyle = '#ffcf7a'; g.lineWidth = 2;
        g.strokeRect(cx + z[0], cy + z[1], z[2], z[3]);
        g.strokeRect(cx + W0 + GUTTER, cy, zw, zh);
      }
      g.fillStyle = '#b9b4aa';
      g.font = '500 15px ui-monospace, SFMono-Regular, Menlo, monospace';
      g.fillText(p.label, cx + 2, cy + H0 + 21);
    });

    done(cv.toDataURL('image/png'));
  });
});

const pw = await playwright();
const browser = await launch(pw);
const page = await browser.newPage();
await page.setContent('<!doctype html><meta charset=utf-8><title>contact</title>');
const url = await page.evaluate(SHEET, { plates, zoom, gain, wantDiff, cols, title });
await browser.close();

const out = resolve(REPO, outArg || (inArg.endsWith('.png') ? 'docs/captures/sheet.png' : inArg + '/sheet.png'));
await mkdir(dirname(out), { recursive: true });
await writeFile(out, Buffer.from(url.split(',')[1], 'base64'));
console.log(`contact · ${plates.length} plate(s)${wantDiff ? ' + difference' : ''}${zoom ? ' + inset' : ''}`);
console.log('  wrote ' + out);
