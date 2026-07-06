// Game orchestration: player + hazards + corpses + deaths + goal.
// Pure sim, DOM-free — the same code runs headless in Node for verification.

import {
  TILE, LEVEL_W, P_W, P_H, SIM_DT, POSE_COUNT,
  COLLAPSE_SHAKE_MS, COLLAPSE_RESPAWN_MS, type CauseId,
} from '../config';
import type { Level } from './level';
import { aabbHitsTiles, aabbHitsSpikes, tileAt, T_COLLAPSE } from './level';
import { makePlayer, stepPlayer, type Player, type InputState } from './player';
import { CorpseStore, type CorpseInit } from './corpses';
import { crusherRect, laserPhase, laserRect, rectsOverlap } from './hazards';
import { makeRng, type Rng } from '../core/rng';

export interface SimInput extends InputState {
  restartPressed: boolean;
  sacrificePressed: boolean;
}

export const IDLE_INPUT: SimInput = {
  left: false, right: false, jump: false, jumpPressed: false,
  restartPressed: false, sacrificePressed: false,
};

export type GameState = 'alive' | 'dying' | 'dead' | 'finished';

export interface DeathInfo {
  cause: CauseId;
  causeText: string; // "Crushed by Crusher #3"
  x: number;
  y: number;
}

export interface GameEvents {
  onDeath?: (d: DeathInfo) => void;
  onFinish?: (timeMs: number) => void;
  onJump?: () => void;
  onLand?: () => void;
  onRestart?: () => void;
  onCollapse?: () => void;
}

export class Game {
  level: Level;
  player: Player;
  corpses = new CorpseStore();
  state: GameState = 'alive';
  clockMs: number; // ms since UTC midnight, advanced per tick
  simTime = 0;
  runMs = 0;
  runStarted = false;
  deadAtMs = 0; // simTime when we died (for dying->dead transition)
  lastDeath: DeathInfo | null = null;
  tag = 'AAA';
  events: GameEvents = {};
  private rng: Rng;
  // collapsing platforms
  collapsedGone = new Set<number>(); // tile indices currently vanished
  private collapseShake = new Map<number, number>(); // tile idx -> ms shaking
  private collapseRespawn = new Map<number, number>(); // tile idx -> simTime to respawn

  constructor(level: Level, clockMs: number, rngSeed = 'fx') {
    this.level = level;
    this.clockMs = clockMs;
    this.player = makePlayer(level.spawnX, level.spawnY);
    this.rng = makeRng(rngSeed + level.key);
  }

  /** Solid world for the player: tiles (minus vanished collapse tiles) + frozen corpses. */
  solid = (x: number, y: number, w: number, h: number): boolean =>
    aabbHitsTiles(this.level, x, y, w, h, this.collapsedGone) || this.corpses.hitsCorpse(x, y, w, h);

  restart(): void {
    const p = this.player;
    p.x = p.px = this.level.spawnX;
    p.y = p.py = this.level.spawnY;
    p.vx = p.vy = 0;
    p.grounded = false;
    p.maxX = p.x;
    this.state = 'alive';
    this.runMs = 0;
    this.runStarted = false;
    this.events.onRestart?.();
  }

  die(cause: CauseId, causeText: string): void {
    if (this.state !== 'alive') return;
    const p = this.player;
    const d: DeathInfo = { cause, causeText, x: p.x + P_W / 2, y: p.y + P_H / 2 };
    this.lastDeath = d;
    this.state = 'dying';
    this.deadAtMs = this.simTime;
    const kick = cause === 1 ? 0 : 60; // crushed corpses don't pop up
    this.corpses.spawnRagdoll(
      {
        x: d.x, y: d.y,
        rot: (this.rng.next() - 0.5) * 0.8,
        pose: Math.floor(this.rng.next() * POSE_COUNT),
        tag: this.tag,
        cause,
        t: Date.now(),
      },
      p.vx * 0.5 + (this.rng.next() - 0.5) * 60,
      Math.min(p.vy * 0.3, 0) - kick,
      (this.rng.next() - 0.5) * 10,
      true,
    );
    this.events.onDeath?.(d);
  }

