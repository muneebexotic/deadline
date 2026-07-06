// Share machinery: emoji result lines, canvas share cards, streaks, clipboard.
// Pure helpers up top (tested headless in verify-m5), DOM/canvas below.

import { WORLD_W, SITE_NAME, SITE_URL, PAL } from '../config';

// ---------- pure helpers ----------

export function fmtTime(ms: number): string {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function fmtDayShort(dayKey: string): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = Number(dayKey.slice(5, 7));
  const d = Number(dayKey.slice(8, 10));
  return `${months[m - 1]} ${d}`;
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US');
}

/** Wordle-style result line for text sharing. */
export function emojiLine(
  dayKey: string,
  progressFrac: number,
  corpseNumber: number | null,
  finish: { timeMs: number; rank: number } | null,
  streak: number,
): string {
  const day = fmtDayShort(dayKey);
  const streakTxt = streak > 1 ? ` · ${streak}d streak` : '';
  if (finish) {
    return `${SITE_NAME} ${day} 🏁 ${fmtTime(finish.timeMs)} · finisher #${fmtInt(finish.rank)}${streakTxt}`;
  }
  const slots = 8;
  const filled = Math.max(0, Math.min(slots, Math.round(progressFrac * slots)));
  const bar = '💀'.repeat(filled) + '⬛'.repeat(slots - filled);
  const pct = Math.round(progressFrac * 100);
  const corpse = corpseNumber ? ` · corpse #${fmtInt(corpseNumber)}` : '';
  return `${SITE_NAME} ${day} ${bar} ${pct}%${corpse}${streakTxt}`;
}

/** Consecutive-day streak ending at `today`, from the set of played day keys. */
export function computeStreak(playedDays: readonly string[], today: string): number {
  const set = new Set(playedDays);
  if (!set.has(today)) return 0;
  let streak = 0;
  let t = Date.parse(`${today}T00:00:00Z`);
  while (set.has(new Date(t).toISOString().slice(0, 10))) {
    streak++;
    t -= 86400000;
  }
  return streak;
}

/** Bin corpse x-positions into a skyline histogram, normalized to [0,1]. */
export function heatmapBins(xs: Iterable<number>, bins: number, worldW = WORLD_W): number[] {
  const out = new Array<number>(bins).fill(0);
  for (const x of xs) {
    const b = Math.max(0, Math.min(bins - 1, Math.floor((x / worldW) * bins)));
    out[b]++;
  }
  const max = Math.max(1, ...out);
  return out.map((v) => v / max);
}

// ---------- localStorage-backed bits ----------

const LS_TAG = 'deadline_tag';
const LS_DAYS = 'deadline_days';
const LS_MUTE = 'deadline_mute';

export function loadTag(): string | null {
  try {
    const t = localStorage.getItem(LS_TAG);
    return t && /^[A-Z0-9]{3}$/.test(t) ? t : null;
  } catch { return null; }
}
export function saveTag(tag: string): void {
  try { localStorage.setItem(LS_TAG, tag); } catch { /* private mode */ }
}
export function recordPlayed(today: string): number {
  try {
    const days: string[] = JSON.parse(localStorage.getItem(LS_DAYS) ?? '[]');
    if (!days.includes(today)) days.push(today);
    const trimmed = days.slice(-400);
    localStorage.setItem(LS_DAYS, JSON.stringify(trimmed));
    return computeStreak(trimmed, today);
  } catch { return 1; }
}
export function loadMute(): boolean {
  try { return localStorage.getItem(LS_MUTE) === '1'; } catch { return false; }
}
export function saveMute(m: boolean): void {
  try { localStorage.setItem(LS_MUTE, m ? '1' : '0'); } catch { /* ignore */ }
}

export function siteUrl(): string {
  return SITE_URL || (typeof location !== 'undefined' ? location.origin : '');
}

// ---------- share card (canvas -> PNG) ----------

