// Hyperzoom: seamless dives between scales.
//
// Descending: the current scale's camera accelerates toward the target, the
// final frame is snapshotted into a render target, scales swap underneath,
// and the snapshot zooms past the camera while it fades — as the new scale's
// camera finishes the fall. Ascending runs the figure in reverse. The screen
// never cuts to black; motion carries straight through the swap.

import * as THREE from 'three';

const easeIn = (t) => t * t * (0.6 + 0.4 * t);
const easeOut = (t) => 1 - Math.pow(1 - t, 2.6);

export class Hyperzoom {
  constructor(app) {
    this.app = app;
    this.state = null;

    this.overlayScene = new THREE.Scene();
    this.overlayCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
    this.quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
    this.quad.frustumCulled = false;
    this.overlayScene.add(this.quad);
  }

  get busy() { return this.state !== null; }

  _snapshot(scale) {
    const r = this.app.renderer;
    const size = r.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false,
    });
    r.setRenderTarget(rt);
    r.render(scale.scene, scale.camera);
    r.setRenderTarget(null);
    return rt;
  }

  /** descend: focusFn() gives the dive target in the from-scale's world */
  dive(from, to, focusFn, onSwap) {
    if (from.controls) from.controls.enabled = false;
    this.state = {
      kind: 'dive', phase: 'approach', t: 0,
      from, to, focusFn, onSwap,
      camStart: from.camera.position.clone(),
      lookStart: from.controls ? from.controls.target.clone() : new THREE.Vector3(),
      look: new THREE.Vector3(),
      baseFov: from.camera.fov,
    };
  }

  /** ascend: `to` is the surviving parent scale already in the stack */
  ascend(from, to, onSwap) {
    if (from.controls) from.controls.enabled = false;
    this.state = {
      kind: 'ascend', phase: 'approach', t: 0,
      from, to, onSwap,
      camStart: from.camera.position.clone(),
      lookStart: from.controls ? from.controls.target.clone() : new THREE.Vector3(),
      baseFov: from.camera.fov,
    };
  }

  _beginSettle(s) {
    s.rt = this._snapshot(s.from);
    this.quad.material.map = s.rt.texture;
    this.quad.material.opacity = 1;
    this.quad.material.color.setScalar(1.25); // stand in for the lost bloom
    this.quad.scale.set(1, 1, 1);
    s.from.camera.fov = s.baseFov;
    s.from.camera.updateProjectionMatrix();

    s.onSwap();

    const cam = s.to.camera;
    if (s.kind === 'dive') {
      s.restPos = cam.position.clone();
      const target = s.to.controls ? s.to.controls.target.clone() : new THREE.Vector3();
      if (s.to.arriveFrom) cam.position.copy(s.to.arriveFrom(s.restPos));
      else cam.position.copy(target).addScaledVector(s.restPos.clone().sub(target), 2.4);
      s.arriveTarget = target;
    } else {
      s.restPos = cam.position.clone();
      const target = s.to.controls ? s.to.controls.target.clone() : new THREE.Vector3();
      cam.position.copy(target).addScaledVector(s.restPos.clone().sub(target), 0.5);
      s.arriveTarget = target;
    }
    if (s.to.controls) s.to.controls.enabled = false;
    s.phase = 'settle';
    s.t = 0;
  }

  _finish(s) {
    const cam = s.to.camera;
    cam.position.copy(s.restPos);
    if (s.to.controls) {
      s.to.controls.enabled = true;
      s.to.controls.update();
    }
    this.quad.material.map = null;
    s.rt.dispose();
    this.state = null;
  }

  update(dt) {
    const s = this.state;
    if (!s) return;

    if (s.phase === 'approach') {
      const dur = s.kind === 'dive' ? 0.55 : 0.4;
      s.t = Math.min(s.t + dt / dur, 1);
      const k = easeIn(s.t);
      const cam = s.from.camera;
      if (s.kind === 'dive' && s.focusFn) {
        const focus = s.focusFn();
        // fall 62% of the way in, steering the view onto the target
        cam.position.lerpVectors(s.camStart, focus, 0.62 * k);
        s.look.lerpVectors(s.lookStart, focus, k);
        cam.lookAt(s.look);
        cam.fov = s.baseFov * (1 - 0.18 * k); // slight tunnel rush
      } else if (s.kind === 'ascend') {
        // pull back and away
        const out = s.camStart.clone().sub(s.lookStart).multiplyScalar(1 + 0.9 * k);
        cam.position.copy(s.lookStart).add(out);
        cam.fov = s.baseFov * (1 + 0.12 * k);
      }
      cam.updateProjectionMatrix();
      if (s.t >= 1) this._beginSettle(s);
      return;
    }

    // settle: snapshot passes by while the new camera completes the motion
    const dur = 0.85;
    s.t = Math.min(s.t + dt / dur, 1);
    const k = easeOut(s.t);
    const cam = s.to.camera;
    cam.position.lerpVectors(
      cam.position.clone(), s.restPos, 1 - Math.exp(-6.5 * dt));
    // straight lerp fallback so it provably lands
    if (s.t >= 1) cam.position.copy(s.restPos);
    cam.lookAt(s.arriveTarget);

    if (s.kind === 'dive') {
      const z = 1 + 2.6 * k * k;
      this.quad.scale.set(z, z, 1);
    } else {
      const z = Math.max(1 - 0.5 * k, 0.01);
      this.quad.scale.set(z, z, 1);
    }
    this.quad.material.opacity = 1 - k;

    if (s.t >= 1) this._finish(s);
  }

  /** draw the passing snapshot over the composed frame */
  render() {
    if (!this.state || this.state.phase !== 'settle') return;
    const r = this.app.renderer;
    const prev = r.autoClear;
    r.autoClear = false;
    r.render(this.overlayScene, this.overlayCam);
    r.autoClear = prev;
  }
}
