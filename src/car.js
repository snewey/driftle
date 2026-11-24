import * as THREE from 'three';
import { cleanLoadout, itemById, GLOW_COLORS } from './catalog.js';

// Builds a car from a loadout (which body, paint, wheels, spoiler, exhaust, flame colour,
// underglow) plus the player's two drawings. Browser only. Every body keeps the same wheel
// positions and size so cars only differ in looks, never in how they drive or collide.

export const DECAL_SIZE = { side: [512, 192], top: [256, 448] };
// The drawings are wrapped onto the painted panels: "side" covers both flanks (mirrored so writing
// reads correctly on each side), "top" covers bonnet, roof and boot.
const SX0 = -28;
const SX1 = 28;
const SY0 = 4;
const SY1 = 25;
const TZ = 16;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function blankDecals() {
  return { side: makeCanvas(...DECAL_SIZE.side), top: makeCanvas(...DECAL_SIZE.top) };
}

/** Turns a saved PNG data URL back into a canvas of the right size (blank if empty or broken). */
export function loadDecal(dataUrl, which) {
  const [w, h] = DECAL_SIZE[which];
  const c = makeCanvas(w, h);
  if (!dataUrl) return Promise.resolve(c);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(c);
    };
    img.onerror = () => resolve(c);
    img.src = dataUrl;
  });
}

export function decalIsBlank(canvas) {
  const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
  return true;
}

// ---- small textures ---------------------------------------------------------

const rimCache = new Map();
function rimTexture(id) {
  if (rimCache.has(id)) return rimCache.get(id);
  const c = makeCanvas(64, 64);
  const g = c.getContext('2d');
  const disc = (r, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    g.arc(32, 32, r, 0, Math.PI * 2);
    g.fill();
  };
  const spokes = (n, len, width, color) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      g.beginPath();
      g.moveTo(32, 32);
      g.lineTo(32 + Math.cos(a) * len, 32 + Math.sin(a) * len);
      g.stroke();
    }
  };
  const ring = (r, width, color) => {
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.arc(32, 32, r, 0, Math.PI * 2);
    g.stroke();
  };
  g.fillStyle = '#17181c';
  g.fillRect(0, 0, 64, 64);
  if (id === 'whl_sport') {
    spokes(5, 24, 6, '#e3e8ef');
    ring(26, 3, '#e3e8ef');
    disc(6, '#e3e8ef');
  } else if (id === 'whl_gold') {
    disc(28, '#2a2210');
    for (let i = 0; i < 12; i++) spokes(12, 26, 2, '#e8b43a');
    ring(27, 4, '#f5cf62');
    disc(7, '#f5cf62');
  } else if (id === 'whl_blue' || id === 'whl_pink') {
    const col = id === 'whl_blue' ? '#35a7ff' : '#ff4fa3';
    g.shadowColor = col;
    g.shadowBlur = 8;
    spokes(6, 22, 4, col);
    ring(25, 4, col);
    disc(5, col);
  } else {
    // steelies: plain grey with bolt holes
    disc(27, '#555b66');
    disc(20, '#6b727e');
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      g.fillStyle = '#1a1c21';
      g.beginPath();
      g.arc(32 + Math.cos(a) * 11, 32 + Math.sin(a) * 11, 3, 0, Math.PI * 2);
      g.fill();
    }
    disc(4, '#2b2e35');
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  rimCache.set(id, t);
  return t;
}

let glowTex = null;
function glowTexture() {
  if (glowTex) return glowTex;
  const c = makeCanvas(128, 128);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,.95)');
  grad.addColorStop(0.5, 'rgba(255,255,255,.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

// ---- paint with the drawings on top ------------------------------------------

function paintMaterial(item, decalTex) {
  const color = item.color;
  let m;
  if (item.finish === 'matte') m = new THREE.MeshLambertMaterial({ color });
  else if (item.finish === 'metal') m = new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x888888 });
  else if (item.finish === 'chrome') m = new THREE.MeshPhongMaterial({ color, shininess: 150, specular: 0xffffff });
  else m = new THREE.MeshPhongMaterial({ color, shininess: 55, specular: 0x333333 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uSide = { value: decalTex.side };
    shader.uniforms.uTop = { value: decalTex.top };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aDecal;\nvarying vec3 vDecal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDecal = aDecal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uSide;\nuniform sampler2D uTop;\nvarying vec3 vDecal;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nif (vDecal.z < 1.5) { vec4 dc = vDecal.z < 0.5 ? texture2D(uSide, vDecal.xy) : texture2D(uTop, vDecal.xy); diffuseColor.rgb = mix(diffuseColor.rgb, dc.rgb, dc.a); }'
      );
  };
  m.customProgramCacheKey = () => 'driftle-decal-' + m.type;
  return m;
}

