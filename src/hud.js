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
  }
}
