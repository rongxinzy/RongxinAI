import type { EnterpriseSessionResult } from '../../shared/enterpriseSession';

const listeners = new Set<(result: EnterpriseSessionResult) => void>();

export function publishEnterpriseSessionResult(result: EnterpriseSessionResult): void {
  for (const listener of listeners) {
    listener(result);
  }
}

export function subscribeToEnterpriseSession(
  listener: (result: EnterpriseSessionResult) => void,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
