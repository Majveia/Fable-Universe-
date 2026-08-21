// The sun shadow, with a hand-drawn edge. CLAUDE.md §9.2; M2 act 3, part two.
//
// §9.2's light model was ported without one, and the frame said so: with
// `shadow = 1` everywhere the ramp's `t` never falls below the second band
// edge, so the whole surface sits on the lit stop and the bands the model
// exists for never appear. The model was correct and its input was missing.
// This is the input.
//
// Ported from `docs/reference/hoshi-no-tani.html` lines 578–619 (the sampler)
// and 5714–5739 (the pass).
//
// ---------------------------------------------------------------------------
// Three details that are doing the work
//
// **The edge is drawn, not filtered.** Five taps in a cross, offset by two
// octaves of value noise before they are taken. That offset is what gives the
// silhouette its brush character — a nine-tap box filter would give a *soft*
// edge, which is a different thing and a worse one. The reference's own note
// says the wobble dominates the silhouette, so five taps read the same as nine.
//
// **The wobble is specified in metres.** `0.34 / span` converts a 34 cm
// displacement in the world into the map's UV, so the brush stroke keeps its
// size whatever the span or the resolution. Specify it in texels instead and
// the art direction changes every time the quality row does.
//
// **The light camera snaps to its own texel grid.** Without that the map slides
// under the geometry as the camera moves and every shadow edge crawls — the
// classic artefact, and the one thing about a shadow map that reads as *cheap*
// rather than as soft. `snapCentre()` is three lines and it is the difference.
//
// ---------------------------------------------------------------------------
// What AEON changes
//
// The reference has one valley, one sun and one span. AEON has a sun that moves
// and worlds of any size, so the centre follows the camera, the height under
// the centre comes from the caller, and the pass is a class that can be built
// at any scale rather than a function over module globals.
//
// It also declines to shadow anything that is not a solid: points, sprites and
// transparent materials are hidden for the depth pass. A billboarded god-ray
// quad casting a hard shadow is not a stylistic choice.

import * as THREE from 'three';

/** metres across the shadow map — the reference's own `CFG.shadowSpan` */
export const SHADOW_SPAN = 480;

/** the world-space wobble, in metres: a 34 cm brush stroke */
export const WOBBLE_METRES = 0.34;

/**
 * The layer casters live on. Casting is **opt-in**, and it has to be.
 *
 * The first version excluded points, sprites and transparent materials and
 * rendered everything else, which sounded conservative and was not: a surface
 * scene also holds a 20 km sky dome, a 9.9 km ocean plane and a 3.3 km horizon
 * ring, all opaque, all inside the light camera's frustum, and all of them
 * write depth *above* the terrain from a 20° sun. The map came back holding a
 * plausible-looking depth range that belonged to none of the geometry the eye
 * can see, and every ground fragment compared against it as shadowed.
 *
 * An occluder has to be named. `markCaster()` names it.
 */
export const CASTER_LAYER = 3;

/** this object, and its descendants, cast a sun shadow */
export function markCaster(obj) {
  obj.traverse((o) => o.layers.enable(CASTER_LAYER));
  return obj;
}

/**
 * The texel size the centre snaps to. Two world units per texel of the map,
 * because the projection spans `span` across `res` texels and the snap has to
 * survive the half-texel offset of the projection's own centre.
 */
export function shadowTexel(span, res) { return (span / res) * 2; }

/**
 * Quantise a light-camera centre to the texel grid.
 *
 * This is what stops the shadow crawling. The map is re-rendered every frame
 * from a camera that follows the view; if its centre moves by a fraction of a
 * texel, every depth sample lands between two texels it landed on last frame
 * and the whole silhouette shimmers. Snapping makes sub-texel camera motion a
 * no-op for the map, so the edge is *still* while the camera moves.
 */
export function snapCentre(x, z, texel) {
  return [Math.round(x / texel) * texel, Math.round(z / texel) * texel];
}

