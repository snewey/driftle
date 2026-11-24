import * as THREE from 'three';
import { buildCar } from './car.js';
import { cleanLoadout } from './catalog.js';

// Small car pictures for the leaderboard. One hidden WebGL canvas draws each different car once
// (parts only, no drawings, to keep the board light) and the picture is kept for reuse.
let gl = null;
let scene = null;
let camera = null;
let broken = false;
const cache = new Map();

function setup() {
  gl = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  gl.setPixelRatio(1);
  gl.setSize(120, 64, false);
  gl.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-60, 110, 90);
  scene.add(sun);
  camera = new THREE.PerspectiveCamera(30, 120 / 64, 1, 1000);
  camera.position.set(0, 52, 118);
  camera.lookAt(0, 6, 0);
}

export function carThumb(loadout) {
  const l = cleanLoadout(loadout);
  const key = Object.values(l).join('|');
  if (cache.has(key)) return cache.get(key);
  if (broken) return null;
  try {
    if (!gl) setup();
    const car = buildCar(l, {});
    car.root.rotation.y = 0.75;
    scene.add(car.root);
    car.update(0);
    gl.render(scene, camera);
    const url = gl.domElement.toDataURL('image/png');
    scene.remove(car.root);
    car.dispose();
    cache.set(key, url);
    return url;
  } catch (err) {
    console.error('Car thumbnails unavailable', err);
    broken = true;
    return null;
  }
}
