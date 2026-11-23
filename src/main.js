import './style.css';
import { dayKeyUTC, msUntilReset, generateTrack } from './track.js';
import { Sim, DT, PHYS } from './sim.js';
import { GhostPlayer, packSamples, unpackSamples } from './ghost.js';
import { Renderer } from './render3d.js';
import { makeMinimap, drawMinimap } from './minimap.js';
import { GameAudio } from './audio.js';
import { LocalBackend, getSavedName, saveName } from './backend.js';
import { onlineAvailable, OnlineBackend, currentUser, onAuthChange, ensureProfile, signIn, signUp, signOut } from './online.js';

const LAPS = 3;
const $ = (id) => document.getElementById(id);

// ---- setup ---------------------------------------------------------------
const dayKey = dayKeyUTC();
const track = generateTrack(dayKey);
const localBackend = new LocalBackend();
let backend = localBackend;
const publicReader = onlineAvailable ? new OnlineBackend(null, null) : localBackend; // read-only: anyone can see the board
let boardKind = 'local';
const reader = () => (account ? backend : publicReader);
let account = null; // { user, name } when signed in
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
  let board = [];
  try {
    pb = await backend.getPersonalBest(dayKey);
  } catch (err) {
    console.error('Could not load your best, using offline data', err);
    pb = await localBackend.getPersonalBest(dayKey);
  }
  try {
    const r = reader();
    board = await r.getLeaderboard(dayKey);
    boardKind = r.kind;
  } catch (err) {
    console.error('Could not load the worldwide board, using offline data', err);
    board = await localBackend.getLeaderboard(dayKey);
    boardKind = 'local';
  }

  const sel = $('ghost-select');
  const prev = sel.value;
  sel.innerHTML = '';
  const none = new Option('No ghost', 'none');
  sel.add(none);
  if (pb) sel.add(new Option(`My best today (${fmt(pb.timeMs)})`, 'pb'));
  for (const r of board) {
    if (boardKind === 'online' && !r.isYou && r.hasGhost) sel.add(new Option(`${r.name} (${fmt(r.timeMs)})`, 'lb:' + r.runId));
  }
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
  $('lb-title').textContent = boardKind === 'online' ? "TODAY'S WORLDWIDE LEADERBOARD" : 'YOUR BEST TIMES TODAY';
  $('lb-note').textContent =
    boardKind === 'online'
      ? account ? 'One best time per driver. Resets with the track.' : 'One best time per driver. Sign in to post your own time.'
      : 'Offline leaderboard (this browser only).';
  board.forEach((r) => {
    const li = document.createElement('li');
    if (r.isYou && boardKind === 'online') li.className = 'you';
    const name = document.createElement('span');
    name.textContent = boardKind === 'online' ? `${r.rank}. ${r.name}` : r.name;
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

let starting = false;
async function startRace() {
  if (starting) return;
  starting = true;
  audio.unlock();
  lastCount = 0;
  saveName(cleanName($('name-input').value));
  $('name-input').value = getSavedName();
  sim = new Sim(track, LAPS);
  renderer.reset(sim);
  ghost = null;
  const pick = $('ghost-select').value;
  try {
    if (pick === 'pb' && pb) {
      ghost = new GhostPlayer(unpackSamples(pb.ghost), pb.timeMs / 1000);
    } else if (pick.startsWith('lb:')) {
      const g = await reader().getGhost(dayKey, pick.slice(3));
      if (g) ghost = new GhostPlayer(unpackSamples(g.ghost), g.timeMs / 1000);
    }
  } catch (err) {
    console.error('Could not load ghost', err);
  }
  starting = false;
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
    res = await backend.submitRun({ day: dayKey, name: getSavedName(), timeMs, laps, ghost: ghostData });
    if (backend.kind === 'online') await localBackend.submitRun({ day: dayKey, name: getSavedName(), timeMs, laps, ghost: ghostData });
  } catch (err) {
    console.error('Could not save run', err);
  }
  await wait;
  await refreshMenuData();
  if (state !== 'finished') return; // player already restarted

  $('finish-time').textContent = fmt(timeMs);
  const sub = $('finish-sub');
  sub.className = 'sub';
  if (backend.kind === 'online' && res && res.isPB === false && prevBest != null) {
    sub.textContent = `+${((timeMs - prevBest) / 1000).toFixed(3)}s off your best`;
    sub.classList.add('bad');
  } else if (prevBest == null) {
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
  $('finish-rank').textContent = res && res.rank ? (backend.kind === 'online' ? `Rank #${res.rank} worldwide today` : `Rank #${res.rank} in your runs today`) : backend.kind === 'online' ? 'Could not reach the leaderboard. Check your connection.' : onlineAvailable ? 'Sign in to post this time to the worldwide leaderboard.' : '';
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

// ---- accounts ------------------------------------------------------------
let authMode = 'in';
function setAccount(user, name) {
  account = user ? { user, name } : null;
  backend = account ? new OnlineBackend(user, name) : localBackend;
  const ni = $('name-input');
  if (account) {
    ni.value = name;
    ni.disabled = true;
    $('account-text').textContent = `Signed in as ${name}`;
    $('account-btn').textContent = 'SIGN OUT';
  } else {
    ni.disabled = false;
    ni.value = getSavedName();
    $('account-text').textContent = 'Offline: times stay in this browser';
    $('account-btn').textContent = 'SIGN IN';
  }
  ghostPicked = false;
  refreshMenuData();
}
function setAuthMode(mode) {
  authMode = mode;
  const up = mode === 'up';
  $('auth-title').textContent = up ? 'Create account' : 'Sign in';
  $('auth-go').textContent = up ? 'SIGN UP' : 'SIGN IN';
  $('auth-switch').textContent = up ? 'Have an account? Sign in' : 'No account? Sign up';
  $('auth-name').classList.toggle('hidden', !up);
  $('auth-name-label').classList.toggle('hidden', !up);
  $('auth-pass').autocomplete = up ? 'new-password' : 'current-password';
  authMsg('');
}
function authMsg(t, ok = false) {
  $('auth-msg').textContent = t;
  $('auth-msg').classList.toggle('ok', ok);
}
async function doAuth() {
  const email = $('auth-email').value.trim();
  const pass = $('auth-pass').value;
  if (!email || !pass) return authMsg('Enter your email and password.');
  $('auth-go').disabled = true;
  authMsg('Working...', true);
  try {
    if (authMode === 'up') {
      const r = await signUp(email, pass, $('auth-name').value.trim());
      if (r.error) return authMsg(r.error);
      if (r.confirm) return authMsg('Check your email and click the confirm link, then sign in here.', true);
      authMsg('');
      $('auth').classList.add('hidden');
    } else {
      const r = await signIn(email, pass);
      if (r.error) return authMsg(r.error);
      authMsg('');
      $('auth').classList.add('hidden');
    }
  } finally {
    $('auth-go').disabled = false;
  }
}
if (onlineAvailable) {
  $('account').classList.remove('hidden');
  $('account-btn').addEventListener('click', async () => {
    if (account) await signOut();
    else {
      setAuthMode('in');
      $('auth').classList.remove('hidden');
      $('auth-email').focus();
    }
  });
  $('auth-switch').addEventListener('click', () => setAuthMode(authMode === 'in' ? 'up' : 'in'));
  $('auth-close').addEventListener('click', () => $('auth').classList.add('hidden'));
  $('auth-go').addEventListener('click', doAuth);
  $('auth').addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.code === 'Enter') doAuth();
  });
  setAuthMode('in');
  setAccount(null);
  currentUser().then(async (u) => {
    if (u) {
      try {
        setAccount(u, await ensureProfile(u));
      } catch (e) {
        console.error(e);
      }
    }
  });
  onAuthChange(async (u) => {
    if (u && !(account && account.user.id === u.id)) {
      try {
        setAccount(u, await ensureProfile(u));
      } catch (e) {
        console.error(e);
      }
    } else if (!u && account) setAccount(null);
  });
}
