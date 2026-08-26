import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./cowork.ts', import.meta.url)), 'utf8');

test('deduplicates the stream error fallback against the canonical terminal message', () => {
  const listenerStart = source.indexOf('const errorCleanup = cowork.onStreamError');
  const listenerEnd = source.indexOf('this.streamListenerCleanups.push(errorCleanup);');
  const listenerSource = source.slice(listenerStart, listenerEnd);

  expect(listenerSource).toContain('hasMatchingLatestTerminalError(');
  expect(listenerSource).toContain('!terminalMessageAlreadyReceived');
  expect(listenerSource).toContain('createCoworkTerminalErrorMessage(error)');
});

test('creates at most one canonical message for a synchronous continue failure', () => {
  const continueStart = source.indexOf('async continueSession(options: CoworkContinueOptions)');
  const continueEnd = source.indexOf('async stopSession(sessionId: string)');
  const continueSource = source.slice(continueStart, continueEnd);

  expect(continueSource).toContain('resolveCoworkTerminalError(result.error, result.code)');
  expect(continueSource).toContain('hasMatchingLatestTerminalError(');
  expect(continueSource.match(/createCoworkTerminalErrorMessage\(terminalError\)/g)).toHaveLength(
    1,
  );
  expect(continueSource).not.toContain("i18nService.t('coworkErrorSessionContinueFailed')");
});
