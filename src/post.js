// HDR bloom pipeline. Everything luminous in AEON glows through this.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.composer = new EffectComposer(renderer);
    this.composer.renderTarget1.texture.type = THREE.HalfFloatType;
    this.composer.renderTarget2.texture.type = THREE.HalfFloatType;

    this.renderPass = new RenderPass(null, null);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.85, 0.75, 0.0);
    this.output = new OutputPass();

    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
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

  setSize(w, h) { this.composer.setSize(w, h); }
  render(dt) { this.composer.render(dt); }
}
