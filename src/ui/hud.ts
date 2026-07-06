// DOM HUD: counters, death ticker, countdown, overlays (tag / death / finish / archive).
// The canvas renders the world; everything textual lives here.

import { CAUSES, PAL } from '../config';
import { fmtInt, fmtTime, fmtDayShort } from './share';

export interface HudCallbacks {
  onTagChosen(tag: string): void;
  onRestart(): void;
  onShareCard(): void;
  onShareText(): void;
  onToggleMute(): boolean; // returns new muted state
  onSpectate(): void;
  onPlay(): void;
  onArchive(): void;
}

interface TickerEntry {
  text: string;
  t: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export class Hud {
  private cb: HudCallbacks;
  private ticker: TickerEntry[] = [];
  private counters = $('counters');
  private tickerEl = $('ticker');
  private timerEl = $('run-timer');
  private countdownEl = $('countdown');
  private btns = $('corner-btns');
  private ovTag = $('ov-tag');
  private ovDeath = $('ov-death');
  private ovFinish = $('ov-finish');
  private ovArchive = $('ov-archive');
  private toastEl = $('toast');
  private toastTimer = 0;
  spectating = false;

  constructor(cb: HudCallbacks, muted: boolean) {
    this.cb = cb;
    this.btns.innerHTML = '';
    const mk = (label: string, fn: () => void): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = fn;
      this.btns.appendChild(b);
      return b;
    };
    const muteBtn = mk(muted ? '🔇' : '🔊', () => {
      muteBtn.textContent = this.cb.onToggleMute() ? '🔇' : '🔊';
    });
    const specBtn = mk('👁 wall', () => {
      this.spectating = !this.spectating;
      specBtn.textContent = this.spectating ? '🎮 play' : '👁 wall';
      if (this.spectating) this.cb.onSpectate();
      else this.cb.onPlay();
    });
    mk('🗂 past days', () => this.cb.onArchive());
    setInterval(() => this.renderTicker(), 1000);
  }

  setCounters(deaths: number, finishers: number, online: number, offline: boolean): void {
    this.counters.innerHTML =
      `<b>${fmtInt(deaths)}</b> dead today · <b>${fmtInt(finishers)}</b> escaped` +
      (offline ? ' · <span style="color:#7a2a33">OFFLINE</span>' : ` · <b>${fmtInt(Math.max(1, online))}</b> here now`);
  }

  setRunTimer(ms: number, visible: boolean): void {
    this.timerEl.textContent = visible ? fmtTime(ms) : '';
  }

  pushTicker(tag: string, causeText: string, t = Date.now()): void {
    this.ticker.unshift({ text: `${tag} · ${causeText}`, t });
    this.ticker = this.ticker.slice(0, 5);
    this.renderTicker();
  }

  pushTickerFinish(tag: string, timeMs: number): void {
    this.ticker.unshift({ text: `🏁 ${tag} FINISHED ${fmtTime(timeMs)}`, t: Date.now() });
    this.ticker = this.ticker.slice(0, 5);
    this.renderTicker();
  }

  private renderTicker(): void {
    const now = Date.now();
    this.tickerEl.innerHTML = this.ticker
      .map((e, i) => {
        const ago = Math.max(0, Math.round((now - e.t) / 1000));
        const agoTxt = ago < 3 ? 'just now' : ago < 60 ? `${ago}s ago` : `${Math.floor(ago / 60)}m ago`;
        return `<div class="${i === 0 && ago < 4 ? 'fresh' : ''}">${esc(e.text)}, ${agoTxt}</div>`;
      })
      .join('');
  }

  setCountdown(msLeft: number): void {
    if (msLeft > 600000) {
      this.countdownEl.style.display = 'none';
      return;
    }
    const m = Math.floor(msLeft / 60000);
    const s = Math.floor((msLeft % 60000) / 1000);
    this.countdownEl.style.display = 'block';
    this.countdownEl.textContent = `THIS WORLD ENDS IN ${m}:${String(s).padStart(2, '0')}`;
  }

