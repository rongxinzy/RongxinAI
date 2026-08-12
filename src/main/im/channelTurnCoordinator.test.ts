import { expect, test, vi } from 'vitest';

import { ChannelInboxStatus, type ChannelInboxEvent, type ChannelInboxRecord } from './channelInboxStore';
import { ChannelTurnCoordinator } from './channelTurnCoordinator';

class FakeInbox {
  readonly records = new Map<string, ChannelInboxRecord>();
  recoverInterrupted(): number { return 0; }
  claim(event: ChannelInboxEvent): ChannelInboxRecord {
    const key = this.key(event);
    const existing = this.records.get(key);
    if (existing) return existing;
    const record = { ...event, status: ChannelInboxStatus.Pending, result: null, error: null };
    this.records.set(key, record);
    return record;
  }
  markProcessing(event: ChannelInboxEvent): void { this.records.get(this.key(event))!.status = ChannelInboxStatus.Processing; }
  complete(event: ChannelInboxEvent, result: string): void {
    Object.assign(this.records.get(this.key(event))!, { status: ChannelInboxStatus.Completed, result });
  }
  fail(event: ChannelInboxEvent, error: string): void {
    Object.assign(this.records.get(this.key(event))!, { status: ChannelInboxStatus.Error, error });
  }
  private key(event: ChannelInboxEvent): string { return JSON.stringify([event.platform, event.accountId, event.messageId]); }
}

const event = (messageId: string, conversationId = 'chat-1'): ChannelInboxEvent => ({
  platform: 'telegram', accountId: 'account-1', conversationId, messageId, payload: '{}',
});

test('shares one execution for duplicate in-flight events and reuses the durable result', async () => {
  const inbox = new FakeInbox();
  const coordinator = new ChannelTurnCoordinator(inbox);
  let executions = 0;
  const execute = async () => { executions += 1; await new Promise(resolve => setTimeout(resolve, 5)); return 'done'; };
  await expect(Promise.all([coordinator.run(event('1'), execute), coordinator.run(event('1'), execute)])).resolves.toEqual(['done', 'done']);
  await expect(coordinator.run(event('1'), execute)).resolves.toBe('done');
  expect(executions).toBe(1);
});

test('serializes one conversation while allowing bounded cross-conversation work', async () => {
  const inbox = new FakeInbox();
  const coordinator = new ChannelTurnCoordinator(inbox, 2);
  let active = 0;
  let peak = 0;
  const order: string[] = [];
  const execute = (id: string) => async () => {
    active += 1; peak = Math.max(peak, active); order.push(`start:${id}`);
    await new Promise(resolve => setTimeout(resolve, 10));
    order.push(`end:${id}`); active -= 1; return id;
  };
  await Promise.all([
    coordinator.run(event('1'), execute('1')),
    coordinator.run(event('2'), execute('2')),
    coordinator.run(event('3', 'chat-2'), execute('3')),
  ]);
  expect(peak).toBe(2);
  expect(order.indexOf('start:2')).toBeGreaterThan(order.indexOf('end:1'));
});

test('does not execute a queued turn after its bridge request is cancelled', async () => {
  const inbox = new FakeInbox();
  const coordinator = new ChannelTurnCoordinator(inbox, 1);
  let releaseFirst!: () => void;
  const first = coordinator.run(event('1'), async () => {
    await new Promise<void>(resolve => { releaseFirst = resolve; });
    return 'first';
  });
  await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'));

  const controller = new AbortController();
  let secondExecuted = false;
  const second = coordinator.run(event('2'), async () => {
    secondExecuted = true;
    return 'second';
  }, controller.signal);
  controller.abort();
  releaseFirst();

  await expect(first).resolves.toBe('first');
  await expect(second).rejects.toThrow('cancelled before execution');
  expect(secondExecuted).toBe(false);
});
