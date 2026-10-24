import { expect, test } from '@playwright/test';

async function contrast(locator) {
  return locator.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d');
    const rgba = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const over = (front, back) =>
      front.map((value, index) =>
        index === 3 ? 255 : (value * front[3]) / 255 + back[index] * (1 - front[3] / 255),
      );
    const luminance = color => {
      const linear = color.slice(0, 3).map(value => {
        value /= 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const ratio = (a, b) => {
      const x = luminance(a),
        y = luminance(b);
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const ancestors = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      ancestors.unshift(parent);
    const outside = ancestors.reduce(
      (back, ancestor) => over(rgba(getComputedStyle(ancestor).backgroundColor), back),
      [255, 255, 255, 255],
    );
    const style = getComputedStyle(element);
    const inside = over(rgba(style.backgroundColor), outside);
    const border = over(rgba(style.borderColor), inside);
    return {
      text: ratio(over(rgba(style.color), inside), inside),
      border: Math.min(ratio(border, outside), ratio(border, inside)),
      focus: ratio(over(rgba(style.outlineColor), outside), outside),
      focusVisible: element.matches(':focus-visible'),
      outlineWidth: style.outlineWidth,
      outlineStyle: style.outlineStyle,
      outlineOffset: style.outlineOffset,
    };
  });
}

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
