// M2 verification: determinism, validation constraints, and threshold logging
// across a month of dates + today.
import { LEVEL_W, TILE } from '../src/config';
import { generateDailyLevel } from '../src/game/levelgen';
import { solveLevel, reachWithBudget } from '../src/game/solve';
import { dayKey } from '../src/core/rng';

let failures = 0;
function check(name: string, cond: boolean): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name}`); }
}

const dates: string[] = [dayKey()];
for (let i = 1; i <= 30; i++) {
  const d = new Date(Date.UTC(2026, 6, 6) - i * 86400000);
  dates.push(d.toISOString().slice(0, 10));
}

let fallbacks = 0;
let maxAttempts = 0;
const thresholds: number[] = [];

for (const key of dates) {
  const { level, info } = generateDailyLevel(key);
  if (info.usedFallback) fallbacks++;
  maxAttempts = Math.max(maxAttempts, info.attempts);
  thresholds.push(info.threshold);

  // determinism: regenerate, must be byte-identical
  const again = generateDailyLevel(key).level;
  if (Buffer.compare(Buffer.from(level.tiles), Buffer.from(again.tiles)) !== 0 ||
      level.hazards.length !== again.hazards.length) {
    failures++;
    console.error(`FAIL  ${key}: generation not deterministic`);
  }

  const res = solveLevel(level);
  const quarter = Math.floor(LEVEL_W * 0.25);
  if (!info.usedFallback) {
    if (!(res.reachedGoal && res.threshold >= 8 && res.threshold <= 60)) {
      failures++;
      console.error(`FAIL  ${key}: threshold ${res.threshold} out of range or unreachable`);
    }
    if (res.soloReachTx < quarter) {
      failures++;
      console.error(`FAIL  ${key}: solo reach ${res.soloReachTx} < first quarter ${quarter}`);
    }
    if (!(res.soloReachTx < level.wallX + 2)) {
      failures++;
      console.error(`FAIL  ${key}: wall does not block solo play (reach ${res.soloReachTx}, wall ${level.wallX})`);
    }
    if (!(level.wallX > LEVEL_W * 0.4 && level.wallX < LEVEL_W * 0.6)) {
      failures++;
      console.error(`FAIL  ${key}: wall at ${level.wallX}, not mid-level`);
    }
  }
}

check(`31 dates generated, ${fallbacks} fallbacks (want 0)`, fallbacks === 0);
check(`max attempts used: ${maxAttempts} (≤ 24)`, maxAttempts <= 24);
check('all thresholds in [8,60]', thresholds.every((t) => t >= 8 && t <= 60));
console.log(`  thresholds: min ${Math.min(...thresholds)}, max ${Math.max(...thresholds)}, ` +
  `avg ${(thresholds.reduce((a, b) => a + b, 0) / thresholds.length).toFixed(1)}`);

// spot-check budget reach curve on today's level
{
  const { level } = generateDailyLevel(dayKey());
  const r0 = reachWithBudget(level, 0);
  const rT = reachWithBudget(level, level.corpseThreshold);
  const goalTx = Math.floor(level.goalX / TILE);
  check(`budget 0 reaches ${r0} (< goal ${goalTx})`, r0 < goalTx);
  check(`budget ${level.corpseThreshold} reaches goal`, rT >= goalTx);
  check('wall needs >= 12 corpses (threshold includes the pile)', level.corpseThreshold >= 12);
}

// perf: generation+validation must be fast (runs on every client at boot)
{
  const t0 = performance.now();
  generateDailyLevel('2026-01-15');
  const ms = performance.now() - t0;
  check(`generation+validation ${ms.toFixed(0)}ms < 500ms`, ms < 500);
}

if (failures) { console.error(`\nM2: ${failures} FAILURES`); process.exit(1); }
console.log('\nM2: all checks passed');
