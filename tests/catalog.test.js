import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KINDS, CATALOG, DEFAULT_LOADOUT, allItems, itemById, cleanLoadout, shopSeedSQL } from '../src/catalog.js';

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
  for (const k of KINDS) assert.ok(CATALOG[k].some((i) => i.cost === 0), k);
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
  for (const i of allItems()) assert.ok(sql.includes(`('${i.id}', '${i.kind}', '${i.name.replace(/'/g, "''")}', ${i.cost})`), i.id);
  assert.ok(shopSeedSQL().includes('on conflict'));
});
