import { expect, test } from 'vitest';
import { csvFixture } from './piNativeABFixtures';
import { provider } from './piNativeABProvider';
import { reportEvaluationRow, runEvaluationArm } from './piNativeABRunner';

// Opt in to network and possible provider charges. Use PI_AB_USE_ZHIYUAN_FREE=1,
// PI_AB_USE_ZHIYUAN_INTRANET=1, or PI_AB_BASE_URL/PI_AB_MODEL/optional PI_AB_API_KEY.
// PI_AB_STRESS=1 runs one pair with 1,050 additional records that should be excluded.
// PI_AB=1 bunx --no-install vitest run tests/evaluation/piNativeAB.test.ts
test.skipIf(process.env.PI_AB !== '1')(
  'compares bare Pi and Work with the same live model and independent artifact scoring',
  { timeout: 600000 },
  async () => {
    const config = await provider();
    const stress = process.env.PI_AB_STRESS === '1';
    const onlyArm = process.env.PI_AB_ARM;
    if (onlyArm && onlyArm !== 'native' && onlyArm !== 'work')
      throw new Error('Unknown PI_AB_ARM.');
    const summaries = [];
    const order: Array<Array<'native' | 'work'>> = [['native', 'work']];
    if (!stress) order.push(['work', 'native']);
    for (const [variant, arms] of order.entries()) {
      for (const arm of arms) {
        if (onlyArm && arm !== onlyArm) continue;
        const { summary } = await runEvaluationArm({
          arm,
          config,
          fixture: cwd => csvFixture(cwd, variant, stress),
        });
        reportEvaluationRow(
          'PiNativeAB',
          { ...summary, variant, stress },
          process.env.PI_AB_REPORT,
        );
        summaries.push(summary);
      }
    }
    expect(new Set(summaries.flatMap(summary => summary.observedModels)).size).toBe(1);
    for (const summary of summaries) {
      expect(summary.executionError).toBeUndefined();
      expect(summary.requests).toBeGreaterThan(0);
      expect(summary.actual).toEqual(summary.expected);
      expect(summary.inputsUnchanged).toBe(true);
      expect(summary.onlyExpectedFiles).toBe(true);
    }
  },
);
