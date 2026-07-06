// Fixed-timestep loop: 120hz sim, interpolated render, accumulator with spiral-of-death guard.

import { SIM_DT } from '../config';

export interface LoopHooks {
  tick(): void; // fixed step
  render(alpha: number): void; // alpha = interpolation [0,1)
}

export function startLoop(hooks: LoopHooks): () => void {
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let stopped = false;
  // hit-stop support: freeze sim for N ms while still rendering
  const frame = (now: number) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // tab was backgrounded; don't simulate the gap
    acc += dt * timeScale;
    let steps = 0;
    while (acc >= SIM_DT && steps < 40) {
      hooks.tick();
      acc -= SIM_DT;
      steps++;
    }
    if (steps >= 40) acc = 0;
    hooks.render(acc / SIM_DT);
  };
  let timeScale = 1;
  raf = requestAnimationFrame(frame);
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
  return stop;
}

/** Global hit-stop: pause sim ticks for ms (render keeps going). */
let hitStopUntil = 0;
export function hitStop(ms: number): void {
  hitStopUntil = performance.now() + ms;
}
export function inHitStop(): boolean {
  return performance.now() < hitStopUntil;
}
