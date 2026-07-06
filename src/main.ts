// DEADLINE boot: today's world, everyone's corpses, one deadline.

import { TILE, LEVEL_W, LEVEL_H, VIEW_W, P_W, CAUSES, PAL, type CauseId } from './config';
import { dayKey, dayMs, msUntilMidnightUtc, makeRng } from './core/rng';
import { generateDailyLevel } from './game/levelgen';
import { tileAt, T_SOLID, T_SPIKE, type Level } from './game/level';
import { Game, IDLE_INPUT, type SimInput } from './game/sim';
import { Input } from './core/input';
import { startLoop, hitStop, inHitStop } from './core/loop';
import { Renderer } from './render/render';
import { Fx } from './fx/fx';
import { Sound } from './core/audio';
import { Net, type DeathEvent } from './net/net';
import { Hud } from './ui/hud';
import {
  emojiLine, heatmapBins, renderShareCard, copyCanvasPng, copyText,
  loadTag, saveTag, recordPlayed, loadMute, saveMute, siteUrl, fmtDayShort, fmtInt,
} from './ui/share';

// dev-only: preview any day's layout with ?day=YYYY-MM-DD (stripped from production
// builds by Vite's DEV flag; the server would reject submissions for a non-today day anyway)
const devEnv = (import.meta as unknown as { env?: Record<string, unknown> }).env;
const dayParam = new URLSearchParams(location.search).get('day');
const today =
  devEnv?.DEV && dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : dayKey();
if (today !== dayKey()) {
  console.warn(`[dev] previewing ${today} instead of ${dayKey()} — deaths/finishes won't persist`);
}
const { level } = generateDailyLevel(today);
const game = new Game(level, dayMs());
const input = new Input();
const fx = new Fx();
const sound = new Sound(loadMute());
const net = new Net();
const canvas = document.getElementById('game') as HTMLCanvasElement;
const renderer = new Renderer(canvas, game, fx);
input.attachTouch(document.body);

// ---------- session state ----------
let tag = loadTag();
let streak = 0;
let sessionBestX = 0;
let myCorpseNumber: number | null = null;
let myCorpseX: number | null = null;
let myFinish: { timeMs: number; rank: number } | null = null;
let prevState = game.state;
game.tag = tag ?? 'AAA';

function causeTextFor(cause: CauseId, x: number): string {
  if (cause === 1 || cause === 2) {
    const kind = cause === 1 ? 'crusher' : 'laser';
    let best = 0;
    let bestD = Infinity;
    for (const h of level.hazards) {
      if (h.kind !== kind) continue;
      const d = Math.abs(h.tx * TILE - x);
      if (d < bestD) { bestD = d; best = h.index; }
    }
    return cause === 1 ? `Crushed by Crusher #${best}` : `Vaporized by Laser #${best}`;
  }
  return cause === 4 ? 'Sacrificed for the pile' : CAUSES[cause];
}

function progressFrac(): number {
  return Math.max(0, Math.min(1, sessionBestX / level.goalX));
}

function currentEmoji(): string {
  return emojiLine(today, progressFrac(), myCorpseNumber, myFinish, streak);
}

// ---------- HUD ----------
const hud = new Hud(
  {
    onTagChosen(t) {
      tag = t;
      game.tag = t;
      saveTag(t);
      streak = recordPlayed(today);
      sound.init();
      if (streak > 1) hud.toast(`${streak} day streak`);
    },
    onRestart() {
      game.restart();
      hud.hideDeath();
      hud.hideFinish();
    },
    onShareCard() {
      const xs = game.corpses.xs.subarray(0, game.corpses.count);
      const card = renderShareCard({
        dayKey: today,
        bins: heatmapBins(xs, 60),
        deathsToday: net.deathsToday || game.corpses.count,
        myX: myCorpseX,
        corpseNumber: myCorpseNumber,
        finish: myFinish,
        progressFrac: progressFrac(),
        streak,
        tag: tag ?? 'AAA',
      });
      void copyCanvasPng(card).then((ok) => hud.toast(ok ? 'share card copied' : 'copy failed'));
    },
    onShareText() {
      void copyText(`${currentEmoji()}\n${siteUrl()}`).then((ok) =>
        hud.toast(ok ? 'result copied' : 'copy failed'),
      );
    },
    onToggleMute() {
      const m = !sound.isMuted();
      sound.setMuted(m);
      saveMute(m);
      return m;
    },
    onSpectate() {
      renderer.fixedCam = {
        x: level.wallX * TILE - VIEW_W * 0.55,
        y: level.wallTopY * TILE - 110,
      };
      hud.toast('watching the wall. bodies welcome.');
    },
    onPlay() {
      renderer.fixedCam = null;
    },
    onArchive() {
      void net.fetchArchive().then((days) => {
        hud.showArchive(days, (day, cv) => {
          void net.fetchDaySnapshot(day).then((list) => {
            const g = cv.getContext('2d');
            if (!g) return;
            const bins = heatmapBins(list.map((c) => c.x), 80);
            g.fillStyle = '#10131c';
            g.fillRect(0, 0, cv.width, cv.height);
            const bw = cv.width / bins.length;
            g.fillStyle = PAL.blood;
            bins.forEach((b, i) => {
              const h = 2 + b * (cv.height - 4);
              g.fillRect(i * bw, cv.height - h, bw - 1, h);
            });
          });
        });
      });
    },
  },
  sound.isMuted(),
);

