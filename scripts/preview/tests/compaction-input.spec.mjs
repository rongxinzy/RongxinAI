import { expect, test } from '@playwright/test';
import { attachConsoleGuards, home, previewSearch } from '../shared/harness.mjs';
import { historyMessages, installConversation } from '../shared/conversationFixture.mjs';

for (const theme of ['light', 'dark']) {
  test(`compaction locks input, preserves drafts and keeps stop available in ${theme}`, async ({
    page,
    baseURL,
  }, testInfo) => {
    const errors = [];
    attachConsoleGuards(page, errors, 'compaction');
    await home(page, baseURL, previewSearch());
    await page.evaluate(async theme => {
      const { themeService } = await import('/src/renderer/services/theme.ts');
      themeService.setTheme(theme);
    }, theme);
    await installConversation(page, historyMessages(1, 1));
    const editor = page.locator('.cowork-prompt-editor');
    await editor.fill('Keep this unsent draft');
    const original = await editor.elementHandle();
    await page.evaluate(async () => {
      const { store } = await import('/src/renderer/store/index.ts');
      const { receiveRunSnapshot } = await import('/src/renderer/store/slices/coworkRunSlice.ts');
      const { CoworkRunPhase } = await import('/src/shared/cowork/runState.ts');
      const sessionId = store.getState().cowork.currentSession.id;
      const now = Date.now();
      const snapshot = {
        sessionId,
        runId: 'compaction-test',
        sequence: 1,
        running: true,
        phase: CoworkRunPhase.Compacting,
        startedAt: now - 40_000,
        confirmedAt: now - 40_000,
        lastProgressAt: now - 40_000,
      };
      window.__compactionSubmissions = 0;
      window.__compactionStops = 0;
      window.electron.cowork.continueSession = async () => {
        window.__compactionSubmissions++;
        return { success: true };
      };
      window.electron.cowork.enqueuePendingMessage = async () => {
        window.__compactionSubmissions++;
        return { success: true };
      };
      window.electron.cowork.stopSession = async () => {
        window.__compactionStops++;
        const current = store.getState().coworkRun.bySession[sessionId];
        store.dispatch(
          receiveRunSnapshot({
            ...current,
            sequence: current.sequence + 1,
            running: false,
            phase: CoworkRunPhase.Stopped,
          }),
        );
        return { success: true };
      };
      store.dispatch(receiveRunSnapshot(snapshot));
    });
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await expect(editor).toHaveText('Keep this unsent draft');
    const status = page.locator('[data-cowork-run-status]');
    await expect(status).toContainText('Compressing conversation context, please wait');
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeEnabled();
    await editor.press('Enter');
    expect(await page.evaluate(() => window.__compactionSubmissions)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath(`compaction-${theme}.png`) });
    await page.setViewportSize({ width: 760, height: 700 });
    await expect(status).toContainText('Compressing conversation context, please wait');
    await expect(editor).toHaveAttribute('contenteditable', 'false');
    await page.screenshot({ path: testInfo.outputPath(`compaction-${theme}-narrow.png`) });

    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    expect(await page.evaluate(() => window.__compactionStops)).toBe(1);
    await expect(status).toHaveCount(0);
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(editor).toHaveText('Keep this unsent draft');

    await page.evaluate(async () => {
      const { store } = await import('/src/renderer/store/index.ts');
      const { receiveRunSnapshot } = await import('/src/renderer/store/slices/coworkRunSlice.ts');
      const { CoworkRunPhase } = await import('/src/shared/cowork/runState.ts');
      const sessionId = store.getState().cowork.currentSession.id;
      const current = store.getState().coworkRun.bySession[sessionId];
      store.dispatch(
        receiveRunSnapshot({
          ...current,
          runId: 'second-compaction',
          sequence: 1,
          running: true,
          phase: CoworkRunPhase.Compacting,
          startedAt: Date.now(),
          confirmedAt: Date.now(),
        }),
      );
    });
    await expect(editor).toHaveAttribute('contenteditable', 'false');

    await page.evaluate(async () => {
      const { store } = await import('/src/renderer/store/index.ts');
      const { receiveRunSnapshot } = await import('/src/renderer/store/slices/coworkRunSlice.ts');
      const { CoworkRunPhase } = await import('/src/shared/cowork/runState.ts');
      const sessionId = store.getState().cowork.currentSession.id;
      const current = store.getState().coworkRun.bySession[sessionId];
      store.dispatch(
        receiveRunSnapshot({
          ...current,
          sequence: current.sequence + 1,
          phase: CoworkRunPhase.Waiting,
          confirmedAt: Date.now(),
        }),
      );
    });
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(editor).toHaveText('Keep this unsent draft');
    expect(await original.evaluate(node => node.isConnected)).toBe(true);
    await expect(status).toContainText('Running');
    await page.getByRole('button', { name: 'Stop', exact: true }).click();
    expect(await page.evaluate(() => window.__compactionStops)).toBe(2);
    await expect(status).toHaveCount(0);
    await expect(editor).toHaveAttribute('contenteditable', 'true');
    await expect(editor).toHaveText('Keep this unsent draft');
    expect(errors).toEqual([]);
  });
}
