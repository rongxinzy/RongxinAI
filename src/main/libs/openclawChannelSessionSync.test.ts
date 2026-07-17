import { expect, test, vi } from 'vitest';

import {
  buildManagedSessionKey,
  DEFAULT_MANAGED_AGENT_ID,
  isManagedSessionKey,
  OpenClawChannelSessionSync,
  parseChannelSessionKey,
  parseManagedSessionKey,
} from './openclawChannelSessionSync';

function createSync() {
  return new OpenClawChannelSessionSync({
    coworkStore: {
      getSession: () => null,
      createSession: () => {
        throw new Error('createSession should not be called in this test');
      },
    },
    imStore: {
      getSessionMapping: () => null,
      updateSessionLastActive: () => {},
      deleteSessionMapping: () => {},
      createSessionMapping: () => {},
    },
    getDefaultCwd: () => '/tmp',
  });
}

test('parseManagedSessionKey handles raw local session keys', () => {
  expect(parseManagedSessionKey('zhiyuan:abc-123')).toEqual({
    agentId: null,
    sessionId: 'abc-123',
  });
});

test('parseManagedSessionKey handles canonical local session keys', () => {
  expect(parseManagedSessionKey('agent:main:zhiyuan:abc-123')).toEqual({
    agentId: 'main',
    sessionId: 'abc-123',
  });
});

test('buildManagedSessionKey emits canonical local session keys', () => {
  expect(buildManagedSessionKey('abc-123')).toBe(
    `agent:${DEFAULT_MANAGED_AGENT_ID}:zhiyuan:abc-123`,
  );
  expect(buildManagedSessionKey('abc-123', 'secondary')).toBe('agent:secondary:zhiyuan:abc-123');
});

test('parseChannelSessionKey ignores managed local session keys', () => {
  expect(parseChannelSessionKey('zhiyuan:abc-123')).toBe(null);
  expect(parseChannelSessionKey('agent:main:zhiyuan:abc-123')).toBe(null);
});

test('channel sync does not treat managed local session keys as channel sessions', () => {
  const sync = createSync();

  expect(isManagedSessionKey('agent:main:zhiyuan:abc-123')).toBe(true);
  expect(sync.isChannelSessionKey('agent:main:zhiyuan:abc-123')).toBe(false);
  expect(sync.resolveOrCreateSession('agent:main:zhiyuan:abc-123')).toBe(null);
  expect(sync.resolveOrCreateMainAgentSession('agent:main:zhiyuan:abc-123')).toBe(null);
});

test('channel sync still recognizes real channel session keys', () => {
  const sync = createSync();

  expect(parseChannelSessionKey('agent:main:feishu:dm:ou_123')).toEqual({
    platform: 'feishu',
    conversationId: 'dm:ou_123',
  });
  expect(sync.isChannelSessionKey('agent:main:main')).toBe(true);
});

test('channel sync stores the real OpenClaw session key when creating a mapping', () => {
  const createSessionMapping = vi.fn();
  const getDefaultCwd = vi.fn((agentId?: string) => `/tmp/${agentId || 'fallback'}`);
  const createSession = vi.fn(
    (
      title: string,
      cwd: string,
      systemPrompt: string,
      executionMode: 'local',
      activeSkillIds: string[],
      agentId: string,
    ) => ({
      id: 'cowork-1',
      title,
      claudeSessionId: null,
      status: 'idle' as const,
      pinned: false,
      cwd,
      systemPrompt,
      modelOverride: '',
      executionMode,
      activeSkillIds,
      agentId,
      messages: [],
      createdAt: 1,
      updatedAt: 1,
    }),
  );
  const sync = new OpenClawChannelSessionSync({
    coworkStore: {
      getSession: () => null,
      createSession,
    },
    imStore: {
      getIMSettings: () => ({ skillsEnabled: true }),
      getSessionMapping: () => null,
      updateSessionLastActive: () => {},
      deleteSessionMapping: () => {},
      createSessionMapping,
    },
    getDefaultCwd,
  });

  const sessionKey = 'agent:main:feishu:dm:ou_123';

  expect(sync.resolveOrCreateSession(sessionKey)).toBe('cowork-1');
  expect(getDefaultCwd).toHaveBeenCalledWith('main');
  expect(createSession).toHaveBeenCalledWith(
    expect.any(String),
    '/tmp/main',
    '',
    'local',
    [],
    'main',
  );
  expect(createSessionMapping).toHaveBeenCalledWith(
    'dm:ou_123',
    'feishu',
    'cowork-1',
    'main',
    sessionKey,
  );
});

test('channel sync backfills the real OpenClaw session key for existing mappings', () => {
  const updateSessionOpenClawSessionKey = vi.fn();
  const sync = new OpenClawChannelSessionSync({
    coworkStore: {
      getSession: () => ({
        id: 'cowork-1',
        title: '[Feishu] ou_123',
        claudeSessionId: null,
        status: 'idle',
        pinned: false,
        cwd: '/tmp',
        systemPrompt: '',
        modelOverride: '',
        executionMode: 'local',
        activeSkillIds: [],
        agentId: 'main',
        messages: [],
        createdAt: 1,
        updatedAt: 1,
      }),
      createSession: () => {
        throw new Error('createSession should not be called');
      },
    },
    imStore: {
      getIMSettings: () => ({ skillsEnabled: true }),
      getSessionMapping: () => ({
        imConversationId: 'dm:ou_123',
        platform: 'feishu',
        coworkSessionId: 'cowork-1',
        agentId: 'main',
        createdAt: 1,
        lastActiveAt: 1,
      }),
      updateSessionOpenClawSessionKey,
      updateSessionLastActive: () => {},
      deleteSessionMapping: () => {},
      createSessionMapping: () => {},
    },
    getDefaultCwd: () => '/tmp',
  });

  const sessionKey = 'agent:main:feishu:dm:ou_123';

  expect(sync.resolveOrCreateSession(sessionKey)).toBe('cowork-1');
  expect(updateSessionOpenClawSessionKey).toHaveBeenCalledWith('dm:ou_123', 'feishu', sessionKey);
});
