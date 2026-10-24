// Tiny WebAudio synth: all sound is generated, no assets.
const SAFE = (fn) => {
  try {
    fn();
  } catch {
    /* audio is never allowed to break the game */
  }
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = this._readMuted();
    this.ready = false;
  }

  _readMuted() {
    try {
      return localStorage.getItem('sistalagan.muted') === '1';
    } catch {
      return false;
    }
  }

  _saveMuted() {
    try {
      localStorage.setItem('sistalagan.muted', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  init() {
    if (this.ready) return;
    SAFE(() => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
      this.ready = true;
    });
  }

  resume() {
    SAFE(() => {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    });
  }

  toggleMute() {
    this.muted = !this.muted;
    this._saveMuted();
    SAFE(() => {
      if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    });
    return this.muted;
  }

  _env(node, gain, attack, hold, release) {
    const t = this.ctx.currentTime;
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(gain, t + attack);
    node.gain.setValueAtTime(gain, t + attack + hold);
    node.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  }

  tone({ type = 'sine', freq = 440, freq2 = null, dur = 0.2, gain = 0.2, attack = 0.005, release = 0.18, delay = 0 }) {
    if (!this.ready || this.muted) return;
    SAFE(() => {
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + release + 0.05);
    });
  }

  noise({ dur = 0.2, gain = 0.2, filter = 1200, delay = 0, q = 1 }) {
    if (!this.ready || this.muted) return;
    SAFE(() => {
      const t = this.ctx.currentTime + delay;
      const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = filter;
      bp.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      src.connect(bp).connect(g).connect(this.master);
      src.start(t);
    });
  }

  swing() {
    this.noise({ dur: 0.16, gain: 0.16, filter: 900, q: 0.7 });
    this.tone({ type: 'triangle', freq: 320, freq2: 180, dur: 0.1, gain: 0.06, release: 0.08 });
  }

  hit() {
    this.noise({ dur: 0.14, gain: 0.3, filter: 420, q: 0.8 });
    this.tone({ type: 'square', freq: 150, freq2: 70, dur: 0.1, gain: 0.1, release: 0.1 });
  }

  parry() {
    this.tone({ type: 'triangle', freq: 1400, freq2: 2400, dur: 0.12, gain: 0.16, release: 0.25 });
    this.tone({ type: 'sine', freq: 880, freq2: 1320, dur: 0.2, gain: 0.1, release: 0.3, delay: 0.02 });
    this.noise({ dur: 0.1, gain: 0.14, filter: 3200, q: 1.2 });
  }

  block() {
    this.noise({ dur: 0.1, gain: 0.18, filter: 700, q: 1.4 });
  }

  hurt() {
    this.tone({ type: 'sawtooth', freq: 220, freq2: 90, dur: 0.2, gain: 0.12, release: 0.2 });
    this.noise({ dur: 0.18, gain: 0.12, filter: 500 });
  }

  die() {
    this.tone({ type: 'sawtooth', freq: 180, freq2: 50, dur: 0.6, gain: 0.12, release: 0.5 });
  }

  fire() {
    this.noise({ dur: 0.35, gain: 0.16, filter: 1100, q: 0.4 });
    this.tone({ type: 'sine', freq: 420, freq2: 240, dur: 0.3, gain: 0.06 });
  }

  lightBrazier() {
    this.noise({ dur: 0.5, gain: 0.2, filter: 800, q: 0.5 });
    [392, 494, 587].forEach((f, i) =>
      this.tone({ type: 'sine', freq: f, dur: 0.3, gain: 0.07, release: 0.5, delay: i * 0.09 }),
    );
  }

  pickup() {
    [659, 784, 988].forEach((f, i) =>
      this.tone({ type: 'triangle', freq: f, dur: 0.14, gain: 0.09, release: 0.25, delay: i * 0.07 }),
    );
  }

  ui() {
    this.tone({ type: 'sine', freq: 520, dur: 0.07, gain: 0.05, release: 0.1 });
  }

  door() {
    this.noise({ dur: 0.5, gain: 0.14, filter: 260, q: 0.6 });
    this.tone({ type: 'sine', freq: 120, freq2: 70, dur: 0.4, gain: 0.08 });
  }

  bossRoar() {
    this.tone({ type: 'sawtooth', freq: 90, freq2: 45, dur: 1.2, gain: 0.18, release: 1 });
    this.noise({ dur: 1.1, gain: 0.16, filter: 320, q: 0.5 });
  }

  win() {
    [523, 659, 784, 1046, 1318].forEach((f, i) =>
      this.tone({ type: 'triangle', freq: f, dur: 0.4, gain: 0.1, release: 0.9, delay: i * 0.16 }),
    );
  }
}
