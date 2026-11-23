// Fixed-timestep driving simulation. No DOM in here, so it can be tested in Node and,
// later, replayed on a server to sanity-check leaderboard times.

export const TICK_RATE = 120;
export const DT = 1 / TICK_RATE;
export const SAMPLE_STRIDE = 3; // one ghost sample every 3 ticks (40 per second)
export const POS_SCALE = 5; // ghost positions stored in 0.2px steps
export const ANG_SCALE = 1000;

export const PHYS = {
  maxSpeed: 780,
  accel: 560,
  brake: 1300,
  reverseAccel: 360,
  reverseMax: 220,
  drag: 0.12,
  coast: 150,
  steerRate: 2.25,
  steerResponse: 6.5,
  steerFullSpeed: 160,
  highSpeedSteerLoss: 0.4,
  driftYawBonus: 1.8,
  handbrakeYaw: 1.2,
  handbrakeDrag: 0.45,
  overSlip: 0.8,
  gripNormal: 10,
  gripDrift: 5,
  gripHandbrake: 1.2,
  scrub: 0.9,
  slipDrag: 0.9,
  driftMinSpeed: 260,
  driftExitSpeed: 140,
  driftEnterSlip: 0.36,
  driftExitSlip: 0.12,
  maxCharge: 2.2,
  minCharge: 0.5,
  maxBoostTime: 1.7,
  boostSpeedMul: 1.25,
  boostAccelMul: 1.8,
  boostImpulse: 55,
  grassDrag: 2.2,
  offMapMargin: 300,
  kerb: 8,
};

import { cellKey } from './scenery.js';

// Collisions: the car is three circles along its length, trees and buildings are circles.
const CAR_OFFSETS = [-15, 0, 15];
const CAR_RADIUS = 14.5;
const BOUNCE = 0.05; // almost no rebound, so a head-on hit stops you dead
const SCRAPE = 0.985; // speed kept per tick while rubbing along something
const SEARCH = 40; // points searched either side of the last known position

/** Nearest point on the centreline, searched near `hint` only so the car can never "jump" across the infield. */
export function locate(track, x, y, hint) {
  const { xs, ys, n } = track;
  let best = Infinity;
  let bj = hint;
  let bt = 0;
  for (let k = -SEARCH; k <= SEARCH; k++) {
    const j = (hint + k + n) % n;
    const j2 = (j + 1) % n;
    const ax = xs[j];
    const ay = ys[j];
    const bx = xs[j2] - ax;
    const by = ys[j2] - ay;
    let t = ((x - ax) * bx + (y - ay) * by) / (bx * bx + by * by);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = x - (ax + bx * t);
    const dy = y - (ay + by * t);
    const d = dx * dx + dy * dy;
    if (d < best) {
      best = d;
      bj = j;
      bt = t;
    }
  }
  return { j: bj, t: bt, dist: Math.sqrt(best) };
}

export class Sim {
  constructor(track, laps = 3) {
    this.track = track;
    this.laps = laps;
    this.reset();
  }

  reset() {
    const t = this.track;
    const si = t.startIdx;
    this.car = {
      x: t.xs[si],
      y: t.ys[si],
      a: t.ang[si],
      vx: 0,
      vy: 0,
      steer: 0,
      beta: 0,
      drifting: false,
      charge: 0,
      boostT: 0,
    };
    this.idx = si;
    this.dist = 0;
    this.lastP = si;
    this.prog = si - t.n;
    this.progMax = this.prog;
    this.tick = 0;
    this.lapsDone = 0;
    this.lapTimes = [];
    this.finished = false;
    this.finishTime = null;
    this.respawns = 0;
    this.crashes = 0;
    this.crashCool = 0;
    this.wrongWayT = 0;
    this.events = [];
    this.samples = [];
    this.inputRuns = []; // run-length encoded key presses: [mask, ticks, mask, ticks, ...]
    this.recordSample();
  }

  get time() {
    return this.tick * DT;
  }

  recordSample() {
    const c = this.car;
    const a = Math.atan2(Math.sin(c.a), Math.cos(c.a));
    this.samples.push(
      Math.round(c.x * POS_SCALE),
      Math.round(c.y * POS_SCALE),
      Math.round(a * ANG_SCALE),
      Math.round(this.progMax * POS_SCALE),
    );
  }

