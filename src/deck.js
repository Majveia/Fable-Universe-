// The deck plan — CLAUDE.md §2.1, §2.6, and the discipline `liminal.js` keeps.
//
// `cabin.js` draws a ship's interior. This decides what that interior *is*, and
// it is a separate file for the reason `liminal.js` is separate from `rooms.js`:
// if a dimension in the drawing were chosen rather than read, the argument that
// the cabin follows the vehicle would quietly become decoration.
//
// It also has to be reachable from node. `pilot.js` walks against the volumes
// and blockers below and `cabin.js` builds geometry from the same object, so
// the two cannot drift apart — but only if `tools/verify.js` can load the
// object, and it cannot load anything that imports three.
//
// So: arithmetic here, geometry there, one shared spec, and the collision and
// the bulkhead it collides with are read from one array.

import { hash, RNG } from './rng.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

export const CABIN = {
  /** deck-to-ceiling, m. Enough to stand under, not enough to feel like a hall. */
  ceiling: 2.30,
  /* Section half-widths, as *ratios* to each other — the absolute size comes
     from the vehicle. The habitat is the widest because it is the part you
     live in; the cockpit is one seat and a windscreen; the corridor between
     them is the narrowest thing a person can walk down without turning. */
  cockpitHalf: 1.05,
  corridorHalf: 0.72,
  habitatHalf: 1.30,
  /** seated eye height above the deck, m */
  seatEye: 1.16,
  /** the console reaches this far back from the nose bulkhead */
  consoleDepth: 0.52,
  /** corner radius on the hull section, m — a pressure vessel has no sharp inside */
  fillet: 0.34,
  /**
   * The clear width a person needs to get past a piece of furniture, m —
   * shoulders plus somewhere to put an elbow.
   *
   * This exists because the nav table sealed the ship, twice, and the second
   * time is the more interesting one.
   *
   * First it was 0.46 m of half-width on a 1.04 m hull: a 0.58 m gap for a
   * crew member 0.60 m across, so the habitat was cut off from the cockpit and
   * the ship could not be flown from inside itself — with every offline suite
   * green, because blockers were checked for sticking out *through* the hull
   * and never for the space they left *behind*.
   *
   * Sizing it from the hull fixed the arithmetic and not the problem. A table
   * centred in a 2.08 m hull with a 0.62 m gap each side leaves a walkable
   * window two centimetres wide — passable on paper, and nobody would ever
   * find it. The geometry was wrong, not the constant: **a table in the middle
   * of a corridor is bad ship design.** It stands against a bulkhead now, the
   * way it would on anything anybody had to live in, and the walkway is the
   * whole rest of the beam.
   */
  passage: 0.62,
};

/**
 * The cabin a given vehicle can hold.
 *
 * Derived from `craftFor()` rather than seeded, for the reason `craft.js` gives
 * about the craft itself: a cabin rolled from a hash would be a different room
 * on every world for no reason anybody could name. This one follows the
 * vehicle. A wider stack has a wider hull; a taller one has more length to
 * spend, and spends it on the habitat, because the cockpit only ever needs to
 * be one seat and a windscreen deep.
 *
 * `seed` moves the dressing — locker placement, which panels carry a decal —
 * and never the dimensions, so a shared URL is the same room and two worlds
 * that happen to demand the same Δv are not the same ship inside.
 */
