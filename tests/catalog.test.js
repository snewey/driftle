import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KINDS, CATALOG, DEFAULT_LOADOUT, allItems, itemById, cleanLoadout, shopSeedSQL, isFree } from '../src/catalog.js';

test('item ids are unique and costs are whole numbers >= 0', () => {
  const ids = allItems().map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const i of allItems()) assert.ok(Number.isInteger(i.cost) && i.cost >= 0, i.id);
});

test('default loadout is made of free items of the right kind', () => {
  for (const k of KINDS) {
    const it = itemById(DEFAULT_LOADOUT[k]);
    assert.ok(it && it.kind === k && it.cost === 0, k);
  }
});

test('every kind has at least one free item', () => {
  for (const k of KINDS) assert.ok(CATALOG[k].some(isFree), k);
});

test('cleanLoadout falls back to defaults for junk', () => {
  assert.deepEqual(cleanLoadout(null), DEFAULT_LOADOUT);
  const c = cleanLoadout({ car: 'nope', paint: 'flame_blue', flame: 'flame_blue' });
  assert.equal(c.car, DEFAULT_LOADOUT.car);
  assert.equal(c.paint, DEFAULT_LOADOUT.paint); // wrong kind
  assert.equal(c.flame, 'flame_blue');
});

test('migration seed matches the catalog', () => {
  const sql = readFileSync(new URL('../supabase/migrations/0004_garage_and_coins.sql', import.meta.url), 'utf8');
  const top3 = readFileSync(new URL('../supabase/migrations/0006_top3_rewards.sql', import.meta.url), 'utf8');
  for (const i of allItems()) {
    if (i.top3) assert.ok(top3.includes(`'${i.id}'`), i.id + ' must be reward-only in 0006');
    else assert.ok(sql.includes(`('${i.id}', '${i.kind}', '${i.name.replace(/'/g, "''")}', ${i.cost})`), i.id);
  }
  assert.ok(shopSeedSQL().includes('on conflict'));
});

test('rainbow items are top-3 rewards, not for sale', () => {
  for (const id of ['flame_rainbow', 'glow_rainbow']) {
    const it = itemById(id);
    assert.ok(it.top3 && !isFree(it), id);
  }
  assert.ok(isFree(itemById('flame_orange')));
});