  /** Pushes the car out of trees and buildings and kills the speed going into them. */
  collide(c) {
    const sc = this.track.scenery;
    if (!sc) return;
    if (this.crashCool > 0) this.crashCool--;
    const cos = Math.cos(c.a);
    const sin = Math.sin(c.a);
    const S = sc.solids;
    let impact = 0;
    let touched = false;
    for (const off of CAR_OFFSETS) {
      let px = c.x + cos * off;
      let py = c.y + sin * off;
      const cx = Math.floor(px / sc.cell);
      const cy = Math.floor(py / sc.cell);
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const list = sc.grid.get(cellKey(gx, gy));
          if (!list) continue;
          for (let q = 0; q < list.length; q++) {
            const i = list[q];
            const dx = px - S.x[i];
            const dy = py - S.y[i];
            const rr = S.r[i] + CAR_RADIUS;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr) continue;
            const d = Math.sqrt(d2) || 0.001;
            const nx = dx / d;
            const ny = dy / d;
            const pen = rr - d;
            c.x += nx * pen;
            c.y += ny * pen;
            px += nx * pen;
            py += ny * pen;
            const vn = c.vx * nx + c.vy * ny;
            if (vn < 0) {
              c.vx -= (1 + BOUNCE) * vn * nx;
              c.vy -= (1 + BOUNCE) * vn * ny;
              if (-vn > impact) impact = -vn;
            }
            touched = true;
          }
        }
      }
    }
    if (!touched) return;
    c.vx *= SCRAPE;
    c.vy *= SCRAPE;
    if (impact > 40) {
      c.boostT = 0;
      c.charge = 0;
    }
    if (impact > 120) {
      c.drifting = false;
      c.steer *= 0.5;
    }
    if (impact > 60 && this.crashCool === 0) {
      this.crashes++;
      this.crashCool = 30;
      this.events.push({ type: 'crash', impact });
    }
  }

  recordInput(inp) {
    const mask = (inp.throttle ? 1 : 0) | (inp.brake ? 2 : 0) | (inp.left ? 4 : 0) | (inp.right ? 8 : 0) | (inp.handbrake ? 16 : 0);
    const r = this.inputRuns;
    const n = r.length;
    if (n && r[n - 2] === mask && r[n - 1] < 255) r[n - 1]++;
    else r.push(mask, 1);
  }

  step(inp) {
    if (this.finished) return;
    const t = this.track;
    const c = this.car;
    const P = PHYS;
    this.recordInput(inp);
    this.tick++;

    const onRoad = this.dist <= t.halfWidth + P.kerb;

    // ---- steering -------------------------------------------------------
    let cos = Math.cos(c.a);
    let sin = Math.sin(c.a);
    let vf = c.vx * cos + c.vy * sin;
    const speed0 = Math.hypot(c.vx, c.vy);

    const target = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    c.steer += (target - c.steer) * Math.min(1, DT * P.steerResponse);
    const lowSpeed = Math.min(1, speed0 / P.steerFullSpeed);
    const highSpeed = 1 - P.highSpeedSteerLoss * Math.min(1, speed0 / P.maxSpeed);
    let yawGain = c.drifting ? P.driftYawBonus : 1;
    if (c.steer * c.beta < 0) {
      // steering deeper into the slide: fade out the rotation so the car doesn't spin
      yawGain *= 1 - Math.min(1, Math.max(0, (Math.abs(c.beta) - P.overSlip) / 0.5)) * 0.9;
    }
    const dir = vf >= -10 ? 1 : -1;
    c.a += c.steer * P.steerRate * lowSpeed * highSpeed * yawGain * dir * DT;
    if (inp.handbrake && speed0 > 150) c.a += c.steer * P.handbrakeYaw * DT;

    // ---- velocity in the car's new frame -------------------------------
    cos = Math.cos(c.a);
    sin = Math.sin(c.a);
    vf = c.vx * cos + c.vy * sin;
    let vl = -c.vx * sin + c.vy * cos;
    const sp = Math.hypot(vf, vl);
    const beta = vf >= 0 && sp > 30 ? Math.atan2(vl, vf) : 0;
    const slip = Math.abs(beta);
    c.beta = beta;

    // ---- drift state and boost -----------------------------------------
    const wasDrifting = c.drifting;
    if (!c.drifting) {
      if (
        sp > P.driftMinSpeed &&
        (slip > P.driftEnterSlip || (inp.handbrake && Math.abs(c.steer) > 0.3))
      ) {
        c.drifting = true;
      }
    } else if (sp < P.driftExitSpeed || (slip < P.driftExitSlip && !inp.handbrake)) {
      c.drifting = false;
    }
    if (wasDrifting && !c.drifting) {
      if (c.charge >= P.minCharge && onRoad) {
        c.boostT = Math.min(P.maxBoostTime, 0.5 + c.charge * 0.55);
        vf += P.boostImpulse * Math.min(1, c.charge / P.maxCharge);
        this.events.push({ type: 'boost', power: c.charge });
      }
      c.charge = 0;
    }
    if (c.drifting && onRoad) {
      c.charge = Math.min(P.maxCharge, c.charge + DT * (0.5 + slip * 1.5));
    }

    // ---- engine, brakes, drag ------------------------------------------
    const boosting = c.boostT > 0;
    const maxV = P.maxSpeed * (boosting ? P.boostSpeedMul : 1);
    if (inp.throttle && !inp.brake) {
      const k = Math.max(0, 1 - Math.max(vf, 0) / maxV);
      vf += P.accel * (boosting ? P.boostAccelMul : 1) * k * DT;
    } else if (inp.brake) {
      if (vf > 15) vf = Math.max(0, vf - P.brake * DT);
      else vf = Math.max(-P.reverseMax, vf - P.reverseAccel * DT);
    } else {
      const co = P.coast * DT;
      vf = Math.abs(vf) <= co ? 0 : vf - Math.sign(vf) * co;
    }
    vf -= vf * P.drag * DT;
    if (inp.handbrake) vf -= vf * P.handbrakeDrag * DT;
    if (!c.drifting && !inp.handbrake) {
      // cornering without drifting scrubs speed: sliding is the fast way round
      vf -= Math.max(vf, 0) * Math.abs(c.steer) * Math.min(1, speed0 / P.maxSpeed) * P.scrub * DT;
    }

    // ---- tyre grip: rotate the velocity toward where the car is pointing ----
    let grip = c.drifting ? P.gripDrift : P.gripNormal;
    if (inp.handbrake) grip = P.gripHandbrake;
    if (vf >= 0 && Math.hypot(vf, vl) > 30) {
      const b = Math.atan2(vl, vf);
      const s = Math.hypot(vf, vl);
      const b2 = b * Math.exp(-grip * DT);
      const s2 = s * (1 - P.slipDrag * Math.sin(b) * Math.sin(b) * DT);
      vf = s2 * Math.cos(b2);
      vl = s2 * Math.sin(b2);
    } else {
      vl *= Math.exp(-grip * DT);
    }

    // ---- grass ----------------------------------------------------------
    if (!onRoad) {
      const g = Math.exp(-P.grassDrag * DT);
      vf *= g;
      vl *= g;
      c.charge = 0;
      c.boostT = Math.max(0, c.boostT - 2 * DT);
    }
    if (c.boostT > 0) c.boostT = Math.max(0, c.boostT - DT);

    // ---- integrate ------------------------------------------------------
    c.vx = vf * cos - vl * sin;
    c.vy = vf * sin + vl * cos;
    c.x += c.vx * DT;
    c.y += c.vy * DT;
    this.collide(c);

    // ---- where are we on the track? ------------------------------------
    const loc = locate(t, c.x, c.y, this.idx);
    if (loc.dist > t.halfWidth + P.offMapMargin) {
      const j = loc.j;
      c.x = t.xs[j];
      c.y = t.ys[j];
      c.a = t.ang[j];
      c.vx = 0;
      c.vy = 0;
      c.steer = 0;
      c.beta = 0;
      c.drifting = false;
      c.charge = 0;
      c.boostT = 0;
      this.idx = j;
      this.dist = 0;
      this.lastP = j;
      this.respawns++;
      this.events.push({ type: 'respawn' });
      return;
    }
    this.idx = loc.j;
    this.dist = loc.dist;
    const p = loc.j + loc.t;
    let d = p - this.lastP;
    if (d > t.n / 2) d -= t.n;
    else if (d < -t.n / 2) d += t.n;
    this.lastP = p;
    const prevProg = this.prog;
    this.prog += d;
    if (this.prog > this.progMax) this.progMax = this.prog;

    // wrong way detection (for the HUD only)
    const tx = Math.cos(t.ang[this.idx]);
    const ty = Math.sin(t.ang[this.idx]);
    if (c.vx * tx + c.vy * ty < -60) this.wrongWayT += DT;
    else this.wrongWayT = 0;

    // ---- laps and finish ------------------------------------------------
    const done = Math.floor(this.prog / t.n);
    while (done > this.lapsDone && !this.finished) {
      this.lapsDone++;
      const goal = this.lapsDone * t.n;
      let frac = (goal - prevProg) / (this.prog - prevProg);
      frac = Math.min(1, Math.max(0, frac));
      const tm = (this.tick - 1 + frac) * DT;
      this.lapTimes.push(tm);
      this.events.push({ type: 'lap', lap: this.lapsDone, time: tm });
      if (this.lapsDone >= this.laps) {
        this.finished = true;
        this.finishTime = tm;
        this.events.push({ type: 'finish', time: tm });
      }
    }

    if (this.tick % SAMPLE_STRIDE === 0 || this.finished) this.recordSample();
  }
}
