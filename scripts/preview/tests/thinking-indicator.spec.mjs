import { expect, test } from '@playwright/test';

import { CodingEventKind, CodingLaneStatus } from '../../../src/shared/codingAgent/constants.ts';
import { attachConsoleGuards, home, previewSearch } from '../shared/harness.mjs';

const indicator = (page, variant) =>
  page.locator(`.theme-thinking-indicator[data-variant="${variant}"] canvas`).first();

async function openWaitingCodingTurn(page, baseURL, theme, reducedMotion = 'reduce') {
  await page.emulateMedia({ colorScheme: theme, reducedMotion });
  await home(page, baseURL, previewSearch({ scenario: 'coding' }));
  await page.evaluate(
    async ({ theme, messageKind, completedStatus }) => {
      const { themeService } = await import(
        new URL('/src/renderer/services/theme.ts', window.location.href).href
      );
      themeService.setTheme(theme);
      const api = window.electron.codingAgent;
      const bootstrap = api.bootstrap;
      const listeners = new Set();
      let originalSnapshot;
      // Hold the real preview at the first user event so its otherwise brief
      // 32px working indicator can be tested without changing product fixtures.
      api.bootstrap = async (...args) => {
        const result = await bootstrap(...args);
        originalSnapshot = structuredClone(result.snapshot);
        return {
          ...result,
          snapshot: {
            ...result.snapshot,
            events: result.snapshot.events.filter(event => event.kind === messageKind),
          },
        };
      };
      api.onChanged = listener => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      };
      api.onEventDelta = () => () => {};
      window.__thinkingIndicatorPreview = {
        showReasoning(completed = false) {
          const snapshot = structuredClone(originalSnapshot);
          if (completed) {
            for (const lane of snapshot.lanes) lane.status = completedStatus;
          }
          for (const listener of listeners) listener(snapshot);
        },
      };
    },
    { theme, messageKind: CodingEventKind.Message, completedStatus: CodingLaneStatus.Completed },
  );
  await page.getByRole('button', { name: 'Coding', exact: true }).click();
  await expect(indicator(page, 'companion')).toBeVisible();
}

async function bitmap(canvas) {
  return canvas.evaluate(element => element.toDataURL());
}

async function pixelColor(canvas) {
  return canvas.evaluate(element => {
    const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
    const totals = [0, 0, 0];
    let count = 0;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset + 3] < 32) continue;
      for (let channel = 0; channel < 3; channel += 1) totals[channel] += pixels[offset + channel];
      count += 1;
    }
    return { count, channels: totals.map(value => Math.round(value / Math.max(1, count))) };
  });
}

async function applyRecipe(page, { theme, variant, color, size }) {
  await page.evaluate(
    async ({ theme, variant, color, size }) => {
      const [{ allThemes }, { themeService }] = await Promise.all([
        import(new URL('/src/renderer/theme/index.ts', window.location.href).href),
        import(new URL('/src/renderer/services/theme.ts', window.location.href).href),
      ]);
      const recipe = allThemes.find(item => item.meta.appearance === theme).components[
        `thinking-indicator-${variant}`
      ];
      if (color) recipe.base.color = color;
      if (size) recipe.base.width = recipe.base.height = `${size}px`;
      // Reapply the current theme: stylesheet replacement must repaint a paused
      // canvas even when the appearance and React component identity stay equal.
      themeService.setTheme(theme);
    },
    { theme, variant, color, size },
  );
}

