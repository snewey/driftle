import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hashString, mulberry32 } from './rng.js';
import { PHYS } from './sim.js';

// The sim works in a flat 2D plane (x, y, heading a). Here that maps onto the ground plane:
//   world x = sim x, world z = sim y, world y = up, car forward = (cos a, 0, sin a).
// One unit is roughly 8 cm, so the car is 56 long and the road is 160 wide.

const SKID_MAX = 2400;
const SMOKE_MAX = 140;
const ROAD_Y = 0.4;
const KERB_Y = 0.7;
const LINE_Y = 0.9;
const SKID_Y = 1.1;
const KERB_W = 14;

const THEMES = [
  {
    name: 'Clear day', skyTop: '#2c78d0', skyMid: '#8fc4f0', horizon: '#d3eafc', sun: '#fff4dd', sunI: 3.1,
    hemiSky: '#bcdcff', hemiGround: '#4a5d3a', hemiI: 1.15, sunEl: 48, sunAz: 35,
    grass: '#3f7d3b', foliage: ['#4f9a45', '#3f8a3d', '#5aa84d', '#3b7d3a'], mount: '#7d8fa8', cloud: 0.95,
  },
  {
    name: 'Golden hour', skyTop: '#35539a', skyMid: '#c98f86', horizon: '#ffc58f', sun: '#ffb070', sunI: 3.0,
    hemiSky: '#ffd3a8', hemiGround: '#4a4a30', hemiI: 0.95, sunEl: 13, sunAz: 200,
    grass: '#58723a', foliage: ['#5f8a3a', '#7b8f3a', '#4f7a35', '#8a8a3c'], mount: '#7b6f86', cloud: 0.8,
  },
  {
    name: 'Overcast', skyTop: '#8493a3', skyMid: '#b2bdc8', horizon: '#d2d9df', sun: '#e8eef5', sunI: 1.3,
    hemiSky: '#cfd8e0', hemiGround: '#445544', hemiI: 1.55, sunEl: 55, sunAz: 120,
    grass: '#3c5f3b', foliage: ['#3f7040', '#4a7a46', '#376838', '#527a4a'], mount: '#8a96a3', cloud: 1,
  },
  {
    name: 'Autumn', skyTop: '#4a8ccf', skyMid: '#a9cdea', horizon: '#eadfc6', sun: '#ffe9c4', sunI: 2.8,
    hemiSky: '#e6e0c8', hemiGround: '#5a4a2a', hemiI: 1.05, sunEl: 32, sunAz: 300,
    grass: '#6b7a3a', foliage: ['#c8651b', '#d99a2b', '#a8431f', '#8a9a3a', '#c94f2d'], mount: '#8f8472', cloud: 0.7,
  },
  {
    name: 'Dusk', skyTop: '#1d2150', skyMid: '#7a4a8a', horizon: '#ff8a68', sun: '#ff9a7a', sunI: 2.2,
    hemiSky: '#a58ac8', hemiGround: '#2c3a30', hemiI: 0.85, sunEl: 7, sunAz: 80,
    grass: '#2f5a3a', foliage: ['#2f6a45', '#3a7a4f', '#285c3d'], mount: '#4a4a78', cloud: 0.6,
  },
];

const wrap = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// ---- procedural textures ---------------------------------------------------

function asphaltTexture() {
  const c = makeCanvas(256, 512);
  const g = c.getContext('2d');
  const r = mulberry32(11);
  g.fillStyle = '#3b3e46';
  g.fillRect(0, 0, 256, 512);
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.14)';
    g.fillRect(r() * 256, r() * 512, 1 + r() * 2, 1 + r() * 2);
  }
  g.fillStyle = 'rgba(0,0,0,.12)'; // darker rubbered-in wheel lines
  g.fillRect(256 * 0.27, 0, 256 * 0.13, 512);
  g.fillRect(256 * 0.6, 0, 256 * 0.13, 512);
  g.fillStyle = '#ececec'; // edge lines
  g.fillRect(256 * 0.03, 0, 256 * 0.022, 512);
  g.fillRect(256 * 0.948, 0, 256 * 0.022, 512);
  g.fillStyle = 'rgba(255,255,255,.85)'; // centre dashes
  g.fillRect(256 * 0.49, 0, 256 * 0.022, 190);
  return c;
}

