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
      <button id="t-slow" title="slower">−</button>
      <button id="t-play" title="pause / play">⏸</button>
      <button id="t-fast" title="faster">+</button>`;
    this.readout = this.timectl.querySelector('#time-readout');
    this.playBtn = this.timectl.querySelector('#t-play');
    this.timectl.querySelector('#t-slow').onclick = () => app.active()?.slowDown?.();
    this.timectl.querySelector('#t-fast').onclick = () => app.active()?.speedUp?.();
    this.playBtn.onclick = () => { app.active()?.togglePlay?.(); };

    this.science = el('div', 'science');
    const sciBtn = document.createElement('button');
    sciBtn.textContent = 'i';
    sciBtn.title = 'the science of this scale';
    this.note = document.createElement('div');
    this.note.className = 'note';
    this.science.appendChild(sciBtn);
    this.science.appendChild(this.note);
    sciBtn.onclick = () => this.note.classList.toggle('open');

    this.warpEl = document.getElementById('warp');

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

  showCard({ title, kind, rows, flavor, action, actions }) {
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
