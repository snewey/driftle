import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTrack, dayKeyUTC, msUntilReset, minTurnRadius, TRACK_WIDTH } from '../src/track.js';
import { Sim, DT, PHYS } from '../src/sim.js';
import { packSamples, unpackSamples, GhostPlayer, packInputs, unpackInputs } from '../src/ghost.js';

const NO_INPUT = { throttle: false, brake: false, left: false, right: false, handbrake: false };

/** A big, gentle circle: lets us test driving physics without corners getting in the way. */
function circleTrack(R = 4000) {
  const n = Math.round((2 * Math.PI * R) / 20);
  const xs = [];
  const ys = [];
  const ang = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    xs.push(Math.cos(th) * R);
    ys.push(Math.sin(th) * R);
    ang.push(th + Math.PI / 2);
  }
  return {
    n,
    spacing: 20,
    xs,
    ys,
    ang,
    halfWidth: 3000, // effectively "always on the road", so grass never interferes with the physics test
    startIdx: n - 8,
    bounds: { minX: -R, minY: -R, maxX: R, maxY: R },
  };
}

function autopilot(sim) {
  const t = sim.track;
  const c = sim.car;
  const speed = Math.hypot(c.vx, c.vy);
  const look = 10 + Math.floor(speed / 80);
  const j = (sim.idx + look) % t.n;
  const desired = Math.atan2(t.ys[j] - c.y, t.xs[j] - c.x);
  let diff = desired - c.a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return {
    throttle: Math.abs(diff) < 0.5 || speed < 250,
    brake: speed > 350 && Math.abs(diff) > 0.7,
    left: diff < -0.05,
    right: diff > 0.05,
    handbrake: false,
  };
}

function runAutopilot(track, maxSeconds = 400) {
  const sim = new Sim(track, 3);
  for (let i = 0; i < maxSeconds / DT && !sim.finished; i++) sim.step(autopilot(sim));
  return sim;
}

test('same day gives the same track, different days differ', () => {
  const a = generateTrack('2026-11-20');
  const b = generateTrack('2026-11-20');
  const c = generateTrack('2026-11-21');
  assert.deepEqual(a.xs, b.xs);
  assert.deepEqual(a.ys, b.ys);
  assert.equal(a.name, b.name);
  assert.notDeepEqual(a.xs, c.xs);
});

test('every track for a month is a driveable size and shape', () => {
  for (let d = 1; d <= 30; d++) {
    const key = `2026-11-${String(d).padStart(2, '0')}`;
    const t = generateTrack(key);
    assert.ok(t.n > 250 && t.n < 700, `${key}: ${t.n} points`);
    assert.ok(t.length > 5000 && t.length < 14000, `${key}: length ${t.length}`);
    const r = minTurnRadius(t.xs, t.ys);
    assert.ok(r >= TRACK_WIDTH, `${key}: tightest corner radius ${r.toFixed(0)}`);
    assert.ok(t.startIdx === t.n - 8);
  }
});

test('start line sits on a straight', () => {
  const t = generateTrack('2026-11-20');
  let turn = 0;
  for (let k = -10; k <= 10; k++) {
    const i = (k + t.n) % t.n;
    const j = (i + 1) % t.n;
    let d = t.ang[j] - t.ang[i];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    turn += Math.abs(d);
  }
  assert.ok(turn < 0.6, `turn near start line was ${turn}`);
});

test('day key and reset timer', () => {
  assert.equal(dayKeyUTC(new Date('2026-11-20T23:59:59Z')), '2026-11-20');
  assert.equal(dayKeyUTC(new Date('2026-11-21T00:00:00Z')), '2026-11-21');
  assert.equal(msUntilReset(new Date('2026-11-20T23:00:00Z')), 3600000);
});

test('a simple driver can finish 3 laps, and the result is repeatable', () => {
  const track = generateTrack('2026-11-20');
  const a = runAutopilot(track);
  const b = runAutopilot(track);
  assert.ok(a.finished, 'autopilot did not finish within 400s');
  assert.equal(a.finishTime, b.finishTime);
  assert.equal(a.lapTimes.length, 3);
  assert.ok(a.finishTime > 25 && a.finishTime < 300, `finish time ${a.finishTime}`);
  console.log(`      autopilot: ${a.finishTime.toFixed(2)}s, respawns ${a.respawns}, track ${track.name}`);
});

test('autopilot finishes a range of daily tracks', () => {
  for (let d = 1; d <= 10; d++) {
    const track = generateTrack(`2026-12-${String(d).padStart(2, '0')}`);
    const sim = runAutopilot(track);
    assert.ok(sim.finished, `2026-12-${d} not finished (prog ${sim.prog.toFixed(0)} of ${3 * track.n})`);
  }
});

test('driving: accelerates, and handbrake plus steering starts a drift that pays out a boost', () => {
  const sim = new Sim(circleTrack(), 3);
  let topSpeed = 0;
  for (let i = 0; i < 4 * 120; i++) {
    sim.step({ ...NO_INPUT, throttle: true });
    topSpeed = Math.max(topSpeed, Math.hypot(sim.car.vx, sim.car.vy));
  }
  assert.ok(topSpeed > 450, `top speed after 4s was only ${topSpeed}`);

  let drifted = false;
  for (let i = 0; i < 0.6 * 120; i++) {
    sim.step({ ...NO_INPUT, throttle: true, right: true, handbrake: true });
    if (sim.car.drifting) drifted = true;
  }
  assert.ok(drifted, 'handbrake + steer did not start a drift');
  for (let i = 0; i < 0.8 * 120; i++) sim.step({ ...NO_INPUT, throttle: true, right: true });
  assert.ok(sim.car.charge > PHYS.minCharge, `drift charge only ${sim.car.charge}`);

  let boosted = false;
  for (let i = 0; i < 3 * 120; i++) {
    sim.step({ ...NO_INPUT, throttle: true, left: i < 40 });
    if (sim.events.some((e) => e.type === 'boost')) boosted = true;
  }
  assert.ok(boosted, 'no drift boost after straightening out');
});