/** Per-vertex drawing coordinates for a painted box, in the car's own space. */
function addDecalCoords(mesh) {
  const geo = mesh.geometry;
  const pos = geo.attributes.position;
  const nor = geo.attributes.normal;
  const out = new Float32Array(pos.count * 3);
  const cl = (v) => Math.min(1, Math.max(0, v));
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i) + mesh.position.x;
    const py = pos.getY(i) + mesh.position.y;
    const pz = pos.getZ(i) + mesh.position.z;
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    if (Math.abs(nz) > 0.5) {
      const u = (px - SX0) / (SX1 - SX0);
      out[i * 3] = cl(nz > 0 ? u : 1 - u);
      out[i * 3 + 1] = cl((py - SY0) / (SY1 - SY0));
      out[i * 3 + 2] = 0;
    } else if (ny > 0.5) {
      out[i * 3] = cl((pz + TZ) / (2 * TZ));
      out[i * 3 + 1] = cl((px - SX0) / (SX1 - SX0));
      out[i * 3 + 2] = 1;
    } else {
      out[i * 3 + 2] = 2;
    }
    void nx;
  }
  geo.setAttribute('aDecal', new THREE.BufferAttribute(out, 3));
}

// ---- bodies ---------------------------------------------------------------------
// Each returns where the rear deck is, so spoilers and exhausts line up.

const BODIES = {
  car_hatch(k) {
    k.paint(56, 9, 28, 0, 10.5, 0);
    k.glass(22, 8, 22, -5, 19, 0);
    k.paint(20, 1.6, 20, -5, 23.4, 0);
    k.dark(4, 5, 30, 28, 8, 0);
    k.dark(4, 5, 30, -28, 8, 0);
    if (!k.ghost) k.basic(0xf4f4f4, 30, 0.4, 5, 12, 15.2, 0);
    k.basic(0xfff2b0, 1.5, 3, 5, 28.4, 12, 9);
    k.basic(0xfff2b0, 1.5, 3, 5, 28.4, 12, -9);
    k.basic(0xff2b2b, 1.5, 3, 6, -28.4, 12, 9);
    k.basic(0xff2b2b, 1.5, 3, 6, -28.4, 12, -9);
    return { deckY: 15, spoilerX: -26, span: 32, tailX: -28, pipeY: 8, halfW: 14 };
  },
  car_coupe(k) {
    k.paint(58, 7, 28, 0, 9.5, 0);
    k.glass(18, 6, 21, -7, 16, 0);
    k.paint(16, 1.4, 20, -7, 19.7, 0);
    k.paint(26, 1.2, 26, 14, 13.4, 0);
    k.dark(3, 4, 28, 29, 8, 0);
    k.dark(3, 4, 28, -29, 8, 0);
    k.basic(0xfff2b0, 1.5, 2.5, 6, 29.4, 10.5, 9);
    k.basic(0xfff2b0, 1.5, 2.5, 6, 29.4, 10.5, -9);
    k.basic(0xff2b2b, 1.2, 2, 24, -29.6, 11, 0);
    return { deckY: 13, spoilerX: -27, span: 30, tailX: -29, pipeY: 7.4, halfW: 14 };
  },
  car_muscle(k) {
    k.paint(58, 10, 30, 0, 11, 0);
    k.glass(20, 7, 23, -8, 19.5, 0);
    k.paint(18, 1.6, 22, -8, 23.8, 0);
    k.paint(12, 3, 10, 14, 17.5, 0);
    k.dark(8, 0.6, 6, 14, 19.1, 0);
    k.dark(4, 6, 32, 29, 8, 0);
    k.dark(4, 6, 32, -29, 8, 0);
    k.basic(0xfff2b0, 1.5, 4, 5, 29.9, 13, 10);
    k.basic(0xfff2b0, 1.5, 4, 5, 29.9, 13, -10);
    k.basic(0xff2b2b, 1.5, 4, 7, -29.9, 13.5, 10);
    k.basic(0xff2b2b, 1.5, 4, 7, -29.9, 13.5, -10);
    return { deckY: 16, spoilerX: -27, span: 34, tailX: -29, pipeY: 8, halfW: 15 };
  },
  car_pickup(k) {
    k.paint(58, 9, 28, 0, 10.5, 0);
    k.glass(18, 9, 23, 6, 19.5, 0);
    k.paint(18, 1.4, 22, 6, 24.2, 0);
    k.paint(2, 6, 26, -28, 18, 0);
    k.paint(24, 6, 2, -16, 18, 13);
    k.paint(24, 6, 2, -16, 18, -13);
    k.dark(26, 1, 26, -16, 15.2, 0);
    k.dark(4, 5, 30, 29, 8, 0);
    k.dark(4, 5, 30, -29, 8, 0);
    k.basic(0xfff2b0, 1.5, 3, 5, 29.4, 12, 9);
    k.basic(0xfff2b0, 1.5, 3, 5, 29.4, 12, -9);
    k.basic(0xff2b2b, 1.5, 3, 5, -29.4, 12, 9);
    k.basic(0xff2b2b, 1.5, 3, 5, -29.4, 12, -9);
    return { deckY: 21, spoilerX: -27, span: 28, tailX: -29, pipeY: 7.6, halfW: 14 };
  },
  car_wedge(k) {
    k.paint(58, 6, 32, 0, 9, 0);
    k.glass(16, 5, 18, -4, 14.5, 0);
    k.paint(15, 1.2, 17, -4, 17.2, 0);
    k.paint(14, 1.2, 28, -20, 12.6, 0);
    k.dark(5, 1.5, 34, 29, 6.8, 0);
    k.dark(4, 3, 30, -29, 8, 0);
    k.dark(10, 3, 1, -8, 10, 16.2);
    k.dark(10, 3, 1, -8, 10, -16.2);
    k.basic(0xfff2b0, 1.5, 1.6, 9, 29.2, 10, 10);
    k.basic(0xfff2b0, 1.5, 1.6, 9, 29.2, 10, -10);
    k.basic(0xff2b2b, 1.2, 1.8, 28, -29.6, 10.5, 0);
    return { deckY: 13.2, spoilerX: -27, span: 32, tailX: -29, pipeY: 8, halfW: 16 };
  },
};

