// Resonances.
//
// Every world answers to something — a film, a painting, a game, a page
// somebody read at the right age. This table is AEON's homage shelf:
// each mood is a full art direction (grade, haze, bloom, sun, weather,
// vegetation, lamplight) keyed to the kinds of world that earn it, and
// every planet draws one deterministically from its seed. The HUD wears
// the epigraph; the README names the debts. None of it adds a single
// draw call — a resonance only leans on dials the engine already owns.
//
// grade: lift/gain/sat feed the linear-light grade pass (post.js), plus
// vignette and grain. hazeX/hazeTint bend the air; bloomX the glow;
// sunX the disc; cloudBias/rainX the weather's temperament; vegX the
// biosphere's appetite; lamp the color of a city's streetlight.

import { hash, RNG } from './rng.js';

const MOODS = [
  {
    id: 'counsel',                       // the monumental desert
    line: 'the desert keeps its own counsel',
    when: (p) => (p.type === 'barren' || p.type === 'terrestrial') && p.Teq > 300 && p.clouds < 0.7,
    grade: { lift: [0.010, 0.004, -0.006], gain: [1.10, 1.02, 0.88], sat: 0.92, vign: 0.30, grain: 0.045 },
    hazeX: 1.7, hazeTint: [1.0, 0.78, 0.52], bloomX: 0.85, sunX: 1.35,
    cloudBias: -0.10, rainX: 0.5, lamp: [1.5, 0.9, 0.4],
  },
  {
    id: 'wanderers',                     // the bright pastoral
    line: 'a sky for wanderers',
    when: (p) => (p.type === 'terrestrial' || p.type === 'ocean') && p.Teq > 255 && p.Teq < 315,
    grade: { lift: [0, 0.002, 0.004], gain: [1.02, 1.05, 1.06], sat: 1.16, vign: 0.14, grain: 0.02 },
    hazeX: 0.9, bloomX: 1.05, cloudBias: 0.12, rainX: 0.85, vegX: 1.35,
  },
  {
    id: 'chrome',                        // the neon nocturne
    line: 'chrome and rain',
    when: (p) => p.inhabited && p.clouds > 0.55,
    grade: { lift: [-0.004, 0.000, 0.010], gain: [0.94, 1.00, 1.10], sat: 1.04, vign: 0.38, grain: 0.05 },
    hazeX: 1.25, hazeTint: [0.5, 0.7, 1.0], bloomX: 1.25, rainX: 1.7,
    lamp: [0.55, 1.15, 1.5],
  },
  {
    id: 'afternoon',                     // the sepia hush
    line: 'the long afternoon',
    when: (p) => p.type === 'terrestrial' && p.Teq >= 240 && p.Teq <= 280,
    grade: { lift: [0.012, 0.010, 0.006], gain: [1.04, 1.00, 0.88], sat: 0.72, vign: 0.26, grain: 0.09 },
    hazeX: 1.5, hazeTint: [0.9, 0.8, 0.6], bloomX: 0.8, sunX: 0.85,
    rainX: 1.2, vegX: 0.85,
  },
  {
    id: 'pale',                          // the chalk pastel
    line: 'the pale dance',
    when: (p) => p.type === 'barren' && p.Teq <= 340,
    grade: { lift: [0.030, 0.028, 0.030], gain: [1.00, 0.99, 1.02], sat: 1.10, vign: 0.10, grain: 0.02 },
    hazeX: 0.6, bloomX: 0.9, sunX: 0.9,
    palette: { l: 0.06, s: -0.05 },
  },
  {
    id: 'gold',                          // the singing dunes
    line: 'gold has a sound',
    when: (p) => (p.type === 'barren' || p.type === 'terrestrial') && p.Teq > 280 && p.oceanLevel < 0,
    grade: { lift: [0.006, 0, -0.004], gain: [1.12, 1.05, 0.85], sat: 1.08, vign: 0.22, grain: 0.05 },
    hazeX: 1.2, hazeTint: [1.0, 0.85, 0.55], bloomX: 1.35, sunX: 1.25,
  },
  {
    id: 'vault',                         // the stark geometry
    line: 'the quiet vault',
    when: (p) => p.type === 'barren' && p.Teq < 240,
    grade: { lift: [-0.006, -0.006, -0.006], gain: [1.06, 1.06, 1.06], sat: 0.85, vign: 0.06, grain: 0.015 },
    hazeX: 0.5, bloomX: 1.0,
  },
  {
    id: 'winterlight',                   // the near-mono north
    line: 'winter light',
    when: (p) => p.type === 'ice' || (p.type === 'terrestrial' && p.Teq < 240),
    grade: { lift: [0.008, 0.010, 0.016], gain: [0.98, 1.00, 1.06], sat: 0.62, vign: 0.20, grain: 0.06 },
    hazeX: 0.9, hazeTint: [0.7, 0.8, 1.0], bloomX: 0.9, sunX: 0.8,
    aurora: true,                        // winter light earns the polar sky
  },
  {
    id: 'greenshade',                    // the overgrown thought
    line: 'a green thought in a green shade',
    when: (p) => p.type === 'terrestrial' && p.Teq > 275 && p.Teq < 300 && p.clouds < 0.6,
    grade: { lift: [0, 0.004, 0], gain: [0.98, 1.06, 0.98], sat: 1.12, vign: 0.18, grain: 0.03 },
    hazeX: 1.1, hazeTint: [0.7, 1.0, 0.7], rainX: 1.1, vegX: 1.8,
    palette: { cSat: 0.15 },
  },
  {
    id: 'searemembers',                  // the great wave's patience
    line: 'the sea remembers',
    when: (p) => p.type === 'ocean',
    grade: { lift: [0, 0.004, 0.012], gain: [0.94, 1.00, 1.12], sat: 1.08, vign: 0.20, grain: 0.035 },
    hazeX: 1.05, bloomX: 1.1, cloudBias: 0.05,
  },
  {
    id: 'forge',                         // the fire's ledger
    line: 'what the fire owes',
    when: (p) => p.type === 'lava',
    grade: { lift: [0, -0.004, -0.006], gain: [1.15, 0.95, 0.85], sat: 1.10, vign: 0.34, grain: 0.06 },
    hazeX: 1.3, hazeTint: [1.0, 0.5, 0.25], bloomX: 1.4,
  },
  {
    id: 'procession',                    // the slow giants
    line: 'the slow procession',
    when: (p) => p.type.includes('giant'),
    grade: { lift: [0.002, 0.002, 0.004], gain: [1.02, 1.01, 1.03], sat: 1.06, vign: 0.20, grain: 0.03 },
    bloomX: 1.1,
  },
];

