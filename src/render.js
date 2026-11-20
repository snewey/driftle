import { PHYS } from './sim.js';

const SKID_MAX = 3000;

// ---- helpers -------------------------------------------------------------

function carPath(ctx) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-28, -14, 56, 28, 8);
  else ctx.rect(-28, -14, 56, 28);
}

function drawCar(ctx, x, y, a, body, alpha = 1, boost = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.globalAlpha = alpha;
  if (boost > 0) {
    const len = 26 + Math.random() * 16;
    ctx.fillStyle = '#ff9f43';
    ctx.beginPath();
    ctx.moveTo(-27, -8);
    ctx.lineTo(-27 - len, 0);
    ctx.lineTo(-27, 8);
    ctx.fill();
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.moveTo(-27, -4);
    ctx.lineTo(-27 - len * 0.55, 0);
    ctx.lineTo(-27, 4);
    ctx.fill();
  }
  carPath(ctx);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(12,16,26,.88)';
  ctx.fillRect(-7, -10, 20, 20);
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  ctx.fillRect(9, -9, 4, 18);
  ctx.fillStyle = '#fff7c2';
  ctx.fillRect(24, -11, 4, 6);
  ctx.fillRect(24, 5, 4, 6);
  ctx.fillStyle = '#ff2b2b';
  ctx.fillRect(-28, -11, 3, 6);
  ctx.fillRect(-28, 5, 3, 6);
  ctx.restore();
}

/** Pre-renders the track outline for the minimap and menu preview. */
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
  // start line
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

// ---- main renderer -------------------------------------------------------

export class Renderer {
  constructor(canvas, track) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.track = track;
    this.dpr = 1;
    this.cam = { x: track.xs[track.startIdx], y: track.ys[track.startIdx], zoom: 0.9 };
    this.skids = new Float32Array(SKID_MAX * 4);
    this.skidCount = 0;
    this.skidHead = 0;
    this.lastWheel = [null, null];
    this.particles = [];

    this.road = new Path2D();
    for (let i = 0; i < track.n; i++) {
      if (i === 0) this.road.moveTo(track.xs[i], track.ys[i]);
      else this.road.lineTo(track.xs[i], track.ys[i]);
    }
    this.road.closePath();

    this.grass = this.makeGrass();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  makeGrass() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#17321f';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 700; i++) {
      g.fillStyle = Math.random() < 0.5 ? 'rgba(46,92,58,.55)' : 'rgba(10,26,16,.5)';
      g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 3, 2 + Math.random() * 3);
    }
    return this.ctx.createPattern(c, 'repeat');
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(window.innerWidth * this.dpr);
    this.canvas.height = Math.floor(window.innerHeight * this.dpr);
  }

  reset(sim) {
    const c = sim.car;
    this.cam.x = c.x;
    this.cam.y = c.y;
    this.skidCount = 0;
    this.skidHead = 0;
    this.lastWheel = [null, null];
    this.particles.length = 0;
  }

  addSkid(x1, y1, x2, y2) {
    const o = this.skidHead * 4;
    this.skids[o] = x1;
    this.skids[o + 1] = y1;
    this.skids[o + 2] = x2;
    this.skids[o + 3] = y2;
    this.skidHead = (this.skidHead + 1) % SKID_MAX;
    if (this.skidCount < SKID_MAX) this.skidCount++;
  }

  update(dt, sim) {
    const c = sim.car;
    const speed = Math.hypot(c.vx, c.vy);
    const k = 1 - Math.exp(-5 * dt);
    this.cam.x += (c.x + c.vx * 0.35 - this.cam.x) * k;
    this.cam.y += (c.y + c.vy * 0.35 - this.cam.y) * k;
    const tz = 1.1 - 0.3 * Math.min(1, speed / PHYS.maxSpeed);
    this.cam.zoom += (tz - this.cam.zoom) * (1 - Math.exp(-2.5 * dt));

    // skid marks and tyre smoke while drifting
    if (c.drifting && speed > 120 && sim.dist <= this.track.halfWidth + 20) {
      const cos = Math.cos(c.a);
      const sin = Math.sin(c.a);
      for (let s = -1; s <= 1; s += 2) {
        const wx = c.x - cos * 20 - sin * 11 * s;
        const wy = c.y - sin * 20 + cos * 11 * s;
        const i = s < 0 ? 0 : 1;
        const lw = this.lastWheel[i];
        if (lw) this.addSkid(lw.x, lw.y, wx, wy);
        this.lastWheel[i] = { x: wx, y: wy };
        if (this.particles.length < 220 && Math.random() < 0.7) {
          this.particles.push({
            x: wx,
            y: wy,
            vx: (Math.random() - 0.5) * 50 - c.vx * 0.05,
            vy: (Math.random() - 0.5) * 50 - c.vy * 0.05,
            life: 0.6 + Math.random() * 0.4,
            max: 1,
            r: 6 + Math.random() * 6,
          });
        }
      }
    } else {
      this.lastWheel = [null, null];
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  draw(sim, ghostPose) {
    const { ctx, canvas, cam, track } = this;
    const W = canvas.width;
    const H = canvas.height;
    const z = cam.zoom * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#12281a';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(z, 0, 0, z, W / 2 - cam.x * z, H / 2 - cam.y * z);

    // grass
    const hw = W / 2 / z;
    const hh = H / 2 / z;
    ctx.fillStyle = this.grass;
    ctx.fillRect(cam.x - hw - 10, cam.y - hh - 10, hw * 2 + 20, hh * 2 + 20);

    // kerbs, asphalt, centre line
    const tw = track.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.lineWidth = tw + 26;
    ctx.setLineDash([26, 26]);
    ctx.strokeStyle = '#d8344b';
    ctx.lineDashOffset = 0;
    ctx.stroke(this.road);
    ctx.strokeStyle = '#f2f2f2';
    ctx.lineDashOffset = 26;
    ctx.stroke(this.road);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.lineWidth = tw;
    ctx.strokeStyle = '#33363e';
    ctx.stroke(this.road);
    ctx.lineWidth = 4;
    ctx.setLineDash([36, 46]);
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.stroke(this.road);
    ctx.setLineDash([]);

    // start / finish line
    ctx.save();
    ctx.translate(track.xs[0], track.ys[0]);
    ctx.rotate(track.ang[0]);
    const cell = 16;
    const cols = Math.ceil(tw / cell);
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillStyle = (r + c) % 2 ? '#111' : '#fff';
        ctx.fillRect(-cell + r * cell, -tw / 2 + c * cell, cell, cell);
      }
    }
    ctx.restore();

    // skid marks
    if (this.skidCount > 0) {
      ctx.strokeStyle = 'rgba(8,8,10,.35)';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < this.skidCount; i++) {
        const o = i * 4;
        ctx.moveTo(this.skids[o], this.skids[o + 1]);
        ctx.lineTo(this.skids[o + 2], this.skids[o + 3]);
      }
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // ghost, then you
    if (ghostPose) drawCar(ctx, ghostPose.x, ghostPose.y, ghostPose.a, '#7ee8ff', 0.45);
    const c = sim.car;
    drawCar(ctx, c.x, c.y, c.a, '#ff3d71', 1, c.boostT);

    // tyre smoke on top
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.fillStyle = `rgba(232,232,238,${(a * 0.45).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + (1 - a) * 18, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