// ---- spoilers -----------------------------------------------------------------------

function buildSpoiler(id, k, m) {
  const x = m.spoilerX;
  const y = m.deckY;
  const span = m.span;
  const posts = (h, zOff, mat) => {
    for (const s of [-1, 1]) k.box(mat || k.darkMat, 2, h, 2, x + 1, y + h / 2, s * zOff);
  };
  if (id === 'spo_none') return;
  if (id === 'spo_duck') {
    k.paint(6, 2, span - 2, x + 1, y + 1, 0);
  } else if (id === 'spo_tall') {
    posts(13, 9);
    k.paint(10, 2, span, x, y + 14, 0);
  } else if (id === 'spo_carbon') {
    posts(9, 9);
    k.box(k.carbonMat, 9, 1.4, span + 2, x, y + 10, 0);
    for (const s of [-1, 1]) k.box(k.carbonMat, 9, 5, 1, x, y + 10.5, s * (span / 2 + 1));
  } else if (id === 'spo_double') {
    posts(12, 9);
    k.paint(8, 1.4, span, x, y + 8, 0);
    k.paint(6, 1.4, span, x - 1, y + 13, 0);
    for (const s of [-1, 1]) k.box(k.carbonMat, 8, 8, 1, x, y + 10.5, s * (span / 2 + 0.5));
  } else {
    // stock wing
    posts(6, 9);
    k.paint(7, 1.5, span, x, y + 7.5, 0);
  }
}

// ---- exhausts -----------------------------------------------------------------------
// Returns where the boost flames come out: { x, y, z, scale, up }.

