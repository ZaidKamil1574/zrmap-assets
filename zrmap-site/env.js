// z/R Map Reality: photorealistic city view.
// Streams Google Photorealistic 3D Tiles (the same 3D city data as Google Maps) for the selected city.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { GLTFExtensionsPlugin, ReorientationPlugin, TilesFadePlugin, TileCompressionPlugin, UnloadTilesPlugin } from '3d-tiles-renderer/three/plugins';

const DEG = Math.PI / 180;

// Where each city opens (a wide view), and the places you can fly to.
// az: compass side the camera sits on (0 = south of the city, 90 = east). el: camera pitch above the ground.
export const CITIES = {
  la: { name: 'Los Angeles', lat: 34.0440, lon: -118.2625, dist: 7600, az: 12, el: 40,
    places: [
      { k: 'downtown', name: 'Downtown LA', lat: 34.0505, lon: -118.2550, dist: 2600 },
      { k: 'bmo', name: 'BMO Stadium', lat: 34.0128, lon: -118.2849, dist: 950, venue: 'bmo' },
      { k: 'dodger', name: 'Dodger Stadium', lat: 34.0739, lon: -118.2400, dist: 1050, venue: 'dodger' },
    ] },
  to: { name: 'Toronto', lat: 43.6385, lon: -79.4010, dist: 4600, az: 0, el: 38,
    places: [
      { k: 'cn', name: 'CN Tower', lat: 43.6426, lon: -79.3871, dist: 1500 },
      { k: 'rogers', name: 'Rogers Centre', lat: 43.6414, lon: -79.3894, dist: 900 },
      { k: 'bmofield', name: 'BMO Field', lat: 43.6332, lon: -79.4186, dist: 950, venue: 'bmofield' },
    ] },
  qa: { name: 'Doha, Qatar', lat: 25.3380, lon: 51.5330, dist: 7200, az: 45, el: 38,
    places: [
      { k: 'westbay', name: 'West Bay', lat: 25.3235, lon: 51.5305, dist: 2600 },
      { k: 'pearl', name: 'The Pearl', lat: 25.3712, lon: 51.5508, dist: 2400 },
      { k: 'educity', name: 'Education City Stadium', lat: 25.3110, lon: 51.4243, dist: 1050, venue: 'educity' },
    ] },
  uk: { name: 'London', lat: 51.5040, lon: -0.1090, dist: 5200, az: 60, el: 38,
    places: [
      { k: 'westminster', name: 'Westminster', lat: 51.4995, lon: -0.1248, dist: 1200 },
      { k: 'eye', name: 'London Eye', lat: 51.5033, lon: -0.1196, dist: 900 },
      { k: 'city', name: 'The City', lat: 51.5140, lon: -0.0830, dist: 1800 },
    ] },
};

const MIN_DIST = 260, MAX_DIST = 14000;

let opts = null, renderer, scene, camera, controls, tiles, reorient, raycaster, clock;
let el = {}, city = null, pins = [], flying = null, running = false, failed = false, frameN = 0, shown = 0;

function $(id) { return document.getElementById(id); }

export function setup(o) { opts = o; }

function initRenderer() {
  el = { root: $('env'), view: $('envView'), pins: $('envPins'), name: $('envName'), places: $('envPlaces'),
    msg: $('envMsg'), attr: $('envAttrTxt'), hint: $('envHint') };
  renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.view.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  const sky = new THREE.Color('#b9cbe0');
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 14000, 60000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(-1, 2, -1); scene.add(sun);
  camera = new THREE.PerspectiveCamera(45, 1, 2, 300000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.08;
  controls.minDistance = MIN_DIST; controls.maxDistance = MAX_DIST;
  controls.maxPolarAngle = 1.32; controls.zoomSpeed = 0.7; controls.screenSpacePanning = false;
  controls.addEventListener('start', () => { flying = null; });
  raycaster = new THREE.Raycaster(); raycaster.firstHitOnly = true;
  clock = new THREE.Clock();

  // click (or tap) anywhere on the city to fly in toward that spot
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return; const moved = Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (moved > 6 || dt > 600) return;
    const hit = pick(e.clientX, e.clientY); if (!hit) return;
    const d = camera.position.distanceTo(controls.target);
    flyTo(hit, THREE.MathUtils.clamp(d * 0.42, MIN_DIST, MAX_DIST));
  });
  window.addEventListener('resize', size);
  size();
}

