// Particles + screen shake. Cheap pools, no allocation per frame.

export interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; color: string; size: number; grav: number;
}

const MAX_PARTICLES = 400;

export class Fx {
  particles: Particle[] = [];
  shakeAmp = 0;
  shakeT = 0;

  burst(x: number, y: number, n: number, color: string, speed = 120, grav = 500, life = 0.5): void {
    for (let i = 0; i < n && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - speed * 0.4,
        life: life * (0.5 + Math.random() * 0.5),
        maxLife: life,
        color,
        size: 1 + Math.random() * 2,
        grav,
      });
    }
  }

  shake(amp: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = 0;
  }

  step(dt: number): void {
    this.shakeT += dt;
    this.shakeAmp *= Math.pow(0.001, dt); // fast decay
    if (this.shakeAmp < 0.1) this.shakeAmp = 0;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  shakeOffset(): [number, number] {
    if (this.shakeAmp <= 0) return [0, 0];
    return [
      (Math.random() * 2 - 1) * this.shakeAmp,
      (Math.random() * 2 - 1) * this.shakeAmp,
    ];
  }
}
