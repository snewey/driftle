import { CATALOG, KINDS, KIND_LABEL, DEFAULT_LOADOUT, GLOW_COLORS, TOP3_HINT, isFree, itemById, cleanLoadout } from './catalog.js';
import { GaragePreview } from './garage-preview.js';
import { blankDecals, loadDecal, decalIsBlank, CELL, DECAL_CELLS } from './car.js';

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
  let tool = 'paint';
  let color = '#ff3d71';
  let brush = 1;
  let busy = false;
  let drawing = false;
  let undo = [];

  const isOwned = (id) => {
    const it = itemById(id);
    return !!it && (isFree(it) || owned.has(id));
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
    $('g-body').classList.toggle('drawing', draw);
    if (draw !== drawing) {
      drawing = draw;
      preview.setGrid(draw);
      preview.resize();
      setDrawView(draw ? 'right' : null);
      if (draw) preview.setZoom(0.72);
      renderTools();
      if (draw) msg('Click squares on the car to paint them. Use the view buttons to reach every side.');
    }
    if (draw) return;
    const grid = $('g-items');
    grid.innerHTML = '';
    for (const it of CATALOG[tab]) {
      const have = isOwned(it.id);
      const on = draft[tab] === it.id;
      const card = document.createElement('div');
      card.className = 'g-card' + (on ? ' on' : '') + (have ? '' : ' locked');
      card.tabIndex = 0;
      const status = on ? 'ON YOUR CAR' : have ? (isFree(it) ? 'FREE' : it.top3 ? 'TOP 3 REWARD' : 'OWNED') : '';
      card.innerHTML = `${cardSwatch(tab, it)}<div class="nm">${it.name}</div>${it.blurb ? `<div class="bl">${it.blurb}</div>` : ''}<div class="st">${status}</div>`;
      if (!have && it.top3) {
        const note = document.createElement('div');
        note.className = 'g-reward';
        note.textContent = '🏆 TOP 3 REWARD';
        note.title = TOP3_HINT;
        card.appendChild(note);
        card.addEventListener('click', () => msg(`${it.name}: ${TOP3_HINT}`));
        grid.appendChild(card);
        continue;
      }
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
    if (it.top3) return msg(TOP3_HINT, true);
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

  // ---- drawing: click squares on the car -------------------------------------------------

  const rgba = (g, cx, cy) => g.getImageData(cx * CELL + CELL / 2, cy * CELL + CELL / 2, 1, 1).data;
  const same = (p, q) => (p[3] === 0 && q[3] === 0) || (p[0] === q[0] && p[1] === q[1] && p[2] === q[2] && p[3] === q[3]);

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
        if (tool === 'erase' || tool === 'pick') tool = 'paint';
        $('g-color').value = c;
        renderTools();
      });
      sw.appendChild(b);
    }
    for (const t of document.querySelectorAll('#g-tools [data-tool]')) t.classList.toggle('on', t.dataset.tool === tool);
    for (const t of document.querySelectorAll('#g-sizes [data-size]')) t.classList.toggle('on', +t.dataset.size === brush);
    if (preview) preview.setPaintMode(tab === 'draw' && tool !== 'turn', paintHandlers);
  }

  function snapshot() {
    undo.push({
      side: decals.side.getContext('2d').getImageData(0, 0, decals.side.width, decals.side.height),
      top: decals.top.getContext('2d').getImageData(0, 0, decals.top.width, decals.top.height),
    });
    if (undo.length > 30) undo.shift();
  }

  function stampCells(which, cx, cy) {
    const g = decals[which].getContext('2d');
    const [W, H] = DECAL_CELLS[which];
    const off = Math.floor((brush - 1) / 2);
    for (let y = 0; y < brush; y++) {
      for (let x = 0; x < brush; x++) {
        const X = cx - off + x;
        const Y = cy - off + y;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        if (tool === 'erase') g.clearRect(X * CELL, Y * CELL, CELL, CELL);
        else {
          g.clearRect(X * CELL, Y * CELL, CELL, CELL);
          g.fillStyle = color;
          g.fillRect(X * CELL, Y * CELL, CELL, CELL);
        }
      }
    }
  }

  // Every square between two hits, so quick drags leave no gaps.
  function line(which, x0, y0, x1, y1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) stampCells(which, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n));
  }

  function floodFill(which, cx, cy) {
    const g = decals[which].getContext('2d');
    const [W, H] = DECAL_CELLS[which];
    const target = rgba(g, cx, cy).slice();
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = color;
    c.fillRect(0, 0, 1, 1);
    const want = c.getImageData(0, 0, 1, 1).data;
    if (same(target, want)) return;
    const seen = new Uint8Array(W * H);
    const stack = [[cx, cy]];
    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= W || y >= H || seen[y * W + x]) continue;
      seen[y * W + x] = 1;
      if (!same(rgba(g, x, y), target)) continue;
      g.clearRect(x * CELL, y * CELL, CELL, CELL);
      g.fillStyle = color;
      g.fillRect(x * CELL, y * CELL, CELL, CELL);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  let lastHit = null;
  const paintHandlers = {
    down(hit) {
      lastHit = null;
      if (!hit) return;
      if (tool === 'pick') {
        const d = rgba(decals[hit.which].getContext('2d'), hit.cx, hit.cy);
        if (d[3] > 0) {
          color = '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
          $('g-color').value = color;
          tool = 'paint';
          renderTools();
          msg('Colour picked.');
        }
        return;
      }
      snapshot();
      if (tool === 'fill') floodFill(hit.which, hit.cx, hit.cy);
      else {
        stampCells(hit.which, hit.cx, hit.cy);
        lastHit = hit;
      }
      preview.markDecalsChanged();
      touched();
    },
    move(hit) {
      if (!hit || tool === 'fill' || tool === 'pick') return;
      if (lastHit && lastHit.which === hit.which) line(hit.which, lastHit.cx, lastHit.cy, hit.cx, hit.cy);
      else stampCells(hit.which, hit.cx, hit.cy);
      lastHit = hit;
      preview.markDecalsChanged();
    },
    up() {
      lastHit = null;
    },
  };

  function setDrawView(name) {
    preview.setView(name);
    for (const b of document.querySelectorAll('#g-views [data-view]')) b.classList.toggle('on', b.dataset.view === name);
  }

  function wireDrawing() {
    $('g-color').addEventListener('input', (e) => {
      color = e.target.value;
      if (tool === 'erase' || tool === 'pick') tool = 'paint';
      renderTools();
    });
    for (const t of document.querySelectorAll('#g-tools [data-tool]')) {
      t.addEventListener('click', () => {
        tool = t.dataset.tool;
        renderTools();
      });
    }
    for (const t of document.querySelectorAll('#g-sizes [data-size]')) {
      t.addEventListener('click', () => {
        brush = +t.dataset.size;
        renderTools();
      });
    }
    for (const b of document.querySelectorAll('#g-views [data-view]')) b.addEventListener('click', () => setDrawView(b.dataset.view));
    $('g-turn-l').addEventListener('click', () => preview.turn(-Math.PI / 12));
    $('g-turn-r').addEventListener('click', () => preview.turn(Math.PI / 12));
    $('g-zoom-in').addEventListener('click', () => preview.setZoom(preview.zoom * 0.85));
    $('g-zoom-out').addEventListener('click', () => preview.setZoom(preview.zoom / 0.85));
    $('g-undo').addEventListener('click', () => {
      const st = undo.pop();
      if (!st) return;
      decals.side.getContext('2d').putImageData(st.side, 0, 0);
      decals.top.getContext('2d').putImageData(st.top, 0, 0);
      preview.markDecalsChanged();
      touched();
    });
    $('g-clear').addEventListener('click', () => {
      if (decalIsBlank(decals.side) && decals.top && decalIsBlank(decals.top)) return;
      snapshot();
      for (const w of ['side', 'top']) decals[w].getContext('2d').clearRect(0, 0, decals[w].width, decals[w].height);
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
      const fresh = api.claimTop3 ? await api.claimTop3().catch(() => []) : [];
      const [c, unl, row] = await Promise.all([api.getWallet(), api.getUnlocks(), api.getLoadout(uid)]);
      owned = new Set(unl);
      setCoins(c);
      saved = cleanLoadout(row);
      draft = { ...saved };
      decals = { side: await loadDecal(row && row.decal_side, 'side'), top: await loadDecal(row && row.decal_top, 'top') };
      undo = [];
      dirty = false;
      $('g-save').classList.remove('pulse');
      rebuildPreview();
      renderTabs();
      renderTools();
      renderBody();
      if (fresh.length) msg(`🏆 You finished in the official top 3! Unlocked: ${fresh.map((id) => itemById(id).name).join(' and ')}.`);
      else msg('Pick a part to try it on. Free parts are yours already; buy the rest with Drift Coins.');
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
      if (it.top3) throw new Error('this item is a reward for finishing in the top 3');
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
