// Daily level generation. Seeded by the UTC date string — every client on Earth
// generates the identical gauntlet, no server involved. Levels are validated with
// the headless solvability checker at generation time; the corpse-count threshold
// at which the level becomes completable is computed and logged.

import { LEVEL_W, LEVEL_H, TILE, WALL_HEIGHT_TILES } from '../config';
import { makeRng, type Rng } from '../core/rng';
import { setTile, T_SOLID, T_SPIKE, T_COLLAPSE, T_GOAL, type Level, type HazardDef } from './level';
import { solveLevel } from './solve';

const W = LEVEL_W;
const H = LEVEL_H;
const GH0 = 22; // baseline ground row

interface GenState {
  tiles: Uint8Array;
  gh: number;
  x: number;
  rng: Rng;
  hazards: HazardDef[];
  crushers: number;
  lasers: number;
}

function ground(s: GenState, x0: number, x1: number, gh: number): void {
  for (let x = x0; x <= x1; x++) {
    for (let y = gh; y < H; y++) setTile(s.tiles, x, y, T_SOLID);
  }
}

function flat(s: GenState, len: number, hazardChance: number, fast: boolean): void {
  ground(s, s.x, s.x + len - 1, s.gh);
  if (len >= 4 && s.rng.chance(hazardChance)) {
    const mid = s.x + Math.floor(len / 2);
    if (s.rng.chance(0.55)) {
      s.hazards.push({
        kind: 'crusher', index: ++s.crushers,
        tx: mid - 1, ty: s.gh - 7, w: 2, drop: 5,
        phase: s.rng.next(),
        period: fast ? s.rng.int(1500, 2100) : s.rng.int(2200, 3000),
      });
    } else {
      s.hazards.push({
        kind: 'laser', index: ++s.lasers,
        tx: mid, ty: s.gh - 5, h: 5,
        phase: s.rng.next(),
        period: fast ? s.rng.int(1400, 1900) : s.rng.int(1900, 2600),
      });
    }
  }
  s.x += len;
}

function pit(s: GenState, w: number): void {
  // 2-deep pit, spike floor. Corpses pile on the spikes until it's walkable.
  for (let x = s.x; x < s.x + w; x++) {
    setTile(s.tiles, x, s.gh + 1, T_SPIKE);
    for (let y = s.gh + 2; y < H; y++) setTile(s.tiles, x, y, T_SOLID);
  }
  s.x += w;
  // guaranteed landing pad
  ground(s, s.x, s.x + 2, s.gh);
  s.x += 3;
}

function step(s: GenState, dir: 1 | -1, n: number): void {
  s.gh = Math.min(24, Math.max(12, s.gh - dir * n));
  ground(s, s.x, s.x + 2, s.gh);
  s.x += 3;
}

function collapseBridge(s: GenState, len: number): void {
  for (let x = s.x; x < s.x + len; x++) {
    setTile(s.tiles, x, s.gh, T_COLLAPSE);
    setTile(s.tiles, x, s.gh + 2, T_SPIKE);
    for (let y = s.gh + 3; y < H; y++) setTile(s.tiles, x, y, T_SOLID);
  }
  s.x += len;
  ground(s, s.x, s.x + 2, s.gh);
  s.x += 3;
}

function platformHop(s: GenState, hops: number): void {
  // floating 2-wide platforms over a spike field, 3-tile gaps
  for (let i = 0; i < hops; i++) {
    const px = s.x + i * 5;
    setTile(s.tiles, px, s.gh, T_SOLID);
    setTile(s.tiles, px + 1, s.gh, T_SOLID);
  }
  const endX = s.x + hops * 5;
  for (let x = s.x - 1; x < endX; x++) {
    if (s.tiles[(s.gh + 2) * W + x] === 0) setTile(s.tiles, x, s.gh + 2, T_SPIKE);
    for (let y = s.gh + 3; y < H; y++) setTile(s.tiles, x, y, T_SOLID);
  }
  s.x = endX;
  ground(s, s.x, s.x + 2, s.gh);
  s.x += 3;
}

function theWall(s: GenState): { wallX: number; wallTopY: number } {
  ground(s, s.x, s.x + 2, s.gh);
  s.x += 3;
  const wallX = s.x;
  for (let x = wallX; x <= wallX + 1; x++) {
    for (let y = s.gh - WALL_HEIGHT_TILES; y < H; y++) setTile(s.tiles, x, y, T_SOLID);
  }
  s.x += 2;
  ground(s, s.x, s.x + 3, s.gh);
  s.x += 4;
  return { wallX, wallTopY: s.gh - WALL_HEIGHT_TILES };
}

