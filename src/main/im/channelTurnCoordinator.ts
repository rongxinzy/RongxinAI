import {
  ChannelInboxStatus,
  type ChannelInboxEvent,
  type ChannelInboxStore,
} from './channelInboxStore';

type ChannelInbox = Pick<ChannelInboxStore, 'claim' | 'markProcessing' | 'complete' | 'fail' | 'recoverInterrupted'>;

export class ChannelTurnCoordinator {
  private readonly activeEvents = new Map<string, Promise<string>>();
  private readonly conversationTails = new Map<string, Promise<void>>();
  private activeCount = 0;
  private readonly permits: Array<() => void> = [];

  constructor(private readonly store: ChannelInbox, private readonly maxConcurrency = 4) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error('Channel turn concurrency must be a positive integer');
    }
    this.store.recoverInterrupted();
  }

  run(event: ChannelInboxEvent, execute: () => Promise<string>): Promise<string> {
    const eventKey = JSON.stringify([event.platform, event.accountId, event.messageId]);
    const existing = this.activeEvents.get(eventKey);
    if (existing) return existing;
    const claimed = this.store.claim(event);
    if (claimed.status === ChannelInboxStatus.Completed && claimed.result) return Promise.resolve(claimed.result);

    const conversationKey = JSON.stringify([event.platform, event.accountId, event.conversationId]);
    const previous = this.conversationTails.get(conversationKey) ?? Promise.resolve();
    const operation = previous.catch((): undefined => undefined).then(async (): Promise<string> => {
      await this.acquire();
      this.store.markProcessing(event);
      try {
        const result = await execute();
        if (!result.trim()) throw new Error('Channel Pi turn returned an empty result');
        this.store.complete(event, result);
        return result;
      } catch (error) {
        this.store.fail(event, error instanceof Error ? error.message : String(error));
        throw error;
      } finally {
        this.release();
      }
    });
    const tail = operation.then((): undefined => undefined, (): undefined => undefined);
    this.conversationTails.set(conversationKey, tail);
    this.activeEvents.set(eventKey, operation);
    void tail.finally(() => {
      if (this.activeEvents.get(eventKey) === operation) this.activeEvents.delete(eventKey);
      if (this.conversationTails.get(conversationKey) === tail) this.conversationTails.delete(conversationKey);
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
