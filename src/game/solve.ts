// Headless solvability checker. Dijkstra over standable cells where edge cost =
// corpses spent (piling bodies to raise the floor / cover spikes). The minimum
// cost from spawn to goal IS the corpse-count threshold for the day's level.
// Same code runs at generation time on every client (deterministic) and in CI.

import { LEVEL_W, LEVEL_H, TILE, CORPSES_PER_TILE_RAISE } from '../config';
import type { Level } from './level';
import { tileAt, T_SOLID, T_SPIKE, T_COLLAPSE } from './level';

const MAX_RAISE = 6; // tallest useful pile, in tiles
const SPIKE_COVER_COST = 2; // corpses to make one spike tile walkable

// Jump reach table, validated against real physics in verify-m1:
// dyUp -> max |dx|. Falls (dy down) get maxDx 6.
const REACH_UP: Record<number, number> = { 0: 5, 1: 4, 2: 3, 3: 2 };
const FALL_DX = 6;
const MAX_FALL_SCAN = 24;

export interface SolveResult {
  threshold: number; // min corpses to finish; Infinity = impossible
  soloReachTx: number; // furthest column reachable with 0 corpses
  reachedGoal: boolean;
}

function passable(t: number): boolean {
  return t !== T_SOLID && t !== T_COLLAPSE;
}
function support(t: number): boolean {
  return t === T_SOLID || t === T_COLLAPSE;
}

/**
 * Cost to stand in cell (tx,ty): 0 on natural ground, 2 inside a spike tile,
 * 3 per tile of corpse-fill below (bodies stacked ~3 per tile of height).
 * Infinity if not standable at all.
 */
function standCost(level: Level, tx: number, ty: number): number {
  if (tx < 0 || tx >= LEVEL_W || ty < 1 || ty >= LEVEL_H - 1) return Infinity;
  const t = tileAt(level, tx, ty);
  if (!passable(t)) return Infinity;
  let cost = t === T_SPIKE ? SPIKE_COVER_COST : 0;
  // walk down from the cell to the first support, counting fill tiles
  let fill = 0;
  for (let y = ty + 1; y < LEVEL_H; y++) {
    const b = tileAt(level, tx, y);
    if (support(b)) break;
    fill++;
    if (fill > MAX_RAISE) return Infinity;
    // filling over spikes is fine (bodies cover them); each fill tile costs the same
  }
  return cost + fill * CORPSES_PER_TILE_RAISE;
}

/** Approximate jump/fall arc clearance so Dijkstra can't tunnel through walls. */
function arcClear(level: Level, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dyUp = y0 - y1; // positive = ascending
  const steps = Math.max(Math.abs(dx), 1) * 2;
  // apex ~3.4 tiles above start for full jumps; falls arc down directly
  const apex = dyUp > 0 ? Math.max(dyUp + 0.5, 3.4) : Math.abs(dx) > 2 ? 1.2 : 0.5;
  for (let s = 1; s < steps; s++) {
    const f = s / steps;
    const px = x0 + dx * f;
    // parabola through (0,0) and (1, -dyUp signed), peaking at `apex`
    const py = y0 - (4 * apex * f * (1 - f) + (y0 - y1) * f);
    const cx = Math.round(px);
    const cy = Math.round(py);
    if (cy < 0) continue;
    if (!passable(tileAt(level, cx, cy))) return false;
  }
  return true;
}

