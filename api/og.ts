// Dynamic OG image: today's death count + corpse heatmap skyline.
// The link preview itself changes as the day's carnage accumulates.
import { ImageResponse } from '@vercel/og';
import { unpackCorpses } from '../src/net/codec';

export const config = { runtime: 'edge' };

// satori accepts plain React-shaped object trees; no JSX/react dep needed
type El = { type: string; props: Record<string, unknown> };
function h(type: string, style: Record<string, unknown>, ...children: (El | string)[]): El {
  return { type, props: { style, children: children.length === 1 ? children[0] : children } };
}

const BINS = 60;

export default async function handler(): Promise<Response> {
  const day = new Date().toISOString().slice(0, 10);
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const dayLabel = `${months[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}`;

  let deaths = 0;
  let bins = new Array<number>(BINS).fill(0);
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (url && anon) {
    try {
      const res = await fetch(`${url}/functions/v1/snapshot?day=${day}`, {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
      });
      if (res.ok) {
        const list = unpackCorpses(await res.arrayBuffer());
        deaths = Number(res.headers.get('X-Total-Count') ?? list.length);
        for (const c of list) {
          const b = Math.max(0, Math.min(BINS - 1, Math.floor((c.x / 3200) * BINS)));
          bins[b]++;
        }
        const max = Math.max(1, ...bins);
        bins = bins.map((v) => v / max);
      }
    } catch {
      /* render the static variant */
    }
  }

  const bars = bins.map((b, i) =>
    h('div', {
      width: 16,
      height: 8 + b * 240,
      background: b > 0.55 ? '#8c1f28' : '#232735',
      marginRight: 4,
    }),
  );

  const img = h(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: '#0b0d12',
      padding: 60,
      fontFamily: 'monospace',
    },
    h('div', { display: 'flex', fontSize: 84, fontWeight: 700, color: '#e8ebf4', letterSpacing: 6 }, 'DEADLINE'),
    h(
      'div',
      { display: 'flex', fontSize: 30, color: '#c93b4b', marginTop: 8 },
      `${dayLabel} — THIS WORLD ENDS AT MIDNIGHT UTC`,
    ),
    h(
      'div',
      { display: 'flex', fontSize: 44, color: '#b8ff2e', marginTop: 24 },
      deaths > 0 ? `${deaths.toLocaleString('en-US')} CORPSES AND COUNTING` : 'ONE LEVEL. EVERYONE. EVERY DEATH STAYS.',
    ),
    h(
      'div',
      { display: 'flex', alignItems: 'flex-end', height: 260, marginTop: 'auto' },
      ...bars,
    ),
    h('div', { display: 'flex', height: 4, background: '#39415a' }),
    h(
      'div',
      { display: 'flex', fontSize: 24, color: '#7a8194', marginTop: 14 },
      'their bodies are the level. bring yours.',
    ),
  );

  return new ImageResponse(img as never, {
    width: 1200,
    height: 630,
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=600, stale-while-revalidate=3600',
    },
  });
}
