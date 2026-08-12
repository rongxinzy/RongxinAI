import EventEmitter from 'node:events';

import { beforeEach, expect, test, vi } from 'vitest';

import { CoworkErrorKind } from '../../common/coworkError';
import { ChannelRunIpc, ChannelRunStatus } from '../../shared/channelRun/constants';
import { IMCoworkHandler } from './imCoworkHandler';

const electronMocks = vi.hoisted(() => ({
  send: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { send: electronMocks.send },
      },
    ],
  },
}));

beforeEach(() => {
  electronMocks.send.mockClear();
});

class FakeRuntime extends EventEmitter {
  startCalls: Array<{ sessionId: string; prompt: string; options: Record<string, unknown> }> = [];
  continueCalls: Array<{ sessionId: string; prompt: string; options: Record<string, unknown> }> =
    [];
  stopCalls: string[] = [];

  async startSession(sessionId: string, prompt: string, options = {}) {
    this.startCalls.push({ sessionId, prompt, options });
  }

  async continueSession(sessionId: string, prompt: string, options = {}) {
    this.continueCalls.push({ sessionId, prompt, options });
  }

  stopSession(sessionId: string) { this.stopCalls.push(sessionId); }
  stopAllSessions() {}
  respondToPermission() {}
  isSessionActive() {
    return false;
  }
  getSessionConfirmationMode() {
    return 'text';
  }
}

class FakeCoworkStore {
  config = {
    workingDirectory: process.cwd(),
    systemPrompt: '',
    executionMode: 'auto',
    agentEngine: 'pi',
  };
  sessions = new Map<string, Record<string, unknown>>();
  sessionCounter = 0;
  messageCounter = 0;
  workspaces = new Map([
    ['workspace-1', { id: 'workspace-1', name: 'Workspace 1', path: 'C:\\workspace-1' }],
    ['workspace-2', { id: 'workspace-2', name: 'Workspace 2', path: 'C:\\workspace-2' }],
  ]);

  getConfig() {
    return this.config;
  }

  getAgent() {
    return null;
  }

  getWorkspace(id: string) {
    return this.workspaces.get(id) || null;
  }

  createSession(
    title: string,
    cwd: string,
    systemPrompt: string,
    executionMode: string,
    activeSkillIds: string[] = [],
    agentId = 'main',
    modelOverride = '',
    mode: 'work' | 'chat' = 'work',
    _id?: string,
    workspaceId = 'workspace-1',
  ) {
    const id = `session-${++this.sessionCounter}`;
    const session = {
      id,
      title,
      cwd,
      systemPrompt,
      executionMode,
      activeSkillIds,
      agentId,
      modelOverride,
      mode,
      workspaceId,
      claudeSessionId: null,
      status: 'idle',
      messages: [] as Array<Record<string, unknown>>,
    };
    this.sessions.set(id, session);
    return session;
  }

  getSession(id: string) {
    return this.sessions.get(id) || null;
  }

  updateSession(id: string, updates: Record<string, unknown>) {
    const session = this.sessions.get(id);
    if (!session) return;
    Object.assign(session, updates);
  }

  addMessage(sessionId: string, message: Record<string, unknown>) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    const created = {
      id: `message-${++this.messageCounter}`,
      timestamp: Date.now(),
      ...message,
    };
    (session.messages as Array<Record<string, unknown>>).push(created);
    return created;
  }
}

class FakeIMStore {
  mappings: Array<Record<string, unknown>> = [];
  settings = { skillsEnabled: false };

  getIMSettings() {
    return this.settings;
  }

  listSessionMappings() {
    return [...this.mappings];
  }

  getSessionMapping(imConversationId: string, platform: string) {
    return (
      this.mappings.find(
        entry => entry.imConversationId === imConversationId && entry.platform === platform,
      ) || null
    );
  }

  getSessionMappingByCoworkSessionId(coworkSessionId: string) {
    return this.mappings.find(entry => entry.coworkSessionId === coworkSessionId) || null;
  }

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
  }

  updateSessionLastActive(imConversationId: string, platform: string) {
    const mapping = this.getSessionMapping(imConversationId, platform);
    if (mapping) {
      mapping.lastActiveAt = Date.now();
    }
  }

  deleteSessionMapping(imConversationId: string, platform: string) {
    this.mappings = this.mappings.filter(
      entry => entry.imConversationId !== imConversationId || entry.platform !== platform,
    );
  }
}

