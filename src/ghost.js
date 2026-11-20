import { DT, SAMPLE_STRIDE, POS_SCALE, ANG_SCALE } from './sim.js';

// A ghost is a flat list of int16 numbers, four per sample: x, y, angle, progress.
// Packed as base64 it is roughly 20 KB for a one minute run, small enough to store
// a ghost per leaderboard row in the free Supabase tier.

export function packSamples(arr) {
  const i16 = new Int16Array(arr.length);
  for (let i = 0; i < arr.length; i++) i16[i] = Math.max(-32768, Math.min(32767, arr[i]));
  const bytes = new Uint8Array(i16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function unpackSamples(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

const STEP = SAMPLE_STRIDE * DT; // seconds between samples

export class GhostPlayer {
  constructor(samples, timeSeconds) {
    this.s = samples;
    this.n = Math.floor(samples.length / 4);
    this.time = timeSeconds;
  }

  read(i) {
    const o = i * 4;
    return {
      x: this.s[o] / POS_SCALE,
      y: this.s[o + 1] / POS_SCALE,
      a: this.s[o + 2] / ANG_SCALE,
      prog: this.s[o + 3] / POS_SCALE,
    };
  }

  /** Pose of the ghost t seconds after the green light. */
  at(t) {
    const f = Math.max(0, t) / STEP;
    const i = Math.floor(f);
    if (i >= this.n - 1) return this.read(this.n - 1);
    const u = f - i;
    const a = this.read(i);
    const b = this.read(i + 1);
    let da = b.a - a.a;
    if (da > Math.PI) da -= Math.PI * 2;
    else if (da < -Math.PI) da += Math.PI * 2;
    return {
      x: a.x + (b.x - a.x) * u,
      y: a.y + (b.y - a.y) * u,
      a: a.a + da * u,
      prog: a.prog + (b.prog - a.prog) * u,
    };
  }

  /** Seconds at which the ghost reached track progress p (used for the +/- gap on screen). */
  timeAtProg(p) {
    const last = this.n - 1;
    const prog = (i) => this.s[i * 4 + 3] / POS_SCALE;
    if (prog(0) >= p) return 0;
    if (prog(last) < p) return last * STEP;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (prog(mid) < p) lo = mid;
      else hi = mid;
    }
    const pl = prog(lo);
    const ph = prog(hi);
    const u = ph > pl ? (p - pl) / (ph - pl) : 0;
    return (lo + u) * STEP;
  }
}
