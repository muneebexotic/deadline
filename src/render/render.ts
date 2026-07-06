// Canvas renderer. Terrain baked once; corpses baked into per-chunk offscreen
// canvases redrawn only when a corpse lands in them. Never iterates all corpses per frame.

import {
  TILE, LEVEL_W, LEVEL_H, WORLD_W, WORLD_H, VIEW_W, VIEW_H, CHUNK_TILES,
  P_W, P_H, PAL, CORPSE_W, CORPSE_H,
} from '../config';
import type { Game } from '../game/sim';
import { tileAt, T_SOLID, T_SPIKE, T_COLLAPSE, T_GOAL } from '../game/level';
import { crusherRect, laserPhase, laserRect } from '../game/hazards';
import type { Fx } from '../fx/fx';
import type { CorpseStore } from '../game/corpses';

const CHUNK_PX = CHUNK_TILES * TILE;
const N_CHUNKS = Math.ceil(WORLD_W / CHUNK_PX);

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  camX = 0;
  camY = 0;
  /** spectate: pin camera at the wall */
  fixedCam: { x: number; y: number } | null = null;
  private terrain: HTMLCanvasElement;
  private chunks: (HTMLCanvasElement | null)[] = new Array(N_CHUNKS).fill(null);
  private dirty = new Set<number>();
  private game: Game;
  private fx: Fx;
  /** ghost players (spectate mode) tag -> position */
  ghosts = new Map<string, { x: number; y: number; t: number }>();

  constructor(canvas: HTMLCanvasElement, game: Game, fx: Fx) {
    this.canvas = canvas;
    this.game = game;
    this.fx = fx;
    canvas.width = VIEW_W;
    canvas.height = VIEW_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
    this.terrain = bakeTerrain(game);
    game.corpses.onChunkDirty = (c) => this.dirty.add(c);
    // everything already in the store (snapshot load) needs a first bake
    for (let i = 0; i < N_CHUNKS; i++) this.dirty.add(i);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const scale = Math.max(1, Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H));
    this.canvas.style.width = `${VIEW_W * scale}px`;
    this.canvas.style.height = `${VIEW_H * scale}px`;
  }

  screenToWorld(clientX: number, clientY: number): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [
      this.camX + ((clientX - r.left) / r.width) * VIEW_W,
      this.camY + ((clientY - r.top) / r.height) * VIEW_H,
    ];
  }

  private bakeChunk(ci: number): void {
    let c = this.chunks[ci];
    if (!c) {
      c = document.createElement('canvas');
      c.width = CHUNK_PX;
      c.height = WORLD_H;
      this.chunks[ci] = c;
    }
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, CHUNK_PX, WORLD_H);
    const store = this.game.corpses;
    const x0 = ci * CHUNK_PX;
    const x1 = x0 + CHUNK_PX;
    // one linear pass over the store per bake; bakes are rare (one per landing corpse)
    for (let i = 0; i < store.count; i++) {
      const x = store.xs[i];
      if (x < x0 - CORPSE_W || x >= x1 + CORPSE_W) continue;
      if (store.isDecal[i]) {
        g.fillStyle = PAL.blood;
        g.globalAlpha = 0.5;
        g.fillRect(Math.round(x - x0 - 4), Math.round(store.ys[i]) - 1, 8, 3);
        g.globalAlpha = 1;
      } else {
        drawCorpse(g, x - x0, store.ys[i], store.rots[i], store.poses[i]);
      }
    }
  }

  render(alpha: number): void {
    const { ctx, game } = this;
    for (const ci of this.dirty) this.bakeChunk(ci);
    this.dirty.clear();

    const p = game.player;
    const ix = p.px + (p.x - p.px) * alpha;
    const iy = p.py + (p.y - p.py) * alpha;

    // camera
    let cx: number, cy: number;
    if (this.fixedCam) {
      cx = this.fixedCam.x;
      cy = this.fixedCam.y;
    } else {
      cx = ix + P_W / 2 + p.facing * 40 - VIEW_W / 2;
      cy = iy + P_H / 2 - VIEW_H / 2 - 20;
    }
    // smooth follow
    this.camX += (cx - this.camX) * Math.min(1, alpha * 0.4 + 0.12);
    this.camY += (cy - this.camY) * Math.min(1, alpha * 0.4 + 0.12);
    this.camX = Math.max(0, Math.min(WORLD_W - VIEW_W, this.camX));
    this.camY = Math.max(0, Math.min(WORLD_H - VIEW_H, this.camY));
    const [sx, sy] = this.fx.shakeOffset();
    const camX = Math.round(this.camX + sx);
    const camY = Math.round(this.camY + sy);

    // background
    ctx.fillStyle = PAL.bg;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = PAL.bgFar;
    for (let i = 0; i < 14; i++) {
      const bx = ((i * 371 - camX * 0.3) % (VIEW_W + 80) + VIEW_W + 80) % (VIEW_W + 80) - 40;
      const bh = 40 + ((i * 97) % 90);
      ctx.fillRect(bx, VIEW_H - bh, 24 + ((i * 53) % 30), bh);
    }

    ctx.save();
    ctx.translate(-camX, -camY);

    // terrain (one blit)
    ctx.drawImage(this.terrain, camX, camY, VIEW_W, VIEW_H, camX, camY, VIEW_W, VIEW_H);

    // collapse tiles (dynamic)
    this.drawCollapseTiles(camX, camY);

    // corpse chunks (blit visible only)
    const c0 = Math.max(0, Math.floor(camX / CHUNK_PX));
    const c1 = Math.min(N_CHUNKS - 1, Math.floor((camX + VIEW_W) / CHUNK_PX));
    for (let ci = c0; ci <= c1; ci++) {
      const c = this.chunks[ci];
      if (c) ctx.drawImage(c, ci * CHUNK_PX, 0);
    }

    // ragdolls
    for (const d of game.corpses.ragdolls) {
      const rx = d.px + (d.x - d.px) * alpha;
      const ry = d.py + (d.y - d.py) * alpha;
      drawCorpse(ctx, rx, ry, d.rot, d.pose);
    }

    // hazards
    this.drawHazards();

    // ghosts (spectate)
    const now = performance.now();
    for (const [tag, gpos] of this.ghosts) {
      if (now - gpos.t > 3000) { this.ghosts.delete(tag); continue; }
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = PAL.player;
      ctx.fillRect(Math.round(gpos.x), Math.round(gpos.y), P_W, P_H);
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = PAL.dim;
      ctx.font = '7px monospace';
      ctx.fillText(tag, Math.round(gpos.x) - 3, Math.round(gpos.y) - 3);
      ctx.globalAlpha = 1;
    }

    // player
    if (game.state === 'alive' || game.state === 'finished') {
      ctx.fillStyle = PAL.player;
      ctx.fillRect(Math.round(ix), Math.round(iy), P_W, P_H);
      // eyes
      ctx.fillStyle = PAL.bg;
      const ex = p.facing === 1 ? 5 : 1;
      ctx.fillRect(Math.round(ix) + ex, Math.round(iy) + 3, 2, 3);
      ctx.fillRect(Math.round(ix) + ex + 3, Math.round(iy) + 3, 2, 3);
    }

    // particles
    for (const pt of this.fx.particles) {
      ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = pt.color;
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  private drawCollapseTiles(camX: number, camY: number): void {
    const { ctx, game } = this;
    const tx0 = Math.max(0, Math.floor(camX / TILE));
    const tx1 = Math.min(LEVEL_W - 1, Math.floor((camX + VIEW_W) / TILE));
    const ty0 = Math.max(0, Math.floor(camY / TILE));
    const ty1 = Math.min(LEVEL_H - 1, Math.floor((camY + VIEW_H) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (tileAt(game.level, tx, ty) !== T_COLLAPSE) continue;
        if (game.collapsedGone.has(ty * LEVEL_W + tx)) continue;
        const shake = game.isShaking(tx, ty) ? Math.round(Math.random() * 2 - 1) : 0;
        ctx.fillStyle = PAL.collapse;
        ctx.fillRect(tx * TILE + shake, ty * TILE + 2, TILE, TILE - 4);
        ctx.fillStyle = PAL.tileEdge;
        ctx.fillRect(tx * TILE + shake, ty * TILE + 2, TILE, 2);
      }
    }
  }

  private drawHazards(): void {
    const { ctx, game } = this;
    for (const h of game.level.hazards) {
      if (h.kind === 'crusher') {
        const r = crusherRect(h, game.clockMs);
        // chain
        ctx.fillStyle = PAL.tileEdge;
        ctx.fillRect(r.x + r.w / 2 - 1, h.ty * TILE - 40, 2, r.y - h.ty * TILE + 40);
        ctx.fillStyle = PAL.crusher;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        ctx.fillStyle = PAL.crusherEdge;
        ctx.fillRect(r.x, r.y + r.h - 4, r.w, 4);
        // teeth
        ctx.fillStyle = PAL.spike;
        for (let i = 0; i < r.w; i += 8) {
          ctx.beginPath();
          ctx.moveTo(r.x + i, r.y + r.h);
          ctx.lineTo(r.x + i + 4, r.y + r.h + 5);
          ctx.lineTo(r.x + i + 8, r.y + r.h);
          ctx.fill();
        }
      } else {
        const phase = laserPhase(h, game.clockMs);
        const r = laserRect(h);
        // emitters
        ctx.fillStyle = PAL.crusher;
        ctx.fillRect(r.x - 4, r.y - 4, 12, 4);
        ctx.fillRect(r.x - 4, r.y + r.h, 12, 4);
        if (phase === 'on') {
          ctx.fillStyle = PAL.laser;
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.globalAlpha = 0.25;
          ctx.fillRect(r.x - 3, r.y, r.w + 6, r.h);
          ctx.globalAlpha = 1;
        } else if (phase === 'warn' && Math.floor(game.clockMs / 80) % 2 === 0) {
          ctx.fillStyle = PAL.laserWarn;
          ctx.fillRect(r.x + 1, r.y, 2, r.h);
        }
      }
    }
  }
}

/** Bake the static tile map once (solid, spikes, goal). */
function bakeTerrain(game: Game): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = WORLD_W;
  c.height = WORLD_H;
  const g = c.getContext('2d')!;
  for (let ty = 0; ty < LEVEL_H; ty++) {
    for (let tx = 0; tx < LEVEL_W; tx++) {
      const t = tileAt(game.level, tx, ty);
      const x = tx * TILE;
      const y = ty * TILE;
      if (t === T_SOLID) {
        g.fillStyle = PAL.tile;
        g.fillRect(x, y, TILE, TILE);
        if (tileAt(game.level, tx, ty - 1) !== T_SOLID) {
          g.fillStyle = PAL.tileEdge;
          g.fillRect(x, y, TILE, 2);
        }
      } else if (t === T_SPIKE) {
        g.fillStyle = PAL.spike;
        for (let i = 0; i < TILE; i += 8) {
          g.beginPath();
          g.moveTo(x + i, y + TILE);
          g.lineTo(x + i + 4, y + 5);
          g.lineTo(x + i + 8, y + TILE);
          g.fill();
        }
      } else if (t === T_GOAL) {
        g.fillStyle = PAL.goal;
        g.globalAlpha = 0.85;
        g.fillRect(x + 6, y, 3, TILE);
        if (tileAt(game.level, tx, ty - 1) !== T_GOAL) {
          g.fillRect(x + 6, y, 10, 6);
        }
        g.globalAlpha = 1;
      }
    }
  }
  return c;
}

