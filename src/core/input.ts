// Keyboard + touch input -> SimInput. Edge states are consumed once per read.

import type { SimInput } from '../game/sim';

export class Input {
  private held = new Set<string>();
  private pressed = new Set<string>();
  // touch zones
  private touchLeft = false;
  private touchRight = false;
  private touchJump = false;
  private touchJumpPressed = false;
  isTouch = false;

  constructor() {
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = norm(e.key);
      if (!k) return;
      e.preventDefault();
      this.held.add(k);
      this.pressed.add(k);
    });
    addEventListener('keyup', (e) => {
      const k = norm(e.key);
      if (k) this.held.delete(k);
    });
    addEventListener('blur', () => this.held.clear());
  }

  attachTouch(el: HTMLElement): void {
    const zones = (t: Touch) => {
      const w = innerWidth;
      const x = t.clientX / w;
      const y = t.clientY / innerHeight;
      if (y < 0.35) return; // top of screen = UI, not controls
      if (x < 0.22) this.touchLeft = true;
      else if (x < 0.44) this.touchRight = true;
      else {
        if (!this.touchJump) this.touchJumpPressed = true;
        this.touchJump = true;
      }
    };
    const recompute = (e: TouchEvent) => {
      const wasJump = this.touchJump;
      this.touchLeft = this.touchRight = this.touchJump = false;
      for (let i = 0; i < e.touches.length; i++) zones(e.touches[i]);
      if (this.touchJump && !wasJump) this.touchJumpPressed = true;
      if (e.touches.length > 0) this.isTouch = true;
    };
    for (const evName of ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const) {
      el.addEventListener(evName, (e) => {
        recompute(e as TouchEvent);
        if (evName === 'touchstart') (e as TouchEvent).preventDefault?.();
      }, { passive: evName !== 'touchstart' });
    }
  }

  /** Read current state; press-edges are cleared after this call. */
  read(): SimInput {
    const s: SimInput = {
      left: this.held.has('left') || this.touchLeft,
      right: this.held.has('right') || this.touchRight,
      jump: this.held.has('jump') || this.touchJump,
      jumpPressed: this.pressed.has('jump') || this.touchJumpPressed,
      restartPressed: this.pressed.has('restart'),
      sacrificePressed: this.pressed.has('sacrifice'),
    };
    this.pressed.clear();
    this.touchJumpPressed = false;
    return s;
  }
}

function norm(key: string): string | null {
  switch (key) {
    case 'ArrowLeft': case 'a': case 'A': return 'left';
    case 'ArrowRight': case 'd': case 'D': return 'right';
    case ' ': case 'ArrowUp': case 'w': case 'W': return 'jump';
    case 'r': case 'R': return 'restart';
    case 'x': case 'X': return 'sacrifice';
    default: return null;
  }
}
