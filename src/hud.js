// The interface: a few hairlines of type floating over the void.
// Everything fades; the universe is the UI.

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
      <div id="tbtns">
        <button id="tb-up" title="climb">▲</button>
        <button id="tb-down" title="dive">▼</button>
        <button id="tb-boost" title="boost">≫</button>
        <button id="tb-go" title="fly me there">⛯</button>
        <button id="tb-help" title="controls">?</button>
      </div>
      <div id="touchhelp">
        <b>touch controls</b><br>
        drag — look around<br>
        pinch — altitude &amp; zoom<br>
        stick — walk &amp; fly<br>
        ▲ ▼ — climb &amp; dive · ≫ — boost<br>
        ⛯ — fly me down · back to orbit<br>
        tap a world — approach it<br>
        double-tap — dive deeper</div>`;
    document.body.appendChild(ui);

    const key = (code, on) =>
      window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code }));

    // hold-buttons: press is keydown, release is keyup
    const hold = (id, code) => {
      const b = ui.querySelector(id);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); key(code, true); });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
        b.addEventListener(ev, () => key(code, false));
      }
    };
    hold('#tb-up', 'KeyR');
    hold('#tb-down', 'KeyF');
    hold('#tb-boost', 'ShiftLeft');

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
  setTime(str, playing) {
    this.readout.textContent = str;
    this.playBtn.textContent = playing ? '⏸' : '▶';
  }

  toggleLog() {
    this.logPanel.classList.toggle('open');
    this.refreshLog();
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
    }
  }
}
