import { CATALOG, KINDS, KIND_LABEL, DEFAULT_LOADOUT, GLOW_COLORS, itemById, cleanLoadout } from './catalog.js';
import { GaragePreview } from './garage-preview.js';
import { blankDecals, loadDecal, decalIsBlank } from './car.js';

// The garage screen: spin your car, buy and fit parts with Drift Coins, and draw on it.
// Only signed-in players can open it; the database also refuses anyone else.

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const SWATCHES = ['#ffffff', '#111111', '#ff3d71', '#ff8a2b', '#ffd23b', '#4cd964', '#1fc8b4', '#2f6bff', '#8e3bff', '#ff4fa3', '#9aa3b2', '#7a4a2a'];
const MAX_URL = 88000; // the database accepts drawings up to 90,000 characters

function cardSwatch(kind, it) {
  if (kind === 'paint') return `<span class="sw" style="background:${hex(it.color)}"></span>`;
  if (kind === 'flame') return `<span class="sw" style="background:${it.rainbow ? 'linear-gradient(90deg,#f33,#fc3,#3f6,#39f,#c3f)' : `linear-gradient(135deg,${hex(it.outer)},${hex(it.inner)})`}"></span>`;
  if (kind === 'glow') {
    const c = GLOW_COLORS[it.id];
    return `<span class="sw" style="background:${it.id === 'glow_rainbow' ? 'linear-gradient(90deg,#f33,#fc3,#3f6,#39f,#c3f)' : c ? hex(c) : '#2a2d35'};${c || it.id === 'glow_rainbow' ? 'box-shadow:0 0 10px currentColor' : ''}"></span>`;
  }
  return '';
}

function starPath(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}
function heartPath(g, x, y, r) {
  g.beginPath();
  g.moveTo(x, y + r * 0.9);
  g.bezierCurveTo(x - r * 1.5, y - r * 0.1, x - r * 0.6, y - r * 1.1, x, y - r * 0.4);
  g.bezierCurveTo(x + r * 0.6, y - r * 1.1, x + r * 1.5, y - r * 0.1, x, y + r * 0.9);
  g.closePath();
}
function boltPath(g, x, y, r) {
  const p = [[0.15, -1], [-0.6, 0.1], [-0.05, 0.1], [-0.25, 1], [0.6, -0.2], [0.05, -0.2], [0.4, -1]];
  g.beginPath();
  p.forEach(([a, b], i) => (i ? g.lineTo(x + a * r, y + b * r) : g.moveTo(x + a * r, y + b * r)));
  g.closePath();
}