/** Procedural corpse sprites: 6 poses, drawn desaturated. Used for bakes and ragdolls. */
export function drawCorpse(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rot: number,
  pose: number,
): void {
  g.save();
  g.translate(Math.round(cx), Math.round(cy));
  g.rotate(rot);
  g.fillStyle = PAL.corpse;
  const w = CORPSE_W;
  const h = CORPSE_H;
  switch (pose % 6) {
    case 0: // flat on back
      g.fillRect(-w / 2, -h / 2, w, h);
      g.fillStyle = PAL.corpseDark;
      g.fillRect(w / 2 - 4, -h / 2 - 2, 4, 4); // head
      break;
    case 1: // crumpled
      g.fillRect(-w / 2, -h / 2 + 1, w - 3, h - 1);
      g.fillRect(-w / 2 + 2, -h / 2 - 2, 5, 4);
      break;
    case 2: // sitting slump
      g.fillRect(-w / 2, -h / 2, 6, h);
      g.fillRect(-w / 2, -h / 2 - 3, 5, 4);
      g.fillRect(0, h / 2 - 3, w / 2, 3);
      break;
    case 3: // face down, arm out
      g.fillRect(-w / 2, -h / 2 + 2, w, h - 2);
      g.fillRect(-w / 2 - 3, -h / 2 + 2, 4, 2);
      g.fillStyle = PAL.corpseDark;
      g.fillRect(-w / 2, -h / 2, 4, 3);
      break;
    case 4: // curled
      g.fillRect(-4, -h / 2, 8, h);
      g.fillRect(-6, -h / 2 + 1, 3, 4);
      break;
    default: // spread eagle
      g.fillRect(-w / 2, -1, w, 3);
      g.fillRect(-1, -h / 2 - 1, 3, h + 2);
      break;
  }
  // blood speck
  g.fillStyle = PAL.blood;
  g.globalAlpha = 0.6;
  g.fillRect(-2, h / 2 - 1, 4, 1);
  g.globalAlpha = 1;
  g.restore();
}
