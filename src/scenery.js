import { hashString, mulberry32 } from './rng.js';

// The trees and trackside buildings for a day. This list is the single source of truth:
// the 3D view draws from it and the driving sim collides with it, so what you see is what
// you hit. Pure data, no browser code, so it can also run in Node tests or on a server.

export const KERB_W = 14;
export const GRID_CELL = 100;

/** Numeric key for a grid cell, safe for the coordinate range of a track. */
export function cellKey(cx, cy) {
  return (cx + 4096) * 8192 + (cy + 4096);
}

export function generateScenery(track) {
  const T = track;
  const rng = mulberry32(hashString('scenery:' + T.dayKey));
  const trees = [];
  const taken = new Set();
  // Trees start just past the kerb, leaving a short strip of grass.
  const minD = T.halfWidth + KERB_W + 34;
  const minD2 = minD * minD;

  for (let k = 0; k < 9000 && trees.length < 2800; k++) {
    const i = Math.floor(rng() * T.n);
    const side = rng() < 0.5 ? -1 : 1;
    const off = minD + Math.pow(rng(), 1.5) * 800;
    const a = T.ang[i];
    const x = T.xs[i] - Math.sin(a) * off * side + (rng() - 0.5) * 30;
    const z = T.ys[i] + Math.cos(a) * off * side + (rng() - 0.5) * 30;
    const kind = rng() < 0.62 ? 0 : 1; // 0 = pine, 1 = round tree
    const tree = { x, z, s: 0.8 + rng() * 0.95, r: rng() * 6.28, kind, c: rng(), l: (rng() - 0.5) * 0.09 };
    const cell = `${Math.floor(x / 46)},${Math.floor(z / 46)}`;
    if (taken.has(cell)) continue;
    if (Math.hypot(x - T.xs[0], z - T.ys[0]) < 270) continue; // keep the start area clear for the grandstand
    let ok = true;
    for (let j = 0; j < T.n; j++) {
      const dx = x - T.xs[j];
      const dz = z - T.ys[j];
      if (dx * dx + dz * dz < minD2) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    taken.add(cell);
    trees.push(tree);
  }

  // Everything solid, as circles: x, y (the sim's y is the world's z), radius.
  const sx = [];
  const sy = [];
  const sr = [];
  for (const t of trees) {
    sx.push(t.x);
    sy.push(t.z);
    sr.push(5.5 * t.s); // trunk, a little generous
  }

  // Start gantry posts and grandstand, in the track's local frame at the start line
  // (+lx along the road, +lz to its right). The 3D view builds these same shapes.
  const a0 = T.ang[0];
  const toWorld = (lx, lz) => [
    T.xs[0] + Math.cos(a0) * lx - Math.sin(a0) * lz,
    T.ys[0] + Math.sin(a0) * lx + Math.cos(a0) * lz,
  ];
  const span = T.width + 44;
  for (const lz of [-span / 2, span / 2]) {
    const [x, y] = toWorld(0, lz);
    sx.push(x);
    sy.push(y);
    sr.push(6);
  }
  for (let lx = -30; lx <= 170; lx += 25) {
    const [x, y] = toWorld(lx, T.halfWidth + KERB_W + 70);
    sx.push(x);
    sy.push(y);
    sr.push(22);
  }

  const grid = new Map();
  for (let i = 0; i < sx.length; i++) {
    const key = cellKey(Math.floor(sx[i] / GRID_CELL), Math.floor(sy[i] / GRID_CELL));
    const list = grid.get(key);
    if (list) list.push(i);
    else grid.set(key, [i]);
  }
  return { trees, solids: { x: sx, y: sy, r: sr, n: sx.length }, grid, cell: GRID_CELL };
}
