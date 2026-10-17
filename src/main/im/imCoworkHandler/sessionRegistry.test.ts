import { describe, expect, test } from 'vitest';

import { CoworkExecutionMode, CoworkSessionSource } from '../../../shared/cowork/constants';
import { IMCoworkSessionRegistry } from './sessionRegistry';

class FakeRuntime {
  stopCalls: string[] = [];
  stopSession(sessionId: string) {
    this.stopCalls.push(sessionId);
  }
}

function createCoworkStore() {
  return {
    config: {
      workingDirectory: process.cwd(),
      systemPrompt: '',
      executionMode: CoworkExecutionMode.Local,
      agentEngine: 'pi',
    },
    sessions: new Map<string, Record<string, unknown>>(),
    sessionCounter: 0,
    workspaces: new Map([
      ['workspace-1', { id: 'workspace-1', name: 'Workspace 1', path: 'C:\\workspace-1' }],
    ]),
    titleUpdates: [] as Array<{ id: string; updates: Record<string, unknown> }>,

    getConfig() {
      return this.config;
    },
    getWorkspace(id: string) {
      return this.workspaces.get(id) || null;
    },
    createSession(title: string, cwd: string) {
      const session = {
        id: `session-${++this.sessionCounter}`,
        title,
        cwd,
        titleUserRenamed: false,
        messages: [],
        source: CoworkSessionSource.Im,
      };
      this.sessions.set(session.id, session);
      return session;
    },
    getSession(id: string) {
      return this.sessions.get(id) || null;
    },
    updateSession(id: string, updates: Record<string, unknown>) {
      this.titleUpdates.push({ id, updates });
      const session = this.sessions.get(id);
      if (session) Object.assign(session, updates);
    },
  };
}

function createIMStore() {
  return {
    mappings: [] as Array<Record<string, unknown>>,
    listSessionMappings() {
      return [...this.mappings];
    },
    getSessionMapping(imConversationId: string, platform: string) {
      return (
        this.mappings.find(
          entry => entry.imConversationId === imConversationId && entry.platform === platform,
        ) || null
      );
    },
    getSessionMappingByCoworkSessionId(coworkSessionId: string) {
      return this.mappings.find(entry => entry.coworkSessionId === coworkSessionId) || null;
    },
    createSessionMapping(imConversationId: string, platform: string, coworkSessionId: string) {
      const mapping = {
        imConversationId,
        platform,
        coworkSessionId,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
      };
      this.mappings.push(mapping);
      return mapping;
    },
    updateSessionLastActive() {},
    deleteSessionMapping(imConversationId: string, platform: string) {
      this.mappings = this.mappings.filter(
        entry => entry.imConversationId !== imConversationId || entry.platform !== platform,
      );
    },
  };
}

function createRegistry(coworkStore = createCoworkStore(), imStore = createIMStore()) {
  const runtime = new FakeRuntime();
  const invalidated: string[] = [];
  const registry = new IMCoworkSessionRegistry({
    coworkRuntime: runtime as never,
    coworkStore: coworkStore as never,
    imStore: imStore as never,
    buildSystemPrompt: async () => 'system-prompt',
    onSessionInvalidated: coworkSessionId => invalidated.push(coworkSessionId),
  });
  return { registry, runtime, invalidated, coworkStore, imStore };
}

describe('IMCoworkSessionRegistry construction', () => {
  test('rewrites legacy mapped titles to the platform default', () => {
    const coworkStore = createCoworkStore();
    const imStore = createIMStore();
    const session = coworkStore.createSession('客户沟通', process.cwd());
    imStore.createSessionMapping('default:user-42', 'weixin', session.id);

    createRegistry(coworkStore, imStore);

    expect(coworkStore.sessions.get(session.id)?.title).toBe('微信会话');
  });

  test('keeps user-renamed titles', () => {
    const coworkStore = createCoworkStore();
    const imStore = createIMStore();
    const session = coworkStore.createSession('客户沟通', process.cwd());
    session.titleUserRenamed = true;
    imStore.createSessionMapping('default:user-42', 'weixin', session.id);

    createRegistry(coworkStore, imStore);

    expect(coworkStore.sessions.get(session.id)?.title).toBe('客户沟通');
  });

  test('lazily tracks mappings even when the cowork session is gone', () => {
    const coworkStore = createCoworkStore();
    const imStore = createIMStore();
    imStore.createSessionMapping('default:user-42', 'qq', 'session-missing');

    const { registry } = createRegistry(coworkStore, imStore);
    expect(registry.ensureTrackedSession('session-missing')).toBe(true);
    expect(registry.getConversation('session-missing')).toEqual({
      conversationId: 'default:user-42',
      platform: 'qq',
    });
  });
});

