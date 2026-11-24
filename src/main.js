import './style.css';
import { dayKeyUTC, msUntilReset, generateTrack } from './track.js';
import { Sim, DT, PHYS } from './sim.js';
import { GhostPlayer, packSamples, unpackSamples, packInputs, unpackInputs } from './ghost.js';
import { Renderer } from './render3d.js';
import { makeMinimap, drawMinimap } from './minimap.js';
import { GameAudio } from './audio.js';
import { LocalBackend, getSavedName, saveName } from './backend.js';
import { onlineAvailable, OnlineBackend, currentUser, onAuthChange, ensureProfile, signIn, signUp, signOut } from './online.js';
import * as online from './online.js';
import { initGarage, mockGarageApi } from './garage.js';
import { loadDecal } from './car.js';
import { DEFAULT_LOADOUT, cleanLoadout } from './catalog.js';
import { carThumb } from './thumbs.js';

const LAPS = 3;
const $ = (id) => document.getElementById(id);

// ---- setup ---------------------------------------------------------------
const todayKey = dayKeyUTC();
const ARCHIVE_DAYS = 14;
const dayOffset = (key, n) => new Date(Date.parse(key + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// ?day=YYYY-MM-DD opens one of the last 14 days as a practice track (never today's, never the future)
const wantedDay = new URLSearchParams(location.search).get('day');
const dayKey =
  wantedDay && /^\d{4}-\d{2}-\d{2}$/.test(wantedDay) && wantedDay < todayKey && wantedDay >= dayOffset(todayKey, -ARCHIVE_DAYS) ? wantedDay : todayKey;
const isArchive = dayKey !== todayKey;
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
let ghostOn = loadGhostPref(); // press G to turn your ghost off or on
let opponent = null; // { runId, name, timeMs } when racing someone else's ghost; null = your own best
let selected = null;
// ---- car customisation ----
let myLoadout = { ...DEFAULT_LOADOUT };
let myDecals = null;
let carOwner = 'me'; // whose car is on the renderer right now: 'me' or a user id (replays)
let boostCount = 0;
let garageUI = null;
const carCache = new Map(); // userId -> { loadout, decals } (other drivers' cars)

async function fetchCar(userId) {
  if (!userId || !onlineAvailable) return { loadout: { ...DEFAULT_LOADOUT }, decals: null };
  if (carCache.has(userId)) return carCache.get(userId);
  let car = { loadout: { ...DEFAULT_LOADOUT }, decals: null };
  try {
    const row = await online.getLoadout(userId);
    if (row) {
      const [side, top] = await Promise.all([loadDecal(row.decal_side, 'side'), loadDecal(row.decal_top, 'top')]);
      car = { loadout: cleanLoadout(row), decals: { side, top } };
    }
  } catch (err) {
    console.error('Could not load car', err);
  }
  carCache.set(userId, car);
  return car;
}
// online leaderboard run ids are the driver's user id
const ownerId = (entry) => (reader().kind === 'online' ? entry.runId : null);
function showMyCar() {
  if (carOwner === 'me') return;
  carOwner = 'me';
  renderer.setCar(myLoadout, myDecals);
}
const COIN = '<i class="coin"></i>';
function coinPop(n) {
  const el = document.createElement('div');
  el.className = 'coin-pop gold';
  el.innerHTML = `+${n} ${COIN}`;
  $('hud').appendChild(el);
  setTimeout(() => el.remove(), 1300);
}
function setCoinBadge(n) {
  const b = $('coin-badge');
  if (n == null) return b.classList.add('hidden');
  b.innerHTML = `${COIN} <b>${n}</b> Drift Coins`;
  b.classList.remove('hidden');
}
let cacheBoard = []; // leaderboard entry the player clicked

function loadGhostPref() {
  try {
    return localStorage.getItem('driftle:v1:ghost') !== '0';
  } catch {
    return true;
  }
}
function saveGhostPref() {
  try {
    localStorage.setItem('driftle:v1:ghost', ghostOn ? '1' : '0');
  } catch {
    /* private window: not remembered */
  }
}

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
  $('home-track').textContent = track.name;
  $('home-day').textContent = $('day-label').textContent;
  const pv = $('preview');
  pv.getContext('2d').drawImage(previewMap.base, 0, 0);
  $('home-map').getContext('2d').drawImage(previewMap.base, 0, 0);
  if (isArchive) {
    $('track-label').textContent = 'PAST TRACK (PRACTICE)';
    $('reset-line').innerHTML = "Practice only: times on past tracks aren't posted.<b id=\"reset-timer\" hidden></b>";
    $('home-play').innerHTML = "PLAY TODAY'S TRACK <small>[Enter]</small>";
  }
  refreshMenuData();
  tickResetTimer();
  setInterval(tickResetTimer, 1000);
}

function showHome() {
  show('menu', false);
  show('archive', false);
  show('home', true);
}
function showTrackScreen() {
  show('home', false);
  show('archive', false);
  show('menu', true);
}
const homeVisible = () => !$('home').classList.contains('hidden');

function tickResetTimer() {
  const ms = msUntilReset();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  $('reset-timer').textContent = t;
  $('home-timer').textContent = t;
  if (!isArchive && dayKeyUTC() !== dayKey && (state === 'menu' || state === 'finished')) location.reload();
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

  if (opponent && !board.some((r) => r.runId === opponent.runId)) opponent = null;
  cacheBoard = board;
  renderGhostRow();

  const list = $('leaderboard');
  list.innerHTML = '';
  if (!board.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = isArchive ? 'Nobody posted a time on this day.' : 'No runs yet today. Be the first.';
    list.appendChild(li);
  }
  $('lb-title').textContent = (isArchive ? 'LEADERBOARD FOR THIS DAY' : boardKind === 'online' ? "TODAY'S WORLDWIDE LEADERBOARD" : 'YOUR BEST TIMES TODAY');
  $('lb-note').textContent =
    boardKind === 'online'
      ? account ? 'One best time per driver. Click a name to watch or race them.' : 'One best time per driver. Click a name to watch or race them. Create a free account (left) to post yours.'
      : 'Offline leaderboard (this browser only).';
  const lead = board.length ? board[0].timeMs : 0;
  board.forEach((r, idx) => {
    const li = document.createElement('li');
    const rank = boardKind === 'online' ? r.rank : idx + 1;
    if (r.isYou && boardKind === 'online') li.classList.add('you');
    if (rank <= 3) li.classList.add('p' + rank);
    if (selected && selected.runId === r.runId) li.classList.add('sel');

    const rk = document.createElement('span');
    rk.className = 'rk';
    rk.textContent = String(rank);

    let who;
    if (r.hasGhost) {
      who = document.createElement('button');
      who.type = 'button';
      who.title = 'Click to watch this run or race their ghost';
      who.addEventListener('click', () => selectEntry(r));
    } else who = document.createElement('span');
    who.className = 'who';
    who.textContent = r.name;
    if (r.isYou && boardKind === 'online') {
      const tag = document.createElement('em');
      tag.textContent = 'YOU';
      who.append(tag);
    }

    const time = document.createElement('b');
    time.className = 'tm';
    time.textContent = fmt(r.timeMs);
    const gap = document.createElement('span');
    gap.className = 'gap';
    gap.textContent = idx === 0 || r.timeMs === lead ? '' : `+${((r.timeMs - lead) / 1000).toFixed(3)}`;

    const pic = document.createElement('img');
    pic.className = 'carpic';
    pic.alt = '';
    const lo = boardKind === 'online' ? (r.isYou ? myLoadout : r.loadout) : null;
    const url = lo ? carThumb(lo) : null;
    if (url) pic.src = url;
    else pic.classList.add('none');
    li.append(rk, pic, who, time, gap);
    list.appendChild(li);
  });
}

// ---- ghost -----------------------------------------------------------------
function renderGhostRow() {
  let text;
  if (!ghostOn) text = 'Ghost is off. Press G to turn it on.';
  else if (opponent) text = `Racing ${opponent.name}'s ghost (${fmt(opponent.timeMs)})`;
  else if (pb) text = `Racing your own best ghost (${fmt(pb.timeMs)})`;
  else text = 'No ghost yet. Finish a run and your best becomes your ghost.';
  $('ghost-text').textContent = text;
  $('ghost-toggle').textContent = ghostOn ? 'GHOST ON [G]' : 'GHOST OFF [G]';
  $('ghost-row').classList.toggle('off', !ghostOn);
  $('ghost-reset').classList.toggle('hidden', !opponent);
}

function toggleGhost() {
  ghostOn = !ghostOn;
  saveGhostPref();
  renderGhostRow();
  if (state === 'countdown' || state === 'racing') setBanner(ghostOn ? 'GHOST ON' : 'GHOST OFF', 900);
}

function selectEntry(r) {
  selected = r;
  $('lb-actions').classList.remove('hidden');
  const mine = pb && r.runId === pb.runId;
  $('lb-actions-name').textContent = `${r.name}  ${fmt(r.timeMs)}`;
  $('act-vs').textContent = mine ? 'RACE MY GHOST' : 'RACE THEIR GHOST';
  const rows = [...document.querySelectorAll('#leaderboard li')];
  rows.forEach((li) => li.classList.remove('sel'));
  const i = (cacheBoard || []).findIndex((x) => x.runId === r.runId);
  if (rows[i]) rows[i].classList.add('sel');
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
  rp = null;
  show('replay', false);
  starting = true;
  audio.unlock();
  lastCount = 0;
  saveName(cleanName($('name-input').value));
  $('name-input').value = getSavedName();
  sim = new Sim(track, LAPS);
  renderer.reset(sim);
  ghost = null;
  boostCount = 0;
  showMyCar();
  try {
    // Your own best is loaded automatically; a leaderboard ghost replaces it if you picked one.
    // The ghost is always loaded so G can switch it on mid-race; ghostOn only controls whether it shows.
    if (opponent) {
      const g = await reader().getGhost(dayKey, opponent.runId);
      if (g && g.ghost) ghost = new GhostPlayer(unpackSamples(g.ghost), g.timeMs / 1000);
    }
    if (!ghost && pb && pb.ghost) ghost = new GhostPlayer(unpackSamples(pb.ghost), pb.timeMs / 1000);
    // the ghost wears its owner's car (your own best = your current car)
    if (ghost) renderer.setGhostCar(opponent && !(pb && opponent.runId === pb.runId) ? (await fetchCar(ownerId(opponent))).loadout : myLoadout);
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
  rp = null;
  showMyCar();
  show('replay', false);
  sim = new Sim(track, LAPS);
  renderer.reset(sim);
  ghost = null;
  show('hud', false);
  show('finish', false);
  showTrackScreen();
  setBanner('');
  refreshMenuData();
}

function handleEvents() {
  for (const e of sim.events.splice(0)) {
    if (e.type === 'boost') {
      boostCount++;
      if (account && !isArchive && boostCount <= 20) coinPop(2);
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
  const inputsData = packInputs(sim.inputRuns);
  const wait = new Promise((r) => setTimeout(r, 900));
  let res = null;
  try {
    if (isArchive) res = await localBackend.submitRun({ day: dayKey, name: getSavedName(), timeMs, laps, ghost: ghostData, inputs: inputsData });
    else res = await backend.submitRun({ day: dayKey, name: getSavedName(), timeMs, laps, ghost: ghostData, inputs: inputsData, boosts: boostCount });
    if (!isArchive && backend.kind === 'online') await localBackend.submitRun({ day: dayKey, name: getSavedName(), timeMs, laps, ghost: ghostData, inputs: inputsData });
  } catch (err) {
    console.error('Could not save run', err);
  }
  await wait;
  await refreshMenuData();
  if (state !== 'finished') return; // player already restarted

  $('finish-time').textContent = fmt(timeMs);
  const sub = $('finish-sub');
  sub.className = 'sub';
  if (!isArchive && backend.kind === 'online' && res && res.isPB === false && prevBest != null) {
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
  const cb = $('finish-coins');
  if (isArchive) {
    cb.textContent = 'Practice run on a past track: no Drift Coins and not posted.';
    cb.classList.remove('hidden');
  } else if (account && res && res.coins) {
    const c = res.coins;
    const rows = [['Finished the race', c.finish], [`Drift boosts x${Math.min(boostCount, 20)}`, c.boosts], ['New personal best', c.pb], ['Top of the board', c.top]].filter((r) => r[1] > 0);
    cb.innerHTML =
      rows.map((r, i) => `<div class="coin-line" style="animation-delay:${i * 0.22}s"><span>${r[0]}</span><b class="gold">+${r[1]} ${COIN}</b></div>`).join('') +
      `<div class="coin-total" style="animation-delay:${rows.length * 0.22 + 0.1}s"><span>TOTAL</span><b class="gold">+${c.total} ${COIN}</b></div>` +
      (c.total === 0 ? '<div class="muted tiny">Daily coin limit reached. Back tomorrow!</div>' : '');
    cb.classList.remove('hidden');
    if (res.wallet != null) setCoinBadge(res.wallet);
  } else if (!account) {
    cb.textContent = 'Sign in to earn Drift Coins for every race and spend them in the garage.';
    cb.classList.remove('hidden');
  } else cb.classList.add('hidden');
  $('finish-rank').textContent = res && res.rank ? (backend.kind === 'online' ? `Rank #${res.rank} worldwide today` : `Rank #${res.rank} in your runs today`) : backend.kind === 'online' ? 'Could not reach the leaderboard. Check your connection.' : onlineAvailable ? 'This time was NOT posted. Go back to the menu and create a free account to join the worldwide leaderboard.' : '';
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
  if (ghost && ghostOn && state === 'racing' && sim.progMax > 0) {
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

  if (state === 'replay' && rp) {
    updateReplay(real);
    requestAnimationFrame(frame);
    return;
  }

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

  const ghostPose = ghost && ghostOn ? ghost.at(sim.time) : null;
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
  if (garageUI && garageUI.isOpen()) return;
  if (!$('auth').classList.contains('hidden')) return;
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
  if (e.code === 'KeyG' && state !== 'replay') {
    toggleGhost();
    return;
  }
  if (KEYS[e.code]) {
    input[KEYS[e.code]] = true;
    e.preventDefault();
    return;
  }
  if (state === 'replay') {
    if (e.code === 'KeyR') restartReplay();
    else if (e.code === 'Escape') toMenu();
    else if (e.code === 'KeyP') $('rp-pause').click();
    return;
  }
  if (!$('archive').classList.contains('hidden')) return;
  if (e.code === 'Enter' && state === 'menu') (homeVisible() ? showTrackScreen() : startRace());
  else if (e.code === 'Escape' && state === 'menu') {
    if (!homeVisible()) showHome();
  } else if (e.code === 'KeyR' && state !== 'menu') startRace();
  else if (e.code === 'Escape' && state !== 'menu') toMenu();
});
window.addEventListener('keyup', (e) => {
  if (KEYS[e.code]) input[KEYS[e.code]] = false;
});
window.addEventListener('blur', () => {
  for (const k of Object.keys(input)) input[k] = false;
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
if (isArchive) showTrackScreen();
else showHome();
requestAnimationFrame(frame);

// ---- replays -------------------------------------------------------------
// Watch how another driver drove: the car is posed from their recorded ghost, and the keys
// they pressed light up on screen. Their run is the data; nothing here changes the leaderboard.
let rp = null;
const KEYMAP = [['k-w', 1], ['k-s', 2], ['k-a', 4], ['k-d', 8], ['k-space', 16]];
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));

async function watchReplay(entry) {
  audio.unlock();
  let g = null;
  try {
    g = entry.runId && pb && entry.runId === pb.runId && pb.inputs !== undefined ? pb : await reader().getGhost(dayKey, entry.runId);
  } catch (err) {
    console.error('Could not load replay', err);
  }
  if (!g || !g.ghost) return alert('Could not load that replay. Check your connection and try again.');
  const oid = ownerId(entry);
  const theirs = !oid || (account && oid === account.user.id) ? null : await fetchCar(oid);
  if (theirs) {
    carOwner = oid;
    renderer.setCar(theirs.loadout, theirs.decals);
  } else showMyCar();
  const player = new GhostPlayer(unpackSamples(g.ghost), g.timeMs / 1000);
  rp = {
    name: entry.name,
    player,
    inputs: unpackInputs(g.inputs),
    t: 0,
    paused: false,
    speed: 1,
    done: false,
    // the renderer and minimap read this like a Sim
    car: { x: 0, y: 0, a: 0, vx: 0, vy: 0, steer: 0, beta: 0, drifting: false, charge: 0, boostT: 0 },
    dist: 0,
    time: 0,
  };
  state = 'replay';
  ghost = null;
  show('menu', false);
  show('finish', false);
  show('hud', true);
  show('replay', true);
  $('rp-name').textContent = entry.name;
  $('rp-time').textContent = fmt(g.timeMs);
  $('rp-pause').textContent = 'PAUSE';
  $('rp-speed').textContent = 'SPEED 1x';
  show('rp-keys', !!rp.inputs);
  show('rp-nokeys', !rp.inputs);
  setBanner('');
  restartReplay();
}

function restartReplay() {
  if (!rp) return;
  rp.t = 0;
  rp.done = false;
  rp.paused = false;
  $('rp-pause').textContent = 'PAUSE';
  rp.car.steer = 0;
  rp.car.drifting = false;
  rp.prevPose = null;
  poseReplay(0);
  renderer.reset(rp);
  setBanner('');
}

function poseReplay(dt) {
  const P = rp.player;
  const c = rp.car;
  const pose = P.at(rp.t);
  const a0 = P.at(Math.max(0, rp.t - 0.03));
  const a1 = P.at(Math.min(P.time, rp.t + 0.03));
  const span = Math.max(0.001, Math.min(P.time, rp.t + 0.03) - Math.max(0, rp.t - 0.03));
  c.vx = (a1.x - a0.x) / span;
  c.vy = (a1.y - a0.y) / span;
  c.x = pose.x;
  c.y = pose.y;
  c.a = pose.a;
  const speed = Math.hypot(c.vx, c.vy);
  const mask = rp.inputs ? rp.inputs[Math.min(rp.inputs.length - 1, Math.floor(rp.t * 120))] : 0;
  rp.mask = mask;
  const want = (mask & 8 ? 1 : 0) - (mask & 4 ? 1 : 0);
  c.steer += (want - c.steer) * Math.min(1, dt * 9);
  c.beta = speed > 60 ? wrapA(Math.atan2(c.vy, c.vx) - c.a) : 0;
  const slip = Math.abs(c.beta);
  c.boostT = speed > PHYS.maxSpeed * 1.01 ? 1 : 0;
  c.drifting = c.drifting ? slip > PHYS.driftExitSlip && speed > PHYS.driftExitSpeed : slip > PHYS.driftEnterSlip && speed > 150;
  // distance from the road centre, for skid marks
  const T = track;
  const base = Math.floor(pose.prog);
  let best = Infinity;
  for (let k = -3; k <= 4; k++) {
    const i = (((base + k) % T.n) + T.n) % T.n;
    best = Math.min(best, Math.hypot(c.x - T.xs[i], c.y - T.ys[i]));
  }
  rp.dist = best;
  rp.time = rp.t;
  rp.prog = pose.prog;
}

function updateReplay(real) {
  if (!rp.paused && !rp.done) {
    rp.t += real * rp.speed;
    if (rp.t >= rp.player.time) {
      rp.t = rp.player.time;
      rp.done = true;
      setBanner('REPLAY FINISHED ' + fmt(rp.player.time * 1000));
    }
  }
  poseReplay(real);
  for (const [id, bit] of KEYMAP) $(id).classList.toggle('on', !!(rp.mask & bit));
  const c = rp.car;
  const speed = Math.hypot(c.vx, c.vy);
  $('hud-time').textContent = fmt(rp.t * 1000);
  $('hud-lap').textContent = `LAP ${Math.min(LAPS, Math.floor(Math.max(0, rp.prog) / track.n) + 1)}/${LAPS}`;
  $('hud-speed').textContent = String(Math.round(speed * 0.3));
  $('hud-delta').textContent = '';
  $('boost-fill').style.width = '0%';
  audio.update(real, {
    active: !rp.paused && !rp.done,
    speed: speed / PHYS.maxSpeed,
    throttle: !!(rp.mask & 1),
    drifting: c.drifting,
    slip: Math.min(1, Math.abs(Math.sin(c.beta))),
    onRoad: rp.dist <= track.halfWidth + PHYS.kerb,
    boosting: false,
  });
  renderer.orbit = false;
  renderer.update(rp.paused ? 0 : real, rp);
  renderer.draw(rp, null);
  drawMinimap($('minimap'), miniMap, rp, null);
}

$('act-watch').addEventListener('click', () => selected && watchReplay(selected));
$('act-vs').addEventListener('click', () => {
  if (!selected) return;
  if (pb && selected.runId === pb.runId) opponent = null;
  else opponent = { runId: selected.runId, name: selected.name, timeMs: selected.timeMs };
  ghostOn = true;
  saveGhostPref();
  renderGhostRow();
  $('ghost-row').classList.add('flash');
  setTimeout(() => $('ghost-row').classList.remove('flash'), 1200);
});
$('ghost-toggle').addEventListener('click', (e) => {
  toggleGhost();
  e.currentTarget.blur();
});
$('ghost-reset').addEventListener('click', () => {
  opponent = null;
  renderGhostRow();
});
$('rp-back').addEventListener('click', toMenu);
$('rp-restart').addEventListener('click', restartReplay);
$('rp-pause').addEventListener('click', (e) => {
  if (!rp) return;
  rp.paused = !rp.paused;
  e.currentTarget.textContent = rp.paused ? 'PLAY' : 'PAUSE';
  e.currentTarget.blur();
});
$('rp-speed').addEventListener('click', (e) => {
  if (!rp) return;
  rp.speed = rp.speed === 1 ? 0.5 : rp.speed === 0.5 ? 0.25 : 1;
  e.currentTarget.textContent = `SPEED ${rp.speed === 1 ? '1x' : rp.speed === 0.5 ? '0.5x' : '0.25x'}`;
  e.currentTarget.blur();
});

// ---- accounts ------------------------------------------------------------
let authMode = 'in';
function setAccount(user, name) {
  account = user ? { user, name } : null;
  backend = account ? new OnlineBackend(user, name) : localBackend;
  const ni = $('name-input');
  if (account) {
    ni.value = name;
    ni.disabled = true;
    $('name-label').textContent = 'DRIVER NAME (YOURS ONLY)';
    $('account-text').textContent = `Signed in as ${name}. Your times count on the worldwide board.`;
    $('account-text').classList.remove('warn');
    $('account-btn').textContent = 'SIGN OUT';
    $('account-btn').classList.remove('primary-chip');
  } else {
    ni.disabled = false;
    ni.value = getSavedName();
    $('name-label').textContent = 'GUEST NAME (NOT POSTED ONLINE)';
    $('account-text').textContent = 'Playing as a guest. Your times are NOT on the worldwide leaderboard. Create a free account to post them.';
    $('account-text').classList.add('warn');
    $('account-btn').textContent = 'CREATE ACCOUNT / SIGN IN';
    $('account-btn').classList.add('primary-chip');
  }
  opponent = null;
  selected = null;
  myLoadout = { ...DEFAULT_LOADOUT };
  myDecals = null;
  carOwner = 'me';
  renderer.setCar(myLoadout, null);
  setCoinBadge(null);
  if (account) loadMyGarage(user.id);
  refreshMenuData();
}

async function loadMyGarage(uid) {
  try {
    const [coins, car] = await Promise.all([online.getWallet(), fetchCar(uid)]);
    if (!account || account.user.id !== uid) return;
    myLoadout = car.loadout;
    myDecals = car.decals;
    if (carOwner === 'me') renderer.setCar(myLoadout, myDecals);
    setCoinBadge(coins);
  } catch (err) {
    console.error('Could not load garage', err);
  }
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
  const dev = import.meta.env.DEV;
  garageUI = initGarage({
    api: { ...online, onCoins: (n) => setCoinBadge(n) },
    onSaved: (final, decals) => {
      myLoadout = final;
      myDecals = decals;
      carCache.delete(account && account.user.id);
      carOwner = 'me';
      renderer.setCar(myLoadout, myDecals);
    },
  });
  $('home-garage').addEventListener('click', () => {
    if (!account) {
      setAuthMode('in');
      authMsg('Sign in to customise your car.', true);
      $('auth').classList.remove('hidden');
      return $('auth-email').focus();
    }
    garageUI.open(account.user.id);
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

// Dev-only: `npm run dev` then open /?mockgarage to try the garage without an account or database.
if (import.meta.env.DEV && new URLSearchParams(location.search).has('mockgarage')) {
  const mock = mockGarageApi();
  garageUI = initGarage({
    api: { ...mock, onCoins: (n) => setCoinBadge(n) },
    onSaved: (final, decals) => {
      myLoadout = final;
      myDecals = decals;
      renderer.setCar(myLoadout, myDecals);
    },
  });
  $('account').classList.remove('hidden');
  setCoinBadge(500);
  $('home-garage').addEventListener('click', () => garageUI.open('mock-user'));
}

// ---- home screen and past tracks ---------------------------------------------
$('home-play').addEventListener('click', () => {
  if (isArchive) location.href = location.pathname;
  else showTrackScreen();
});
$('menu-home').addEventListener('click', showHome);
if (!onlineAvailable && !(import.meta.env.DEV && new URLSearchParams(location.search).has('mockgarage'))) $('home-garage').classList.add('hidden');
$('home-archive').addEventListener('click', openArchive);
$('archive-close').addEventListener('click', showHome);

function openArchive() {
  const list = $('archive-list');
  if (!list.childElementCount) {
    for (let i = 1; i <= ARCHIVE_DAYS; i++) {
      const key = dayOffset(todayKey, -i);
      const t = generateTrack(key);
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'arch-card';
      const cv = document.createElement('canvas');
      cv.width = 150;
      cv.height = 100;
      cv.getContext('2d').drawImage(makeMinimap(t, 150, 100).base, 0, 0);
      const info = document.createElement('div');
      const d = new Date(key + 'T00:00:00Z').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      info.innerHTML = `<b></b><span class="muted tiny"></span>`;
      info.firstChild.textContent = t.name;
      info.lastChild.textContent = d;
      card.append(cv, info);
      card.addEventListener('click', () => (location.search = `?day=${key}`));
      list.appendChild(card);
    }
  }
  show('home', false);
  show('archive', true);
}
