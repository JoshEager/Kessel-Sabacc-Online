import { loadPref, savePref } from './net';

/** Tiny synthesized sound effects (WebAudio, no assets). Muted by default. */
export type SoundName = 'deal' | 'draw' | 'discard' | 'dice' | 'turn' | 'win' | 'lose' | 'chat' | 'token';

let ctx: AudioContext | null = null;
let muted = loadPref('muted') !== 'false';
const listeners = new Set<(m: boolean) => void>();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(m: boolean): void {
  muted = m;
  savePref('muted', String(m));
  if (!m) audio(); // unlock on user gesture
  listeners.forEach((l) => l(m));
}

export function onMutedChange(fn: (m: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine', gain = 0.12, slideTo?: number): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise(start: number, dur: number, gain = 0.08, highpass = 1500): void {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + start;
  const len = Math.max(1, Math.floor(a.sampleRate * dur));
  const buf = a.createBuffer(1, len, a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = highpass;
  const g = a.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t0);
}

export function play(name: SoundName): void {
  if (muted) return;
  switch (name) {
    case 'deal':
      for (let i = 0; i < 4; i++) noise(i * 0.07, 0.05, 0.07, 2500);
      break;
    case 'draw':
      noise(0, 0.08, 0.08, 1800);
      tone(520, 0.02, 0.09, 'triangle', 0.06, 700);
      break;
    case 'discard':
      noise(0, 0.06, 0.06, 900);
      tone(240, 0, 0.12, 'triangle', 0.08, 160);
      break;
    case 'dice':
      for (let i = 0; i < 7; i++) noise(i * 0.06 + Math.random() * 0.02, 0.03, 0.1, 3000);
      break;
    case 'turn':
      tone(660, 0, 0.12, 'sine', 0.1);
      tone(990, 0.1, 0.18, 'sine', 0.08);
      break;
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, i * 0.09, 0.25, 'triangle', 0.09));
      break;
    case 'lose':
      tone(330, 0, 0.25, 'sawtooth', 0.04, 220);
      break;
    case 'token':
      tone(392, 0, 0.1, 'square', 0.04);
      tone(587, 0.07, 0.16, 'triangle', 0.08, 880);
      break;
    case 'chat':
      tone(880, 0, 0.06, 'sine', 0.05);
      break;
  }
}
