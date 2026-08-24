export const RendererProcessExitReason = {
  CleanExit: 'clean-exit',
  Crashed: 'crashed',
  Killed: 'killed',
  OutOfMemory: 'oom',
  LaunchFailed: 'launch-failed',
  IntegrityFailure: 'integrity-failure',
} as const;

const RECOVERABLE_RENDERER_EXIT_REASONS = new Set<string>([
  RendererProcessExitReason.Crashed,
  RendererProcessExitReason.Killed,
  RendererProcessExitReason.OutOfMemory,
  RendererProcessExitReason.LaunchFailed,
  RendererProcessExitReason.IntegrityFailure,
]);

export function shouldReloadRendererProcess(reason: string, isQuitting: boolean): boolean {
  return !isQuitting && RECOVERABLE_RENDERER_EXIT_REASONS.has(reason);
}
