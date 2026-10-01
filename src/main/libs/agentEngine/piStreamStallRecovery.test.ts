import { describe, expect, it, vi } from 'vitest';

import { CoworkErrorKind, makeCoworkError } from '../../../common/coworkError';
import {
  MAX_STREAM_STALL_AUTO_RESUMES,
  PiStreamStallRecovery,
  STREAM_STALL_RESUME_PROMPT,
  STREAM_STALL_TIMEOUT_LOCAL_MS,
  STREAM_STALL_TIMEOUT_MS,
  resolveStreamStallTimeoutMs,
  type PiStreamStallRecoveryHooks,
  type PiStreamStallRecoverySession,
} from './piStreamStallRecovery';

const createSession = (
  overrides: Partial<PiStreamStallRecoverySession> = {},
): PiStreamStallRecoverySession & {
  piSession: { abortBash: ReturnType<typeof vi.fn>; abort: ReturnType<typeof vi.fn> };
} => ({
  isRunning: true,
  aborted: false,
  pendingError: null,
  piSession: {
    abortBash: vi.fn(),
    abort: vi.fn().mockResolvedValue(undefined),
  },
  ...overrides,
});

const createRecovery = (session: PiStreamStallRecoverySession | undefined) => {
  const hooks: PiStreamStallRecoveryHooks = {
    getSession: vi.fn(() => session),
    hasPendingAskUserQuestion: vi.fn(() => false),
    hasPendingCodingElicitation: vi.fn(() => false),
    hasPendingApproval: vi.fn(() => false),
    flushPendingError: vi.fn(),
    emitRetryNotice: vi.fn(),
    resumeSession: vi.fn().mockResolvedValue(undefined),
    disposeWatchdog: vi.fn(),
  };
  return { recovery: new PiStreamStallRecovery(hooks), hooks };
};

describe('PiStreamStallRecovery', () => {
  it('aborts the stalled turn, flushes a sticky StreamInterrupted error, and resumes once', () => {
    const session = createSession();
    const { recovery, hooks } = createRecovery(session);

    recovery.handleStall('session');

    expect(session.piSession.abortBash).toHaveBeenCalled();
    expect(session.piSession.abort).toHaveBeenCalled();
    expect(session.aborted).toBe(true);
    expect(session.pendingError).toMatchObject({
      sticky: true,
      classified: expect.objectContaining({ kind: CoworkErrorKind.StreamInterrupted }),
    });
    expect(hooks.disposeWatchdog).toHaveBeenCalledWith('session');
    expect(hooks.flushPendingError).toHaveBeenCalledWith('session');
    expect(hooks.emitRetryNotice).toHaveBeenCalledWith(
      'session',
      expect.objectContaining({ kind: CoworkErrorKind.StreamInterrupted, attempt: 1 }),
    );
    expect(hooks.resumeSession).toHaveBeenCalledWith('session', STREAM_STALL_RESUME_PROMPT);
  });

  it('keeps an existing pending error classification and appends the stall fact', () => {
    const session = createSession({
      pendingError: {
        message: '429 Too Many Requests: overloaded',
        classified: makeCoworkError(
          CoworkErrorKind.RateLimited,
          '429 Too Many Requests: overloaded',
        ),
      },
    });
    const { recovery, hooks } = createRecovery(session);

    recovery.handleStall('session');

    expect(session.pendingError?.classified.kind).toBe(CoworkErrorKind.RateLimited);
    expect(session.pendingError?.message).toContain('429 Too Many Requests');
    expect(session.pendingError?.message).toContain('stream stalled');
    expect(session.pendingError?.sticky).toBe(true);
    expect(hooks.flushPendingError).toHaveBeenCalledWith('session');
  });

  it('does not resume a second consecutive stall', () => {
    const first = createSession();
    const { recovery, hooks } = createRecovery(first);
    recovery.handleStall('session');
    expect(hooks.resumeSession).toHaveBeenCalledTimes(1);

    // The rebuilt session stalls again before completing: the budget is spent.
    const second = createSession();
    (hooks.getSession as ReturnType<typeof vi.fn>).mockReturnValue(second);
    recovery.handleStall('session');
    expect(second.aborted).toBe(true);
    expect(hooks.flushPendingError).toHaveBeenCalledTimes(2);
    expect(hooks.resumeSession).toHaveBeenCalledTimes(1);
    expect(hooks.emitRetryNotice).toHaveBeenCalledTimes(1);
  });

  it('earns a fresh resume budget after resetResumeBudget', () => {
    const first = createSession();
    const { recovery, hooks } = createRecovery(first);
    recovery.handleStall('session');
    recovery.resetResumeBudget('session');

    const second = createSession();
    (hooks.getSession as ReturnType<typeof vi.fn>).mockReturnValue(second);
    recovery.handleStall('session');
    expect(hooks.resumeSession).toHaveBeenCalledTimes(1 + MAX_STREAM_STALL_AUTO_RESUMES);
  });

  it.each([
    ['a missing session', undefined],
    ['an aborted session', createSession({ aborted: true })],
    ['a session that is not running', createSession({ isRunning: false })],
  ])('stands down for %s', (_label, session) => {
    const { recovery, hooks } = createRecovery(session);
    recovery.handleStall('session');
    expect(hooks.flushPendingError).not.toHaveBeenCalled();
    expect(hooks.resumeSession).not.toHaveBeenCalled();
  });

  it('forgetSession and disposeAll drop the resume budget', () => {
    const session = createSession();
    const { recovery, hooks } = createRecovery(session);
    recovery.handleStall('session');
    recovery.forgetSession('session');

    const next = createSession();
    (hooks.getSession as ReturnType<typeof vi.fn>).mockReturnValue(next);
    recovery.handleStall('session');
    expect(hooks.resumeSession).toHaveBeenCalledTimes(2);

    recovery.disposeAll();
    const third = createSession();
    (hooks.getSession as ReturnType<typeof vi.fn>).mockReturnValue(third);
    recovery.handleStall('session');
    expect(hooks.resumeSession).toHaveBeenCalledTimes(3);
  });

  it('reports user-input waits from the injected probes', () => {
    const { recovery, hooks } = createRecovery(createSession());
    expect(recovery.isAwaitingUserInput('session')).toBe(false);
    (hooks.hasPendingApproval as ReturnType<typeof vi.fn>).mockReturnValue(true);
    expect(recovery.isAwaitingUserInput('session')).toBe(true);
  });
});

describe('resolveStreamStallTimeoutMs', () => {
  it('gives local and custom providers the wide window', () => {
    expect(resolveStreamStallTimeoutMs('llamacpp')).toBe(STREAM_STALL_TIMEOUT_LOCAL_MS);
    expect(resolveStreamStallTimeoutMs('ollama')).toBe(STREAM_STALL_TIMEOUT_LOCAL_MS);
    expect(resolveStreamStallTimeoutMs('custom_0')).toBe(STREAM_STALL_TIMEOUT_LOCAL_MS);
  });

  it('keeps the default window for hosted providers', () => {
    expect(resolveStreamStallTimeoutMs('zhiyuan')).toBe(STREAM_STALL_TIMEOUT_MS);
    expect(resolveStreamStallTimeoutMs('openai')).toBe(STREAM_STALL_TIMEOUT_MS);
  });

  it('honors an explicit override', () => {
    expect(resolveStreamStallTimeoutMs('llamacpp', 1000)).toBe(1000);
  });
});
