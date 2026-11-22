import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { ChannelInboxStore, type ChannelInboxEvent } from './channelInboxStore';
import { ChannelTurnCoordinator } from './channelTurnCoordinator';
import { initializeIMSchema } from './schema';

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  initializeIMSchema(db);
});
afterEach(() => db.close());

const event = (messageId: string, conversationId = 'chat-1'): ChannelInboxEvent => ({
  platform: 'telegram',
  accountId: 'account-1',
  conversationId,
  messageId,
});

test('shares one execution for duplicate in-flight events and reuses the durable result', async () => {
  const inbox = new ChannelInboxStore(db);
  const coordinator = new ChannelTurnCoordinator(inbox);
  let executions = 0;
  const execute = async () => {
    executions += 1;
    await new Promise(resolve => setTimeout(resolve, 5));
    return 'done';
  };
  await expect(
    Promise.all([coordinator.run(event('1'), execute), coordinator.run(event('1'), execute)]),
  ).resolves.toEqual(['done', 'done']);
  await expect(coordinator.run(event('1'), execute)).resolves.toBe('done');
  expect(executions).toBe(1);
});

test('serializes one conversation while allowing bounded cross-conversation work', async () => {
  const inbox = new ChannelInboxStore(db);
  const coordinator = new ChannelTurnCoordinator(inbox, 2);
  let active = 0;
  let peak = 0;
  const order: string[] = [];
  const execute = (id: string) => async () => {
    active += 1;
    peak = Math.max(peak, active);
    order.push(`start:${id}`);
    await new Promise(resolve => setTimeout(resolve, 10));
    order.push(`end:${id}`);
    active -= 1;
    return id;
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
  const inbox = new ChannelInboxStore(db);
  const coordinator = new ChannelTurnCoordinator(inbox, 1);
  let releaseFirst!: () => void;
  const first = coordinator.run(event('1'), async () => {
    await new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    return 'first';
  });
  await vi.waitFor(() => expect(releaseFirst).toBeTypeOf('function'));

  const controller = new AbortController();
  let secondExecuted = false;
  const second = coordinator.run(
    event('2'),
    async () => {
      secondExecuted = true;
      return 'second';
    },
    controller.signal,
  );
  controller.abort();
  releaseFirst();

  await expect(first).resolves.toBe('first');
  await expect(second).rejects.toThrow('cancelled before execution');
  expect(secondExecuted).toBe(false);
});

test('reopens legacy receipts and writes no Channel inbox row for a failed attempt', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'zhiyuan-channel-receipts-'));
  const file = path.join(root, 'receipts.sqlite');
  let stored = new Database(file);
  try {
    stored.exec(`
      CREATE TABLE channel_inbox (
        platform TEXT NOT NULL, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL,
        result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (platform, account_id, message_id)
      );
      INSERT INTO channel_inbox VALUES
        ('telegram','account-1','chat-1','completed','legacy-metadata','completed','cached',NULL,'old','old'),
        ('telegram','account-1','chat-1','interrupted','legacy-metadata','processing',NULL,NULL,'old','old');
    `);
    let coordinator = new ChannelTurnCoordinator(new ChannelInboxStore(stored), 1);
    const unused = vi.fn(async () => 'reran');
    await expect(coordinator.run(event('completed'), unused)).resolves.toBe('cached');
    expect(unused).not.toHaveBeenCalled();

    await expect(
      coordinator.run(event('retry'), async () => {
        throw new Error('temporary failure');
      }),
    ).rejects.toThrow('temporary failure');
    expect(
      stored.prepare("SELECT 1 FROM channel_inbox WHERE message_id = 'retry'").get(),
    ).toBeUndefined();
    await expect(coordinator.run(event('retry'), async () => 'on retry')).resolves.toBe('on retry');
    await expect(coordinator.run(event('interrupted'), async () => 'redelivered')).resolves.toBe(
      'redelivered',
    );
    expect(
      stored.prepare('SELECT status, payload_json FROM channel_inbox ORDER BY message_id').all(),
    ).toEqual([
      { status: 'completed', payload_json: 'legacy-metadata' },
      { status: 'completed', payload_json: 'legacy-metadata' },
      { status: 'completed', payload_json: '' },
    ]);

    stored.close();
    stored = new Database(file);
    initializeIMSchema(stored);
    const receipts = new ChannelInboxStore(stored);
    coordinator = new ChannelTurnCoordinator(receipts);
    await expect(coordinator.run(event('retry'), unused)).resolves.toBe('on retry');
    await expect(coordinator.run(event('interrupted'), unused)).resolves.toBe('redelivered');
    expect(receipts.complete(event('completed'), 'different')).toBe('cached');
    expect(unused).not.toHaveBeenCalled();
    expect(stored.pragma('quick_check', { simple: true })).toBe('ok');
  } finally {
    if (stored.open) stored.close();
    rmSync(root, { recursive: true, force: true });
  }
});
