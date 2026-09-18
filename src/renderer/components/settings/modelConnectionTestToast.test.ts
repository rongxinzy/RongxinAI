import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const settingsSource = readFileSync(
  fileURLToPath(new URL('../Settings.tsx', import.meta.url)),
  'utf8',
);

/**
 * 进度提示与结果汇总的替换契约。
 *
 * App 的 Toast 宿主每收到一次 app:showToast 就覆盖文案并重置自动关闭计时器，所以只要
 * 「结果汇总」同步派发在 finally 清掉 interval 之前，屏幕上最后留下的就是一条结果提示，
 * 进度提示会被原地替换，而不是停在顶部等着用户手动关闭。
 *
 * 进度提示自身的 autoClose / durationMs 由 modelConnectionTestNotification.test.ts 锁住，
 * 即使批次被新请求顶掉（提前 return，不发结果提示）也会在 3 秒内自动消失。
 */
test('dispatches the batch result toast before clearing the progress interval', () => {
  const progressStartIndex = settingsSource.indexOf(
    'shouldReportProviderModelConnectionTestProgress(modelsToTest.length)',
  );
  const progressDispatchIndex = settingsSource.indexOf('reportProgress();', progressStartIndex);
  const summaryDispatchIndex = settingsSource.indexOf(
    'buildProviderModelConnectionTestNotification({',
    progressDispatchIndex,
  );
  const intervalClearIndex = settingsSource.indexOf(
    'if (progressTimer !== null) window.clearInterval(progressTimer);',
    summaryDispatchIndex,
  );

  expect(progressStartIndex).toBeGreaterThan(-1);
  expect(progressDispatchIndex).toBeGreaterThan(progressStartIndex);
  expect(summaryDispatchIndex).toBeGreaterThan(progressDispatchIndex);
  expect(intervalClearIndex).toBeGreaterThan(summaryDispatchIndex);
});