export function solveLevel(level: Level): SolveResult {
  const W = LEVEL_W;
  const H = LEVEL_H;
  const idx = (tx: number, ty: number) => ty * W + tx;
  const dist = new Float64Array(W * H).fill(Infinity);
  const costCache = new Float64Array(W * H).fill(-2); // -2 = unknown
  const getCost = (tx: number, ty: number): number => {
    if (tx < 0 || tx >= W || ty < 1 || ty >= H - 1) return Infinity;
    const i = idx(tx, ty);
    if (costCache[i] === -2) costCache[i] = standCost(level, tx, ty);
    return costCache[i];
  };

  const startTx = Math.floor(level.spawnX / TILE);
  const startTy = Math.floor(level.spawnY / TILE);
  const goalTx = Math.floor(level.goalX / TILE);

  // binary-heap-free Dijkstra: bucket queue (costs are small ints)
  const buckets: number[][] = [];
  const push = (d: number, node: number) => {
    (buckets[d] ??= []).push(node);
  };
  const s0 = idx(startTx, startTy);
  dist[s0] = 0;
  push(0, s0);

  let soloReachTx = startTx;
  let reachedGoal = false;
  let threshold = Infinity;

  for (let d = 0; d < 400; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let bi = 0; bi < bucket.length; bi++) {
      const node = bucket[bi];
      if (dist[node] !== d) continue; // stale
      const tx = node % W;
      const ty = Math.floor(node / W);
      if (d === 0 && tx > soloReachTx) soloReachTx = tx;
      if (tx >= goalTx) {
        reachedGoal = true;
        threshold = d;
        return { threshold, soloReachTx, reachedGoal };
      }
      // Jump targets: up to 3 tiles up within reach table
      for (let dyUp = 0; dyUp <= 3; dyUp++) {
        const maxDx = REACH_UP[dyUp];
        for (let ddx = -maxDx; ddx <= maxDx; ddx++) {
          if (ddx === 0 && dyUp === 0) continue;
          this_target: {
            const nx = tx + ddx;
            const ny = ty - dyUp;
            const c = getCost(nx, ny);
            if (!isFinite(c)) break this_target;
            if (!arcClear(level, tx, ty, nx, ny)) break this_target;
            const nd = d + c;
            const ni = idx(nx, ny);
            if (nd < dist[ni]) {
              dist[ni] = nd;
              push(nd, ni);
            }
          }
        }
      }
      // Falls: step off / jump across and land lower
      for (let ddx = -FALL_DX; ddx <= FALL_DX; ddx++) {
        if (ddx === 0) continue;
        const nx = tx + ddx;
        // find the first standable cell at or below current row in that column
        for (let ny = ty + 1; ny <= Math.min(H - 2, ty + MAX_FALL_SCAN); ny++) {
          if (!passable(tileAt(level, nx, ny))) break; // hit a wall face; can't be here
          const c = getCost(nx, ny);
          if (!isFinite(c)) continue;
          // must be a "landing": support (natural or filled) right below is what getCost encodes;
          // only consider the first cell whose below-tile is real support for cost 0 landings,
          // but allow paying for fills anywhere in the column.
          if (!arcClear(level, tx, ty, nx, ny)) break;
          const nd = d + c;
          const ni = idx(nx, ny);
          if (nd < dist[ni]) {
            dist[ni] = nd;
            push(nd, ni);
          }
          if (c === 0) break; // landed on real ground; deeper cells unreachable by fall
        }
      }
    }
    // track solo reach across all settled nodes at d=0 handled above
  }

  // goal not reached within cost 400
  for (let tx = W - 1; tx >= 0; tx--) {
    let any = false;
    for (let ty = 0; ty < H; ty++) {
      if (dist[idx(tx, ty)] === 0) { any = true; break; }
    }
    if (any) { soloReachTx = Math.max(soloReachTx, tx); break; }
  }
  return { threshold, soloReachTx, reachedGoal };
}

/** Furthest column reachable with a given corpse budget (for logging / tuning). */
export function reachWithBudget(level: Level, budget: number): number {
  // cheap variant: rerun dijkstra and scan
  const W = LEVEL_W;
  const H = LEVEL_H;
  const idx = (tx: number, ty: number) => ty * W + tx;
  const dist = new Float64Array(W * H).fill(Infinity);
  const startTx = Math.floor(level.spawnX / TILE);
  const startTy = Math.floor(level.spawnY / TILE);
  const buckets: number[][] = [];
  const push = (d: number, node: number) => {
    (buckets[d] ??= []).push(node);
  };
  dist[idx(startTx, startTy)] = 0;
  push(0, idx(startTx, startTy));
  let best = startTx;
  for (let d = 0; d <= budget; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let bi = 0; bi < bucket.length; bi++) {
      const node = bucket[bi];
      if (dist[node] !== d) continue;
      const tx = node % W;
      const ty = Math.floor(node / W);
      if (tx > best) best = tx;
      for (let dyUp = 0; dyUp <= 3; dyUp++) {
        const maxDx = REACH_UP[dyUp];
        for (let ddx = -maxDx; ddx <= maxDx; ddx++) {
          if (ddx === 0 && dyUp === 0) continue;
          const nx = tx + ddx;
          const ny = ty - dyUp;
          const c = standCost(level, nx, ny);
          if (!isFinite(c) || !arcClear(level, tx, ty, nx, ny)) continue;
          const nd = d + c;
          if (nd <= budget && nd < dist[idx(nx, ny)]) {
            dist[idx(nx, ny)] = nd;
            push(nd, idx(nx, ny));
          }
        }
      }
      for (let ddx = -FALL_DX; ddx <= FALL_DX; ddx++) {
        if (ddx === 0) continue;
        const nx = tx + ddx;
        for (let ny = ty + 1; ny <= Math.min(H - 2, ty + MAX_FALL_SCAN); ny++) {
          if (!passable(tileAt(level, nx, ny))) break;
          const c = standCost(level, nx, ny);
          if (isFinite(c)) {
            if (arcClear(level, tx, ty, nx, ny)) {
              const nd = d + c;
              if (nd <= budget && nd < dist[idx(nx, ny)]) {
                dist[idx(nx, ny)] = nd;
                push(nd, idx(nx, ny));
              }
            }
            if (c === 0) break;
          }
        }
      }
    }
  }
  return best;
}
