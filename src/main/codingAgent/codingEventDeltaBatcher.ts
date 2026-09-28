import type { CodingEvent, CodingRoomEventDelta } from '../../shared/codingAgent';

type FlushHandler = (delta: CodingRoomEventDelta) => void;

export class CodingEventDeltaBatcher {
  private readonly pending = new Map<string, Map<string, CodingEvent>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly onFlush: FlushHandler,
    private readonly delayMs = 100,
  ) {}

  enqueue(workspaceRoot: string, event: CodingEvent): void {
    const events = this.pending.get(workspaceRoot) ?? new Map<string, CodingEvent>();
    events.set(event.id, event);
    this.pending.set(workspaceRoot, events);
    if (this.timers.has(workspaceRoot)) return;
    this.timers.set(
      workspaceRoot,
      setTimeout(() => {
        this.timers.delete(workspaceRoot);
        const pending = this.pending.get(workspaceRoot);
        this.pending.delete(workspaceRoot);
        if (!pending || pending.size === 0) return;
        this.onFlush({ workspaceRoot, events: [...pending.values()] });
      }, this.delayMs),
    );
  }

  flush(workspaceRoot: string): void {
    const timer = this.timers.get(workspaceRoot);
    if (timer) clearTimeout(timer);
    this.timers.delete(workspaceRoot);
    const pending = this.pending.get(workspaceRoot);
    this.pending.delete(workspaceRoot);
    if (!pending || pending.size === 0) return;
    this.onFlush({ workspaceRoot, events: [...pending.values()] });
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
  }
}