async function setTheme(page, theme) {
  await page.evaluate(async theme => {
    const { themeService } = await import(
      new URL('/src/renderer/services/theme.ts', window.location.href).href
    );
    themeService.setTheme(theme);
  }, theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', `zenith-${theme}`);
}

async function expectSquare(canvas, pixels) {
  await expect(canvas).toHaveCSS('width', `${pixels}px`);
  await expect(canvas).toHaveCSS('height', `${pixels}px`);
  const bounds = await canvas.boundingBox();
  expect(bounds.width).toBe(pixels);
  expect(bounds.height).toBe(pixels);
}

for (const theme of ['light', 'dark']) {
  test(`thinking indicators follow theme recipes without replacing controls in ${theme}`, async ({
    page,
    baseURL,
  }, testInfo) => {
    const failures = [];
    attachConsoleGuards(page, failures, `thinking ${theme}`);
    await page.setViewportSize({ width: 1280, height: 800 });
    await openWaitingCodingTurn(page, baseURL, theme);
    const companion = indicator(page, 'companion');
    await expectSquare(companion, 32);
    await expect.poll(async () => (await pixelColor(companion)).count).toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath(`thinking-${theme}-companion-1280x800.png`),
    });
    const companionNode = await companion.elementHandle();
    const initialCompanion = await bitmap(companion);
    await applyRecipe(page, { theme, variant: 'companion', color: '#b3261e', size: 36 });
    await expectSquare(companion, 36);
    await expect(companion.locator('..')).toHaveCSS('color', 'rgb(179, 38, 30)');
    await expect.poll(() => bitmap(companion)).not.toBe(initialCompanion);
    await expect
      .poll(async () => {
        const { channels } = await pixelColor(companion);
        return channels[0] - channels[1];
      })
      .toBeGreaterThan(20);
    expect(await companion.evaluate((node, previous) => node === previous, companionNode)).toBe(
      true,
    );
    const staticCompanion = await bitmap(companion);
    await page.waitForTimeout(120);
    expect(await bitmap(companion)).toBe(staticCompanion);

    await page.evaluate(() => window.__thinkingIndicatorPreview.showReasoning());
    const inline = indicator(page, 'inline');
    await expectSquare(inline, 20);
    const inlineNode = await inline.elementHandle();
    const trigger = page.locator('.theme-fold-reasoning').first();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('先扫描目录结构，再按模块给出重构优先级。')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`thinking-${theme}-inline-1280x800.png`) });
    const triggerNode = await trigger.elementHandle();
    const initialInline = await bitmap(inline);
    await applyRecipe(page, { theme, variant: 'inline', color: '#b3261e', size: 24 });
    await expectSquare(inline, 24);
    await expect.poll(() => bitmap(inline)).not.toBe(initialInline);
    await expect
      .poll(async () => {
        const { channels } = await pixelColor(inline);
        return channels[0] - channels[1];
      })
      .toBeGreaterThan(20);
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await inline.evaluate((node, previous) => node === previous, inlineNode)).toBe(true);
    expect(await trigger.evaluate((node, previous) => node === previous, triggerNode)).toBe(true);

    const editor = page.locator('textarea').last();
    await editor.fill('Keep this draft / 保留这份草稿');
    await editor.focus();
    await editor.evaluate(element => element.setSelectionRange(5, 15));
    const editorNode = await editor.elementHandle();
    const opposite = theme === 'light' ? 'dark' : 'light';
    const beforeThemeSwitch = await bitmap(inline);
    await setTheme(page, opposite);
    await expectSquare(inline, 20);
    await expect.poll(() => bitmap(inline)).not.toBe(beforeThemeSwitch);
    await expect(editor).toHaveValue('Keep this draft / 保留这份草稿');
    await expect(editor).toBeFocused();
    expect(
      await editor.evaluate(element => [element.selectionStart, element.selectionEnd]),
    ).toEqual([5, 15]);
    expect(await editor.evaluate((node, previous) => node === previous, editorNode)).toBe(true);
    expect(await inline.evaluate((node, previous) => node === previous, inlineNode)).toBe(true);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await setTheme(page, theme);
    await expectSquare(inline, 24);
    await applyRecipe(page, {
      theme,
      variant: 'inline',
      color: 'var(--muted-foreground)',
      size: 20,
    });
    await expectSquare(inline, 20);
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [940, 700],
      [760, 700],
    ]) {
      await page.setViewportSize({ width, height });
      await expectSquare(inline, 20);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      );
    }
    await page.screenshot({ path: testInfo.outputPath(`thinking-${theme}-760x700.png`) });
    expect(failures).toEqual([]);
  });
}

test('thinking animation stops on completion and under reduced motion', async ({
  page,
  baseURL,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'thinking motion');
  await openWaitingCodingTurn(page, baseURL, 'light', 'no-preference');
  const companion = indicator(page, 'companion');
  const firstCompanion = await bitmap(companion);
  await expect.poll(() => bitmap(companion)).not.toBe(firstCompanion);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const reducedCompanion = await bitmap(companion);
  await page.waitForTimeout(120);
  expect(await bitmap(companion)).toBe(reducedCompanion);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(() => bitmap(companion)).not.toBe(reducedCompanion);

  await page.evaluate(() => window.__thinkingIndicatorPreview.showReasoning());
  const inline = indicator(page, 'inline');
  await expect(inline).toBeVisible();
  const inlineNode = await inline.elementHandle();
  const firstInline = await bitmap(inline);
  await expect.poll(() => bitmap(inline)).not.toBe(firstInline);
  await page.evaluate(() => window.__thinkingIndicatorPreview.showReasoning(true));
  await page.waitForTimeout(100);
  const pausedInline = await bitmap(inline);
  await page.waitForTimeout(160);
  expect(await bitmap(inline)).toBe(pausedInline);
  expect(await inline.evaluate((node, previous) => node === previous, inlineNode)).toBe(true);
  await applyRecipe(page, { theme: 'light', variant: 'inline', color: '#176b31' });
  await expect.poll(() => bitmap(inline)).not.toBe(pausedInline);
  const recoloredPausedInline = await bitmap(inline);
  await page.waitForTimeout(160);
  expect(await bitmap(inline)).toBe(recoloredPausedInline);
  await page.evaluate(() => window.__thinkingIndicatorPreview.showReasoning());
  await expect.poll(() => bitmap(inline)).not.toBe(recoloredPausedInline);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForTimeout(100);
  const reducedInline = await bitmap(inline);
  await page.waitForTimeout(160);
  expect(await bitmap(inline)).toBe(reducedInline);
  expect(failures).toEqual([]);
});
