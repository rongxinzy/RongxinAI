/**
 * Conversation search tests for CoworkStore.
 * New coverage (issue #1069): conversationSearch/recentChats moved out of
 * coworkStore.ts without any dedicated tests; these pin current behavior.
 */
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: () => '/mock' },
}));

import { createCoworkStoreHarness, type CoworkStoreTestHarness } from './coworkStore.testHarness';

let harness: CoworkStoreTestHarness;

beforeEach(() => {
  harness = createCoworkStoreHarness();
});

function seedSession(title: string, cwd: string, updatedAt: number): string {
  const { store } = harness;
  const session = store.createSession(title, cwd);
  harness.db
    .prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?')
    .run(updatedAt, session.id);
  return session.id;
}

test('conversationSearch matches message content and builds session records', () => {
  const { store } = harness;
  const first = store.createSession('deploy notes', '/tmp/search-a');
  store.addMessage(first.id, { type: 'user', content: 'deploy failed on staging' }, 1000);
  store.addMessage(first.id, { type: 'assistant', content: 'restarted the pods' }, 2000);
  const second = store.createSession('deploy other', '/tmp/search-b');
  store.addMessage(second.id, { type: 'user', content: 'deploy succeeded on prod' }, 3000);

  const records = store.conversationSearch({ query: 'deploy' });

  expect(records).toHaveLength(2);
  expect(records[0]).toMatchObject({
    sessionId: second.id,
    title: 'deploy other',
    url: `https://claude.ai/chat/${second.id}`,
    human: 'deploy succeeded on prod',
    // No assistant message exists; the fallback finds nothing.
    assistant: '',
  });
  expect(records[1]).toMatchObject({
    sessionId: first.id,
    human: 'deploy failed on staging',
    assistant: 'restarted the pods',
  });
});

test('conversationSearch ignores single-character and empty queries', () => {
  const { store } = harness;
  const session = store.createSession('session', '/tmp/search-empty');
  store.addMessage(session.id, { type: 'user', content: 'a b' }, 1000);

  expect(store.conversationSearch({ query: 'a' })).toEqual([]);
  expect(store.conversationSearch({ query: '   ' })).toEqual([]);
});

test('conversationSearch clamps maxResults between 1 and 10', () => {
  const { store } = harness;
  for (let index = 0; index < 3; index += 1) {
    const session = store.createSession(`matching-${index}`, `/tmp/search-clamp-${index}`);
    store.addMessage(session.id, { type: 'user', content: 'deploy note' }, 1000 + index);
  }

  expect(store.conversationSearch({ query: 'deploy', maxResults: 0 })).toHaveLength(1);
  expect(store.conversationSearch({ query: 'deploy', maxResults: 99 })).toHaveLength(3);
});

test('conversationSearch honors before and after bounds', () => {
  const { store } = harness;
  const early = store.createSession('early session', '/tmp/search-bounds-a');
  store.addMessage(early.id, { type: 'user', content: 'deploy early question' }, 1000);
  store.addMessage(early.id, { type: 'assistant', content: 'deploy early answer' }, 1500);
  const late = store.createSession('late session', '/tmp/search-bounds-b');
  store.addMessage(late.id, { type: 'user', content: 'deploy late question' }, 3000);
  store.addMessage(late.id, { type: 'assistant', content: 'deploy late answer' }, 3500);

  const beforeRecords = store.conversationSearch({
    query: 'deploy',
    before: new Date(2000).toISOString(),
  });
  expect(beforeRecords.map(record => record.sessionId)).toEqual([early.id]);
  expect(beforeRecords[0]).toMatchObject({
    human: 'deploy early question',
    assistant: 'deploy early answer',
  });

  const afterRecords = store.conversationSearch({
    query: 'deploy',
    after: new Date(2000).toISOString(),
  });
  expect(afterRecords.map(record => record.sessionId)).toEqual([late.id]);
  expect(afterRecords[0]).toMatchObject({
    human: 'deploy late question',
    assistant: 'deploy late answer',
  });
});

test('recentChats returns sessions with latest user and assistant previews', () => {
  const { db, store } = harness;
  const oldest = store.createSession('oldest chat', '/tmp/recent-1').id;
  const middle = store.createSession('middle chat', '/tmp/recent-2').id;
  const newest = store.createSession('newest chat', '/tmp/recent-3').id;
  store.addMessage(oldest, { type: 'user', content: 'old question' }, 1000);
  store.addMessage(oldest, { type: 'assistant', content: 'old answer' }, 2000);
  store.addMessage(middle, { type: 'user', content: 'middle question' }, 1000);
  store.addMessage(newest, { type: 'user', content: 'new question' }, 1000);
  store.addMessage(newest, { type: 'assistant', content: 'new answer' }, 4000);
  store.addMessage(newest, { type: 'user', content: 'newer question' }, 5000);
  // addMessage stamps the session updated_at; pin it after seeding.
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(100, oldest);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(200, middle);
  db.prepare('UPDATE cowork_sessions SET updated_at = ? WHERE id = ?').run(300, newest);

  const recent = store.recentChats({ n: 2 });
  expect(recent.map(record => record.sessionId)).toEqual([newest, middle]);
  expect(recent[0]).toMatchObject({
    title: 'newest chat',
    url: `https://claude.ai/chat/${newest}`,
    // Latest by created_at wins.
    human: 'newer question',
    assistant: 'new answer',
  });
  // The middle session has no assistant message at all.
  expect(recent[1]).toMatchObject({ human: 'middle question', assistant: '' });

  const ascending = store.recentChats({ n: 2, sortOrder: 'asc' });
  expect(ascending.map(record => record.sessionId)).toEqual([oldest, middle]);

  const bounded = store.recentChats({ n: 5, before: new Date(250).toISOString() });
  expect(bounded.map(record => record.sessionId)).toEqual([middle, oldest]);

  const after = store.recentChats({ n: 5, after: new Date(250).toISOString() });
  expect(after.map(record => record.sessionId)).toEqual([newest]);
});

test('recentChats clamps n between 1 and 20', () => {
  const { store } = harness;
  seedSession('clamp low', '/tmp/recent-clamp-a', 100);
  seedSession('clamp high', '/tmp/recent-clamp-b', 200);

  expect(store.recentChats({ n: 0 })).toHaveLength(1);
  expect(store.recentChats({ n: 99 })).toHaveLength(2);
});

test('message previews are whitespace-normalized and truncated to 280 characters', () => {
  const { store } = harness;
  const longText = `${'word '.repeat(100)}`;
  const session = seedSession('long preview', '/tmp/search-long', 100);
  store.addMessage(session, { type: 'user', content: longText }, 1000);

  const records = store.recentChats({ n: 1 });

  expect(records[0].human.length).toBe(280);
  expect(records[0].human.endsWith('…')).toBe(true);
  expect(records[0].human).not.toContain('\n');
});
