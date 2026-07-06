// M5 verification: emoji line, streaks, heatmap bins, time formatting — the pure
// share logic. (Canvas cards + clipboard are DOM-only; typecheck + build cover them.)
import { emojiLine, computeStreak, heatmapBins, fmtTime, fmtDayShort, fmtInt } from '../src/ui/share';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`FAIL  ${name} ${detail}`); }
}

console.log('M5: formatting');
check('fmtTime 2:41.08', fmtTime(161080) === '2:41.08');
check('fmtTime 0:05.00', fmtTime(5000) === '0:05.00');
check('fmtTime 10:00.99', fmtTime(600999) === '10:00.99');
check('fmtDayShort Jul 6', fmtDayShort('2026-07-06') === 'Jul 6');
check('fmtInt 48,201', fmtInt(48201) === '48,201');

console.log('M5: emoji result line');
{
  const died = emojiLine('2026-07-06', 0.61, 48201, null, 1);
  check(`died line: ${died}`,
    died.includes('DEADLINE Jul 6') && died.includes('61%') && died.includes('corpse #48,201'));
  const skulls = (died.match(/💀/g) ?? []).length;
  const blanks = (died.match(/⬛/g) ?? []).length;
  check(`8 slots, ${skulls} skulls for 61% (want 5)`, skulls === 5 && skulls + blanks === 8);

  const fin = emojiLine('2026-07-06', 1, null, { timeMs: 161080, rank: 312 }, 4);
  check(`finish line: ${fin}`,
    fin.includes('🏁') && fin.includes('2:41.08') && fin.includes('#312') && fin.includes('4d streak'));

  const zero = emojiLine('2026-07-06', 0, null, null, 0);
  check('0% line has 8 blanks', (zero.match(/⬛/g) ?? []).length === 8 && zero.includes('0%'));
  const full = emojiLine('2026-07-06', 0.999, 5, null, 1);
  check('99.9% rounds to 8 skulls', (full.match(/💀/g) ?? []).length === 8);
}

console.log('M5: streaks');
{
  check('3-day streak', computeStreak(['2026-07-04', '2026-07-05', '2026-07-06'], '2026-07-06') === 3);
  check('gap breaks streak', computeStreak(['2026-07-03', '2026-07-05', '2026-07-06'], '2026-07-06') === 2);
  check('not played today = 0', computeStreak(['2026-07-05'], '2026-07-06') === 0);
  check('single day = 1', computeStreak(['2026-07-06'], '2026-07-06') === 1);
  check('month boundary', computeStreak(['2026-06-30', '2026-07-01'], '2026-07-01') === 2);
  check('unsorted input ok', computeStreak(['2026-07-06', '2026-07-04', '2026-07-05'], '2026-07-06') === 3);
}

console.log('M5: heatmap bins');
{
  const xs = [0, 10, 10, 3199, 1600, 1601, 1602, 1603];
  const bins = heatmapBins(xs, 10, 3200);
  check('10 bins', bins.length === 10);
  check('densest bin normalized to 1', Math.max(...bins) === 1);
  check('bin 5 is densest (4 corpses mid-level)', bins[5] === 1);
  check('out-of-range clamped, empty bins zero', heatmapBins([-5, 99999], 4, 3200).filter((b) => b > 0).length === 2);
}

if (failures) { console.error(`\nM5: ${failures} FAILURES`); process.exit(1); }
console.log('\nM5: all checks passed');
