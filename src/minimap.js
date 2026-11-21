// 2D track outline used by the HUD minimap and the menu preview.

/** Pre-renders the track outline once. */
export function makeMinimap(track, w, h) {
  const pad = 16;
  const b = track.bounds;
  const bw = b.maxX - b.minX;
  const bh = b.maxY - b.minY;
  const sc = Math.min((w - pad * 2) / bw, (h - pad * 2) / bh);
  const ox = (w - bw * sc) / 2 - b.minX * sc;
  const oy = (h - bh * sc) / 2 - b.minY * sc;
  const toMap = (x, y) => [x * sc + ox, y * sc + oy];
  const base = document.createElement('canvas');
  base.width = w;
  base.height = h;
  const ctx = base.getContext('2d');
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let i = 0; i < track.n; i++) {
    const [x, y] = toMap(track.xs[i], track.ys[i]);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.strokeStyle = 'rgba(255,255,255,.22)';
  ctx.lineWidth = 11;
  ctx.stroke();
  ctx.strokeStyle = '#5b6678';
  ctx.lineWidth = 6;
  ctx.stroke();
  const [sx, sy] = toMap(track.xs[0], track.ys[0]);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(track.ang[0]);
  ctx.fillStyle = '#fff';
  ctx.fillRect(-1.5, -8, 3, 16);
  ctx.restore();
  return { base, toMap, w, h };
}

export function drawMinimap(canvas, mm, sim, ghostPose) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(mm.base, 0, 0);
  if (ghostPose) {
    const [gx, gy] = mm.toMap(ghostPose.x, ghostPose.y);
    ctx.fillStyle = '#7ee8ff';
    ctx.beginPath();
    ctx.arc(gx, gy, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  if (sim) {
    const [px, py] = mm.toMap(sim.car.x, sim.car.y);
    ctx.fillStyle = '#ff3d71';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}
