import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./cowork.ts', import.meta.url)), 'utf8');

test('deduplicates the unified stream error fallback against the canonical terminal message', () => {
  const listenerStart = source.indexOf('const uiEventCleanup = cowork.onStreamUiEvent');
  const listenerEnd = source.indexOf('this.streamListenerCleanups.push(uiEventCleanup);');
  const listenerSource = source.slice(listenerStart, listenerEnd);

  expect(listenerStart).toBeGreaterThanOrEqual(0);
  expect(listenerEnd).toBeGreaterThan(listenerStart);
  expect(listenerSource).toContain('hasMatchingLatestTerminalError(');
  expect(listenerSource).toContain('!terminalMessageAlreadyReceived');
  expect(listenerSource).toContain('createCoworkTerminalErrorMessage(event.error)');
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

test('does not reload a stale database snapshot after continue is accepted', () => {
  const continueStart = source.indexOf('async continueSession(options: CoworkContinueOptions)');
  const continueEnd = source.indexOf('async stopSession(sessionId: string)');
  const continueSource = source.slice(continueStart, continueEnd);

  expect(continueSource).not.toContain('this.loadSession(options.sessionId)');
});