function grassTexture(base) {
  const c = makeCanvas(512, 512);
  const g = c.getContext('2d');
  const r = mulberry32(23);
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 70; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const rad = 40 + r() * 90;
    const light = r() < 0.5;
    for (const dx of [-512, 0, 512]) {
      for (const dy of [-512, 0, 512]) {
        const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rad);
        gr.addColorStop(0, light ? 'rgba(180,230,120,.16)' : 'rgba(0,20,0,.20)');
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x + dx - rad, y + dy - rad, rad * 2, rad * 2);
      }
    }
  }
  for (let i = 0; i < 9000; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(200,255,150,.10)' : 'rgba(0,25,0,.18)';
    g.fillRect(r() * 512, r() * 512, 1, 2 + r() * 4);
  }
  return c;
}

function kerbTexture() {
  const c = makeCanvas(32, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#d3303f';
  g.fillRect(0, 0, 32, 64);
  g.fillStyle = '#f3f3f3';
  g.fillRect(0, 64, 32, 64);
  return c;
}

function foliageTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const r = mulberry32(5);
  g.fillStyle = '#c4c4c4';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const v = 110 + Math.floor(r() * 130);
    g.fillStyle = `rgba(${v},${v},${v},.55)`;
    g.beginPath();
    g.ellipse(r() * 128, r() * 128, 2 + r() * 5, 1 + r() * 3, r() * 3, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

function barkTexture() {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const r = mulberry32(9);
  g.fillStyle = '#6b4a30';
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(30,15,5,.45)' : 'rgba(170,120,80,.35)';
    g.fillRect(r() * 64, 0, 1 + r() * 2, 64);
  }
  return c;
}

function rimTexture() {
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  g.fillStyle = '#17181c';
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#c9ced6';
  g.lineWidth = 6;
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    g.beginPath();
    g.moveTo(32, 32);
    g.lineTo(32 + Math.cos(a) * 24, 32 + Math.sin(a) * 24);
    g.stroke();
  }
  g.beginPath();
  g.arc(32, 32, 26, 0, Math.PI * 2);
  g.lineWidth = 3;
  g.stroke();
  g.fillStyle = '#c9ced6';
  g.beginPath();
  g.arc(32, 32, 6, 0, Math.PI * 2);
  g.fill();
  return c;
}

function checkerTexture() {
  const c = makeCanvas(32, 160);
  const g = c.getContext('2d');
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 2; col++) {
      g.fillStyle = (row + col) % 2 ? '#111' : '#fff';
      g.fillRect(col * 16, row * 16, 16, 16);
    }
  }
  return c;
}

function bannerTexture() {
  const c = makeCanvas(1024, 128);
  const g = c.getContext('2d');
  g.fillStyle = '#10141c';
  g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#ff3d71';
  g.fillRect(0, 0, 1024, 10);
  g.fillRect(0, 118, 1024, 10);
  g.font = 'italic 800 86px ui-monospace, Menlo, Consolas, monospace';
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  const w1 = g.measureText('DRIFT').width;
  const w2 = g.measureText('LE').width;
  const x0 = (1024 - (w1 + w2)) / 2;
  g.fillStyle = '#ffffff';
  g.fillText('DRIFT', x0, 68);
  g.fillStyle = '#ff3d71';
  g.fillText('LE', x0 + w1, 68);
  return c;
}

