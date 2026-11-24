import * as THREE from 'three';
import { buildCar } from './car.js';

// A small spinning-car viewer for the garage screen. Drag to turn the car.
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

    let lastX = 0;
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.angle += (e.clientX - lastX) * 0.012;
      lastX = e.clientX;
    });
    const end = () => (this.dragging = false);
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
    this.scene.add(this.car.root);
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
      if (!this.dragging) this.angle += dt * 0.35;
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
