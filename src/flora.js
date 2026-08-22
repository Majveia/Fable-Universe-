// The wind, made available — CLAUDE.md §6 M3 act 2.
//
// `src/wind.js` is the field: its arithmetic, its CPU mirror, its GLSL. It
// imports no three, which is what lets `tools/verify.js` hold the mirror and
// the shader to the same numbers. This file is where that field meets a GPU —
// the render target it evaluates into, the height texture its terrain coupling
// reads, and the uniform block everything downstream samples.
//
// Grass arrives in act 3 and lives here too, which is why the file is
// `flora.js` rather than `windfield.js`: the render target is not a system of
// its own, it is the field made available to the things that read it, and those
// things are what this file is about.
//
// ---------------------------------------------------------------------------
// The height texture, and why it is not a second evaluation of the ground
//
// §6 M3's third ingredient needs terrain: speed-up over crests, shelter in the
// lee, deflection along contours. All three want `heightAt` inside a fragment
// shader, and AEON has no GLSL height function at surface scale — heights live
// in vertex positions and in `ground.heightAt` on the CPU.
//
// So the ground is baked once into a texture. Two things make that honest
// rather than a shortcut:
//
//   · It is the **same function**, tabulated. `ground.js` owns the one
//     definition of walkable ground (§2.7's discipline, one level up), and this
//     samples that definition rather than re-deriving it. Nothing can disagree,
//     because there is nothing else to disagree with.
//
//   · The resolution is chosen against what the coupling actually varies by,
//     not against what looks generous. The crest filter is a ±58 m stencil and
//     the shelter lookup is 48 m upwind; at 192² over ±1400 m a texel is 14.6 m,
//     which is a quarter of the finest term. The gradient stencil moves from
//     the reference's ±7 m to one texel, because a finer stencil on a 14.6 m
//     table is reading interpolation rather than terrain.
//
// The cost matters and is why the resolution is not higher: `heightAt` runs at
// roughly 4.6 µs in the browser (measured — `src/horizon.js` does 16k samples
// in 74 ms), so 192² is about 170 ms at load. 512² would be 1.2 s against §5's
// 2.5 s to interactive, for detail the coupling cannot use.

import * as THREE from 'three';
import {
  HEIGHT_RES, WIND_MEAN_GLSL, WIND_NOISE_GLSL, WIND_PASS_GLSL, WIND_SAMPLE_GLSL,
  WIND_SPAN, bakeHeight, windUniforms,
} from './wind.js';
import {
  MEADOW_COLOUR_GLSL, MEADOW_GLSL, MEADOW_PART_GLSL, PALETTE_KEYS, PART_RADIUS,
  RINGS, bladeRoots, chunkGrid, chunkInstances, chunkNearDist, grassPalette, ringB,
} from './meadow.js';

/**
 * How often the field is re-evaluated, in frames.
 *
 * The reference's own reasoning, and its own number: *"the wind field and the
 * sun shadow both change slowly compared with the camera, so they run at half
 * rate on alternate frames — invisible, and it takes two whole passes off most
 * frames."* It interleaves three auxiliary passes one per frame so each frame
 * pays for one, and notes that nothing then updates slower than 20 Hz.
 *
 * At 288² with four octaves of curl noise at three taps each, the pass is about
 * a million noise evaluations. That is not free on a phone, and the eye cannot
 * follow a gust front at 60 Hz any better than at 20.
 */
export const WIND_PHASE = 3;

/**
 * `?bladedbg=1` — the instrument for "the meadow submits blades and the frame
 * is empty". See the note in `BLADE_VERT`'s `main()`. Default-off; it costs one
 * `mix()` and one `max()` per vertex when off, and it exists because that
 * question is not answerable from a still.
 */
const BLADE_DBG = (() => {
  try {
    const v = parseInt(new URL(window.location.href).searchParams.get('bladedbg'));
    return Number.isFinite(v) ? v : 0;
  } catch { return 0; }
})();

// A RawShaderMaterial gets no preamble from three — not the attributes, not the
// matrices, not `precision`. Everything it uses it declares. Omitting these two
// is a compile error that only exists once the material is instantiated, which
// is exactly the class of defect §M0's gate is for, and exactly the class the
// bench-route traversal could not see because it never reached this scale.
const FS_QUAD_VERT = /* glsl */`
  in vec3 position;
  in vec2 uv;
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** the height sampler `WIND_FIELD_GLSL` expects to find */
const HEIGHT_GLSL = /* glsl */`
  uniform sampler2D uHeightTex;
  uniform vec2 uHeightOrigin;
  uniform float uHeightSpan;
  float wTerrainH(vec2 p) {
    vec2 uv = (p - uHeightOrigin) / uHeightSpan + 0.5;
    return texture(uHeightTex, clamp(uv, vec2(0.0), vec2(1.0))).r;
  }
