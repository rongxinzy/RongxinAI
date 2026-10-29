interface MemoryOutboxSchedulerOptions {
  drain: () => Promise<unknown>;
  nextAvailableAt: () => string | null;
  onError: (error: unknown) => void;
}

export class MemoryOutboxScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private stopped = true;

  constructor(private readonly options: MemoryOutboxSchedulerOptions) {}

  start(): void {
    this.stopped = false;
    this.kick();
  }

  kick(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.running) return;
    this.running = this.options
      .drain()
      .then((): void => {})
      .catch(error => {
        this.options.onError(error);
      })
      .finally(() => {
        this.running = null;
        this.scheduleNext();
      });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.running;
  }

  private scheduleNext(): void {
    if (this.stopped || this.timer) return;
    const next = this.options.nextAvailableAt();
    if (!next) return;
    const delay = Math.max(0, new Date(next).getTime() - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick();
    }, delay);
    this.timer.unref?.();
  }
}
