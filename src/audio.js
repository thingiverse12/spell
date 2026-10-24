// Synthesised sound for the dusk forest. No audio files.

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this.muted = this._readMuted();
    this._last = {};
    this.chargeOsc = null;
    this.chargeGain = null;
  }

  _readMuted() {
    try {
      return localStorage.getItem('lykt.muted') === '1';
    } catch {
      return false;
    }
  }

  _saveMuted() {
    try {
      localStorage.setItem('lykt.muted', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
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
    this.master.gain.value = this.muted ? 0 : 0.4;
    this.master.connect(this.ctx.destination);
    const len = Math.floor(this.ctx.sampleRate * 1.2);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return this.ctx;
  }

  ready() {
    this._ensure();
  }

  toggle() {
    this.muted = !this.muted;
    this._saveMuted();
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.4, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  _throttle(name, ms) {
    const now = performance.now();
    if (this._last[name] && now - this._last[name] < ms) return false;
    this._last[name] = now;
    return true;
  }

  _tone({ freq = 440, to = null, type = 'sine', dur = 0.2, gain = 0.16, delay = 0, attack = 0.008 }) {
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

  _noise({ dur = 0.25, gain = 0.12, filter = 900, q = 1, sweepTo = null, delay = 0 }) {
    const ctx = this._ensure();
    if (!ctx || this.muted || !this.noise) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(filter, t0);
    f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.03);
  }

  jump() {
    if (!this._throttle('jump', 80)) return;
    this._tone({ freq: 300, to: 520, type: 'triangle', dur: 0.12, gain: 0.05 });
  }

  jump2() {
    this._tone({ freq: 520, to: 940, type: 'sine', dur: 0.18, gain: 0.06 });
    this._noise({ dur: 0.16, gain: 0.04, filter: 2400, sweepTo: 4800 });
  }

  land() {
    if (!this._throttle('land', 140)) return;
    this._noise({ dur: 0.12, gain: 0.05, filter: 380, q: 0.8 });
  }

  /** Rising hum while the staff charges. */
  chargeStart() {
    const ctx = this._ensure();
    if (!ctx || this.muted) return;
    this.chargeStop();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 220;
    g.gain.value = 0.0001;
    g.gain.exponentialRampToValueAtTime(0.035, ctx.currentTime + 0.1);
    osc.connect(g).connect(this.master);
    osc.start();
    this.chargeOsc = osc;
    this.chargeGain = g;
  }

  chargeUpdate(t) {
    if (!this.chargeOsc || !this.ctx) return;
    this.chargeOsc.frequency.setTargetAtTime(220 + t * 660, this.ctx.currentTime, 0.05);
  }

  chargeStop() {
    if (!this.chargeOsc || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.chargeGain.gain.setTargetAtTime(0.0001, now, 0.03);
    this.chargeOsc.stop(now + 0.12);
    this.chargeOsc = null;
    this.chargeGain = null;
  }

  cast(tier) {
    this.chargeStop();
    if (tier === 'push') {
      this._tone({ freq: 620, to: 1080, type: 'sine', dur: 0.16, gain: 0.08 });
      this._noise({ dur: 0.14, gain: 0.05, filter: 2200, sweepTo: 4200 });
    } else if (tier === 'beam') {
      this._tone({ freq: 880, to: 1900, type: 'triangle', dur: 0.26, gain: 0.09 });
      this._noise({ dur: 0.3, gain: 0.09, filter: 1800, sweepTo: 5200, q: 1.3 });
    } else {
      this._tone({ freq: 180, to: 60, type: 'sawtooth', dur: 0.45, gain: 0.14 });
      this._noise({ dur: 0.5, gain: 0.14, filter: 600, sweepTo: 2600, q: 0.7 });
    }
  }

  lamp() {
    this._tone({ freq: 520, to: 780, type: 'sine', dur: 0.4, gain: 0.07 });
    this._tone({ freq: 1040, type: 'sine', dur: 0.6, gain: 0.04, delay: 0.06 });
    this._noise({ dur: 0.3, gain: 0.05, filter: 3000, sweepTo: 900 });
  }

  burn() {
    this._noise({ dur: 0.5, gain: 0.11, filter: 1600, sweepTo: 300, q: 0.6 });
    this._tone({ freq: 240, to: 90, type: 'triangle', dur: 0.4, gain: 0.06 });
  }

  gate() {
    [262, 392, 523].forEach((f, i) => this._tone({ freq: f, type: 'sine', dur: 0.9, gain: 0.05, delay: i * 0.1, attack: 0.05 }));
    this._noise({ dur: 0.6, gain: 0.06, filter: 700, sweepTo: 2400 });
  }

  shard() {
    [523, 659, 880, 1174].forEach((f, i) => this._tone({ freq: f, type: 'sine', dur: 1.3, gain: 0.06, delay: i * 0.11, attack: 0.04 }));
  }

  hurt() {
    this._tone({ freq: 200, to: 60, type: 'sawtooth', dur: 0.4, gain: 0.16 });
    this._noise({ dur: 0.3, gain: 0.1, filter: 700, sweepTo: 160 });
  }

  die() {
    this._tone({ freq: 260, to: 40, type: 'sawtooth', dur: 1.3, gain: 0.14 });
    this._noise({ dur: 1.1, gain: 0.1, filter: 800, sweepTo: 90 });
  }

  mirror() {
    this._tone({ freq: 740, to: 980, type: 'sine', dur: 0.14, gain: 0.06 });
    this._noise({ dur: 0.18, gain: 0.03, filter: 4000, q: 2 });
  }

  echo(kind) {
    if (kind === 'record') this._tone({ freq: 400, to: 800, type: 'sine', dur: 0.5, gain: 0.06 });
    else [660, 880, 660].forEach((f, i) => this._tone({ freq: f, type: 'sine', dur: 0.3, gain: 0.05, delay: i * 0.12 }));
  }

  rest() {
    [392, 523, 659].forEach((f, i) => this._tone({ freq: f, type: 'sine', dur: 1.2, gain: 0.05, delay: i * 0.14, attack: 0.06 }));
  }

  midge() {
    if (!this._throttle('midge', 60)) return;
    this._noise({ dur: 0.18, gain: 0.06, filter: 3200, sweepTo: 600, q: 2 });
  }

  click() {
    this._tone({ freq: 620, to: 840, type: 'sine', dur: 0.08, gain: 0.04 });
  }

  win() {
    [392, 523, 659, 784, 1046].forEach((f, i) => this._tone({ freq: f, type: 'sine', dur: 2, gain: 0.055, delay: i * 0.18, attack: 0.06 }));
  }
}
