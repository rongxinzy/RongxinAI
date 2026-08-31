import type { LlamaCppRunningModel } from '../../../../shared/llamacpp';

// The 5s running-model poll rebuilds the array every tick; comparing the
// fields the UI actually renders lets callers keep the previous array
// reference when nothing changed, so memoized model cards skip re-rendering.
export function sameRunningModelSnapshot(
  current: LlamaCppRunningModel[],
  next: LlamaCppRunningModel[],
): boolean {
  if (current.length !== next.length) return false;
  return current.every((model, index) => {
    const other = next[index];
    return (
      model.name === other.name &&
      model.model === other.model &&
      model.status === other.status &&
      model.runtime_context_length === other.runtime_context_length &&
      model.context_length === other.context_length &&
      model.size_vram === other.size_vram
    );
  });
}