function size() {
  if (!renderer) return;
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  if (tiles) tiles.setResolutionFromRenderer(camera, renderer);
}

function pick(x, y) {
  if (!tiles) return null;
  const r = renderer.domElement.getBoundingClientRect();
  const m = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(m, camera);
  const h = raycaster.intersectObject(tiles.group, true);
  return h.length ? h[0].point.clone() : null;
}

function groundAt(x, z) {
  if (!tiles) return null;
  raycaster.set(new THREE.Vector3(x, 6000, z), new THREE.Vector3(0, -1, 0));
  const h = raycaster.intersectObject(tiles.group, true);
  return h.length ? h[0].point.y : null;
}

function makeTiles(c) {
  tiles = new TilesRenderer();
  if (!opts.rootURL) tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: opts.key, autoRefreshToken: true }));
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new UnloadTilesPlugin());
  tiles.registerPlugin(new TilesFadePlugin());
  const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/libs/draco/gltf/');
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco, meshoptDecoder: MeshoptDecoder }));
  reorient = new ReorientationPlugin({ lat: c.lat * DEG, lon: c.lon * DEG, height: 0, recenter: true });
  tiles.registerPlugin(reorient);
  if (opts.rootURL) tiles.rootURL = opts.rootURL; // local testing only
  tiles.errorTarget = 14;
  let errs = 0;
  tiles.addEventListener('load-error', (e) => {
    console.warn('3D tiles load error', e.url, e.error || e);
    errs++;
    // only give up when the city itself cannot load (root tileset or many failures before anything shows)
    if (!shown && (!e.tile || !e.tile.parent || errs > 12)) fail();
  });
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  scene.add(tiles.group);
}

function fail() {
  failed = true;
  el.msg.innerHTML = 'The realistic 3D city could not load right now.<br><small>Google 3D tiles need the Map Tiles API turned on for this key.</small>';
  el.msg.classList.add('err'); el.msg.hidden = false;
  if (opts.onFail) opts.onFail();
}

function placePos(p) {
  const v = new THREE.Vector3();
  tiles.ellipsoid.getCartographicToPosition(p.lat * DEG, p.lon * DEG, 0, v);
  return v.applyMatrix4(tiles.group.matrixWorld);
}

function buildPins(c) {
  el.pins.innerHTML = ''; el.places.innerHTML = ''; pins = [];
  c.places.forEach((p) => {
    const d = document.createElement('div'); d.className = 'env-pin' + (p.venue ? ' venue' : '');
    const b = document.createElement('button'); b.type = 'button'; b.className = 'env-pin-label';
    b.innerHTML = '<i></i><span></span>'; b.querySelector('span').textContent = p.name; b.setAttribute('aria-label', 'Fly to ' + p.name);
    b.addEventListener('click', () => go(p)); d.appendChild(b);
    if (p.venue) {
      const e = document.createElement('button'); e.type = 'button'; e.className = 'env-enter';
      e.innerHTML = '<small>Enter</small><b></b><em aria-hidden="true">›</em>'; e.querySelector('b').textContent = p.name;
      e.addEventListener('click', () => opts.onEnter && opts.onEnter(p.venue)); d.appendChild(e);
    }
    el.pins.appendChild(d);
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'env-chip' + (p.venue ? ' venue' : '');
    chip.textContent = p.name; chip.addEventListener('click', () => go(p)); el.places.appendChild(chip);
    pins.push({ p, el: d, pos: null, snapped: false });
  });
}

function go(p) {
  const pin = pins.find((q) => q.p === p); if (!pin || !tiles) return;
  if (!pin.pos) pin.pos = placePos(p);
  const t = pin.pos.clone(); const g = groundAt(t.x, t.z); if (g !== null) t.y = g;
  flyTo(t, p.dist);
}