/**
 * The sampler, for injection into any fragment shader that has a world pos.
 *
 * A **function of the tap count** rather than a constant, because separating
 * the map from `?paint=` put this on the terrain — more than half of every
 * surface frame — and §5's rule is that a change costing frames pays for them
 * with an LOD *before* the feature, not after the measurement.
 *
 * The argument for one tap being enough on the low row is this file's own,
 * carried one step: the wobble dominates the silhouette, so five taps read the
 * same as nine, and on a 1024 map at 720p one wobbled tap reads very nearly the
 * same as five — what the eye is reading is the noise offset, not the filter
 * width. Both early-outs are untouched, so ground outside the map still costs
 * nothing on any row.
 *
 * `SHADOW_GLSL` stays exported as the five-tap string so every existing caller
 * and every check that names it keeps working unchanged.
 */
export function shadowGLSL(taps = 5) {
  const cross = [[1, 1], [-1, 1], [1, -1], [-1, -1]].slice(0, Math.max(0, taps - 1));
  const extra = cross.map(([a, b]) =>
    `    s += step(pc.z - bias, texture2D(uShadowMap, pc.xy + jo + vec2(${a === 1 ? ' r' : '-r'}, ${b === 1 ? ' r' : '-r'})).r);`).join('\n');
  const n = cross.length + 1;
  return SHADOW_HEAD
    // only declared when something reads it: a one-tap build has no cross, and
    // an unused declaration is a warning on some drivers and noise on all of them
    + (extra ? '    float r = uShadowTexel * 1.7;\n' : '')
    + `    float s  = step(pc.z - bias, texture2D(uShadowMap, pc.xy + jo).r);\n`
    + (extra ? extra + '\n' : '')
    + `    return mix(1.0, s * ${(1 / n).toFixed(6)}, fade);\n  }\n`;
}

const SHADOW_HEAD = /* glsl */`
  uniform sampler2D uShadowMap;
  uniform mat4  uLightMat;
  uniform float uShadowTexel;
  uniform float uWobbleUV;     // WOBBLE_METRES / span, so the stroke is metric

  float shadowNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    vec2 h = vec2(127.1, 311.7);
    float a = fract(sin(dot(i, h)) * 43758.5453);
    float b = fract(sin(dot(i + vec2(1, 0), h)) * 43758.5453);
    float c = fract(sin(dot(i + vec2(0, 1), h)) * 43758.5453);
    float d = fract(sin(dot(i + vec2(1, 1), h)) * 43758.5453);
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // r = edge fade · g = projected depth · b = what the map holds there.
  // One image says which of the three early-outs is firing.
  vec3 shadowProbe(vec3 wp) {
    vec4 lp = uLightMat * vec4(wp, 1.0);
    vec3 pc = lp.xyz / lp.w * 0.5 + 0.5;
    vec2 e = abs(pc.xy - 0.5);
    float fade = 1.0 - smoothstep(0.40, 0.497, max(e.x, e.y));
    return vec3(fade, pc.z, texture2D(uShadowMap, pc.xy).r);
  }

  float sunShadow(vec3 wp, float ndl) {
    vec4 lp = uLightMat * vec4(wp, 1.0);
    vec3 pc = lp.xyz / lp.w * 0.5 + 0.5;
    if (pc.z > 0.9995) return 1.0;
    // the map has an edge; a hard one would draw a line across the valley
    vec2 e = abs(pc.xy - 0.5);
    float fade = 1.0 - smoothstep(0.40, 0.497, max(e.x, e.y));
    if (fade <= 0.001) return 1.0;
    // a grazing surface needs more bias, a facing one less: at 13.5 degrees the
    // depth gradient across a texel is enormous and a fixed bias acnes the lot
    float bias = mix(0.0022, 0.00045, clamp(ndl, 0.0, 1.0));
    // the painterly wobble — the edge is DRAWN. Two octaves, in metres.
    float j0 = shadowNoise(wp.xz * 2.7) - 0.5;
    float j1 = shadowNoise(wp.zx * 8.3 + 9.7) - 0.5;
    vec2 jo = vec2(j0 * 2.0 + j1 * 0.9, j1 * 1.6 - j0 * 0.7) * uWobbleUV;
`;

