// Client networking: snapshot load, realtime deltas, presence, submissions.
// Fully optional — with no Supabase env vars the game runs in offline mode
// (solo corpses only) and every method here degrades to a no-op.

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { unpackCorpses, quantRot, type PackedCorpse } from './codec';

export interface DeathEvent {
  x: number;
  y: number;
  rot: number; // radians
  pose: number;
  cause: number;
  tag: string;
  t: number; // epoch ms (approx for deltas)
}

export interface FinishEvent {
  tag: string;
  time_ms: number;
  rank: number;
}

export interface LeaderRow {
  tag: string;
  time_ms: number;
}

export interface DayStat {
  day_key: string;
  corpse_count: number;
  finish_count: number;
  best_time_ms: number | null;
}

type Env = { url: string; anon: string } | null;

function readEnv(): Env {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const url = env?.VITE_SUPABASE_URL;
  const anon = env?.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return { url, anon };
}

export class Net {
  online = false;
  deathsToday = 0;
  finishersToday = 0;
  playersNow = 0;
  onDeath: ((d: DeathEvent) => void) | null = null;
  onFinish: ((f: FinishEvent) => void) | null = null;
  onPos: ((tag: string, x: number, y: number) => void) | null = null;
  onCounts: (() => void) | null = null;
  private env: Env;
  private sb: SupabaseClient | null = null;
  private channel: RealtimeChannel | null = null;
  private day = '';
  private myKey = Math.random().toString(36).slice(2, 10);
  private lastPosSent = 0;

  constructor() {
    this.env = readEnv();
    if (this.env) {
      this.sb = createClient(this.env.url, this.env.anon, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
  }

  /** Load the day's snapshot; resolves [] offline. Subscribe first so no delta is missed. */
  async init(day: string): Promise<PackedCorpse[]> {
    this.day = day;
    if (!this.env || !this.sb) return [];
    const buffered: DeathEvent[] = [];
    let snapshotDone = false;

    try {
      this.channel = this.sb.channel(`day:${day}`, {
        config: { broadcast: { self: false }, presence: { key: this.myKey } },
      });
      this.channel
        .on('broadcast', { event: 'death' }, ({ payload }) => {
          const d = payload as DeathEvent;
          if (!snapshotDone) buffered.push(d);
          else this.acceptDeath(d);
        })
        .on('broadcast', { event: 'finish' }, ({ payload }) => {
          this.finishersToday++;
          this.onFinish?.(payload as FinishEvent);
          this.onCounts?.();
        })
        .on('broadcast', { event: 'pos' }, ({ payload }) => {
          const p = payload as { tag: string; x: number; y: number };
          this.onPos?.(p.tag, p.x, p.y);
        })
        .on('presence', { event: 'sync' }, () => {
          this.playersNow = Object.keys(this.channel?.presenceState() ?? {}).length;
          this.onCounts?.();
        })
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            void this.channel?.track({ at: Date.now() });
          }
        });
    } catch {
      /* realtime is optional */
    }

    let corpses: PackedCorpse[] = [];
    try {
      const res = await fetch(`${this.env.url}/functions/v1/snapshot?day=${day}`, {
        headers: { apikey: this.env.anon, Authorization: `Bearer ${this.env.anon}` },
      });
      if (res.ok) {
        const buf = await res.arrayBuffer();
        corpses = unpackCorpses(buf);
        this.deathsToday = Number(res.headers.get('X-Total-Count') ?? corpses.length);
        this.online = true;
      }
    } catch {
      /* offline mode */
    }

    try {
      const { count } = await this.sb
        .from('finishes')
        .select('id', { count: 'exact', head: true })
        .eq('day_key', day);
      this.finishersToday = count ?? 0;
    } catch {
      /* non-fatal */
    }

    snapshotDone = true;
    for (const d of buffered) this.acceptDeath(d);
    this.onCounts?.();
    return corpses;
  }

  private acceptDeath(d: DeathEvent): void {
    this.deathsToday++;
    this.onDeath?.(d);
    this.onCounts?.();
  }

  /** Called after my ragdoll froze: broadcast the delta + persist. Returns corpse number. */
  async sendDeath(d: DeathEvent): Promise<number> {
    this.deathsToday++;
    this.onCounts?.();
    if (!this.env) return this.deathsToday;
    try {
      void this.channel?.send({ type: 'broadcast', event: 'death', payload: d });
    } catch { /* best effort */ }
    try {
      const res = await fetch(`${this.env.url}/functions/v1/submit-death`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: this.env.anon,
          Authorization: `Bearer ${this.env.anon}`,
        },
        body: JSON.stringify({
          day: this.day,
          x: Math.round(d.x),
          y: Math.round(d.y),
          rot: quantRot(d.rot),
          pose: d.pose,
          cause: d.cause,
          tag: d.tag,
        }),
      });
      if (res.ok) {
        const j = (await res.json()) as { corpseNumber?: number };
        if (j.corpseNumber) {
          this.deathsToday = Math.max(this.deathsToday, j.corpseNumber);
          this.onCounts?.();
          return j.corpseNumber;
        }
      }
    } catch { /* offline */ }
    return this.deathsToday;
  }

  async sendFinish(tag: string, timeMs: number): Promise<{ rank: number; total: number } | null> {
    this.finishersToday++;
    this.onCounts?.();
    if (!this.env) return null;
    try {
      const res = await fetch(`${this.env.url}/functions/v1/submit-finish`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          apikey: this.env.anon,
          Authorization: `Bearer ${this.env.anon}`,
        },
        body: JSON.stringify({ day: this.day, tag, time_ms: timeMs }),
      });
      if (res.ok) return (await res.json()) as { rank: number; total: number };
    } catch { /* offline */ }
    return null;
  }

  /** Spectate feed: broadcast my position while near the wall (10hz max). */
  sendPos(tag: string, x: number, y: number): void {
    const now = performance.now();
    if (!this.channel || now - this.lastPosSent < 100) return;
    this.lastPosSent = now;
    try {
      void this.channel.send({ type: 'broadcast', event: 'pos', payload: { tag, x, y } });
    } catch { /* best effort */ }
  }

  async fetchLeaderboard(day: string, limit = 10): Promise<LeaderRow[]> {
    if (!this.sb) return [];
    try {
      const { data } = await this.sb
        .from('finishes')
        .select('tag,time_ms')
        .eq('day_key', day)
        .order('time_ms', { ascending: true })
        .limit(limit);
      return (data as LeaderRow[]) ?? [];
    } catch {
      return [];
    }
  }

  async fetchArchive(): Promise<DayStat[]> {
    if (!this.sb) return [];
    try {
      const { data } = await this.sb
        .from('day_stats')
        .select('*')
        .order('day_key', { ascending: false })
        .limit(60);
      return (data as DayStat[]) ?? [];
    } catch {
      return [];
    }
  }

  /** Packed snapshot for an arbitrary (past) day — archive heatmaps. */
  async fetchDaySnapshot(day: string): Promise<PackedCorpse[]> {
    if (!this.env) return [];
    try {
      const res = await fetch(`${this.env.url}/functions/v1/snapshot?day=${day}`, {
        headers: { apikey: this.env.anon, Authorization: `Bearer ${this.env.anon}` },
      });
      if (res.ok) return unpackCorpses(await res.arrayBuffer());
    } catch { /* offline */ }
    return [];
  }
}
