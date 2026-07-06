// Seed a test day with synthetic corpses + finishes (direct insert, service role).
// Usage: npm run seed -- [dayKey] [corpseCount] [finishCount]
//   npm run seed -- 2026-07-06 500 12
// Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (reads .env if present).
import { createClient } from '@supabase/supabase-js';
import { TILE, LEVEL_W, LEVEL_H, POSE_COUNT, MIN_HUMAN_TIME_MS } from '../src/config';
import { generateDailyLevel } from '../src/game/levelgen';
import { tileAt, T_SOLID, T_SPIKE } from '../src/game/level';
import { makeRng, dayKey } from '../src/core/rng';
import { quantRot } from '../src/net/codec';

try { process.loadEnvFile?.('.env'); } catch { /* no .env, use real env */ }

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or put them in .env).');
  process.exit(1);
}

const day = process.argv[2] ?? dayKey();
const nCorpses = Number(process.argv[3] ?? 400);
const nFinishes = Number(process.argv[4] ?? 8);

const { level } = generateDailyLevel(day);
const rng = makeRng(`seed:${day}`);
const db = createClient(url, key, { auth: { persistSession: false } });

// deaths cluster where the level is hard: weight the wall + late game
function pickX(): number {
  const r = rng.next();
  if (r < 0.35 && level.wallX > 0) return (level.wallX - 4 + rng.next() * 5) * TILE; // the wall pile
  if (r < 0.6) return (10 + rng.next() * LEVEL_W * 0.4) * TILE;
  return rng.next() * (LEVEL_W - 4) * TILE;
}

const tags = ['ACE', 'MOB', 'RIP', 'ZED', 'K0B', 'GG1', 'NPC', 'YOL', 'X3D', 'BRO', 'SUS', 'DED'];
const rows = Array.from({ length: nCorpses }, () => {
  const x = Math.max(8, Math.min(LEVEL_W * TILE - 8, pickX()));
  const tx = Math.floor(x / TILE);
  let ty = 0;
  while (ty < LEVEL_H - 1 && tileAt(level, tx, ty) !== T_SOLID && tileAt(level, tx, ty) !== T_SPIKE) ty++;
  return {
    day_key: day,
    x: Math.round(x),
    y: Math.round(ty * TILE - 3 - rng.next() * 40),
    rot: quantRot(rng.next() * 6.28),
    pose: Math.floor(rng.next() * POSE_COUNT),
    cause: [0, 0, 0, 1, 2, 4][Math.floor(rng.next() * 6)],
    tag: tags[Math.floor(rng.next() * tags.length)],
    ip_hash: 'seed',
  };
});

const finishes = Array.from({ length: nFinishes }, () => ({
  day_key: day,
  tag: tags[Math.floor(rng.next() * tags.length)],
  time_ms: MIN_HUMAN_TIME_MS + 15000 + Math.floor(rng.next() * 300000),
  ip_hash: 'seed',
}));

const main = async () => {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('corpses').insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
    console.log(`corpses ${Math.min(i + 500, rows.length)}/${rows.length}`);
  }
  if (finishes.length) {
    const { error } = await db.from('finishes').insert(finishes);
    if (error) throw new Error(error.message);
  }
  console.log(`Seeded ${day}: ${nCorpses} corpses (threshold was ${level.corpseThreshold}), ${nFinishes} finishes.`);
  console.log('Open the game — the level should be littered.');
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
