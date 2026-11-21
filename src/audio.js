// All sound is synthesised with the Web Audio API: no audio files to download or license.
// Browsers only allow sound after a click or key press, so nothing starts until unlock().

const MUTE_KEY = 'driftle:v1:muted';
const GEAR_BOUNDS = [0, 0.16, 0.32, 0.5, 0.7, 1.0];

function loadMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.muted = loadMuted();
    this.rpm = 0;
    this.gearSmooth = 0;
    this.lastGear = 0;
    this.onMute = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(ctx.destination);

    // one second of white noise, looped, shared by the skid / grass / wind layers
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // engine: three oscillators through a soft clipper and a lowpass
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 800;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) curve[i] = Math.tanh(((i / 255) * 2 - 1) * 2.2);
    shaper.curve = curve;
    this.osc = [
      ['sawtooth', 1, 0.5],
      ['square', 0.5, 0.35],
      ['sawtooth', 2.01, 0.2],
    ].map(([type, mult, vol]) => {
      const o = ctx.createOscillator();
      o.type = type;
      const g = ctx.createGain();
      g.gain.value = vol;
      o.connect(g).connect(shaper);
      o.start();
      return { o, mult };
    });
    shaper.connect(this.engFilter).connect(this.engGain).connect(this.master);

    this.skid = this.noiseLayer('bandpass', 1500, 1.2);
    this.rumble = this.noiseLayer('lowpass', 220, 0.7);
    this.wind = this.noiseLayer('highpass', 900, 0.5);
  }

  noiseLayer(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { g, f };
  }

  /** Called every frame. s = { active, speed (0..1 of top speed), throttle, drifting, slip, onRoad, boosting } */
  update(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, dt * 8);
    const sp = Math.min(1, Math.max(0, s.speed));

    // Pretend gearbox: rpm climbs within a gear, then drops when it shifts up.
    let gear = 0;
    while (gear < 4 && sp > GEAR_BOUNDS[gear + 1]) gear++;
    const lo = GEAR_BOUNDS[gear];
    const hi = GEAR_BOUNDS[gear + 1];
    let rpm = 0.25 + 0.75 * ((sp - lo) / (hi - lo));
    if (s.throttle) rpm = Math.min(1, rpm + 0.05);
    if (gear !== this.lastGear && gear > this.lastGear) this.rpm -= 0.25; // quick dip on a shift
    this.lastGear = gear;
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 10);
    if (!s.active) this.rpm += (0.15 - this.rpm) * k;

    const base = 46 + Math.max(0, this.rpm) * 118;
    for (const { o, mult } of this.osc) o.frequency.setTargetAtTime(base * mult * (s.boosting ? 1.06 : 1), t, 0.03);
    this.engFilter.frequency.setTargetAtTime(500 + this.rpm * 1700 + (s.throttle ? 500 : 0), t, 0.05);
    this.engGain.gain.setTargetAtTime(s.active ? (s.throttle ? 0.34 : 0.2) : 0.12, t, 0.08);

    const skidVol = s.active && s.onRoad && s.speed > 0.15 ? Math.min(1, (s.drifting ? 0.6 : 0) + s.slip * 0.9) : 0;
    this.skid.g.gain.setTargetAtTime(skidVol * 0.32, t, 0.05);
    this.skid.f.frequency.setTargetAtTime(1100 + sp * 900, t, 0.1);
    this.rumble.g.gain.setTargetAtTime(s.active && !s.onRoad ? 0.18 + sp * 0.5 : 0, t, 0.06);
    this.wind.g.gain.setTargetAtTime(s.active ? sp * sp * 0.1 + (s.boosting ? 0.1 : 0) : 0, t, 0.1);
  }

  tone(freq, dur, { type = 'square', vol = 0.3, slideTo = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  burst(dur, { freq = 800, type = 'lowpass', vol = 0.4, sweepTo = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  beep() {
    this.tone(440, 0.18, { vol: 0.3 });
  }
  go() {
    this.tone(880, 0.55, { vol: 0.35 });
    this.tone(1320, 0.55, { vol: 0.15, type: 'sine' });
  }
  lap() {
    this.tone(988, 0.12, { type: 'triangle', vol: 0.3 });
    this.tone(1318, 0.25, { type: 'triangle', vol: 0.3, delay: 0.1 });
  }
  boost() {
    this.burst(0.7, { freq: 300, type: 'bandpass', vol: 0.5, sweepTo: 3500 });
    this.tone(180, 0.5, { type: 'sawtooth', vol: 0.15, slideTo: 520 });
  }
  crash(impact = 200) {
    const v = Math.min(1, 0.35 + impact / 600);
    this.burst(0.35, { freq: 700, vol: 0.9 * v, sweepTo: 80 });
    this.tone(110, 0.3, { type: 'sine', vol: 0.7 * v, slideTo: 40 });
  }
  finish() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.3, delay: i * 0.13 }));
    this.tone(1047, 0.9, { type: 'triangle', vol: 0.3, delay: 0.55 });
    this.tone(1319, 0.9, { type: 'sine', vol: 0.15, delay: 0.55 });
    // applause: a few seconds of filtered noise
    this.burst(2.2, { freq: 3000, type: 'bandpass', vol: 0.25, sweepTo: 1500, delay: 0.4 });
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      /* private window: just don't remember it */
    }
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.55, this.ctx.currentTime, 0.03);
    return this.muted;
  }
}