const PLAIN = {
  id: 'plain', line: 'the plain light',
  grade: { lift: [0, 0, 0], gain: [1, 1, 1], sat: 1, vign: 0.12, grain: 0.02 },
};

/**
 * Choose and attach a world's resonance — called once at planet birth so
 * the orbit shader, the tiles, the weather and the HUD all agree. Small
 * palette shifts are applied here (idempotent: once, at creation).
 */
export function applyResonance(pp) {
  const eligible = MOODS.filter(m => m.when(pp));
  const r = new RNG(hash(pp.seed, 0x5e50));
  const mood = eligible.length ? eligible[r.int(0, eligible.length - 1)] : PLAIN;
  pp.res = {
    id: mood.id, line: mood.line, grade: mood.grade,
    hazeX: mood.hazeX ?? 1,
    hazeTint: mood.hazeTint ?? null,
    bloomX: mood.bloomX ?? 1,
    sunX: mood.sunX ?? 1,
    cloudBias: mood.cloudBias ?? 0,
    rainX: mood.rainX ?? 1,
    vegX: mood.vegX ?? 1,
    lamp: mood.lamp ?? null,
    aurora: mood.aurora ?? false,
  };
  // the palette leans with the mood — gently, the world is still itself
  const pal = mood.palette;
  if (pal) {
    for (const c of [pp.colA, pp.colB, pp.colC]) {
      if (c?.offsetHSL) c.offsetHSL(0, pal.s ?? 0, pal.l ?? 0);
    }
    if (pal.cSat && pp.colC?.offsetHSL) pp.colC.offsetHSL(0, pal.cSat, 0);
  }
  if (pp.clouds !== undefined && pp.res.cloudBias) {
    pp.clouds = Math.min(Math.max(pp.clouds + pp.res.cloudBias, 0), 0.92);
  }
  return pp;
}

/** giants and moons pass through too — cheap to call anywhere a world is born */
export const NEUTRAL_RES = { ...PLAIN, hazeX: 1, hazeTint: null, bloomX: 1, sunX: 1, cloudBias: 0, rainX: 1, vegX: 1, lamp: null };
