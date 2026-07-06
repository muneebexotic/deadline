// Deterministic PRNG. Same seed string -> same sequence on every client on Earth.

export function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = {
  next(): number; // [0,1)
  int(lo: number, hi: number): number; // inclusive
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
};

export function makeRng(seedStr: string): Rng {
  const next = mulberry32(xmur3(seedStr)());
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

/** Today's level key: YYYY-MM-DD in UTC. The whole game hangs off this. */
export function dayKey(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** ms since UTC midnight — drives hazard phases so all clients see the same timing. */
export function dayMs(date: Date = new Date()): number {
  return (
    date.getUTCHours() * 3600000 +
    date.getUTCMinutes() * 60000 +
    date.getUTCSeconds() * 1000 +
    date.getUTCMilliseconds()
  );
}

/** ms until the world ends (00:00 UTC). */
export function msUntilMidnightUtc(date: Date = new Date()): number {
  return 86400000 - dayMs(date);
}
