import { expect, test } from '@playwright/test';
import { attachConsoleGuards, home, previewSearch } from '../shared/harness.mjs';
import { historyMessages, installConversation } from '../shared/conversationFixture.mjs';

test('mention Enter/Tab selects a skill; first submission preserves the editor and focus', async ({
  page,
  baseURL,
}) => {
  const errors = [];
  attachConsoleGuards(page, errors, 'composer');
  await home(page, baseURL, previewSearch());
  const editor = page.getByRole('textbox').last();
  const original = await editor.elementHandle();
  for (const key of ['Enter', 'Tab']) {
    await editor.fill('@');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.keyboard.press(key);
    await expect(page.getByRole('listbox')).toHaveCount(0);
    await expect(page.locator('[data-turn-id]')).toHaveCount(0);
    await expect(editor).toBeFocused();
  }
  await expect(page.locator('[data-skill-token]')).toHaveCount(2);
  await editor.fill('Create a report');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Browser preview reply is ready', { exact: false })).toBeVisible();
  expect(await original.evaluate(node => node.isConnected)).toBe(true);
  await expect(editor).toBeFocused();
  await editor.fill('A new draft');
  await page.evaluate(async () => {
    const { themeService } = await import(
      new URL('/src/renderer/services/theme.ts', window.location.href).href
    );
    themeService.setTheme('dark');
  });
  await expect(editor).toHaveText('A new draft');
  await expect(editor).toBeFocused();
  expect(await original.evaluate(node => node.isConnected)).toBe(true);
  expect(errors).toEqual([]);
});

test('prepending history preserves the same visible turn at the same screen position', async ({
  page,
  baseURL,
}) => {
  await home(page, baseURL, previewSearch());
  await installConversation(page, historyMessages(100, 40));
  await page.locator('[data-turn-id="u-110"]').scrollIntoViewIfNeeded();
  await page.locator('.cowork-conversation-scroll').hover();
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(300);
  const anchor = await page.locator('.cowork-conversation-scroll').evaluate(scroller => {
    const bounds = scroller.getBoundingClientRect();
    const element = [...scroller.querySelectorAll('[data-turn-id]')].find(
      row => row.getBoundingClientRect().bottom > bounds.top,
    );
    return { id: element.dataset.turnId, top: element.getBoundingClientRect().top };
  });
  await page.evaluate(
    async messages => {
      const { store } = await import(
        new URL('/src/renderer/store/index.ts', window.location.href).href
      );
      const { prependMessages } = await import(
        new URL('/src/renderer/store/slices/coworkSlice.ts', window.location.href).href
      );
      store.dispatch(
        prependMessages({ sessionId: 'conversation-regression', messages, newOffset: 0 }),
      );
    },
    historyMessages(80, 20),
  );
  await expect
    .poll(async () =>
      Math.abs((await page.locator(`[data-turn-id="${anchor.id}"]`).boundingBox()).y - anchor.top),
    )
    .toBeLessThan(2);
  await page.waitForTimeout(300);
  expect(
    Math.abs((await page.locator(`[data-turn-id="${anchor.id}"]`).boundingBox()).y - anchor.top),
  ).toBeLessThan(2);
});

test('failed edit displays both the proposed diff and the actual error', async ({
  page,
  baseURL,
}) => {
  const errors = [];
  attachConsoleGuards(page, errors, 'failed-edit');
  await home(page, baseURL, previewSearch());
  await installConversation(page, [
    { id: 'u-error', type: 'user', content: 'Update report', timestamp: 1000 },
    {
      id: 't-error',
      type: 'tool_use',
      content: '',
      timestamp: 1001,
      metadata: {
        toolUseId: 'edit-1',
        toolName: 'edit',
        toolInput: { path: 'report.txt', oldText: 'before', newText: 'after' },
      },
    },
    {
      id: 'r-error',
      type: 'tool_result',
      content: 'EACCES: permission denied',
      timestamp: 1002,
      metadata: { toolUseId: 'edit-1', isError: true },
    },
  ]);
  await page.locator('[data-tool-name="edit"] button').first().click();
  await expect(page.getByText('EACCES: permission denied', { exact: true })).toBeVisible();
  await expect(page.locator('[data-tool-name="edit"] diffs-container')).toBeVisible();
  expect(errors).toEqual([]);
});

