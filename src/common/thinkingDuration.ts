export class ThinkingDurationTracker {
  private startedAtMs: number | null = null;
  private accumulatedMs = 0;
  private hasStarted = false;

  start(nowMs = Date.now()): void {
    if (this.startedAtMs !== null) return;
    this.startedAtMs = nowMs;
    this.hasStarted = true;
  }

  finish(nowMs = Date.now()): number | undefined {
    if (this.startedAtMs !== null) {
      this.accumulatedMs += Math.max(0, nowMs - this.startedAtMs);
      this.startedAtMs = null;
    }
    return this.hasStarted ? this.accumulatedMs : undefined;
  }

  reset(): void {
    this.startedAtMs = null;
    this.accumulatedMs = 0;
    this.hasStarted = false;
  }
}

export const toThinkingDurationSeconds = (durationMs: unknown): number | undefined => {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return undefined;
  }
  return Math.max(1, Math.ceil(durationMs / 1000));
};
