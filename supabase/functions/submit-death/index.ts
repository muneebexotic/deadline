// POST /submit-death  { day, x, y, rot, pose, cause, tag }
// Validates bounds + rate limits by IP (1 death / 2s, 200 / day), then persists.
// Peers learn about the death via the client-side channel broadcast; this row is
// the durable record that the snapshot endpoint serves.
import { validateDeath, rateLimitDeath } from '../_shared/validate.ts';
import { json, options, serviceClient, ipHash } from '../_shared/common.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return options();
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const v = validateDeath(body, Date.now());
  if (!v.ok) return json({ error: v.error }, 400);

  const db = serviceClient();
  const hash = await ipHash(req);

  // rate limit: last death from this IP + today's total
  const [last, todayCount] = await Promise.all([
    db
      .from('corpses')
      .select('created_at')
      .eq('ip_hash', hash)
      .order('created_at', { ascending: false })
      .limit(1),
    db
      .from('corpses')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', hash)
      .eq('day_key', v.body.day),
  ]);
  const lastMs = last.data?.[0] ? Date.parse(last.data[0].created_at) : null;
  const limited = rateLimitDeath(lastMs, todayCount.count ?? 0, Date.now());
  if (limited) return json({ error: limited }, 429);

  const { error } = await db.from('corpses').insert({
    day_key: v.body.day,
    x: v.body.x,
    y: v.body.y,
    rot: v.body.rot,
    pose: v.body.pose,
    cause: v.body.cause,
    tag: v.body.tag,
    ip_hash: hash,
  });
  if (error) return json({ error: error.message }, 500);

  const { count } = await db
    .from('corpses')
    .select('id', { count: 'exact', head: true })
    .eq('day_key', v.body.day);

  return json({ corpseNumber: count ?? 0 });
});
