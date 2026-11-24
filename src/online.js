// Online backend (Supabase). Only the public URL and the publishable key are used here.
// Those are designed to be visible in the browser; what protects the data is Row Level
// Security plus the submit_run() function in supabase/migrations. Never put a
// service_role / secret key anywhere in this project.
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const onlineAvailable = !!(URL && KEY);
export const supabase = onlineAvailable
  ? createClient(URL, KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

const NAME_OK = /^(?=.*[A-Za-z0-9])[A-Za-z0-9_ -]{2,16}$/;

function niceError(err) {
  const m = (err && err.message) || String(err);
  if (/already registered|already been registered/i.test(m)) return 'That email already has an account. Try signing in.';
  if (/invalid login/i.test(m)) return 'Wrong email or password.';
  if (/password/i.test(m) && /6|short|weak/i.test(m)) return 'Password needs at least 6 characters.';
  if (/rate limit|too many/i.test(m)) return 'Too many tries. Wait a minute and try again.';
  if (/email/i.test(m) && /invalid/i.test(m)) return 'That email address does not look right.';
  return m;
}

export async function currentUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ? data.session.user : null;
}

export function onAuthChange(cb) {
  if (!supabase) return;
  supabase.auth.onAuthStateChange((_evt, session) => setTimeout(() => cb(session ? session.user : null), 0));
}

/** Makes sure the signed-in user has a profile (display name). Returns the name. */
export async function ensureProfile(user, wantedName) {
  const { data: row } = await supabase.from('profiles').select('name').eq('id', user.id).maybeSingle();
  if (row) return row.name;
  const name = wantedName || user.user_metadata?.name;
  if (!name || !NAME_OK.test(name)) throw new Error('Pick a driver name (2-16 letters, numbers, spaces, - or _).');
  const { error } = await supabase.from('profiles').insert({ id: user.id, name });
  if (error) {
    if (error.code === '23505') throw new Error('That driver name is taken. Pick another.');
    throw error;
  }
  return name;
}

export async function signUp(email, password, name) {
  if (!NAME_OK.test(name)) return { error: 'Driver name: 2-16 letters, numbers, spaces, - or _.' };
  const { data: free } = await supabase.rpc('name_available', { p_name: name });
  if (free === false) return { error: 'That driver name is already taken. Pick another one.' };
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { name } } });
  if (error) return { error: niceError(error) };
  if (!data.session) return { confirm: true }; // email confirmation is switched on
  try {
    await ensureProfile(data.user, name);
  } catch (e) {
    return { error: niceError(e) };
  }
  return { user: data.user };
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: niceError(error) };
  try {
    const name = await ensureProfile(data.user);
    return { user: data.user, name };
  } catch (e) {
    return { error: niceError(e) };
  }
}

export async function signOut() {
  await supabase.auth.signOut();
}

export class OnlineBackend {
  constructor(user, name) {
    this.kind = 'online';
    this.user = user;
    this.name = name;
  }

  async getPersonalBest(day) {
    if (!this.user) return null;
    const { data } = await supabase
      .from('daily_bests')
      .select('time_ms, ghost, inputs')
      .eq('user_id', this.user.id)
      .eq('day', day)
      .maybeSingle();
    return data ? { timeMs: data.time_ms, ghost: data.ghost, inputs: data.inputs, runId: this.user.id } : null;
  }

  async getLeaderboard(day) {
    const { data, error } = await supabase.rpc('get_leaderboard', { p_day: day, p_limit: 25 });
    if (error) throw error;
    return (data || []).map((r) => ({
      runId: r.user_id,
      name: r.name,
      timeMs: r.time_ms,
      rank: Number(r.rank),
      hasGhost: true,
      loadout: r.car ? { car: r.car, paint: r.paint, flame: r.flame, exhaust: r.exhaust, spoiler: r.spoiler, wheels: r.wheels, glow: r.glow } : null,
      isYou: !!this.user && r.user_id === this.user.id,
    }));
  }

  async submitRun({ day, timeMs, laps, ghost, inputs, boosts }) {
    const { data, error } = await supabase.rpc('submit_run', {
      p_day: day,
      p_time_ms: timeMs,
      p_laps: laps.map((l) => Math.round(l)),
      p_ghost: ghost,
      p_inputs: inputs || '',
      p_boosts: boosts || 0,
    });
    if (error) throw error;
    return { rank: data.rank, isPB: data.improved, runId: this.user.id, coins: data.coins, wallet: data.wallet };
  }

  async getGhost(day, userId) {
    const { data } = await supabase.from('daily_bests').select('time_ms, ghost, inputs').eq('user_id', userId).eq('day', day).maybeSingle();
    return data ? { timeMs: data.time_ms, ghost: data.ghost, inputs: data.inputs, runId: userId } : null;
  }
}

// ---- Drift Coins, shop and garage -------------------------------------------------------
// The server holds the real wallet and prices. These calls only ask it to do things.

export async function getWallet() {
  const { data } = await supabase.from('wallets').select('coins').maybeSingle();
  return data ? data.coins : 0;
}

export async function getUnlocks() {
  const { data } = await supabase.from('unlocks').select('item_id');
  return (data || []).map((r) => r.item_id);
}

/** A driver's saved car (public, so other players can see it on ghosts and replays). */
export async function getLoadout(userId) {
  const { data } = await supabase
    .from('loadouts')
    .select('car, paint, flame, exhaust, spoiler, wheels, glow, decal_side, decal_top')
    .eq('user_id', userId)
    .maybeSingle();
  return data || null;
}

export async function buyItem(itemId) {
  const { data, error } = await supabase.rpc('buy_item', { p_item: itemId });
  if (error) throw new Error(error.message);
  return data; // { coins, item, already_owned }
}

export async function saveLoadout(l, sideUrl, topUrl) {
  const { error } = await supabase.rpc('set_loadout', {
    p_car: l.car,
    p_paint: l.paint,
    p_flame: l.flame,
    p_exhaust: l.exhaust,
    p_spoiler: l.spoiler,
    p_wheels: l.wheels,
    p_glow: l.glow,
    p_side: sideUrl || '',
    p_top: topUrl || '',
  });
  if (error) throw new Error(error.message);
}
