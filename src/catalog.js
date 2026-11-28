// Everything you can unlock for your car. Pure data (no browser or 3D code), so the garage,
// the 3D car builder and the tests all read the same list. Prices here are for display:
// the database holds the real prices (supabase/migrations) and is what actually charges you.
// Everything is cosmetic. Every car drives and collides exactly the same.

export const KINDS = ['car', 'paint', 'flame', 'exhaust', 'spoiler', 'wheels', 'glow'];

export const KIND_LABEL = {
  car: 'Car',
  paint: 'Paint',
  flame: 'Boost flames',
  exhaust: 'Exhaust',
  spoiler: 'Spoiler',
  wheels: 'Wheels',
  glow: 'Underglow',
};

const item = (id, name, cost, extra = {}) => ({ id, name, cost, ...extra });

export const CATALOG = {
  car: [
    item('car_hatch', 'Rally Hatch', 0, { blurb: 'Short, tough and tidy.' }),
    item('car_coupe', 'Street Coupe', 450, { blurb: 'Low and sleek.' }),
    item('car_muscle', 'Muscle 69', 700, { blurb: 'Big bonnet, big attitude.' }),
    item('car_pickup', 'Mini Pickup', 600, { blurb: 'Drift with a tray.' }),
    item('car_wedge', 'Wedge GT', 1000, { blurb: 'Wide, flat and fast looking.' }),
  ],
  paint: [
    item('paint_pink', 'Hot Pink', 0, { color: 0xff3d71, finish: 'gloss' }),
    item('paint_red', 'Racing Red', 0, { color: 0xd92b2b, finish: 'gloss' }),
    item('paint_orange', 'Sunset Orange', 0, { color: 0xff8a2b, finish: 'gloss' }),
    item('paint_yellow', 'Lemon', 0, { color: 0xffd23b, finish: 'gloss' }),
    item('paint_green', 'Lime', 0, { color: 0x4cd964, finish: 'gloss' }),
    item('paint_teal', 'Teal', 0, { color: 0x1fc8b4, finish: 'gloss' }),
    item('paint_blue', 'Royal Blue', 0, { color: 0x2f6bff, finish: 'gloss' }),
    item('paint_white', 'Snow', 0, { color: 0xf1f3f7, finish: 'gloss' }),
    item('paint_black', 'Coal', 0, { color: 0x1b1d23, finish: 'gloss' }),
    item('paint_candy', 'Candy Purple', 200, { color: 0x8e3bff, finish: 'metal' }),
    item('paint_matte', 'Matte Black', 200, { color: 0x24262c, finish: 'matte' }),
    item('paint_mint', 'Matte Mint', 200, { color: 0x7fe0b8, finish: 'matte' }),
    item('paint_pearl', 'Pearl White', 250, { color: 0xfaf6ef, finish: 'metal' }),
    item('paint_gold', 'Gold Leaf', 250, { color: 0xe8b43a, finish: 'metal' }),
    item('paint_chrome', 'Chrome', 350, { color: 0xc9d1dc, finish: 'chrome' }),
    item('paint_shift', 'Colour Shift', 500, { color: 0xff3d71, finish: 'shift' }),
  ],
  flame: [
    item('flame_orange', 'Classic Orange', 0, { outer: 0xff9f43, inner: 0xfff3b0 }),
    item('flame_blue', 'Blue Flame', 200, { outer: 0x2f7bff, inner: 0xbfe6ff }),
    item('flame_purple', 'Purple Flame', 250, { outer: 0xa24bff, inner: 0xf0d4ff }),
    item('flame_green', 'Toxic Green', 250, { outer: 0x38e07a, inner: 0xdfffe9 }),
    item('flame_pink', 'Hot Pink Flame', 250, { outer: 0xff4fa3, inner: 0xffd6ec }),
    item('flame_white', 'White Hot', 350, { outer: 0xcfe9ff, inner: 0xffffff }),
    item('flame_rainbow', 'Rainbow', 0, { outer: 0xff4fa3, inner: 0xffffff, rainbow: true, top3: true }),
  ],
  exhaust: [
    item('exh_stock', 'Stock Pipes', 0),
    item('exh_dual', 'Chrome Duals', 150),
    item('exh_quad', 'Quad Tips', 300),
    item('exh_mega', 'Megaphone', 250),
    item('exh_side', 'Side Pipes', 350),
    item('exh_stack', 'Smoke Stacks', 300),
  ],
  spoiler: [
    item('spo_stock', 'Stock Wing', 0),
    item('spo_none', 'No Spoiler', 0),
    item('spo_duck', 'Ducktail', 100),
    item('spo_tall', 'Tall Wing', 200),
    item('spo_carbon', 'Carbon GT Wing', 300),
    item('spo_double', 'Double Decker', 400),
  ],
  wheels: [
    item('whl_steel', 'Steelies', 0),
    item('whl_sport', 'Chrome Five-Spoke', 150),
    item('whl_gold', 'Gold Mesh', 250),
    item('whl_blue', 'Neon Blue', 300),
    item('whl_pink', 'Neon Pink', 300),
  ],
  glow: [
    item('glow_none', 'No Underglow', 0),
    item('glow_white', 'Ice White', 150),
    item('glow_blue', 'Blue Glow', 200),
    item('glow_pink', 'Pink Glow', 200),
    item('glow_purple', 'Purple Glow', 200),
    item('glow_green', 'Green Glow', 200),
    item('glow_red', 'Red Glow', 200),
    item('glow_rainbow', 'Rainbow Glow', 0, { top3: true }),
  ],
};

// Reward items: not for sale. Unlocked by finishing in the top 3 on a live daily board.
export const TOP3_HINT = 'Finish in the official top 3 when a day ends (midnight UTC) to unlock. Not for sale.';
/** True when everyone owns the item from the start. */
export const isFree = (it) => it.cost === 0 && !it.top3;

export const GLOW_COLORS = {
  glow_white: 0xdff3ff,
  glow_blue: 0x2f7bff,
  glow_pink: 0xff4fa3,
  glow_purple: 0xa24bff,
  glow_green: 0x38e07a,
  glow_red: 0xff3030,
};

export const DEFAULT_LOADOUT = {
  car: 'car_hatch',
  paint: 'paint_pink',
  flame: 'flame_orange',
  exhaust: 'exh_stock',
  spoiler: 'spo_stock',
  wheels: 'whl_steel',
  glow: 'glow_none',
};

const BY_ID = new Map();
for (const kind of KINDS) for (const it of CATALOG[kind]) BY_ID.set(it.id, { ...it, kind });

export function itemById(id) {
  return BY_ID.get(id) || null;
}

export function allItems() {
  return [...BY_ID.values()];
}

/** Makes any loadout safe: unknown or missing ids fall back to the free defaults. */
export function cleanLoadout(l) {
  const out = {};
  for (const k of KINDS) {
    const it = l && itemById(l[k]);
    out[k] = it && it.kind === k ? it.id : DEFAULT_LOADOUT[k];
  }
  return out;
}

/** SQL for the shop_items table, so the database prices always come from this one list. */
export function shopSeedSQL() {
  const rows = allItems().map((i) => `  ('${i.id}', '${i.kind}', '${i.name.replace(/'/g, "''")}', ${i.cost})`);
  return `insert into public.shop_items (id, kind, name, cost) values\n${rows.join(',\n')}\non conflict (id) do update set kind = excluded.kind, name = excluded.name, cost = excluded.cost;\n-- reward-only items:\nupdate public.shop_items set top3_only = true where id in (${allItems().filter((i) => i.top3).map((i) => `'${i.id}'`).join(', ')});`;
}
