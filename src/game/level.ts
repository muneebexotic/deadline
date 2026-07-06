// Tile grid + static collision. DOM-free.

import { LEVEL_W, LEVEL_H, TILE, WALL_HEIGHT_TILES } from '../config';

export const T_EMPTY = 0;
export const T_SOLID = 1;
export const T_SPIKE = 2; // kill region = lower 10px of tile (spikes point up)
export const T_COLLAPSE = 3; // collapsing platform, solid until stepped on
export const T_GOAL = 4;

export type HazardDef =
  | { kind: 'crusher'; index: number; tx: number; ty: number; w: number; drop: number; phase: number; period: number }
  | { kind: 'laser'; index: number; tx: number; ty: number; h: number; phase: number; period: number };

export interface Level {
  key: string;
  tiles: Uint8Array; // LEVEL_W * LEVEL_H
  spawnX: number; // px
  spawnY: number;
  goalX: number; // px, crossing this = finish
  wallX: number; // tile x of THE WALL (choke point), -1 if none
  wallTopY: number; // tile y of wall top
  hazards: HazardDef[];
  corpseThreshold: number; // corpses needed for full completion (from solvability check)
}

export function tileAt(level: Level, tx: number, ty: number): number {
  if (tx < 0 || tx >= LEVEL_W) return T_SOLID; // walls at both ends
  if (ty < 0) return T_EMPTY; // open sky
  if (ty >= LEVEL_H) return T_SOLID; // bedrock
  return level.tiles[ty * LEVEL_W + tx];
}

export function setTile(tiles: Uint8Array, tx: number, ty: number, v: number): void {
  if (tx >= 0 && tx < LEVEL_W && ty >= 0 && ty < LEVEL_H) tiles[ty * LEVEL_W + tx] = v;
}

export function isSolidTile(t: number): boolean {
  return t === T_SOLID || t === T_COLLAPSE;
}

/** Solid check for player/corpse movement vs static tiles (collapse handled by sim state). */
export function solidAtPx(level: Level, x: number, y: number, collapsedGone: Set<number> | null): boolean {
  const tx = Math.floor(x / TILE);
  const ty = Math.floor(y / TILE);
  const t = tileAt(level, tx, ty);
  if (t === T_COLLAPSE && collapsedGone && collapsedGone.has(ty * LEVEL_W + tx)) return false;
  return isSolidTile(t);
}

/** AABB vs solid tiles overlap test (edges exclusive on max side). */
export function aabbHitsTiles(
  level: Level,
  x: number,
  y: number,
  w: number,
  h: number,
  collapsedGone: Set<number> | null,
): boolean {
  const x0 = Math.floor(x / TILE);
  const y0 = Math.floor(y / TILE);
  const x1 = Math.floor((x + w - 0.001) / TILE);
  const y1 = Math.floor((y + h - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const t = tileAt(level, tx, ty);
      if (t === T_COLLAPSE && collapsedGone && collapsedGone.has(ty * LEVEL_W + tx)) continue;
      if (isSolidTile(t)) return true;
    }
  }
  return false;
}

/** Does the player AABB touch a spike kill region? Spikes occupy the lower 10px of their tile. */
export function aabbHitsSpikes(level: Level, x: number, y: number, w: number, h: number): boolean {
  const x0 = Math.floor(x / TILE);
  const y0 = Math.floor(y / TILE);
  const x1 = Math.floor((x + w - 0.001) / TILE);
  const y1 = Math.floor((y + h - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tileAt(level, tx, ty) !== T_SPIKE) continue;
      const killTop = ty * TILE + 6;
      const killBot = ty * TILE + TILE;
      if (y + h > killTop && y < killBot) return true;
    }
  }
  return false;
}

/** M1 hand-built test level: flats, steps, gaps, one tall wall, goal. */
export function makeTestLevel(): Level {
  const tiles = new Uint8Array(LEVEL_W * LEVEL_H);
  const ground = 22;
  const fill = (x0: number, x1: number, gy: number) => {
    for (let x = x0; x <= x1; x++) for (let y = gy; y < LEVEL_H; y++) setTile(tiles, x, y, T_SOLID);
  };
  fill(0, 30, ground);
  // 3-wide spike pit (jumpable)
  fill(34, 60, ground);
  for (let x = 31; x <= 33; x++) setTile(tiles, x, ground + 1, T_SPIKE), fill(x, x, ground + 2);
  // steps up 1,2,3
  fill(61, 66, ground - 1);
  fill(67, 72, ground - 3);
  fill(73, 90, ground);
  // 4-wide gap over spikes
  for (let x = 91; x <= 94; x++) setTile(tiles, x, ground + 1, T_SPIKE), fill(x, x, ground + 2);
  fill(95, 119, ground);
  // THE WALL at 120
  const wallX = 120;
  fill(wallX, wallX + 1, ground - WALL_HEIGHT_TILES);
  fill(122, 160, ground);
  // collapsing bridge
  for (let x = 161; x <= 166; x++) setTile(tiles, x, ground, T_COLLAPSE);
  for (let x = 161; x <= 166; x++) setTile(tiles, x, ground + 3, T_SPIKE), fill(x, x, ground + 4);
  fill(167, LEVEL_W - 1, ground);
  // goal zone
  for (let y = ground - 4; y < ground; y++) setTile(tiles, LEVEL_W - 3, y, T_GOAL);

  return {
    key: 'test',
    tiles,
    spawnX: 2 * TILE,
    spawnY: (ground - 1) * TILE,
    goalX: (LEVEL_W - 3) * TILE,
    wallX,
    wallTopY: ground - WALL_HEIGHT_TILES,
    hazards: [
      { kind: 'crusher', index: 1, tx: 45, ty: ground - 6, w: 2, drop: 5, phase: 0, period: 2400 },
      { kind: 'laser', index: 1, tx: 100, ty: ground - 5, h: 5, phase: 0.5, period: 2000 },
    ],
    corpseThreshold: -1,
  };
}
