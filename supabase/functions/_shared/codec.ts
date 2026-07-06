// Binary corpse codec, 13 bytes per corpse. Self-contained on purpose:
// an identical copy lives at supabase/functions/_shared/codec.ts for the Deno
// edge runtime. verify-m4 asserts the two files never drift.
//
// Record layout (little-endian):
//   u16 x        px, 0..3200 (level is 200 tiles * 16px)
//   u16 y        px, 0..480
//   u8  rot      quantized radians: 0..255 -> 0..2pi
//   u8  poseCause  pose in low nibble, cause in high nibble
//   3xu8 tag     ASCII A-Z 0-9
//   u32 tSec     seconds since UTC midnight of the day
// Header: 'DL01' magic + u32 count.

export interface PackedCorpse {
  x: number;
  y: number;
  rot: number; // radians
  pose: number;
  cause: number;
  tag: string;
  tSec: number;
}

export const RECORD_SIZE = 13;
export const HEADER_SIZE = 8;
const MAGIC = 0x314c44; // 'DL1' of 'DL01' checked loosely below

export function quantRot(rot: number): number {
  const tau = Math.PI * 2;
  const n = ((rot % tau) + tau) % tau;
  return Math.round((n / tau) * 256) % 256; // 256 steps: byte 255 never aliases back to 0
}

export function packCorpses(list: PackedCorpse[]): Uint8Array {
  const buf = new ArrayBuffer(HEADER_SIZE + list.length * RECORD_SIZE);
  const v = new DataView(buf);
  v.setUint8(0, 0x44); // D
  v.setUint8(1, 0x4c); // L
  v.setUint8(2, 0x30); // 0
  v.setUint8(3, 0x31); // 1
  v.setUint32(4, list.length, true);
  let o = HEADER_SIZE;
  for (const c of list) {
    v.setUint16(o, clampInt(c.x, 0, 65535), true);
    v.setUint16(o + 2, clampInt(c.y, 0, 65535), true);
    v.setUint8(o + 4, c.rot >= 0 && c.rot <= 255 && Number.isInteger(c.rot) ? c.rot : quantRot(c.rot));
    v.setUint8(o + 5, (c.pose & 0x0f) | ((c.cause & 0x0f) << 4));
    const tag = normalizeTag(c.tag);
    v.setUint8(o + 6, tag.charCodeAt(0));
    v.setUint8(o + 7, tag.charCodeAt(1));
    v.setUint8(o + 8, tag.charCodeAt(2));
    v.setUint32(o + 9, clampInt(c.tSec, 0, 4294967295), true);
    o += RECORD_SIZE;
  }
  return new Uint8Array(buf);
}

export function unpackCorpses(data: ArrayBuffer | Uint8Array): PackedCorpse[] {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (u8.length < HEADER_SIZE) return [];
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (v.getUint8(0) !== 0x44 || v.getUint8(1) !== 0x4c) return [];
  const count = v.getUint32(4, true);
  const max = Math.floor((u8.length - HEADER_SIZE) / RECORD_SIZE);
  const n = Math.min(count, max);
  const out: PackedCorpse[] = new Array(n);
  let o = HEADER_SIZE;
  for (let i = 0; i < n; i++) {
    const rotByte = v.getUint8(o + 4);
    const pc = v.getUint8(o + 5);
    out[i] = {
      x: v.getUint16(o, true),
      y: v.getUint16(o + 2, true),
      rot: (rotByte / 256) * Math.PI * 2,
      pose: pc & 0x0f,
      cause: (pc >> 4) & 0x0f,
      tag: String.fromCharCode(v.getUint8(o + 6), v.getUint8(o + 7), v.getUint8(o + 8)),
      tSec: v.getUint32(o + 9, true),
    };
    o += RECORD_SIZE;
  }
  return out;
}

export function normalizeTag(tag: unknown): string {
  const s = String(tag ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return (s + 'AAA').slice(0, 3);
}

function clampInt(n: number, lo: number, hi: number): number {
  n = Math.round(Number(n) || 0);
  return n < lo ? lo : n > hi ? hi : n;
}

// referenced to keep identical copies importable in both runtimes without tree-shake warnings
void MAGIC;