test('cold session loading retains the editor and saves the home draft before debounce', async ({
  page,
  baseURL,
}) => {
  await home(page, baseURL, previewSearch());
  const editor = page.getByRole('textbox').last();
  const original = await editor.elementHandle();
  await editor.fill('Un-debounced home draft');
  await page.evaluate(async () => {
    const { store } = await import(
      new URL('/src/renderer/store/index.ts', window.location.href).href
    );
    const { setLoadingSessionId } = await import(
      new URL('/src/renderer/store/slices/coworkSlice.ts', window.location.href).href
    );
    store.dispatch(setLoadingSessionId('conversation-regression'));
  });
  await expect(page.locator('[data-slot="session-loading-turn"]').first()).toBeVisible();
  expect(await original.evaluate(node => node.isConnected)).toBe(true);
  await installConversation(page, historyMessages(1, 1));
  expect(await original.evaluate(node => node.isConnected)).toBe(true);
  await page.evaluate(async () => {
    const { store } = await import(
      new URL('/src/renderer/store/index.ts', window.location.href).href
    );
    const { clearCurrentSession } = await import(
      new URL('/src/renderer/store/slices/coworkSlice.ts', window.location.href).href
    );
    store.dispatch(clearCurrentSession());
  });
  await expect(editor).toHaveText('Un-debounced home draft');
  expect(await original.evaluate(node => node.isConnected)).toBe(true);
});

test('inline approval exposes focus and pending states while preserving the disabled draft', async ({
  page,
  baseURL,
}) => {
  const errors = [];
  const missingTranslations = [];
  page.on('console', message => {
    if (message.text().includes('Translation missing for key:')) {
      missingTranslations.push(message.text());
    }
  });
  attachConsoleGuards(page, errors, 'approval');
  await home(page, baseURL, previewSearch());
  await installConversation(page, [
    { id: 'approval-user', type: 'user', content: 'Run build', timestamp: 1000 },
    {
      id: 'approval-tool',
      type: 'tool_use',
      content: '',
      timestamp: 1001,
      metadata: {
        toolName: 'bash',
        toolUseId: 'approval-call',
        toolInput: { command: 'bun run build' },
      },
    },
  ]);
  const editor = page.getByRole('textbox').last();
  await editor.fill('Keep this draft during approval');
  const label = await page.evaluate(async () => {
    const { store } = await import(
      new URL('/src/renderer/store/index.ts', window.location.href).href
    );
    const { enqueuePendingPermission } = await import(
      new URL('/src/renderer/store/slices/coworkSlice.ts', window.location.href).href
    );
    const { i18nService } = await import(
      new URL('/src/renderer/services/i18n.ts', window.location.href).href
    );
    window.electron.cowork.respondToPermission = () =>
      new Promise(resolve => {
        window.finishApprovalRegression = () => resolve({ success: true });
      });
    store.dispatch(
      enqueuePendingPermission({
        origin: 'pi-workbench',
        sessionId: 'conversation-regression',
        requestId: 'approval-request',
        toolName: 'bash',
        toolUseId: 'approval-call',
        toolInput: { command: 'bun run build' },
      }),
    );
    return i18nService.t('coworkApprove');
  });
  const approve = page.getByRole('button', { name: label, exact: true });
  await expect(approve).toBeFocused();
  await expect(editor).toHaveAttribute('contenteditable', 'false');
  await approve.click();
  await expect(approve).toBeDisabled();
  await page.evaluate(() => window.finishApprovalRegression());
  await expect(approve).toHaveCount(0);
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor).toHaveText('Keep this draft during approval');
  expect(missingTranslations).toEqual([]);
  expect(errors).toEqual([]);
});
