import type { ChannelInboxEvent, ChannelInboxStore } from './channelInboxStore';

type ChannelInbox = Pick<ChannelInboxStore, 'completedResult' | 'complete'>;

export class ChannelTurnCoordinator {
  private readonly activeEvents = new Map<string, Promise<string>>();
  private readonly conversationTails = new Map<string, Promise<void>>();
  private activeCount = 0;
  private readonly permits: Array<() => void> = [];

  constructor(
    private readonly store: ChannelInbox,
    private readonly maxConcurrency = 4,
  ) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error('Channel turn concurrency must be a positive integer');
    }
  }

  run(
    event: ChannelInboxEvent,
    execute: () => Promise<string>,
    signal?: AbortSignal,
  ): Promise<string> {
    const eventKey = JSON.stringify([event.platform, event.accountId, event.messageId]);
    const existing = this.activeEvents.get(eventKey);
    if (existing) return existing;
    const cached = this.store.completedResult(event);
    if (cached) return Promise.resolve(cached);

    const conversationKey = JSON.stringify([event.platform, event.accountId, event.conversationId]);
    const previous = this.conversationTails.get(conversationKey) ?? Promise.resolve();
    const operation = previous
      .catch((): undefined => undefined)
      .then(async (): Promise<string> => {
        if (signal?.aborted) throw new Error('Channel turn was cancelled before execution');
        await this.acquire();
        try {
          if (signal?.aborted) throw new Error('Channel turn was cancelled before execution');
          const result = await execute();
          if (!result.trim()) throw new Error('Channel Pi turn returned an empty result');
          return this.store.complete(event, result);
        } finally {
          this.release();
        }
      });
    const tail = operation.then(
      (): undefined => undefined,
      (): undefined => undefined,
    );
    this.conversationTails.set(conversationKey, tail);
    this.activeEvents.set(eventKey, operation);
    void tail.finally(() => {
      if (this.activeEvents.get(eventKey) === operation) this.activeEvents.delete(eventKey);
      if (this.conversationTails.get(conversationKey) === tail)
        this.conversationTails.delete(conversationKey);
    });
    return operation;
  }

  private async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrency) {
      this.activeCount += 1;
      return;
    }
    await new Promise<void>(resolve => this.permits.push(resolve));
    this.activeCount += 1;
  }

  private release(): void {
    this.activeCount -= 1;
    this.permits.shift()?.();
  }
}
