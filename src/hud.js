// The interface: a few hairlines of type floating over the void.
// Everything fades; the universe is the UI.

import { systemParams } from './system.js';
import { faunaNames } from './rng.js';

const CONTROLS_HTML = `
  <b>everywhere</b><br>
  click — select · double-click — dive, planets all the way down<br>
  esc — ascend · scroll / pinch — altitude<br>
  space — pause time · + − — bend it · [ ] — scrub<br>
  t — tour · g — atlas · n — bestiary · ? — this card<br>
  h — hide the interface · m — sound<br>
  b — logbook · u — a new universe<br>
  <b>on a planet</b><br>
  w a s d — move · f — toggle flight · shift — boost<br>
  c — step outside yourself · e — board the skiff<br>
  <b>on the streaming globe (?quad=1)</b><br>
  r f — climb &amp; dive · b — shuttle<br>
  esc — the climb-out flies you to orbit<br>
  <b>on glass</b><br>
  drag — look · pinch — altitude · stick — move<br>
  ⛯ — fly me · ✈ ◉ ⛵ — fly · third person · skiff<br>
  double-tap — go there`;

export class HUD {
  constructor(app) {
    this.app = app;
    const el = (tag, id, parent = document.body) => {
      const e = document.createElement(tag);
      e.id = id; e.className = 'hud'; parent.appendChild(e); return e;
    };

    this.crumbs = el('nav', 'crumbs');
    this.stats = el('div', 'stats');
    this.hints = el('div', 'hints');
    this.card = el('aside', 'card');

    // a caption that fades in when you come upon something the land remembers
    this.discovery = el('div', 'discovery');
    this.discovery.innerHTML = '<div class="dsc-name"></div><div class="dsc-lore"></div>';
    this._dscName = this.discovery.querySelector('.dsc-name');
    this._dscLore = this.discovery.querySelector('.dsc-lore');
    this._dscShown = null;

    this.timectl = el('div', 'timectl');
    this.timectl.innerHTML = `
      <span class="readout" id="time-readout"></span>
      <button id="t-mute" title="sound (m)">♪</button>
      <button id="t-slow" title="slower">−</button>
      <button id="t-play" title="pause / play">⏸</button>
      <button id="t-fast" title="faster">+</button>`;
    this.readout = this.timectl.querySelector('#time-readout');
    this.playBtn = this.timectl.querySelector('#t-play');
    this.muteBtn = this.timectl.querySelector('#t-mute');
    this.timectl.querySelector('#t-slow').onclick = () => app.active()?.slowDown?.();
    this.timectl.querySelector('#t-fast').onclick = () => app.active()?.speedUp?.();
    this.playBtn.onclick = () => { app.active()?.togglePlay?.(); };
    this.muteBtn.onclick = () => this.setMuted(app.audio.toggleMute());
    if (localStorage.getItem('aeon-mute') === '1') this.setMuted(true);

    this.science = el('div', 'science');
    const sciBtn = document.createElement('button');
    sciBtn.textContent = 'i';
    sciBtn.title = 'the science of this scale';
    this.note = document.createElement('div');
    this.note.className = 'note';
    this.science.appendChild(sciBtn);
    this.science.appendChild(this.note);
    sciBtn.onclick = () => this.note.classList.toggle('open');

    const logBtn = document.createElement('button');
    logBtn.textContent = '◈';
    logBtn.title = 'logbook (b)';
    this.logPanel = document.createElement('div');
    this.logPanel.className = 'note logpanel';
    this.science.appendChild(logBtn);
    this.science.appendChild(this.logPanel);
    logBtn.onclick = () => this.toggleLog();

    // the atlas: anywhere in the universe, one step
    const atlasBtn = document.createElement('button');
    atlasBtn.textContent = '✦';
    atlasBtn.title = 'atlas (g)';
    this.atlasPanel = document.createElement('div');
    this.atlasPanel.className = 'note logpanel';
    this.science.appendChild(atlasBtn);
    this.science.appendChild(this.atlasPanel);
    atlasBtn.onclick = () => this.toggleAtlas();

    // the bestiary: every creature and wonder you have met, remembered
    const beastBtn = document.createElement('button');
    beastBtn.textContent = '⁂';
    beastBtn.title = 'bestiary (n)';
    this.beastPanel = document.createElement('div');
    this.beastPanel.className = 'note logpanel';
    this.science.appendChild(beastBtn);
    this.science.appendChild(this.beastPanel);
    beastBtn.onclick = () => this.toggleBestiary();

    // the controls, all of them, one card
    const ctrlBtn = document.createElement('button');
    ctrlBtn.textContent = '⌨';
    ctrlBtn.title = 'controls (?)';
    this.ctrlPanel = document.createElement('div');
    this.ctrlPanel.className = 'note logpanel controlscard';
    this.ctrlPanel.innerHTML = CONTROLS_HTML;
    this.science.appendChild(ctrlBtn);
    this.science.appendChild(this.ctrlPanel);
    ctrlBtn.onclick = () => this.toggleControls();

    this.warpEl = document.getElementById('warp');
    this.veilEl = document.createElement('div');
    this.veilEl.id = 'veil';
    document.body.appendChild(this.veilEl);

    this._idleT = 0;
    window.addEventListener('pointermove', () => {
      this._idleT = 0;
      this.hints.classList.remove('faded');
    });

    // on glass, the universe grows thumbs
    if (window.matchMedia && matchMedia('(pointer: coarse)').matches) this._buildTouch(app);
  }

