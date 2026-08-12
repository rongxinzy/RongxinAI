export class StreamRequestRegistry {
  private readonly cleanups = new Map<string, Array<() => void>>();

  register(requestId: string, cleanupFunctions: Array<() => void>): void {
    this.cleanups.set(requestId, cleanupFunctions);
  }

  cleanup(requestId: string | null): void {
    if (!requestId) return;
    const cleanupFunctions = this.cleanups.get(requestId);
    if (!cleanupFunctions) return;
    this.cleanups.delete(requestId);
    cleanupFunctions.forEach(cleanup => cleanup());
  }

  getLatestRequestId(): string | null {
    let latestRequestId: string | null = null;
    for (const requestId of this.cleanups.keys()) {
      latestRequestId = requestId;
    }
    return latestRequestId;
  }
}
