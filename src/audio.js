// Tiny synthesised sound engine — no asset files needed.

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = localStorage.getItem('spell.muted') === '1';
    this.noise = null;
    this._lastAt = {};
  }

  _ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    const len = Math.floor(this.ctx.sampleRate * 0.9);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return this.ctx;
  }

  ready() {
    this._ensure();
  }

  setMuted(muted) {
    this.muted = muted;
    localStorage.setItem('spell.muted', muted ? '1' : '0');
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
    }
  }

  toggle() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _throttle(name, ms) {
    const now = performance.now();
    if (this._lastAt[name] && now - this._lastAt[name] < ms) return false;
    this._lastAt[name] = now;
    return true;
  }

  _tone({ freq = 440, to = null, type = 'sine', dur = 0.18, gain = 0.2, delay = 0, attack = 0.005, curve = 'exp' }) {
    const ctx = this._ensure();
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to !== null) {
      if (curve === 'exp') osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
      else osc.frequency.linearRampToValueAtTime(Math.max(20, to), t0 + dur);
    }
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  _noise({ dur = 0.25, gain = 0.18, delay = 0, filter = 900, q = 1, sweepTo = null }) {
    const ctx = this._ensure();
    if (!ctx || this.muted || !this.noise) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(filter, t0);
    bp.Q.value = q;
    if (sweepTo) bp.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  bolt() {
    if (!this._throttle('bolt', 70)) return;
    this._tone({ freq: 1180, to: 620, type: 'triangle', dur: 0.1, gain: 0.075 });
    this._noise({ dur: 0.07, gain: 0.035, filter: 2600, q: 2 });
  }

  fireball() {
    this._noise({ dur: 0.32, gain: 0.13, filter: 320, sweepTo: 1500, q: 0.8 });
    this._tone({ freq: 210, to: 90, type: 'sawtooth', dur: 0.28, gain: 0.09 });
  }

  frost() {
    [880, 1320, 1760].forEach((f, i) =>
      this._tone({ freq: f, to: f * 0.6, type: 'sine', dur: 0.42, gain: 0.075, delay: i * 0.035 }),
    );
    this._noise({ dur: 0.5, gain: 0.06, filter: 4200, sweepTo: 1200, q: 1.4 });
  }

  chain() {
    this._noise({ dur: 0.26, gain: 0.14, filter: 3400, sweepTo: 700, q: 0.9 });
    this._tone({ freq: 1500, to: 260, type: 'square', dur: 0.2, gain: 0.055 });
  }

  blink() {
    this._tone({ freq: 320, to: 1400, type: 'sine', dur: 0.2, gain: 0.1 });
    this._noise({ dur: 0.2, gain: 0.07, filter: 900, sweepTo: 3200 });
  }

  hit() {
    if (!this._throttle('hit', 40)) return;
    this._tone({ freq: 420, to: 180, type: 'square', dur: 0.06, gain: 0.04 });
  }

  kill() {
    if (!this._throttle('kill', 45)) return;
    this._noise({ dur: 0.16, gain: 0.07, filter: 700, sweepTo: 200 });
    this._tone({ freq: 240, to: 90, type: 'triangle', dur: 0.14, gain: 0.05 });
  }

  hurt() {
    this._tone({ freq: 150, to: 62, type: 'sawtooth', dur: 0.34, gain: 0.16 });
    this._noise({ dur: 0.22, gain: 0.1, filter: 420, sweepTo: 120 });
  }

  pickup() {
    this._tone({ freq: 880, to: 1560, type: 'sine', dur: 0.14, gain: 0.08 });
  }

  wave() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
      this._tone({ freq: f, type: 'triangle', dur: 0.5, gain: 0.055, delay: i * 0.075, attack: 0.02 }),
    );
  }

  upgrade() {
    [659.25, 987.77, 1318.5].forEach((f, i) =>
      this._tone({ freq: f, type: 'sine', dur: 0.35, gain: 0.075, delay: i * 0.06 }),
    );
  }

  death() {
    this._tone({ freq: 320, to: 48, type: 'sawtooth', dur: 1.3, gain: 0.16, curve: 'exp' });
    this._noise({ dur: 1.1, gain: 0.12, filter: 700, sweepTo: 90 });
  }

  click() {
    this._tone({ freq: 660, to: 880, type: 'sine', dur: 0.08, gain: 0.05 });
  }

  noMana() {
    if (!this._throttle('mana', 260)) return;
    this._tone({ freq: 200, to: 140, type: 'square', dur: 0.1, gain: 0.045 });
  }
}
