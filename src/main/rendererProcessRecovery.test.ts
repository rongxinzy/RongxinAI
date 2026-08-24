import { describe, expect, test } from 'vitest';

import { RendererProcessExitReason, shouldReloadRendererProcess } from './rendererProcessRecovery';

describe('shouldReloadRendererProcess', () => {
  test.each([
    RendererProcessExitReason.Crashed,
    RendererProcessExitReason.Killed,
    RendererProcessExitReason.OutOfMemory,
    RendererProcessExitReason.LaunchFailed,
    RendererProcessExitReason.IntegrityFailure,
  ])('reloads after recoverable renderer exit %s', reason => {
    expect(shouldReloadRendererProcess(reason, false)).toBe(true);
  });

  test('does not reload a renderer that exited cleanly', () => {
    expect(shouldReloadRendererProcess(RendererProcessExitReason.CleanExit, false)).toBe(false);
  });

  test('does not reload while the application is quitting', () => {
    expect(shouldReloadRendererProcess(RendererProcessExitReason.Crashed, true)).toBe(false);
  });
});
