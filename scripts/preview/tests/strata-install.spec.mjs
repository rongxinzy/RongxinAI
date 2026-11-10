import { expect, test } from '@playwright/test';
import { PreviewScenario } from '../shared/constants.mjs';
import { attachConsoleGuards, home, previewSearch } from '../shared/harness.mjs';

for (const [colorScheme, width, height] of [
  ['light', 1280, 800],
  ['dark', 760, 700],
]) {
  test(`installs, starts and stops a Strata variant in ${colorScheme}`, async ({
    page,
    baseURL,
  }, testInfo) => {
    const failures = [];
    attachConsoleGuards(page, failures, 'strata');
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await home(page, baseURL, previewSearch({ scenario: PreviewScenario.Default, skipBoot: true }));
    await page.evaluate(() => {
      const ref = { catalogId: 'strata-qwen-flash-next', launchId: 'Gyro-S' };
      let installed = [];
      let job;
      let attempts = 0;
      let completeAfter;
      let status = { status: 'stopped' };
      Object.assign(window.electron.strata, {
        catalog: async () => [
          {
            id: ref.catalogId,
            displayName: 'Qwen3.8-Flash-Next (Strata)',
            marketplaceVariants: [
              {
                label: 'Gyro-S',
                launchId: ref.launchId,
                files: [
                  { bytes: 58_487_015_808, repoId: 'agentionai/Qwen3.8-Flash-Next-Gyro-GGUF' },
                ],
              },
            ],
          },
        ],
        isBundled: async () => true,
        install: async input => {
          job = { ...input, phase: 'downloading', completed: 8_000_000_000, total: 58_487_015_808 };
          attempts++;
          if (attempts === 2) completeAfter = Date.now() + 1000;
        },
        installState: async () => {
          if (completeAfter && Date.now() >= completeAfter) {
            installed = [ref];
            job = { ...job, phase: 'done', completed: job.total };
          }
          return { installed, job };
        },
        cancelInstall: async () => {
          job = { ...job, phase: 'cancelled' };
        },
        status: async () => status,
        start: async input => {
          status = {
            status: 'running',
            activeModelId: input.catalogId,
            activeLaunchId: input.launchId,
          };
          return status;
        },
        stop: async () => {
          status = { status: 'stopped' };
          return status;
        },
      });
    });
    await page.getByRole('button', { name: 'Local Inference', exact: true }).click();
    await page.getByRole('tab', { name: 'Marketplace', exact: true }).click();
    await page.getByRole('tab', { name: 'Strata models', exact: true }).click();
    await page.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(page.getByRole('progressbar', { name: 'Gyro-S' })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('download.png') });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByText('Pull cancelled', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Install', exact: true }).click();
    await expect(page.getByText('Installed', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Start Engine', exact: true }).click();
    await page.getByRole('button', { name: 'Stop Engine', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Start Engine', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    expect(failures).toEqual([]);
  });
}
