// M4 verification: binary codec round-trip, validation + rate limit logic,
// and shared-copy drift check (src/net vs supabase/functions/_shared).
import { readFileSync } from 'node:fs';
import { packCorpses, unpackCorpses, quantRot, normalizeTag, RECORD_SIZE, HEADER_SIZE, type PackedCorpse } from '../src/net/codec';
import { validateDeath, validateFinish, rateLimitDeath, utcDayKey } from '../src/net/validate';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('M4: codec round-trip');
{
  const rnd = (n: number) => Math.floor(Math.random() * n);
  const tags = ['ACE', 'B0B', 'ZZZ', 'K9X', '000'];
  const list: PackedCorpse[] = Array.from({ length: 5000 }, () => ({
    x: rnd(3200),
    y: rnd(480),
    rot: quantRot(Math.random() * 7 - 3.5),
    pose: rnd(6),
    cause: rnd(5),
    tag: tags[rnd(tags.length)],
    tSec: rnd(86400),
  }));
  const packed = packCorpses(list);
  check(`packed size ${packed.length} = ${HEADER_SIZE} + n*${RECORD_SIZE}`,
    packed.length === HEADER_SIZE + list.length * RECORD_SIZE);
  check(`~13 bytes per corpse (spec: ~40)`, RECORD_SIZE <= 40);
  const back = unpackCorpses(packed);
  check('count preserved', back.length === list.length);
  let exact = true;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const b = back[i];
    if (a.x !== b.x || a.y !== b.y || a.pose !== b.pose || a.cause !== b.cause ||
        a.tag !== b.tag || a.tSec !== b.tSec || quantRot(b.rot) !== a.rot) {
      exact = false;
      console.error(`  mismatch at ${i}:`, a, b);
      break;
    }
  }
  check('all fields survive round-trip (rot within quantization)', exact);
  check('unpack rejects garbage', unpackCorpses(new Uint8Array([1, 2, 3]).buffer).length === 0
    && unpackCorpses(new Uint8Array(0).buffer).length === 0);
  // truncated payload must not throw or over-read
  const truncated = packed.slice(0, HEADER_SIZE + 10 * RECORD_SIZE + 5);
  check('truncated payload -> 10 whole records', unpackCorpses(truncated).length === 10);
  check('100k corpses ≈ ' + Math.round((HEADER_SIZE + 100000 * RECORD_SIZE) / 1024) + 'KB raw (< 1.5MB)',
    HEADER_SIZE + 100000 * RECORD_SIZE < 1.5 * 1024 * 1024);
}

console.log('M4: validation');
{
  const now = Date.UTC(2026, 6, 6, 15, 0, 0);
  const today = utcDayKey(now);
  const good = { day: today, x: 512, y: 340, rot: 128, pose: 3, cause: 0, tag: 'MUN' };
  check('valid death accepted', validateDeath(good, now).ok);
  check('wrong day rejected', !validateDeath({ ...good, day: '2026-07-05' }, now).ok);
  check('x out of bounds rejected', !validateDeath({ ...good, x: 3200 }, now).ok);
  check('negative y rejected', !validateDeath({ ...good, y: -1 }, now).ok);
  check('bad tag rejected', !validateDeath({ ...good, tag: 'ab' }, now).ok
    && !validateDeath({ ...good, tag: 'ABCD' }, now).ok
    && !validateDeath({ ...good, tag: 'a!c' }, now).ok);
  check('bad pose/cause rejected', !validateDeath({ ...good, pose: 6 }, now).ok
    && !validateDeath({ ...good, cause: 9 }, now).ok);
  check('non-integer rot rejected', !validateDeath({ ...good, rot: 1.5 }, now).ok);
  check('sql-ish injection in tag rejected', !validateDeath({ ...good, tag: "';-" }, now).ok);

  const goodF = { day: today, tag: 'MUN', time_ms: 61000 };
  check('valid finish accepted', validateFinish(goodF, now).ok);
  check('impossibly fast finish rejected (19.9s < 20s human floor)',
    !validateFinish({ ...goodF, time_ms: 19900 }, now).ok);
  check('absurd finish rejected', !validateFinish({ ...goodF, time_ms: 86400001 }, now).ok);
  check('fractional ms rejected', !validateFinish({ ...goodF, time_ms: 61000.5 }, now).ok);

  check('rate limit: 2nd death within 2s blocked', rateLimitDeath(now - 1500, 5, now) !== null);
  check('rate limit: death after 2s allowed', rateLimitDeath(now - 2500, 5, now) === null);
  check('rate limit: 200/day cap', rateLimitDeath(now - 60000, 200, now) !== null);
  check('rate limit: first death ever allowed', rateLimitDeath(null, 0, now) === null);
  check('tag normalizer pads/uppercases', normalizeTag('ab') === 'ABA' && normalizeTag('!!') === 'AAA'
    && normalizeTag('xyz') === 'XYZ');
}

console.log('M4: shared Deno copies must not drift');
{
  for (const f of ['codec.ts', 'validate.ts']) {
    const a = readFileSync(`src/net/${f}`, 'utf8').replace(/\r\n/g, '\n');
    const b = readFileSync(`supabase/functions/_shared/${f}`, 'utf8').replace(/\r\n/g, '\n');
    check(`src/net/${f} === supabase/functions/_shared/${f}`, a === b);
  }
}

if (failures) { console.error(`\nM4: ${failures} FAILURES`); process.exit(1); }
console.log('\nM4: all checks passed');
