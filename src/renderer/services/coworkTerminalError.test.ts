import { describe, expect, test } from 'vitest';

import { CoworkErrorKind, ENGINE_NOT_READY_CODE } from '../../common/coworkError';
import type { CoworkMessage, CoworkSession } from '../types/cowork';
import {
  createCoworkTerminalErrorMessage,
  hasMatchingLatestTerminalError,
  isCoworkTerminalErrorMessage,
  resolveCoworkTerminalError,
} from './coworkTerminalError';

const sessionWithMessages = (messages: CoworkMessage[]): CoworkSession =>
  ({
    id: 'session-1',
    messages,
  }) as CoworkSession;

describe('cowork terminal errors', () => {
  test('creates a canonical system message that remains identifiable after reload', () => {
    const error = {
      kind: CoworkErrorKind.RateLimited,
      message: '429 Too Many Requests',
    };

    const message = createCoworkTerminalErrorMessage(error, 42);

    expect(message).toMatchObject({
      id: 'error-42',
      type: 'system',
      content: '',
      metadata: {
        error: error.message,
        errorKind: error.kind,
      },
    });
    expect(isCoworkTerminalErrorMessage(message)).toBe(true);
  });

  test('suppresses only the matching terminal error at the session tail', () => {
    const error = {
      kind: CoworkErrorKind.NetworkError,
      message: 'network error',
    };
    const terminalError = createCoworkTerminalErrorMessage(error, 1);

    expect(
      hasMatchingLatestTerminalError([sessionWithMessages([terminalError])], 'session-1', error),
    ).toBe(true);
    expect(
      hasMatchingLatestTerminalError(
        [
          sessionWithMessages([
            terminalError,
            { id: 'user-2', type: 'user', content: 'Retry', timestamp: 2 },
          ]),
        ],
        'session-1',
        error,
      ),
    ).toBe(false);
  });

  test('does not classify tool failures as terminal conversation errors', () => {
    const toolFailure: CoworkMessage = {
      id: 'tool-result-1',
      type: 'tool_result',
      content: 'command failed',
      timestamp: 1,
      metadata: { isError: true, error: 'command failed' },
    };

    expect(isCoworkTerminalErrorMessage(toolFailure)).toBe(false);
  });

  test('uses the explicit engine-not-ready code for synchronous failures', () => {
    expect(resolveCoworkTerminalError('runtime unavailable', ENGINE_NOT_READY_CODE)).toMatchObject({
      kind: CoworkErrorKind.EngineNotReady,
      message: 'runtime unavailable',
    });
  });
});