  toast(msg: string): void {
    this.toastEl.textContent = msg;
    this.toastEl.style.opacity = '1';
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toastEl.style.opacity = '0'), 1600);
  }

  // ---------- overlays ----------

  showTagPicker(existing: string | null, deathsToday: number): void {
    this.ovTag.innerHTML = `
      <div class="panel">
        <h1>DEADLINE</h1>
        <div class="sub">one level for the whole planet, regenerated at midnight UTC.<br>
        every death drops a permanent corpse — for everyone.<br>
        <b style="color:${PAL.text}">${fmtInt(deathsToday)}</b> have died here today. walk on them.</div>
        <input id="tag-input" maxlength="3" placeholder="AAA" autocomplete="off" spellcheck="false"
               value="${existing ?? ''}" />
        <div class="sub" style="margin-top:8px">pick your 3-letter tag</div>
        <button class="primary" id="tag-go">DESCEND</button>
        <div class="sub" style="margin-top:10px">← → / A D move · SPACE jump · R restart · X sacrifice yourself</div>
      </div>`;
    this.ovTag.classList.add('open');
    const input = $('tag-input') as HTMLInputElement;
    const go = () => {
      const tag = (input.value.toUpperCase().replace(/[^A-Z0-9]/g, '') + 'AAA').slice(0, 3);
      this.ovTag.classList.remove('open');
      this.cb.onTagChosen(tag);
    };
    $('tag-go').onclick = go;
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') go();
    };
    input.focus();
  }

  showDeath(causeText: string, corpseNumber: number, emoji: string): void {
    this.ovDeath.innerHTML = `
      <div class="panel">
        <h2>${esc(causeText.toUpperCase())}.</h2>
        <div class="big">You are corpse <b>#${fmtInt(corpseNumber)}</b> today.<br>
        Your body is now part of the level. For everyone. Forever*.</div>
        <div class="sub">${esc(emoji)}</div>
        <button class="primary" id="death-restart">RISE AGAIN (R)</button><br>
        <button id="death-share-img">📋 copy share card</button>
        <button id="death-share-txt">💀 copy result</button>
        <div class="sub" style="margin-top:8px">*until midnight UTC</div>
      </div>`;
    this.ovDeath.classList.add('open');
    $('death-restart').onclick = () => this.cb.onRestart();
    $('death-share-img').onclick = () => this.cb.onShareCard();
    $('death-share-txt').onclick = () => this.cb.onShareText();
    // zero-friction mobile restart: tap anywhere that isn't a button
    this.ovDeath.onclick = (e) => {
      if ((e.target as HTMLElement).tagName !== 'BUTTON') this.cb.onRestart();
    };
    this.ovDeath.style.pointerEvents = 'auto';
  }

  hideDeath(): void {
    this.ovDeath.classList.remove('open');
  }

  showFinish(timeMs: number, rank: number | null, leaders: { tag: string; time_ms: number }[], myTag: string, emoji: string): void {
    const lb = leaders.length
      ? `<div id="lb">${leaders
          .map((l, i) => `<div class="${l.tag === myTag ? 'me' : ''}"><span>#${i + 1} ${esc(l.tag)}</span><span>${fmtTime(l.time_ms)}</span></div>`)
          .join('')}</div>`
      : '';
    this.ovFinish.innerHTML = `
      <div class="panel">
        <h2 style="color:${PAL.goal}">YOU ESCAPED</h2>
        <div class="big">${fmtTime(timeMs)}${rank ? ` · finisher <b>#${fmtInt(rank)}</b> today` : ''}</div>
        <div class="sub">${esc(emoji)}</div>
        ${lb}
        <button class="primary" id="fin-again">RUN IT AGAIN (R)</button><br>
        <button id="fin-share-img">📋 copy share card</button>
        <button id="fin-share-txt">🏁 copy result</button>
      </div>`;
    this.ovFinish.classList.add('open');
    $('fin-again').onclick = () => this.cb.onRestart();
    $('fin-share-img').onclick = () => this.cb.onShareCard();
    $('fin-share-txt').onclick = () => this.cb.onShareText();
  }

  hideFinish(): void {
    this.ovFinish.classList.remove('open');
  }

  showArchive(
    days: { day_key: string; corpse_count: number; finish_count: number; best_time_ms: number | null }[],
    loadHeatmap: (day: string, canvas: HTMLCanvasElement) => void,
  ): void {
    const rows = days.length
      ? days
          .map(
            (d, i) => `
        <div class="day" data-day="${d.day_key}">
          <b>${fmtDayShort(d.day_key)}</b> · ${fmtInt(Number(d.corpse_count))} corpses ·
          ${fmtInt(Number(d.finish_count))} escaped${d.best_time_ms ? ` · best ${fmtTime(d.best_time_ms)}` : ''}
          <canvas id="arch-${i}" width="400" height="48"></canvas>
        </div>`,
          )
          .join('')
      : '<div class="sub">no history yet (offline or day one)</div>';
    this.ovArchive.innerHTML = `
      <div class="panel">
        <h2>DEAD WORLDS</h2>
        <div class="sub">every past day, preserved. click a day to load its final heatmap.</div>
        <div id="archive-list">${rows}</div>
        <button class="primary" id="arch-close">BACK TO TODAY</button>
      </div>`;
    this.ovArchive.classList.add('open');
    $('arch-close').onclick = () => this.ovArchive.classList.remove('open');
    document.querySelectorAll<HTMLElement>('#archive-list .day').forEach((el, i) => {
      el.onclick = () => {
        const cv = document.getElementById(`arch-${i}`) as HTMLCanvasElement;
        if (cv && !cv.dataset.loaded) {
          cv.dataset.loaded = '1';
          loadHeatmap(el.dataset.day!, cv);
        }
      };
    });
  }

  anyOverlayOpen(): boolean {
    return [this.ovTag, this.ovDeath, this.ovFinish, this.ovArchive].some((o) =>
      o.classList.contains('open'),
    );
  }
}

export function causeShort(cause: number, causeText: string): string {
  return causeText || CAUSES[cause] || 'died';
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