function flyTo(target, dist, dur) {
  const off = camera.position.clone().sub(controls.target).normalize();
  flying = { t0: controls.target.clone(), t1: target.clone(), d0: camera.position.distanceTo(controls.target), d1: dist, off, k: 0, dur: dur || 1.5 };
}

function stepFly(dt) {
  if (!flying) return;
  flying.k = Math.min(1, flying.k + dt / flying.dur);
  const e = flying.k < 0.5 ? 4 * flying.k ** 3 : 1 - Math.pow(-2 * flying.k + 2, 3) / 2;
  controls.target.lerpVectors(flying.t0, flying.t1, e);
  const d = flying.d0 + (flying.d1 - flying.d0) * e;
  camera.position.copy(controls.target).addScaledVector(flying.off, d);
  if (flying.k >= 1) flying = null;
}

function startView(c) {
  const az = c.az * DEG, elv = c.el * DEG, h = Math.cos(elv) * c.dist;
  controls.target.set(0, 0, 0);
  // frame: +Z north, +X west, +Y up
  camera.position.set(-Math.sin(az) * h, Math.sin(elv) * c.dist, -Math.cos(az) * h);
  camera.lookAt(controls.target); controls.update();
}

const v3 = new THREE.Vector3();
function updatePins() {
  const w = window.innerWidth, h = window.innerHeight, camD = camera.position.distanceTo(controls.target);
  pins.forEach((q) => {
    if (!q.pos) q.pos = placePos(q.p);
    if (!q.snapped && frameN % 20 === 0) { const g = groundAt(q.pos.x, q.pos.z); if (g !== null) { q.pos.y = g; q.snapped = true; } }
    v3.copy(q.pos); v3.y += 40; v3.project(camera);
    const on = v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
    q.el.style.display = on ? '' : 'none';
    if (on) q.el.style.transform = `translate(${((v3.x * 0.5 + 0.5) * w).toFixed(1)}px,${((-v3.y * 0.5 + 0.5) * h).toFixed(1)}px)`;
    const near = q.p.venue && q.pos.distanceTo(controls.target) < 700 && camD < 2200;
    q.el.classList.toggle('near', !!near);
  });
}

function loop() {
  if (!running) return;
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.1); frameN++;
  stepFly(dt); controls.update();
  camera.updateMatrixWorld();
  if (tiles) {
    tiles.update();
    if (frameN % 30 === 0) {
      const a = []; tiles.getAttributions(a);
      el.attr.textContent = a.filter((x) => x.type === 'string').map((x) => x.value).join(' ');
      if (!shown && tiles.visibleTiles && tiles.visibleTiles.size > 0) { shown = 1; el.msg.hidden = true; }
      // keep the orbit point on the ground once the terrain has loaded
      if (!flying && frameN < 400) { const g = groundAt(controls.target.x, controls.target.z); if (g !== null && Math.abs(g - controls.target.y) > 2) { const dy = g - controls.target.y; controls.target.y += dy; camera.position.y += dy; } }
    }
  }
  renderer.render(scene, camera);
  updatePins();
}

export function open(key, placeKey) {
  const c = CITIES[key]; if (!c) return false;
  if (!renderer) initRenderer();
  city = key; failed = false;
  el.name.textContent = c.name;
  el.msg.className = 'env-msg'; el.msg.textContent = 'Loading the real 3D city…'; el.msg.hidden = false;
  el.root.hidden = false; requestAnimationFrame(() => el.root.classList.add('on'));
  if (!tiles) makeTiles(c);
  else { reorient.transformLatLonHeightToOrigin(c.lat * DEG, c.lon * DEG, 0); tiles.group.updateMatrixWorld(true); }
  shown = 0;
  size(); startView(c); buildPins(c);
  if (placeKey) { const p = c.places.find((x) => x.venue === placeKey || x.k === placeKey); if (p) setTimeout(() => { if (city === key) go(p); }, 1600); }
  if (!running) { running = true; clock.getDelta(); loop(); }
  return true;
}

export function close() {
  running = false; flying = null; city = null;
  if (el.root) { el.root.classList.remove('on'); setTimeout(() => { if (!running) el.root.hidden = true; }, 350); }
}
