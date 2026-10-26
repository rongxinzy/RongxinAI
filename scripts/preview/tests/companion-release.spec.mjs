import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards } from '../shared/harness.mjs';

for (const theme of ['light', 'dark']) {
  test(`the release exposes only Xiaoyuan in the bubble and appearance settings in ${theme}`, async ({
    page,
  }) => {
    const failures = [];
    attachConsoleGuards(page, failures, 'xiaoyuan release');
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 480, height: 400 });
    await page.goto(`/companion.html?language=en&theme=${theme}`);
    await expect(page.getByRole('textbox')).toBeEnabled();
    await expect(page.locator('.theme-companion-name')).toHaveText('Xiaoyuan');
    await expect(
      page.getByRole('combobox', { name: 'Choose a companion', exact: true }),
    ).toHaveCount(0);
    const release = await page.evaluate(async () => {
      const state = await window.companion.bootstrap();
      let refused = false;
      try {
        await window.companion.select('00000000-0000-4000-8000-000000000002');
      } catch {
        refused = true;
      }
      return { identities: state.profiles.map(profile => profile.personaId), refused };
    });
    expect(release).toEqual({ identities: ['xiaoyuan'], refused: true });
    await page.getByRole('textbox').fill('A small thought for Xiaoyuan');
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
    const foreground = await page.locator('[data-companion-bubble]').evaluate(element => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--popover-foreground)';
      element.append(probe);
      const expected = getComputedStyle(probe).color;
      probe.remove();
      return { actual: getComputedStyle(element).color, expected };
    });
    expect(foreground.actual).toBe(foreground.expected);
    const accessibility = await new AxeBuilder({ page })
      .include('[data-companion-bubble]')
      .analyze();
    expect(accessibility.violations.map(violation => violation.id)).toEqual([]);
    await page.screenshot({ path: `/tmp/companion-solo-bubble-${theme}.png` });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/?previewSkipBoot=1');
    await page.getByText('Login', { exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const settings = page.getByRole('region', { name: 'Desktop companion', exact: true });
    await expect(
      settings.getByRole('switch', { name: 'Show desktop companion', exact: true }),
    ).toBeVisible();
    await expect(settings.getByRole('combobox')).toHaveCount(0);
    await expect(settings.getByText(/Youli|Tuantuan|Mianmian|Zhuli|Yunmo|Maixiao/)).toHaveCount(0);
    await page.screenshot({ path: `/tmp/companion-solo-settings-${theme}.png` });
    expect(failures).toEqual([]);
  });
}
