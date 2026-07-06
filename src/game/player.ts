// Player physics. Pure & DOM-free: collision is injected as a query function.

import {
  P_W, P_H, MOVE_SPEED, GROUND_ACCEL, AIR_ACCEL, GROUND_FRICTION, AIR_FRICTION,
  GRAVITY, FALL_GRAVITY_MULT, MAX_FALL, JUMP_VEL, JUMP_CUT_MULT,
  COYOTE_MS, JUMP_BUFFER_MS,
} from '../config';

export interface InputState {
  left: boolean;
  right: boolean;
  jump: boolean; // held
  jumpPressed: boolean; // edge, consumed by sim each tick
}

export interface Player {
  x: number; // top-left
  y: number;
  px: number; // previous position for render interpolation
  py: number;
  vx: number;
  vy: number;
  grounded: boolean;
  coyoteMs: number;
  bufferMs: number;
  jumping: boolean; // currently in a jump we can cut
  facing: 1 | -1;
  maxX: number; // furthest progress this run (for share %)
}

/** AABB solid query: true if the box overlaps anything solid (tiles + corpses + crusher body). */
export type SolidQuery = (x: number, y: number, w: number, h: number) => boolean;

export function makePlayer(x: number, y: number): Player {
  return {
    x, y, px: x, py: y, vx: 0, vy: 0,
    grounded: false, coyoteMs: 0, bufferMs: 0, jumping: false, facing: 1, maxX: x,
  };
}

export interface StepEvents {
  jumped: boolean;
  landed: boolean;
}

const EPS = 0.001;
const STEP_UP_PX = 4; // auto-climb lips up to this tall while grounded (corpse piles are bumpy)

/** Move along one axis, resolving against solids. Returns actual moved amount.
 *  When moving horizontally on the ground, small lips (< STEP_UP_PX) are climbed
 *  automatically — corpse piles are uneven and must feel walkable. */
function moveAxis(p: Player, solid: SolidQuery, dx: number, dy: number, stepUp = false): number {
  const want = dx !== 0 ? dx : dy;
  if (want === 0) return 0;
  // step in sub-tile increments to never tunnel (max speed 460px/s at 120hz = 3.8px/tick)
  let remaining = want;
  let moved = 0;
  const stepMax = 4;
  while (remaining !== 0) {
    const step = Math.abs(remaining) > stepMax ? Math.sign(remaining) * stepMax : remaining;
    let nx = p.x + (dx !== 0 ? step : 0);
    const ny = p.y + (dy !== 0 ? step : 0);
    if (solid(nx, ny, P_W, P_H)) {
      if (stepUp && dx !== 0) {
        let lifted = false;
        for (let lift = 1; lift <= STEP_UP_PX; lift++) {
          if (!solid(nx, p.y - lift, P_W, P_H) && !solid(p.x, p.y - lift, P_W, P_H)) {
            p.y -= lift;
            p.x = nx;
            moved += step;
            remaining -= step;
            lifted = true;
            break;
          }
        }
        if (lifted) continue;
      }
      // binary search the contact point for a snug fit
      let lo = 0;
      let hi = step;
      for (let i = 0; i < 6; i++) {
        const mid = (lo + hi) / 2;
        const mx = p.x + (dx !== 0 ? mid : 0);
        const my = p.y + (dy !== 0 ? mid : 0);
        if (solid(mx, my, P_W, P_H)) hi = mid;
        else lo = mid;
      }
      if (dx !== 0) p.x += lo;
      else p.y += lo;
      moved += lo;
      return moved;
    }
    p.x = nx;
    p.y = ny;
    moved += step;
    remaining -= step;
  }
  return moved;
}

export function stepPlayer(p: Player, input: InputState, solid: SolidQuery, dt: number): StepEvents {
  const ev: StepEvents = { jumped: false, landed: false };
  p.px = p.x;
  p.py = p.y;

  const wasGrounded = p.grounded;
  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir !== 0) p.facing = dir as 1 | -1;

  // Horizontal accel/friction
  const accel = p.grounded ? GROUND_ACCEL : AIR_ACCEL;
  const fric = p.grounded ? GROUND_FRICTION : AIR_FRICTION;
  if (dir !== 0) {
    p.vx += dir * accel * dt;
    if (Math.abs(p.vx) > MOVE_SPEED) p.vx = Math.sign(p.vx) * MOVE_SPEED;
  } else {
    const drop = fric * dt;
    if (Math.abs(p.vx) <= drop) p.vx = 0;
    else p.vx -= Math.sign(p.vx) * drop;
  }

  // Timers
  p.coyoteMs = p.grounded ? COYOTE_MS : Math.max(0, p.coyoteMs - dt * 1000);
  if (input.jumpPressed) p.bufferMs = JUMP_BUFFER_MS;
  else p.bufferMs = Math.max(0, p.bufferMs - dt * 1000);

  // Jump (buffered + coyote)
  if (p.bufferMs > 0 && p.coyoteMs > 0) {
    p.vy = -JUMP_VEL;
    p.jumping = true;
    p.grounded = false;
    p.coyoteMs = 0;
    p.bufferMs = 0;
    ev.jumped = true;
  }
  // Variable height: cut the jump when the button is released on the way up
  if (p.jumping && !input.jump && p.vy < 0) {
    p.vy *= JUMP_CUT_MULT;
    p.jumping = false;
  }

  // Gravity (heavier when falling for snap)
  const g = p.vy > 0 ? GRAVITY * FALL_GRAVITY_MULT : GRAVITY;
  p.vy = Math.min(p.vy + g * dt, MAX_FALL);

  // Move + resolve, axis by axis (step-up assist only while on the ground)
  const dxWant = p.vx * dt;
  const dxGot = moveAxis(p, solid, dxWant, 0, p.grounded);
  if (Math.abs(dxGot - dxWant) > EPS) p.vx = 0;

  const dyWant = p.vy * dt;
  const dyGot = moveAxis(p, solid, 0, dyWant);
  if (Math.abs(dyGot - dyWant) > EPS) {
    if (p.vy > 0) {
      // landed
      p.grounded = true;
      p.jumping = false;
      if (!wasGrounded) ev.landed = true;
    }
    p.vy = 0;
  } else if (p.vy > 0) {
    p.grounded = false;
  }
  // ground check when walking off ledges (vy == 0 after landing)
  if (p.grounded && !solid(p.x, p.y + 1, P_W, P_H)) p.grounded = false;

  if (p.x > p.maxX) p.maxX = p.x;
  return ev;
}
