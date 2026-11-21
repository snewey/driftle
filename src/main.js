import './style.css';
import { dayKeyUTC, msUntilReset, generateTrack } from './track.js';
import { Sim, DT, PHYS } from './sim.js';
import { GhostPlayer, packSamples, unpackSamples } from './ghost.js';
import { Renderer } from './render3d.js';
import { makeMinimap, drawMinimap } from './minimap.js';
import { GameAudio } from './audio.js';
import { LocalBackend, getSavedName, saveName } from './backend.js';

const LAPS = 3;
const $ = (id) => document.getElementById(id);

// ---- setup ---------------------------------------------------------------
const dayKey = dayKeyUTC();
const track = generateTrack(dayKey);
const backend = new LocalBackend();
const audio = new GameAudio();
const renderer = new Renderer($('game'), track);
const miniMap = makeMinimap(track, 220, 160);
const previewMap = makeMinimap(track, 360, 240);

let sim = new Sim(track, LAPS);
let ghost = null;
let pb = null;
let state = 'menu'; // menu | countdown | racing | finished
let countdown = 0;
let acc = 0;
let lastNow = performance.now();
let bannerUntil = 0;
let lastBanner = '';
let lastCount = 0;
let ghostPicked = false; // true once the player has chosen a ghost option themselves

const input = { throttle: false, brake: false, left: false, right: false, handbrake: false };
const KEYS = {
  ArrowUp: 'throttle', KeyW: 'throttle',
  ArrowDown: 'brake', KeyS: 'brake',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'handbrake',
};

