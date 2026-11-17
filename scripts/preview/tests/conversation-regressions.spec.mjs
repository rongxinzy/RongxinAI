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
  await page.locator('.cowork-conversation-scroll').evaluate(scroller => {
    scroller.scrollTop = Math.floor(scroller.scrollHeight * 0.25);
  });
  await page.waitForTimeout(300);
  await page.locator('.cowork-conversation-scroll').hover();
  await page.mouse.wheel(0, -100);
  await page.waitForTimeout(300);
  const anchor = await page.locator('.cowork-conversation-scroll').evaluate(scroller => {
    const bounds = scroller.getBoundingClientRect();
    const element = [...scroller.querySelectorAll('[data-turn-id]')].find(
      row => row.getBoundingClientRect().bottom > bounds.top + 8,
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
    .poll(async () => {
      const box = await page.locator(`[data-turn-id="${anchor.id}"]`).boundingBox();
      return box ? Math.abs(box.y - anchor.top) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(2);
  await page.waitForTimeout(300);
  const finalBox = await page.locator(`[data-turn-id="${anchor.id}"]`).boundingBox();
  expect(finalBox ? Math.abs(finalBox.y - anchor.top) : Number.POSITIVE_INFINITY).toBeLessThan(2);
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

test('virtualizes 1200 turns, jumps via navigator, and avoids pull-back during streaming when scrolled up', async ({
  page,
  baseURL,
}) => {
  const errors = [];
  attachConsoleGuards(page, errors, 'virtualization');
  await home(page, baseURL, previewSearch());
  await installConversation(page, historyMessages(1, 1200));

  const initialDomTurns = await page.locator('[data-turn-id]').count();
  expect(initialDomTurns).toBeGreaterThan(0);
  expect(initialDomTurns).toBeLessThan(60);

  // Scrolled at bottom -> streaming append keeps viewport pinned at end
  await page.evaluate(async () => {
    const { store } = await import(
      new URL('/src/renderer/store/index.ts', window.location.href).href
    );
    const { addMessage, updateSessionStatus } = await import(
      new URL('/src/renderer/store/slices/coworkSlice.ts', window.location.href).href
    );
    store.dispatch(
      updateSessionStatus({ sessionId: 'conversation-regression', status: 'running' }),
    );
    store.dispatch(
      addMessage({
        sessionId: 'conversation-regression',
        message: {
          id: 'u-stream',
          type: 'user',
          content: 'Stream status check',
          timestamp: Date.now(),
        },
      }),
    );
    store.dispatch(
      addMessage({
        sessionId: 'conversation-regression',
        message: {
          id: 'a-stream',
          type: 'assistant',
          content: 'Streaming first chunk',
          timestamp: Date.now() + 1,
          metadata: { isStreaming: true },
        },
      }),
    );
  });

  await expect(page.getByText('Streaming first chunk')).toBeVisible();

  // Scroll away from bottom (> 80px threshold) -> scroll-to-bottom button appears & no pull-back on deltas
  await page.locator('.cowork-conversation-scroll').evaluate(scroller => {
    scroller.scrollTop = Math.floor(scroller.scrollHeight * 0.4);
  });
  await page.waitForTimeout(200);
  const pausedTop = await page
    .locator('.cowork-conversation-scroll')
    .evaluate(scroller => scroller.scrollTop);

  await expect(
    page.locator('[data-testid="conversation-scroll-bottom"], button[aria-label]').last(),
  ).toBeVisible();

  for (let step = 1; step <= 4; step += 1) {
    await page.evaluate(async step => {
      const { store } = await import(
        new URL('/src/renderer/store/index.ts', window.location.href).href
      );
      const { updateMessageContents } = await import(
        new URL('/src/renderer/store/slices/coworkSlice.ts', window.location.href).href
      );
      store.dispatch(
        updateMessageContents([
          {
            sessionId: 'conversation-regression',
            messageId: 'a-stream',
            content: Array.from({ length: step * 5 }, (_, i) => `Streaming line ${i + 1}`).join(
              '\n\n',
            ),
          },
        ]),
      );
    }, step);
    await page.waitForTimeout(50);
  }

  const afterStreamTop = await page
    .locator('.cowork-conversation-scroll')
    .evaluate(scroller => scroller.scrollTop);
  expect(Math.abs(afterStreamTop - pausedTop)).toBeLessThan(8);

  // Turn navigator jumps cleanly across virtualized turns
  const nav = page.getByRole('navigation', { name: 'Conversation turns' });
  await nav.locator('button').nth(1).click();
  await expect(page.locator('[data-turn-index="1"]')).toBeVisible();
  expect(errors).toEqual([]);
});

test('persists inline @file mention JSON doc across session switches', async ({
  page,
  baseURL,
}) => {
  const errors = [];
  attachConsoleGuards(page, errors, 'mention-json');
  await home(page, baseURL, previewSearch());

  await page.evaluate(async () => {
    const { store } = await import(
      new URL('/src/renderer/store/index.ts', window.location.href).href
    );
    const { addDraftAttachment } = await import(
      new URL('/src/renderer/store/slices/coworkSlice.ts', window.location.href).href
    );
    store.dispatch(
      addDraftAttachment({
        draftKey: '__home__',
        attachment: {
          id: 'att-1',
          name: 'quarterly-chart.png',
          path: '/workspace/reports/quarterly-chart.png',
          mimeType: 'image/png',
          size: 2048,
        },
      }),
    );
  });

  const editor = page.getByRole('textbox').last();
  await editor.click();
  await editor.fill('@quarter');
  await expect(page.getByRole('option', { name: /quarterly-chart\.png/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('listbox')).toHaveCount(0);

  const mention = editor.locator('[data-type="mention"][data-mention-kind="file"]');
  await expect(mention).toHaveCount(1);
  await expect(mention).toHaveAttribute('data-id', '/workspace/reports/quarterly-chart.png');
  await editor.press('End');
  await page.keyboard.type('inspect chart');

  // Switch into a session and back Home -> draft JSON doc restores mention attrs faithfully
  await installConversation(page, historyMessages(1, 3));
  await expect(page.locator('[data-type="mention"]')).toHaveCount(0);

  await page.evaluate(async () => {
    const { store } = await import(
      new URL('/src/renderer/store/index.ts', window.location.href).href
    );
    const { clearCurrentSession } = await import(
      new URL('/src/renderer/store/slices/coworkSlice.ts', window.location.href).href
    );
    store.dispatch(clearCurrentSession());
  });

  const restoredMention = page
    .getByRole('textbox')
    .last()
    .locator('[data-type="mention"][data-mention-kind="file"]');
  await expect(restoredMention).toHaveCount(1);
  await expect(restoredMention).toHaveAttribute(
    'data-id',
    '/workspace/reports/quarterly-chart.png',
  );
  await expect(page.getByRole('textbox').last()).toContainText('inspect chart');
  expect(errors).toEqual([]);
});

test('decodes markdown and artifact panel images cleanly and recovers on retry', async ({
  page,
  baseURL,
}) => {
  const errors = [];
  attachConsoleGuards(page, errors, 'images');
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mP8z8DwHwMhwAQAF3AE/eS1Q7cAAAAASUVORK5CYII=',
    'base64',
  );
  let allowInline = false;
  await page.route('**/preview-chart.png*', async route => {
    if (!allowInline) {
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'image/png', body: tinyPng });
  });

  await home(page, baseURL, previewSearch());
  const artifactDataUrl = `data:image/png;base64,${tinyPng.toString('base64')}`;
  await installConversation(
    page,
    [
      { id: 'u-img', type: 'user', content: 'Generate chart', timestamp: 3000 },
      {
        id: 'a-img',
        type: 'assistant',
        content: 'Here is the chart:\n\n![Chart](https://preview.local/preview-chart.png)',
        timestamp: 3001,
      },
    ],
    [
      {
        id: 'art-img-1',
        type: 'image',
        title: 'chart.png',
        content: artifactDataUrl,
        messageId: 'a-img',
        createdAt: 3002,
      },
    ],
  );

  // First inline fetch fails -> retry button visible -> flip flag and recover image decode
  const retryButton = page
    .locator('[data-turn-id] button')
    .filter({ hasText: /Retry|重试/ })
    .first();
  await expect(retryButton).toBeVisible();
  errors.length = 0;
  allowInline = true;
  await retryButton.click();

  const inlineImg = page.locator('[data-turn-id] img').first();
  await expect
    .poll(() => inlineImg.evaluate(img => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);

  // Artifact panel also decodes the generated image cleanly
  const artifactToggle = page
    .locator('button[aria-label]')
    .filter({ has: page.locator('svg') })
    .first();
  await page.evaluate(async () => {
    const { store } = await import(
      new URL('/src/renderer/store/index.ts', window.location.href).href
    );
    const { togglePanel } = await import(
      new URL('/src/renderer/store/slices/artifactSlice.ts', window.location.href).href
    );
    store.dispatch(togglePanel());
  });
  void artifactToggle;
  const panelImg = page
    .locator('aside img, [data-artifact-panel] img, img[alt="chart.png"]')
    .first();
  await expect
    .poll(() => panelImg.evaluate(img => img.complete && img.naturalWidth))
    .toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
