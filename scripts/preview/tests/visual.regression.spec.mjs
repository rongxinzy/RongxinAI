import { test } from '@playwright/test';

import { PreviewEdition, PreviewScenario } from '../shared/constants.mjs';
import {
  applyDeterministicRendering,
  attachConsoleGuards,
  previewSearch,
} from '../shared/harness.mjs';
import { walkScreens } from '../shared/walkScreens.mjs';

const visualMatrix = [
  {
    id: 'default',
    scenario: PreviewScenario.Default,
    edition: PreviewEdition.Zhiyuan,
    lite: false,
  },
  { id: 'empty', scenario: PreviewScenario.Empty, edition: PreviewEdition.Zhiyuan, lite: false },
  { id: 'error', scenario: PreviewScenario.Error, edition: PreviewEdition.Zhiyuan, lite: false },
  {
    id: 'loading',
    scenario: PreviewScenario.Loading,
    edition: PreviewEdition.Zhiyuan,
    lite: false,
  },
  { id: 'lite', scenario: PreviewScenario.Default, edition: PreviewEdition.Xiaoruan, lite: true },
];

for (const entry of visualMatrix) {
  for (const scheme of ['light', 'dark']) {
    test(`${entry.id} ${scheme}`, async ({ page, baseURL }, testInfo) => {
      const failures = [];
      if (entry.scenario !== PreviewScenario.Error) {
        attachConsoleGuards(page, failures, `${entry.id}/${scheme}`);
      }
      await applyDeterministicRendering(page);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });

      const search = previewSearch({
        scenario: entry.scenario,
        edition: entry.edition,
        skipBoot: true,
      });

      await walkScreens(
        page,
        {
          baseUrl: baseURL ?? 'http://127.0.0.1:5176/',
          search,
          scheme,
          testInfo,
          captureStream: entry.scenario === PreviewScenario.Default && !entry.lite,
          liteEdition: entry.lite,
          snapshotPrefix: entry.id,
        },
        failures,
      );

      if (failures.length > 0) {
        throw new Error(failures.join('\n'));
      }
    });
  }
}
