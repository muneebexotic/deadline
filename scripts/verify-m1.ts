// M1 verification: movement feel invariants + full-level bot run, all headless.
import { SIM_DT, TILE, P_W, P_H, JUMP_VEL, GRAVITY } from '../src/config';
import { makePlayer, stepPlayer, type SolidQuery, type InputState } from '../src/game/player';
import { makeTestLevel } from '../src/game/level';
import { Game, IDLE_INPUT, type SimInput } from '../src/game/sim';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}
const inp = (o: Partial<InputState> = {}): InputState =>
  ({ left: false, right: false, jump: false, jumpPressed: false, ...o });
const sinp = (o: Partial<SimInput> = {}): SimInput => ({ ...IDLE_INPUT, ...o });

// ---- rig: floor at y=300, optional solid boxes ----
type Box = [number, number, number, number];
const world = (boxes: Box[]): SolidQuery => (x, y, w, h) => {
  if (y + h > 300) return true;
  for (const [bx, by, bw, bh] of boxes) {
    if (x < bx + bw && x + w > bx && y < by + bh && y + h > by) return true;
  }
  return false;
};
const groundY = 300 - P_H;

console.log('M1: physics invariants');
{
  // settle, then jump apex
  const p = makePlayer(100, groundY);
  const solid = world([]);
  for (let i = 0; i < 30; i++) stepPlayer(p, inp(), solid, SIM_DT);
  let minY = p.y;
  stepPlayer(p, inp({ jump: true, jumpPressed: true }), solid, SIM_DT);
  for (let i = 0; i < 200; i++) {
    stepPlayer(p, inp({ jump: true }), solid, SIM_DT);
    minY = Math.min(minY, p.y);
  }
  const apex = groundY - minY;
  const theory = (JUMP_VEL * JUMP_VEL) / (2 * GRAVITY);
  check(`jump apex ${apex.toFixed(1)}px (theory ${theory.toFixed(1)}) in (48,64) => 3-tile mount, not 4`,
    apex > 48 && apex < 64);

  // variable height: tap jump for one tick
  const p2 = makePlayer(100, groundY);
  for (let i = 0; i < 30; i++) stepPlayer(p2, inp(), solid, SIM_DT);
  stepPlayer(p2, inp({ jump: true, jumpPressed: true }), solid, SIM_DT);
  let minY2 = p2.y;
  for (let i = 0; i < 200; i++) {
    stepPlayer(p2, inp(), solid, SIM_DT);
    minY2 = Math.min(minY2, p2.y);
  }
  const tapApex = groundY - minY2;
  check(`tap-jump apex ${tapApex.toFixed(1)}px < 60% of full`, tapApex < apex * 0.6);
}

{
  // coyote: run off a ledge, jump 40ms later works; 120ms later doesn't
  const ledge: Box[] = [[0, 200, 400, 100]]; // ledge top at y=200, ends at x=400
  const solid: SolidQuery = (x, y, w, h) => {
    for (const [bx, by, bw, bh] of ledge) if (x < bx + bw && x + w > bx && y < by + bh && y + h > by) return true;
    return y + h > 600;
  };
  for (const [delayMs, expectJump] of [[40, true], [160, false]] as const) {
    const p = makePlayer(360, 200 - P_H);
    for (let i = 0; i < 30; i++) stepPlayer(p, inp(), solid, SIM_DT);
    // run right until airborne
    let ticks = 0;
    while (p.grounded && ticks++ < 500) stepPlayer(p, inp({ right: true }), solid, SIM_DT);
    const delayTicks = Math.round(delayMs / 1000 / SIM_DT);
    for (let i = 0; i < delayTicks; i++) stepPlayer(p, inp({ right: true }), solid, SIM_DT);
    const ev = stepPlayer(p, inp({ right: true, jump: true, jumpPressed: true }), solid, SIM_DT);
    check(`coyote ${delayMs}ms after ledge -> jumped=${ev.jumped} (want ${expectJump})`, ev.jumped === expectJump);
  }
}

{
  // jump buffer: press jump ~60ms before landing -> jumps on touchdown
  const solid = world([]);
  const p = makePlayer(100, groundY - 80); // falling from 80px up
  let jumped = false;
  let pressedAt = -1;
  for (let i = 0; i < 400; i++) {
    const airborne = !p.grounded;
    const dist = 300 - (p.y + P_H);
    const press = airborne && pressedAt < 0 && p.vy > 0 && dist < 25 && dist > 15; // ~60ms out at ~350px/s
    if (press) pressedAt = i;
    const ev = stepPlayer(p, inp({ jump: pressedAt >= 0, jumpPressed: press }), solid, SIM_DT);
    if (ev.jumped) { jumped = true; break; }
  }
  check('jump buffered before landing fires on touchdown', jumped);
}

