export type LlamaCppServiceTransitionInput<TStatus> = {
  wasRunning: boolean;
  stop: () => Promise<TStatus>;
  start: () => Promise<TStatus>;
  applyConfig: () => Promise<void> | void;
  clearLastLoadedModel: () => void;
  refreshBindings: () => Promise<void>;
  setBindingRefreshSuppressed: (suppressed: boolean) => void;
};

/** Applies service-level changes without implicitly restoring a previous model. */
export async function applyLlamaCppServiceTransition<TStatus>(
  input: LlamaCppServiceTransitionInput<TStatus>,
): Promise<TStatus | undefined> {
  input.setBindingRefreshSuppressed(true);
  try {
    input.clearLastLoadedModel();
    if (input.wasRunning) {
      await input.stop();
    }
    await input.applyConfig();
    return input.wasRunning ? await input.start() : undefined;
  } finally {
    input.setBindingRefreshSuppressed(false);
    await input.refreshBindings();
  }
}
