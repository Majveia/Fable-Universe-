// The shape of a world.
//
// Until now every world was the same gentle rolling meadow. A landform gives
// each one its own bones: alpine spines that break the sky, terraced
// canyonlands, high plateaus that end in cliffs, or seas of wind-aligned
// dune. The choice is fixed per world (and leans on its resonance — deserts
// get dunes, the cold gets mountains), so the same country waits every time.
// Each landform returns a height contribution in metres, added on top of the
// macro continents, and only ever on land (the sea keeps its floor).

import { hash, RNG } from './rng.js';

// ridged multifractal: folded noise makes sharp mountain crests, 0..1
function ridged(nz, x, z, freq, oct) {
  let v = 0, a = 0.5, f = freq, norm = 0;
  for (let o = 0; o < oct; o++) {
    let n = 1 - Math.abs(nz(x * f, z * f));
    n *= n;
    v += a * n; norm += a; a *= 0.5; f *= 2.13;
  }
  return v / norm;
}
// plain fractal noise, ~ -1..1
function fbm(nz, x, z, freq, oct) {
  let v = 0, a = 0.5, f = freq, norm = 0;
  for (let o = 0; o < oct; o++) { v += a * nz(x * f, z * f); norm += a; a *= 0.5; f *= 2.07; }
  return v / norm;
}

const MOOD_BIAS = {
  gold: 'dune', counsel: 'dune', vault: 'plateau', winterlight: 'alpine',
  forge: 'canyon', chrome: 'plateau', greenshade: 'rolling', afternoon: 'rolling',
};
const AMP = { rolling: 280, alpine: 1500, canyon: 760, plateau: 700, dune: 300 };

export function pickLandform(pp, wind) {
  const r = new RNG(hash(pp.seed, 0x1a4d10));
  let id;
  const bias = MOOD_BIAS[pp.res?.id];
  if (bias && r.chance(0.62)) id = bias;
  else id = ['rolling', 'rolling', 'alpine', 'canyon', 'plateau', 'dune'][(r.next() * 6) | 0];
  if (pp.typeId === 3 && r.chance(0.5)) id = 'alpine';       // ice worlds skew rugged
  if (pp.typeId === 4) id = r.chance(0.5) ? 'canyon' : 'plateau'; // lava: broken basalt
  const amp = AMP[id];
  // a rare few worlds hang islands in the sky — handled as meshes, not here
  const floatingIsles = r.chance(0.08) && (id === 'rolling' || id === 'plateau');
  const wx = wind?.x ?? 1, wz = wind?.y ?? 0;

  // height contribution in metres. land ∈ [0,1] fades the form out over water.
  const contribute = (x, z, nz, land) => {
    if (land <= 0.001 || id === 'rolling') return 0;
    switch (id) {
      case 'alpine': {
        // grand massifs (low frequency) with sharp ridges riding on top;
        // 0.8 power lifts the mid-slopes so peaks read tall and broad
        const massif = ridged(nz, x, z, 0.0009, 5);
        const crest = ridged(nz, x + 50, z - 30, 0.0038, 3) * 0.28;
        const m = Math.pow(Math.min(massif + crest, 1), 0.8);
        return m * amp * land;
      }
      case 'canyon': {
        // stacked mesas (flat tops, sheer steps) cut by a deep sinuous gorge
        const base = fbm(nz, x + 40, z - 20, 0.0009, 3) * 0.5 + 0.5;
        const steps = 6;
        const terr = Math.floor(base * steps) / steps;
        const chan = ridged(nz, x - 90, z + 60, 0.0018, 4);
        const incise = smoothstep(0.55, 0.72, chan);      // a hard-walled canyon
        return (terr * amp - incise * amp * 0.9) * land;
      }
      case 'plateau': {
        // high tables ending in sheer cliffs, a little relief on top
        const mask = fbm(nz, x, z, 0.0006, 2) * 0.5 + 0.5;
        const top = smoothstep(0.44, 0.54, mask);         // sharp cliff edge
        const relief = fbm(nz, x + 11, z + 7, 0.003, 3) * 26;
        return (top * amp + relief * top) * land;
      }
      case 'dune': {
        // great dunes marching across the wind, softened by drift noise
        const along = (x * wx + z * wz) * 0.004;
        const wob = fbm(nz, x, z, 0.0012, 2) * 2.6;
        const d = Math.sin(along + wob) * 0.5 + 0.5;
        return Math.pow(d, 1.5) * amp * land;
      }
    }
    return 0;
  };

  return { id, amp, floatingIsles, contribute };
}

function smoothstep(a, b, x) { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }
