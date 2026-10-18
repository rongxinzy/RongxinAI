import { expect, test } from '@playwright/test';

import {
  applyDeterministicRendering,
  attachConsoleGuards,
  home,
  previewSearch,
} from '../shared/harness.mjs';
import {
  assertExactRenderedText,
  assertPrefixOf,
  assertStreamingScrollPinned,
  findConversationScroller,
  normalizeReplayPlainText,
  previewStreamReplayInstantSearch,
  previewStreamReplaySearch,
  readAssistantRenderedBody,
  reportLongTasks,
  runStreamReplay,
} from '../shared/streamReplay.mjs';

test.describe.configure({ retries: 0 });

const GLM_FIXTURES = ['glm-tool-text-jsonl', 'glm-fresh-pr1127-jsonl-gz'];

async function startReplayPage(page, baseURL, fixtureId, { scrollMutation = null } = {}) {
  const search = previewStreamReplaySearch(fixtureId, { scrollMutation });
  await page.goto(`${baseURL}${search}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('log').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__previewCoworkStreamReady === true, undefined, {
    timeout: 120_000,
  });
}

async function readFullParseBaseline(page, baseURL, fixtureId) {
  const search = previewStreamReplayInstantSearch(fixtureId);
  await page.goto(`${baseURL}${search}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('log').waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => window.__previewCoworkStreamReady === true, undefined, {
    timeout: 120_000,
  });
  await page.evaluate(async () => {
    const controller = window.__previewStreamReplay;
    if (!controller) throw new Error('missing replay controller');
    if (controller.status === 'idle') {
      controller.beginStepped();
      while (controller.step()) {
        await new Promise(resolve => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        });
      }
    }
    if (controller.status !== 'complete') {
      throw new Error(`stream replay did not complete (status=${controller.status})`);
    }
    await new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  });
  return readAssistantRenderedBody(page);
}

async function assertRenderedMatchesFullParse(page, baseURL, fixtureId, streamedText, label) {
  const baseline = await readFullParseBaseline(page, baseURL, fixtureId);
  assertExactRenderedText(streamedText, baseline, label);
}

