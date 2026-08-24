import type { EnterpriseSessionResult } from '../../shared/enterpriseSession';

export const EnterpriseSessionEvent = {
  Changed: 'zhiyuan:enterprise-session-changed',
} as const;

export function publishEnterpriseSessionResult(result: EnterpriseSessionResult): void {
  window.dispatchEvent(new CustomEvent(EnterpriseSessionEvent.Changed, { detail: result }));
}

export function subscribeToEnterpriseSession(
  listener: (result: EnterpriseSessionResult) => void,
): () => void {
  const handleEvent = (event: Event) => {
    listener((event as CustomEvent<EnterpriseSessionResult>).detail);
  };
  window.addEventListener(EnterpriseSessionEvent.Changed, handleEvent);
  return () => window.removeEventListener(EnterpriseSessionEvent.Changed, handleEvent);
}
