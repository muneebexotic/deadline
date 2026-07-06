// Death/finish submission validation. Self-contained on purpose: an identical
// copy lives at supabase/functions/_shared/validate.ts for the Deno edge runtime.
// verify-m4 asserts the two files never drift.

export const V_WORLD_W = 3200; // 200 tiles * 16px — keep in sync with src/config.ts
export const V_WORLD_H = 480; // 30 tiles * 16px
export const V_POSE_MAX = 5;
export const V_CAUSE_MAX = 4;
export const V_MIN_HUMAN_TIME_MS = 20000;
export const V_MAX_TIME_MS = 86400000;
export const TAG_RE = /^[A-Z0-9]{3}$/;
export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface DeathBody {
  day: string;
  x: number;
  y: number;
  rot: number; // quantized 0..255
  pose: number;
  cause: number;
  tag: string;
}

export interface FinishBody {
  day: string;
  tag: string;
  time_ms: number;
}

export function utcDayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function validateDeath(b: unknown, now: number): { ok: true; body: DeathBody } | { ok: false; error: string } {
  const o = (b ?? {}) as Record<string, unknown>;
  const day = String(o.day ?? '');
  if (!DAY_RE.test(day)) return { ok: false, error: 'bad day' };
  if (day !== utcDayKey(now)) return { ok: false, error: 'not today' };
  const x = Number(o.x);
  const y = Number(o.y);
  if (!Number.isFinite(x) || x < 0 || x >= V_WORLD_W) return { ok: false, error: 'x out of bounds' };
  if (!Number.isFinite(y) || y < 0 || y >= V_WORLD_H) return { ok: false, error: 'y out of bounds' };
  const rot = Number(o.rot);
  if (!Number.isInteger(rot) || rot < 0 || rot > 255) return { ok: false, error: 'bad rot' };
  const pose = Number(o.pose);
  if (!Number.isInteger(pose) || pose < 0 || pose > V_POSE_MAX) return { ok: false, error: 'bad pose' };
  const cause = Number(o.cause);
  if (!Number.isInteger(cause) || cause < 0 || cause > V_CAUSE_MAX) return { ok: false, error: 'bad cause' };
  const tag = String(o.tag ?? '');
  if (!TAG_RE.test(tag)) return { ok: false, error: 'bad tag' };
  return { ok: true, body: { day, x: Math.round(x), y: Math.round(y), rot, pose, cause, tag } };
}

export function validateFinish(b: unknown, now: number): { ok: true; body: FinishBody } | { ok: false; error: string } {
  const o = (b ?? {}) as Record<string, unknown>;
  const day = String(o.day ?? '');
  if (!DAY_RE.test(day)) return { ok: false, error: 'bad day' };
  if (day !== utcDayKey(now)) return { ok: false, error: 'not today' };
  const tag = String(o.tag ?? '');
  if (!TAG_RE.test(tag)) return { ok: false, error: 'bad tag' };
  const t = Number(o.time_ms);
  if (!Number.isInteger(t)) return { ok: false, error: 'bad time' };
  if (t < V_MIN_HUMAN_TIME_MS) return { ok: false, error: 'impossibly fast' };
  if (t > V_MAX_TIME_MS) return { ok: false, error: 'too slow' };
  return { ok: true, body: { day, tag, time_ms: t } };
}

/** Rate limit decision from the caller's recent history (max 1 death / 2s, 200/day). */
export function rateLimitDeath(lastDeathMs: number | null, todayCount: number, now: number): string | null {
  if (todayCount >= 200) return 'daily death budget spent';
  if (lastDeathMs !== null && now - lastDeathMs < 2000) return 'dying too fast';
  return null;
}
