// Synthesised sound effects — no audio files.

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.muted = localStorage.getItem('spell.muted') === '1';
    this._last = {};
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
    this.master.gain.value = this.muted ? 0 : 0.42;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return this.ctx;
  }

  ready() {
    this._ensure();
  }

  toggle() {
    this.muted = !this.muted;
    localStorage.setItem('spell.muted', this.muted ? '1' : '0');
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.42, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  _throttle(name, ms) {
    const now = performance.now();
    if (this._last[name] && now - this._last[name] < ms) return false;
    this._last[name] = now;
    return true;
  }

  _tone({ freq = 440, to = null, type = 'sine', dur = 0.2, gain = 0.18, delay = 0, attack = 0.006 }) {
    const ctx = this._ensure();
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.04);
  }

  _noise({ dur = 0.25, gain = 0.15, filter = 900, q = 1, sweepTo = null, delay = 0, type = 'bandpass' }) {
    const ctx = this._ensure();
    if (!ctx || this.muted || !this.noise) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(filter, t0);
    f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  swing() {
    this._noise({ dur: 0.16, gain: 0.1, filter: 1800, sweepTo: 5200, q: 0.9 });
  }

  hit() {
    if (!this._throttle('hit', 40)) return;
    this._tone({ freq: 300, to: 120, type: 'square', dur: 0.09, gain: 0.1 });
    this._noise({ dur: 0.12, gain: 0.12, filter: 2400, sweepTo: 500, q: 0.7 });
  }

  kill() {
    if (!this._throttle('kill', 50)) return;
    this._noise({ dur: 0.28, gain: 0.1, filter: 1200, sweepTo: 180, q: 0.6 });
    this._tone({ freq: 220, to: 70, type: 'triangle', dur: 0.22, gain: 0.06 });
  }

  hurt() {
    this._tone({ freq: 180, to: 58, type: 'sawtooth', dur: 0.4, gain: 0.18 });
    this._noise({ dur: 0.3, gain: 0.14, filter: 700, sweepTo: 140 });
  }

  jump() {
    if (!this._throttle('jump', 90)) return;
    this._tone({ freq: 380, to: 620, type: 'triangle', dur: 0.11, gain: 0.06 });
  }

  doubleJump() {
    this._tone({ freq: 620, to: 1180, type: 'sine', dur: 0.18, gain: 0.08 });
    this._noise({ dur: 0.16, gain: 0.06, filter: 2600, sweepTo: 5200 });
  }

  land() {
    if (!this._throttle('land', 140)) return;
    this._noise({ dur: 0.12, gain: 0.07, filter: 420, sweepTo: 180, q: 0.8 });
  }

  dash() {
    this._noise({ dur: 0.24, gain: 0.13, filter: 900, sweepTo: 4200, q: 1.1 });
    this._tone({ freq: 260, to: 720, type: 'sine', dur: 0.16, gain: 0.05 });
  }

  spit() {
    if (!this._throttle('spit', 90)) return;
    this._tone({ freq: 520, to: 220, type: 'sine', dur: 0.16, gain: 0.06 });
  }

  roar() {
    this._tone({ freq: 120, to: 46, type: 'sawtooth', dur: 0.9, gain: 0.16 });
    this._noise({ dur: 0.8, gain: 0.1, filter: 320, sweepTo: 90, q: 0.9 });
  }

  spell() {
    this._tone({ freq: 520, to: 1240, type: 'sine', dur: 0.3, gain: 0.1 });
    this._tone({ freq: 780, to: 1860, type: 'triangle', dur: 0.24, gain: 0.05, delay: 0.02 });
    this._noise({ dur: 0.3, gain: 0.08, filter: 1800, sweepTo: 5200, q: 1.2 });
  }

  spellHit() {
    if (!this._throttle('spellhit', 60)) return;
    this._tone({ freq: 900, to: 300, type: 'triangle', dur: 0.16, gain: 0.08 });
    this._noise({ dur: 0.2, gain: 0.1, filter: 3000, sweepTo: 700 });
  }

  noSoul() {
    if (!this._throttle('nosoul', 320)) return;
    this._tone({ freq: 180, to: 130, type: 'sine', dur: 0.12, gain: 0.05 });
  }

  bench() {
    [523.25, 659.25, 783.99].forEach((f, i) =>
      this._tone({ freq: f, type: 'sine', dur: 1.1, gain: 0.055, delay: i * 0.12, attack: 0.06 }),
    );
  }

  death() {
    this._tone({ freq: 300, to: 40, type: 'sawtooth', dur: 1.4, gain: 0.15 });
    this._noise({ dur: 1.2, gain: 0.12, filter: 900, sweepTo: 80 });
  }

  win() {
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
      this._tone({ freq: f, type: 'sine', dur: 1.6, gain: 0.06, delay: i * 0.16, attack: 0.05 }),
    );
  }

  click() {
    this._tone({ freq: 640, to: 880, type: 'sine', dur: 0.08, gain: 0.05 });
  }
}
