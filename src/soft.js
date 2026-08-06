// The wet-in-wet tap — CLAUDE.md §9.4 step 5, and the thing that step reads.
//
// §9.4 asks for *"watercolour softening tied to distance — a blurred tap
// blended at 0.42 × fog. Wet-in-wet, **not** bokeh. Plus chroma bleed at
// 0.09 + 0.17·wet: paint runs, pixels do not."*
//
// This file is the blurred tap. `print.js` spends it.
//
// ---------------------------------------------------------------------------
// Wet-in-wet is not a small blur, which is the thing worth getting from the
// reference rather than from the sentence
//
// "A blurred tap" reads like a few-pixel softening, and a few-pixel softening
// is what a camera does — it says *out of focus*, which is a lens, which is the
// one thing §9.4 rules out by name. Pigment diffusing through damp paper does
// something else: it travels, and it travels *far*, while the tonal structure
// stays put.
//
// The reference sizes it accordingly, and the numbers are the port:
//
//   - one 13-tap downsample from the full frame straight to **⅛ resolution**
//   - then a separable 5-tap Gaussian, horizontal and vertical, at that eighth
//
// Which puts the wash's reach at roughly thirty to forty full-resolution
// pixels, and its cost at three blits over 1/64 of the frame's area — about 5%
// of one full-screen pass. §5 has veto and there is nothing here to veto.
//
// The blur being this wide is also what makes the chroma bleed in `print.js`
// work: that step keeps the sharp luminance and takes *this* texture's
// chrominance, so colour is allowed to run a long way while every edge in the
// image stays exactly where it was. A tight blur would have made it a smudge.
//
// ---------------------------------------------------------------------------
// Both kernels are the reference's, and both are load-bearing
//
// The downsample is the 13-tap partial-Karis filter — a 3×3 box at ±2 texels
// plus a 2×2 at ±1, weighted 0.125/0.0625/0.03125/0.125. Its point is that an
// 8× reduction in one step aliases badly with a naive box, and aliasing in a
// *blur* target reads as the wash crawling when the camera moves.
//
// The blur is the 5-tap linear-sampled Gaussian: weights 0.227/0.316/0.070 at
// offsets 0/1.3846/3.2308. The fractional offsets are the whole trick — each
// pair of texels is fetched as one bilinear sample, so five fetches span nine
// texels. Round them to integers and it costs the same and blurs less.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// 13 taps, so an 8x reduction does not alias. `uTexel` is the *destination*
// texel, so the ±2 offsets reach ±16 pixels of the source.
const DOWN = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 t = uTexel;
    vec3 a = texture2D(tDiffuse, vUv + t * vec2(-2.0, -2.0)).rgb;
    vec3 b = texture2D(tDiffuse, vUv + t * vec2( 0.0, -2.0)).rgb;
    vec3 c = texture2D(tDiffuse, vUv + t * vec2( 2.0, -2.0)).rgb;
    vec3 d = texture2D(tDiffuse, vUv + t * vec2(-2.0,  0.0)).rgb;
    vec3 e = texture2D(tDiffuse, vUv).rgb;
    vec3 f = texture2D(tDiffuse, vUv + t * vec2( 2.0,  0.0)).rgb;
    vec3 g = texture2D(tDiffuse, vUv + t * vec2(-2.0,  2.0)).rgb;
    vec3 h = texture2D(tDiffuse, vUv + t * vec2( 0.0,  2.0)).rgb;
    vec3 i = texture2D(tDiffuse, vUv + t * vec2( 2.0,  2.0)).rgb;
    vec3 j = texture2D(tDiffuse, vUv + t * vec2(-1.0, -1.0)).rgb;
    vec3 k = texture2D(tDiffuse, vUv + t * vec2( 1.0, -1.0)).rgb;
    vec3 l = texture2D(tDiffuse, vUv + t * vec2(-1.0,  1.0)).rgb;
    vec3 m = texture2D(tDiffuse, vUv + t * vec2( 1.0,  1.0)).rgb;
    vec3 o = e * 0.125 + (a + c + g + i) * 0.03125
           + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
    // §11's firewall, at the one place the whole frame is read: a single
    // non-finite texel here would be spread over the wash by the two blurs
    // below and then survive the print as a block. A select, not arithmetic.
    gl_FragColor = vec4(all(equal(o, o)) ? o : vec3(0.0), 1.0);
  }
`;

const BLUR = /* glsl */`
  precision highp float;
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec2 d = uTexel * uDir;
    vec3 c = texture2D(tDiffuse, vUv).rgb * 0.227;
    c += (texture2D(tDiffuse, vUv + d * 1.3846).rgb
        + texture2D(tDiffuse, vUv - d * 1.3846).rgb) * 0.316;
    c += (texture2D(tDiffuse, vUv + d * 3.2308).rgb
        + texture2D(tDiffuse, vUv - d * 3.2308).rgb) * 0.070;
    gl_FragColor = vec4(c, 1.0);
  }
`;

const mat = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
  uniforms, vertexShader: VERT, fragmentShader, depthTest: false, depthWrite: false,
});

/**
 * A blurred copy of the frame, at an eighth, in its own texture. Composites
 * nowhere — read `.texture` from the pass that wants it, which for AEON is
 * `print.js`, exactly as `BloomChain` is read.
 *
 * `divisor` is the reduction. It is a knob rather than an 8 because §5's
 * four-row quality table is where a per-tier reduction belongs, and a mobile
 * row that wants a sixteenth should not have to fork the shader to get one.
 */
export class SoftChain extends Pass {
  constructor({ divisor = 8 } = {}) {
    super();
    this.needsSwap = false;
    this.divisor = divisor;
    this.targets = [];
    this.quad = new FullScreenQuad(null);
    this.down = mat(DOWN, { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.blur = mat(BLUR, {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uDir: { value: new THREE.Vector2(1, 0) },
    });
    this.setSize(1, 1);
  }

  /** the wash, for the print to sample */
  get texture() { return this.targets[0].texture; }

  setSize(width, height) {
    for (const t of this.targets) t.dispose();
    this.targets = [];
    const w = Math.max(2, Math.floor(width / this.divisor));
    const h = Math.max(2, Math.floor(height / this.divisor));
    for (let i = 0; i < 2; i++) {
      this.targets.push(new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        // A wash that wrapped would pull the opposite edge of the frame into
        // the border — the same trap `bloom.js` names, and worse here, because
        // this texture is sampled over the *whole* frame rather than where the
        // light is.
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        depthBuffer: false,
        stencilBuffer: false,
      }));
    }
    this.down.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.blur.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  _blit(material, renderer, target) {
    this.quad.material = material;
    renderer.setRenderTarget(target);
    renderer.clear(true, false, false);
    this.quad.render(renderer);
  }

  render(renderer, writeBuffer, readBuffer) {
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    this.down.uniforms.tDiffuse.value = readBuffer.texture;
    this._blit(this.down, renderer, this.targets[0]);

    this.blur.uniforms.tDiffuse.value = this.targets[0].texture;
    this.blur.uniforms.uDir.value.set(1, 0);
    this._blit(this.blur, renderer, this.targets[1]);

    this.blur.uniforms.tDiffuse.value = this.targets[1].texture;
    this.blur.uniforms.uDir.value.set(0, 1);
    this._blit(this.blur, renderer, this.targets[0]);

    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);
  }

  dispose() {
    for (const t of this.targets) t.dispose();
    this.down.dispose(); this.blur.dispose(); this.quad.dispose();
  }
}
