/** One in-flight read plus one trailing read for a burst of cross-window invalidations. */
export function createCompanionRefreshQueue(load: () => Promise<void>) {
  let running = false;
  let dirty = false;
  let disposed = false;
  return {
    async request(): Promise<void> {
      if (disposed) return;
      dirty = true;
      if (running) return;
      running = true;
      try {
        while (dirty && !disposed) {
          dirty = false;
          await load();
        }
      } finally {
        running = false;
      }
    },
    dispose() {
      disposed = true;
    },
  };
}
