import { expect, test } from '@playwright/test';

import { contrast } from '../shared/contrast.mjs';

for (const theme of ['light', 'dark']) {
  test(`home navigation and mode controls retain visible keyboard focus in ${theme}`, async ({
    page,
  }) => {
    await page.goto('/?previewScenario=empty&previewSkipBoot=1');
    await expect(page.getByRole('combobox')).toBeEnabled();
    await page.evaluate(async theme => {
      const source = new URL('/src/renderer/services/theme.ts', location.origin).href;
      const { themeService } = await import(source);
      themeService.setTheme(theme);
    }, theme);
    for (const control of [
      page.getByTestId('sidebar-view-companion'),
      page.getByTestId('sidebar-view-workbench'),
      page.getByRole('tab').first(),
    ]) {
      await control.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await control.evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.finished));
      });
      const focused = await contrast(control);
      expect(focused.focusVisible).toBe(true);
      expect(focused.outlineWidth).toBe('2px');
      expect(focused.focus).toBeGreaterThanOrEqual(3);
    }
  });
  test(`shared companion input has a visible boundary and keyboard focus in ${theme}`, async ({
    page,
  }) => {
    await page.goto(`/companion.html?theme=${theme}`);
    const input = page.getByRole('textbox');
    const group = page.locator('[data-slot="input-group"]').last();
    await page.getByRole('combobox').focus();
    await group.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    expect((await contrast(group)).border).toBeGreaterThanOrEqual(3);
    await group.hover();
    await group.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    expect((await contrast(group)).border).toBeGreaterThanOrEqual(3);
    await input.focus();
    await input.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    const focused = await contrast(group);
    expect(focused.outlineWidth).toBe('2px');
    expect(focused.outlineStyle).toBe('solid');
    expect(focused.outlineOffset).toBe('1px');
    expect(focused.focus).toBeGreaterThanOrEqual(3);
    expect((await contrast(input)).text).toBeGreaterThanOrEqual(4.5);
    console.log(
      JSON.stringify({
        surface: 'companion',
        theme,
        boundary: (await contrast(group)).border,
        focus: focused.focus,
        text: (await contrast(input)).text,
      }),
    );
  });
  test(`workbench composer retains the same visible boundary and keyboard focus in ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await page.goto('/?previewScenario=empty&previewSkipBoot=1');
    await page.getByTestId('sidebar-view-workbench').click();
    await page.evaluate(async theme => {
      const source = new URL('/src/renderer/services/theme.ts', location.origin).href;
      const { themeService } = await import(source);
      themeService.setTheme(theme);
    }, theme);
    const input = page.getByRole('textbox');
    const group = input.locator('xpath=ancestor::*[@data-slot="input-group"]').last();
    await page.getByTestId('sidebar-view-workbench').focus();
    await group.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    expect((await contrast(group)).border).toBeGreaterThanOrEqual(3);
    await group.hover();
    await group.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    expect((await contrast(group)).border).toBeGreaterThanOrEqual(3);
    await input.focus();
    await group.evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    const focused = await contrast(group);
    expect(focused.outlineWidth).toBe('2px');
    expect(focused.outlineStyle).toBe('solid');
    expect(focused.focus).toBeGreaterThanOrEqual(3);
    expect((await contrast(input)).text).toBeGreaterThanOrEqual(4.5);
    console.log(
      JSON.stringify({
        surface: 'workbench',
        theme,
        boundary: focused.border,
        focus: focused.focus,
        text: (await contrast(input)).text,
      }),
    );
  });
  test(`shared companion selectors retain visible boundaries and keyboard focus in ${theme}`, async ({
    page,
  }) => {
    await page.goto(`/companion.html?theme=${theme}`);
    await page.getByRole('tab', { name: '交代任务', exact: true }).click();
    for (const name of ['切换伙伴', '工作区']) {
      const selector = page.getByRole('combobox', { name, exact: true });
      expect((await contrast(selector)).border).toBeGreaterThanOrEqual(3);
      expect((await contrast(selector)).text).toBeGreaterThanOrEqual(4.5);
      await selector.hover();
      await selector.evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.finished));
      });
      expect((await contrast(selector)).border).toBeGreaterThanOrEqual(3);
      await selector.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await selector.evaluate(async element => {
        await Promise.all(element.getAnimations().map(animation => animation.finished));
      });
      const focused = await contrast(selector);
      expect(focused.focusVisible).toBe(true);
      expect(focused.outlineWidth).toBe('2px');
      expect(focused.outlineStyle).toBe('solid');
      expect(focused.outlineOffset).toBe('1px');
      expect(focused.focus).toBeGreaterThanOrEqual(3);
      await page.keyboard.press('Tab');
      await page.mouse.move(0, 0);
    }
  });
}
