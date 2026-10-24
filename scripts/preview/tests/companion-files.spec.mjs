import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { attachConsoleGuards } from '../shared/harness.mjs';
import { CompanionAttachmentIssue } from '../../../src/shared/companion/constants.ts';

async function open(page, surface = 'quick', theme = 'light', offline = false) {
  if (surface === 'home')
    await page.addInitScript(theme => {
      let api;
      Object.defineProperty(window, 'electron', {
        configurable: true,
        get: () => api,
        set(value) {
          value.appInfo.getSystemLocale = async () => 'zh-CN';
          const get = value.store.get;
          value.store.get = async key =>
            key === 'app_config'
              ? { ...(await get(key)), language: 'zh', theme, language_initialized: true }
              : get(key);
          api = value;
        },
      });
    }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto(
    `${surface === 'home' ? '/' : '/companion.html'}?previewSkipBoot=1&previewScenario=empty&theme=${theme}&offline=${offline ? '1' : '0'}`,
  );
  await page.getByRole('tab', { name: '交代任务', exact: true }).click();
  await page.getByRole('combobox', { name: '工作区', exact: true }).click();
  await page.getByRole('option', { name: 'Preview project', exact: true }).click();
  await page.evaluate(surface => {
    window.filesApi = surface === 'home' ? window.electron.companion : window.companion;
  }, surface);
}

for (const surface of ['home', 'quick'])
  for (const theme of ['light', 'dark'])
    test(`${surface} task files preserve draft identity, reload and narrow layout in ${theme}`, async ({
      page,
    }) => {
      const failures = [];
      attachConsoleGuards(page, failures, 'companion task files');
      await open(page, surface, theme, true);
      await page.getByRole('textbox').fill('根据附件整理一份摘要。');
      await page.getByRole('button', { name: '添加附件', exact: true }).click();
      await expect(page.getByText('project-notes.md', { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByText('project-notes.md', { exact: true })).toBeVisible();
      await expect(page.getByRole('textbox')).toHaveValue('根据附件整理一份摘要。');
      await page.getByRole('textbox').press('Enter');
      await expect(page.getByRole('alert')).toContainText('暂时没有可用模型');
      await expect(page.getByText('project-notes.md', { exact: true })).toBeVisible();
      await expect(page.getByRole('textbox')).toHaveValue('根据附件整理一份摘要。');
      for (const width of surface === 'home' ? [1440, 1280, 1024, 940, 760] : [560, 448]) {
        await page.setViewportSize({ width, height: 800 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
        await expect(page.getByRole('button', { name: '添加附件', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: '移除', exact: true })).toBeVisible();
      }
      const canvas = surface === 'home' ? '[data-main-canvas]' : 'main';
      expect(
        (await new AxeBuilder({ page }).include(canvas).analyze()).violations.map(item => item.id),
      ).toEqual([]);
      await page.setViewportSize({ width: surface === 'home' ? 1280 : 560, height: 800 });
      await page.screenshot({ path: `/tmp/companion-files-${surface}-${theme}.png` });
      await page.getByRole('button', { name: '移除', exact: true }).click();
      await expect(page.getByText('project-notes.md', { exact: true })).toHaveCount(0);
      expect(failures).toEqual([]);
    });

test('late file choices preserve current edits and cannot cross a companion switch', async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    window.filesApi.chooseFiles = () => new Promise(resolve => (window.finishFiles = resolve));
  });
  await page.getByRole('textbox').fill('Before picking');
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await expect(page.getByRole('button', { name: '开始任务', exact: true })).toBeDisabled();
  await page.getByRole('textbox').fill('Edited while picking');
  await page.evaluate(() =>
    window.finishFiles([{ id: crypto.randomUUID(), name: 'chosen.txt', bytes: 20 }]),
  );
  await expect(page.getByText('chosen.txt', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue('Edited while picking');
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await page.evaluate(async () => {
    const state = await window.filesApi.bootstrap();
    window.oldFilesPet = state.activePetId;
    await window.filesApi.select(
      state.profiles.find(profile => profile.petId !== state.activePetId).petId,
    );
  });
  await expect(page.getByRole('textbox')).toHaveValue('');
  await page.evaluate(() =>
    window.finishFiles([{ id: crypto.randomUUID(), name: 'late-private.txt', bytes: 20 }]),
  );
  await page.getByRole('tab', { name: '交代任务', exact: true }).click();
  await expect(page.getByText('late-private.txt', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.filesApi.select(window.oldFilesPet));
  await expect(page.getByText('chosen.txt', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue('Edited while picking');
});

test('an accepted file task clears only the acknowledged draft version', async ({ page }) => {
  await open(page);
  await page.getByRole('textbox').fill('Read the selected file');
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await expect(page.getByText('project-notes.md', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    const submit = window.filesApi.submitTask;
    window.filesApi.submitTask = async request => {
      window.sentFilesTask = request;
      await new Promise(resolve => (window.finishFilesTask = resolve));
      return submit(request);
    };
  });
  await page.getByRole('textbox').press('Enter');
  await expect.poll(() => page.evaluate(() => window.sentFilesTask?.attachmentIds?.length)).toBe(1);
  const payload = await page.evaluate(() => window.sentFilesTask);
  expect(Object.keys(payload).sort()).toEqual([
    'attachmentIds',
    'petId',
    'requestId',
    'text',
    'workspaceId',
  ]);
  await page.getByRole('textbox').fill('A new task draft');
  await page.getByRole('button', { name: '移除', exact: true }).click();
  await page.evaluate(() => window.finishFilesTask());
  await expect(page.getByRole('button', { name: /Read the selected file/ })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue('A new task draft');
  await expect(page.getByText('project-notes.md', { exact: true })).toHaveCount(0);
});

test('unavailable grants remain visible with an actionable error after state refresh', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('textbox').fill('Read my notes');
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await page.evaluate(code => {
    window.filesApi.submitTask = async () => {
      throw new Error(code);
    };
  }, CompanionAttachmentIssue.Unavailable);
  await page.getByRole('textbox').press('Enter');
  await expect(page.getByRole('alert')).toContainText('附件已不可用，请移除后重新选择。');
  await expect(page.getByRole('textbox')).toHaveValue('Read my notes');
  await expect(page.getByText('project-notes.md', { exact: true })).toBeVisible();
});

test('English file controls explain actual limits and retain previously selected files', async ({
  page,
}) => {
  await page.goto('/companion.html?language=en&theme=dark');
  await page.getByRole('tab', { name: 'Give a task', exact: true }).click();
  await page.getByRole('textbox').fill('Summarize the attached notes');
  await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
  await expect(page.getByText('project-notes.md', { exact: true })).toBeVisible();
  await page.evaluate(code => {
    window.companion.chooseFiles = async () => {
      throw new Error(code);
    };
  }, CompanionAttachmentIssue.TooLarge);
  await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Choose files under 25 MB each.');
  await page.evaluate(() => {
    window.companion.chooseFiles = async () =>
      Array.from({ length: 10 }, (_, index) => ({
        id: crypto.randomUUID(),
        name: `file-${index}.txt`,
        bytes: 10,
      }));
  });
  await page.getByRole('button', { name: 'Add attachments', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Attach up to 10 files at a time.');
  await expect(page.getByText('project-notes.md', { exact: true })).toBeVisible();
  await expect(page.getByText('file-0.txt', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveValue('Summarize the attached notes');
  await page.screenshot({ path: '/tmp/companion-files-en-dark.png' });
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(page.getByText('project-notes.md', { exact: true })).toHaveCount(0);
});

test('ten long file names remain operable in the minimum native window size', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    window.filesApi.chooseFiles = async () =>
      Array.from({ length: 10 }, (_, index) => ({
        id: crypto.randomUUID(),
        name: `很长的资料名称用于验证附件-${index}-long-report.md`,
        bytes: 20,
      }));
  });
  await page.getByRole('textbox').fill('整理这些资料。');
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await expect(page.getByRole('button', { name: '移除', exact: true })).toHaveCount(10);
  await page.setViewportSize({ width: 448, height: 372 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const send = page.getByRole('button', { name: '开始任务', exact: true });
  await send.scrollIntoViewIfNeeded();
  await expect(send).toBeInViewport();
  const remove = page.getByRole('button', { name: '移除', exact: true }).last();
  await remove.focus();
  await expect(remove).toBeInViewport();
  await remove.press('Enter');
  await expect(page.getByRole('button', { name: '移除', exact: true })).toHaveCount(9);
  await page.getByRole('textbox').focus();
  await expect(page.getByRole('textbox')).toBeInViewport();
  await expect(page.getByRole('textbox')).toHaveValue('整理这些资料。');
  await page.screenshot({ path: '/tmp/companion-files-minimum.png' });
});

for (const theme of ['light', 'dark'])
  test(`long filename details remain inside the quick window in ${theme}`, async ({ page }) => {
    await open(page, 'quick', theme);
    const name = 'a'.repeat(120) + '.md';
    await page.evaluate(name => {
      window.filesApi.chooseFiles = async () => [{ id: crypto.randomUUID(), name, bytes: 20 }];
    }, name);
    await page.setViewportSize({ width: 448, height: 700 });
    await page.getByRole('button', { name: '添加附件', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '移除', exact: true }),
    ).toHaveAccessibleDescription(name);
    await page.getByText('a'.repeat(112), { exact: true }).hover();
    const popup = page.locator('[data-slot="hover-card-content"]');
    await expect(popup).toBeVisible();
    const heading = popup.getByRole('heading', { name, exact: true });
    await expect(heading).toBeVisible();
    expect(await heading.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    expect(await popup.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const bounds = await popup.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(448);
    await page.screenshot({ path: `/tmp/companion-files-popup-${theme}.png` });
  });

test('system appearance changes update the quick window without losing its file draft', async ({
  page,
}) => {
  await page.addInitScript(() => {
    let api;
    Object.defineProperty(window, 'companion', {
      configurable: true,
      get: () => api,
      set(value) {
        const bootstrap = value.bootstrap;
        value.bootstrap = async () => {
          const state = await bootstrap();
          return { ...state, context: { ...state.context, theme: 'system' } };
        };
        value.onContext = listener => {
          window.fileAppearanceContext = listener;
          return () => {};
        };
        api = value;
      },
    });
  });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/companion.html');
  await page.getByRole('tab', { name: '交代任务', exact: true }).click();
  await page.getByRole('button', { name: '添加附件', exact: true }).click();
  await page.getByRole('textbox').fill('Keep this file draft while the system appearance changes');
  await expect(page.locator('html')).toHaveClass(/light/);
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByText('project-notes.md', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveValue(
    'Keep this file draft while the system appearance changes',
  );
  await expect(page.getByRole('textbox')).toBeFocused();
  await page.evaluate(() =>
    window.fileAppearanceContext({ language: 'zh', theme: 'light', themeStyle: '' }),
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await expect(page.locator('html')).toHaveClass(/light/);
});