{
  // gap clearance: 4-tile gap crossable with edge jump, 6-tile not
  for (const [gapTiles, expect] of [[4, true], [6, false]] as const) {
    const gapStart = 400;
    const gapPx = gapTiles * TILE;
    const solid: SolidQuery = (x, y, w, h) => {
      if (y + h <= 300) return false;
      // floor everywhere except the gap; pit is 3 tiles deep then floor
      const inGapCol = x + w > gapStart && x < gapStart + gapPx;
      if (!inGapCol) return true;
      return y + h > 300 + 3 * TILE;
    };
    const p = makePlayer(300, groundY);
    for (let i = 0; i < 30; i++) stepPlayer(p, inp(), solid, SIM_DT);
    let crossed = false;
    for (let i = 0; i < 1500; i++) {
      const nearEdge = p.grounded && p.x + P_W >= gapStart - 2;
      stepPlayer(p, inp({ right: true, jump: nearEdge || (!p.grounded && p.vy < 0), jumpPressed: nearEdge }), solid, SIM_DT);
      if (p.x > gapStart + gapPx + 10 && p.y <= groundY + 1) { crossed = true; break; }
      if (p.y > 300) break; // fell in
    }
    check(`${gapTiles}-tile gap crossed=${crossed} (want ${expect})`, crossed === expect);
  }
}

{
  // mount: 3-tile step yes, 4-tile step no
  for (const [tiles, expect] of [[3, true], [4, false]] as const) {
    const stepX = 400;
    const stepTop = 300 - tiles * TILE;
    const solid = world([[stepX, stepTop, 200, tiles * TILE]]);
    const p = makePlayer(320, groundY);
    for (let i = 0; i < 30; i++) stepPlayer(p, inp(), solid, SIM_DT);
    let mounted = false;
    for (let i = 0; i < 1200; i++) {
      const nearWall = p.grounded && p.x + P_W > stepX - 24;
      stepPlayer(p, inp({ right: true, jump: nearWall || !p.grounded, jumpPressed: nearWall }), solid, SIM_DT);
      if (p.y + P_H <= stepTop + 0.5 && p.x + P_W > stepX) { mounted = true; break; }
    }
    check(`${tiles}-tile ledge mounted=${mounted} (want ${expect})`, mounted === expect);
  }
}

console.log('M1: test level bot run');
{
  const level = makeTestLevel();
  level.hazards = []; // hazards tested separately; keep the movement run deterministic
  const game = new Game(level, 0);
  // greedy right-runner bot: jump at gaps and at walls
  const bot = (): SimInput => {
    const p = game.player;
    const aheadX = p.x + P_W + 4;
    const gapAhead = !game.solid(p.x + P_W + 1, p.y + P_H + 2, 6, 4) && p.grounded;
    const wallAhead = game.solid(aheadX, p.y + 2, 4, P_H - 4);
    const press = p.grounded && (gapAhead || wallAhead);
    return sinp({ right: true, jump: press || (!p.grounded && p.vy < 0), jumpPressed: press });
  };
  const maxTicks = 60 * 120; // 60s
  for (let i = 0; i < maxTicks && game.state === 'alive'; i++) game.step(bot());
  const maxTileX = Math.floor(game.player.maxX / TILE);
  check(`bot survives and reaches the wall (maxX tile ${maxTileX}, want >=118)`, game.state === 'alive' && maxTileX >= 118);
  check(`bot cannot pass the 7-tile wall solo (maxX tile ${maxTileX} < 122)`, maxTileX < 122);
}

{
  // spike death + corpse persists; restart works
  const level = makeTestLevel();
  level.hazards = [];
  const game = new Game(level, 0);
  let deathText = '';
  game.events.onDeath = (d) => { deathText = d.causeText; };
  // walk right into the first spike pit (dumb walk, no jump)
  for (let i = 0; i < 12 * 120 && game.state === 'alive'; i++) game.step(sinp({ right: true }));
  check(`walking into pit dies (${deathText})`, (game.state as string) !== 'alive' && deathText === 'Impaled');
  for (let i = 0; i < 3 * 120; i++) game.step(sinp()); // let ragdoll settle + freeze
  check('corpse froze into store', game.corpses.count === 1 && game.corpses.ragdolls.length === 0);
  check('corpse is a solid collider somewhere in the pit',
    game.corpses.colliderCount === 1 && game.corpses.xs[0] > 30 * TILE && game.corpses.xs[0] < 35 * TILE);
  game.step(sinp({ restartPressed: true }));
  check('restart returns to spawn alive', game.state === 'alive' && game.player.x === level.spawnX);
}

{
  // crusher + laser kill checks (clock-phased)
  const level = makeTestLevel();
  const game = new Game(level, 0);
  const crusher = level.hazards.find((h) => h.kind === 'crusher')!;
  // park the player inside the crusher column at ground level, scan a full period for a kill
  game.player.x = crusher.tx * TILE + 4;
  game.player.y = 22 * TILE - P_H;
  let died = '';
  game.events.onDeath = (d) => { died = d.causeText; };
  for (let i = 0; i < 4 * 120 && !died; i++) game.step(sinp());
  check(`crusher kills (${died})`, died.startsWith('Crushed by Crusher #'));

  const game2 = new Game(level, 0);
  const laser = level.hazards.find((h) => h.kind === 'laser')!;
  game2.player.x = laser.tx * TILE + 3;
  game2.player.y = 22 * TILE - P_H;
  let died2 = '';
  game2.events.onDeath = (d) => { died2 = d.causeText; };
  for (let i = 0; i < 4 * 120 && !died2; i++) game2.step(sinp());
  check(`laser kills (${died2})`, died2.startsWith('Vaporized by Laser #'));

  // sacrifice
  const game3 = new Game(level, 0);
  game3.step(sinp({ sacrificePressed: true }));
  check('sacrifice kills instantly', game3.state === 'dying');
}

if (failures) { console.error(`\nM1: ${failures} FAILURES`); process.exit(1); }
console.log('\nM1: all checks passed');
