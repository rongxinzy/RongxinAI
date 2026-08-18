import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { validateExpert } = require('../../SKILLs/zhiyuan-expert-manager/scripts/validate_expert.js') as {
  validateExpert: (
    expertPath: string,
    options?: { strict?: boolean },
  ) => { isValid: boolean; errors: string[]; warnings: string[] };
};

const presetsRoot = path.resolve('SKILLs/zhiyuan-expert-manager/presets');

/**
 * Every bundled preset must pass strict validation. This test lives under
 * src/ so the CI vitest run actually reaches it — the validator's own test
 * file sits in SKILLs/, which the vitest include patterns do not cover.
 */
test('all bundled expert presets pass strict validation', () => {
  const presetIds = fs
    .readdirSync(presetsRoot)
    .filter(entry => fs.statSync(path.join(presetsRoot, entry)).isDirectory());
  expect(presetIds.length).toBeGreaterThanOrEqual(8);

  const failures: string[] = [];
  for (const presetId of presetIds) {
    const result = validateExpert(path.join(presetsRoot, presetId), { strict: true });
    if (!result.isValid || result.warnings.length > 0) {
      failures.push(
        `${presetId}: ${[...result.errors, ...result.warnings].join(' | ') || 'invalid'}`,
      );
    }
  }
  expect(failures).toEqual([]);
});

test('strict validation rejects cosmetic deviations for bundled presets', () => {
  const dataAnalyst = validateExpert(path.join(presetsRoot, 'data-analyst'), { strict: true });
  expect(dataAnalyst.isValid).toBe(true);
  expect(dataAnalyst.warnings).toEqual([]);
});