// ---- formatting ----------------------------------------------------------
function fmt(ms) {
  ms = Math.max(0, Math.round(ms));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

function cleanName(v) {
  return (v || '').replace(/[^\w \-]/g, '').trim().slice(0, 16) || 'Driver';
}

// ---- menu ----------------------------------------------------------------
function setupMenu() {
  $('track-name').textContent = track.name;
  $('day-label').textContent = new Date(dayKey + 'T00:00:00Z').toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
  $('name-input').value = getSavedName();
  $('day-label').textContent += ' · ' + renderer.themeName;
  const pv = $('preview');
  pv.getContext('2d').drawImage(previewMap.base, 0, 0);
  refreshMenuData();
  tickResetTimer();
  setInterval(tickResetTimer, 1000);
}

function tickResetTimer() {
  const ms = msUntilReset();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  $('reset-timer').textContent = [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  if (dayKeyUTC() !== dayKey && (state === 'menu' || state === 'finished')) location.reload();
}

async function refreshMenuData() {
  pb = await backend.getPersonalBest(dayKey);
  const board = await backend.getLeaderboard(dayKey);

  const sel = $('ghost-select');
  const prev = sel.value;
  sel.innerHTML = '';
  const none = new Option('No ghost', 'none');
  sel.add(none);
  if (pb) sel.add(new Option(`My best today (${fmt(pb.timeMs)})`, 'pb'));
  // Default to racing your own best, unless the player has deliberately picked something else.
  const prevStillValid = prev && [...sel.options].some((o) => o.value === prev);
  sel.value = ghostPicked && prevStillValid ? prev : pb ? 'pb' : 'none';

  const list = $('leaderboard');
  list.innerHTML = '';
  if (!board.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No runs yet today. Be the first.';
    list.appendChild(li);
  }
  board.forEach((r) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = r.name;
    const time = document.createElement('b');
    time.textContent = fmt(r.timeMs);
    li.append(name, time);
    list.appendChild(li);
  });
}

// ---- race flow -----------------------------------------------------------
function show(id, on) {
  $(id).classList.toggle('hidden', !on);
}

function setBanner(text, ms = 0) {
  if (text !== lastBanner) {
    $('banner').textContent = text;
    lastBanner = text;
  }
  bannerUntil = ms ? performance.now() + ms : 0;
}

function startRace() {
  audio.unlock();
  lastCount = 0;
  saveName(cleanName($('name-input').value));
  $('name-input').value = getSavedName();
  sim = new Sim(track, LAPS);
  renderer.reset(sim);
  ghost = null;
  if ($('ghost-select').value === 'pb' && pb) {
    ghost = new GhostPlayer(unpackSamples(pb.ghost), pb.timeMs / 1000);
  }
  acc = 0;
  countdown = 3;
  state = 'countdown';
  show('menu', false);
  show('finish', false);
  show('hud', true);
  setBanner('3');
}

function toMenu() {
  state = 'menu';
  sim = new Sim(track, LAPS);
  renderer.reset(sim);
  ghost = null;
  show('hud', false);
  show('finish', false);
  show('menu', true);
  setBanner('');
  refreshMenuData();
}

function handleEvents() {
  for (const e of sim.events.splice(0)) {
    if (e.type === 'boost') {
      setBanner('DRIFT BOOST!', 900);
      audio.boost();
    } else if (e.type === 'crash') {
      audio.crash(e.impact);
      renderer.kick(Math.min(1, e.impact / 500));
      setBanner('CRASH', 700);
    }
    else if (e.type === 'respawn') setBanner('BACK ON TRACK', 1000);
    else if (e.type === 'lap' && e.lap < LAPS) {
      const prevT = e.lap > 1 ? sim.lapTimes[e.lap - 2] : 0;
      setBanner(`LAP ${e.lap}  ${fmt((e.time - prevT) * 1000)}`, 1800);
      audio.lap();
    } else if (e.type === 'finish') onFinish();
  }
}

async function onFinish() {
  state = 'finished';
  audio.finish();
  setBanner('FINISH!', 2000);
  const timeMs = Math.round(sim.finishTime * 1000);
  const prevBest = pb ? pb.timeMs : null;
  const laps = sim.lapTimes.map((t, i) => (t - (i ? sim.lapTimes[i - 1] : 0)) * 1000);
  const ghostData = packSamples(sim.samples);
  const wait = new Promise((r) => setTimeout(r, 900));
  let res = null;
  try {
    res = await backend.submitRun({ day: dayKey, name: getSavedName(), timeMs, ghost: ghostData });
  } catch (err) {
    console.error('Could not save run', err);
  }
  await wait;
  await refreshMenuData();
  if (state !== 'finished') return; // player already restarted

  $('finish-time').textContent = fmt(timeMs);
  const sub = $('finish-sub');
  sub.className = 'sub';
  if (prevBest == null) {
    sub.textContent = 'First run of the day';
    sub.classList.add('good');
  } else if (timeMs < prevBest) {
    sub.textContent = `NEW PERSONAL BEST  -${((prevBest - timeMs) / 1000).toFixed(3)}s`;
    sub.classList.add('good');
  } else {
    sub.textContent = `+${((timeMs - prevBest) / 1000).toFixed(3)}s off your best`;
    sub.classList.add('bad');
  }
  const ul = $('finish-laps');
  ul.innerHTML = '';
  laps.forEach((l, i) => {
    const li = document.createElement('li');
    li.textContent = `Lap ${i + 1}   ${fmt(l)}`;
    ul.appendChild(li);
  });
  $('finish-rank').textContent = res && res.rank ? `Rank #${res.rank} in your runs today` : '';
  setBanner('');
  show('finish', true);
}

// ---- HUD -----------------------------------------------------------------
function updateHud(ghostPose) {
  const c = sim.car;
  const racing = state === 'racing' || state === 'finished';
  $('hud-time').textContent = fmt(racing ? (sim.finishTime ?? sim.time) * 1000 : 0);
  $('hud-lap').textContent = `LAP ${Math.min(LAPS, sim.lapsDone + 1)}/${LAPS}`;
  $('hud-speed').textContent = String(Math.round(Math.hypot(c.vx, c.vy) * 0.3));
  const fill = $('boost-fill');
  fill.style.width = `${Math.min(1, c.charge / PHYS.maxCharge) * 100}%`;
  fill.classList.toggle('ready', c.charge >= PHYS.minCharge);

  const delta = $('hud-delta');
  if (ghost && state === 'racing' && sim.progMax > 0) {
    const d = sim.time - ghost.timeAtProg(sim.progMax);
    delta.textContent = `${d > 0 ? '+' : '-'}${Math.abs(d).toFixed(2)}`;
    delta.className = d > 0 ? 'behind' : 'ahead';
  } else {
    delta.textContent = '';
  }

  if (state === 'racing' && sim.wrongWayT > 0.8) setBanner('WRONG WAY', 300);
  drawMinimap($('minimap'), miniMap, sim, ghostPose);
}

// ---- main loop -----------------------------------------------------------
function frame(now) {
  const real = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;

  if (state === 'countdown') {
    countdown -= real;
    if (countdown <= 0) {
      state = 'racing';
      acc = 0;
      setBanner('GO!', 800);
      audio.go();
    } else {
      const n = Math.ceil(countdown);
      if (n !== lastCount) {
        lastCount = n;
        audio.beep();
      }
      setBanner(String(n));
    }
  } else if (state === 'racing') {
    acc += real;
    while (acc >= DT && !sim.finished) {
      sim.step(input);
      acc -= DT;
    }
    handleEvents();
  }
  if (bannerUntil && now > bannerUntil) setBanner('');

  const ghostPose = ghost ? ghost.at(sim.time) : null;
  const c = sim.car;
  const spd = Math.hypot(c.vx, c.vy);
  const fwd = c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a);
  audio.update(real, {
    active: state === 'racing' || state === 'countdown',
    speed: spd / PHYS.maxSpeed,
    throttle: state === 'racing' && input.throttle,
    drifting: c.drifting,
    slip: spd > 60 ? Math.min(1, Math.abs(Math.sin(Math.atan2(c.vy, c.vx) - c.a)) * Math.sign(fwd || 1) ** 2) : 0,
    onRoad: sim.dist <= track.halfWidth + PHYS.kerb,
    boosting: c.boostT > 0,
  });
  renderer.orbit = state === 'menu';
  renderer.update(real, sim);
  renderer.draw(sim, ghostPose);
  if (state !== 'menu') updateHud(ghostPose);
  requestAnimationFrame(frame);
}