export function cabinFor(craft = {}, seed = 0) {
  const dia = clamp(num(craft.diameter, 11), 3.2, 26);
  const tall = clamp(num(craft.height, 110), 12, 400);

  // The habitable section is a fraction of the stack, not all of it: most of a
  // launch vehicle is tank. The cube root keeps a 400 m monster from getting a
  // corridor you could lose someone in.
  const len = clamp(6.4 * Math.cbrt(tall / 110), 4.2, 17);
  /* The floor goes on the *base* width, not on the sections derived from it.
     Flooring each section separately let a small vehicle's cockpit minimum
     (0.70) exceed its habitat (0.67), which inverts the layout the diagram
     above draws and tapers the shell the wrong way. Flooring the base keeps
     habitat > cockpit > corridor true by construction on every world.

     1.0 m is where it sits because that is what makes the *corridor* walkable:
     0.72/1.30 of it is 0.55 m of half-width against a 0.30 m shoulder radius,
     which is a gap a person fits through and 0.62 was not. */
  const half = clamp(dia * 0.095, 1.0, 1.55);

  const cockpit = clamp(len * 0.30, 1.6, 4.6);
  const corridor = clamp(len * 0.26, 1.2, 4.2);
  const habitat = len - cockpit - corridor;

  // z runs from the nose, negative, to the tail
  const zNose = -(cockpit + corridor + habitat) * 0.62;
  const zCockpit = zNose + cockpit;
  const zCorridor = zCockpit + corridor;
  const zTail = zCorridor + habitat;

  const wCockpit = half * (CABIN.cockpitHalf / CABIN.habitatHalf);
  const wCorridor = half * (CABIN.corridorHalf / CABIN.habitatHalf);
  const wHabitat = half;

  const rng = new RNG(hash(seed >>> 0, 0xcab1) >>> 0);

  const seatZ = zNose + CABIN.consoleDepth + 0.62;

  /* The nav table's *depth* and where it sits, which is the other half of the
     same lesson and cost a second bug.

     Sizing its width from the hull fixed getting past it sideways. On a short
     cabin it then failed the other way: Luna's habitat is 1.99 m long, the
     table was a fixed 0.72 m placed 42% along it, and what was left aft was
     0.43 m — less than a person is wide. The crew spawned *inside* the
     blocked box and every direction was refused, so the ship could not be
     walked out of, let alone flown.

     So the deck reserves the standing room first and gives the table what is
     left, rather than placing the table and hoping. A habitat with no room for
     one simply does not get one — an empty corner is a better answer than a
     sealed room, and small ships are cramped anyway. */
  const AFT = 0.95;                     // clear deck behind the table, m
  const FORE = 0.70;                    // and in front of it, toward the corridor
  const tableDepth = Math.min(0.72, Math.max(habitat - AFT - FORE, 0));
  const tableZ0 = zCorridor + FORE;
  // against a bulkhead, not amidships — see CABIN.passage. The walkway is then
  // everything the table does not take, which is most of the beam.
  const tableW = Math.min(Math.max(wHabitat * 0.80, 0.30), 0.95);
  const tableSide = rng.next() < 0.5 ? -1 : 1;
  const hasTable = tableDepth > 0.15
    && (wHabitat * 2 - tableW) > CABIN.passage + 0.2;

  /* Where the crew stands when they come aboard. It belongs in the spec rather
     than in `cabin.js` for exactly the reason the volumes do: a spawn point the
     geometry does not know about is a spawn point that can end up inside the
     furniture. */
  const spawnZ = zTail - CABIN.passage * 0.7;

  return {
    length: len,
    ceiling: CABIN.ceiling,
    zNose,
    zTail,
    sections: [
      { name: 'cockpit', half: wCockpit, z0: zNose, z1: zCockpit },
      { name: 'corridor', half: wCorridor, z0: zCockpit, z1: zCorridor },
      { name: 'habitat', half: wHabitat, z0: zCorridor, z1: zTail },
    ],
    /* The contract `pilot.js` walks against: `[halfWidth, z0, z1]`, in order.
       One array, read by both the collision and the geometry, so a bulkhead
       cannot end up drawn somewhere the crew can walk through. */
    volumes: [
      [wCockpit, zNose, zCockpit],
      [wCorridor, zCockpit, zCorridor],
      [wHabitat, zCorridor, zTail],
    ],
    /* `[x0, x1, z0, z1]` boxes you cannot stand in. The console across the
       nose, and the nav table amidships in the habitat. */
    /* `[x0, x1, z0, z1]` boxes you cannot stand in.

       The console spans the nose outright — it is a dead end and nobody needs
       to get past it. The nav table stands in the middle of the habitat and
       everybody does, so its width is whatever the hull can spare. */
    blockers: [
      [-wCockpit, wCockpit, zNose, zNose + CABIN.consoleDepth],
      ...(hasTable
        ? [tableSide < 0
          ? [-wHabitat, -wHabitat + tableW, tableZ0, tableZ0 + tableDepth]
          : [wHabitat - tableW, wHabitat, tableZ0, tableZ0 + tableDepth]]
        : []),
    ],
    /** which side the table stands against, for the geometry */
    tableSide,
    /** where you are standing when you come aboard — clear deck, by construction */
    spawn: [0, 0, spawnZ],
    stations: [
      {
        id: 'helm',
        pos: [0, 0, seatZ + 0.66],
        radius: 0.62,
        seatEye: [0, CABIN.seatEye, seatZ],
        seatYaw: 0,
        label: 'HELM',
      },
      ...(hasTable ? [{
        id: 'nav',
        // on the walkway side of the table, facing it
        pos: [-tableSide * (wHabitat - tableW * 0.5 - 0.1), 0,
          tableZ0 + tableDepth * 0.5],
        radius: 0.50,
        seatEye: [-tableSide * (wHabitat - tableW - 0.24), CABIN.seatEye,
          tableZ0 + tableDepth * 0.5],
        seatYaw: tableSide < 0 ? -Math.PI / 2 : Math.PI / 2,
        label: 'NAV',
      }] : []),
    ],
    seat: {
      z: seatZ,
      /* The backrest, as a box — the thing `pilot.js`'s bowed path exists to
         miss. It is *here* rather than there because the geometry owns where
         the furniture is; the controller only needs to be told. */
      backrest: [-0.28, 0.28, 0.55, CABIN.seatEye + 0.16, seatZ + 0.08, seatZ + 0.22],
    },
    /** where the canopy starts and stops, for the grade and the sky */
    canopy: { z0: zNose - 0.02, z1: zNose + cockpit * 0.72 },
    dressing: {
      lockers: Math.round(2 + rng.next() * 3),
      decalSide: rng.next() < 0.5 ? -1 : 1,
    },
  };
}