function createMessage(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'dingtalk',
    messageId: 'im-msg-1',
    conversationId: 'conv-1',
    senderId: 'user-1',
    senderName: 'Tester',
    content: '2分钟后提醒我喝水',
    chatType: 'direct',
    timestamp: Date.parse('2026-03-15T16:28:00+08:00'),
    ...overrides,
  };
}

test('IM scheduled-task requests bypass agent execution and create a real cron.add turn', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  let createdParams: Record<string, unknown> | null = null;

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
    detectScheduledTaskRequest: async () => ({
      kind: 'create',
      sourceText: '2分钟后提醒我喝水',
      reminderBody: '喝水',
      delayMs: 120000,
      delayLabel: '2分钟后',
      runAt: new Date('2026-03-15T16:30:00+08:00'),
      scheduleAt: '2026-03-15T16:30:00+08:00',
      taskName: '喝水提醒',
      payloadText: '⏰ 提醒：喝水',
      confirmationText: '好的，已设置好提醒！2分钟后（16:30）会提醒你喝水。',
    }),
    createScheduledTask: async (params: Record<string, unknown>) => {
      createdParams = params;
      return {
        id: 'job-1',
        name: (params.request as Record<string, unknown>).taskName,
        sessionKey: `zhiyuan:${params.sessionId}`,
        payloadText: (params.request as Record<string, unknown>).payloadText,
        scheduleAt: (params.request as Record<string, unknown>).scheduleAt,
      };
    },
  });

  const reply = await handler.processMessage(createMessage(), undefined, 'workspace-1');

  expect(reply).toMatch(/2分钟后（16:30）会提醒你喝水/u);
  expect(runtime.startCalls.length).toBe(0);
  expect(runtime.continueCalls.length).toBe(0);
  expect(createdParams).toBeTruthy();
  expect((createdParams!.request as Record<string, unknown>).taskName).toBe('喝水提醒');
  expect((createdParams!.request as Record<string, unknown>).payloadText).toBe('⏰ 提醒：喝水');

  const [session] = [...coworkStore.sessions.values()];
  expect(session).toBeTruthy();
  expect((session.messages as Array<Record<string, unknown>>).map(message => message.type)).toEqual(
    ['user', 'tool_use', 'tool_result', 'assistant'],
  );
  expect(
    ((session.messages as Array<Record<string, unknown>>)[1].metadata as Record<string, unknown>)
      .toolName,
  ).toBe('cron');
  expect(
    ((session.messages as Array<Record<string, unknown>>)[1].metadata as Record<string, unknown>)
      .toolInput as Record<string, unknown>,
  ).toHaveProperty('action', 'add');
  expect(
    ((session.messages as Array<Record<string, unknown>>)[2].metadata as Record<string, unknown>)
      .isError,
  ).toBe(false);

  handler.destroy();
});

