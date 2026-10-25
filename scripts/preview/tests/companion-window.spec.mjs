import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { useDormantCompanionRoster } from '../shared/companion-roster.mjs';

test.beforeEach(async ({ page }) => useDormantCompanionRoster(page));

for (const language of ['zh', 'en']) {
  for (const theme of ['light', 'dark']) {
    test(`companion chat, draft and identity remain usable in ${language} ${theme}`, async ({
      page,
    }) => {
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(message.text());
      });
      await page.setViewportSize({ width: language === 'en' ? 448 : 480, height: 400 });
      await page.goto(`/companion.html?language=${language}&theme=${theme}`);
      await expect(page).toHaveTitle('知远智能体 (ZhiYuan Agent)');
      const heading = language === 'zh' ? '你的智能伙伴' : 'Your intelligent companion';
      await expect(page.getByRole('main', { name: heading })).toBeVisible();
      await expect(page.getByRole('heading', { name: heading })).toHaveClass('sr-only');
      await expect(page.locator('.theme-companion-sketch')).toBeVisible();
      const input = page.getByRole('textbox');
      await expect(input).toBeFocused();
      const text =
        language === 'zh'
          ? '帮我梳理一下今天的安排。'
          : 'Help me think through today’s priorities.';
      await input.fill(text);
      await input.press('Shift+Enter');
      await expect(input).toHaveValue(text + '\n');
      await input.press('Escape');
      await expect(page.locator('html')).toHaveAttribute('data-companion-hidden', 'true');
      await page.reload();
      await expect(input).toHaveValue(text + '\n');
      await input.press('Enter');
      await expect(input).toHaveValue('');
      await expect(page.getByText(text, { exact: true })).toBeVisible();
      await expect(
        page.getByText(
          language === 'zh'
            ? '先把最想解决的一件事说给我听。'
            : 'Tell me the first thing you want to work through.',
          { exact: true },
        ),
      ).toBeVisible();
      await input.fill('A private draft for the first companion');
      await page.getByRole('combobox').click();
      await page
        .getByRole('option', { name: language === 'zh' ? '游栗' : 'Youli', exact: true })
        .click();
      await expect(input).toHaveValue('');
      await expect(page.getByText(text, { exact: true })).toHaveCount(0);
      await input.fill('A different draft for Youli');
      await page.getByRole('combobox').click();
      await page
        .getByRole('option', { name: language === 'zh' ? '小远' : 'Xiaoyuan', exact: true })
        .click();
      await expect(input).toHaveValue('A private draft for the first companion');
      await expect(page.locator('[data-slot="select-content"]')).toBeHidden();
      const accessibility = await new AxeBuilder({ page }).analyze();
      expect(
        accessibility.violations.map(item => ({
          id: item.id,
          nodes: item.nodes.map(node => ({ html: node.html, summary: node.failureSummary })),
        })),
      ).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `/tmp/companion-window-${language}-${theme}.png` });
      expect(errors).toEqual([]);
    });
  }
}

test('unavailable models preserve the exact draft and do not create fictional conversation progress', async ({
  page,
}) => {
  await page.goto('/companion.html?offline=1');
  const input = page.getByRole('textbox');
  await input.fill('先保留这段话，下次再聊。');
  await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('暂时没有可用模型，内容已保留。');
  await expect(input).toHaveValue('先保留这段话，下次再聊。');
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.reload();
  await expect(input).toHaveValue('先保留这段话，下次再聊。');
});

test('editing a new draft while admission is pending never clears the new text', async ({
  page,
}) => {
  await page.goto('/companion.html');
  await page.getByRole('textbox').fill('The first message');
  await page.evaluate(() => {
    const submit = window.companion.submit;
    window.companion.submit = async request => {
      await new Promise(resolve => setTimeout(resolve, 700));
      return submit(request);
    };
  });
  await page.getByRole('textbox').press('Enter');
  await page.getByRole('textbox').fill('Keep this next thought');
  await expect(page.getByText('Tell me the first thing you want to work through.')).toHaveCount(0);
  await expect(page.getByText('先把最想解决的一件事说给我听。')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue('Keep this next thought');
});

test('hot theme and language changes preserve input, focus, selection and open portal state', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window, 'companion', {
      configurable: true,
      get: () => api,
      set(value) {
        const subscribe = value.onContext;
        value.onContext = listener => {
          window.companionTestContext = listener;
          return subscribe(listener);
        };
        api = value;
      },
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/companion.html');
  const input = page.getByRole('textbox');
  await input.fill('A draft that stays while appearance changes');
  await input.evaluate(element => element.setSelectionRange(2, 10));
  await page.evaluate(() =>
    window.companionTestContext({ language: 'en', theme: 'dark', themeStyle: '' }),
  );
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('A draft that stays while appearance changes');
  expect(await input.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual([
    2, 10,
  ]);
  await expect(page.getByRole('main', { name: 'Your intelligent companion' })).toBeVisible();
  await page.getByRole('combobox').click();
  await page.evaluate(() =>
    window.companionTestContext({ language: 'zh', theme: 'light', themeStyle: '' }),
  );
  await expect(page.getByRole('option', { name: '游栗', exact: true })).toBeVisible();
  await expect(page.getByRole('listbox', { name: '切换伙伴', exact: true })).toBeVisible();
  // Audit the completed light appearance, after the browser has committed the token change.
  await expect(input).toHaveCSS('color', 'rgb(24, 29, 39)');
  await expect(page.locator('[data-slot="select-value"]')).toHaveCSS('color', 'rgb(24, 29, 39)');
  const popupAccessibility = await new AxeBuilder({ page }).analyze();
  expect(
    popupAccessibility.violations.map(item => ({
      id: item.id,
      nodes: item.nodes.map(node => ({
        html: node.html,
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.locator('html')).not.toHaveAttribute('data-companion-hidden', 'true');
  for (const [width, height] of [
    [1280, 800],
    [1440, 900],
    [1024, 768],
    [940, 700],
    [760, 700],
    [448, 640],
  ]) {
    await page.setViewportSize({ width, height });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
  }
});
