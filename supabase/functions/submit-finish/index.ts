// POST /submit-finish  { day, tag, time_ms }
// Sanity-checks the time (>= minimum humanly possible), persists, returns rank.
import { validateFinish } from '../_shared/validate.ts';
import { json, options, serviceClient, ipHash, broadcast } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const v = validateFinish(body, Date.now());
  if (!v.ok) return json({ error: v.error }, 400);

  const db = serviceClient();
  const hash = await ipHash(req);

  // light abuse guard: max 30 finishes per IP per day
  const { count: mine } = await db
    .from('finishes')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', hash)
    .eq('day_key', v.body.day);
  if ((mine ?? 0) >= 30) return json({ error: 'enough glory for one day' }, 429);

  const { error } = await db.from('finishes').insert({
    day_key: v.body.day,
    tag: v.body.tag,
    time_ms: v.body.time_ms,
    ip_hash: hash,
  });
  if (error) return json({ error: error.message }, 500);

  const [{ count: better }, { count: total }] = await Promise.all([
    db
      .from('finishes')
      .select('id', { count: 'exact', head: true })
      .eq('day_key', v.body.day)
      .lt('time_ms', v.body.time_ms),
    db
      .from('finishes')
      .select('id', { count: 'exact', head: true })
      .eq('day_key', v.body.day),
  ]);

  const rank = (better ?? 0) + 1;
  await broadcast(v.body.day, 'finish', { tag: v.body.tag, time_ms: v.body.time_ms, rank });
  return json({ rank, total: total ?? 1 });
});
