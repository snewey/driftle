import { Sim } from './sim.js';

// Boosts aren't stored in a replay, but the game is deterministic: feeding the recorded keys back into the
// simulation gives the exact ticks the boost was active. Returns one 0/1 flag per tick, or null if the
// re-run doesn't land on the recorded finish time (then the caller falls back to a speed guess).
export function boostTimeline(track, laps, inputs, timeMs) {
  try {
    const s = new Sim(track, laps);
    const flags = new Uint8Array(inputs.length + 1);
    const inp = { throttle: false, brake: false, left: false, right: false, handbrake: false };
    for (let i = 0; i < inputs.length && s.finishTime == null; i++) {
      const m = inputs[i];
      inp.throttle = !!(m & 1);
      inp.brake = !!(m & 2);
      inp.left = !!(m & 4);
      inp.right = !!(m & 8);
      inp.handbrake = !!(m & 16);
      s.step(inp);
      s.events.length = 0;
      flags[i] = s.car.boostT > 0 ? 1 : 0;
    }
    if (s.finishTime == null || Math.abs(s.finishTime * 1000 - timeMs) > 60) return null;
    return flags;
  } catch (err) {
    console.error('Could not work out boosts for the replay', err);
    return null;
  }
}
