// GET /snapshot?day=YYYY-MM-DD
// Returns the day's corpses as a binary-packed array (13 bytes each), CDN-cached 10s.
import { packCorpses, type PackedCorpse } from '../_shared/codec.ts';
import { DAY_RE } from '../_shared/validate.ts';
import { CORS, json, options, serviceClient } from '../_shared/common.ts';

const PAGE = 1000;
const MAX_CORPSES = 120000; // snapshot cap on a viral day; deltas cover the rest

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return options();
  const url = new URL(req.url);
  const day = url.searchParams.get('day') ?? '';
  if (!DAY_RE.test(day)) return json({ error: 'bad day' }, 400);

  const db = serviceClient();
  const { count, error: countErr } = await db
    .from('corpses')
    .select('id', { count: 'exact', head: true })
    .eq('day_key', day);
  if (countErr) return json({ error: countErr.message }, 500);

  const total = Math.min(count ?? 0, MAX_CORPSES);
  const pages = Math.ceil(total / PAGE);
  const dayStartMs = Date.parse(`${day}T00:00:00Z`);

  const results = await Promise.all(
    Array.from({ length: pages }, (_, p) =>
      db
        .from('corpses')
        .select('x,y,rot,pose,cause,tag,created_at')
        .eq('day_key', day)
        .order('id', { ascending: true })
        .range(p * PAGE, Math.min((p + 1) * PAGE, total) - 1),
    ),
  );

  const corpses: PackedCorpse[] = [];
  for (const r of results) {
    if (r.error) return json({ error: r.error.message }, 500);
    for (const row of r.data ?? []) {
      corpses.push({
        x: row.x,
        y: row.y,
        rot: row.rot,
        pose: row.pose,
        cause: row.cause,
        tag: row.tag,
        tSec: Math.max(0, Math.floor((Date.parse(row.created_at) - dayStartMs) / 1000)),
      });
    }
  }

  const packed = packCorpses(corpses);
  return new Response(packed, {
    headers: {
      ...CORS,
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'public, max-age=10, s-maxage=10',
      'X-Total-Count': String(count ?? 0),
    },
  });
});
