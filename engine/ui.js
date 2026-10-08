// DOM user interface: dialogue box with typewriter text, choices, toasts, modal panels
// and the HUD. All player- and author-written text goes through textContent, never as
// HTML markup, so community content cannot inject elements or scripts.

export const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class UI {
  constructor() {
    this.dialog = document.getElementById('dialog');
    this.dialogName = document.getElementById('dialog-name');
    this.dialogText = document.getElementById('dialog-text');
    this.dialogChoices = document.getElementById('dialog-choices');
    this.toasts = document.getElementById('toasts');
    this.modal = document.getElementById('modal');
    this.hudPlace = document.getElementById('hud-place');
    this.hudCoords = document.getElementById('hud-coords');
    this.hudClock = document.getElementById('hud-clock');
    this.advance = null;
    this.choiceKeys = null;
    this.dialog.addEventListener('click', () => this.next());
  }

  get open() { return !this.dialog.hidden || !this.modal.hidden; }

  /** Space / Enter / E / click: finish the line or move on. */
  next() {
    if (this.advance) this.advance();
  }

  key(e) {
    if (this.choiceKeys) return this.choiceKeys(e);
    if (!this.dialog.hidden && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyE')) {
      e.preventDefault();
      this.next();
      return true;
    }
    if (!this.modal.hidden && e.code === 'Escape') { this.closeModal(); return true; }
    return false;
  }

  type(text) {
    return new Promise(resolve => {
      this.dialogText.textContent = '';
      let i = 0;
      const timer = setInterval(() => {
        i += 2;
        this.dialogText.textContent = text.slice(0, i);
        if (i >= text.length) { clearInterval(timer); this.advance = null; resolve(); }
      }, 16);
      this.advance = () => { clearInterval(timer); this.dialogText.textContent = text; this.advance = null; resolve(); };
    });
  }

  async say(text, who) {
    this.dialog.hidden = false;
    this.dialogChoices.replaceChildren();
    this.dialogName.textContent = who || '';
    this.dialogName.hidden = !who;
    await this.type(String(text));
    this.dialog.classList.add('waiting');
    await new Promise(r => { this.advance = () => { this.advance = null; r(); }; });
    this.dialog.classList.remove('waiting');
    this.dialog.hidden = true;
  }

  async choose(text, options, who) {
    this.dialog.hidden = false;
    this.dialogName.textContent = who || '';
    this.dialogName.hidden = !who;
    this.dialogChoices.replaceChildren();
    await this.type(String(text));
    return new Promise(resolve => {
      let sel = 0;
      const buttons = options.map((o, i) => {
        const b = el('button', 'choice', o);
        b.onclick = ev => { ev.stopPropagation(); done(i); };
        this.dialogChoices.appendChild(b);
        return b;
      });
      const mark = () => buttons.forEach((b, i) => b.classList.toggle('sel', i === sel));
      mark();
      const done = i => {
        this.choiceKeys = null;
        this.dialogChoices.replaceChildren();
        this.dialog.hidden = true;
        resolve(i);
      };
      this.choiceKeys = e => {
        if (e.code === 'ArrowDown' || e.code === 'KeyS') sel = (sel + 1) % buttons.length;
        else if (e.code === 'ArrowUp' || e.code === 'KeyW') sel = (sel - 1 + buttons.length) % buttons.length;
        else if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyE') { done(sel); }
        else if (/^Digit[1-6]$/.test(e.code) && +e.code.slice(5) <= buttons.length) done(+e.code.slice(5) - 1);
        else return false;
        e.preventDefault();
        mark();
        return true;
      };
    });
  }

  toast(text) {
    const t = el('div', 'toast', text);
    this.toasts.appendChild(t);
    setTimeout(() => t.classList.add('out'), 2600);
    setTimeout(() => t.remove(), 3100);
  }

  showModal(title, body, actions = []) {
    this.modal.replaceChildren();
    const card = el('div', 'modal-card');
    const head = el('div', 'modal-head');
    head.appendChild(el('h2', '', title));
    const close = el('button', 'icon-btn', '×');
    close.setAttribute('aria-label', 'Close');
    close.onclick = () => this.closeModal();
    head.appendChild(close);
    card.appendChild(head);
    const content = el('div', 'modal-body');
    content.appendChild(body);
    card.appendChild(content);
    if (actions.length) {
      const foot = el('div', 'modal-foot');
      for (const a of actions) {
        const b = el('button', 'btn' + (a.primary ? ' accent' : ''), a.label);
        b.onclick = a.onClick;
        foot.appendChild(b);
      }
      card.appendChild(foot);
    }
    this.modal.appendChild(card);
    this.modal.hidden = false;
    this.modal.onclick = e => { if (e.target === this.modal) this.closeModal(); };
  }

  closeModal() {
    this.modal.hidden = true;
    this.modal.replaceChildren();
  }

  hud(place, x, y, timeOfDay) {
    const name = place?.name || 'Wilderness';
    if (this.hudPlace.textContent !== name) {
      this.hudPlace.textContent = name;
      if (place) this.toast(`Entering ${name}`);
    }
    this.hudCoords.textContent = `${x}, ${y}`;
    const mins = Math.floor(timeOfDay * 24 * 60);
    this.hudClock.textContent = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  }
}
