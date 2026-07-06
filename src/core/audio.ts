// Synthesized sound. No asset files: oscillators + noise buffers only.
// Ambient drone thickens as the corpse count rises.

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private droneGain: GainNode | null = null;
  private droneFilter: BiquadFilterNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  /** Must be called from a user gesture (autoplay policy). Idempotent. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctx();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ctx.destination);

    // white noise buffer for crunches
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // ambient drone: two detuned saws through a dark lowpass
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 120;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.012;
    for (const freq of [55, 55.7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = freq;
      o.connect(this.droneFilter);
      o.start();
    }
    this.droneFilter.connect(this.droneGain);
    this.droneGain.connect(this.master);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.02);
    }
  }
  isMuted(): boolean {
    return this.muted;
  }

  /** 0..1 — corpse density drives how thick the world hums. */
  setDroneIntensity(v: number): void {
    if (!this.ctx || !this.droneGain || !this.droneFilter) return;
    const t = this.ctx.currentTime;
    this.droneGain.gain.setTargetAtTime(0.012 + 0.05 * v, t, 0.5);
    this.droneFilter.frequency.setTargetAtTime(120 + 480 * v, t, 0.5);
  }

  private blip(type: OscillatorType, f0: number, f1: number, dur: number, vol: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private crunch(dur: number, vol: number, filterHz: number): void {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = filterHz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  jump(): void {
    this.blip('square', 190, 340, 0.09, 0.12);
  }
  land(): void {
    this.crunch(0.05, 0.1, 900);
  }
  death(): void {
    this.crunch(0.22, 0.5, 1400);
    this.blip('sawtooth', 130, 30, 0.3, 0.4);
  }
  remoteDeath(): void {
    this.crunch(0.08, 0.06, 700);
  }
  collapse(): void {
    this.crunch(0.12, 0.15, 500);
  }
  finish(): void {
    if (!this.ctx) return;
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => {
      setTimeout(() => this.blip('square', f, f, 0.14, 0.14), i * 90);
    });
  }
}