  /**
   * Touch controls: a stick that speaks WASD, hold-buttons for climb and
   * dive, one context button that flies the ship for you, and a help card.
   * Everything goes through synthetic key events — the same systems, the
   * same depth, none of the keyboard.
   */
  _buildTouch(app) {
    document.body.classList.add('coarse');
    const ui = document.createElement('div');
    ui.id = 'touch';
    ui.innerHTML = `
      <div id="stick"><div id="knob"></div></div>
      <div id="vslide"><div id="vknob"></div></div>
      <div id="tbtns">
        <button id="tb-go" class="big" title="fly me there">⛯</button>
        <div id="tbrow">
          <button id="tb-shuttle" title="shuttle">⇋</button>
          <button id="tb-fly" title="toggle flight">✈</button>
          <button id="tb-view" title="third person">◉</button>
          <button id="tb-act" title="board the skiff">⛵</button>
          <button id="tb-atlas" title="atlas">✦</button>
          <button id="tb-help" title="controls">?</button>
        </div>
      </div>
      <div id="touchhelp">
        <b>touch</b><br>
        drag — look · pinch — altitude<br>
        stick — move · push to the rim — boost<br>
        tap — select · double-tap — go there<br>
        ✈ — fly · ◉ — third person · ⛵ — the skiff<br>
        ✦ — atlas: anywhere, one step</div>`;
    document.body.appendChild(ui);

    const key = (code, on) =>
      window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code }));

    // the right-edge spring slider: drag up to climb, down to dive, let go
    // and it re-centers — one thumb, both directions
    const vs = ui.querySelector('#vslide');
    const vk = ui.querySelector('#vknob');
    let vid = null, vHeld = null;
    const vset = (code) => {
      if (vHeld === code) return;
      if (vHeld) key(vHeld, false);
      vHeld = code;
      if (code) key(code, true);
    };
    const vmove = (e) => {
      const r = vs.getBoundingClientRect();
      let dy = e.clientY - (r.top + r.height / 2);
      dy = Math.max(-r.height / 2 + 20, Math.min(r.height / 2 - 20, dy));
      vk.style.transform = `translateY(${dy}px)`;
      const t = dy / (r.height / 2 - 20);
      vset(t < -0.2 ? 'KeyR' : t > 0.2 ? 'KeyF' : null);
    };
    vs.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      vid = e.pointerId;
      try { vs.setPointerCapture(vid); } catch { /* synthetic pointers */ }
      vmove(e);
    });
    vs.addEventListener('pointermove', (e) => { if (e.pointerId === vid) vmove(e); });
    const vend = (e) => {
      if (e.pointerId !== vid) return;
      vid = null;
      vk.style.transform = '';
      vset(null);
    };
    vs.addEventListener('pointerup', vend);
    vs.addEventListener('pointercancel', vend);

    // the stick: WASD by displacement, with a dead zone
    const stick = ui.querySelector('#stick');
    const knob = ui.querySelector('#knob');
    const downCodes = new Set();
    const setCodes = (want) => {
      for (const c of [...downCodes]) if (!want.has(c)) { key(c, false); downCodes.delete(c); }
      for (const c of want) if (!downCodes.has(c)) { key(c, true); downCodes.add(c); }
    };
    let sid = null;
    const move = (e) => {
      const r = stick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2);
      let dy = e.clientY - (r.top + r.height / 2);
      const m = Math.hypot(dx, dy), max = r.width * 0.38;
      if (m > max) { dx *= max / m; dy *= max / m; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const dead = r.width * 0.1;
      const want = new Set();
      if (dy < -dead) want.add('KeyW');
      if (dy > dead) want.add('KeyS');
      if (dx < -dead) want.add('KeyA');
      if (dx > dead) want.add('KeyD');
      // the rim is the throttle: push to the edge and you are boosting
      if (m >= max * 0.94) want.add('ShiftLeft');
      setCodes(want);
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sid = e.pointerId;
      try { stick.setPointerCapture(sid); } catch { /* synthetic pointers can't be captured */ }
      move(e);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) move(e); });
    const end = (e) => {
      if (e.pointerId !== sid) return;
      sid = null;
      knob.style.transform = '';
      setCodes(new Set());
    };
    stick.addEventListener('pointerup', end);
    stick.addEventListener('pointercancel', end);

    // the one big button: context-aware autopilot
    this._goBtn = ui.querySelector('#tb-go');
    this._goBtn.addEventListener('click', () => {
      const s = app.active();
      if (s.kind === 'planet') {
        if (s.auto) s._cancelAuto();
        else if (s.asc) s.asc = null;
        else if ((s.altUnits ?? 9e9) < s.R * 0.9) s.beginAscent();
        else s._engageAutopilot();
      } else {
        key('KeyT', true);   // elsewhere, the button conducts the tour
      }
    });
    ui.querySelector('#tb-help').addEventListener('click', () => {
      ui.querySelector('#touchhelp').classList.toggle('open');
    });
    ui.querySelector('#tb-atlas').addEventListener('click', () => this.toggleAtlas());
    // the shuttle: B by another name, shown only where shuttles fly
    this._shBtn = ui.querySelector('#tb-shuttle');
    this._shBtn.addEventListener('click', () => {
      const s = app.active();
      s.onKey?.('KeyB');
    });
    // the surface trio: F, C, and E by friendlier names, shown on the ground
    this._flyBtn = ui.querySelector('#tb-fly');
    this._flyBtn.addEventListener('click', () => app.active().onKey?.('KeyF'));
    this._viewBtn = ui.querySelector('#tb-view');
    this._viewBtn.addEventListener('click', () => app.active().onKey?.('KeyC'));
    this._actBtn = ui.querySelector('#tb-act');
    this._actBtn.addEventListener('click', () => app.active().onKey?.('KeyE'));
    this._vsEl = ui.querySelector('#vslide');
    // immersion: the controls dim after a few idle seconds, wake on touch
    this._touchUi = ui;
    this._touchIdle = 0;
    window.addEventListener('pointerdown', () => {
      this._touchIdle = 0;
      ui.classList.remove('dim');
    });
    this._touchApp = app;
    this._goT = 0;
  }

  setCrumbs(items) {
    this.crumbs.innerHTML = '';
    items.forEach((it, i) => {
      if (i > 0) {
        const s = document.createElement('span');
        s.className = 'sep'; s.textContent = '▸';
        this.crumbs.appendChild(s);
      }
      const b = document.createElement('button');
      b.className = 'crumb' + (i === items.length - 1 ? ' here' : '');
      b.textContent = it.label;
      if (i < items.length - 1) b.onclick = it.onclick;
      this.crumbs.appendChild(b);
    });
  }

  setStats(pairs) {
    this.stats.innerHTML = pairs
      .map(([k, v]) => `${k} <b>${v}</b>`)
      .join('<br>');
  }

  setHint(text) { this.hints.textContent = text; }
  setNote(html) { this.note.innerHTML = html; }

  /** the land offers up a name and a fragment of its story, or takes it back */
  showDiscovery(name, lore) {
    if (this._dscShown === name) return;
    this._dscShown = name;
    if (!name) { this.discovery.classList.remove('on'); return; }
    this._dscName.textContent = name;
    this._dscLore.textContent = lore ?? '';
    this.discovery.classList.add('on');
  }
  setTime(str, playing) {
    this.readout.textContent = str;
    this.playBtn.textContent = playing ? '⏸' : '▶';
  }

  toggleLog() {
    this.logPanel.classList.toggle('open');
    this.refreshLog();
  }

  toggleControls() {
    this.atlasPanel.classList.remove('open');
    this.logPanel.classList.remove('open');
    this.ctrlPanel.classList.toggle('open');
  }

  toggleAtlas() {
    this.ctrlPanel.classList.remove('open');
    this.logPanel.classList.remove('open');
    this.atlasPanel.classList.toggle('open');
    this.refreshAtlas();
  }

  /** the atlas: this system's worlds, marked places, and a wondrous roll */
  refreshAtlas() {
    if (!this.atlasPanel.classList.contains('open')) return;
    const app = this.app;
    let g = null, sysP = null;
    for (const sc of app.stack) {
      if (sc.kind === 'galaxy') g = sc.ctx.galaxySeed;
      if (sc.kind === 'system') sysP = sc.params;
      if (!sysP && (sc.kind === 'planet' || sc.kind === 'surface' || sc.kind === 'clouds')) sysP = sc.ctx.system;
    }
    let html = '<button class="lb-mark" id="at-rand">✦ somewhere wondrous</button>';
    if (sysP && g) {
      html += `<div class="at-sec">${sysP.name}</div>`;
      sysP.planets.forEach((p, i) => {
        const badge = p.inhabited ? '⌂ ' : '';
        const mood = p.res?.line ? ` · <i>${p.res.line}</i>` : '';
        html += `<div class="lb-row"><button class="lb-go" data-pl="${i}">${badge}${p.name} · ${p.type}${mood}</button></div>`;
      });
    }
    const marks = app.log.filter(e => e.seed === app.seed);
    if (marks.length) {
      html += '<div class="at-sec">marked places</div>';
      marks.forEach((e) => {
        const i = app.log.indexOf(e);
        html += `<div class="lb-row"><button class="lb-go" data-i="${i}">${e.label}</button></div>`;
      });
    }
    this.atlasPanel.innerHTML = html;
    this.atlasPanel.querySelector('#at-rand').onclick = () => this._wondrous();
    this.atlasPanel.querySelectorAll('[data-pl]').forEach(b => {
      b.onclick = () => {
        const i = +b.dataset.pl;
        const p = sysP.planets[i];
        this.atlasPanel.classList.remove('open');
        app.teleport(p.typeId <= 4 ? { g, s: sysP.seed, pl: i } : { g, s: sysP.seed, p: i, cl: 1 });
      };
    });
    this.atlasPanel.querySelectorAll('[data-i]').forEach(b => {
      b.onclick = () => { this.atlasPanel.classList.remove('open'); app.travelTo(+b.dataset.i); };
    });
  }

  /** record an encounter: called by the planet scale when an anchor stands */
  recordFauna(pp, eco, res, wonder) {
    let db = {};
    try { db = JSON.parse(localStorage.getItem('aeon-bestiary-v1') || '{}'); } catch { /* fresh */ }
    const names = faunaNames(pp.seed);
    db[pp.name] = {
      t: pp.type, m: res?.line ?? null, w: wonder ?? null,
      s: eco?.striders ?? 0, k: eco?.skimmers ?? 0,
      sn: names.strider, kn: names.skimmer,
    };
    const keys = Object.keys(db);
    if (keys.length > 200) delete db[keys[0]];
    try { localStorage.setItem('aeon-bestiary-v1', JSON.stringify(db)); } catch { /* full */ }
  }

  toggleBestiary() {
    this.atlasPanel.classList.remove('open');
    this.ctrlPanel.classList.remove('open');
    this.logPanel.classList.remove('open');
    this.beastPanel.classList.toggle('open');
    if (!this.beastPanel.classList.contains('open')) return;
    let db = {};
    try { db = JSON.parse(localStorage.getItem('aeon-bestiary-v1') || '{}'); } catch { /* fresh */ }
    const rows = Object.entries(db);
    let html = '<div class="at-sec">the bestiary</div>';
    if (!rows.length) html += '<div class="lb-empty">nothing met yet — go stand on a world.</div>';
    for (const [world, e] of rows.reverse()) {
      const life = e.s || e.k
        ? `${e.s} ${e.sn} · ${e.k} ${e.kn}`
        : (e.w ?? 'silence');
      html += `<div class="lb-row"><button class="lb-go" disabled>${world} — ${life}${e.m ? ` · <i>${e.m}</i>` : ''}</button></div>`;
    }
    this.beastPanel.innerHTML = html;
  }

  /** roll the dice at the universe: land in orbit of a living world */
  _wondrous() {
    const app = this.app;
    for (let t = 0; t < 80; t++) {
      const g = ((Math.random() * 2 ** 31) | 0) || 1;
      const s = ((Math.random() * 2 ** 31) | 0) || 1;
      const i = systemParams(s).planets.findIndex(p => p.inhabited);
      if (i >= 0) {
        this.atlasPanel.classList.remove('open');
        app.teleport({ g, s, pl: i });
        return;
      }
    }
  }

  refreshLog() {
    if (!this.logPanel.classList.contains('open')) return;
    const log = this.app.log;
    let html = '<button class="lb-mark" id="lb-mark">⊕ mark this place</button>';
    if (!log.length) html += '<div class="lb-empty">nowhere yet — go somewhere first.</div>';
    log.forEach((e, i) => {
      html += `<div class="lb-row"><button class="lb-go" data-i="${i}">${e.label}</button>` +
        `<button class="lb-x" data-i="${i}" title="forget">×</button></div>`;
    });
    this.logPanel.innerHTML = html;
    this.logPanel.querySelector('#lb-mark').onclick = () => this.app.markPlace();
    this.logPanel.querySelectorAll('.lb-go').forEach(b => { b.onclick = () => this.app.travelTo(+b.dataset.i); });
    this.logPanel.querySelectorAll('.lb-x').forEach(b => { b.onclick = () => this.app.removePlace(+b.dataset.i); });
  }

  setMuted(m) {
    this.muteBtn.textContent = m ? '∅' : '♪';
    this.muteBtn.style.opacity = m ? 0.45 : 1;
  }

  showCard({ title, kind, rows, flavor, action, actions }) {
    this.app.audio?.blip();
    const acts = actions || (action ? [action] : []);
    let html = `<h2>${title}</h2><div class="kind">${kind}</div><dl>`;
    for (const [k, v] of rows) html += `<dt>${k}</dt><dd>${v}</dd>`;
    html += '</dl>';
    if (flavor) html += `<div class="flavor">${flavor}</div>`;
    if (acts.length) {
      html += '<div class="act">' +
        acts.map((a, i) => `<button id="card-act-${i}" style="margin-right:8px">${a.label}</button>`).join('') +
        '</div>';
    }
    this.card.innerHTML = html;
    this.card.classList.add('open');
    acts.forEach((a, i) => { this.card.querySelector(`#card-act-${i}`).onclick = a.cb; });
  }
  hideCard() { this.card.classList.remove('open'); }

  /** flash of atmospheric haze that clears as you break through the deck */
  veil(color) {
    const el = this.veilEl;
    const c = color.isColor
      ? `rgb(${(color.r * 620) | 0},${(color.g * 620) | 0},${(color.b * 620) | 0})`
      : color;
    el.style.transition = 'none';
    el.style.background = c;
    el.style.opacity = '0.96';
    void el.offsetWidth; // commit, then fade
    el.style.transition = 'opacity 1.5s ease-out';
    el.style.opacity = '0';
  }

  /** fade to black, do the thing, fade back */
  warp(swap) {
    this.warpEl.classList.add('on');
    setTimeout(() => {
      swap();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        this.warpEl.classList.remove('on');
      }));
    }, 300);
  }

  tick(dt) {
    this._idleT += dt;
    if (this._idleT > 6) this.hints.classList.add('faded');
    if (this._touchUi && (this._touchIdle += dt) > 4) this._touchUi.classList.add('dim');
    // the context button wears its current meaning
    if (this._goBtn && (this._goT += dt) > 0.4) {
      this._goT = 0;
      const s = this._touchApp.active();
      this._goBtn.textContent = s.kind !== 'planet' ? '➤'
        : (s.auto || s.asc) ? '✕'
        : (s.altUnits ?? 9e9) < s.R * 0.9 ? '⤴' : '⛯';
      this._goBtn.title = s.kind !== 'planet' ? 'tour'
        : (s.auto || s.asc) ? 'take the helm'
        : (s.altUnits ?? 9e9) < s.R * 0.9 ? 'back to orbit' : 'fly me down';
      this._shBtn.style.display = s.kind === 'planet' && s.pp?.inhabited ? '' : 'none';
      this._shBtn.textContent = s.ride ? '✕' : s.inside ? '⌂' : (s.altUnits ?? 9e9) < 6 ? '⇴' : '⌂';
      this._shBtn.title = s.ride ? 'bail out' : s.inside ? 'shuttle home'
        : (s.altUnits ?? 9e9) < 6 ? 'shuttle to the station' : 'shuttle home';
      // the ground gets its trio; the climb slider belongs to the sky scenes
      const surf = s.kind === 'surface';
      this._flyBtn.style.display = surf ? '' : 'none';
      this._viewBtn.style.display = surf ? '' : 'none';
      this._actBtn.style.display = surf ? '' : 'none';
      if (surf) this._actBtn.textContent = s.traveler?.riding ? '✕' : '⛵';
      this._vsEl.style.display = surf ? 'none' : '';
    }
  }
}
