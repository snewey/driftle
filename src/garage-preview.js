import * as THREE from 'three';
import { buildCar, DECAL_CELLS } from './car.js';

// The camera spots for drawing on the car. angle = how the car is turned (0 shows its right side).
const VIEWS = {
  right: { angle: 0, pos: [0, 40, 125], look: [0, 12, 0], up: [0, 1, 0] },
  left: { angle: Math.PI, pos: [0, 40, 125], look: [0, 12, 0], up: [0, 1, 0] },
  front: { angle: -Math.PI / 2, pos: [0, 40, 125], look: [0, 12, 0], up: [0, 1, 0] },
  back: { angle: Math.PI / 2, pos: [0, 40, 125], look: [0, 12, 0], up: [0, 1, 0] },
  top: { angle: Math.PI / 2, pos: [0, 135, 0.01], look: [0, 0, 0], up: [0, 0, -1] },
};

// A small car viewer for the garage screen. Drag to turn the car, or (drawing mode) click squares on it.
export class GaragePreview {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.gl.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-60, 110, 90);
    this.scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(95, 48), new THREE.MeshLambertMaterial({ color: 0x20242c }));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 1000);
    this.camera.position.set(0, 62, 150);
    this.camera.lookAt(0, 8, 0);
    this.car = null;
    this.angle = 0.7;
    this.dragging = false;
    this.boost = false;
    this.running = false;
    this.last = 0;
    this.spin = true;
    this.view = null;
    this.zoom = 1;
    this.grid = false;
    this.paintMode = false;
    this.handlers = null;
    this.ray = new THREE.Raycaster();
    this.painting = false;

    let lastX = 0;
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      if (this.paintMode && this.handlers) {
        this.painting = true;
        this.handlers.down(this.pick(e.clientX, e.clientY));
        return;
      }
      this.dragging = true;
      this.spin = false;
      lastX = e.clientX;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.painting) return this.handlers.move(this.pick(e.clientX, e.clientY));
      if (!this.dragging) return;
      this.angle += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.paintMode) return;
        e.preventDefault();
        this.setZoom(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9));
      },
      { passive: false }
    );
    const end = () => {
      if (this.painting) this.handlers.up();
      this.painting = false;
      this.dragging = false;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  resize() {
    const w = this.canvas.clientWidth || 480;
    const h = this.canvas.clientHeight || 320;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setLoadout(loadout, decals) {
    if (this.car) {
      this.scene.remove(this.car.root);
      this.car.dispose();
    }
    this.car = buildCar(loadout, { decals });
    this.car.setGrid(this.grid);
    this.scene.add(this.car.root);
  }

  /** Drawing mode on: handlers = { down(hit), move(hit), up() }. hit is null when the pointer is not on the paint. */
  setPaintMode(on, handlers) {
    this.paintMode = on;
    this.handlers = handlers || null;
    this.canvas.style.cursor = on ? 'crosshair' : 'grab';
  }

  setGrid(on) {
    this.grid = on;
    if (this.car) this.car.setGrid(on);
  }

  /** Looks at the car from a drawing view ('right' | 'left' | 'front' | 'back' | 'top'), or goes back to the slow spin (null). */
  setView(name) {
    this.view = name && VIEWS[name] ? name : null;
    this.camera.up.set(0, 1, 0);
    if (!this.view) {
      this.spin = true;
      this.zoom = 1;
      this.camera.position.set(0, 62, 150);
      this.camera.lookAt(0, 8, 0);
      return;
    }
    this.spin = false;
    this.angle = VIEWS[this.view].angle;
    this.applyCamera();
  }

  setZoom(z) {
    this.zoom = Math.min(1.6, Math.max(0.4, z));
    if (this.view) this.applyCamera();
  }

  turn(by) {
    this.view = this.view || 'right';
    this.spin = false;
    this.angle += by;
  }

  applyCamera() {
    const v = VIEWS[this.view];
    this.camera.up.set(...v.up);
    this.camera.position.set(v.pos[0] * this.zoom, v.pos[1] * this.zoom + (1 - this.zoom) * v.look[1], v.pos[2] * this.zoom);
    this.camera.lookAt(...v.look);
  }

  /** The painted square under the pointer: { which: 'side' | 'top', cx, cy } (cy counted from the top of the picture), or null. */
  pick(clientX, clientY) {
    if (!this.car) return null;
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1), this.camera);
    this.car.root.updateMatrixWorld(true);
    const visible = (o) => {
      for (let n = o; n; n = n.parent) if (!n.visible) return false;
      return true;
    };
    const hit = this.ray.intersectObject(this.car.root, true).find((h) => visible(h.object) && !(h.object.material && h.object.material.transparent));
    if (!hit || !this.car.paintMeshes.includes(hit.object) || !hit.face) return null;
    const geo = hit.object.geometry;
    const pos = geo.attributes.position;
    const dec = geo.attributes.aDecal;
    const { a, b, c } = hit.face;
    const local = hit.object.worldToLocal(hit.point.clone());
    const bary = new THREE.Vector3();
    THREE.Triangle.getBarycoord(local, new THREE.Vector3().fromBufferAttribute(pos, a), new THREE.Vector3().fromBufferAttribute(pos, b), new THREE.Vector3().fromBufferAttribute(pos, c), bary);
    const mix = (k) => dec.getComponent(a, k) * bary.x + dec.getComponent(b, k) * bary.y + dec.getComponent(c, k) * bary.z;
    const z = Math.round(dec.getZ(a));
    if (z > 1) return null;
    const which = z === 0 ? 'side' : 'top';
    const [W, H] = DECAL_CELLS[which];
    const cx = Math.min(W - 1, Math.max(0, Math.floor(mix(0) * W)));
    const cy = Math.min(H - 1, Math.max(0, H - 1 - Math.floor(mix(1) * H)));
    return { which, cx, cy };
  }

  setBoost(on) {
    this.boost = on;
  }

  markDecalsChanged() {
    if (this.car) this.car.markDecalsChanged();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.resize();
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.spin && !this.dragging) this.angle += dt * 0.35;
      if (this.car) {
        this.car.root.rotation.y = this.angle;
        this.car.update(now / 1000);
        this.car.setBoost(this.boost);
        for (const w of this.car.wheels) w.rotation.z -= dt * (this.boost ? 28 : 4);
      }
      this.gl.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }
}
