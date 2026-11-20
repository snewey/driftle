# Driftle

A daily drift racing time trial for the browser. Everyone gets the same track each day,
chases the best 3-lap time, and can race a ghost of their own best run. The track and the
leaderboard reset at 00:00 UTC.

Status: **v0.1 - playable offline.** Online accounts, the global daily leaderboard and shared
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
  render.js    canvas drawing and minimap
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
4. Polish: sound, more cars, mobile controls
