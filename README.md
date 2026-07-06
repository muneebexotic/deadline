# DEADLINE

One side-scrolling gauntlet, identical for every player on Earth, generated from today's
UTC date. When anyone dies, their corpse freezes into the level **for all players, in
realtime**. Corpses fill spike pits, stack into climbable piles, and are the only way past
the mid-level wall. The world resets at 00:00 UTC. Yesterday's level is gone forever.

Ranked by completion time. Most players never finish. That's fine — their bodies are the content.

## Controls

| Input | Action |
| --- | --- |
| `←` `→` / `A` `D` | move |
| `Space` / `W` / `↑` | jump (variable height, 80ms coyote, 100ms buffer) |
| `R` | instant restart |
| `X` | sacrifice yourself where you stand (build the pile) |
| touch | left/right zones bottom-left, tap right side to jump |

## Stack

- Vite + TypeScript, HTML5 Canvas, zero game frameworks. Fixed-timestep loop (120hz sim,
  interpolated render). ~72KB JS gzipped.
- Supabase: Postgres (corpses/finishes), Realtime broadcast + presence, 3 edge functions.
- Vercel: static hosting + `/api/og` dynamic OG image (death count + heatmap, cached 10min).
- No accounts. 3-letter arcade tag in localStorage.

The game is fully playable **offline / without env vars** — it just becomes single-player
(your own corpses only) and shows `OFFLINE` in the HUD.

## Setup

### 1. Supabase (one project, ~5 minutes)

1. Create a project at [database.new](https://database.new).
2. Run the migration: paste `supabase/migrations/0001_init.sql` into the SQL editor
   (or `supabase db push` with the CLI).
3. Deploy the edge functions (requires [Supabase CLI](https://supabase.com/docs/guides/cli)):

   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase secrets set IP_SALT=$(openssl rand -hex 24)
   supabase functions deploy snapshot submit-death submit-finish
   ```

4. In **Project Settings → API**, copy the URL and `anon` key.

Notes:
- Row Level Security: reads are public, writes only happen inside the edge functions
  (service role). The `ip_hash` column (salted SHA-256, rate limiting only) is excluded
  from anonymous reads via column-level grants.
- Rate limits: 1 death / 2s / IP, 200 deaths/day/IP, 30 finishes/day/IP. Finishes under
  20s are rejected as impossible.
- Old days are never deleted. They're history, browsable in the archive.

### 2. Local dev

```sh
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev            # http://localhost:5173
```

Realtime smoke test: open two browser tabs, die in one — the corpse appears in the other
within ~1.5s (after the ragdoll settles) and the ticker updates in both.

Perf harness: `http://localhost:5173/?corpses=100000` scatters 100k synthetic corpses.

### 3. Deploy to Vercel

```sh
vercel deploy --prod
```

Set these env vars in the Vercel project (all environments):

| Var | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | your Supabase URL |
| `VITE_SUPABASE_ANON_KEY` | anon key |
| `VITE_SITE_URL` | your production URL (used in share text) |
| `SUPABASE_URL` | same Supabase URL (for `/api/og`) |
| `SUPABASE_ANON_KEY` | same anon key (for `/api/og`) |

### 4. Seed a test day

```sh
# .env additionally needs SUPABASE_SERVICE_ROLE_KEY
npm run seed                      # 400 corpses + 8 finishes for today (UTC)
npm run seed -- 2026-07-06 2000 25
```

Deaths are weighted toward the wall and the midgame, so the level looks lived-in
(died-in) and the wall pile is partially built.

## Verification

Every milestone has a headless check that runs the real game code in Node:

```sh
npm run verify:all
```

- `verify:m1` — movement invariants: jump apex (3-tile mount, not 4), coyote 80ms, jump
  buffer 100ms, 4-tile gaps clear / 6-tile don't, bot reaches but cannot pass the wall.
- `verify:m2` — 31 dates: deterministic generation, corpse threshold in range (the
  solvability checker logs the corpse count at which each day becomes completable),
  first quarter solo-completable, wall blocks solo play mid-level.
- `verify:m3` — real-physics bots: sacrifices pile at the wall until it's climbable
  (~15 bodies), a 5-wide spike pit becomes walkable after ~6 bodies, 8-per-tile density
  cap (further deaths become blood decals but still count).
- `verify:m4` — binary codec round-trip (13 bytes/corpse), submission validation, rate
  limit logic, and a drift check that the Deno copies in `supabase/functions/_shared`
  are byte-identical to `src/net`.
- `verify:m5` — emoji result line, streak math, heatmap bins, time formatting.
- `verify:m6` — 100k-corpse stress: 89ms snapshot ingest, ~0.23ms per 100 collision
  queries, 0.011ms/tick full sim, <5ms chunk-bake scan per landing death.

## Architecture notes

- **Determinism**: level = `mulberry32(xmur3("DEADLINE:" + YYYY-MM-DD + ":" + attempt))`.
  Generation retries (deterministically) until the solvability checker approves; every
  client generates the identical level with no server round-trip.
- **Solvability**: Dijkstra over standable tiles where edge cost = corpses required
  (3 per tile of pile height, 2 to cover a spike tile). The minimum-cost path to the goal
  *is* the day's corpse threshold. The wall alone costs 12.
- **Corpse pipeline**: die → ragdoll 1.5s → freeze → local collider + chunk rebake →
  broadcast on the day's Realtime channel → edge function validates + persists. New
  clients load one binary snapshot (13 bytes/corpse, CDN-cached 10s), then live deltas.
- **Rendering**: corpses baked into 13 offscreen chunk canvases (one per 16-tile column);
  a chunk redraws only when a corpse lands in it. The frame cost is a handful of blits —
  independent of corpse count. Collision uses a per-tile spatial hash.
- **Sync trust model**: peers see broadcast deaths instantly (unvalidated, cosmetic);
  the durable record always goes through validation. Fake broadcasts can't corrupt
  anyone's snapshot.
