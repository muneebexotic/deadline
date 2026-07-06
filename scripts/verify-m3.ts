// M3 verification: corpses as physical objects. Real physics sim, no shortcuts:
// - bodies sacrificed at the wall pile up until the wall becomes climbable
// - bodies dying in a spike pit fill it until it's walkable
// - density cap: tile fills at 8, further deaths become decals but still count
import { TILE, LEVEL_W, LEVEL_H, P_W, P_H, CORPSE_DENSITY_CAP, WALL_HEIGHT_TILES } from '../src/config';
import { setTile, T_SOLID, T_SPIKE, T_GOAL, type Level } from '../src/game/level';
import { Game, IDLE_INPUT, type SimInput } from '../src/game/sim';
import { generateDailyLevel } from '../src/game/levelgen';
import { dayKey } from '../src/core/rng';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}
const sinp = (o: Partial<SimInput> = {}): SimInput => ({ ...IDLE_INPUT, ...o });

function flatLevelWithWall(): Level {
  const tiles = new Uint8Array(LEVEL_W * LEVEL_H);
  const gh = 22;
  const fill = (x0: number, x1: number, top: number) => {
    for (let x = x0; x <= x1; x++) for (let y = top; y < LEVEL_H; y++) setTile(tiles, x, y, T_SOLID);
  };
  fill(0, LEVEL_W - 1, gh);
  const wallX = 60;
  fill(wallX, wallX + 1, gh - WALL_HEIGHT_TILES);
  for (let y = gh - 4; y < gh; y++) setTile(tiles, 80, y, T_GOAL);
  return {
    key: 'm3wall', tiles, spawnX: 40 * TILE, spawnY: (gh - 1) * TILE, goalX: 80 * TILE,
    wallX, wallTopY: gh - WALL_HEIGHT_TILES, hazards: [], corpseThreshold: -1,
  };
}

console.log('M3: the wall choke point (real sim, sacrifice bots)');
{
  const level = flatLevelWithWall();
  const game = new Game(level, 0);
  const wallPx = level.wallX * TILE;
  let lives = 0;
  let climbed = false;
  const maxLives = 40;
  while (lives < maxLives && !climbed) {
    lives++;
    game.restart();
    let bestX = 0;
    let lastProgress = 0;
    for (let t = 0; t < 10 * 120; t++) {
      if (game.state !== 'alive') break;
      const p = game.player;
      const wallAhead = game.solid(p.x + P_W + 3, p.y + 2, 4, P_H - 4);
      const jump = p.grounded && wallAhead;
      game.step(sinp({ right: true, jump: jump || (!p.grounded && p.vy < 0), jumpPressed: jump }));
      if (p.x + P_W > wallPx + 2 * TILE) { climbed = true; break; }
      if (p.x > bestX + 2) { bestX = p.x; lastProgress = t; }
      // no forward progress for 2s while at the wall -> add my body to the pile
      if (t - lastProgress > 240 && p.x + P_W > wallPx - 3 * TILE) {
        game.step(sinp({ sacrificePressed: true }));
        break;
      }
    }
    // let the ragdoll settle and freeze
    for (let t = 0; t < 2.2 * 120; t++) game.step(sinp());
  }
  const bodies = game.corpses.count;
  check(`wall climbed via corpse pile (lives spent: ${lives}, bodies: ${bodies})`, climbed);
  check(`pile size ${bodies} in plausible range [8, 35]`, bodies >= 8 && bodies <= 35);
  // pile is real geometry: something solid must now sit well above ground next to the wall
  let pileTopPx = 22 * TILE;
  for (let y = 22 * TILE; y > 10 * TILE; y -= 2) {
    if (game.corpses.hitsCorpse(wallPx - 14, y, 12, 2)) pileTopPx = y;
  }
  const pileHeight = 22 * TILE - pileTopPx;
  check(`pile height ${pileHeight}px >= 48px (3+ tiles of bodies)`, pileHeight >= 48);
}

console.log('M3: spike pit fills with corpses until walkable');
{
  const tiles = new Uint8Array(LEVEL_W * LEVEL_H);
  const gh = 22;
  const fill = (x0: number, x1: number, top: number) => {
    for (let x = x0; x <= x1; x++) for (let y = top; y < LEVEL_H; y++) setTile(tiles, x, y, T_SOLID);
  };
  fill(0, 49, gh);
  for (let x = 50; x <= 54; x++) { // 5-wide pit, too wide to jump
    setTile(tiles, x, gh + 1, T_SPIKE);
    fill(x, x, gh + 2);
  }
  fill(55, LEVEL_W - 1, gh);
  const level: Level = {
    key: 'm3pit', tiles, spawnX: 40 * TILE, spawnY: (gh - 1) * TILE, goalX: 70 * TILE,
    wallX: -1, wallTopY: -1, hazards: [], corpseThreshold: -1,
  };
  const game = new Game(level, 0);
  let lives = 0;
  let crossed = false;
  while (lives < 60 && !crossed) {
    lives++;
    game.restart();
    for (let t = 0; t < 8 * 120; t++) {
      if (game.state !== 'alive') break;
      const p = game.player;
      // walks straight in; hops when bumping into a body (like a player would)
      const blocked = game.solid(p.x + P_W + 2, p.y + 2, 3, P_H - 4);
      const hop = p.grounded && blocked;
      game.step(sinp({ right: true, jump: hop || (!p.grounded && p.vy < 0), jumpPressed: hop }));
      if (p.x > 56 * TILE) { crossed = true; break; }
    }
    for (let t = 0; t < 2.2 * 120; t++) game.step(sinp());
  }
  check(`5-wide spike pit crossed by walking on bodies (lives: ${lives}, bodies: ${game.corpses.count})`, crossed);
}

console.log('M3: density cap + inspection');
{
  const level = flatLevelWithWall();
  const game = new Game(level, 0);
  // drop 14 corpses on the exact same spot
  for (let i = 0; i < 14; i++) {
    game.corpses.addFrozen({ x: 45 * TILE + 8, y: 22 * TILE - 3, rot: 0, pose: i % 6, tag: 'TST', cause: 0, t: i });
  }
  check(`14 stacked deaths -> ${game.corpses.colliderCount} colliders (cap ${CORPSE_DENSITY_CAP}/tile) + decals, all ${game.corpses.count} counted`,
    game.corpses.count === 14 && game.corpses.colliderCount <= CORPSE_DENSITY_CAP * 2);
  const hit = game.corpses.corpseAt(45 * TILE + 8, 22 * TILE - 3, 10);
  check('corpse inspection query finds a body', hit >= 0 && game.corpses.tags[hit] === 'TST');
}

console.log("M3: today's real level end-to-end with corpse budget");
{
  const { level, info } = generateDailyLevel(dayKey());
  // sanity: the sim agrees the wall region blocks a solo bot (from M1) and the
  // checker's threshold is the budget at which the level opens. Full-level bot
  // completion with corpses is exercised on the synthetic wall/pit above.
  check(`today threshold ${info.threshold} >= 12 and wall at ${level.wallX}`, info.threshold >= 12 && level.wallX > 0);
}

if (failures) { console.error(`\nM3: ${failures} FAILURES`); process.exit(1); }
console.log('\nM3: all checks passed');