/** the five-tap sampler: the default, and what every existing caller gets */
export const SHADOW_GLSL = shadowGLSL(5);

/**
 * One orthographic depth pass along the sun.
 *
 * `update()` is called once per frame before the scene draws; the uniforms it
 * fills are the ones `SHADOW_GLSL` reads.
 */
export class SunShadow {
  constructor({ res = 2048, span = SHADOW_SPAN } = {}) {
    this.span = span;
    this.res = res;
    this.cam = new THREE.OrthographicCamera(-span / 2, span / 2, span / 2, -span / 2, 1, 1500);

    // Depth goes to the *colour* attachment, not to a DepthTexture.
    //
    // The first version attached a `DepthTexture` and sampled that, which is
    // the textbook approach and did not work: the pass ran, the light matrix
    // was correct, 82 meshes were in frame, and every fragment still read the
    // map as 1.0 — a cleared depth buffer. Nothing in the console said why,
    // because a depth-attachment mismatch fails as a driver warning at worst.
    //
    // `MeshDepthMaterial` already writes depth into colour, so the colour
    // attachment is the product and the depth texture was never needed. A float
    // target keeps full precision, where the RGBA8 default would quantise the
    // comparison to 8 bits and stripe every shadow edge.
    this.rt = new THREE.WebGLRenderTarget(res, res, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.FloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking });
    this.cam.layers.set(CASTER_LAYER);

    this.uniforms = {
      uShadowMap: { value: this.rt.texture },
      uLightMat: { value: new THREE.Matrix4() },
      uShadowTexel: { value: 1 / res },
      uWobbleUV: { value: WOBBLE_METRES / span },
    };
    this._fwd = new THREE.Vector3();
    this._prevClear = new THREE.Color();
  }

  /**
   * @param groundAt `(x, z) => y`, sampled at the map's *own* centre — the
   *   camera aims at the ground rather than at the viewer's eye, or a low sun
   *   clips the far half of the valley behind the near plane. It has to be a
   *   function because the centre is not known until it has been snapped.
   */
  update(renderer, scene, camera, sunDir, groundAt) {
    if (sunDir.y <= 0.01) { this.uniforms.uLightMat.value.identity(); return; }

    const texel = shadowTexel(this.span, this.res);
    this._fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const [cx, cz] = snapCentre(
      camera.position.x + this._fwd.x * this.span * 0.30,
      camera.position.z + this._fwd.z * this.span * 0.30,
      texel);
    const cy = typeof groundAt === 'function' ? groundAt(cx, cz) : (groundAt ?? 0);

    // A 13.5 degree sun sits almost on the horizon, so the light camera has to
    // stand a long way back or half the valley falls behind its near plane.
    this.cam.position.set(cx + sunDir.x * 760, cy + sunDir.y * 760, cz + sunDir.z * 760);
    this.cam.up.set(0, 1, 0);
    this.cam.lookAt(cx, cy, cz);
    this.cam.updateProjectionMatrix();
    this.cam.updateMatrixWorld(true);
    this.uniforms.uLightMat.value.multiplyMatrices(
      this.cam.projectionMatrix, this.cam.matrixWorldInverse);

    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    renderer.getClearColor(this._prevClear);
    const prevAlpha = renderer.getClearAlpha();

    // Clear to WHITE, which is the far plane. This target's colour attachment
    // *is* the depth map, and the renderer's clear colour is #000 — so an
    // unwritten texel would read as an occluder sitting at depth zero and every
    // fragment under it comes back fully shadowed. That is not a subtle
    // failure: it renders the terrain's own footprint solid black while the
    // ground beyond the map's edge stays lit, which looks like the shadow being
    // inside-out rather than like a clear colour.
    scene.overrideMaterial = this.depthMat;
    renderer.setRenderTarget(this.rt);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, this.cam);
    renderer.setClearColor(this._prevClear, prevAlpha);
    scene.overrideMaterial = prevOverride;
    renderer.setRenderTarget(prevTarget);
  }

  dispose() {
    this.rt.dispose();
    this.depthMat.dispose();
  }
}
