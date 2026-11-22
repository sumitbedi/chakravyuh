// Temple sound palette. Every source is synthesized and has a scheduled stop.
let ctx, master, noiseBuffer, drone;
let muted = false;
const floor = 0.0001;
const safe = fn => (...args) => {
  if (!ctx || !master || ctx.state === 'closed') return;
  try { fn(...args); } catch { /* Audio is optional on unsupported devices. */ }
};

function envelope(param, level, time, duration, attack = 0.008) {
  param.setValueAtTime(floor, time);
  param.exponentialRampToValueAtTime(Math.max(floor, level), time + attack);
  param.exponentialRampToValueAtTime(floor, time + duration);
}

function tone(type, frequency, level, duration, time = ctx.currentTime,
  end = frequency, destination = master, detune = 0) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, time);
  oscillator.frequency.exponentialRampToValueAtTime(end, time + duration);
  oscillator.detune.setValueAtTime(detune, time);
  envelope(gain.gain, level, time, duration);
  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  oscillator.start(time);
  oscillator.stop(time + duration + 0.02);
  return oscillator;
}

function noise(level, duration, frequency, type = 'lowpass', time = ctx.currentTime) {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = noiseBuffer;
  source.playbackRate.value = 0.9 + Math.random() * 0.2;
  filter.type = type;
  filter.frequency.setValueAtTime(frequency, time);
  filter.Q.value = 0.7;
  envelope(gain.gain, level, time, duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(master);
  source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  source.start(time);
  source.stop(time + duration + 0.02);
}

function bell(frequency, level, duration, time = ctx.currentTime) {
  [1, 2.76, 5.4, 8.93].forEach((ratio, i) => {
    tone('sine', frequency * ratio, level / (1 + i * 2),
      duration / (1 + i * 0.45), time);
  });
}

function unlock() {
  try {
    if (!ctx || ctx.state === 'closed') {
      const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Audio) return;
      ctx = new Audio();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
      drone = null;
      noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      const resumed = ctx.resume();
      if (resumed && typeof resumed.catch === 'function') resumed.catch(() => {});
    }
  } catch { /* Unsupported or blocked audio must never prevent play. */ }
}

export const sfx = {
  unlock,
  step: safe(() => noise(0.07, 0.075, 420 + Math.random() * 180)),
  bump: safe(() => {
    tone('sine', 105, 0.16, 0.18, ctx.currentTime, 42);
    noise(0.08, 0.09, 240);
  }),
  peek: safe(() => noise(0.055, 0.3, 1800, 'bandpass')),
  clear: safe(() => {
    const time = ctx.currentTime;
    bell(520, 0.16, 3.2, time);
    noise(0.025, 0.04, 3800, 'highpass', time);
    [261.63, 329.63, 392].forEach((frequency, i) => {
      tone('triangle', frequency, 0.085, 0.65, time + 0.14 + i * 0.22);
    });
  }),
  caught: safe(() => {
    const time = ctx.currentTime;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(650, time);
    filter.frequency.exponentialRampToValueAtTime(110, time + 0.6);
    filter.connect(master);
    const voices = [-19, 17].map(cents =>
      tone('sawtooth', 72, 0.09, 0.6, time, 39, filter, cents));
    const cleanup = voices[1].onended;
    voices[1].onended = () => { cleanup(); filter.disconnect(); };
    noise(0.13, 0.6, 400);
  }),
  tick: safe(() => {
    tone('sine', 1500, 0.045, 0.035);
    noise(0.035, 0.025, 2800, 'highpass');
  }),
  gameOver: safe(() => {
    const time = ctx.currentTime;
    tone('triangle', 220, 0.15, 1.3, time, 73.42);
    tone('sine', 440, 0.055, 1.3, time, 146.84, master, 7);
  }),
  streak: safe(n => {
    const count = Number.isFinite(n) ? Math.max(0, Math.min(n, 24)) : 0;
    bell(440 * 2 ** (count / 12), 0.1, 0.65);
  }),
};

const driveAmbient = safe(on => {
  if (Boolean(on) === Boolean(drone)) return;
  const time = ctx.currentTime;
  if (on) {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.05, time + 1.5);
    gain.connect(master);
    // Sa–Pa, paired with slightly detuned strings for slow beating.
    const voices = [130.81, 131.12, 196, 195.73].map(frequency => {
      const oscillator = ctx.createOscillator();
      const string = ctx.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = frequency;
      string.gain.value = 0.18;
      oscillator.connect(string);
      string.connect(gain);
      oscillator.onended = () => { oscillator.disconnect(); string.disconnect(); };
      oscillator.start(time);
      return oscillator;
    });
    drone = { gain, voices, started: time };
  } else {
    const old = drone;
    drone = null;
    old.gain.gain.cancelScheduledValues(time);
    old.gain.gain.setValueAtTime(0.05 * Math.min(1, (time - old.started) / 1.5), time);
    old.gain.gain.linearRampToValueAtTime(0, time + 0.7);
    old.voices.forEach(voice => voice.stop(time + 0.72));
    const cleanup = old.voices[0].onended;
    old.voices[0].onended = () => { cleanup(); old.gain.disconnect(); };
  }
});

export function ambient(on) { driveAmbient(on); }

export function setMuted(value) {
  muted = Boolean(value);
  safe(() => {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.02);
  })();
}

export function isMuted() { return muted; }