// ---------- game events ----------
game.events = {
  onDeath(d) {
    fx.burst(d.x, d.y, 26, PAL.bloodBright, 150);
    fx.shake(5);
    hitStop(60);
    sound.death();
    sessionBestX = Math.max(sessionBestX, game.player.maxX);
    myFinish = null;
    myCorpseNumber = (net.deathsToday || game.corpses.count) + 1;
    hud.pushTicker(tag ?? 'AAA', d.causeText);
  },
  onFinish(timeMs) {
    sound.finish();
    fx.burst(game.player.x + P_W / 2, game.player.y, 40, PAL.goal, 180);
    sessionBestX = level.goalX;
    void (async () => {
      const res = await net.sendFinish(tag ?? 'AAA', timeMs);
      myFinish = { timeMs, rank: res?.rank ?? net.finishersToday };
      const leaders = await net.fetchLeaderboard(today);
      hud.showFinish(timeMs, res?.rank ?? null, leaders, tag ?? 'AAA', currentEmoji());
    })();
  },
  onJump: () => sound.jump(),
  onLand: () => {
    sound.land();
    fx.shake(0.8);
    fx.burst(game.player.x + P_W / 2, game.player.y + 14, 4, PAL.dim, 40, 300, 0.25);
  },
  onCollapse: () => sound.collapse(),
};

game.corpses.onFroze = (idx, mine) => {
  if (!mine) return;
  myCorpseX = game.corpses.xs[idx];
  const ev: DeathEvent = {
    x: game.corpses.xs[idx],
    y: game.corpses.ys[idx],
    rot: game.corpses.rots[idx],
    pose: game.corpses.poses[idx],
    cause: game.corpses.causes[idx],
    tag: tag ?? 'AAA',
    t: Date.now(),
  };
  void net.sendDeath(ev).then((n) => {
    if (n > 0) myCorpseNumber = n;
  });
};

// ---------- network events ----------
net.onDeath = (d) => {
  game.corpses.addFrozen({ x: d.x, y: d.y, rot: d.rot, pose: d.pose, tag: d.tag, cause: d.cause as CauseId, t: d.t });
  hud.pushTicker(d.tag, causeTextFor(d.cause as CauseId, d.x), d.t);
  sound.remoteDeath();
  fx.burst(d.x, d.y, 6, PAL.blood, 60);
};
net.onFinish = (f) => hud.pushTickerFinish(f.tag, f.time_ms);
net.onPos = (ghostTag, x, y) => {
  if (ghostTag !== tag) renderer.ghosts.set(ghostTag, { x, y, t: performance.now() });
};
net.onCounts = () => hud.setCounters(net.deathsToday, net.finishersToday, net.playersNow, !net.online);

// snapshot load (subscribes to deltas first internally)
void net.init(today).then((list) => {
  for (const c of list) {
    game.corpses.addFrozen({
      x: c.x, y: c.y, rot: c.rot, pose: c.pose, tag: c.tag,
      cause: c.cause as CauseId, t: Date.parse(`${today}T00:00:00Z`) + c.tSec * 1000,
    });
  }
  // seed the ticker with the freshest deaths
  const recent = [...list].sort((a, b) => b.tSec - a.tSec).slice(0, 4).reverse();
  const dayStart = Date.parse(`${today}T00:00:00Z`);
  for (const c of recent) {
    hud.pushTicker(c.tag, causeTextFor(c.cause as CauseId, c.x), dayStart + c.tSec * 1000);
  }
  hud.setCounters(net.deathsToday, net.finishersToday, net.playersNow, !net.online);
});

