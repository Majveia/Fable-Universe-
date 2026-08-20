// The light of a luminous ceiling — CLAUDE.md §9.2, §8 axis 2 and 3.
//
// The Backrooms room was lit by a `HemisphereLight` at 0.55 plus one point
// light, and the critic measured the result: **the wall falls off 5% over
// eleven metres.** That is not dim, it is not flat-looking, it is *flat* — a
// constant, with no information in it about where anything is. §8 axis 3 asks
// for three separable depth planes and a constant delivers one.
//
// The reflex fix is a distance falloff, and it would be wrong. A ceiling grid
// of troffers genuinely does not fall off as 1/r²: an **infinite** luminous
// plane delivers constant illuminance at every distance, because the inverse
// square and the growing solid angle cancel exactly. Office corridors really
// are flat in the middle. The hemisphere light was accidentally right about the
// centre of the room and wrong about everywhere else.
//
// What a *finite* ceiling does is the whole picture:
//
//   · under the middle, near-constant — the cancellation above
//   · near a wall, about half — half the ceiling has gone
//   · in a corner, about a quarter
//   · **down a wall, falling continuously** as the ceiling recedes toward
//     grazing. This is the big one, and it is the gradient the place is made of
//   · on the floor at the edges, falling for the same reason
//
// Every one of those is the same quantity: how much of your sky the ceiling
// takes up, cosine-weighted. There is a closed form for it.
//
// ---------------------------------------------------------------------------
// Lambert's formula
//
// The irradiance at a point from a uniform Lambertian polygon is exactly
//
//     E = (L/2π) · Σ_edges  θ_i · (γ_i · N)
//
// where the polygon's vertices are seen from the point as unit vectors `v_i`,
// `θ_i = acos(v_i · v_{i+1})` is the angle each edge subtends, and
// `γ_i = normalise(v_i × v_{i+1})` is the normal of the plane through that edge
// and the eye. It is exact for any polygon at any orientation — no clipping
// cases, no separate formula for walls and floor — and for a rectangle it is
// four iterations of about six instructions.
//
// It is also, unusually, *cheaper* than being wrong: it replaces a hemisphere
// light and a point light with one loop and no shadow map.
//
// ---------------------------------------------------------------------------
// And the bounce, which is not a fudge
//
// Direct light alone would make the room far too contrasty, because a beige
// room is a very good integrating sphere. Lighting engineers have handled this
// since the 1920s with the interflection term: for a cavity of average
// reflectance ρ, the light bounces indefinitely and sums to a geometric series,
//
//     E_total = E_direct · 1/(1 − ρ)     of which  ρ/(1 − ρ)  is bounce
//
// At ρ = 0.55 — which is what wallpaper this colour measures — that is 1.22×
// the direct light arriving as an almost perfectly uniform wash, because light
// that has bounced three times has forgotten where it came from. So the flat
// term the old code had *does* exist. It was simply the whole lighting model
// instead of 55% of it.
//
// Nothing here imports three or reads a clock, and the GLSL and the JS are one
// definition (§2.7's discipline, applied to light instead of terrain).

/**
 * The ceiling rectangle, wound for `polygonIrradiance` — one place, so the
 * winding cannot be got wrong twice.
 */
export const ceilingQuad = (halfW, y, halfD) => [
  [-halfW, y, -halfD], [-halfW, y, halfD], [halfW, y, halfD], [halfW, y, -halfD],
];

/** the wallpaper's reflectance, measured off its own sRGB value */
export const RHO = 0.55;

/** the geometric series of an infinitely-bouncing cavity, ρ/(1 − ρ) */
export const bounceGain = (rho = RHO) => rho / (1 - Math.min(Math.max(rho, 0), 0.95));

/**
 * The interflection wash for a box room — one number, applied **uniformly**.
 *
 * The first version multiplied the direct term by `1 + ρ/(1−ρ)`, which is the
 * right total for a surface but the wrong distribution, and the render said so
 * immediately: the ceiling, which by construction receives no direct light at
 * all — it is coplanar with the emitter and faces the same way — came out at
 * zero times anything, so it rendered black. §8 axis 2 asks whether any surface
 * is receiving no light information, and that one was.
 *
 * Bounced light does not remember where it started. Light that has scattered
 * three times off a beige wall is isotropic to within the accuracy of anything
 * this file is doing, which is exactly the assumption the room-cavity method
 * has always made: take the **area-weighted mean** direct irradiance over the
 * cavity, multiply by ρ/(1−ρ), and add it everywhere.
 *
 * Sampled rather than integrated because the mean of a smooth function over six
 * rectangles converges in a few hundred points, it runs once per room, and a
 * closed form for the average of Lambert's formula over a box is a page of
 * algebra to save a millisecond at construction.
 */