export interface ShareCardOpts {
  dayKey: string;
  bins: number[]; // heatmap skyline
  deathsToday: number;
  myX: number | null; // my corpse x (world px), marks the spot
  corpseNumber: number | null;
  finish: { timeMs: number; rank: number } | null;
  progressFrac: number;
  streak: number;
  tag: string;
}

export function renderShareCard(o: ShareCardOpts): HTMLCanvasElement {
  const W = 1200;
  const H = 630;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;

  g.fillStyle = '#0b0d12';
  g.fillRect(0, 0, W, H);

  // skyline heatmap silhouette
  const skyH = 300;
  const baseY = H - 90;
  const bw = W / o.bins.length;
  g.fillStyle = '#232735';
  for (let i = 0; i < o.bins.length; i++) {
    const h = 8 + o.bins[i] * skyH;
    g.fillRect(i * bw, baseY - h, bw - 2, h);
  }
  // blood glow on the densest columns
  g.fillStyle = PAL.blood;
  for (let i = 0; i < o.bins.length; i++) {
    if (o.bins[i] > 0.55) {
      const h = 8 + o.bins[i] * skyH;
      g.fillRect(i * bw, baseY - h, bw - 2, 6);
    }
  }
  // my corpse marker
  if (o.myX !== null) {
    const mx = (o.myX / WORLD_W) * W;
    const bi = Math.max(0, Math.min(o.bins.length - 1, Math.floor((o.myX / WORLD_W) * o.bins.length)));
    const my = baseY - (8 + o.bins[bi] * skyH) - 26;
    g.fillStyle = PAL.player;
    g.font = 'bold 26px monospace';
    g.textAlign = 'center';
    g.fillText('✕ you', mx, my);
    g.fillRect(mx - 1, my + 8, 2, baseY - my - 8);
  }

  // ground line
  g.fillStyle = '#39415a';
  g.fillRect(0, baseY, W, 3);

  // title
  g.textAlign = 'left';
  g.fillStyle = '#e8ebf4';
  g.font = 'bold 64px monospace';
  g.fillText('DEADLINE', 60, 110);
  g.fillStyle = PAL.bloodBright;
  g.font = 'bold 28px monospace';
  g.fillText(fmtDayShort(o.dayKey).toUpperCase() + ' — THIS WORLD ENDS AT MIDNIGHT UTC', 60, 156);

  // main stat
  g.fillStyle = '#e8ebf4';
  g.font = 'bold 44px monospace';
  if (o.finish) {
    g.fillText(`${o.tag} FINISHED  ${fmtTime(o.finish.timeMs)}  ·  #${fmtInt(o.finish.rank)}`, 60, 230);
  } else if (o.corpseNumber) {
    g.fillText(`${o.tag} — CORPSE #${fmtInt(o.corpseNumber)} OF ${fmtDayShort(o.dayKey).toUpperCase()}`, 60, 230);
  } else {
    g.fillText(`${fmtInt(o.deathsToday)} DEAD SO FAR TODAY`, 60, 230);
  }

  g.fillStyle = '#7a8194';
  g.font = '26px monospace';
  const pct = o.finish ? 100 : Math.round(o.progressFrac * 100);
  const extras: string[] = [`made it ${pct}% of the way`];
  if (o.streak > 1) extras.push(`${o.streak} day streak`);
  extras.push(`${fmtInt(o.deathsToday)} corpses litter the level`);
  g.fillText(extras.join('  ·  '), 60, 272);

  // url
  g.fillStyle = PAL.player;
  g.font = 'bold 30px monospace';
  g.fillText(siteUrl().replace(/^https?:\/\//, '') || 'deadline', 60, H - 36);

  return c;
}

export async function copyCanvasPng(c: HTMLCanvasElement): Promise<boolean> {
  try {
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
    if (!blob) return false;
    const Item = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
    if (Item && navigator.clipboard?.write) {
      await navigator.clipboard.write([new Item({ 'image/png': blob })]);
      return true;
    }
  } catch { /* fall through to download */ }
  try {
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = 'deadline.png';
    a.click();
    return true;
  } catch { return false; }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { return false; }
}
