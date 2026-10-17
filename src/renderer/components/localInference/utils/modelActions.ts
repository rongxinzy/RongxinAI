/** Guards model actions while that exact model is mid-unload. */
export function shouldBlockModelAction(input: {
  modelName: string;
  unloadingModelName: string | null;
}): boolean {
  return Boolean(input.unloadingModelName && input.unloadingModelName === input.modelName);
}

/**
 * Keeps a busy indicator visible for a minimum duration so short operations do
 * not flash a loading state that disappears within a single frame.
 */
export function getRemainingBusyMs(input: {
  startedAtMs: number;
  nowMs: number;
  minimumBusyMs: number;
}): number {
  return Math.max(0, input.minimumBusyMs - Math.max(0, input.nowMs - input.startedAtMs));
}