test('leaving the map respawns the car on the track', () => {
  const track = generateTrack('2026-11-20');
  const sim = new Sim(track, 3);
  for (let i = 0; i < 20 * 120; i++) sim.step({ ...NO_INPUT, throttle: true, left: i < 5 });
  assert.ok(sim.respawns >= 1 || sim.dist <= track.halfWidth + PHYS.offMapMargin);
  assert.ok(sim.dist <= track.halfWidth + PHYS.offMapMargin);
});

test('ghost samples survive packing and replay at the right time', () => {
  const track = generateTrack('2026-11-20');
  const sim = runAutopilot(track);
  const packed = packSamples(sim.samples);
  const back = unpackSamples(packed);
  assert.equal(back.length, sim.samples.length);
  const ghost = new GhostPlayer(back, sim.finishTime);
  const start = ghost.at(0);
  assert.ok(Math.abs(start.x - track.xs[track.startIdx]) < 1);
  const mid = ghost.at(sim.finishTime / 2);
  assert.ok(mid.prog > start.prog);
  // the ghost reaches the finish progress at about the finish time
  const t = ghost.timeAtProg(3 * track.n);
  assert.ok(Math.abs(t - sim.finishTime) < 0.2, `ghost finish ${t} vs ${sim.finishTime}`);
  console.log(`      ghost size: ${(packed.length / 1024).toFixed(1)} KB for ${sim.finishTime.toFixed(1)}s`);
});

test('scenery is the same every run and keeps the road itself clear', () => {
  const a = generateTrack('2026-11-20');
  const b = generateTrack('2026-11-20');
  assert.deepEqual(a.scenery.trees, b.scenery.trees);
  assert.ok(a.scenery.trees.length > 1000, `only ${a.scenery.trees.length} trees`);
  for (const day of ['2026-11-20', '2026-11-21', '2026-12-05']) {
    const t = generateTrack(day);
    const S = t.scenery.solids;
    let closest = Infinity;
    for (let i = 0; i < S.n; i++) {
      let d = Infinity;
      for (let j = 0; j < t.n; j++) d = Math.min(d, Math.hypot(S.x[i] - t.xs[j], S.y[i] - t.ys[j]));
      closest = Math.min(closest, d - S.r[i]);
    }
    assert.ok(closest > t.halfWidth + 14, `${day}: something solid reaches ${closest.toFixed(0)} from the road centre`);
  }
});

test('driving into a tree stops the car and it cannot pass through', () => {
  const track = generateTrack('2026-11-20');
  const S = track.scenery.solids;
  let pick = -1;
  let pj = 0;
  for (let i = 0; i < track.scenery.trees.length && pick < 0; i++) {
    let d = Infinity;
    let jj = 0;
    for (let j = 0; j < track.n; j++) {
      const dd = Math.hypot(S.x[i] - track.xs[j], S.y[i] - track.ys[j]);
      if (dd < d) {
        d = dd;
        jj = j;
      }
    }
    if (d < 220) {
      pick = i;
      pj = jj;
    }
  }
  assert.ok(pick >= 0, 'no tree near the road');
  const tx = S.x[pick];
  const ty = S.y[pick];
  const dx = tx - track.xs[pj];
  const dy = ty - track.ys[pj];
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  const sim = new Sim(track, 3);
  const c = sim.car;
  c.x = tx - ux * 90;
  c.y = ty - uy * 90;
  c.a = Math.atan2(uy, ux);
  c.vx = ux * 450;
  c.vy = uy * 450;
  sim.idx = pj;
  sim.lastP = pj;
  let crashed = false;
  let closest = Infinity;
  for (let i = 0; i < 3 * 120; i++) {
    sim.step({ ...NO_INPUT, throttle: true });
    if (sim.events.some((e) => e.type === 'crash')) crashed = true;
    sim.events.length = 0;
    const fx = c.x + Math.cos(c.a) * 15;
    const fy = c.y + Math.sin(c.a) * 15;
    closest = Math.min(closest, Math.hypot(fx - tx, fy - ty) - S.r[pick]);
  }
  assert.ok(crashed, 'no crash event');
  assert.ok(closest > 13, `the car went inside the tree (${closest.toFixed(1)})`);
  assert.ok(Math.hypot(c.vx, c.vy) < 150, `still doing ${Math.hypot(c.vx, c.vy).toFixed(0)} after hitting a tree head on`);
});

test('recorded key presses are small, and replaying them gives the same run', () => {
  const track = generateTrack('2026-11-20');
  const a = runAutopilot(track);
  const packed = packInputs(a.inputRuns);
  const masks = unpackInputs(packed);
  assert.equal(masks.length, a.tick, 'one key mask per tick');
  assert.ok(packed.length < 6000, `inputs took ${packed.length} bytes`);
  const b = new Sim(track, 3);
  for (let i = 0; i < masks.length; i++) {
    const m = masks[i];
    b.step({ throttle: !!(m & 1), brake: !!(m & 2), left: !!(m & 4), right: !!(m & 8), handbrake: !!(m & 16) });
  }
  assert.equal(b.finishTime, a.finishTime);
  console.log(`      inputs: ${packed.length} bytes for ${a.finishTime.toFixed(1)}s`);
});
