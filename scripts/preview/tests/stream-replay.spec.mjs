import { expect, test } from '@playwright/test';

import {
  applyDeterministicRendering,
  attachConsoleGuards,
  home,
  previewSearch,
} from '../shared/harness.mjs';
import {
  LONG_TASK_THRESHOLD_MS,
  LONG_TASK_WARMUP_EXCLUSIONS,
  assertPrefixOf,
  findConversationScroller,
  normalizeReplayFinalCompare,
  normalizeReplayPlainText,
  previewStreamReplaySearch,
  runStreamReplay,
} from '../shared/streamReplay.mjs';

const GLM_FIXTURES = ['glm-tool-text-jsonl', 'glm-fresh-pr1127-jsonl-gz'];

async function startReplayPage(page, baseURL, fixtureId) {
  const search = previewStreamReplaySearch(fixtureId);
  await page.goto(`${baseURL}${search}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('log').waitFor({ timeout: 60_000 });
}

function assertNoBlankFlicker(samples) {
  let lastNonEmpty = '';
  for (const sample of samples) {
    const text = sample.text ?? '';
    if (text.trim().length === 0) {
      if (lastNonEmpty.trim().length > 24) {
        throw new Error('assistant text went blank mid-stream after content was shown');
      }
      continue;
    }
    if (lastNonEmpty && text.length + 8 < lastNonEmpty.length) {
      throw new Error('assistant text shrank abruptly mid-stream (possible flicker)');
    }
    lastNonEmpty = text;
  }
}

function assertLongTasks(longTasks, { ignoreTrailingMs = 400 } = {}) {
  const streamEnd =
    longTasks.length > 0 ? longTasks[longTasks.length - 1].startTime : Number.POSITIVE_INFINITY;
  const offenders = longTasks
    .slice(LONG_TASK_WARMUP_EXCLUSIONS)
    .filter(
      entry =>
        entry.duration > LONG_TASK_THRESHOLD_MS + 0.5 &&
        entry.startTime < streamEnd - ignoreTrailingMs,
    );
  if (offenders.length > 0) {
    throw new Error(
      `long task exceeded ${LONG_TASK_THRESHOLD_MS}ms (${offenders.length} after ${LONG_TASK_WARMUP_EXCLUSIONS} warmup exclusions): ${JSON.stringify(offenders.slice(0, 3))}`,
    );
  }
}

for (const fixtureId of GLM_FIXTURES) {
  test(`replays ${fixtureId} with prefix-safe assistant text`, async ({ page, baseURL }) => {
    const failures = [];
    attachConsoleGuards(page, failures, fixtureId);
    await applyDeterministicRendering(page);
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await startReplayPage(page, baseURL, fixtureId);
    const result = await runStreamReplay(page, { fixtureId });
    for (const sample of result.samples) {
      if (!sample.text || sample.text.trim().length === 0) continue;
      assertPrefixOf(sample.text, result.expectedFinalText, fixtureId);
    }
    assertNoBlankFlicker(result.samples);
    const finalText = result.samples.at(-1)?.text ?? '';
    expect(normalizeReplayFinalCompare(finalText)).toContain(
      normalizeReplayFinalCompare(result.expectedFinalText).slice(0, 48),
    );
    if (result.markers.toolBeforeAnswer) {
      const tool = page.locator('[data-tool-state]').first();
      const answer = page.locator('.is-assistant .theme-message-body').last();
      await expect(tool).toBeVisible();
      await expect(answer).toBeVisible();
      const toolBox = await tool.boundingBox();
      const answerBox = await answer.boundingBox();
      expect(toolBox?.y ?? 0).toBeLessThan(answerBox?.y ?? 0);
    }
    if (result.markers.thinkingBeforeAnswer) {
      const thinking = page.getByText(/Thought for|Reasoning|Thinking/i).first();
      const answer = page.locator('.is-assistant .theme-message-body').last();
      await expect(thinking).toBeVisible();
      await expect(answer).toBeVisible();
      const thinkingBox = await thinking.boundingBox();
      const answerBox = await answer.boundingBox();
      expect(thinkingBox?.y ?? 0).toBeLessThan(answerBox?.y ?? 0);
    }
    if (failures.length > 0) throw new Error(failures.join('\n'));
  });
}

test('503 auto-retry keeps a single answer bubble that keeps growing', async ({
  page,
  baseURL,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, '503-retry');
  await applyDeterministicRendering(page);
  await startReplayPage(page, baseURL, '503-auto-retry');
  const result = await runStreamReplay(page, { fixtureId: '503-auto-retry' });
  const bubbleCounts = result.samples.map(sample => sample.answerBubbles);
  expect(Math.max(...bubbleCounts)).toBe(1);
  const lengths = result.samples.map(sample => (sample.text ?? '').length);
  expect(Math.max(...lengths)).toBeGreaterThan(Math.min(...lengths.filter(length => length > 0)));
  expect(normalizeReplayPlainText(result.samples.at(-1)?.text ?? '')).toBe(
    normalizeReplayPlainText('Recovered'),
  );
  const retryGrowth = result.samples.some(
    (sample, index) =>
      index > 0 && (sample.text ?? '').length > (result.samples[index - 1]?.text ?? '').length,
  );
  expect(retryGrowth).toBe(true);
  const streamingDuringRetry = result.samples.some(
    sample => sample.assistantStreaming && (sample.text ?? '').length > 0,
  );
  expect(streamingDuringRetry).toBe(true);
  if (failures.length > 0) throw new Error(failures.join('\n'));
});

test('pins scroll to bottom while streaming by default', async ({ page, baseURL }) => {
  await applyDeterministicRendering(page);
  await startReplayPage(page, baseURL, 'synthetic-20000');
  const scroller = findConversationScroller(page);
  await runStreamReplay(page, { fixtureId: 'synthetic-20000', sampleIntervalMs: 32 });
  const pinnedBottom = await scroller.evaluate(el => {
    const maxScroll = Math.max(el.scrollHeight - el.clientHeight, 0);
    return Math.abs(el.scrollTop - maxScroll) <= 48;
  });
  expect(pinnedBottom).toBe(true);
  assertLongTasks(await page.evaluate(() => window.__previewStreamReplay?.longTasks ?? []));
});

test('holds scroll position when the user scrolls up mid-stream', async ({ page, baseURL }) => {
  await applyDeterministicRendering(page);
  await startReplayPage(page, baseURL, 'synthetic-20000');
  const scroller = findConversationScroller(page);
  await page.evaluate(() => window.__previewStreamReplay?.begin());
  await page.waitForFunction(() => {
    const el = document.querySelector('[role="log"] .overflow-y-auto');
    if (!el) return false;
    return el.scrollHeight > el.clientHeight + 120;
  });
  await scroller.evaluate(el => {
    const maxScroll = Math.max(el.scrollHeight - el.clientHeight, 0);
    el.scrollTop = Math.max(0, maxScroll - 120);
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
  });
  const before = await scroller.evaluate(el => el.scrollTop);
  const awayFromBottom = await scroller.evaluate(el => {
    const maxScroll = Math.max(el.scrollHeight - el.clientHeight, 0);
    return el.scrollTop < maxScroll - 48;
  });
  expect(awayFromBottom).toBe(true);
  await page.waitForFunction(() => window.__previewStreamReplay?.status === 'complete', {
    timeout: 120_000,
  });
  const stillAwayFromBottom = await scroller.evaluate(el => {
    const maxScroll = Math.max(el.scrollHeight - el.clientHeight, 0);
    return el.scrollTop < maxScroll - 48;
  });
  expect(stillAwayFromBottom).toBe(true);
});

test('default preview smoke still loads without stream replay params', async ({
  page,
  baseURL,
}) => {
  const failures = [];
  attachConsoleGuards(page, failures, 'default-smoke');
  await applyDeterministicRendering(page);
  const search = previewSearch({ skipBoot: true });
  await home(page, baseURL ?? 'http://127.0.0.1:5176/', search);
  if (failures.length > 0) throw new Error(failures.join('\n'));
});