function genAttempt(key: string, attempt: number): Level {
  const rng = makeRng(`DEADLINE:${key}:${attempt}`);
  const s: GenState = {
    tiles: new Uint8Array(W * H),
    gh: GH0, x: 0, rng, hazards: [], crushers: 0, lasers: 0,
  };
  // spawn pad
  ground(s, 0, 4, s.gh);
  s.x = 5;
  let wallX = -1;
  let wallTopY = -1;

  while (s.x < W - 10) {
    const prog = s.x / W;
    if (wallX < 0 && prog >= 0.46) {
      const wl = theWall(s);
      wallX = wl.wallX;
      wallTopY = wl.wallTopY;
      continue;
    }
    const r = rng.next();
    if (prog < 0.25) {
      // Phase 1: solo-friendly. Small pits, gentle steps, sparse slow hazards.
      if (r < 0.5) flat(s, rng.int(4, 7), 0.2, false);
      else if (r < 0.8) pit(s, rng.int(2, 3));
      else step(s, rng.chance(0.5) ? 1 : -1, rng.int(1, 2));
    } else if (prog < 0.46) {
      // Phase 2: medium. Everything still solo-passable, more timing pressure.
      if (r < 0.35) flat(s, rng.int(4, 6), 0.45, false);
      else if (r < 0.6) pit(s, rng.int(3, 4));
      else if (r < 0.75) step(s, rng.chance(0.5) ? 1 : -1, rng.int(1, 3));
      else if (r < 0.9) collapseBridge(s, rng.int(3, 5));
      else flat(s, 5, 1, false);
    } else if (prog < 0.75) {
      // Phase 3: corpse country. Wide pits want stepping-stone bodies.
      if (r < 0.25) flat(s, rng.int(4, 6), 0.55, false);
      else if (r < 0.55) pit(s, rng.int(4, 5));
      else if (r < 0.7) platformHop(s, rng.int(2, 3));
      else if (r < 0.85) collapseBridge(s, rng.int(4, 6));
      else step(s, rng.chance(0.5) ? 1 : -1, rng.int(1, 3));
    } else {
      // Phase 4: brutal but solo-possible. Fast hazards, tight jumps.
      if (r < 0.3) flat(s, rng.int(4, 6), 0.75, true);
      else if (r < 0.55) pit(s, 4);
      else if (r < 0.7) platformHop(s, rng.int(2, 3));
      else if (r < 0.85) collapseBridge(s, rng.int(4, 6));
      else flat(s, 5, 1, true);
    }
  }

  // finish pad + goal
  ground(s, s.x, W - 1, s.gh);
  for (let y = s.gh - 4; y < s.gh; y++) setTile(s.tiles, W - 3, y, T_GOAL);

  return {
    key,
    tiles: s.tiles,
    spawnX: 2 * TILE,
    spawnY: (GH0 - 1) * TILE,
    goalX: (W - 3) * TILE,
    wallX,
    wallTopY,
    hazards: s.hazards,
    corpseThreshold: -1,
  };
}

/** Dead-simple always-valid fallback (never expected; keeps the game alive no matter what). */
function fallbackLevel(key: string): Level {
  const rng = makeRng(`DEADLINE-FALLBACK:${key}`);
  const s: GenState = {
    tiles: new Uint8Array(W * H), gh: GH0, x: 0, rng, hazards: [], crushers: 0, lasers: 0,
  };
  ground(s, 0, 4, s.gh);
  s.x = 5;
  let wallX = -1;
  let wallTopY = -1;
  while (s.x < W - 10) {
    if (wallX < 0 && s.x / W >= 0.46) {
      const wl = theWall(s);
      wallX = wl.wallX;
      wallTopY = wl.wallTopY;
    } else if (rng.chance(0.3)) pit(s, 3);
    else flat(s, rng.int(4, 7), 0.15, false);
  }
  ground(s, s.x, W - 1, s.gh);
  for (let y = s.gh - 4; y < s.gh; y++) setTile(s.tiles, W - 3, y, T_GOAL);
  return {
    key, tiles: s.tiles, spawnX: 2 * TILE, spawnY: (GH0 - 1) * TILE,
    goalX: (W - 3) * TILE, wallX, wallTopY, hazards: s.hazards, corpseThreshold: -1,
  };
}

export interface GenInfo {
  attempts: number;
  threshold: number;
  soloReachTx: number;
  usedFallback: boolean;
}

/** Generate today's level: deterministic, validated. */
export function generateDailyLevel(key: string): { level: Level; info: GenInfo } {
  for (let attempt = 0; attempt < 24; attempt++) {
    const level = genAttempt(key, attempt);
    const res = solveLevel(level);
    const quarter = Math.floor(W * 0.25);
    const ok =
      res.reachedGoal &&
      res.threshold >= 8 && res.threshold <= 60 &&
      res.soloReachTx >= quarter &&
      res.soloReachTx >= level.wallX - 4 && // solo play carries you to the wall...
      res.soloReachTx < level.wallX + 2; // ...and the wall stops you. Bring bodies.
    if (ok) {
      level.corpseThreshold = res.threshold;
      console.log(
        `[levelgen] ${key} attempt ${attempt}: corpse threshold ${res.threshold}, ` +
        `solo reach ${res.soloReachTx}/${W} tiles, wall at ${level.wallX}`,
      );
      return { level, info: { attempts: attempt + 1, threshold: res.threshold, soloReachTx: res.soloReachTx, usedFallback: false } };
    }
  }
  const level = fallbackLevel(key);
  const res = solveLevel(level);
  level.corpseThreshold = res.threshold;
  console.warn(`[levelgen] ${key}: all attempts failed validation, using fallback (threshold ${res.threshold})`);
  return { level, info: { attempts: 24, threshold: res.threshold, soloReachTx: res.soloReachTx, usedFallback: true } };
}
