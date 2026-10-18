/** @typedef {'glm-tool-text-jsonl' | 'glm-fresh-pr1127-jsonl-gz' | '503-auto-retry' | 'synthetic-20000'} StreamReplayFixtureId */

const LONG_TASK_THRESHOLD_MS = 50;
/** Ignore the first N long tasks after replay start (boot/layout warmup). */
const LONG_TASK_WARMUP_EXCLUSIONS = 2;
/** Include long tasks that start within this window after replay end (finalize / markdown). */
const LONG_TASK_FINALIZE_WINDOW_MS = 250;

export function previewStreamReplaySearch(fixtureId, { skipBoot = true } = {}) {
  const params = new URLSearchParams();
  params.set('previewSkipBoot', skipBoot ? '1' : '0');
  params.set('previewStreamReplay', fixtureId);
  return `?${params.toString()}`;
}

export function normalizeReplayPlainText(value) {
  return value
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeReplayFinalCompare(value) {
  return normalizeReplayPlainText(value)
    .replace(/https:\/\/zr-local\.path\/open\?path=/gi, '')
    .replace(/[`*_>#~[\]()!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  return page.locator('[role="log"]').locator('.overflow-y-auto').first();
}

export async function runStreamReplay(page, { fixtureId, sampleIntervalMs = 48 }) {
  return page.evaluate(
    async ({ fixtureId: id, sampleIntervalMs: interval }) => {
      const readAssistantFromDom = () => {
        const answerNodes = [...document.querySelectorAll('[role="log"] .is-assistant')];
        const last = answerNodes.at(-1);
        const body = last?.querySelector('.theme-message-body');
        const text = body?.innerText ?? last?.innerText ?? '';
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
      const isPinnedToBottom = scroller => {
        if (!scroller) return true;
        const maxScroll = Math.max(scroller.scrollHeight - scroller.clientHeight, 0);
        return Math.abs(scroller.scrollTop - maxScroll) <= 48;
      };
      const controller = window.__previewStreamReplay;
      if (!controller || controller.fixtureId !== id) {
        throw new Error('preview stream replay controller is unavailable');
      }
      const samples = [];
      const scrollSamples = [];
      const scroller = document.querySelector('[role="log"] .overflow-y-auto');
      let poll = null;
      return new Promise((resolve, reject) => {
        poll = window.setInterval(() => {
          const assistant = readAssistantFromDom();
          const status = controller.status;
          const phase = controller.replayPhase ?? 'idle';
          samples.push({
            at: performance.now(),
            status,
            phase,
            ...assistant,
            pinned: isPinnedToBottom(scroller),
          });
          if (scroller) {
            scrollSamples.push({
              at: performance.now(),
              status,
              phase,
              scrollTop: scroller.scrollTop,
              scrollHeight: scroller.scrollHeight,
              clientHeight: scroller.clientHeight,
              pinned: isPinnedToBottom(scroller),
            });
          }
        }, interval);
        controller.begin();
        const done = () => {
          window.clearInterval(poll);
          const assistant = readAssistantFromDom();
          samples.push({
            at: performance.now(),
            status: controller.status,
            phase: controller.replayPhase ?? 'complete',
            ...assistant,
            pinned: isPinnedToBottom(scroller),
            final: true,
          });
          resolve({
            samples,
            scrollSamples,
            order: readTurnOrder(),
            longTasks: controller.longTasks ?? [],
            replayStartedAt: controller.replayStartedAt ?? 0,
            replayEndedAt: controller.replayEndedAt ?? performance.now(),
            expectedFinalText: controller.trace.expectedFinalText,
            markers: controller.trace.markers,
          });
        };
        const timeout = window.setTimeout(
          () => reject(new Error('stream replay timed out')),
          120_000,
        );
        const check = () => {
          if (controller.status === 'complete') {
            window.clearTimeout(timeout);
            done();
            return;
          }
          window.requestAnimationFrame(check);
        };
        check();
      });
    },
    { fixtureId, sampleIntervalMs },
  );
}

export function assertLongTasks(
  longTasks,
  { replayStartedAt, replayEndedAt, warmupExclusions = LONG_TASK_WARMUP_EXCLUSIONS } = {},
) {
  const windowEnd = replayEndedAt + LONG_TASK_FINALIZE_WINDOW_MS;
  const inWindow = longTasks.filter(
    entry => entry.startTime >= replayStartedAt && entry.startTime <= windowEnd,
  );
  const offenders = inWindow
    .slice(warmupExclusions)
    .filter(entry => entry.duration > LONG_TASK_THRESHOLD_MS + 0.5);
  if (offenders.length > 0) {
    throw new Error(
      `long task exceeded ${LONG_TASK_THRESHOLD_MS}ms (${offenders.length} after ${warmupExclusions} warmup exclusions, window ends ${windowEnd.toFixed(0)}ms): ${JSON.stringify(offenders.slice(0, 3))}`,
    );
  }
}

export function assertReplayFinalText(shown, expected, label) {
  const finalNorm = normalizeReplayFinalCompare(shown);
  const expectedNorm = normalizeReplayFinalCompare(expected);
  const prefixLength = Math.min(
    expectedNorm.length > 4000 ? 40 : 80,
    expectedNorm.length,
    finalNorm.length,
  );
  if (finalNorm.slice(0, prefixLength) !== expectedNorm.slice(0, prefixLength)) {
    throw new Error(
      `${label}: final assistant text prefix mismatch (shown ${finalNorm.slice(0, 80)}..., expected ${expectedNorm.slice(0, 80)}...)`,
    );
  }
  const lengthDelta = Math.abs(finalNorm.length - expectedNorm.length);
  const tolerance = Math.max(64, Math.floor(expectedNorm.length * 0.12));
  if (lengthDelta > tolerance) {
    throw new Error(
      `${label}: final assistant text length mismatch (shown ${finalNorm.length}, expected ${expectedNorm.length}, delta ${lengthDelta}, tolerance ${tolerance})`,
    );
  }
}

export function assertStreamingScrollPinned(samples) {
  const streaming = samples.filter(
    sample => sample.status === 'streaming' && (sample.text ?? '').trim().length > 8,
  );
  if (streaming.length === 0) {
    throw new Error('expected streaming samples with visible assistant text');
  }
  const unpinned = streaming.filter(sample => sample.pinned === false);
  if (unpinned.length > 0) {
    throw new Error(
      `scroll was not pinned during streaming (${unpinned.length}/${streaming.length} samples unpinned)`,
    );
  }
}