function expectScrollPinFailure(result) {
  let threw = false;
  try {
    assertStreamingScrollPinned(result.samples);
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
}

function annotateLongTasks(testInfo, fixtureId, result) {
  const report = reportLongTasks(result.longTasks, {
    replayStartedAt: result.replayStartedAt,
    replayEndedAt: result.replayEndedAt,
  });
  testInfo.annotations.push({
    type: 'maxLongTaskMs',
    description: `${fixtureId}: ${report.maxLongTaskMs.toFixed(1)}ms (report-only)`,
  });
  if (report.offenders.length > 0) {
    testInfo.annotations.push({
      type: 'longTaskOffenders',
      description: JSON.stringify(report.offenders.slice(0, 5)),
    });
  }
}

function assertNoBlankFlicker(samples, { allowAssistantResets = false } = {}) {
  let lastNonEmpty = '';
  for (const sample of samples) {
    const text = sample.text ?? '';
    if (text.trim().length === 0) continue;
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

function assertMonotonicRetryGrowth(samples) {
  const retrySamples = samples.filter(sample => sample.phase === 'retry');
  expect(retrySamples.length).toBeGreaterThan(0);
  let lastLength = 0;
  let sawIncrease = false;
  for (const sample of retrySamples) {
    const length = normalizeReplayPlainText(sample.text ?? '').length;
    if (length === 0) continue;
    if (lastLength > 0 && length > lastLength) sawIncrease = true;
    if (lastLength > 0 && length < lastLength) {
      throw new Error(
        `503 retry text shrank at step ${sample.step ?? '?'} (${length} after ${lastLength})`,
      );
    }
    lastLength = Math.max(lastLength, length);
  }
  expect(sawIncrease).toBe(true);
}

for (const fixtureId of GLM_FIXTURES) {
  test(`replays ${fixtureId} with prefix-safe assistant text`, async ({
    page,
    baseURL,
  }, testInfo) => {
    const failures = [];
    attachConsoleGuards(page, failures, fixtureId);
    await applyDeterministicRendering(page);
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await startReplayPage(page, baseURL, fixtureId);
    const result = await runStreamReplay(page, { fixtureId, mode: 'stepped' });
    expect(result.eventsEmitted).toBe(result.eventCount);
    assertStreamingScrollPinned(result.samples);
    assertOrder(result, fixtureId);
    const streamedText = await readAssistantRenderedBody(page);
    assertNoBlankFlicker(result.samples, { allowAssistantResets: result.markers.toolBeforeAnswer });
    await assertRenderedMatchesFullParse(page, baseURL, fixtureId, streamedText, fixtureId);
    annotateLongTasks(testInfo, fixtureId, result);
    if (failures.length > 0) throw new Error(failures.join('\n'));
  });
}

test('503 auto-retry keeps a single answer bubble that keeps growing', async ({
  page,
  baseURL,
}, testInfo) => {
  const failures = [];
  attachConsoleGuards(page, failures, '503-retry');
  await applyDeterministicRendering(page);
  await startReplayPage(page, baseURL, '503-auto-retry');
  const result = await runStreamReplay(page, { fixtureId: '503-auto-retry', mode: 'stepped' });
  const bubbleCounts = result.samples.map(sample => sample.answerBubbles);
  expect(Math.max(...bubbleCounts)).toBe(1);
  const streamedText = await readAssistantRenderedBody(page);
  await assertRenderedMatchesFullParse(
    page,
    baseURL,
    '503-auto-retry',
    streamedText,
    '503-auto-retry',
  );
  assertStreamingScrollPinned(result.samples, { requireOverflowSamples: false });
  assertMonotonicRetryGrowth(result.samples);
  assertNoBlankFlicker(result.samples);
  annotateLongTasks(testInfo, '503-auto-retry', result);
  if (failures.length > 0) throw new Error(failures.join('\n'));
});

test.fixme('scroll pin gate catches pure stopScroll every 30ms (StickToBottom vs VTL — follow-up PR)', async () => {
  // Main uses both StickToBottom and VirtualizedTurnList tail compensation; a pure
  // stopScroll() interval does not break pin without production hooks (deferred).
});

test('scroll pin gate catches forced scroll-away sabotage', async ({ page, baseURL }) => {
  await applyDeterministicRendering(page);
  await startReplayPage(page, baseURL, 'synthetic-20000', { scrollMutation: 'no-tail-follow' });
  const result = await runStreamReplay(page, { fixtureId: 'synthetic-20000', mode: 'stepped' });
  expectScrollPinFailure(result);
});

test('pins scroll to bottom while streaming by default', async ({ page, baseURL }, testInfo) => {
  await applyDeterministicRendering(page);
  await startReplayPage(page, baseURL, 'synthetic-20000');
  const result = await runStreamReplay(page, { fixtureId: 'synthetic-20000', mode: 'stepped' });
  assertStreamingScrollPinned(result.samples);
  const maxScrollGap = Math.max(...result.samples.map(sample => sample.distanceFromBottom ?? 0));
  annotateLongTasks(testInfo, 'synthetic-20000', result);
  test.info().annotations.push({
    type: 'maxScrollGapPx',
    description: String(maxScrollGap.toFixed(1)),
  });
});

test('realtime replay smoke matches full-parse rendered text', async ({ page, baseURL }) => {
  await applyDeterministicRendering(page);
  await startReplayPage(page, baseURL, '503-auto-retry');
  const result = await runStreamReplay(page, {
    fixtureId: '503-auto-retry',
    mode: 'realtime',
    sampleIntervalMs: 24,
  });
  const streamedText = result.samples.at(-1)?.text ?? '';
  await assertRenderedMatchesFullParse(
    page,
    baseURL,
    '503-auto-retry',
    streamedText,
    '503-realtime-smoke',
  );
});

test('holds scroll position when the user scrolls up mid-stream', async ({ page, baseURL }) => {
  await applyDeterministicRendering(page);
  await startReplayPage(page, baseURL, 'synthetic-20000');
  const scroller = findConversationScroller(page);
  await page.evaluate(async () => {
    const controller = window.__previewStreamReplay;
    if (!controller) throw new Error('missing replay controller');
    controller.beginStepped();
    while (controller.step()) {
      await new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
      const el =
        document.querySelector('[role="log"] .cowork-conversation-scroll') ??
        document.querySelector('[role="log"] .overflow-y-auto');
      if (el && el.scrollHeight > el.clientHeight + 120) break;
    }
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
  await page.evaluate(async () => {
    const controller = window.__previewStreamReplay;
    if (!controller) throw new Error('missing replay controller');
    while (controller.step()) {
      await new Promise(resolve => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    }
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
