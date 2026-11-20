import { hashString, mulberry32 } from './rng.js';

export const TRACK_WIDTH = 160;
export const SPACING = 20;
const MIN_RADIUS = 165; // tightest corner allowed (px): tight enough to reward drifting, wide enough to stay driveable

const ADJECTIVES = [
  'Neon', 'Rusty', 'Midnight', 'Golden', 'Frozen', 'Burning', 'Silent', 'Crimson',
  'Hollow', 'Electric', 'Dusty', 'Velvet', 'Savage', 'Lunar', 'Wicked', 'Sunset',
];
const NOUNS = [
  'Hairpin', 'Ridge', 'Circuit', 'Canyon', 'Harbour', 'Mesa', 'Loop', 'Speedway',
  'Pass', 'Basin', 'Run', 'Gorge', 'Flats', 'Bend', 'Raceway', 'Sweep',
];

/** The race day, in UTC, so every player in the world gets the same track and the same reset moment. */
export function dayKeyUTC(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export function msUntilReset(now = new Date()) {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

/** Smallest turning radius along a closed polyline (circumradius of nearby point triples). */
export function minTurnRadius(xs, ys) {
  const n = xs.length;
  const s = 2;
  let min = Infinity;
  for (let i = 0; i < n; i++) {
    const a = (i - s + n) % n;
    const b = (i + s) % n;
    const ax = xs[a], ay = ys[a], bx = xs[i], by = ys[i], cx = xs[b], cy = ys[b];
    const ab = Math.hypot(bx - ax, by - ay);
    const bc = Math.hypot(cx - bx, cy - by);
    const ca = Math.hypot(ax - cx, ay - cy);
    const cross = Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax));
    if (cross < 1e-6) continue;
    const r = (ab * bc * ca) / (2 * cross);
    if (r < min) min = r;
  }
  return min;
}

function resample(dx, dy, spacing) {
  const m = dx.length;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    cum[i + 1] = cum[i] + Math.hypot(dx[j] - dx[i], dy[j] - dy[i]);
  }
  const total = cum[m];
  const n = Math.round(total / spacing);
  const step = total / n;
  const xs = new Array(n);
  const ys = new Array(n);
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const target = k * step;
    while (cum[seg + 1] < target) seg++;
    const j = (seg + 1) % m;
    const len = cum[seg + 1] - cum[seg] || 1;
    const u = (target - cum[seg]) / len;
    xs[k] = dx[seg] + (dx[j] - dx[seg]) * u;
    ys[k] = dy[seg] + (dy[j] - dy[seg]) * u;
  }
  return { xs, ys, spacing: step };
}

function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/**
 * Builds the track for a given day key (YYYY-MM-DD). Pure and deterministic.
 * The shape is a closed loop whose radius is a sum of a few random harmonics, so it
 * can never cross itself. It is smoothed until every corner is wide enough to drive.
 */
export function generateTrack(dayKey) {
  const rng = mulberry32(hashString('driftle:' + dayKey));
  const dir = rng() < 0.5 ? 1 : -1;
  const rx = 1750 + rng() * 300;
  const ry = 1150 + rng() * 250;
  const harmonics = [];
  for (let k = 2; k <= 7; k++) {
    harmonics.push({ k, amp: (0.45 / k) * (0.5 + rng()), phase: rng() * Math.PI * 2 });
  }
  const name = `${ADJECTIVES[Math.floor(rng() * ADJECTIVES.length)]} ${NOUNS[Math.floor(rng() * NOUNS.length)]}`;

  let best = null;
  for (let scale = 1; scale >= 0.19; scale -= 0.1) {
    const M = 2400;
    const dx = [];
    const dy = [];
    for (let i = 0; i < M; i++) {
      const th = (i / M) * Math.PI * 2;
      let r = 1;
      for (const h of harmonics) r += scale * h.amp * Math.sin(h.k * th + h.phase);
      r = Math.min(1.35, Math.max(0.55, r));
      const ang = dir * th;
      dx.push(Math.cos(ang) * rx * r);
      dy.push(Math.sin(ang) * ry * r);
    }
    best = resample(dx, dy, SPACING);
    if (minTurnRadius(best.xs, best.ys) >= MIN_RADIUS) break;
  }

  let { xs, ys } = best;
  const n = xs.length;

  // Put the start/finish line in the middle of the straightest stretch.
  const turn = new Float64Array(n);
  const tang = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tang[i] = Math.atan2(ys[j] - ys[i], xs[j] - xs[i]);
  }
  for (let i = 0; i < n; i++) turn[i] = Math.abs(wrapAngle(tang[i] - tang[(i - 1 + n) % n]));
  const W = 22;
  let bestStart = 0;
  let bestSum = Infinity;
  for (let s = 0; s < n; s++) {
    let sum = 0;
    for (let k = 0; k < W; k++) sum += turn[(s + k) % n];
    if (sum < bestSum) {
      bestSum = sum;
      bestStart = s;
    }
  }
  const shift = (bestStart + (W >> 1)) % n;
  xs = xs.slice(shift).concat(xs.slice(0, shift));
  ys = ys.slice(shift).concat(ys.slice(0, shift));

  const ang = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    ang[i] = Math.atan2(ys[b] - ys[a], xs[b] - xs[a]);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (xs[i] < minX) minX = xs[i];
    if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i];
    if (ys[i] > maxY) maxY = ys[i];
  }
  const m = TRACK_WIDTH;
  return {
    dayKey,
    name,
    dir,
    n,
    spacing: best.spacing,
    xs,
    ys,
    ang,
    width: TRACK_WIDTH,
    halfWidth: TRACK_WIDTH / 2,
    startIdx: n - 8, // the grid is 8 points (about 160px) behind the line
    length: n * best.spacing,
    bounds: { minX: minX - m, minY: minY - m, maxX: maxX + m, maxY: maxY + m },
  };
}
