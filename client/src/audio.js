/**
 * Spell - procedural audio.
 *
 * The report's asset pipeline wants OGG + HRTF samples, but a prototype with
 * zero downloaded assets can still sound alive: everything here is synthesised
 * with the Web Audio API (noise bursts, filtered thuds, a wind bed).
 */

import { settings } from './settings.js';

let ctx = null;
let master = null;
let ambient = null;
let ambientGain = null;
let enabled = true;

export function initAudio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = settings.sound ? 0.75 : 0;
  master.connect(ctx.destination);
  startAmbient();
  return ctx;
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function setAudioEnabled(on) {
  enabled = on;
  if (master) master.gain.value = on ? 0.75 : 0;
}

function noiseBuffer(seconds = 1) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/** Continuous wind/forest bed; volume follows the time of day. */
function startAmbient() {
  if (!ctx) return;
  ambient = ctx.createBufferSource();
  ambient.buffer = noiseBuffer(4);
  ambient.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  ambientGain = ctx.createGain();
  ambientGain.gain.value = 0.05;
  ambient.connect(lp).connect(ambientGain).connect(master);
  ambient.start();
}

export function setAmbient(level) {
  if (ambientGain) ambientGain.gain.value = enabled ? Math.max(0, Math.min(0.16, level)) : 0;
}

function burst({ freq = 300, q = 1, dur = 0.16, type = 'lowpass', gain = 0.35, decay = 0.16 }) {
  if (!ctx || !enabled) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(Math.max(0.2, dur + 0.05));
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + decay);
  src.connect(filter).connect(g).connect(master);
  src.start();
  src.stop(ctx.currentTime + dur + 0.05);
}

function tone({ freq = 440, dur = 0.14, type = 'triangle', gain = 0.15, slide = 0 }) {
  if (!ctx || !enabled) return;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  osc.connect(g).connect(master);
  osc.start();
  osc.stop(ctx.currentTime + dur + 0.02);
}

const SOUNDS = {
  chop: () => { burst({ freq: 900, gain: 0.5, dur: 0.14, decay: 0.1 }); tone({ freq: 160, dur: 0.1, type: 'square', gain: 0.1, slide: -60 }); },
  mine: () => { burst({ freq: 1600, q: 2, gain: 0.4, dur: 0.1, decay: 0.07 }); tone({ freq: 220, dur: 0.09, type: 'square', gain: 0.09, slide: -80 }); },
  pick: () => { burst({ freq: 2400, gain: 0.3, dur: 0.08, decay: 0.06 }); },
  swing: () => { burst({ freq: 700, q: 0.7, type: 'bandpass', gain: 0.22, dur: 0.16, decay: 0.14 }); },
  hit: () => { burst({ freq: 260, gain: 0.5, dur: 0.18, decay: 0.14 }); tone({ freq: 110, dur: 0.16, type: 'sawtooth', gain: 0.12, slide: -60 }); },
  hurt: () => { tone({ freq: 220, dur: 0.22, type: 'sawtooth', gain: 0.16, slide: -120 }); },
  build: () => { burst({ freq: 500, gain: 0.45, dur: 0.2, decay: 0.16 }); tone({ freq: 180, dur: 0.14, type: 'square', gain: 0.09 }); },
  craft: () => { tone({ freq: 620, dur: 0.12, type: 'triangle', gain: 0.16 }); setTimeout(() => tone({ freq: 880, dur: 0.16, type: 'triangle', gain: 0.14 }), 90); },
  eat: () => { burst({ freq: 380, gain: 0.25, dur: 0.16, decay: 0.12 }); },
  jump: () => { burst({ freq: 500, gain: 0.12, dur: 0.08, decay: 0.06 }); },
  step: () => { burst({ freq: 240, gain: 0.09, dur: 0.07, decay: 0.05 }); },
  splash: () => { burst({ freq: 1200, q: 0.6, gain: 0.35, dur: 0.38, decay: 0.3 }); },
  door: () => { tone({ freq: 300, dur: 0.16, type: 'square', gain: 0.1, slide: 120 }); },
  ui: () => { tone({ freq: 520, dur: 0.06, type: 'triangle', gain: 0.08 }); },
  death: () => { tone({ freq: 180, dur: 0.9, type: 'sawtooth', gain: 0.2, slide: -120 }); },
};

export function playSound(name, volume = 1) {
  if (!enabled || !ctx) return;
  const fn = SOUNDS[name];
  if (!fn) return;
  if (volume !== 1 && master) {
    const prev = master.gain.value;
    master.gain.value = prev * volume;
    fn();
    master.gain.value = prev;
  } else fn();
}