function buildExhaust(id, k, m) {
  const pipe = (r, len, x, y, z, mat) => {
    const geo = new THREE.CylinderGeometry(r, r, len, 12);
    geo.rotateZ(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = !k.ghost;
    k.body.add(mesh);
    return mesh;
  };
  const tail = m.tailX;
  const y = m.pipeY;
  const flames = [];
  if (id === 'exh_dual') {
    for (const z of [-8, 8]) {
      pipe(3, 7, tail - 2, y, z, k.chromeMat);
      flames.push({ x: tail - 6, y, z, scale: 1 });
    }
  } else if (id === 'exh_quad') {
    for (const z of [-11, -5.5, 5.5, 11]) {
      pipe(2.3, 6, tail - 1.5, y, z, k.chromeMat);
      flames.push({ x: tail - 5, y, z, scale: 0.75 });
    }
  } else if (id === 'exh_mega') {
    const geo = new THREE.CylinderGeometry(5.6, 3.2, 8, 14);
    geo.rotateZ(Math.PI / 2); // wide end faces the back
    const mesh = new THREE.Mesh(geo, k.chromeMat);
    mesh.position.set(tail - 2.5, y + 0.5, 0);
    k.body.add(mesh);
    flames.push({ x: tail - 7, y: y + 0.5, z: 0, scale: 1.6 });
  } else if (id === 'exh_side') {
    for (const s of [-1, 1]) {
      pipe(1.8, 20, -2, 6.2, s * (m.halfW + 1.4), k.chromeMat);
      flames.push({ x: tail - 3, y, z: s * 9, scale: 0.9 });
      pipe(2, 5, tail - 1.5, y, s * 9, k.darkMat);
    }
  } else if (id === 'exh_stack') {
    for (const s of [-1, 1]) {
      const geo = new THREE.CylinderGeometry(2, 2, 18, 12);
      const mesh = new THREE.Mesh(geo, k.chromeMat);
      mesh.position.set(-13, 23, s * (m.halfW - 1));
      k.body.add(mesh);
      flames.push({ x: -13, y: 32, z: s * (m.halfW - 1), scale: 0.7, up: true });
    }
  } else {
    for (const z of [-9, 9]) {
      pipe(2.2, 5, tail - 1.5, y, z, k.darkMat);
      flames.push({ x: tail - 4.5, y, z, scale: 1 });
    }
  }
  return flames;
}

// ---- the car --------------------------------------------------------------------------

/**
 * @param loadout  chosen part ids (anything unknown falls back to the free defaults)
 * @param opts.ghost  see-through, no flames or glow
 * @param opts.decals { side, top } canvases with the player's drawings
 */
export function buildCar(loadoutIn, { ghost = false, decals = null } = {}) {
  const loadout = cleanLoadout(loadoutIn);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const decalCanvases = decals || blankDecals();
  const decalTex = {};
  for (const w of ['side', 'top']) {
    const t = new THREE.CanvasTexture(decalCanvases[w]);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    decalTex[w] = t;
  }

  const ghostMat = ghost ? new THREE.MeshBasicMaterial({ color: 0x7ee8ff, transparent: true, opacity: 0.4, depthWrite: false }) : null;
  const paintItem = itemById(loadout.paint);
  const paintMat = ghostMat || paintMaterial(paintItem, decalTex);
  const lambert = (c) => ghostMat || new THREE.MeshLambertMaterial({ color: c });
  const darkMat = lambert(0x15181f);
  const glassMat = lambert(0x182433);
  const carbonMat = lambert(0x0e0f12);
  const chromeMat = ghostMat || new THREE.MeshPhongMaterial({ color: 0xdfe3ea, shininess: 130, specular: 0xffffff });

  const k = {
    ghost,
    body,
    darkMat,
    carbonMat,
    chromeMat,
    box(mat, w, h, d, x, y, z) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.castShadow = !ghost;
      body.add(m);
      return m;
    },
    paint(w, h, d, x, y, z) {
      const m = k.box(paintMat, w, h, d, x, y, z);
      if (!ghost) addDecalCoords(m);
      return m;
    },
    dark: (w, h, d, x, y, z) => k.box(darkMat, w, h, d, x, y, z),
    glass: (w, h, d, x, y, z) => k.box(glassMat, w, h, d, x, y, z),
    basic: (c, w, h, d, x, y, z) => k.box(ghostMat || new THREE.MeshBasicMaterial({ color: c }), w, h, d, x, y, z),
  };

  const buildBody = BODIES[loadout.car] || BODIES.car_hatch;
  const meta = buildBody(k);
  buildSpoiler(loadout.spoiler, k, meta);
  const flameSpots = buildExhaust(loadout.exhaust, k, meta);

  // wheels: same size and place on every car
  const wheelGeo = new THREE.CylinderGeometry(7, 7, 6, 18);
  wheelGeo.rotateX(Math.PI / 2);
  const tire = ghost ? ghostMat : new THREE.MeshLambertMaterial({ color: 0x15161a });
  const rim = ghost ? ghostMat : new THREE.MeshLambertMaterial({ map: rimTexture(loadout.wheels) });
  const wheels = [];
  const frontPivots = [];
  for (const [x, z] of [[17, 15], [17, -15], [-17, 15], [-17, -15]]) {
    const w = new THREE.Mesh(wheelGeo, [tire, rim, rim]);
    w.castShadow = !ghost;
    wheels.push(w);
    if (x > 0) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 7, z);
      pivot.add(w);
      body.add(pivot);
      frontPivots.push(pivot);
    } else {
      w.position.set(x, 7, z);
      body.add(w);
    }
  }

  // boost flames
  const flame = new THREE.Group();
  const flameItem = itemById(loadout.flame);
  const outerMat = new THREE.MeshBasicMaterial({ color: flameItem.outer, transparent: true, opacity: 0.9 });
  const innerMat = new THREE.MeshBasicMaterial({ color: flameItem.inner, transparent: true, opacity: 0.95 });
  const flameParts = [];
  if (!ghost) {
    for (const f of flameSpots) {
      const g = new THREE.Group();
      const a = new THREE.ConeGeometry(4.5, 30, 8);
      const b = new THREE.ConeGeometry(2.4, 18, 8);
      const o = new THREE.Mesh(a, outerMat);
      const i = new THREE.Mesh(b, innerMat);
      if (f.up) {
        o.position.y = 15;
        i.position.y = 9;
        g.position.set(f.x, f.y, f.z);
      } else {
        a.rotateZ(Math.PI / 2);
        b.rotateZ(Math.PI / 2);
        o.position.x = -15;
        i.position.x = -9;
        g.position.set(f.x, f.y, f.z);
      }
      g.add(o, i);
      g.userData.base = f.scale;
      g.userData.up = !!f.up;
      flame.add(g);
      flameParts.push(g);
    }
    flame.visible = false;
    body.add(flame);
  }

  // underglow
  let glow = null;
  const glowColor = GLOW_COLORS[loadout.glow];
  if (!ghost && (glowColor || loadout.glow === 'glow_rainbow')) {
    glow = new THREE.Mesh(
      new THREE.PlaneGeometry(92, 64),
      new THREE.MeshBasicMaterial({ map: glowTexture(), color: glowColor || 0xff4fa3, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(0, 0.25, 0);
    glow.renderOrder = 3;
    root.add(glow);
  }

  const tmp = new THREE.Color();
  return {
    root,
    body,
    wheels,
    frontPivots,
    flame,
    loadout,
    decalTex,
    /** Call once per frame. t is seconds. */
    update(t) {
      if (paintItem.finish === 'shift' && !ghost) paintMat.color.copy(tmp.setHSL((t * 0.12) % 1, 0.85, 0.55));
      if (flameItem.rainbow) {
        outerMat.color.copy(tmp.setHSL((t * 1.1) % 1, 1, 0.55));
        innerMat.color.copy(tmp.setHSL(((t * 1.1) + 0.12) % 1, 1, 0.85));
      }
      if (glow && loadout.glow === 'glow_rainbow') glow.material.color.copy(tmp.setHSL((t * 0.25) % 1, 1, 0.55));
    },
    /** Show or flicker the boost flames. */
    setBoost(on) {
      if (!flameParts.length) return;
      flame.visible = on;
      if (!on) return;
      for (const g of flameParts) {
        const s = g.userData.base * (0.8 + Math.random() * 0.5);
        if (g.userData.up) g.scale.set(1, s, 1);
        else g.scale.set(s, g.userData.base, g.userData.base);
      }
    },
    markDecalsChanged() {
      decalTex.side.needsUpdate = true;
      decalTex.top.needsUpdate = true;
    },
    dispose() {
      root.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
      });
      decalTex.side.dispose();
      decalTex.top.dispose();
    },
  };
}
