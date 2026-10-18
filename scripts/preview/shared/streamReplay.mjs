/** @typedef {'glm-tool-text-jsonl' | 'glm-fresh-pr1127-jsonl-gz' | '503-auto-retry' | 'synthetic-20000'} StreamReplayFixtureId */

export const LONG_TASK_THRESHOLD_MS = 50;
/** Ignore the first N long tasks (boot/layout warmup). */
export const LONG_TASK_WARMUP_EXCLUSIONS = 3;

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
  return normalizeReplayPlainText(value).replace(/[`*_>#~[\]()!]/g, '');
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

export async function openStreamReplaySession(page) {
  await page
    .getByText(/Stream replay/i)
    .first()
    .click();
  await page.getByRole('log').waitFor({ timeout: 60_000 });
}

export async function runStreamReplay(page, { fixtureId, sampleIntervalMs = 48 }) {
  const handle = await page.evaluateHandle(
    ({ fixtureId: id, sampleIntervalMs: interval }) => {
      const controller = window.__previewStreamReplay;
      if (!controller || controller.fixtureId !== id) {
        throw new Error('preview stream replay controller is unavailable');
      }
      const samples = [];
      const scroller = document.querySelector('[role="log"] .overflow-y-auto');
      const scrollSamples = [];
      let poll = null;
      const readAssistant = () => {
        const answerNodes = [...document.querySelectorAll('.is-assistant .theme-message-body')];
        const last = answerNodes.at(-1);
        const fromAttr = last?.getAttribute('data-assistant-plaintext');
        const streamingAttr = last
          ?.closest('.is-assistant')
          ?.querySelector('[data-assistant-streaming]')
          ?.getAttribute('data-assistant-streaming');
        return {
          text: fromAttr ?? last?.textContent ?? '',
          answerBubbles: answerNodes.length,
          assistantStreaming: streamingAttr === 'true',
        };
      };
      const readOrder = () => {
        const log = document.querySelector('[role="log"]');
        if (!log) return { thinkingIndex: -1, toolIndex: -1, answerIndex: -1 };
        const items = [
          ...log.querySelectorAll('[data-streamdown], .is-assistant, [data-slot="tool"]'),
        ];
        const thinkingIndex = items.findIndex(node =>
          node.closest('[data-state]')?.textContent?.includes('Thought'),
        );
        const toolIndex = items.findIndex(node =>
          node.matches('[data-slot="tool"], [data-tool-name]'),
        );
        const answerIndex = items.findIndex(node => node.classList.contains('is-assistant'));
        return { thinkingIndex, toolIndex, answerIndex };
      };
      return new Promise((resolve, reject) => {
        poll = window.setInterval(() => {
          const assistant = readAssistant();
          samples.push({ at: performance.now(), ...assistant });
          if (scroller) {
            scrollSamples.push({
              at: performance.now(),
              scrollTop: scroller.scrollTop,
              scrollHeight: scroller.scrollHeight,
              clientHeight: scroller.clientHeight,
            });
          }
        }, interval);
        controller.begin();
        const done = () => {
          window.clearInterval(poll);
          samples.push({ at: performance.now(), ...readAssistant(), final: true });
          resolve({
            samples,
            scrollSamples,
            order: readOrder(),
            longTasks: controller.longTasks,
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
  return handle.jsonValue();
}
