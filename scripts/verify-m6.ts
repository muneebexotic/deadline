// M6 verification: the corpse system must stay cheap at 100k corpses.
// Headless benchmarks of every hot path the render/sim loop touches.
// (Browser-side: run `npm run dev` and open /?corpses=100000 — chunks bake once,
// then rendering is 13 canvas blits regardless of corpse count.)
import { TILE, LEVEL_W, LEVEL_H, P_W, P_H, CHUNK_TILES, WORLD_W } from '../src/config';
import { CorpseStore } from '../src/game/corpses';
import { generateDailyLevel } from '../src/game/levelgen';
import { Game, IDLE_INPUT, type SimInput } from '../src/game/sim';
import { tileAt, T_SOLID, T_SPIKE } from '../src/game/level';
import { makeRng, dayKey } from '../src/core/rng';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}
const sinp = (o: Partial<SimInput> = {}): SimInput => ({ ...IDLE_INPUT, ...o });

const N = 100000;
const { level } = generateDailyLevel(dayKey());
const rng = makeRng('bench');

console.log(`M6: ${N.toLocaleString()} corpse stress test`);

// 1. insertion (snapshot load path)
const game = new Game(level, 0);
let dirtyCalls = 0;
game.corpses.onChunkDirty = () => dirtyCalls++;
const t0 = performance.now();
for (let i = 0; i < N; i++) {
  const tx = 1 + Math.floor(rng.next() * (LEVEL_W - 2));
  let ty = 0;
  while (ty < LEVEL_H - 1 && tileAt(level, tx, ty) !== T_SOLID && tileAt(level, tx, ty) !== T_SPIKE) ty++;
  game.corpses.addFrozen({
    x: tx * TILE + rng.next() * TILE,
    y: ty * TILE - 3 - rng.next() * 60,
    rot: rng.next() * 6.28,
    pose: Math.floor(rng.next() * 6),
    tag: 'SIM',
    cause: 0,
    t: i,
  });
}
const insertMs = performance.now() - t0;
check(`insert ${N.toLocaleString()} corpses: ${insertMs.toFixed(0)}ms (< 1000ms)`, insertMs < 1000);
check(`density cap held: ${game.corpses.colliderCount.toLocaleString()} colliders, rest decals`,
  game.corpses.colliderCount < N && game.corpses.count === N);

// 2. collision queries (player movement does ~10/tick)
const t1 = performance.now();
let hits = 0;
for (let i = 0; i < 100000; i++) {
  const x = rng.next() * (WORLD_W - 20);
  const y = rng.next() * (LEVEL_H * TILE - 20);
  if (game.corpses.hitsCorpse(x, y, P_W, P_H)) hits++;
}
const queryMs = performance.now() - t1;
check(`100k collision queries: ${queryMs.toFixed(0)}ms => ${(queryMs / 100).toFixed(3)}ms per 100-query tick (< 0.5ms)`,
  queryMs / 100 < 0.5);
check(`spatial hash actually finds bodies (${hits} hits)`, hits > 1000);

// 3. chunk bake scan (worst case: one death lands = one linear pass)
const CHUNK_PX = CHUNK_TILES * TILE;
const t2 = performance.now();
let visible = 0;
const x0 = 6 * CHUNK_PX;
for (let i = 0; i < game.corpses.count; i++) {
  const x = game.corpses.xs[i];
  if (x >= x0 - 12 && x < x0 + CHUNK_PX + 12) visible++;
}
const bakeScanMs = performance.now() - t2;
check(`bake scan over ${N.toLocaleString()} corpses: ${bakeScanMs.toFixed(1)}ms (< 5ms per landing death)`, bakeScanMs < 5);

// 4. full sim ticks with the loaded world (this is the per-frame cost that matters)
const t3 = performance.now();
for (let i = 0; i < 1200; i++) game.step(sinp({ right: i % 40 < 20, jump: i % 80 < 10, jumpPressed: i % 80 === 0 }));
const simMs = performance.now() - t3;
check(`1200 sim ticks (10s of play) with 100k corpses: ${simMs.toFixed(0)}ms => ${(simMs / 1200).toFixed(3)}ms/tick (< 1ms)`,
  simMs / 1200 < 1);

// 5. ragdoll + freeze while 100k bodies exist
const t4 = performance.now();
game.die(4, 'bench');
for (let i = 0; i < 300; i++) game.step(sinp());
const dieMs = performance.now() - t4;
check(`death->ragdoll->freeze with 100k corpses: ${dieMs.toFixed(0)}ms for 2.5s of sim (< 100ms)`, dieMs < 100);
check('corpse count grew', game.corpses.count === N + 1);

// 6. inspection query stays instant
const t5 = performance.now();
for (let i = 0; i < 1000; i++) game.corpses.corpseAt(rng.next() * WORLD_W, 350, 12);
const inspectMs = performance.now() - t5;
check(`1000 hover inspections: ${inspectMs.toFixed(1)}ms (< 50ms)`, inspectMs < 50);

if (failures) { console.error(`\nM6: ${failures} FAILURES`); process.exit(1); }
console.log('\nM6: all checks passed');
