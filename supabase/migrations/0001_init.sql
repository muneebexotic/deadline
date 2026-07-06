-- DEADLINE schema. Old day_keys are never deleted: they are history.

create table public.corpses (
  id bigint generated always as identity primary key,
  day_key text not null,
  x integer not null,
  y integer not null,
  rot smallint not null default 0,          -- quantized 0..255
  pose smallint not null default 0,         -- 0..5
  cause smallint not null default 0,        -- 0..4 (Impaled/Crushed/Vaporized/Shattered/Sacrificed)
  tag text not null check (tag ~ '^[A-Z0-9]{3}$'),
  ip_hash text,                             -- salted sha256, for rate limiting only
  created_at timestamptz not null default now()
);
create index corpses_day_id_idx on public.corpses (day_key, id);
create index corpses_ip_idx on public.corpses (ip_hash, created_at desc);

create table public.finishes (
  id bigint generated always as identity primary key,
  day_key text not null,
  tag text not null check (tag ~ '^[A-Z0-9]{3}$'),
  time_ms integer not null check (time_ms between 1 and 86400000),
  ip_hash text,
  created_at timestamptz not null default now()
);
create index finishes_day_time_idx on public.finishes (day_key, time_ms);

-- RLS: reads public, writes only through edge functions (service role bypasses RLS).
alter table public.corpses enable row level security;
alter table public.finishes enable row level security;
create policy corpses_public_read on public.corpses for select using (true);
create policy finishes_public_read on public.finishes for select using (true);
-- no insert/update/delete policies exist on purpose

-- keep ip_hash out of anonymous reads (column-level privileges)
revoke select on public.corpses from anon, authenticated;
grant select (id, day_key, x, y, rot, pose, cause, tag, created_at) on public.corpses to anon, authenticated;
revoke select on public.finishes from anon, authenticated;
grant select (id, day_key, tag, time_ms, created_at) on public.finishes to anon, authenticated;

-- per-day stats for the archive page + OG images
create view public.day_stats as
select
  c.day_key,
  count(*)::bigint as corpse_count,
  coalesce((select count(*) from public.finishes f where f.day_key = c.day_key), 0)::bigint as finish_count,
  (select min(f.time_ms) from public.finishes f where f.day_key = c.day_key) as best_time_ms
from public.corpses c
group by c.day_key;

grant select on public.day_stats to anon, authenticated;