  private checkDeath(): void {
    const p = this.player;
    // Spikes (corpse layers cover the kill region — walkable graves)
    if (aabbHitsSpikes(this.level, p.x, p.y, P_W, P_H)) {
      this.die(0, 'Impaled');
      return;
    }
    for (const h of this.level.hazards) {
      if (h.kind === 'crusher') {
        const r = crusherRect(h, this.clockMs);
        if (rectsOverlap(r, p.x, p.y, P_W, P_H)) {
          this.die(1, `Crushed by Crusher #${h.index}`);
          return;
        }
      } else {
        if (laserPhase(h, this.clockMs) !== 'on') continue;
        const r = laserRect(h);
        if (rectsOverlap(r, p.x, p.y, P_W, P_H)) {
          this.die(2, `Vaporized by Laser #${h.index}`);
          return;
        }
      }
    }
  }

  private stepCollapse(dt: number): void {
    const p = this.player;
    // which collapse tiles are we standing on?
    if (this.state === 'alive' && p.grounded) {
      const fy = Math.floor((p.y + P_H + 0.5) / TILE);
      const x0 = Math.floor(p.x / TILE);
      const x1 = Math.floor((p.x + P_W - 0.001) / TILE);
      for (let tx = x0; tx <= x1; tx++) {
        if (tileAt(this.level, tx, fy) === T_COLLAPSE) {
          const idx = fy * LEVEL_W + tx;
          if (!this.collapsedGone.has(idx) && !this.collapseShake.has(idx)) {
            this.collapseShake.set(idx, 0);
          }
        }
      }
    }
    for (const [idx, ms] of this.collapseShake) {
      const nms = ms + dt * 1000;
      if (nms >= COLLAPSE_SHAKE_MS) {
        this.collapseShake.delete(idx);
        this.collapsedGone.add(idx);
        this.collapseRespawn.set(idx, this.simTime + COLLAPSE_RESPAWN_MS / 1000);
        this.events.onCollapse?.();
      } else {
        this.collapseShake.set(idx, nms);
      }
    }
    for (const [idx, at] of this.collapseRespawn) {
      if (this.simTime >= at) {
        // don't respawn inside the player or a corpse
        const tx = idx % LEVEL_W;
        const ty = Math.floor(idx / LEVEL_W);
        if (!this.corpses.hitsCorpse(tx * TILE, ty * TILE, TILE, TILE)) {
          this.collapsedGone.delete(idx);
          this.collapseRespawn.delete(idx);
        }
      }
    }
  }

  isShaking(tx: number, ty: number): boolean {
    return this.collapseShake.has(ty * LEVEL_W + tx);
  }

  /** One fixed 120hz tick. */
  step(input: SimInput): void {
    this.simTime += SIM_DT;
    this.clockMs += SIM_DT * 1000;

    this.corpses.stepRagdolls(this.level, SIM_DT);

    if (input.restartPressed && this.state !== 'finished') this.restart();

    if (this.state === 'dying' && this.simTime - this.deadAtMs > 0.9) {
      this.state = 'dead';
    }

    if (this.state !== 'alive') return;

    if (!this.runStarted && (input.left || input.right || input.jumpPressed)) {
      this.runStarted = true;
    }
    if (this.runStarted) this.runMs += SIM_DT * 1000;

    if (input.sacrificePressed) {
      this.die(4, 'Sacrificed for the pile');
      return;
    }

    const ev = stepPlayer(this.player, input, this.solid, SIM_DT);
    if (ev.jumped) this.events.onJump?.();
    if (ev.landed) this.events.onLand?.();

    this.stepCollapse(SIM_DT);
    this.checkDeath();

    if (this.state === 'alive' && this.player.x + P_W >= this.level.goalX) {
      this.state = 'finished';
      this.events.onFinish?.(Math.round(this.runMs));
    }
  }
}
