/**
 * Shared event bus and once-only warning log for the browser preview mock.
 * Subscriptions registered by generated `on*` methods receive `emit` payloads.
 */
type Listener = (...args: never[]) => void;

export interface BrowserMockRuntime {
  warnOnce(path: string): void;
  subscribe(path: string, listener: Listener): () => void;
  emit(path: string, ...args: unknown[]): void;
}

export function createBrowserMockRuntime(): BrowserMockRuntime {
  const warned = new Set<string>();
  const listeners = new Map<string, Set<Listener>>();
  return {
    warnOnce(path) {
      if (warned.has(path)) return;
      warned.add(path);
      console.warn(`[Browser Mock] ${path} is not implemented; returning a typed default`);
    },
    subscribe(path, listener) {
      let bucket = listeners.get(path);
      if (!bucket) {
        bucket = new Set();
        listeners.set(path, bucket);
      }
      bucket.add(listener);
      return () => {
        bucket.delete(listener);
      };
    },
    emit(path, ...args) {
      const bucket = listeners.get(path);
      if (!bucket) return;
      for (const listener of bucket) {
        (listener as (...args: unknown[]) => void)(...args);
      }
    },
  };
}
