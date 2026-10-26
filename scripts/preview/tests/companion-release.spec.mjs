import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards } from '../shared/harness.mjs';

for (const theme of ['light', 'dark']) {
  test(`the bubble has a static name while settings retain seven appearances in ${theme}`, async ({
    page,
  }) => {
    const failures = [];
    attachConsoleGuards(page, failures, 'xiaoyuan release');
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 480, height: 400 });
    await page.goto(`/companion.html?language=en&theme=${theme}`);
    await expect(page.getByRole('textbox')).toBeEnabled();
    await expect(page.getByRole('combobox', { name: 'Switch companion', exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator('.theme-companion-name')).toHaveText('Xiaoyuan');
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
    expect(release).toEqual({
      identities: ['xiaoyuan', 'youli', 'tuantuan', 'mianmian', 'zhuli', 'yunmo', 'maixiao'],
      refused: false,
    });
    await expect(page.locator('.theme-companion-name')).toHaveText('Youli');
    await page.evaluate(async () => {
      const state = await window.companion.bootstrap();
      await window.companion.select(
        state.profiles.find(profile => profile.personaId === 'xiaoyuan').petId,
      );
    });
    await expect(page.locator('.theme-companion-name')).toHaveText('Xiaoyuan');
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
    await settings.getByRole('combobox').click();
    await expect(page.getByRole('option')).toHaveCount(7);
    await page.getByRole('option', { name: /Maixiao/ }).click();
    await expect(settings.getByRole('combobox')).toContainText('Maixiao');
    await page.screenshot({ path: `/tmp/companion-solo-settings-${theme}.png` });
    expect(failures).toEqual([]);
  });
}
