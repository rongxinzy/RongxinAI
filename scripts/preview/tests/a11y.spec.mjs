import AxeBuilder from '@axe-core/playwright';
import { test } from '@playwright/test';

import { PreviewScenario } from '../shared/constants.mjs';
import { applyDeterministicRendering, home, previewSearch } from '../shared/harness.mjs';

test('key pages (warn-only)', async ({ page, baseURL }, testInfo) => {
  testInfo.annotations.push({ type: 'severity', description: 'warn-only' });

  await applyDeterministicRendering(page);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const search = previewSearch({ scenario: PreviewScenario.Default, skipBoot: true });
  await home(page, baseURL ?? 'http://127.0.0.1:5176/', search);

  const results = await new AxeBuilder({ page }).disableRules(['color-contrast']).analyze();

  const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
  if (serious.length > 0) {
    console.warn(
      `[a11y:warn] ${serious.length} serious/critical violation(s): ${serious.map(v => v.id).join(', ')}`,
    );
  }
});
