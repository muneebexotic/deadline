// Timed hazards. All timing derives from ms-since-UTC-midnight, so every
// client on Earth sees crushers and lasers in the same phase. DOM-free.

import { TILE, CRUSHER_DOWN_FRAC, LASER_ON_FRAC, LASER_WARN_FRAC } from '../config';
import type { HazardDef } from './level';

export interface Rect { x: number; y: number; w: number; h: number }

/** Crusher body AABB at a given clock. Cycle: wait top -> slam -> hold -> rise. */
export function crusherRect(h: Extract<HazardDef, { kind: 'crusher' }>, clockMs: number): Rect {
  const t = (((clockMs / h.period) + h.phase) % 1 + 1) % 1;
  const waitEnd = 1 - CRUSHER_DOWN_FRAC; // 0.72: hang at top
  const slamEnd = waitEnd + CRUSHER_DOWN_FRAC * 0.3; // fast slam
  const holdEnd = waitEnd + CRUSHER_DOWN_FRAC * 0.55; // hold at bottom
  let frac: number; // 0 = top, 1 = bottom
  if (t < waitEnd) frac = 0;
  else if (t < slamEnd) frac = (t - waitEnd) / (slamEnd - waitEnd);
  else if (t < holdEnd) frac = 1;
  else frac = 1 - (t - holdEnd) / (1 - holdEnd); // slow rise
  const dropPx = h.drop * TILE * frac;
  return { x: h.tx * TILE, y: h.ty * TILE + dropPx, w: h.w * TILE, h: 2 * TILE };
}

export type LaserPhase = 'off' | 'warn' | 'on';

export function laserPhase(h: Extract<HazardDef, { kind: 'laser' }>, clockMs: number): LaserPhase {
  const t = (((clockMs / h.period) + h.phase) % 1 + 1) % 1;
  if (t < 1 - LASER_ON_FRAC - LASER_WARN_FRAC) return 'off';
  if (t < 1 - LASER_ON_FRAC) return 'warn';
  return 'on';
}

/** Laser beam kill AABB (thin, centered in its column). */
export function laserRect(h: Extract<HazardDef, { kind: 'laser' }>): Rect {
  return { x: h.tx * TILE + 6, y: h.ty * TILE, w: 4, h: h.h * TILE };
}

export function rectsOverlap(a: Rect, bx: number, by: number, bw: number, bh: number): boolean {
  return a.x < bx + bw && a.x + a.w > bx && a.y < by + bh && a.y + a.h > by;
}
