import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { contrast } from '../shared/contrast.mjs';

async function settleDialog(page) {
  await expect(page.locator('[data-slot="dialog-content"]')).toHaveCount(1);
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(1);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toHaveCSS('opacity', '1');
  await dialog.evaluate(async element => {
    await Promise.all(
      element.getAnimations({ subtree: true }).map(animation => animation.finished),
    );
  });
}

for (const theme of ['light', 'dark']) {
  test(`companion private memory CRUD and explicit sharing in ${theme}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.setViewportSize({ width: 448, height: 640 });
    await page.goto(`/companion.html?theme=${theme}`);
    const chat = page.getByRole('textbox', { name: '说说你在想什么…' });
    await chat.fill('保留这段对话草稿');
    const entry = page.getByRole('button', { name: '记忆', exact: true });
    await entry.click();
    let dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading')).toHaveText('小远的记忆');
    await expect(dialog).toHaveCSS('padding', '24px');
    await expect(dialog).toHaveCSS('border-radius', '12px');
    await expect(dialog.getByRole('button', { name: '添加记忆' })).toHaveCSS(
      'border-radius',
      '8px',
    );
    await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCSS('backdrop-filter', 'none');
    await expect(dialog.getByText('还没有记忆。')).toBeVisible();
    await dialog.getByRole('button', { name: '添加记忆' }).click();
    for (const name of ['标题', '内容']) {
      const field = dialog.getByRole('textbox', { name, exact: true });
      const before = await contrast(field);
      expect(before.border).toBeGreaterThanOrEqual(3);
      await field.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      const focused = await contrast(field);
      expect(focused.focusVisible).toBe(true);
      expect(focused.outlineWidth).toBe('2px');
      expect(focused.focus).toBeGreaterThanOrEqual(3);
      console.log(JSON.stringify({ surface: 'companion-memory', theme, name, ...focused }));
    }
    await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await dialog.getByRole('textbox', { name: '标题', exact: true }).fill('纸鸢颜色');
    await dialog.getByRole('textbox', { name: '内容', exact: true }).fill('这只伙伴的纸鸢是蓝色。');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog.getByText('这只伙伴的纸鸢是蓝色。')).toBeVisible();
    await dialog.getByRole('button', { name: '编辑记忆: 纸鸢颜色' }).click();
    await dialog.getByRole('textbox', { name: '内容', exact: true }).fill('这只伙伴的纸鸢是绿色。');
    await dialog.getByRole('button', { name: '保存', exact: true }).click();
    await expect(dialog.getByText('这只伙伴的纸鸢是绿色。')).toBeVisible();
    await page.evaluate(() => {
      const share = window.companion.shareMemory;
      window.memoryShares = [];
      window.companion.shareMemory = async input => {
        window.memoryShares.push(input);
        return share(input);
      };
    });
    await dialog.getByRole('button', { name: '共享记忆: 纸鸢颜色' }).click();
    await expect(dialog).toContainText('其他伙伴和工作台也可使用');
    expect(await page.evaluate(() => window.memoryShares)).toEqual([]);
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect(await page.evaluate(() => window.memoryShares)).toEqual([]);
    await dialog.getByRole('button', { name: '共享记忆: 纸鸢颜色' }).click();
    await dialog.getByRole('button', { name: '确认共享', exact: true }).click();
    await expect(dialog.getByRole('status')).toHaveText('已共享');
    expect(await page.evaluate(() => window.memoryShares.map(item => item.confirmed))).toEqual([
      true,
    ]);
    await dialog.getByRole('button', { name: '删除: 纸鸢颜色' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: '删除这条记忆？' })).toBeVisible();
    await settleDialog(page);
    await expect(page.getByRole('dialog')).toHaveCSS('border-radius', '12px');
    const remove = page.getByRole('button', { name: '删除', exact: true });
    await expect(remove).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(249, 112, 102)' : 'rgb(217, 45, 32)',
    );
    expect((await contrast(remove)).text).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: `/tmp/companion-memory-delete-${theme}.png` });
    await page.getByRole('button', { name: '取消', exact: true }).click();
    await expect(dialog.getByText('这只伙伴的纸鸢是绿色。')).toBeVisible();
    await settleDialog(page);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(
      accessibility.violations.map(item => ({
        id: item.id,
        nodes: item.nodes.map(node => node.failureSummary),
      })),
    ).toEqual([]);
    await page.screenshot({ path: `/tmp/companion-memory-${theme}.png` });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(entry).toBeFocused();
    await expect(chat).toHaveValue('保留这段对话草稿');
    await expect(page.locator('html')).not.toHaveAttribute('data-companion-hidden', 'true');
    await page.getByRole('combobox', { name: '切换伙伴' }).click();
    await page.getByRole('option', { name: '游栗', exact: true }).click();
    await entry.click();
    await expect(dialog.getByRole('heading')).toHaveText('游栗的记忆');
    await expect(dialog.getByText('还没有记忆。')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('combobox', { name: '切换伙伴' }).click();
    await page.getByRole('option', { name: '小远', exact: true }).click();
    await entry.click();
    await dialog.getByRole('button', { name: '删除: 纸鸢颜色' }).click();
    await page.getByRole('button', { name: '删除', exact: true }).click();
    await expect(dialog.getByText('还没有记忆。')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('memory edits survive theme/language changes and fit all supported windows', async ({
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
          window.memoryContext = listener;
          return subscribe(listener);
        };
        api = value;
      },
    });
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/companion.html');
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '添加记忆' }).click();
  const content = dialog.getByRole('textbox', { name: '内容', exact: true });
  await content.fill('保留草稿和选中位置');
  await content.evaluate(element => element.setSelectionRange(2, 6));
  await page.evaluate(() =>
    window.memoryContext({ language: 'en', theme: 'dark', themeStyle: '' }),
  );
  const english = dialog.getByRole('textbox', { name: 'Content', exact: true });
  await expect(english).toBeFocused();
  await expect(english).toHaveValue('保留草稿和选中位置');
  expect(await english.evaluate(element => [element.selectionStart, element.selectionEnd])).toEqual(
    [2, 6],
  );
  await dialog
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('A long title '.repeat(10));
  await english.fill('Long memory content with words and no-hidden-controls. '.repeat(50));
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
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(english).toHaveCSS('field-sizing', 'fixed');
    expect(await english.evaluate(element => element.clientHeight < element.scrollHeight)).toBe(
      true,
    );
    await expect(english).toHaveValue(/Long memory content/);
  }
  await page.screenshot({ path: '/tmp/companion-memory-editor-dark-en.png' });
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog.getByRole('button', { name: /Edit memory:/ })).toBeVisible();
  expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Add memory', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await dialog.getByRole('button', { name: /^Share memory:/ }).click();
  await expect(dialog.getByRole('button', { name: 'Confirm sharing', exact: true })).toBeInViewport(
    { ratio: 1 },
  );
  const review = dialog.getByRole('region', { name: 'Content', exact: true });
  await review.focus();
  await review.press('End');
  await expect.poll(() => review.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await page.screenshot({ path: '/tmp/companion-memory-long-share-dark-en.png' });
});

test('late memory loads cannot reopen a hidden dialog or populate the newly selected companion', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window, 'companion', {
      configurable: true,
      get: () => api,
      set(value) {
        value.onVisibility = listener => {
          window.memoryVisibility = listener;
          return () => {};
        };
        const list = value.listMemories;
        value.listMemories = async petId => {
          const records = await list(petId);
          if (!window.memoryRelease)
            await new Promise(resolve => {
              window.memoryRelease = resolve;
            });
          return records;
        };
        api = value;
      },
    });
  });
  await page.goto('/companion.html');
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('status')).toHaveText('正在读取…');
  await page.evaluate(async () => {
    const state = await window.companion.bootstrap();
    await window.companion.select(state.profiles[1].petId);
    window.memoryRelease();
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText('游栗的记忆');
  await expect(page.getByRole('dialog').getByText('还没有记忆。')).toBeVisible();
  await page.evaluate(() => window.memoryVisibility(false));
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a lost save response retries the same request while queued records stay read-only', async ({
  page,
}) => {
  await page.goto('/companion.html');
  await page.evaluate(() => {
    const save = window.companion.saveMemory;
    let once = true;
    window.memorySaves = [];
    window.companion.saveMemory = async input => {
      window.memorySaves.push(input);
      const record = await save(input);
      record.memoryId = null;
      if (once) {
        once = false;
        throw new Error('Simulated lost reply');
      }
      return record;
    };
  });
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '添加记忆' }).click();
  await dialog.getByRole('textbox', { name: '标题', exact: true }).fill('等待同步');
  await dialog
    .getByRole('textbox', { name: '内容', exact: true })
    .fill('保存结果未知时保持请求身份。');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('没能确认修改结果');
  await expect(dialog.getByRole('textbox', { name: '内容', exact: true })).toHaveValue(
    '保存结果未知时保持请求身份。',
  );
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  expect(
    await page.evaluate(() => new Set(window.memorySaves.map(item => item.requestId)).size),
  ).toBe(1);
  await expect(dialog.getByRole('button', { name: '编辑记忆: 等待同步' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '共享记忆: 等待同步' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '删除: 等待同步' })).toBeEnabled();
});
