// HDR bloom pipeline. Everything luminous in AEON glows through this —
// and then the frame passes through the grade: a per-world lift/gain/
// saturation pass with vignette and a breath of grain, applied in linear
// light before the tonemap. Neutral by default; a world's resonance
// (see resonance.js) leans on it to set the mood.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

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

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.renderTarget1.texture.type = THREE.HalfFloatType;
    this.composer.renderTarget2.texture.type = THREE.HalfFloatType;

    this.renderPass = new RenderPass(null, null);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.75, 0.0);
    this.gradePass = new ShaderPass(GradeShader);
    this.output = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(this.output);
  }

  setScene(scene, camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  /** per-scale bloom personality */
  tune({ strength = 0.85, radius = 0.75, threshold = 0.0 } = {}) {
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
    u.uVign.value = s.vign;
    u.uGrain.value = s.grain;
  }

  setSize(w, h) { this.composer.setSize(w, h); }
  render(dt) {
    this.gradePass.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }
}