// ---------- perf harness: ?corpses=100000 scatters fake bodies (offline testing) ----------
{
  const n = Number(new URLSearchParams(location.search).get('corpses') ?? 0);
  if (n > 0) {
    const rng = makeRng('perf');
    console.time(`scatter ${n} corpses`);
    for (let i = 0; i < n; i++) {
      const tx = 1 + Math.floor(rng.next() * (LEVEL_W - 2));
      let ty = 0;
      while (ty < LEVEL_H - 1 && tileAt(level, tx, ty) !== T_SOLID && tileAt(level, tx, ty) !== T_SPIKE) ty++;
      game.corpses.addFrozen({
        x: tx * TILE + rng.next() * TILE,
        y: ty * TILE - 3 - rng.next() * 40,
        rot: rng.next() * 6.28,
        pose: Math.floor(rng.next() * 6),
        tag: 'SIM',
        cause: 0,
        t: Date.now(),
      });
    }
    console.timeEnd(`scatter ${n} corpses`);
  }
}

// ---------- boot UI ----------
hud.setCounters(0, 0, 0, !net.online);
hud.showTagPicker(tag, net.deathsToday);
addEventListener('pointerdown', () => sound.init(), { once: true });
addEventListener('keydown', () => sound.init(), { once: true });

// touch hint zones on coarse pointers
if (matchMedia('(pointer: coarse)').matches) {
  (document.getElementById('touch') as HTMLElement).style.display = 'block';
}

// countdown + midnight reset (disabled while previewing another day)
setInterval(() => {
  const left = msUntilMidnightUtc();
  hud.setCountdown(left);
  if (left < 1200 && today === dayKey()) location.reload(); // the world ends
}, 1000);

// corpse inspection: hover/tap shows tag + cause + time
canvas.addEventListener('pointermove', (e) => {
  const [wx, wy] = renderer.screenToWorld(e.clientX, e.clientY);
  const i = game.corpses.corpseAt(wx, wy, 12);
  if (i >= 0) {
    const t = new Date(game.corpses.times[i]);
    const hh = String(t.getUTCHours()).padStart(2, '0');
    const mm = String(t.getUTCMinutes()).padStart(2, '0');
    canvas.title = `${game.corpses.tags[i]} — ${causeTextFor(game.corpses.causes[i] as CauseId, game.corpses.xs[i])} at ${hh}:${mm} UTC`;
  } else canvas.title = '';
});

// ---------- main loop ----------
let droneTimer = 0;
startLoop({
  tick() {
    if (inHitStop()) return;
    const raw = input.read();
    let simIn: SimInput;
    if (hud.spectating || hud.anyOverlayOpen()) {
      // typing a tag / reading an overlay: only restart passes through (R = instant next run)
      simIn = { ...IDLE_INPUT, restartPressed: !hud.spectating && raw.restartPressed && game.state !== 'alive' };
    } else {
      simIn = raw;
    }
    game.step(simIn);
    fx.step(1 / 120);

    // state transitions drive overlays
    if (prevState !== game.state) {
      if (game.state === 'dead' && game.lastDeath) {
        hud.showDeath(game.lastDeath.causeText, myCorpseNumber ?? 1, currentEmoji());
      }
      if (game.state === 'alive') {
        hud.hideDeath();
        hud.hideFinish();
      }
      prevState = game.state;
    }

    // spectate feed: broadcast my position while attacking the wall
    if (game.state === 'alive' && level.wallX > 0 && Math.abs(game.player.x - level.wallX * TILE) < 30 * TILE) {
      net.sendPos(tag ?? 'AAA', game.player.x, game.player.y);
    }

    if (++droneTimer >= 120) {
      droneTimer = 0;
      sound.setDroneIntensity(Math.min(1, game.corpses.count / 20000));
    }
  },
  render(alpha) {
    renderer.render(alpha);
    hud.setRunTimer(game.runMs, game.runStarted && game.state === 'alive');
  },
});

console.log(
  `%cDEADLINE %c${fmtDayShort(today)} · corpse threshold ${level.corpseThreshold} · ${fmtInt(net.deathsToday)} dead`,
  `color:${PAL.player};font-weight:bold`,
  'color:#7a8194',
);
