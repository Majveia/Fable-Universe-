// The bloom, rebuilt with compact support. CLAUDE.md §2.8, §11; M2 act 2 step 5.
//
// ---------------------------------------------------------------------------
// Why `UnrealBloomPass` had to go
//
// It composites five mip levels, the coarsest at 1/32 resolution with a
// separable kernel that spans the frame. Every bright pixel therefore
// contributes a little to *every* pixel. Inside an atmosphere that is veiling
// glare and it is welcome. In vacuum it is a pedestal under a field §2.8
// requires to reach zero, and the measurement is unambiguous: at the cosmic
// scale, 76.2% of the frame reaches true #000 with the pass disabled and 0.0%
// with it on. docs/plans/M2.md §7 has the full sweep — radius 0.75→0, threshold
// 0→0.4, strength 0.85→0.15, and a subtracted floor — and every setting that
// recovers black deletes the web to do it, dropping lit pixels from 99% to 20%.
//
// The support is structural, so no parameter can fix it. That is the whole
// argument for this file.
//
// ---------------------------------------------------------------------------
// What replaces it
//
// The reference's structure: a bright pass, a *bounded* blur chain, and the
// composite performed inside the print (`c += bl · uBloomAmt`, reference line
// 4421) rather than as an additive pass of its own.
//
// Bounded is the operative word. The chain is `levels` deep starting at half
// resolution, and the dual-filter kernel reaches about two texels per step, so
// the furthest a photon travels is roughly `2^levels · 2` source pixels — 64 at
// four levels, against a 2560-pixel frame. A pixel further than that from any
// light receives *nothing*, which is what §2.8 asks for and what a mip pyramid
// cannot give.
//
// The filter is Marius Bjørge's dual filtering (SIGGRAPH 2015): a 5-tap
// downsample and an 8-tap tent upsample, which produce a near-Gaussian falloff
// for a third of the taps a separable Gaussian needs. §5 has 5.7× headroom on
// this hardware, but the cheap kernel is also the one that flickers least, and
// a bloom that shimmers under a moving camera is worse than no bloom.
//
// ---------------------------------------------------------------------------
// Compositing inside the print, and the alpha channel
//
// §9.3 wants the fog fraction written to alpha so the post chain knows each
// pixel's distance, and §9.4 step 5 spends it on distance-graded softening.
// `UnrealBloomPass` blends with `AdditiveBlending` and `transparent: true`, so
// it adds its own alpha to the scene's — every pixel's "distance" would become
// its distance plus how much it glows. Rendering the bloom to its own texture
// and letting the print sample it leaves alpha untouched from the scene to the
// print. The two halves of act 2 are the same change.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// §11's first firewall, at the bright pass — "the reference firewalls at the
// bright pass *and* again before the print", and one non-finite texel here gets
// smeared over a neighbourhood by everything downstream. NaN is the only value
// that fails to equal itself.
const BRIGHT = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform float uThreshold, uKnee;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    c = mix(vec3(0.0), c, vec3(equal(c, c)));
    c = max(c, vec3(0.0));
    // Karis' soft knee: a hard threshold makes the bloom pop on and off as a
    // tracer crosses it, which reads as flicker rather than as light.
    //
    // The knee is a width *around* the threshold, so it has to vanish with it.
    // A fixed knee at threshold 0 — which is what four of AEON's six scales
    // ask for — makes the soft term bottom out at knee/4 for every pixel dim,
    // so a tracer at 0.001 comes out at 0.088 and the bright pass becomes an
    // 88× amplifier of the deep field. Measured, that alone cost §2.8 most of
    // its black. tune() derives the knee from the threshold; at threshold 0
    // this whole block collapses to w = 1, which is the honest reading of
    // "bloom everything".
    float br = max(c.r, max(c.g, c.b));
    float w = 1.0;
    if (uThreshold > 0.0) {
      float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
      soft = soft * soft / (4.0 * uKnee + 1e-6);
      w = max(soft, br - uThreshold) / max(br, 1e-6);
    }
    gl_FragColor = vec4(c * clamp(w, 0.0, 1.0), 1.0);
  }
`;

const DOWN = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uHalf;
  varying vec2 vUv;
  void main() {
    vec4 s = texture2D(tDiffuse, vUv) * 4.0;
    s += texture2D(tDiffuse, vUv - uHalf);
    s += texture2D(tDiffuse, vUv + uHalf);
    s += texture2D(tDiffuse, vUv + vec2(uHalf.x, -uHalf.y));
    s += texture2D(tDiffuse, vUv - vec2(uHalf.x, -uHalf.y));
    gl_FragColor = s / 8.0;
  }
`;