`;

const FIELD_FRAG = /* glsl */`
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform vec2 uWindOrigin;
  ${WIND_NOISE_GLSL}
  ${HEIGHT_GLSL}
  ${WIND_MEAN_GLSL}
  ${WIND_PASS_GLSL}
  void main() {
    vec2 p = uWindOrigin + (vUv - 0.5) * ${WIND_SPAN.toFixed(1)};
    outColor = windField(p, uWindTime);
  }
`;

/**
 * The debug view the reference carries and §6 M3's gate needs: `?windview=1`.
 *
 * A gust front is a thing you can only judge by watching one cross the frame,
 * and on a scale where grass does not exist yet there is nothing else to watch.
 * Speed as a cool-to-warm ramp, the excitement channel in red.
 */
const VIEW_FRAG = /* glsl */`
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uWindTex;
  uniform float uMean;
  void main() {
    vec4 w = texture(uWindTex, vUv);
    float s = length(w.rg) / max(uMean, 0.3);
    vec3 c = mix(vec3(0.06, 0.12, 0.22), vec3(0.95, 0.86, 0.55), smoothstep(0.3, 1.9, s));
    c = mix(c, vec3(1.0, 0.42, 0.32), smoothstep(0.4, 1.8, w.a));
    float g = (fract(vUv.x * 24.0) < 0.02 || fract(vUv.y * 24.0) < 0.02) ? 0.25 : 0.0;
    outColor = vec4(c + g, 1.0);
  }
