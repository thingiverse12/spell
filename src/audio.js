// Small WebAudio synth. No samples, no dependencies — every sound is built
// from oscillators and noise so the game stays a single folder of text files.

const NOTE = (semi) => 440 * Math.pow(2, semi / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = this._readMuted();
    this.master = null;
    this.noiseBuffer = null;
  }

  _readMuted() {
    try {
      return localStorage.getItem('sista-lagan-muted') === '1';
    } catch {
      return false;
    }
  }

  _saveMuted() {
    try {
      localStorage.setItem('sista-lagan-muted', this.muted ? '1' : '0');
    } catch {
      /* private mode */
    }
  }

  toggle() {
    this.muted = !this.muted;
    this._saveMuted();
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      this.ctx = new AC();
    } catch {
      return null;
    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);

    // One second of noise, reused for every percussive sound.
    const len = Math.floor(this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return this.ctx;
  }

  _tone(freq, dur, type = 'sine', gain = 0.12, slide = 0, delay = 0) {
    const ctx = this.ensure();
    if (!ctx || this.muted) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.3));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  _noise(dur, gain = 0.16, filter = 1200, delay = 0) {
    const ctx = this.ensure();
    if (!ctx || this.muted || !this.noiseBuffer) return;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = filter;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur);
  }

  step() {
    this._noise(0.05, 0.04, 420 + Math.random() * 120);
  }

  sword() {
    this._noise(0.16, 0.15, 2600);
    this._tone(NOTE(19), 0.12, 'triangle', 0.05, -200);
  }

  hit() {
    this._noise(0.12, 0.2, 900);
    this._tone(NOTE(-12), 0.16, 'square', 0.08, -60);
  }

  parry() {
    this._tone(NOTE(31), 0.1, 'square', 0.08, 120);
    this._tone(NOTE(38), 0.18, 'triangle', 0.07, 90, 0.02);
  }

  perfectParry() {
    this._tone(NOTE(31), 0.14, 'square', 0.09, 220);
    this._tone(NOTE(38), 0.26, 'triangle', 0.09, 300, 0.04);
    this._tone(NOTE(43), 0.34, 'sine', 0.07, 120, 0.08);
    this._noise(0.2, 0.1, 3400);
  }

  block() {
    this._noise(0.1, 0.18, 1500);
  }

  hurt() {
    this._tone(NOTE(-5), 0.3, 'sawtooth', 0.1, -120);
    this._noise(0.22, 0.14, 700);
  }

  die() {
    this._tone(NOTE(-17), 0.8, 'sine', 0.12, -40);
    this._tone(NOTE(-12), 0.9, 'triangle', 0.08, -60, 0.06);
  }

  ignite() {
    this._noise(0.42, 0.14, 700);
    this._tone(NOTE(12), 0.3, 'sine', 0.07, 180);
    this._tone(NOTE(19), 0.5, 'sine', 0.05, 90, 0.04);
  }

  placeLantern() {
    this._tone(NOTE(24), 0.16, 'sine', 0.08, 60);
    this._tone(NOTE(31), 0.3, 'sine', 0.05, 40, 0.05);
  }

  bow() {
    this._noise(0.09, 0.1, 2200);
    this._tone(NOTE(26), 0.16, 'triangle', 0.05, -320);
  }

  bomb() {
    this._noise(0.55, 0.3, 320);
    this._tone(NOTE(-19), 0.5, 'sawtooth', 0.14, -50);
  }

  pickup() {
    this._tone(NOTE(24), 0.12, 'triangle', 0.07);
    this._tone(NOTE(31), 0.22, 'triangle', 0.06, 0, 0.06);
  }

  talk() {
    this._tone(NOTE(14) + Math.random() * 30, 0.05, 'square', 0.025);
  }

  buy() {
    this._tone(NOTE(19), 0.1, 'square', 0.06);
    this._tone(NOTE(26), 0.12, 'square', 0.05, 0, 0.07);
    this._tone(NOTE(31), 0.2, 'sine', 0.05, 0, 0.14);
  }

  gate() {
    this._noise(0.7, 0.12, 260);
    this._tone(NOTE(-7), 0.7, 'sine', 0.08, 40);
  }

  bossRoar() {
    this._tone(NOTE(-24), 1.1, 'sawtooth', 0.12, 30);
    this._tone(NOTE(-17), 1.3, 'triangle', 0.07, -20, 0.1);
    this._noise(1.0, 0.1, 200);
  }

  win() {
    [0, 4, 7, 12, 16, 19].forEach((s, i) => this._tone(NOTE(s), 0.5, 'triangle', 0.08, 0, i * 0.13));
  }

  click() {
    this._tone(NOTE(21), 0.04, 'square', 0.03);
  }
}
