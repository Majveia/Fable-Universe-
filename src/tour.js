// The tour: AEON flies itself.
//
// Press T and the universe becomes a film — cosmic time plays out, a node is
// chosen, the camera falls through a galaxy to a star, lands somewhere or
// sinks into a cloud deck, climbs back out, pays the black hole a visit, and
// starts again somewhere new. Forever. Touch anything and it's yours again.

export class Tour {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.stage = 'cosmic';
    this.timer = 0;
  }

  start() {
    this.active = true;
    this.stage = this.app.active().kind === 'cosmic' ? 'cosmic' : 'ground-out';
    this.timer = 4;
    this.app.hud.setHint('cinematic tour · touch anything to take the controls');
    const c = this.app.active();
    if (c.kind === 'cosmic' && c.a >= 1) { c.a = 0.048; c.sim?.reset(0.048); c.playing = true; }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    for (const s of this.app.stack) {
      if (s.controls && 'autoRotate' in s.controls) s.controls.autoRotate = false;
      if (s.kind === 'planet') s.tourAutopilot = false;
    }
    this.app.hud.setHint('');
  }

  _pickAt(nx, ny) {
    const s = this.app.active();
    this.app.raycaster.setFromCamera({ x: nx, y: ny }, s.camera);
    return s.pick?.(this.app.raycaster, { x: nx, y: ny });
  }

  _orbit(on, speed = 0.5) {
    const c = this.app.active().controls;
    if (c && 'autoRotate' in c) { c.autoRotate = on; c.autoRotateSpeed = speed; }
  }

  update(dt) {
    if (!this.active) return;
    const app = this.app;
    if (app._warping || app.zoom.busy) return; // let transitions finish
    const s = app.active();
    this.timer -= dt;

    switch (this.stage) {
      case 'cosmic': {
        this._orbit(true, 0.25);
        if (s.a >= 0.99 && this.timer <= 0) {
          for (let i = 0; i < 10; i++) {
            const hit = this._pickAt((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.7);
            if (hit) { app.diveFromHit(s, hit); this.stage = 'galaxy'; this.timer = 13; return; }
          }
          this.timer = 3;
        }
        break;
      }
      case 'galaxy': {
        this._orbit(true, 0.45);
        if (this.timer <= 0) {
          for (let i = 0; i < 10; i++) {
            const hit = this._pickAt((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.6);
            if (hit && hit.type === 'star') { app.diveFromHit(s, hit); this.stage = 'system'; this.timer = 8; return; }
          }
          this.timer = 3;
        }
        break;
      }
      case 'system': {
        this._orbit(true, 0.6);
        if (this.timer <= 0) {
          const P = s.params.planets;
          const pick = P.find(p => p.inhabited) || P.find(p => p.hasRings) || P.find(p => p.typeId <= 4) || P[0];
          if (!pick) { app.popTo(app.stack.length - 2); this.stage = 'galaxy-core'; this.timer = 6; return; }
          this._orbit(false);
          if (pick.typeId <= 4) {
            // the descent director flies ~44 s; leave time to stand around
            if (app.quadOn) { app.approach(s, pick); this.stage = 'planet'; this.timer = 56; return; }
            app.landOn(s, pick);
          } else {
            app.cruise(s, pick);
          }
          this.stage = 'ground';
          this.timer = 17;
        }
        break;
      }
      case 'planet': {
        // ride the descent all the way to the ground — it's one scale now
        if (s.kind !== 'planet') { this.stage = 'ground-out'; this.timer = 3; return; }
        s.tourAutopilot = true;
        if (s.walk) {
          s.yaw += dt * 0.09;   // a slow pan across the country
        }
        if (this.timer <= 0) {
          this._struck = false;
          s.tourAutopilot = false;
          app.popTo(app.stack.length - 2);
          this.stage = 'ground-out';
          this.timer = 3;
        }
        break;
      }
      case 'ground': {
        // slow pan across the world
        if (s.kind === 'surface' || s.kind === 'clouds') s.yaw += dt * 0.055;
        if (this.timer <= 0) {
          this._struck = false;
          app.popTo(app.stack.length - 2);
          this.stage = 'ground-out';
          this.timer = 4;
        }
        break;
      }
      case 'ground-out': {
        if (this.timer <= 0) {
          app.popTo(app.stack.length - 2); // back to the galaxy
          this.stage = 'galaxy-core';
          this.timer = 6;
        }
        break;
      }
      case 'galaxy-core': {
        this._orbit(true, 0.4);
        if (s.kind !== 'galaxy') { this.stage = s.kind === 'cosmic' ? 'cosmic-next' : 'ground-out'; this.timer = 3; return; }
        if (this.timer <= 0) {
          // visit the nucleus (single galaxies only — pairs have busier cores)
          if (!s.sim) {
            const hit = { type: 'core', bhMassMsun: s.params.bhMassMsun };
            app.diveFromHit(s, hit);
            this.stage = 'nucleus';
            this.timer = 11;
          } else {
            app.popTo(0);
            this.stage = 'cosmic-next';
            this.timer = 7;
          }
        }
        break;
      }
      case 'nucleus': {
        if (this.timer <= 0) {
          app.popTo(0); // straight home
          this.stage = 'cosmic-next';
          this.timer = 7;
        }
        break;
      }
      case 'cosmic-next': {
        this._orbit(true, 0.25);
        if (this.timer <= 0) { this.stage = 'cosmic'; this.timer = 2; }
        break;
      }
    }
  }
}
