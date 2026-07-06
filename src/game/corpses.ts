// The corpse store: every death, everyone's, forever (until midnight).
// Struct-of-arrays + spatial hash so 100k corpses stay cheap. DOM-free.

import {
  TILE, LEVEL_W, LEVEL_H, CORPSE_W, CORPSE_H, CORPSE_DENSITY_CAP,
  RAGDOLL_MS, CHUNK_TILES, POSE_COUNT, type CauseId,
} from '../config';
import type { Level } from './level';
import { aabbHitsTiles } from './level';

export interface CorpseInit {
  x: number; // center px
  y: number;
  rot: number; // radians
  pose: number;
  tag: string; // 3 chars
  cause: CauseId;
  t: number; // epoch ms
}

export interface Ragdoll extends CorpseInit {
  vx: number;
  vy: number;
  vr: number;
  px: number; // interp
  py: number;
  ageMs: number;
  mine: boolean;
}

const HW = CORPSE_W / 2;
const HH = CORPSE_H / 2;

export class CorpseStore {
  count = 0; // frozen colliders + decals stored here
  colliderCount = 0;
  capacity = 4096;
  xs = new Float32Array(this.capacity);
  ys = new Float32Array(this.capacity);
  rots = new Float32Array(this.capacity);
  poses = new Uint8Array(this.capacity);
  causes = new Uint8Array(this.capacity);
  isDecal = new Uint8Array(this.capacity);
  tags: string[] = [];
  times: number[] = [];
  /** tile index -> corpse indices whose collider overlaps that tile (colliders only) */
  private hash = new Map<number, number[]>();
  private density = new Uint8Array(LEVEL_W * LEVEL_H);
  ragdolls: Ragdoll[] = [];
  /** renderer hook: corpse landed in chunk -> rebake */
  onChunkDirty: ((chunk: number) => void) | null = null;
  /** sim hook: ragdoll finished and froze (used to sync *my* deaths upstream) */
  onFroze: ((index: number, mine: boolean) => void) | null = null;

  private grow(): void {
    this.capacity *= 2;
    const cp = <T extends Float32Array | Uint8Array>(old: T, n: T): T => (n.set(old), n);
    this.xs = cp(this.xs, new Float32Array(this.capacity));
    this.ys = cp(this.ys, new Float32Array(this.capacity));
    this.rots = cp(this.rots, new Float32Array(this.capacity));
    this.poses = cp(this.poses, new Uint8Array(this.capacity));
    this.causes = cp(this.causes, new Uint8Array(this.capacity));
    this.isDecal = cp(this.isDecal, new Uint8Array(this.capacity));
  }

  /** Add an already-frozen corpse (from snapshot, network delta, or finished ragdoll). */
  addFrozen(c: CorpseInit): number {
    if (this.count >= this.capacity) this.grow();
    const i = this.count++;
    const x = Math.min(Math.max(c.x, HW), LEVEL_W * TILE - HW);
    const y = Math.min(Math.max(c.y, HH), LEVEL_H * TILE - HH);
    this.xs[i] = x;
    this.ys[i] = y;
    this.rots[i] = c.rot;
    this.poses[i] = c.pose % POSE_COUNT;
    this.causes[i] = c.cause;
    this.tags[i] = c.tag;
    this.times[i] = c.t;
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const ti = ty * LEVEL_W + tx;
    if (this.density[ti] >= CORPSE_DENSITY_CAP) {
      this.isDecal[i] = 1; // blood only: counted, rendered flat, no collider
    } else {
      this.density[ti]++;
      this.isDecal[i] = 0;
      this.colliderCount++;
      const x0 = Math.floor((x - HW) / TILE);
      const x1 = Math.floor((x + HW - 0.001) / TILE);
      const y0 = Math.floor((y - HH) / TILE);
      const y1 = Math.floor((y + HH - 0.001) / TILE);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = cy * LEVEL_W + cx;
          let arr = this.hash.get(key);
          if (!arr) this.hash.set(key, (arr = []));
          arr.push(i);
        }
      }
    }
    this.onChunkDirty?.(Math.floor(x / (CHUNK_TILES * TILE)));
    return i;
  }

  /** Does box overlap any frozen corpse collider? */
  hitsCorpse(x: number, y: number, w: number, h: number): boolean {
    const x0 = Math.floor(x / TILE);
    const x1 = Math.floor((x + w - 0.001) / TILE);
    const y0 = Math.floor(y / TILE);
    const y1 = Math.floor((y + h - 0.001) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const arr = this.hash.get(ty * LEVEL_W + tx);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k++) {
          const i = arr[k];
          const cx = this.xs[i];
          const cy = this.ys[i];
          if (x < cx + HW && x + w > cx - HW && y < cy + HH && y + h > cy - HH) return true;
        }
      }
    }
    return false;
  }

  /** Nearest corpse to a point (for hover/tap inspection), within r px. */
  corpseAt(x: number, y: number, r = 10): number {
    let best = -1;
    let bestD = r * r;
    const x0 = Math.floor((x - r) / TILE);
    const x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE);
    const y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const arr = this.hash.get(ty * LEVEL_W + tx);
        if (!arr) continue;
        for (const i of arr) {
          const dx = this.xs[i] - x;
          const dy = this.ys[i] - y;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = i; }
        }
      }
    }
    return best;
  }

  spawnRagdoll(c: CorpseInit, vx: number, vy: number, vr: number, mine: boolean): void {
    this.ragdolls.push({ ...c, vx, vy, vr, px: c.x, py: c.y, ageMs: 0, mine });
  }

  /** Step active ragdolls; freeze the ones past RAGDOLL_MS into the store. */
  stepRagdolls(level: Level, dt: number): void {
    const solid = (x: number, y: number, w: number, h: number) =>
      aabbHitsTiles(level, x, y, w, h, null) || this.hitsCorpse(x, y, w, h);
    for (let r = this.ragdolls.length - 1; r >= 0; r--) {
      const d = this.ragdolls[r];
      d.px = d.x;
      d.py = d.y;
      d.ageMs += dt * 1000;
      d.vy = Math.min(d.vy + 1400 * dt, 460);
      // X
      let nx = d.x + d.vx * dt;
      if (solid(nx - HW, d.y - HH, CORPSE_W, CORPSE_H)) {
        d.vx *= -0.35;
        d.vr *= 0.6;
        nx = d.x;
      }
      d.x = nx;
      // Y
      let ny = d.y + d.vy * dt;
      if (solid(d.x - HW, ny - HH, CORPSE_W, CORPSE_H)) {
        if (d.vy > 60) {
          d.vy *= -0.3; // bounce
          d.vx *= 0.6;
          d.vr *= -0.5;
        } else {
          d.vy = 0;
          d.vx *= 0.8;
          d.vr *= 0.85;
        }
        ny = d.y;
      }
      d.y = ny;
      d.rot += d.vr * dt;
      if (d.ageMs >= RAGDOLL_MS) {
        // settle: drop to rest if floating, then freeze forever
        let fy = d.y;
        let guard = 0;
        while (!solid(d.x - HW, fy + 1 - HH, CORPSE_W, CORPSE_H) && guard++ < 480) fy += 1;
        const idx = this.addFrozen({ x: d.x, y: fy, rot: d.rot, pose: d.pose, tag: d.tag, cause: d.cause, t: d.t });
        this.ragdolls.splice(r, 1);
        this.onFroze?.(idx, d.mine);
      }
    }
  }

  densityAt(tx: number, ty: number): number {
    return this.density[ty * LEVEL_W + tx] ?? 0;
  }
}