// ---- input ---------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  audio.unlock();
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  if (typing) {
    if (e.code === 'Enter' && state === 'menu') {
      e.preventDefault();
      e.target.blur();
      startRace();
    }
    return;
  }
  if (e.code === 'KeyM') {
    setMuteUi(audio.toggleMute());
    return;
  }
  if (KEYS[e.code]) {
    input[KEYS[e.code]] = true;
    e.preventDefault();
    return;
  }
  if (e.code === 'Enter' && state === 'menu') startRace();
  else if (e.code === 'KeyR' && state !== 'menu') startRace();
  else if (e.code === 'Escape' && state !== 'menu') toMenu();
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.code]) input[KEYS[e.code]] = false;
});
window.addEventListener('blur', () => {
  for (const k of Object.keys(input)) input[k] = false;
});
$('ghost-select').addEventListener('change', () => {
  ghostPicked = true;
});
function setMuteUi(m) {
  $('sound-chip').textContent = m ? 'SOUND OFF' : 'SOUND ON';
  $('sound-chip').classList.toggle('off', m);
}
setMuteUi(audio.muted);
$('sound-chip').addEventListener('click', (e) => {
  audio.unlock();
  setMuteUi(audio.toggleMute());
  e.currentTarget.blur(); // so Space (handbrake) doesn't press the button again
});
window.addEventListener('pointerdown', () => audio.unlock());
$('start-btn').addEventListener('click', startRace);
$('retry-btn').addEventListener('click', startRace);
$('menu-btn').addEventListener('click', toMenu);

setupMenu();
requestAnimationFrame(frame);
