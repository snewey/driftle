# Driftle

A daily drift racing time trial for the browser. Everyone gets the same track each day,
chases the best 3-lap time, and can race a ghost of their own best run. The track and the
leaderboard reset at 00:00 UTC.

Status: **v0.2 - playable offline, now in 3D** (third-person chase camera, textured road, trees, sky). Online accounts, the global daily leaderboard and shared
ghosts come next (Supabase), then publishing (Vercel).

## Run it

```bash
npm install
npm run dev      # play at http://localhost:5173
npm test         # game logic tests
npm run build    # production build into dist/
```

Needs Node 18 or newer. No accounts, keys or paid services are needed to play.

## How to play

| Key | Action |
| --- | --- |
| W / Up | Accelerate |
| S / Down | Brake, then reverse |
| A D / Left Right | Steer |
| Space | Handbrake: tap while turning to kick the tail out into a drift |
| R | Restart the race |
| Esc | Back to the menu |

Hold a slide to build drift charge, then straighten out to cash it in as a speed boost.
Cornering without drifting scrubs speed, and the grass slows you down a lot.

## How it works

- **Daily track:** `src/track.js` builds the track from the UTC date, so the same day always
  gives the same track on every device. Shapes are closed loops that can never cross
  themselves, and corners are smoothed until they are driveable.
- **Fixed timestep physics:** `src/sim.js` runs at 120 ticks per second, independent of the
  screen's frame rate, so a run produces the same time on any computer. It has no browser
  code in it, so it can also be replayed on a server later to check leaderboard times.
- **Ghosts:** `src/ghost.js` stores a run as a compact list of positions (about 20 KB for a
  one minute run) and replays it with a live time gap on the HUD.
- **3D view:** `src/render3d.js` draws the sim with Three.js. The sim stays flat 2D (x, y,
  heading) and is mapped onto the ground plane, so physics, ghosts and timing are untouched.
  Textures (asphalt, grass, kerbs, bark, leaves, tyres, sky) are drawn procedurally at start-up, so
  there are no image files to download. Trees are instanced (about 2,600 in a few draw calls).
  Each day also picks one of five looks (clear day, golden hour, overcast, autumn, dusk).
  Trees and the grandstand are decoration only: there is no collision with them yet.
- **Storage:** `src/backend.js` keeps runs in the browser for now. The game only talks to
  the methods on that object, so a Supabase version can replace it without touching the game.

## Tuning the feel

Every driving number (grip, drift yaw, boost strength, grass drag and so on) is in the
`PHYS` block at the top of `src/sim.js`. Track tightness is `MIN_RADIUS` in `src/track.js`.

## Project layout

```
src/
  main.js      game loop, menu, HUD, finish screen
  sim.js       driving physics and lap logic
  track.js     daily track generator
  render3d.js  3D scene, chase camera, car, trees, effects (Three.js)
  minimap.js   2D track outline for the HUD and menu
  ghost.js     ghost recording and replay
  backend.js   saved runs (local now, Supabase later)
  rng.js       seeded random numbers
tests/         node --test suite
```

## Secrets

Never commit real keys. `.env` files are git-ignored and `.env.example` lists the names used
later for Supabase. Only the public (publishable) Supabase key ever goes in browser code, and
only with Row Level Security turned on. The service role key must never be in this repo.

## Roadmap

1. Playable offline game (done)
2. Supabase: accounts, global daily leaderboard, personal bests, shared ghosts
3. Publish on Vercel (free Hobby plan)
4. Polish: sound, more cars, tree/barrier collision, mobile controls


## v0.3
- Steering is softer (slower steering response, more speed-sensitive) and drifts turn the car more, so drifting is easier.
- Roadside marker posts removed; trees now start just past the kerb.
- Trees, the start gantry posts and the grandstand are solid: hitting them stops the car (shared scenery list in `src/scenery.js`, collision in `src/sim.js`).
- Synthesised sound (`src/audio.js`, no audio files): engine with gears, tyre skid, grass rumble, countdown beeps, GO, lap ding, drift boost, crash, finish fanfare. Press `M` or click the SOUND chip to mute. Sound starts after the first click or key press (browser rule).

## v0.4 online (Supabase)
- Database in `supabase/migrations/0001_init.sql`: `profiles`, `daily_bests` (one best run + ghost per player per day), `submit_run()` and `get_leaderboard()`. Row Level Security is on; players can only write through `submit_run`, which checks the day and the time.
- Sign in / sign up from the menu to join the worldwide daily board and race other players' ghosts. Signed out, the game stays offline (localStorage).
- Setup: copy `.env.example` to `.env.local` and fill in the project URL and publishable key. Times are reported by the browser, so a determined cheater could fake one; a server-side replay check is a later step.

## v0.5 replays
- Click any driver's name on the leaderboard to watch their best run, with the keys they pressed (W A S D and Space) lit up on screen. Controls: Pause (P), Speed (1x / 0.5x / 0.25x), Restart (R), Back (Esc).
- Each best run stores its key presses (`daily_bests.inputs`, run-length encoded, about 1-4 KB). Runs set before this update have no key data, so they replay without the keys.
- The same input record can later be re-simulated on a server to verify times (anti-cheat).

## v0.6: Garage, Drift Coins and car drawing

- **Drift Coins** (signed-in players only): +50 for finishing a race (first 10 paid finishes a day), +2 per drift boost (max 20 a race), +100 for your first PB of the day, +30 for each later improvement (max 5 a day), +50 for reaching #1 (once a day). Coins are worked out in the database (`submit_run`), not in the browser.
- **Garage**: 5 cars, 16 paints, 7 boost-flame colours (blue, purple, rainbow...), exhausts, spoilers, wheels and underglow. All cosmetic. Prices live in `src/catalog.js` and are seeded into `shop_items` (migration `0004`). Buying and saving go through `buy_item` / `set_loadout`, which check you own the item.
- **Draw on your car**: side and bonnet/roof canvases with brush, eraser, text and stamps. Saved as small PNGs with your loadout and shown to other players on your ghost and replay.
- Dev preview without an account: `npm run dev`, open `/?mockgarage`.

## v0.7: Home screen, past tracks, car pictures, coin payout

- **Home screen** with Play, Garage, Past Tracks, account and coin balance. Esc on the track screen goes back to it.
- **Past tracks**: open any of the last 14 days (`/?day=YYYY-MM-DD`). You can see that day's board, watch replays and race ghosts. Runs there are practice only: not posted, no coins (the database still only accepts today's date).
- **Leaderboard cars**: `get_leaderboard` (migration `0005`) now returns each driver's car parts, and `src/thumbs.js` draws a small picture per car. Drawings are not included on the board to keep it light; they still show on replays and ghosts.
- **Coin payout**: gold `+N` with a coin icon for each earning on the finish screen, plus a floating `+2` on every drift boost.
