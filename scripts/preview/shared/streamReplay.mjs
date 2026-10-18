/** @typedef {'glm-tool-text-jsonl' | 'glm-fresh-pr1127-jsonl-gz' | '503-auto-retry' | 'synthetic-20000'} StreamReplayFixtureId */

const SCROLL_PIN_TOLERANCE_PX = 8;

const LONG_TASK_THRESHOLD_MS = 50;
/** Include long tasks that start within this window after replay end (finalize / markdown). */
const LONG_TASK_FINALIZE_WINDOW_MS = 250;

export function previewStreamReplaySearch(
  fixtureId,
  { skipBoot = true, scrollMutation = null } = {},
) {
  const params = new URLSearchParams();
  params.set('previewSkipBoot', skipBoot ? '1' : '0');
  params.set('previewStreamReplay', fixtureId);
  if (scrollMutation) {
    params.set('previewScrollMutation', scrollMutation);
  }
  return `?${params.toString()}`;
}

export function normalizeReplayPlainText(value) {
  return value
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function previewStreamReplayInstantSearch(fixtureId, { skipBoot = true } = {}) {
  const params = new URLSearchParams(previewStreamReplaySearch(fixtureId, { skipBoot }).slice(1));
  params.set('previewStreamReplayInstant', '1');
  return `?${params.toString()}`;
}

export async function readAssistantRenderedBody(page) {
  const body = page.locator('[role="log"] .group.is-assistant .theme-message-body').last();
  await body.waitFor({ state: 'attached', timeout: 60_000 });
  return body.innerText();
}

export function assertExactRenderedText(shown, expected, label) {
  const normalizedShown = normalizeReplayPlainText(shown);
  const normalizedExpected = normalizeReplayPlainText(expected);
  if (normalizedShown !== normalizedExpected) {
    throw new Error(
      `${label}: rendered assistant text mismatch (shown ${normalizedShown.length} chars, expected ${normalizedExpected.length} chars)`,
    );
  }
}

export function reportLongTasks(longTasks, { replayStartedAt, replayEndedAt } = {}) {
  const windowEnd = replayEndedAt + LONG_TASK_FINALIZE_WINDOW_MS;
  const inWindow = longTasks.filter(
    entry => entry.startTime >= replayStartedAt && entry.startTime <= windowEnd,
  );
  let maxLongTaskMs = 0;
  for (const entry of inWindow) {
    if (entry.duration > maxLongTaskMs) maxLongTaskMs = entry.duration;
  }
  const offenders = inWindow.filter(entry => entry.duration > LONG_TASK_THRESHOLD_MS + 0.5);
  return { maxLongTaskMs, offenders, sampleCount: inWindow.length, windowEnd };
}

export function assertPrefixOf(shown, expected, label) {
  const normalizedShown = normalizeReplayPlainText(shown);
  const normalizedExpected = normalizeReplayPlainText(expected);
  if (!normalizedExpected.startsWith(normalizedShown)) {
    throw new Error(
      `${label}: visible assistant text is not a prefix of the final text (shown length ${normalizedShown.length}, final ${normalizedExpected.length})`,
    );
  }
}

export function findConversationScroller(page) {
  return page
    .locator('[role="log"]')
    .locator('.cowork-conversation-scroll, .overflow-y-auto')
    .first();
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {{ fixtureId: StreamReplayFixtureId, mode?: 'stepped' | 'realtime', sampleIntervalMs?: number }} options
 */
export async function runStreamReplay(
  page,
  { fixtureId, mode = 'stepped', sampleIntervalMs = 16 },
) {
  return page.evaluate(
    async ({ fixtureId: id, mode: replayMode, sampleIntervalMs: interval }) => {
      const SCROLL_TOLERANCE = 8;
      const waitAnimationFrames = count =>
        new Promise(resolve => {
          let remaining = count;
          const tick = () => {
            remaining -= 1;
            if (remaining <= 0) resolve(undefined);
            else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        });

      const readAssistantFromDom = () => {
        const answerNodes = [...document.querySelectorAll('[role="log"] .group.is-assistant')];
        const last = answerNodes.at(-1);
        const body = last?.querySelector('.theme-message-body');
        const text = body?.innerText ?? '';
        return {
          text,
          answerBubbles: answerNodes.length,
        };
      };

      const readTurnOrder = () => {
        const log = document.querySelector('[role="log"]');
        if (!log) {
          return { thinkingIndex: -1, toolIndex: -1, answerIndex: -1, itemCount: 0 };
        }
        const items = [
          ...log.querySelectorAll(
            '[data-tool-state], [data-tool-name], [data-slot="tool"], .is-assistant, .theme-fold-reasoning',
          ),
        ];
        const thinkingIndex = items.findIndex(node => node.matches('.theme-fold-reasoning'));
        const toolIndex = items.findIndex(node =>
          node.matches('[data-tool-state], [data-tool-name], [data-slot="tool"]'),
        );
        const answerIndex = items.findIndex(node => node.classList.contains('is-assistant'));
        return { thinkingIndex, toolIndex, answerIndex, itemCount: items.length };
      };

      const readScrollerMetrics = scroller => {
        if (!scroller) {
          return {
            scrollTop: 0,
            scrollHeight: 0,
            clientHeight: 0,
            distanceFromBottom: 0,
            pinned: true,
            overflow: false,
          };
        }
        const scrollTop = scroller.scrollTop;
        const scrollHeight = scroller.scrollHeight;
        const clientHeight = scroller.clientHeight;
        const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
        const overflow = scrollHeight > clientHeight + 16;
        return {
          scrollTop,
          scrollHeight,
          clientHeight,
          distanceFromBottom,
          pinned: distanceFromBottom <= SCROLL_TOLERANCE,
          overflow,
        };
      };

      const resolveScroller = () =>
        document.querySelector('[role="log"] .cowork-conversation-scroll') ??
        document.querySelector('[role="log"] .overflow-y-auto');

      const pushSample = (samples, controller, extra = {}) => {
        const scroller = resolveScroller();
        const assistant = readAssistantFromDom();
        const scroll = readScrollerMetrics(scroller);
        samples.push({
          at: performance.now(),
          status: controller.status,
          phase: controller.replayPhase ?? 'idle',
          ...assistant,
          ...scroll,
          ...extra,
        });
      };

      const controller = window.__previewStreamReplay;
      if (!controller || controller.fixtureId !== id) {
        throw new Error('preview stream replay controller is unavailable');
      }

      const samples = [];

      if (replayMode === 'stepped') {
        controller.beginStepped();
        pushSample(samples, controller, { step: 0 });
        let stepIndex = 0;
        while (controller.step()) {
          stepIndex += 1;
          pushSample(samples, controller, { step: stepIndex, samplePhase: 'post-step-sync' });
          await waitAnimationFrames(1);
          pushSample(samples, controller, { step: stepIndex, samplePhase: 'post-step-raf1' });
          await waitAnimationFrames(1);
          pushSample(samples, controller, { step: stepIndex, samplePhase: 'post-step-raf2' });
          await waitAnimationFrames(1);
          pushSample(samples, controller, { step: stepIndex, samplePhase: 'post-step-raf3' });
        }
        await waitAnimationFrames(3);
        pushSample(samples, controller, {
          step: stepIndex + 1,
          final: true,
          samplePhase: 'finalize',
        });
      } else {
        return new Promise((resolve, reject) => {
          let poll = null;
          poll = window.setInterval(() => {
            pushSample(samples, controller);
          }, interval);
          controller.begin();
          const timeout = window.setTimeout(
            () => reject(new Error('stream replay timed out')),
            120_000,
          );
          const check = () => {
            if (controller.status === 'complete') {
              window.clearTimeout(timeout);
              window.clearInterval(poll);
              pushSample(samples, controller, { final: true });
              resolve(buildResult());
              return;
            }
            requestAnimationFrame(check);
          };
          check();
        });
      }

      function buildResult() {
        const longTasks = controller.longTasks ?? [];
        const replayStartedAt = controller.replayStartedAt ?? 0;
        const replayEndedAt = controller.replayEndedAt ?? performance.now();
        const windowEnd = replayEndedAt + 250;
        let maxLongTaskMs = 0;
        for (const entry of longTasks) {
          if (entry.startTime < replayStartedAt || entry.startTime > windowEnd) continue;
          if (entry.duration > maxLongTaskMs) maxLongTaskMs = entry.duration;
        }
        return {
          samples,
          scrollSamples: samples,
          order: readTurnOrder(),
          longTasks,
          maxLongTaskMs,
          replayStartedAt,
          replayEndedAt,
          expectedFinalText: controller.trace.expectedFinalText,
          markers: controller.trace.markers,
          mode: replayMode,
          eventsEmitted: controller.eventsEmitted,
          eventCount: controller.eventCount,
        };
      }

      return buildResult();
    },
    { fixtureId, mode, sampleIntervalMs },
  );
}

export function assertStreamingScrollPinned(
  samples,
  { tolerancePx = SCROLL_PIN_TOLERANCE_PX, requireOverflowSamples = true } = {},
) {
  const streaming = samples.filter(
    sample =>
      sample.status === 'streaming' &&
      sample.overflow === true &&
      (sample.text ?? '').trim().length > 8 &&
      sample.samplePhase === 'post-step-raf3',
  );
  if (streaming.length === 0) {
    if (!requireOverflowSamples) return;
    throw new Error('expected streaming samples with scroll overflow and visible assistant text');
  }
  const unpinned = streaming.filter(sample => sample.distanceFromBottom > tolerancePx);
  if (unpinned.length > 0) {
    const worst = unpinned.reduce(
      (max, sample) => (sample.distanceFromBottom > max.distanceFromBottom ? sample : max),
      unpinned[0],
    );
    throw new Error(
      `scroll was not pinned during streaming (${unpinned.length}/${streaming.length} samples unpinned, worst gap ${worst.distanceFromBottom.toFixed(1)}px at step ${worst.step ?? '?'})`,
    );
  }

  let previousHeight = 0;
  let previousTop = 0;
  for (const sample of streaming) {
    const heightDelta = sample.scrollHeight - previousHeight;
    const topDelta = sample.scrollTop - previousTop;
    if (previousHeight > 0 && heightDelta > 48 && topDelta < heightDelta - tolerancePx * 2) {
      throw new Error(
        `scrollTop did not track scrollHeight growth during streaming (height +${heightDelta.toFixed(0)}px, scrollTop +${topDelta.toFixed(0)}px at step ${sample.step ?? '?'})`,
      );
    }
    previousHeight = sample.scrollHeight;
    previousTop = sample.scrollTop;
  }
}