// The upsample *blends* rather than accumulates, and that distinction is worth
// a paragraph because getting it wrong is invisible in the code and obvious in
// the frame. An additive up chain adds each level's full energy to the one
// below, so an L-level chain returns roughly L times the light it was given:
// measured, a four-level additive chain took the cosmic web from a mean
// luminance of 0.060 to 0.493 and lit 82.7% of the frame. That is not a bloom,
// it is a second copy of the image.
//
// So the alpha channel carries a blend weight and ordinary source-alpha
// blending does the lerp in the blender: `dst = w·up + (1−w)·dst`. Energy in
// equals energy out, the chain is a genuine multi-scale blur rather than a
// stack of them, and `uBloomAmt` means the same thing at every depth — which
// matters, because §5's quality table will set `levels` per tier and a knob
// whose meaning changes with the tier is not a knob.
const UP = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uHalf;
  uniform float uWeight;
  varying vec2 vUv;
  void main() {
    vec3 s = texture2D(tDiffuse, vUv + vec2(-uHalf.x * 2.0, 0.0)).rgb;
    s += texture2D(tDiffuse, vUv + vec2(-uHalf.x, uHalf.y)).rgb * 2.0;
    s += texture2D(tDiffuse, vUv + vec2(0.0, uHalf.y * 2.0)).rgb;
    s += texture2D(tDiffuse, vUv + vec2(uHalf.x, uHalf.y)).rgb * 2.0;
    s += texture2D(tDiffuse, vUv + vec2(uHalf.x * 2.0, 0.0)).rgb;
    s += texture2D(tDiffuse, vUv + vec2(uHalf.x, -uHalf.y)).rgb * 2.0;
    s += texture2D(tDiffuse, vUv + vec2(0.0, -uHalf.y * 2.0)).rgb;
    s += texture2D(tDiffuse, vUv + vec2(-uHalf.x, -uHalf.y)).rgb * 2.0;
    gl_FragColor = vec4(s / 12.0, uWeight);
  }
`;

const mat = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
  uniforms, vertexShader: VERT, fragmentShader,
  depthTest: false, depthWrite: false,
});

/**
 * A bloom that renders to its own texture and composites nowhere. Read
 * `.texture` from the pass that wants it — for AEON that is `print.js`, per
 * §9.4's step order.
 */
export class BloomChain extends Pass {
  constructor({ levels = 4, threshold = 0.0, kneeFrac = 0.5, strength = 0.85 } = {}) {
    super();
    this.kneeFrac = kneeFrac;
    // it contributes a texture, not a frame: the composer must not swap for it
    this.needsSwap = false;
    this.levels = levels;
    this.strength = strength;

    this.bright = mat(BRIGHT, {
      tDiffuse: { value: null },
      uThreshold: { value: threshold },
      uKnee: { value: kneeFrac * threshold },
    });
    this.down = mat(DOWN, { tDiffuse: { value: null }, uHalf: { value: new THREE.Vector2() } });
    this.up = mat(UP, {
      tDiffuse: { value: null },
      uHalf: { value: new THREE.Vector2() },
      uWeight: { value: 0.5 },
    });
    // source-alpha blending, so the tent *lerps* into the level below rather
    // than piling onto it — see the note above UP
    this.up.blending = THREE.NormalBlending;
    this.up.transparent = true;

    this.quad = new FullScreenQuad(null);
    this.targets = [];
    this.setSize(1, 1);
  }

  get texture() { return this.targets[0]?.texture ?? null; }

  /** the same shape `Post.tune()` speaks; radius scales the kernel's reach */
  tune({ strength = 0.85, radius = 0.75, threshold = 0.0 } = {}) {
    this.strength = strength;
    this.spread = 0.6 + radius;
    this.bright.uniforms.uThreshold.value = threshold;
    this.bright.uniforms.uKnee.value = this.kneeFrac * threshold;
  }

  setSize(width, height) {
    for (const t of this.targets) t.dispose();
    this.targets = [];
    let w = Math.max(1, width >> 1), h = Math.max(1, height >> 1);
    for (let i = 0; i < this.levels; i++) {
      const t = new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        // §11 again, one level down: a bloom texture that wraps would fetch the
        // opposite edge of the frame and put a glow where there is no light
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
      });
      this.targets.push(t);
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
    }
    this.spread ??= 1.35;
  }

  _blit(renderer, material, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    if (material !== this.up) renderer.clear(true, false, false);
    this.quad.render(renderer);
  }

  render(renderer, writeBuffer, readBuffer) {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    // bright pass into level 0
    this.bright.uniforms.tDiffuse.value = readBuffer.texture;
    this._blit(renderer, this.bright, this.targets[0]);

    // down the chain
    for (let i = 1; i < this.targets.length; i++) {
      const src = this.targets[i - 1];
      this.down.uniforms.tDiffuse.value = src.texture;
      this.down.uniforms.uHalf.value.set(
        (0.5 * this.spread) / src.width, (0.5 * this.spread) / src.height);
      this._blit(renderer, this.down, this.targets[i]);
    }

    // and back up, accumulating — additive, so each level adds its own reach
    for (let i = this.targets.length - 1; i > 0; i--) {
      const src = this.targets[i];
      this.up.uniforms.tDiffuse.value = src.texture;
      this.up.uniforms.uHalf.value.set(
        (0.5 * this.spread) / src.width, (0.5 * this.spread) / src.height);
      this._blit(renderer, this.up, this.targets[i - 1]);
    }

    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.bright.dispose(); this.down.dispose(); this.up.dispose();
    this.quad.dispose();
  }
}