export function cavityBounce(width, ceiling, depth, rho = RHO, n = 9) {
  const q = ceilingQuad(width / 2, ceiling - 0.02, depth / 2);
  let sum = 0, area = 0;
  const face = (a, origin, du, dv, normal) => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const u = (i + 0.5) / n, v = (j + 0.5) / n;
        s += polygonIrradiance([
          origin[0] + du[0] * u + dv[0] * v,
          origin[1] + du[1] * u + dv[1] * v,
          origin[2] + du[2] * u + dv[2] * v,
        ], normal, q);
      }
    }
    sum += (s / (n * n)) * a;
    area += a;
  };
  const W = width, D = depth, H = ceiling;
  face(W * D, [-W / 2, 0, -D / 2], [W, 0, 0], [0, 0, D], [0, 1, 0]);            // floor
  face(W * D, [-W / 2, H, -D / 2], [W, 0, 0], [0, 0, D], [0, -1, 0]);           // ceiling
  face(W * H, [-W / 2, 0, -D / 2], [W, 0, 0], [0, H, 0], [0, 0, 1]);            // −z wall
  face(W * H, [-W / 2, 0, D / 2], [W, 0, 0], [0, H, 0], [0, 0, -1]);            // +z wall
  face(D * H, [-W / 2, 0, -D / 2], [0, 0, D], [0, H, 0], [1, 0, 0]);            // −x wall
  face(D * H, [W / 2, 0, -D / 2], [0, 0, D], [0, H, 0], [-1, 0, 0]);            // +x wall
  return (sum / Math.max(area, 1e-9)) * bounceGain(rho);
}

/**
 * Irradiance at `p` with normal `n` from a uniform Lambertian quad, as a
 * fraction of the emitter's radiance.
 *
 * `quad` is four vertices wound so that the polygon's own normal points **at**
 * the receiver — for a ceiling seen from the floor, that is clockwise viewed
 * from below. The formula is signed and the sign is the winding, so getting it
 * backwards returns a negative everywhere and the clamp turns the whole room
 * black. It did, first time.
 *
 * Returns 0 rather than a negative for a surface facing away — a polygon behind
 * you contributes nothing, and the sum genuinely goes negative there rather
 * than to zero, which would light the outside of the room.
 */
export function polygonIrradiance(p, n, quad) {
  let sum = 0;
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i], b = quad[(i + 1) % quad.length];
    const va = norm3(sub3(a, p)), vb = norm3(sub3(b, p));
    const c = cross3(va, vb);
    const len = Math.hypot(c[0], c[1], c[2]);
    if (len < 1e-9) continue;
    const theta = Math.acos(Math.min(Math.max(dot3(va, vb), -1), 1));
    sum += theta * ((c[0] * n[0] + c[1] * n[1] + c[2] * n[2]) / len);
  }
  return Math.max(sum / (2 * Math.PI), 0);
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1e-9;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/**
 * The same function, in GLSL, for injection into the room's materials.
 *
 * `uCeil` is `(halfWidth, y, halfDepth)`. Unrolled to four edges because the
 * emitter is always a rectangle here and a loop over a constant is not worth
 * the branch.
 *
 * `acos` is the one non-trivial instruction and there are four of them, against
 * a shadow map's whole extra pass. This is the cheap option as well as the
 * correct one.
 */
export const TROFFER_GLSL = /* glsl */`
uniform vec3 uCeil;      // half-width, height, half-depth
uniform float uBounce;   // rho / (1 - rho), the interflection term

float troffEdge(vec3 a, vec3 b, vec3 p, vec3 n) {
  vec3 va = normalize(a - p);
  vec3 vb = normalize(b - p);
  vec3 c = cross(va, vb);
  float len = length(c);
  if (len < 1e-6) return 0.0;
  return acos(clamp(dot(va, vb), -1.0, 1.0)) * dot(c / len, n);
}

// Lambert's formula over the ceiling rectangle: exact, orientation-free, and
// the reason a wall darkens toward the floor without anything being told to.
float troffer(vec3 p, vec3 n) {
  // wound so the ceiling's normal points down into the room — see the JS
  vec3 c0 = vec3(-uCeil.x, uCeil.y, -uCeil.z);
  vec3 c1 = vec3(-uCeil.x, uCeil.y,  uCeil.z);
  vec3 c2 = vec3( uCeil.x, uCeil.y,  uCeil.z);
  vec3 c3 = vec3( uCeil.x, uCeil.y, -uCeil.z);
  float s = troffEdge(c0, c1, p, n) + troffEdge(c1, c2, p, n)
          + troffEdge(c2, c3, p, n) + troffEdge(c3, c0, p, n);
  return max(s / 6.2831853, 0.0);
}

// Direct, plus the bounce that a beige box unavoidably adds.
//
// uBounce is *added*, not multiplied. Interflected light has forgotten its
// origin, so it arrives uniformly — and multiplying instead left the ceiling,
// which receives no direct light by construction, at exactly zero.
float trofferLit(vec3 p, vec3 n) {
  return troffer(p, n) + uBounce;
}
`;