describe('getOrCreateSession', () => {
  test('reuses an existing healthy mapping', async () => {
    const { registry, coworkStore, imStore } = createRegistry();
    const session = coworkStore.createSession('钉钉会话', process.cwd());
    imStore.createSessionMapping('conv-1', 'dingtalk', session.id);

    const result = await registry.getOrCreateSession('conv-1', 'dingtalk', false, 'workspace-1');
    expect(result).toBe(session.id);
    expect(imStore.mappings).toHaveLength(1);
    expect(registry.getConversation(session.id)).toEqual({
      conversationId: 'conv-1',
      platform: 'dingtalk',
    });
  });

  test('creates a session titled by platform and mapped to the conversation', async () => {
    const { registry, coworkStore, imStore } = createRegistry();

    const sessionId = await registry.getOrCreateSession('conv-1', 'feishu', false, 'workspace-1');

    expect(coworkStore.sessions.get(sessionId)?.title).toBe('飞书会话');
    expect(imStore.mappings).toHaveLength(1);
    expect(imStore.mappings[0]).toMatchObject({
      imConversationId: 'conv-1',
      platform: 'feishu',
      coworkSessionId: sessionId,
    });
    expect(registry.ensureTrackedSession(sessionId)).toBe(true);
  });

  test('requires a configured workspace when creating a session', async () => {
    const { registry } = createRegistry();
    await expect(
      registry.getOrCreateSession('conv-1', 'dingtalk', false, 'workspace-missing'),
    ).rejects.toThrow('Channel account workspace is not configured');
    await expect(registry.getOrCreateSession('conv-1', 'dingtalk', false)).rejects.toThrow(
      'Channel account workspace is not configured',
    );
  });

  test('drops a stale mapping when the cowork session is missing', async () => {
    const { registry, runtime, invalidated, coworkStore, imStore } = createRegistry();
    imStore.createSessionMapping('conv-1', 'dingtalk', 'session-gone');

    const sessionId = await registry.getOrCreateSession('conv-1', 'dingtalk', false, 'workspace-1');

    expect(sessionId).not.toBe('session-gone');
    expect(imStore.mappings).toHaveLength(1);
    expect(imStore.mappings[0].coworkSessionId).toBe(sessionId);
    expect(runtime.stopCalls).toEqual(['session-gone']);
    expect(invalidated).toEqual(['session-gone']);
    expect(coworkStore.sessions.get(sessionId)?.title).toBe('钉钉会话');
  });

  test('forceNewSession discards the previous mapping and stops the old session', async () => {
    const { registry, runtime, invalidated, imStore } = createRegistry();
    const first = await registry.getOrCreateSession('conv-1', 'dingtalk', false, 'workspace-1');

    const second = await registry.getOrCreateSession('conv-1', 'dingtalk', true, 'workspace-1');

    expect(second).not.toBe(first);
    expect(imStore.mappings).toHaveLength(1);
    expect(imStore.mappings[0].coworkSessionId).toBe(second);
    expect(runtime.stopCalls).toEqual([first]);
    expect(invalidated).toEqual([first]);
    expect(registry.getConversation(first)).toBeUndefined();
    expect(registry.getConversation(second)).toEqual({
      conversationId: 'conv-1',
      platform: 'dingtalk',
    });
  });
});

describe('ensureTrackedSession', () => {
  test('lazily tracks sessions that exist in the mapping store', async () => {
    const { registry, coworkStore, imStore } = createRegistry();
    const session = coworkStore.createSession('IM-dingtalk', process.cwd());
    imStore.createSessionMapping('default:user-42', 'dingtalk', session.id);

    expect(registry.ensureTrackedSession(session.id)).toBe(true);
    expect(registry.getConversation(session.id)).toEqual({
      conversationId: 'default:user-42',
      platform: 'dingtalk',
    });
    expect(registry.ensureTrackedSession(session.id)).toBe(true);

    expect(registry.ensureTrackedSession('session-unknown')).toBe(false);
    expect(registry.getConversation('session-unknown')).toBeUndefined();
  });
});