test.skip('async reminder turns on IM-created sessions relay back to the original IM conversation', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const relayedReplies: Array<{ platform: string; conversationId: string; text: string }> = [];

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
    detectScheduledTaskRequest: async () => ({
      kind: 'create',
      sourceText: '2分钟后提醒我喝水',
      reminderBody: '喝水',
      delayMs: 120000,
      delayLabel: '2分钟后',
      runAt: new Date('2026-03-15T16:30:00+08:00'),
      scheduleAt: '2026-03-15T16:30:00+08:00',
      taskName: '喝水提醒',
      payloadText: '⏰ 提醒：喝水',
      confirmationText: '好的，已设置好提醒！2分钟后（16:30）会提醒你喝水。',
    }),
    createScheduledTask: async (params: Record<string, unknown>) => ({
      id: 'job-1',
      name: (params.request as Record<string, unknown>).taskName,
      sessionKey: `zhiyuan:${params.sessionId}`,
      payloadText: (params.request as Record<string, unknown>).payloadText,
      scheduleAt: (params.request as Record<string, unknown>).scheduleAt,
    }),
    sendAsyncReply: async (platform: string, conversationId: string, text: string) => {
      relayedReplies.push({ platform, conversationId, text });
      return true;
    },
  });

  await handler.processMessage(createMessage(), undefined, 'workspace-1');
  const [session] = [...coworkStore.sessions.values()];

  runtime.emit('message', session.id, {
    id: 'system-1',
    type: 'system',
    content: '⏰ 提醒：喝水',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('message', session.id, {
    id: 'assistant-1',
    type: 'assistant',
    content: '⏰ 该喝水啦！起身喝一杯水吧。',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', session.id, null);

  await new Promise(resolve => setImmediate(resolve));

  expect(relayedReplies).toEqual([
    {
      platform: 'dingtalk',
      conversationId: 'conv-1',
      text: '⏰ 该喝水啦！起身喝一杯水吧。',
    },
  ]);

  handler.destroy();
});

test('async reminder turns on channel-synced sessions are tracked lazily and relay back', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const relayedReplies: Array<{ platform: string; conversationId: string; text: string }> = [];

  const session = coworkStore.createSession('IM-dingtalk', process.cwd(), '', 'auto');
  imStore.createSessionMapping('default:user-42', 'dingtalk', session.id as string);

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
    sendAsyncReply: async (platform: string, conversationId: string, text: string) => {
      relayedReplies.push({ platform, conversationId, text });
      return true;
    },
  });

  coworkStore.addMessage(session.id as string, {
    id: 'assistant-history',
    type: 'assistant',
    content: 'Previous conversation reply.',
    metadata: {},
  });
  runtime.emit('message', session.id, {
    id: 'system-1',
    type: 'system',
    content: '⏰ 提醒：开会',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('message', session.id, {
    id: 'assistant-1',
    type: 'assistant',
    content: '时间到了，记得开会。',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', session.id, null);

  await new Promise(resolve => setImmediate(resolve));

  expect(relayedReplies).toEqual([
    {
      platform: 'dingtalk',
      conversationId: 'default:user-42',
      text: '时间到了，记得开会。',
    },
  ]);

  handler.destroy();
});

test('falls back to normal agent execution when detector does not recognize a scheduled task', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
    detectScheduledTaskRequest: async () => null,
  });

  const pending = handler.processMessage(
    createMessage({ content: '帮我总结一下今天的会议纪要' }),
    undefined,
    'workspace-1',
  );
  await new Promise(resolve => setImmediate(resolve));

  expect(runtime.startCalls.length).toBe(1);
  expect(runtime.startCalls[0].prompt).toBe('帮我总结一下今天的会议纪要');

  runtime.emit('message', 'session-1', {
    id: 'assistant-1',
    type: 'assistant',
    content: '这是会议纪要摘要。',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', 'session-1', null);

  const reply = await pending;
  expect(reply).toBe('这是会议纪要摘要。');

  handler.destroy();
});

test('cancels the Pi turn when the channel bridge request disconnects', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const handler = new IMCoworkHandler({ coworkRuntime: runtime, coworkStore, imStore });
  const controller = new AbortController();

  const response = handler.processMessage(
    createMessage({ content: 'Generate a report.' }),
    controller.signal,
    'workspace-1',
  );
  await vi.waitFor(() => expect(runtime.startCalls).toHaveLength(1));
  controller.abort();

  await expect(response).rejects.toThrow('Channel request was cancelled');
  expect(runtime.stopCalls).toEqual(['session-1']);

  runtime.emit('message', 'session-1', {
    id: 'late-assistant',
    type: 'assistant',
    content: 'This late result must not resolve the cancelled bridge request.',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', 'session-1', null);
  handler.destroy();
});

test('IM turns use workspace session configuration without disabling Pi tools', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  coworkStore.config.systemPrompt = 'Use the workspace conversation context.';

  const handler = new IMCoworkHandler({ coworkRuntime: runtime, coworkStore, imStore });
  const firstResponse = handler.processMessage(
    createMessage({ content: 'Draft a report.' }),
    undefined,
    'workspace-1',
  );
  await new Promise(resolve => setImmediate(resolve));

  const session = coworkStore.getSession('session-1')!;
  expect(session).toMatchObject({
    agentId: 'main',
    activeSkillIds: [],
    modelOverride: '',
    mode: 'work',
  });
  expect(runtime.startCalls[0].options).toMatchObject({
    skillIds: [],
    workspaceRoot: session.cwd,
    sessionMode: 'work',
  });
  expect(runtime.startCalls[0].options.systemPrompt).toContain(
    'Use the workspace conversation context.',
  );
  expect(runtime.startCalls[0].options).not.toHaveProperty('confirmationMode');
  expect(runtime.startCalls[0].options).not.toHaveProperty('autoApprove');

  runtime.emit('message', 'session-1', {
    id: 'assistant-1',
    type: 'assistant',
    content: 'First response.',
    timestamp: Date.now(),
    metadata: {},
  });
  coworkStore.addMessage('session-1', {
    type: 'assistant',
    content: 'First response.',
    metadata: {},
  });
  runtime.emit('complete', 'session-1', null);
  await expect(firstResponse).resolves.toBe('First response.');

  vi.spyOn(runtime, 'isSessionActive').mockReturnValue(true);
  const secondResponse = handler.processMessage(
    createMessage({ messageId: 'im-msg-2', content: 'Continue.' }),
    undefined,
    'workspace-2',
  );
  await new Promise(resolve => setImmediate(resolve));
  expect(runtime.continueCalls[0].options).toMatchObject({
    skillIds: [],
    workspaceRoot: session.cwd,
    sessionMode: 'work',
  });

  runtime.emit('message', 'session-1', {
    id: 'assistant-2',
    type: 'assistant',
    content: 'Second response.',
    timestamp: Date.now(),
    metadata: {},
  });
  coworkStore.addMessage('session-1', {
    type: 'assistant',
    content: 'Second response.',
    metadata: {},
  });
  runtime.emit('complete', 'session-1', null);
  await expect(secondResponse).resolves.toBe('Second response.');

  vi.spyOn(runtime, 'isSessionActive').mockReturnValue(false);
  const thirdResponse = handler.processMessage(
    createMessage({
      messageId: 'im-msg-3',
      conversationId: 'conv-2',
      content: 'Start another conversation.',
    }),
    undefined,
    'workspace-2',
  );
  await new Promise(resolve => setImmediate(resolve));
  expect(coworkStore.getSession('session-2')).toMatchObject({
    workspaceId: 'workspace-2',
    cwd: 'C:\\workspace-2',
  });

  runtime.emit('message', 'session-2', {
    id: 'assistant-3',
    type: 'assistant',
    content: 'Third response.',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', 'session-2', null);
  await expect(thirdResponse).resolves.toBe('Third response.');

  handler.destroy();
});

test('requires an explicit workspace when creating a channel conversation', async () => {
  const handler = new IMCoworkHandler({
    coworkRuntime: new FakeRuntime(),
    coworkStore: new FakeCoworkStore(),
    imStore: new FakeIMStore(),
  });

  await expect(handler.processMessage(createMessage())).rejects.toThrow(
    'Channel account workspace is not configured',
  );
  handler.destroy();
});

test('emits a matching terminal run event when a session fails while waiting for permission', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const handler = new IMCoworkHandler({ coworkRuntime: runtime, coworkStore, imStore });

  const response = handler.processMessage(
    createMessage({ content: '删除临时文件' }),
    undefined,
    'workspace-1',
  );
  await new Promise(resolve => setImmediate(resolve));

  runtime.emit('permissionRequest', 'session-1', {
    requestId: 'permission-1',
    toolName: 'Bash',
    toolInput: { command: 'rm temporary.txt' },
  });

  await expect(response).resolves.toMatch(/请在 60 秒内回复/u);

  runtime.emit('error', 'session-1', {
    kind: CoworkErrorKind.NetworkError,
    message: 'connection lost',
  });

  const runEvents = electronMocks.send.mock.calls
    .filter(([channel]) => channel === ChannelRunIpc.RunEvent)
    .map(([, summary]) => summary);

  expect(runEvents).toHaveLength(2);
  expect(runEvents.map(event => event.status)).toEqual([
    ChannelRunStatus.Started,
    ChannelRunStatus.Failed,
  ]);
  expect(runEvents[1].runId).toBe(runEvents[0].runId);

  handler.destroy();
});

test('closes a started run when existing-session setup fails before runtime execution', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  let failSkillsPrompt = false;
  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
    getSkillsPrompt: async () => {
      if (failSkillsPrompt) throw new Error('skill prompt unavailable');
      return null;
    },
  });

  const firstResponse = handler.processMessage(
    createMessage({ content: '第一条消息' }),
    undefined,
    'workspace-1',
  );
  await new Promise(resolve => setImmediate(resolve));
  runtime.emit('message', 'session-1', {
    id: 'assistant-1',
    type: 'assistant',
    content: '第一条回复',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', 'session-1', null);
  await expect(firstResponse).resolves.toBe('第一条回复');

  imStore.settings.skillsEnabled = true;
  failSkillsPrompt = true;
  await expect(
    handler.processMessage(
      createMessage({ messageId: 'im-msg-2', content: '第二条消息' }),
      undefined,
      'workspace-1',
    ),
  ).rejects.toThrow('skill prompt unavailable');

  const runEvents = electronMocks.send.mock.calls
    .filter(([channel]) => channel === ChannelRunIpc.RunEvent)
    .map(([, summary]) => summary);
  const secondRunEvents = runEvents.slice(-2);
  expect(secondRunEvents.map(event => event.status)).toEqual([
    ChannelRunStatus.Started,
    ChannelRunStatus.Failed,
  ]);
  expect(secondRunEvents[1].runId).toBe(secondRunEvents[0].runId);
  expect(secondRunEvents[1].errorMessage).toBe('skill prompt unavailable');

  handler.destroy();
});