`;

/**
 * The field on the GPU.
 *
 * `origin` follows the camera, **snapped to a texel**. Unsnapped, every texel
 * resamples a slightly different world point each frame, and anything reading
 * the target bilinearly — which is everything — gets a shimmer that looks like
 * turbulence and is not. Snapping costs two `floor`s and removes it entirely.
 */
export class WindField {
  constructor(renderer, wind, { heightAt = null, extent = 1400, size = 256 } = {}) {
    this.renderer = renderer;
    this.wind = wind;
    this.size = size;
    this.frame = 0;
    this.origin = new THREE.Vector2(0, 0);

    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });

    let heightTex = null;
    this.bake = null;
    if (heightAt) {
      this.bake = bakeHeight(heightAt, extent);
      heightTex = new THREE.DataTexture(this.bake.data, this.bake.res, this.bake.res,
        THREE.RedFormat, THREE.FloatType);
      heightTex.minFilter = THREE.LinearFilter;
      heightTex.magFilter = THREE.LinearFilter;
      heightTex.wrapS = THREE.ClampToEdgeWrapping;
      heightTex.wrapT = THREE.ClampToEdgeWrapping;
      heightTex.needsUpdate = true;
    }
    this.heightTex = heightTex;

    this.uniforms = {
      ...windUniforms(wind, 0, !!heightAt),
      uWindOrigin: { value: this.origin },
      uHeightTex: { value: heightTex },
      uHeightOrigin: { value: new THREE.Vector2(0, 0) },
      uHeightSpan: { value: extent * 2 },
    };

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      vertexShader: FS_QUAD_VERT,
      fragmentShader: FIELD_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /**
   * Evaluate the field. Returns true if it actually ran.
   *
   * The phase argument is the reference's interleave: one auxiliary pass per
   * frame rather than all of them every frame. Pass `force` for the first frame,
   * because a target nobody has written to is not slow, it is wrong.
   */
  update(t, camX = 0, camZ = 0, { force = false, phase = WIND_PHASE } = {}) {
    this.frame++;
    if (!force && this.frame % phase !== 0) return false;
    const texel = WIND_SPAN / this.size;
    this.origin.set(Math.round(camX / texel) * texel, Math.round(camZ / texel) * texel);
    this.uniforms.uWindTime.value = t;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
    return true;
  }

  /** what a consumer's material needs to call `windSample()` */
  sampleUniforms() {
    return {
      ...windUniforms(this.wind, this.uniforms.uWindTime.value, !!this.heightTex),
      uWindTex: { value: this.target.texture },
      uWindOrigin: this.uniforms.uWindOrigin,
    };
  }

  /** the GLSL a *consumer* includes — the field's evaluator is not part of it */
  static get GLSL() {
    return WIND_NOISE_GLSL + WIND_MEAN_GLSL + WIND_SAMPLE_GLSL;
  }

  /** a full-screen debug view of the field — `?windview=1` */
  viewMaterial() {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uWindTex: { value: this.target.texture },
        uMean: { value: this.wind.base },
      },
      vertexShader: FS_QUAD_VERT,
      fragmentShader: VIEW_FRAG,
      depthTest: false,
      depthWrite: false,
    });
  }

  dispose() {
    this.target.dispose();
    this.heightTex?.dispose();
    this.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// the blades — §9.5, act 3
//
// One ring's worth, and the law from `meadow.js` wired to real geometry. What
// this act has to demonstrate before act 4 multiplies it by four is the *double
// thinning*, because that is the budget:
//
//   · coarsely on the CPU, by lowering a chunk's instance count against a
//     pre-shuffled buffer. Any prefix is a fair spatial sample, and a thinned
//     blade costs nothing at all — not even a vertex shader invocation.
//   · finely in the vertex shader, per blade, against its own true distance.
//     The CPU deliberately over-draws from the chunk's NEAREST corner, so the
//     shader can only ever remove.
//
// Removed blades collapse to their root rather than branching: every vertex
// lands on the same point, the triangles have zero area, and the rasteriser
// discards them before a fragment exists. A `return` would be a divergent
// branch on twelve million vertices; this is a multiply.

const BLADE_VERT = /* glsl */`
  in vec3 position;
  in float aSide;     // -1 .. +1 across the blade
  in vec2 aRoot;      // xz within the chunk
  in float aRand;     // the blade's own number: thinning, phase, variation
  in float aHeight;

  uniform mat4 projectionMatrix;
  uniform mat4 viewMatrix;
  // The chunk's world origin, carried in the model matrix rather than in a
  // uniform of its own. That is not a style choice — see GrassRing's note on
  // refreshMaterial. three uploads modelMatrix on every draw, outside the
  // guard that decides whether a material's own uniforms are worth re-sending,
  // and it is the only per-object channel that works when four hundred meshes
  // share one material.
  uniform mat4 modelMatrix;
  uniform vec3 uCam;
  uniform float uHeightScale;
  uniform float uDbg;        // bladedbg level 1 — see the note in main()
  uniform float uDbgFat;     // bladedbg level 2: make a blade unmissable
  uniform float uDbgGround;  // the camera's own ground height, in metres
  uniform float uWidth;
  uniform float uForce;      // what the air can actually push with (rho U^2)
  uniform float uCurl;       // 0 for a ribbon, ~0.55 for a rolled leaf

  out float vT;
  out float vSide;
  out float vVar;
  out float vHead;
  out vec3 vTint;
  out float vBend;
  out float vDist;
  out vec3 vN;
  out vec3 vW;

  ${WIND_NOISE_GLSL}
  ${HEIGHT_GLSL}
  ${WIND_MEAN_GLSL}
  ${WIND_SAMPLE_GLSL}
  uniform float uChunkSize;   // this ring's chunk extent, in metres
  uniform float uWpx;         // this ring's angular width floor, in pixels
  uniform float uRingB;       // blades per m² at uRingDn, for the saturation cap
  uniform float uPxPerRadian; // the projection's pixel scale, frame-constant
  ${MEADOW_GLSL}
  ${MEADOW_PART_GLSL}

  void main() {
    vec2 world = modelMatrix[3].xz + aRoot;
    float ground = wTerrainH(world);
    // bladedbg=1 -- seat every blade on a flat plane at the camera's own
    // ground height instead of on the sampled field, and skip the thinning.
    //
    // The instrument, not the fix. A meadow that submits 1,703 instances across
    // 38 draw calls with its nearest chunk at distance 0 and renders a
    // completely featureless frame has exactly two possible causes -- the roots
    // are somewhere you cannot see, or the blades collapse -- and no still can
    // tell them apart. This separates them: with the height lookup bypassed, if
    // blades appear the fault is wTerrainH, and if they do not it is the
    // collapse. Same purpose as shdebug=1 for the shadow term and fogview=1 for
    // the alpha channel, and it costs one mix() when off.
    ground = mix(ground, uDbgGround, uDbg);
    vec3 base = vec3(world.x, ground, world.y);
    float d = length(base - uCam);
    vDist = d;

    // The chunk's nearest corner, derived rather than uploaded.
    //
    // This is the second half of the bug the constructor's note describes, and
    // it went unfixed for four milestones while the first half was being
    // celebrated. Two uniforms rode onBeforeRender; both were silently dropped
    // on 411 of every 412 draws; uChunkOrigin was rescued into the model matrix
    // and uChunkNear was simply deleted, leaving meadowKeep dividing by an
    // unset uniform -- which is 0, which makes its denominator the density at
    // point-blank range, which applies the absolute density law a second time
    // on top of the CPU's. Roughly three blades in four collapsed to zero
    // height beyond every ring's dn. That is the empty meadow.
    //
    // It is derived here rather than sent because a per-chunk value cannot ride
    // a ring-shared material -- that is precisely the condition that broke it --
    // and because it never needed to be sent at all: the model matrix carries
    // the chunk origin, uChunkSize carries the extent, uCam carries the eye,
    // and the nearest corner is the three of them. Nothing can desynchronise
    // from the CPU, because there is no second copy to drift.
    //
    // Same arithmetic as chunkNearDist() in src/meadow.js, which is what sized
    // the instance count this frame.
    vec2 c0 = modelMatrix[3].xz;
    vec2 outside = max(max(c0 - uCam.xz, uCam.xz - (c0 + uChunkSize)), vec2(0.0));
    float chunkNear = length(outside);

    // the fine thinning. Collapsing is a multiply, not a branch — see the note
    // in src/flora.js on why that matters at this vertex count.
    float live = max(meadowKeep(d, aRand, chunkNear) ? 1.0 : 0.0, uDbg);

    vT = position.y;
    vSide = aSide;
    vVar = aRand;
    // a seed head on one blade in ten
    vHead = step(0.90, fract(aRand * 7.13));

    // §9.5's tussock clustering, at a metre AND a decametre. Two scales rather
    // than one because a meadow is lumpy at both, and a single octave reads as
    // a texture rather than as ground that has plants growing in clumps on it.
    float tuss = wNoise3(uWindSeed + 21, vec3(world * 0.62, 0.0)) * 0.5 + 0.5;
    float swale = wNoise3(uWindSeed + 22, vec3(world * 0.043, 0.0)) * 0.5 + 0.5;
    float dryF = wNoise3(uWindSeed + 23, vec3(world * 0.011, 0.0)) * 0.5 + 0.5;
    vTint = vec3(tuss, swale, dryF);

    // one sample, at one point, for every vertex of this blade — which is what
    // makes windSample()'s fallback branch warp-coherent (§6 M3)
    vec4 w = windSample(world, uWindTime);
    vec2 flow = w.rg;

    // tussocks are taller as well as differently coloured
    float h = aHeight * uHeightScale * live * (0.72 + 0.56 * tuss) * (0.86 + 0.28 * swale);
    // bladedbg level 2: eight times tall, sixty times wide. If THAT does not
    // appear, nothing is being drawn at all and the fault is the draw rather
    // than any dimension in it.
    h *= mix(1.0, 8.0, uDbgFat);
    float wMul = mix(1.0, 60.0, uDbgFat);
    // The blade's own width: never thinner than this ring's pixel floor.
    // Below about a pixel a blade stops being a blade and becomes noise that
    // averages to the mean — which is what a "green plane" is.
    //
    // ...and never wider than the gap between blades. §9.5 trades count for
    // width one-for-one, and that trade saturates: once a blade is as wide as
    // the mean spacing, the ground is already covered and further width buys
    // overdraw and nothing else. Without the cap the pixel floor asks for a
    // 3.15 m blade at ring 3's far edge, which is a billboard rather than a
    // trade. Spacing is 1/sqrt(density), and density is this ring's own law.
    float dens = max(uRingB * meadowFalloff(d) * uDensityMul, 1e-6);
    float wBlade = clamp(meadowWidth(d, uWpx, uPxPerRadian),
                         uWidth * 0.22, inversesqrt(dens));

    // the logarithmic boundary layer: roots barely move, tips whip
    float lean = windProfile(vT * max(h, 0.05)) * uForce;
    float bend = lean * vT * vT * 0.16;
    vBend = clamp(bend * 2.2, 0.0, 1.5);

    vec2 fdir = normalize(flow + vec2(1e-6));
    vec2 across = vec2(-fdir.y, fdir.x);

    vec3 p = base;
    p.xz += across * position.x * wBlade * wMul * live;
    p.y += vT * h;
    p.xz += fdir * bend * h;
    // §6 M3 · the walker parts the grass. Applied after the wind rather than
    // blended with it: a person walking through a meadow does not change which
    // way the wind is blowing, they push blades aside on top of it.
    p.xz += meadowPart(world, vT) * h * live;
    // the curve out of the blade's own plane, and the bow that shortens it —
    // a bending blade does not stretch
    p.xz += fdir * position.z * wBlade * wMul * live;
    p.y -= bend * bend * h * 0.35;
    vW = p;

    // The fanned normal. A flat blade takes the face normal; a curved one
    // rotates it across the width, which is the whole reason for the middle
    // vertex — a rolled leaf catches the light differently on each side of its
    // midrib and that is what stops a meadow reading as a field of ribbons.
    vec3 along = normalize(vec3(fdir * bend * 1.4, 1.0));
    vec3 face = normalize(cross(vec3(across.x, 0.0, across.y), along));
    vN = normalize(face + vec3(across.x, 0.0, across.y) * aSide * uCurl);

    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const BLADE_FRAG = /* glsl */`
  precision highp float;
  in float vT;
  in float vSide;
  in float vVar;
  in float vHead;
  in vec3 vTint;
  in float vBend;
  in float vDist;
  in vec3 vN;
  in vec3 vW;
  out vec4 outColor;

  uniform vec3 uCam;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uSkyColor;
  uniform vec3 uSward;      // the mean the far field settles toward
  uniform float uDusk;
  ${MEADOW_COLOUR_GLSL}

  void main() {
    vec3 N = normalize(vN);
    vec3 toEye = uCam - vW;
    float dist = length(toEye);
    vec3 V = toEye / max(dist, 1e-4);
    if (!gl_FrontFacing) N = -N;

    Blade b = bladeColour(vT, vTint, vVar);
    float nearK = meadowNearK(vDist);

    // Across-blade detail retires first, and the normal is the largest of it.
    // Flattening toward vertical with distance is not a cheat — it is the same
    // statement as "this is now one pixel wide", made to the lighting.
    N = normalize(mix(vec3(0.0, 1.0, 0.0), N, 0.34 + 0.66 * nearK));

    // §9.2's wrapped diffuse, in the shape the terrain uses when ?paint=1 is
    // held back. The blade's three stops go through it as a ramp rather than a
    // lerp, so the band edges §9.2 asks for survive.
    float ndl = dot(N, uSunDir);
    float wrap = clamp(ndl * 0.62 + 0.46, 0.0, 1.0);
    // a blade is shadowed by the sward it stands in, and most at its base
    float selfShadow = mix(0.62, 1.0, pow(vT, 0.75));
    float ao = mix(0.34, 1.0, pow(vT, 0.55));

    vec3 col = mix(b.shade, b.mid, smoothstep(0.10, 0.44, wrap));
    col = mix(col, b.lit, smoothstep(0.52, 0.86, wrap));
    col *= selfShadow * mix(0.55, 1.0, ao);
    col *= uSunColor * mix(0.35, 1.0, uDusk);
    // skylight, which is what actually lights the bottom of a sward
    col += uSkyColor * (0.10 + 0.14 * ao) * b.mid;

    // §9.2's subsurface transmission: only a blade nearly edge-on to the sun
    // transmits, because that is light coming *through* rather than off
    float trans = pow(max(dot(V, -uSunDir), 0.0), 3.2)
                * pow(1.0 - abs(dot(N, uSunDir)), 2.2)
                * smoothstep(0.12, 0.68, vT);
    col += b.trans * trans * 0.55 * uDusk;

    // §9.5's wind flash. A blade laid over by a gust turns its broad face up
    // and catches the light — this is what makes a gust *visible* as a pale
    // band racing across the field rather than merely present in the geometry.
    float geom = pow(clamp(1.0 - abs(dot(N, V)), 0.0, 1.0), 1.9) * 0.45
               + pow(clamp(dot(N, normalize(uSunDir + V)), 0.0, 1.0), 3.2) * 0.55;
    float flash = smoothstep(0.34, 0.86, vBend) * smoothstep(0.14, 0.78, vT);
    col = mix(col, P_SHEEN, geom * flash * 0.55 * (0.32 + 0.68 * nearK) * uDusk);

    // a seed head on one blade in ten: a warm bronze plume at the very top
    if (vHead > 0.5) {
      col = mix(col, mix(P_DRY, vec3(0.32, 0.22, 0.14), 0.42) * 1.25,
                smoothstep(0.78, 0.94, vT) * 0.82);
    }

    // the midrib, and the deep interior of the sward
    col *= 1.0 - abs(vSide) * 0.13 * nearK;
    col = meadowSettle(col, uSward, vDist);

    outColor = vec4(col, 1.0);
  }
`;

/**
 * One blade: a tapered strip of `seg` segments, two vertices wide.
 *
 * `seg` is the *only* thing a ring boundary changes (§9.5), which is why it is
 * a parameter here and a column in `quality.js` rather than a constant.
 */
export function bladeGeometry(seg, curved = false) {
  const pos = [];
  const side = [];
  const idx = [];
  // Two triangles wide when curved (§9.5's "curved cross-section two triangles
  // wide that shades like a rolled leaf") and one when not. The middle vertex
  // is what lets the normal fan across the blade, and the fan is what makes a
  // blade read as a rolled leaf instead of a ribbon.
  //
  // It is not free — three vertices a row rather than two, and four triangles a
  // segment rather than two — so it is spent only where it resolves. §9.5 is
  // explicit that across-blade detail is sub-pixel once a blade is two or three
  // pixels wide, and the far rings are entirely inside that regime. They get
  // the ribbon.
  const cols = curved ? [-1, 0, 1] : [-1, 1];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = (1 - t) * (1 - t * 0.35) * 0.5;   // tapers, faster near the tip
    for (const c of cols) {
      pos.push(c * w, t, curved && c === 0 ? w * 0.35 : 0);
      side.push(c);
    }
  }
  const n = cols.length;
  for (let i = 0; i < seg; i++) {
    for (let c = 0; c < n - 1; c++) {
      const a = i * n + c, b = a + 1, d = a + n, e = d + 1;
      idx.push(a, b, d, d, b, e);
    }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setIndex(idx);
  return g;
}

/**
 * Is a chunk's column inside the view frustum?
 *
 * A chunk is a square of ground carrying blades up to about `2·hs` metres
 * tall, so the test is a box against the six planes — and the bounding sphere
 * of that box is enough, because a false positive costs one draw call and a
 * false negative costs a hole in the meadow. Erring outward is the only safe
 * direction.
 */
export function chunkInFrustum(frustum, cx, cz, chunk, hs) {
  const x = (cx + 0.5) * chunk, z = (cz + 0.5) * chunk;
  const r = chunk * Math.SQRT1_2 + 2 * hs + 1;
  _sphere.center.set(x, 0, z);
  _sphere.radius = r;
  // a chunk's ground height is unknown here; widening the sphere by the
  // terrain's own local relief would need a height query per chunk per frame,
  // so the sphere is centred on the datum and grown to cover it
  _sphere.radius = r + 260;
  return frustum.intersectsSphere(_sphere);
}

const _sphere = new THREE.Sphere();

/**
 * A ring of chunks, thinned twice.
 *
 * ---------------------------------------------------------------------------
 * Why the blades are stratified *and* shuffled
 *
 * The reference shuffles its instance buffer so that any prefix is a fair
 * spatial sample, which is what makes coarse thinning free. Generating the
 * roots from `hash(seed, i)` would make the shuffle a no-op — a hash already
 * decorrelates index from position, so every prefix is fair and the shuffle
 * buys nothing. That would be shipping a line that looks load-bearing and is
 * not.
 *
 * So the roots are **stratified**: one blade jittered inside each cell of a
 * `g × g` grid, which covers the chunk far more evenly than uniform random —
 * no clumps, no bald patches, which at 1100 blades/m² is the difference
 * between ground and mange. Stratification makes index and position correlated
 * by construction, so the shuffle is then doing exactly the job the reference
 * describes: without it, a thinned chunk would lose whole rows.
 */
export class GrassRing {
  constructor(ring, windField, opts = {}) {
    const { seed = 1, seg = 4, density = 1, palette = null } = opts;
    this.ring = ring;
    this.spec = RINGS[ring];
    this.wf = windField;
    this.densityMul = density;
    this.grid = chunkGrid(ring);
    this.group = new THREE.Group();
    this.chunks = [];

    const n = this.spec.blades;
    const chunk = this.spec.chunk;

    const { root, rand, height } = bladeRoots(seed, n, chunk);
    for (let i = 0; i < n; i++) height[i] *= this.spec.hs;

    // One set of attribute buffers, shared by every chunk. Each chunk needs its
    // own geometry object because `instanceCount` lives on the geometry rather
    // than the mesh — but the buffers are shared, so the cost is a few objects
    // and not a few hundred megabytes.
    // §9.5's tier rule applied to geometry, not just to shading: a curved
    // cross-section costs half again as many vertices and twice the triangles,
    // and it only resolves where a blade is more than two or three pixels wide.
    // The quality row's segment count is already that judgement — a ring drawn
    // at one segment is a ring whose blades are marks, not leaves.
    const curved = seg >= 3;
    const shared = {
      position: null,
      side: null,
      index: null,
      aRoot: new THREE.InstancedBufferAttribute(root, 2),
      aRand: new THREE.InstancedBufferAttribute(rand, 1),
      aHeight: new THREE.InstancedBufferAttribute(height, 1),
    };
    const proto = bladeGeometry(seg, curved);
    shared.position = proto.getAttribute('position');
    shared.side = proto.getAttribute('aSide');
    shared.index = proto.getIndex();
    this.curved = curved;

    // §9.1 · the palette is the world's, derived from its vegetation colour
    const pal = grassPalette(palette?.base ?? [0.24, 0.36, 0.20]);
    const packed = PALETTE_KEYS.map((k) => new THREE.Vector3(...pal[k]));
    // what the far field settles toward — the sward's own mean, so the
    // convergence keeps the meadow's colour instead of greying toward nothing
    const swardMean = new THREE.Vector3(
      (pal.mid[0] + pal.low[0]) * 0.5, (pal.mid[1] + pal.low[1]) * 0.5,
      (pal.mid[2] + pal.low[2]) * 0.5);

    // ONE material for the ring, not one per chunk.
    //
    // Act 4 built 412 chunks across four rings, each with its own
    // RawShaderMaterial. three caches programs by source, so that was still one
    // shader compile — but it was 412 uniform sets to allocate, hold and walk
    // on dispose, and the surface scale became slow enough to tear down that
    // the compile gate's *next* navigation timed out. The defect showed up as
    // "the black-hole scale was never reached", which is a symptom three files
    // away from its cause.
    //
    // The two uniforms that genuinely differ per chunk are written in
    // `onBeforeRender`, which three calls immediately before the draw and
    // before `setProgram` uploads anything — the standard way to say "same
    // shader, different transform" without minting a material to hold it.
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...this.wf.sampleUniforms(),
        uCam: { value: new THREE.Vector3() },
        uHeightScale: { value: 1 },
        uDbg: { value: BLADE_DBG >= 1 ? 1 : 0 },
        uDbgFat: { value: BLADE_DBG >= 2 ? 1 : 0 },
        uDbgGround: { value: 0 },
        uWidth: { value: 0.028 },
        // §9.5's angular width floor, finally wired.
        //
        // `uWidth` alone is a flat 2.8 cm at every distance, and a 2.8 cm blade
        // at 40 m subtends less than one pixel — so every blade past the near
        // ring was sub-pixel, hit the sample point or missed it, and averaged
        // into a flat tone. That is §M3's own gate clause failing in the exact
        // words it is written in: "grass reads as *meadow* at the horizon, not
        // as a green plane."
        //
        // `wpx` has been in the RINGS table since the table was written — 1.70,
        // 2.00, 2.75, 4.00 — and `meadowWidth()` has been in MEADOW_GLSL, and
        // `tools/pixeldiff.js` has been checking it. Nothing in src/ ever called
        // it. Same shape as uChunkNear, one function along.
        uWpx: { value: this.spec.wpx },
        // blades per m² at this ring's own quoted distance — the other half of
        // the saturation cap below
        uRingB: { value: ringB(this.ring) },
        // Pixels per radian: frame-constant, not chunk-varying, so it uploads
        // for the same reason uCam does — one write per frame is enough when
        // every mesh sharing the material wants the same value.
        uPxPerRadian: { value: 900 },
        uCurl: { value: curved ? 0.55 : 0.0 },
        uWalker: { value: new THREE.Vector4(0, -1e6, 0, 0) },
        uPartR: { value: PART_RADIUS },
        uForce: { value: this.wf.wind.force },
        uRingDn: { value: this.spec.dn },
        // Ring-constant, and that is the whole reason it is allowed to be a
        // uniform here: every chunk in a ring is the same size, so this never
        // varies across the meshes that share this material. The thing that
        // does vary per chunk -- the distance to its nearest corner -- is
        // derived in the shader from the model matrix instead. See BLADE_VERT.
        uChunkSize: { value: this.spec.chunk },
        uDensityMul: { value: density },
        uHeightTex: this.wf.uniforms.uHeightTex,
        uHeightOrigin: this.wf.uniforms.uHeightOrigin,
        uHeightSpan: this.wf.uniforms.uHeightSpan,
        uPal: { value: packed },
        uSward: { value: swardMean },
        uSunDir: opts.sunDir ?? { value: new THREE.Vector3(0.3, 0.4, 0.86) },
        uSunColor: opts.sunColor ?? { value: new THREE.Vector3(1, 0.92, 0.78) },
        uSkyColor: opts.skyColor ?? { value: new THREE.Vector3(0.36, 0.52, 0.78) },
        uDusk: { value: 1 },
      },
      vertexShader: BLADE_VERT,
      fragmentShader: BLADE_FRAG,
      side: THREE.DoubleSide,
    });
    this.material = mat;

    // ONE geometry for the ring too, for the same reason as the material — and
    // this one was not a nicety.
    //
    // `instanceCount` lives on the geometry, so act 3 minted a geometry per
    // chunk to carry it: 412 of them across four rings, and therefore 412
    // vertex array objects the driver has to hold. Stacked with every other
    // experimental flag the compile gate lost the browser outright at the
    // surface station — a crash, not a timeout — and the control run proved it:
    // the same flags without ?m3=1 complete all six scales.
    //
    // three calls `onBeforeRender` immediately before `renderBufferDirect`
    // reads `instanceCount`, so the count rides there. Four geometries, four
    // materials, 412 draws — which is what it always should have been.
    //
    // -----------------------------------------------------------------------
    // …and the two uniforms that used to ride there with it did not work.
    //
    // This is the empty meadow, and it was never in the grass at all. Sharing
    // one material across 412 meshes is right, but it makes `onBeforeRender`
    // the wrong place to put anything that varies per mesh, because three only
    // uploads a material's uniforms when it thinks the material changed
    // (`WebGLRenderer.setProgram`, r170):
    //
    //     if ( state.useProgram( program.program ) ) refreshMaterial = true;
    //     if ( material.id !== _currentMaterialId )  refreshMaterial = true;
    //     …
    //     if ( refreshMaterial || … ) WebGLUniforms.upload( … );
    //
    // Same program, same material, same camera on every chunk after the first,
    // so `refreshMaterial` is false and `upload()` is never called again.
    // `onBeforeRender` faithfully wrote the new `uChunkOrigin` into the JS
    // uniform object 411 times a frame and three declined to send any of them:
    // **every chunk in a ring rendered at the first chunk's origin.**
    //
    // That is the whole symptom. Three and a half million blades submitted,
    // stacked on one chunk's footprint, and bare ground everywhere else. The
    // counts were always right, which is why the instrumentation kept saying
    // the grass was there — `instanceCount` is read straight off the geometry
    // at draw time and never goes through `upload()` at all. One number
    // travelled and the other did not, from the same callback, four lines apart.
    //
    // The fix is the channel three provides for exactly this: `modelMatrix` is
    // set on **every** draw, outside that guard, because "same material,
    // different transform" is what a model matrix is for. The chunk origin is
    // now `mesh.position`, and the shader reads `modelMatrix[3].xz`.
    //
    // The general rule, which `tools/verify.js` now enforces on this file:
    // **an `onBeforeRender` may not write a material uniform.** If it varies
    // per mesh it belongs in the transform, in an attribute, or on a material
    // of its own.
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', shared.position);
    geo.setAttribute('aSide', shared.side);
    geo.setIndex(shared.index);
    geo.setAttribute('aRoot', shared.aRoot);
    geo.setAttribute('aRand', shared.aRand);
    geo.setAttribute('aHeight', shared.aHeight);
    geo.instanceCount = 0;
    this.geometry = geo;

    for (let cx = -this.grid; cx <= this.grid; cx++) {
      for (let cz = -this.grid; cz <= this.grid; cz++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.near = this.spec.dn;
        mesh.userData.count = 0;
        // `instanceCount` only — see the note above. It is read straight off
        // the geometry by `renderBufferDirect` and never goes through
        // `WebGLUniforms.upload()`, which is precisely why it worked when the
        // uniforms beside it did not.
        mesh.onBeforeRender = () => { geo.instanceCount = mesh.userData.count; };
        // Distance and frustum answer *different* questions — how far, and
        // whether it is behind you — and act 3 dismissed the second on the
        // grounds that it was the first asked twice. That was wrong.
        //
        // Measured rather than guessed, because the first version of this
        // claim was a guess and it was false: of 412 chunks across four rings,
        // the distance cull leaves 208 and the frustum test leaves 112. Call
        // it 73% together. (The suite's frustum model is deliberately
        // conservative — any corner inside the half-angle, plus slack — so a
        // real six-plane test culls somewhat more, and the number quoted is
        // the one that can be defended.)
        //
        // It is still done by hand rather than by three's bounding-sphere
        // test: the chunk's world position moves every frame as the grid
        // follows the camera, so an automatic test would need the sphere
        // updated anyway, and the plane test wants the *chunk*, not the
        // instanced geometry's local bounds.
        mesh.frustumCulled = false;
        mesh.userData.noCast = true;
        this.chunks.push({ cx, cz, mesh });
        this.group.add(mesh);
      }
    }
    this.shared = shared;
    this.blades = 0;
  }

  /**
   * Re-seat the chunks around the camera and thin them.
   *
   * The grid follows the camera in whole chunks, so a chunk is re-homed rather
   * than rebuilt — its blades are chunk-relative and its roots never move. That
   * is the difference between walking through a meadow and rebuilding one every
   * step.
   */
  /**
   * The projection's pixel scale, for §9.5's angular width floor.
   *
   * Frame-constant and viewport-dependent, so it is pushed rather than derived:
   * a vertex shader can read `projectionMatrix` but has no way to know how many
   * pixels tall the target is, and that is the other half of the conversion.
   */
  setPixelScale(pxPerRadian) {
    this.material.uniforms.uPxPerRadian.value = pxPerRadian;
  }

  update(camX, camZ, camY, t, frustum = null, dusk = 1, walker = null) {
    const chunk = this.spec.chunk;
    const ox = Math.floor(camX / chunk), oz = Math.floor(camZ / chunk);
    let live = 0, drawn = 0;
    for (const c of this.chunks) {
      const gx = ox + c.cx, gz = oz + c.cz;
      const dNear = chunkNearDist(gx, gz, chunk, camX, camZ);
      if (dNear > this.spec.far) { c.mesh.visible = false; continue; }
      if (frustum && !chunkInFrustum(frustum, gx, gz, chunk, this.spec.hs)) {
        c.mesh.visible = false; continue;
      }
      const count = chunkInstances(this.ring, dNear, this.densityMul);
      c.mesh.visible = count > 0;
      if (c.mesh.visible) drawn++;
      c.mesh.userData.count = count;
      // The chunk's world origin goes in the transform, because that is the one
      // per-object channel three uploads on every draw when four hundred meshes
      // share a material. It was a uniform, and 411 of every 412 writes were
      // silently dropped — see the note in the constructor.
      c.mesh.position.set(gx * chunk, 0, gz * chunk);
      c.mesh.userData.near = dNear;
      live += count;
    }
    // what the CPU instanced this frame, before the shader's own thinning —
    // the number §5's budget is actually about — and how many draw calls it
    // took, which is the other half of that budget
    // per ring, and therefore written once rather than once per chunk
    this.material.uniforms.uCam.value.set(camX, camY, camZ);
    // the flat plane `?bladedbg=1` seats blades on: the camera's own ground,
    // which is the one height in the scene we know is right because the body
    // is standing on it
    if (BLADE_DBG >= 1) this.material.uniforms.uDbgGround.value = camY - 1.68;
    this.material.uniforms.uWindTime.value = t;
    this.material.uniforms.uDusk.value = dusk;
    // Only the near ring can resolve a parted blade — at ring 1's 22 m a 1.2 m
    // disturbance is under a degree of arc, and past that it is a lie nobody
    // can see costing a uniform write per frame.
    if (walker && this.ring === 0) {
      this.material.uniforms.uWalker.value.set(walker.x, walker.y, walker.z, walker.push);
      // a skiff's skirt is wider than a pair of boots — one shader, two callers
      this.material.uniforms.uPartR.value = walker.radius ?? PART_RADIUS;
    } else {
      this.material.uniforms.uWalker.value.w = 0;
    }
    this.blades = live;
    this.drawn = drawn;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