export function initGarage({ api, onSaved }) {
  let preview = null;
  let userId = null;
  let owned = new Set();
  let coins = 0;
  let saved = { ...DEFAULT_LOADOUT };
  let draft = { ...DEFAULT_LOADOUT };
  let decals = blankDecals();
  let tab = 'car';
  let dirty = false;
  let surface = 'side';
  let tool = 'brush';
  let color = '#ffffff';
  let size = 10;
  let busy = false;
  const undo = { side: [], top: [] };

  const isOwned = (id) => {
    const it = itemById(id);
    return !!it && (it.cost === 0 || owned.has(id));
  };
  const msg = (t, bad = false) => {
    $('g-msg').textContent = t;
    $('g-msg').classList.toggle('bad', bad);
  };
  const setCoins = (n) => {
    coins = n;
    $('g-coins').textContent = `◎ ${n.toLocaleString()} Drift Coins`;
  };
  const touched = () => {
    dirty = true;
    $('g-save').classList.add('pulse');
    msg('Unsaved changes');
  };

  function rebuildPreview() {
    preview.setLoadout(draft, decals);
  }

  function renderTabs() {
    const tabs = [...KINDS, 'draw'];
    $('g-tabs').innerHTML = '';
    for (const t of tabs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'g-tab' + (t === tab ? ' on' : '');
      b.textContent = t === 'draw' ? 'Draw' : KIND_LABEL[t];
      b.addEventListener('click', () => {
        tab = t;
        renderTabs();
        renderBody();
      });
      $('g-tabs').appendChild(b);
    }
  }

  function renderBody() {
    const draw = tab === 'draw';
    $('g-items').classList.toggle('hidden', draw);
    $('g-draw').classList.toggle('hidden', !draw);
    if (draw) return showSurface(surface);
    const grid = $('g-items');
    grid.innerHTML = '';
    for (const it of CATALOG[tab]) {
      const have = isOwned(it.id);
      const on = draft[tab] === it.id;
      const card = document.createElement('div');
      card.className = 'g-card' + (on ? ' on' : '') + (have ? '' : ' locked');
      card.tabIndex = 0;
      const status = on ? 'ON YOUR CAR' : have ? (it.cost === 0 ? 'FREE' : 'OWNED') : '';
      card.innerHTML = `${cardSwatch(tab, it)}<div class="nm">${it.name}</div>${it.blurb ? `<div class="bl">${it.blurb}</div>` : ''}<div class="st">${status}</div>`;
      if (!have) {
        const buy = document.createElement('button');
        buy.type = 'button';
        buy.className = 'g-buy' + (coins < it.cost ? ' poor' : '');
        buy.textContent = `BUY ◎ ${it.cost}`;
        buy.addEventListener('click', (e) => {
          e.stopPropagation();
          buyItem(it);
        });
        card.appendChild(buy);
      }
      const pick = () => {
        draft[tab] = it.id;
        if (tab === 'paint') $('g-draw-wrap').style.background = hex(it.color);
        rebuildPreview();
        touched();
        renderBody();
        if (!have) msg(`Previewing ${it.name}. Buy it to keep it.`);
      };
      card.addEventListener('click', pick);
      card.addEventListener('keydown', (e) => {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault();
          pick();
        }
      });
      grid.appendChild(card);
    }
  }

  async function buyItem(it) {
    if (busy) return;
    if (coins < it.cost) return msg(`You need ◎ ${it.cost - coins} more Drift Coins. Win them by finishing races.`, true);
    busy = true;
    try {
      const r = await api.buyItem(it.id);
      owned.add(it.id);
      setCoins(r.coins);
      api.onCoins && api.onCoins(r.coins);
      msg(`Bought ${it.name}!`);
      renderBody();
    } catch (e) {
      msg(e.message || 'Could not buy that.', true);
    } finally {
      busy = false;
    }
  }

  // ---- drawing ----------------------------------------------------------------------

  function showSurface(s) {
    surface = s;
    $('g-surf-side').classList.toggle('on', s === 'side');
    $('g-surf-top').classList.toggle('on', s === 'top');
    const wrap = $('g-draw-wrap');
    wrap.querySelectorAll('canvas').forEach((c) => c.remove());
    wrap.classList.toggle('portrait', s === 'top');
    const cv = decals[s];
    cv.className = 'draw-cv';
    wrap.appendChild(cv);
    $('g-guide').textContent = s === 'side' ? 'REAR  ←   side of the car (both sides)   →  FRONT' : 'FRONT ↑  bonnet, roof and boot  ↓ REAR';
  }

  function renderTools() {
    const sw = $('g-swatches');
    sw.innerHTML = '';
    for (const c of SWATCHES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch' + (c === color ? ' on' : '');
      b.style.background = c;
      b.addEventListener('click', () => {
        color = c;
        if (tool === 'eraser') tool = 'brush';
        $('g-color').value = c;
        renderTools();
      });
      sw.appendChild(b);
    }
    for (const t of document.querySelectorAll('#g-tools [data-tool]')) t.classList.toggle('on', t.dataset.tool === tool);
  }

  function snapshot() {
    const cv = decals[surface];
    const st = undo[surface];
    st.push(cv.getContext('2d').getImageData(0, 0, cv.width, cv.height));
    if (st.length > 25) st.shift();
  }

  function pointer(cv, e) {
    const r = cv.getBoundingClientRect();
    return [((e.clientX - r.left) * cv.width) / r.width, ((e.clientY - r.top) * cv.height) / r.height];
  }

  function stamp(g, x, y) {
    const r = size * 2.2 + 8;
    g.fillStyle = color;
    g.strokeStyle = 'rgba(0,0,0,.55)';
    g.lineWidth = Math.max(1.5, r * 0.08);
    if (tool === 'star') starPath(g, x, y, r);
    else if (tool === 'heart') heartPath(g, x, y, r);
    else boltPath(g, x, y, r);
    g.fill();
    g.stroke();
  }

  function wireDrawing() {
    const wrap = $('g-draw-wrap');
    let drawing = false;
    let last = null;
    wrap.addEventListener('pointerdown', (e) => {
      const cv = decals[surface];
      if (e.target !== cv) return;
      e.preventDefault();
      const [x, y] = pointer(cv, e);
      const g = cv.getContext('2d');
      snapshot();
      if (tool === 'text') {
        const txt = ($('g-text').value || '').slice(0, 14);
        const fs = size * 3 + 14;
        g.font = `800 ${fs}px system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = Math.max(2, fs * 0.12);
        g.strokeStyle = 'rgba(0,0,0,.6)';
        g.strokeText(txt, x, y);
        g.fillStyle = color;
        g.fillText(txt, x, y);
      } else if (tool === 'star' || tool === 'heart' || tool === 'bolt') {
        stamp(g, x, y);
      } else {
        drawing = true;
        last = [x, y];
        cv.setPointerCapture(e.pointerId);
        g.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
        g.strokeStyle = color;
        g.fillStyle = color;
        g.lineWidth = size;
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.beginPath();
        g.arc(x, y, size / 2, 0, Math.PI * 2);
        g.fill();
      }
      preview.markDecalsChanged();
      touched();
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const cv = decals[surface];
      const g = cv.getContext('2d');
      const [x, y] = pointer(cv, e);
      g.beginPath();
      g.moveTo(last[0], last[1]);
      g.lineTo(x, y);
      g.stroke();
      last = [x, y];
      preview.markDecalsChanged();
    });
    const end = () => {
      if (!drawing) return;
      drawing = false;
      decals[surface].getContext('2d').globalCompositeOperation = 'source-over';
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);

    $('g-surf-side').addEventListener('click', () => showSurface('side'));
    $('g-surf-top').addEventListener('click', () => showSurface('top'));
    $('g-color').addEventListener('input', (e) => {
      color = e.target.value;
      if (tool === 'eraser') tool = 'brush';
      renderTools();
    });
    $('g-size').addEventListener('input', (e) => (size = +e.target.value));
    for (const t of document.querySelectorAll('#g-tools [data-tool]')) {
      t.addEventListener('click', () => {
        tool = t.dataset.tool;
        renderTools();
      });
    }
    $('g-undo').addEventListener('click', () => {
      const st = undo[surface];
      if (!st.length) return;
      decals[surface].getContext('2d').putImageData(st.pop(), 0, 0);
      preview.markDecalsChanged();
      touched();
    });
    $('g-clear').addEventListener('click', () => {
      if (decalIsBlank(decals[surface])) return;
      snapshot();
      const cv = decals[surface];
      cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
      preview.markDecalsChanged();
      touched();
    });
  }

  // ---- open / save / close ---------------------------------------------------------------

  async function open(uid) {
    userId = uid;
    $('garage').classList.remove('hidden');
    if (!preview) {
      preview = new GaragePreview($('g-canvas'));
      wireDrawing();
      $('g-flame').addEventListener('click', (e) => {
        const on = e.currentTarget.dataset.on !== '1';
        e.currentTarget.dataset.on = on ? '1' : '0';
        e.currentTarget.textContent = on ? 'BOOST FLAMES: ON' : 'BOOST FLAMES: OFF';
        preview.setBoost(on);
        e.currentTarget.blur();
      });
      $('g-close').addEventListener('click', close);
      $('g-save').addEventListener('click', save);
      $('garage').addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.code === 'Escape') close();
      });
    }
    msg('Loading your garage...');
    preview.start();
    try {
      const [c, unl, row] = await Promise.all([api.getWallet(), api.getUnlocks(), api.getLoadout(uid)]);
      owned = new Set(unl);
      setCoins(c);
      saved = cleanLoadout(row);
      draft = { ...saved };
      decals = { side: await loadDecal(row && row.decal_side, 'side'), top: await loadDecal(row && row.decal_top, 'top') };
      undo.side = [];
      undo.top = [];
      dirty = false;
      $('g-save').classList.remove('pulse');
      $('g-draw-wrap').style.background = hex(itemById(draft.paint).color);
      rebuildPreview();
      renderTabs();
      renderTools();
      renderBody();
      msg('Pick a part to try it on. Free parts are yours already; buy the rest with Drift Coins.');
    } catch (e) {
      msg('Could not load your garage: ' + (e.message || e), true);
    }
  }

  async function save() {
    if (busy) return;
    const final = { ...draft };
    const removed = [];
    for (const k of KINDS) {
      if (!isOwned(final[k])) {
        final[k] = isOwned(saved[k]) ? saved[k] : DEFAULT_LOADOUT[k];
        removed.push(itemById(draft[k]).name);
      }
    }
    const sideUrl = decalIsBlank(decals.side) ? '' : decals.side.toDataURL('image/png');
    const topUrl = decalIsBlank(decals.top) ? '' : decals.top.toDataURL('image/png');
    if (sideUrl.length > MAX_URL || topUrl.length > MAX_URL) return msg('That drawing is too detailed to save. Clear a little and try again.', true);
    busy = true;
    msg('Saving...');
    try {
      await api.saveLoadout(final, sideUrl, topUrl);
      saved = final;
      draft = { ...final };
      dirty = false;
      $('g-save').classList.remove('pulse');
      rebuildPreview();
      renderBody();
      msg(removed.length ? `Saved. ${removed.join(', ')} not fitted because you do not own ${removed.length > 1 ? 'them' : 'it'} yet.` : 'Saved! Your car is ready for the next race.');
      onSaved(final, decals);
    } catch (e) {
      msg(e.message || 'Could not save.', true);
    } finally {
      busy = false;
    }
  }

  function close() {
    if (dirty && !confirm('Close without saving your changes?')) return;
    dirty = false;
    preview && preview.stop();
    $('garage').classList.add('hidden');
  }

  return { open, close, isOpen: () => !$('garage').classList.contains('hidden'), setCoins, userId: () => userId };
}

/** In-memory stand-in for the database, used only by the dev server (?mockgarage) so the screen can be tested offline. */
export function mockGarageApi() {
  let coins = 900;
  const unlocked = new Set();
  let row = null;
  return {
    getWallet: async () => coins,
    getUnlocks: async () => [...unlocked],
    getLoadout: async () => row,
    buyItem: async (id) => {
      const it = itemById(id);
      if (coins < it.cost) throw new Error('not enough Drift Coins');
      coins -= it.cost;
      unlocked.add(id);
      return { coins, item: id };
    },
    saveLoadout: async (l, side, top) => {
      row = { ...l, decal_side: side, decal_top: top };
    },
  };
}
