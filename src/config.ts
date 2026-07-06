// All tunables in one place. Units: pixels, seconds, unless noted.

export const TILE = 16;
export const LEVEL_W = 200; // tiles
export const LEVEL_H = 30; // tiles
export const WORLD_W = LEVEL_W * TILE;
export const WORLD_H = LEVEL_H * TILE;

// Fixed-timestep simulation
export const SIM_HZ = 120;
export const SIM_DT = 1 / SIM_HZ;

// Player body
export const P_W = 10;
export const P_H = 14;

// Movement feel (px/s, px/s^2)
export const MOVE_SPEED = 150;
export const GROUND_ACCEL = 2200;
export const AIR_ACCEL = 1400;
export const GROUND_FRICTION = 2600;
export const AIR_FRICTION = 200;
export const GRAVITY = 1400;
export const FALL_GRAVITY_MULT = 1.35;
export const MAX_FALL = 460;
export const JUMP_VEL = 395;
export const JUMP_CUT_MULT = 0.45; // release jump early -> vy *= this
export const COYOTE_MS = 80;
export const JUMP_BUFFER_MS = 100;

// Derived (approx, used by solvability checker; verified against sim in verify-m1)
// max jump apex = JUMP_VEL^2 / (2*GRAVITY) = ~55.7px => can mount a 3-tile ledge, not 4.
export const MAX_MOUNT_TILES = 3;
// max flat gap clearable ~ 4 tiles (verified empirically).
export const MAX_GAP_TILES = 4;

// Corpses
export const CORPSE_W = 12;
export const CORPSE_H = 6;
export const CORPSE_DENSITY_CAP = 8; // per tile; beyond -> blood decal, no collider
export const RAGDOLL_MS = 1500;
// ~3 corpses of perfect stacking raise the floor by one tile (16/6).
export const CORPSES_PER_TILE_RAISE = 3;

// The wall (mid-level choke point): unjumpable, needs a corpse pile.
export const WALL_HEIGHT_TILES = 7; // mount needs floor raised 4 tiles => ~12 corpses

// Hazards
export const CRUSHER_PERIOD_MS = 2400;
export const CRUSHER_DOWN_FRAC = 0.28; // fraction of period spent slamming down
export const LASER_PERIOD_MS = 2000;
export const LASER_ON_FRAC = 0.45;
export const LASER_WARN_FRAC = 0.15; // blink before firing
export const COLLAPSE_SHAKE_MS = 220;
export const COLLAPSE_RESPAWN_MS = 3000;

// Death causes (wire order matters: packed into snapshot bytes)
export const CAUSES = ['Impaled', 'Crushed', 'Vaporized', 'Shattered', 'Sacrificed'] as const;
export type CauseId = 0 | 1 | 2 | 3 | 4;
export const POSE_COUNT = 6;

// Validation bounds for the backend
export const MIN_HUMAN_TIME_MS = 20000; // 3200px at 150px/s straight-line ~21.3s
export const MAX_TIME_MS = 86400000;

// Rendering
export const VIEW_W = 480;
export const VIEW_H = 270;
export const CHUNK_TILES = 16; // corpse bake chunk width, in tiles

// Palette
export const PAL = {
  bg: '#0b0d12',
  bgFar: '#10131c',
  tile: '#242a3a',
  tileEdge: '#39415a',
  spike: '#8b93a7',
  player: '#b8ff2e',
  corpse: '#8a935f',
  corpseDark: '#6b7350',
  blood: '#8c1f28',
  bloodBright: '#c22a38',
  laser: '#ff3b4b',
  laserWarn: '#7a2a33',
  crusher: '#4a5168',
  crusherEdge: '#666e8c',
  goal: '#ffd23e',
  collapse: '#3a4157',
  text: '#c8cede',
  dim: '#7a8194',
} as const;

export const SITE_NAME = 'DEADLINE';
// Production URL (used in share text; falls back to current origin at runtime)
export const SITE_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_SITE_URL ?? '';
