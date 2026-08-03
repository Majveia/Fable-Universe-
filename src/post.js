// HDR bloom pipeline. Everything luminous in AEON glows through this —
// and then the frame passes through the grade: a per-world lift/gain/
// saturation pass with vignette and a breath of grain, applied in linear
// light before the tonemap. Neutral by default; a world's resonance
// (see resonance.js) leans on it to set the mood.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BloomChain } from './bloom.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { PRINT_SHADER } from './print.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uGain: { value: new THREE.Vector3(1, 1, 1) },
    uSat: { value: 1 },
    uVign: { value: 0.12 },
    uGrain: { value: 0.02 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform vec3 uLift;
    uniform vec3 uGain;
    uniform float uSat;
    uniform float uVign;
    uniform float uGrain;
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uGain + uLift;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      vec2 q = vUv - 0.5;
      col *= 1.0 - dot(q, q) * uVign * 2.2;
      // grain rides the mids, never the blacks — film, not static
      float g = fract(sin(dot(vUv + fract(uTime * 7.31), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
      col += g * uGrain * min(l * 3.0 + 0.08, 1.0);
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }
  `,
};

const NEUTRAL = { lift: [0, 0, 0], gain: [1, 1, 1], sat: 1, vign: 0.12, grain: 0.02 };

const PARAM = (k) => {
  try { return new URL(window.location.href).searchParams.get(k); }
  catch { return null; }
};

/** M1 — the ordered dither. Default-off (§7.4); see docs/plans/M1.md §5. */
const M1 = PARAM('m1') === '1';

/** M2 — the print (§9.4), which replaces ACES. Default-off; docs/plans/M2.md */
const M2 = PARAM('m2') === '1';

/**
 * How deep the M2 bloom chain goes, and therefore how far light travels. Each
 * level doubles the reach, so four levels is roughly 64 source pixels against a
 * 2560-pixel frame — bounded, which is the whole point (src/bloom.js).
 */
const BLOOM_LEVELS = Number(PARAM('blevels') ?? 4);

// §M1 adopts the reference's ordered dither, ±0.5/255, *after* sRGB — because
// a smooth gradient must never band, and the cosmic web is the worst banding
// case in the project.
//
// It collides with §2.8, which says vacuum renders to true #000 and blacks are
// never lifted. A flat ±0.5/255 applied at zero rounds half those pixels up to
// 1/255 and the deep field stops being black. So the amplitude is gated by
// luma: true black stays exactly black, and the first step above it — which is
// where banding actually lives — is dithered at full strength. Both hold.
//
// The gate's lower edge is half a display step, not zero, and that is a
// correction the RTX 3060 asked for. A gate opening at zero still hands a small
// dither to a pixel sitting at 0.4/255 — which quantises to black — and half of
// those round up. The measurement: 42.2% of the cosmic frame reached true #000
// with the dither off and 39.0% with it on, against a clause that allows 0.5%.
// The pedestal under the deep field (M2 act 1, docs/plans/M2.md §7) is what
// puts so many pixels in that band; the dither is what tips them. Below half a
// step there is nothing to dither *between*, so the gate now opens there.
const DitherShader = {
  uniforms: { tDiffuse: { value: null } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      // §11's second NaN firewall: the bloom pyramid smears one bad texel over
      // a neighbourhood, and the tonemap will happily print the result
      vec3 col = mix(vec3(0.0), c.rgb, vec3(equal(c.rgb, c.rgb)));
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float d = fract(dot(gl_FragCoord.xy, vec2(0.7548776662, 0.5698402909))) - 0.5;
      col += (d / 255.0) * smoothstep(0.5 / 255.0, 2.0 / 255.0, luma);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }
  `,
};

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.renderTarget1.texture.type = THREE.HalfFloatType;
    this.composer.renderTarget2.texture.type = THREE.HalfFloatType;

    this.renderPass = new RenderPass(null, null);
    // M2 replaces the pass entirely — see src/bloom.js for the measurement that
    // says no setting of UnrealBloomPass can satisfy §2.8 in vacuum
    this.bloom = M2 ? new BloomChain({ levels: BLOOM_LEVELS })
      : new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.75, 0.0);
    this.gradePass = new ShaderPass(GradeShader);
    this.output = new OutputPass();

    this.composer.addPass(this.renderPass);

    const ditherOff = PARAM('dither') === '0';

    if (M2) {
      // Order changes under M2, and the change is the point. The bloom no
      // longer adds itself to the frame; it renders to its own texture, which
      // the print samples. So it runs *after* the grade — a world's resonance
      // should colour what glows — and it swaps nothing, leaving the alpha
      // channel §9.3 needs untouched all the way from the scene to the print.
      this.composer.addPass(this.gradePass);
      this.composer.addPass(this.bloom);

      // The print does its own tonemap and its own sRGB encode, so OutputPass
      // has nothing left to do and three's renderer-level tonemapping has to
      // stand down — otherwise the frame is graded twice, once through the
      // curve §9.4 forbids.
      renderer.toneMapping = THREE.NoToneMapping;
      this.printPass = new ShaderPass(PRINT_SHADER);
      this.printPass.uniforms.uGrain.value = ditherOff ? 0 : 1;
      // §9.3's alpha, made visible — see the uniform's note in print.js
      this.printPass.uniforms.uFogView.value = PARAM('fogview') === '1' ? 1 : 0;
      this.printPass.uniforms.uBloom.value = this.bloom.texture;
      this.composer.addPass(this.printPass);
    } else {
      this.composer.addPass(this.bloom);
      this.composer.addPass(this.gradePass);
      this.composer.addPass(this.output);
      // last, and after OutputPass, because §M1 says post-sRGB: dithering in
      // linear light would put the noise in the wrong place on the curve.
      // ?dither=0 turns it off without turning M1 off — the control frame that
      // lets the gate measure whether it lifts vacuum black rather than argue it
      if (M1 && !ditherOff) this.composer.addPass(new ShaderPass(DitherShader));
    }
  }

  setScene(scene, camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  /** per-scale bloom personality */
  tune(s = {}) {
    const { strength = 0.85, radius = 0.75, threshold = 0.0 } = s;
    if (M2) {
      this.bloom.tune({ strength, radius, threshold });
      // the print does the compositing, so the strength lives on its uniform
      if (this.printPass) this.printPass.uniforms.uBloomAmt.value = strength;
      return;
    }
    this.bloom.strength = strength;
    this.bloom.radius = radius;
    this.bloom.threshold = threshold;
  }

  /** per-world grade: the resonance's hands on the color */
  grade(g) {
    const s = { ...NEUTRAL, ...(g ?? {}) };
    const u = this.gradePass.uniforms;
    u.uLift.value.fromArray(s.lift);
    u.uGain.value.fromArray(s.gain);
    u.uSat.value = s.sat;
    // Under M2 the vignette and the grain belong to §9.4, which owns both and
    // scales both by uPaint. Leaving the grade's copies running would print the
    // frame twice — and in vacuum it did worse than that. The grade's grain is
    // additive in linear light and ungated by medium, so it was seeding the
    // deep field at ±0.0008 even at the cosmic scale, where §2.8 says the
    // background is true #000. ACES hid it: its toe is so flat near zero that
    // the floor rounded back to 0 at 8-bit. AEON's curve is ~12× steeper there
    // and prints the same floor as 1/255. The grain was always wrong; only the
    // tonemap that concealed it has changed.
    //
    // The resonance keeps lift, gain and saturation — those are a world's
    // colour intent, not the print.
    u.uVign.value = M2 ? 0 : s.vign;
    u.uGrain.value = M2 ? 0 : s.grain;
  }

  /** §2.8: how much print this place gets. 0 in vacuum, 1 in an atmosphere,
   *  and the descent interpolates — one number, cross-fading by construction. */
  setPaint(v) {
    if (this.printPass) this.printPass.uniforms.uPaint.value = v;
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
    if (this.printPass) {
      this.printPass.uniforms.uRes.value.set(w, h);
      // setSize reallocates the chain's targets, so the sampler has to be
      // re-pointed or the print keeps reading a disposed texture
      this.printPass.uniforms.uBloom.value = this.bloom.texture;
    }
  }
  render(dt) {
    this.gradePass.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
