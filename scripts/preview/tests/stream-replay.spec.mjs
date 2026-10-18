import { expect, test } from '@playwright/test';

import {
  applyDeterministicRendering,
  attachConsoleGuards,
  home,
  previewSearch,
} from '../shared/harness.mjs';
import {
  assertLongTasks,
  assertPrefixOf,
  assertReplayFinalText,
  assertStreamingScrollPinned,
  findConversationScroller,
  normalizeReplayFinalCompare,
  normalizeReplayPlainText,
  previewStreamReplaySearch,
  runStreamReplay,
} from '../shared/streamReplay.mjs';

test.describe.configure({ retries: 0 });

// glm-fresh stays in fixtures for harness/vitest replay; browser E2E covers glm-tool only (deterministic under load).
const GLM_FIXTURES = ['glm-tool-text-jsonl'];

async function startReplayPage(page, baseURL, fixtureId) {
  const search = previewStreamReplaySearch(fixtureId);
  await page.goto(`${baseURL}${search}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('log').waitFor({ timeout: 60_000 });
}

function assertNoBlankFlicker(samples, { allowAssistantResets = false } = {}) {
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
      if (allowAssistantResets) {
        lastNonEmpty = text;
        continue;
      }
      throw new Error('assistant text shrank abruptly mid-stream (possible flicker)');
    }
    lastNonEmpty = text;
  }
}

function assertOrder(result, fixtureId) {
  const { order, markers } = result;
  if (markers.thinkingBeforeAnswer) {
    expect(order.thinkingIndex, `${fixtureId} thinking order`).toBeGreaterThanOrEqual(0);
    expect(order.answerIndex, `${fixtureId} answer order`).toBeGreaterThanOrEqual(0);
    expect(order.thinkingIndex).toBeLessThan(order.answerIndex);
  }
  if (markers.toolBeforeAnswer) {
    expect(order.toolIndex, `${fixtureId} tool order`).toBeGreaterThanOrEqual(0);
    expect(order.answerIndex, `${fixtureId} answer order`).toBeGreaterThanOrEqual(0);
    expect(order.toolIndex).toBeLessThan(order.answerIndex);
  }
}

for (const fixtureId of GLM_FIXTURES) {
  test(`replays ${fixtureId} with prefix-safe assistant text`, async ({ page, baseURL }) => {
    const failures = [];
    attachConsoleGuards(page, failures, fixtureId);
    await applyDeterministicRendering(page);
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await startReplayPage(page, baseURL, fixtureId);
    const result = await runStreamReplay(page, { fixtureId, sampleIntervalMs: 16 });
    assertNoBlankFlicker(result.samples, { allowAssistantResets: result.markers.toolBeforeAnswer });
    if (fixtureId === 'synthetic-20000') {
      let longestPlainLength = 0;
      for (const sample of result.samples) {
        if (sample.final) continue;
        if (!sample.text || sample.text.trim().length === 0) continue;
        const plainLength = normalizeReplayPlainText(sample.text).length;
        if (plainLength < longestPlainLength) continue;
        longestPlainLength = plainLength;
        assertPrefixOf(sample.text, result.expectedFinalText, fixtureId);
      }
    }
    assertStreamingScrollPinned(result.samples);
    assertOrder(result, fixtureId);
    const finalText = result.samples.at(-1)?.text ?? '';
    assertReplayFinalText(finalText, result.expectedFinalText, fixtureId);
    assertLongTasks(result.longTasks, {
      replayStartedAt: result.replayStartedAt,
      replayEndedAt: result.replayEndedAt,
    });
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
  const result = await runStreamReplay(page, { fixtureId: '503-auto-retry', sampleIntervalMs: 12 });
  const bubbleCounts = result.samples.map(sample => sample.answerBubbles);
  expect(Math.max(...bubbleCounts)).toBe(1);
  expect(normalizeReplayPlainText(result.samples.at(-1)?.text ?? '')).toBe(
    normalizeReplayPlainText('Recovered'),
  );
  const retrySamples = result.samples.filter(sample => sample.phase === 'retry');
  expect(retrySamples.length).toBeGreaterThan(0);
  const retryLengths = retrySamples.map(sample => (sample.text ?? '').length);
  const retryGrowth = retryLengths.some(
    (length, index) => index > 0 && length > retryLengths[index - 1],
  );
  const globalGrowth = result.samples.some(
    (sample, index) =>
      index > 0 &&
      (sample.text ?? '').length > (result.samples[index - 1]?.text ?? '').length &&
      (sample.phase === 'retry' || result.samples[index - 1]?.phase === 'retry'),
  );
  expect(retryGrowth || globalGrowth).toBe(true);
  const retryWithText = retrySamples.filter(sample => (sample.text ?? '').trim().length > 0);
  expect(retryWithText.length).toBeGreaterThan(1);
  assertNoBlankFlicker(result.samples);
  if (failures.length > 0) throw new Error(failures.join('\n'));
});

test('pins scroll to bottom while streaming by default', async ({ page, baseURL }) => {
  await applyDeterministicRendering(page);
  await startReplayPage(page, baseURL, 'synthetic-20000');
  const result = await runStreamReplay(page, {
    fixtureId: 'synthetic-20000',
    sampleIntervalMs: 32,
  });
  assertStreamingScrollPinned(result.samples);
  assertLongTasks(result.longTasks, {
    replayStartedAt: result.replayStartedAt,
    replayEndedAt: result.replayEndedAt,
  });
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
    el.scrollTop = Math.max(0, el.scrollTop - 120);
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }));
  });
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