function crowdTexture() {
  const c = makeCanvas(512, 64);
  const g = c.getContext('2d');
  const r = mulberry32(31);
  g.fillStyle = '#2a2d36';
  g.fillRect(0, 0, 512, 64);
  const cols = ['#ff3d71', '#7ee8ff', '#ffd34d', '#ffffff', '#5dffa0', '#b58cff', '#ff9f43'];
  for (let y = 4; y < 60; y += 7) {
    for (let x = 3; x < 510; x += 6) {
      g.fillStyle = cols[Math.floor(r() * cols.length)];
      g.fillRect(x, y, 3, 4);
      g.fillStyle = '#d9b99b';
      g.fillRect(x, y - 2, 3, 2);
    }
  }
  return c;
}

function softBlobTexture(stops) {
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  stops.forEach(([o, col]) => gr.addColorStop(o, col));
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  return c;
}

function cloudTexture() {
  const c = makeCanvas(256, 128);
  const g = c.getContext('2d');
  const r = mulberry32(77);
  for (let i = 0; i < 16; i++) {
    const x = 40 + r() * 176;
    const y = 50 + r() * 40;
    const rad = 22 + r() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,.55)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  return c;
}

function skyTexture(theme) {
  const c = makeCanvas(8, 512);
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 512);
  gr.addColorStop(0, theme.skyTop);
  gr.addColorStop(0.32, theme.skyMid);
  gr.addColorStop(0.5, theme.horizon);
  gr.addColorStop(1, theme.horizon);
  g.fillStyle = gr;
  g.fillRect(0, 0, 8, 512);
  return c;
}

// ---- geometry helpers ------------------------------------------------------

/** A flat strip following the track between two lateral offsets. v runs along the track. */
function ribbon(track, off0, off1, y, texLen) {
  const n = track.n;
  const pos = new Float32Array((n + 1) * 6);
  const uv = new Float32Array((n + 1) * 4);
  const nor = new Float32Array((n + 1) * 6);
  const idx = [];
  for (let i = 0; i <= n; i++) {
    const k = i % n;
    const a = track.ang[k];
    const nx = -Math.sin(a);
    const nz = Math.cos(a);
    const x = track.xs[k];
    const z = track.ys[k];
    const v = (i * track.spacing) / texLen;
    pos.set([x + nx * off0, y, z + nz * off0, x + nx * off1, y, z + nz * off1], i * 6);
    uv.set([0, v, 1, v], i * 4);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    if (i < n) {
      const a0 = i * 2;
      idx.push(a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(idx);
  return geo;
}

function buildCar(bodyColor, ghost, rimMap) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const ghostMat = ghost
    ? new THREE.MeshBasicMaterial({ color: 0x7ee8ff, transparent: true, opacity: 0.4, depthWrite: false })
    : null;
  const lambert = (color) => ghostMat || new THREE.MeshLambertMaterial({ color });
  const basic = (color) => ghostMat || new THREE.MeshBasicMaterial({ color });
  const add = (parent, w, h, d, x, y, z, mat) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = !ghost;
    parent.add(m);
    return m;
  };

  const paint = lambert(bodyColor);
  const dark = lambert(0x15181f);
  add(body, 56, 9, 28, 0, 10.5, 0, paint);
  add(body, 22, 8, 22, -5, 19, 0, lambert(0x182433));
  add(body, 20, 1.6, 20, -5, 23.4, 0, paint);
  add(body, 4, 5, 30, 28, 8, 0, dark);
  add(body, 4, 5, 30, -28, 8, 0, dark);
  add(body, 7, 1.5, 32, -26, 22.5, 0, paint);
  add(body, 2, 6, 2, -26, 19, 9, dark);
  add(body, 2, 6, 2, -26, 19, -9, dark);
  if (!ghost) add(body, 30, 0.4, 5, 12, 15.2, 0, basic(0xf4f4f4));
  add(body, 1.5, 3, 5, 28.4, 12, 9, basic(0xfff2b0));
  add(body, 1.5, 3, 5, 28.4, 12, -9, basic(0xfff2b0));
  add(body, 1.5, 3, 6, -28.4, 12, 9, basic(0xff2b2b));
  add(body, 1.5, 3, 6, -28.4, 12, -9, basic(0xff2b2b));

  const wheelGeo = new THREE.CylinderGeometry(7, 7, 6, 18);
  wheelGeo.rotateX(Math.PI / 2); // axle along the car's sideways (z) axis
  const tire = ghost ? ghostMat : new THREE.MeshLambertMaterial({ color: 0x15161a });
  const rim = ghost ? ghostMat : new THREE.MeshLambertMaterial({ map: rimMap });
  const wheels = [];
  const frontPivots = [];
  for (const [x, z] of [[17, 15], [17, -15], [-17, 15], [-17, -15]]) {
    const m = new THREE.Mesh(wheelGeo, [tire, rim, rim]);
    m.castShadow = !ghost;
    wheels.push(m);
    if (x > 0) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 7, z);
      pivot.add(m);
      body.add(pivot);
      frontPivots.push(pivot);
    } else {
      m.position.set(x, 7, z);
      body.add(m);
    }
  }

  const flame = new THREE.Group();
  if (!ghost) {
    const outer = new THREE.MeshBasicMaterial({ color: 0xff9f43, transparent: true, opacity: 0.9 });
    const inner = new THREE.MeshBasicMaterial({ color: 0xfff3b0, transparent: true, opacity: 0.95 });
    for (const z of [-9, 9]) {
      const a = new THREE.ConeGeometry(4.5, 30, 8);
      a.rotateZ(Math.PI / 2);
      const m1 = new THREE.Mesh(a, outer);
      m1.position.set(-44, 10, z);
      const b = new THREE.ConeGeometry(2.4, 18, 8);
      b.rotateZ(Math.PI / 2);
      const m2 = new THREE.Mesh(b, inner);
      m2.position.set(-38, 10, z);
      flame.add(m1, m2);
    }
    flame.visible = false;
    body.add(flame);
  }
  return { root, body, wheels, frontPivots, flame };
}

// ---- the renderer ----------------------------------------------------------

export class Renderer {
  constructor(canvas, track) {
    this.canvas = canvas;
    this.track = track;
    this.theme = THEMES[Math.floor(mulberry32(hashString('theme:' + track.dayKey))() * THEMES.length)];
    this.themeName = this.theme.name;
    this.orbit = false;
    this.orbitT = 0;
    this.yaw = 0;
    this.spin = 0;
    this.shakeT = 0;

    const gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    this.gl = gl;
    this.aniso = Math.min(8, gl.capabilities.getMaxAnisotropy());

    const fogColor = new THREE.Color(this.theme.horizon);
    this.scene = new THREE.Scene();
    this.scene.background = fogColor;
    this.scene.fog = new THREE.Fog(fogColor, 1400, 7200);
    this.camera = new THREE.PerspectiveCamera(62, 1, 3, 11500);

    this.buildSky();
    this.buildLights();
    this.buildGround();
    this.buildRoad();
    this.buildScenery();
    this.buildCars();
    this.buildEffects();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  tex(canvas, { repeat = true, srgb = true } = {}) {
    const t = new THREE.CanvasTexture(canvas);
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.aniso;
    return t;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- world ----

  buildSky() {
    const th = this.theme;
    this.skyGroup = new THREE.Group();
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(9500, 24, 16),
      new THREE.MeshBasicMaterial({ map: this.tex(skyTexture(th), { repeat: false }), side: THREE.BackSide, fog: false, depthWrite: false, depthTest: false }),
    );
    dome.renderOrder = -100;
    this.skyGroup.add(dome);

    const el = (th.sunEl * Math.PI) / 180;
    const az = (th.sunAz * Math.PI) / 180;
    this.sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const sunTex = this.tex(softBlobTexture([[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,250,230,.95)'], [0.3, 'rgba(255,220,160,.35)'], [1, 'rgba(255,200,120,0)']]), { repeat: false });
    const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, color: new THREE.Color(th.sun), fog: false, depthWrite: false, transparent: true }));
    sun.position.copy(this.sunDir).multiplyScalar(8600);
    sun.scale.set(2200, 2200, 1);
    this.skyGroup.add(sun);

    const cloudTex = this.tex(cloudTexture(), { repeat: false });
    const r = mulberry32(hashString('clouds:' + this.track.dayKey));
    for (let i = 0; i < 16; i++) {
      const a = r() * Math.PI * 2;
      const elev = 0.12 + r() * 0.4;
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: cloudTex, opacity: th.cloud * (0.55 + r() * 0.45), fog: false, depthWrite: false, transparent: true }));
      m.position.set(Math.cos(a) * 8200, elev * 8200 * 0.6 + 700, Math.sin(a) * 8200);
      const s = 1700 + r() * 1800;
      m.scale.set(s, s * 0.45, 1);
      this.skyGroup.add(m);
    }
    this.scene.add(this.skyGroup);
  }

  buildLights() {
    const th = this.theme;
    this.scene.add(new THREE.HemisphereLight(new THREE.Color(th.hemiSky), new THREE.Color(th.hemiGround), th.hemiI));
    const sun = new THREE.DirectionalLight(new THREE.Color(th.sun), th.sunI);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -460;
    sc.right = 460;
    sc.top = 460;
    sc.bottom = -460;
    sc.near = 10;
    sc.far = 3600;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.8;
    this.sun = sun;
    this.scene.add(sun, sun.target);
  }

  buildGround() {
    const t = this.tex(grassTexture(this.theme.grass));
    t.repeat.set(70, 70);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(28000, 28000), new THREE.MeshLambertMaterial({ map: t }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);
    this.ground = ground;
  }

  buildRoad() {
    const T = this.track;
    const roadLen = T.length / Math.max(1, Math.round(T.length / 320));
    const kerbLen = T.length / Math.max(1, Math.round(T.length / 56));

    const road = new THREE.Mesh(
      ribbon(T, -T.halfWidth, T.halfWidth, ROAD_Y, roadLen),
      new THREE.MeshLambertMaterial({ map: this.tex(asphaltTexture()) }),
    );
    road.receiveShadow = true;
    this.scene.add(road);

    const kerbMat = new THREE.MeshLambertMaterial({ map: this.tex(kerbTexture()) });
    for (const [a, b] of [[T.halfWidth, T.halfWidth + KERB_W], [-T.halfWidth - KERB_W, -T.halfWidth]]) {
      const k = new THREE.Mesh(ribbon(T, a, b, KERB_Y, kerbLen), kerbMat);
      k.receiveShadow = true;
      this.scene.add(k);
    }

    // start / finish line
    const line = new THREE.Mesh(
      new THREE.PlaneGeometry(32, T.width).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: this.tex(checkerTexture(), { repeat: false }) }),
    );
    line.position.set(T.xs[0], LINE_Y, T.ys[0]);
    line.rotation.y = -T.ang[0];
    line.receiveShadow = true;
    this.scene.add(line);
  }

  buildScenery() {
    const T = this.track;
    const th = this.theme;
    const rng = mulberry32(hashString('mountains:' + T.dayKey));

    // trees come from the shared scenery list, which the sim also collides with
    const pineT = T.scenery.trees.filter((t) => t.kind === 0);
    const roundT = T.scenery.trees.filter((t) => t.kind === 1);

    const barkMat = new THREE.MeshLambertMaterial({ map: this.tex(barkTexture()) });
    const leafMat = new THREE.MeshLambertMaterial({ map: this.tex(foliageTexture()) });
    const cone = (r, h, y) => new THREE.ConeGeometry(r, h, 9).translate(0, y, 0);
    const pineFoliage = mergeGeometries([cone(27, 56, 50), cone(22, 50, 74), cone(15, 44, 98)]);
    const pineTrunk = new THREE.CylinderGeometry(3, 4, 30, 7).translate(0, 15, 0);
    const roundFoliage = new THREE.IcosahedronGeometry(31, 1).translate(0, 58, 0);
    const roundTrunk = new THREE.CylinderGeometry(3.5, 4.5, 38, 7).translate(0, 19, 0);

    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const fill = (list, geoLeaf, geoTrunk) => {
      if (!list.length) return;
      const leaf = new THREE.InstancedMesh(geoLeaf, leafMat, list.length);
      const trunk = new THREE.InstancedMesh(geoTrunk, barkMat, list.length);
      list.forEach((t, i) => {
        dummy.position.set(t.x, 0, t.z);
        dummy.rotation.set(0, t.r, 0);
        dummy.scale.set(t.s, t.s * (0.9 + (i % 5) * 0.05), t.s);
        dummy.updateMatrix();
        leaf.setMatrixAt(i, dummy.matrix);
        trunk.setMatrixAt(i, dummy.matrix);
        col.set(th.foliage[Math.floor(t.c * th.foliage.length)]).offsetHSL(0, 0, t.l);
        leaf.setColorAt(i, col);
      });
      for (const m of [leaf, trunk]) {
        m.castShadow = true;
        m.frustumCulled = false;
        this.scene.add(m);
      }
    };
    fill(pineT, pineFoliage, pineTrunk);
    fill(roundT, roundFoliage, roundTrunk);
    this.treeCount = pineT.length + roundT.length;

    // start gantry and grandstand, built in the track's local frame (+x along the road, +z to its right)
    const frame = new THREE.Group();
    frame.position.set(T.xs[0], 0, T.ys[0]);
    frame.rotation.y = -T.ang[0];
    const steel = new THREE.MeshLambertMaterial({ color: 0x2b2f3a });
    const bannerMap = this.tex(bannerTexture(), { repeat: false });
    const bannerMat = new THREE.MeshBasicMaterial({ map: bannerMap });
    const span = T.width + 44;
    for (const z of [-span / 2, span / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(8, 96, 8), steel);
      post.position.set(0, 48, z);
      post.castShadow = true;
      frame.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(8, 30, span + 8), [bannerMat, bannerMat, steel, steel, steel, steel]);
    beam.position.set(0, 98, 0);
    beam.castShadow = true;
    frame.add(beam);

    const crowdMap = this.tex(crowdTexture(), { repeat: false });
    const standMat = new THREE.MeshLambertMaterial({ color: 0x777c88 });
    const crowdMat = new THREE.MeshLambertMaterial({ map: crowdMap });
    const stand = new THREE.Mesh(new THREE.BoxGeometry(220, 42, 40), [standMat, standMat, standMat, standMat, standMat, crowdMat]);
    stand.position.set(70, 21, T.halfWidth + KERB_W + 70);
    stand.castShadow = true;
    frame.add(stand);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(230, 3, 50), new THREE.MeshLambertMaterial({ color: 0xd8dbe2 }));
    roof.position.set(70, 62, T.halfWidth + KERB_W + 66);
    roof.castShadow = true;
    frame.add(roof);
    for (const x of [-30, 170]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(4, 42, 4), steel);
      leg.position.set(x, 41, T.halfWidth + KERB_W + 48);
      frame.add(leg);
    }
    this.scene.add(frame);

    // distant mountains
    const mm = new THREE.MeshLambertMaterial({ color: new THREE.Color(th.mount), flatShading: true });
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rng() * 0.1;
      const rad = 6300 + rng() * 1500;
      const h = 500 + rng() * 1300;
      const m = new THREE.Mesh(new THREE.ConeGeometry(500 + rng() * 700, h, 6 + Math.floor(rng() * 3)), mm);
      m.position.set(T.xs[0] + Math.cos(a) * rad, h / 2 - 30, T.ys[0] + Math.sin(a) * rad);
      m.rotation.y = rng() * 6;
      this.scene.add(m);
    }
  }

  buildCars() {
    const rim = this.tex(rimTexture(), { repeat: false });
    this.car = buildCar(0xff3d71, false, rim);
    this.car.root.position.y = ROAD_Y;
    this.scene.add(this.car.root);
    this.ghost = buildCar(0x7ee8ff, true, rim);
    this.ghost.root.position.y = ROAD_Y;
    this.ghost.root.visible = false;
    this.scene.add(this.ghost.root);
  }

  buildEffects() {
    // skid marks: one big preallocated buffer used as a ring
    this.skidPos = new Float32Array(SKID_MAX * 18);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.skidPos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.skidGeo = geo;
    const skid = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x050506, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide }));
    skid.frustumCulled = false;
    skid.renderOrder = 2;
    this.scene.add(skid);
    this.skidHead = 0;
    this.skidCount = 0;
    this.lastWheel = [null, null];

    // tyre smoke: a pool of soft sprites
    const smokeTex = this.tex(softBlobTexture([[0, 'rgba(255,255,255,.9)'], [0.5, 'rgba(255,255,255,.4)'], [1, 'rgba(255,255,255,0)']]), { repeat: false });
    this.smoke = [];
    for (let i = 0; i < SMOKE_MAX; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xe6e6ee, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false;
      s.renderOrder = 3;
      this.scene.add(s);
      this.smoke.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, r: 20 });
    }
    this.smokeNext = 0;
  }

  // ---- per frame ----

  reset(sim) {
    const c = sim.car;
    this.yaw = c.a;
    this.spin = 0;
    this.shakeT = 0;
    this.skidHead = 0;
    this.skidCount = 0;
    this.skidGeo.setDrawRange(0, 0);
    this.lastWheel = [null, null];
    for (const p of this.smoke) {
      p.life = 0;
      p.s.visible = false;
    }
  }

  addSkid(x1, z1, x2, z2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.01 || len > 120) return;
    const px = (-dz / len) * 2.6;
    const pz = (dx / len) * 2.6;
    const o = this.skidHead * 18;
    const p = this.skidPos;
    const v = [x1 + px, SKID_Y, z1 + pz, x1 - px, SKID_Y, z1 - pz, x2 - px, SKID_Y, z2 - pz, x1 + px, SKID_Y, z1 + pz, x2 - px, SKID_Y, z2 - pz, x2 + px, SKID_Y, z2 + pz];
    for (let i = 0; i < 18; i++) p[o + i] = v[i];
    this.skidHead = (this.skidHead + 1) % SKID_MAX;
    if (this.skidCount < SKID_MAX) this.skidCount++;
    this.skidDirty = true;
  }

  spawnSmoke(x, z, vx, vz) {
    const p = this.smoke[this.smokeNext];
    this.smokeNext = (this.smokeNext + 1) % SMOKE_MAX;
    p.life = p.max = 0.7 + Math.random() * 0.5;
    p.r = 16 + Math.random() * 12;
    p.vx = (Math.random() - 0.5) * 40 - vx * 0.06;
    p.vz = (Math.random() - 0.5) * 40 - vz * 0.06;
    p.vy = 14 + Math.random() * 16;
    p.s.position.set(x, 12, z);
    p.s.visible = true;
  }

  update(dt, sim) {
    const c = sim.car;
    const cam = this.camera;
    const speed = Math.hypot(c.vx, c.vy);
    const cos = Math.cos(c.a);
    const sin = Math.sin(c.a);
    const sf = Math.min(1.2, speed / PHYS.maxSpeed);

    // ---- camera ----
    if (this.orbit) {
      this.orbitT += dt * 0.16;
      const R = 390;
      cam.position.set(c.x + Math.cos(this.orbitT) * R, 120, c.y + Math.sin(this.orbitT) * R);
      cam.lookAt(c.x, 40, c.y);
      this.setFov(52, dt);
    } else {
      const fwd = c.vx * cos + c.vy * sin;
      let target = c.a;
      if (speed > 60 && fwd > 0) target = c.a + wrap(Math.atan2(c.vy, c.vx) - c.a) * 0.45;
      this.yaw += wrap(target - this.yaw) * (1 - Math.exp(-7 * dt));
      const yc = Math.cos(this.yaw);
      const ys = Math.sin(this.yaw);
      const dist = 122 + 42 * sf;
      const h = 46 + 12 * sf;
      const shake = (c.boostT > 0 ? 1.4 : 0) + this.shakeT * 16;
      this.shakeT = Math.max(0, this.shakeT - dt * 2.5);
      cam.position.set(c.x - yc * dist + (Math.random() - 0.5) * shake, h + (Math.random() - 0.5) * shake, c.y - ys * dist + (Math.random() - 0.5) * shake);
      cam.lookAt(c.x + yc * 80, 15, c.y + ys * 80);
      this.setFov(60 + 15 * Math.min(1, sf) + (c.boostT > 0 ? 8 : 0), dt);
    }

    // ---- sun and shadows follow the car ----
    this.sun.target.position.set(c.x, 0, c.y);
    this.sun.position.set(c.x, 0, c.y).addScaledVector(this.sunDir, 1500);
    this.skyGroup.position.copy(cam.position);

    // ---- skid marks and smoke ----
    const onRoad = sim.dist <= this.track.halfWidth + 20;
    if (c.drifting && speed > 120 && onRoad) {
      for (let s = -1; s <= 1; s += 2) {
        const wx = c.x - cos * 20 - sin * 11 * s;
        const wz = c.y - sin * 20 + cos * 11 * s;
        const i = s < 0 ? 0 : 1;
        const lw = this.lastWheel[i];
        if (lw) this.addSkid(lw.x, lw.z, wx, wz);
        this.lastWheel[i] = { x: wx, z: wz };
        if (Math.random() < 0.8) this.spawnSmoke(wx, wz, c.vx, c.vy);
      }
    } else {
      this.lastWheel = [null, null];
    }
    if (this.skidDirty) {
      this.skidGeo.attributes.position.needsUpdate = true;
      this.skidGeo.setDrawRange(0, this.skidCount * 6);
      this.skidDirty = false;
    }
    for (const p of this.smoke) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      const a = p.life / p.max;
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      p.s.material.opacity = a * 0.5;
      const sc = p.r * (1 + (1 - a) * 2.2);
      p.s.scale.set(sc, sc, 1);
      // keep the puff above the road so the ground never slices it off
      if (p.s.position.y < sc * 0.5 + 1) p.s.position.y = sc * 0.5 + 1;
    }

    // ---- wheels roll with the car ----
    const fwdSpeed = c.vx * cos + c.vy * sin;
    this.spin -= (fwdSpeed * dt) / 7;
  }

  /** Camera jolt, 0 to 1, for crashes. */
  kick(amount) {
    this.shakeT = Math.max(this.shakeT, amount);
  }

  setFov(target, dt) {
    const cam = this.camera;
    const f = cam.fov + (target - cam.fov) * (1 - Math.exp(-4 * dt));
    if (Math.abs(f - cam.fov) > 0.01) {
      cam.fov = f;
      cam.updateProjectionMatrix();
    }
  }

  poseCar(car, x, z, a, steer, roll, spin) {
    car.root.position.x = x;
    car.root.position.z = z;
    car.root.rotation.y = -a;
    car.body.rotation.x = roll;
    for (const p of car.frontPivots) p.rotation.y = -steer * 0.45;
    for (const w of car.wheels) w.rotation.z = spin;
  }

  draw(sim, ghostPose) {
    const c = sim.car;
    const sf = Math.min(1, Math.hypot(c.vx, c.vy) / PHYS.maxSpeed);
    const roll = -c.steer * sf * 0.07 + c.beta * 0.04;
    this.poseCar(this.car, c.x, c.y, c.a, c.steer, roll, this.spin);
    const flame = this.car.flame;
    flame.visible = c.boostT > 0;
    if (flame.visible) flame.scale.set(0.8 + Math.random() * 0.5, 1, 1);

    if (ghostPose) {
      this.ghost.root.visible = true;
      this.poseCar(this.ghost, ghostPose.x, ghostPose.y, ghostPose.a, 0, 0, this.spin);
    } else {
      this.ghost.root.visible = false;
    }
    this.gl.render(this.scene, this.camera);
  }
}
