import { CoworkExecutionMode } from '../../shared/cowork/constants';
import EventEmitter from 'node:events';

import { beforeEach, expect, test, vi } from 'vitest';

import { CoworkErrorKind } from '../../common/coworkError';
import { t } from '../i18n';
import { ActivityStatus } from '../../shared/activity/constants';
import { CoworkSessionSource } from '../../shared/cowork/constants';
import { IMCoworkHandler } from './imCoworkHandler';
import { getCcConnectScopedConversationId } from './ccConnectConversationId';

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
  continueCalls: Array<{ sessionId: string; prompt: string; options: Record<string, unknown> }> =
    [];
  stopCalls: string[] = [];

  async continueSession(sessionId: string, prompt: string, options = {}) {
    this.continueCalls.push({ sessionId, prompt, options });
  }

  stopSession(sessionId: string) {
    this.stopCalls.push(sessionId);
  }
  stopAllSessions() {}
  getLiveStreamTexts(): Array<{
    messageId: string;
    content: string;
    metadata: Record<string, unknown>;
  }> {
    return [];
  }
  respondToPermission() {}
  isSessionActive() {
    return false;
  }
  getSessionConfirmationMode() {
    return 'text';
  }
}

test('does not recreate a channel session after an API rejection', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const failure = new Error('API error 400: maximum context length');
  vi.spyOn(runtime, 'continueSession').mockRejectedValue(failure);
  const handler = new IMCoworkHandler({ coworkRuntime: runtime, coworkStore, imStore });
  try {
    await expect(handler.processMessage(createMessage(), undefined, 'workspace-1')).rejects.toThrow(
      failure,
    );
    expect(runtime.continueSession).toHaveBeenCalledTimes(1);
    expect(coworkStore.sessions.size).toBe(1);
    expect(imStore.mappings).toHaveLength(1);
  } finally {
    handler.destroy();
  }
});

class FakeCoworkStore {
  config = {
    workingDirectory: process.cwd(),
    systemPrompt: '',
    executionMode: CoworkExecutionMode.Auto,
    agentEngine: 'pi',
  };
  sessions = new Map<string, Record<string, unknown>>();
  sessionCounter = 0;
  messageCounter = 0;
  private readonly workspaceRows = new Map([
    ['workspace-1', { id: 'workspace-1', name: 'Workspace 1', path: 'C:\\workspace-1' }],
    ['workspace-2', { id: 'workspace-2', name: 'Workspace 2', path: 'C:\\workspace-2' }],
  ]);
  readonly workspaces = { getWorkspace: (id: string) => this.workspaceRows.get(id) || null };
  readonly messages = {
    countSessionMessages: (id: string) => this.getSession(id)?.messages.length ?? 0,
    getPagedSessionMessages: (id: string, limit: number, offset: number) =>
      this.getSession(id)?.messages.slice(offset, limit < 0 ? undefined : offset + limit) ?? [],
  };

  getConfig() {
    return this.config;
  }

  getAgent() {
    return null;
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
    _expertSnapshots: unknown[] = [],
    source = CoworkSessionSource.Manual,
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
      source,
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

test('reminder requests run through the agent and reply with the task confirmation', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
  });

  const pending = handler.processMessage(
    createMessage({ content: '2分钟后提醒我喝水' }),
    undefined,
    'workspace-1',
  );
  await new Promise(resolve => setImmediate(resolve));

  // The pre-Pi detector is gone: reminder wording starts a normal agent turn
  // and the task is created through the scheduled_task tool inside it.
  expect(runtime.continueCalls.length).toBe(1);
  expect(runtime.continueCalls[0].prompt).toContain('2分钟后提醒我喝水');

  const [session] = [...coworkStore.sessions.values()];
  expect(session).toBeTruthy();

  // The model confirms through the Pi scheduled_task tool; the reply guard must
  // recognize that tool as a real task creation.
  coworkStore.addMessage(session.id as string, {
    id: 'tool-use-1',
    type: 'tool_use',
    content: 'Using tool: scheduled_task',
    timestamp: Date.now(),
    metadata: { toolName: 'scheduled_task', toolUseId: 'tool-use-1', toolInput: {} },
  });
  coworkStore.addMessage(session.id as string, {
    id: 'tool-result-1',
    type: 'tool_result',
    content: 'Scheduled task created: 喝水提醒',
    timestamp: Date.now(),
    metadata: { toolUseId: 'tool-use-1', toolResult: 'Scheduled task created', isError: false },
  });
  coworkStore.addMessage(session.id as string, {
    id: 'assistant-1',
    type: 'assistant',
    content: '好的，已经通过定时任务安排了提醒。',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', session.id as string);
  const reply = await pending;
  expect(reply).toBe('好的，已经通过定时任务安排了提醒。');

  handler.destroy();
});

test('persists the scoped channel mapping before dispatching the agent', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
  });

  const scopedId = getCcConnectScopedConversationId('acct-7', 'native-conv-9');
  const pending = handler.processMessage(
    createMessage({ conversationId: scopedId, content: '5分钟后提醒我复盘' }),
    undefined,
    'workspace-1',
  );
  await new Promise(resolve => setImmediate(resolve));

  const [session] = [...coworkStore.sessions.values()];
  expect(runtime.continueCalls[0]?.sessionId).toBe(session.id);
  expect(imStore.getSessionMappingByCoworkSessionId(session.id as string)).toMatchObject({
    platform: 'dingtalk',
    imConversationId: scopedId,
  });

  runtime.emit('complete', session.id as string);
  await pending;
  handler.destroy();
  handler.destroy();
});

test('ignores executor-owned turns even when they use a mapped channel session', () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const session = coworkStore.createSession('Channel chat', process.cwd(), '', 'auto');
  imStore.createSessionMapping('default:user-42', 'dingtalk', session.id as string);
  const readMessages = vi.spyOn(coworkStore.messages, 'getPagedSessionMessages');
  const handler = new IMCoworkHandler({ coworkRuntime: runtime, coworkStore, imStore });
  try {
    coworkStore.addMessage(session.id, {
      id: 'assistant-1',
      type: 'assistant',
      content: 'Scheduled reminder',
      timestamp: Date.now(),
    });
    runtime.emit('complete', session.id);
    expect(readMessages).not.toHaveBeenCalled();
  } finally {
    handler.destroy();
  }
});

test('replaces every mapped IM session title with the platform default when loading conversations', () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const session = coworkStore.createSession('IM-weixin-1788865000000', process.cwd(), '', 'auto');
  imStore.createSessionMapping('default:user-42', 'weixin', session.id as string);

  const handler = new IMCoworkHandler({ coworkRuntime: runtime, coworkStore, imStore });

  expect(coworkStore.getSession(session.id as string)?.title).toBe('微信会话');
  handler.destroy();
});

test('uses the mapped platform rather than title content when normalizing IM session titles', () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const sessions = [
    { platform: 'feishu', title: '任意外部标识' },
    { platform: 'dingtalk', title: '群聊名称也不保留' },
    { platform: 'wecom', title: 'user@unknown-format' },
    { platform: 'qq', title: '123456789' },
    { platform: 'telegram', title: 'chat::opaque' },
    { platform: 'discord', title: 'id with symbols !#$' },
  ] as const;

  for (const [index, item] of sessions.entries()) {
    const session = coworkStore.createSession(item.title, process.cwd(), '', 'auto');
    imStore.createSessionMapping(`conversation-${index}`, item.platform, session.id as string);
  }

  const handler = new IMCoworkHandler({ coworkRuntime: runtime, coworkStore, imStore });

  expect(Array.from(coworkStore.sessions.values()).map(session => session.title)).toEqual([
    '飞书会话',
    '钉钉会话',
    '企微会话',
    'QQ会话',
    'Telegram会话',
    'Discord会话',
  ]);
  handler.destroy();
});

test('resets mapped IM session titles to the platform default when loading conversations', () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const session = coworkStore.createSession('客户沟通', process.cwd(), '', 'auto');
  imStore.createSessionMapping('default:user-42', 'weixin', session.id as string);

  const handler = new IMCoworkHandler({ coworkRuntime: runtime, coworkStore, imStore });

  expect(coworkStore.getSession(session.id as string)?.title).toBe('微信会话');
  handler.destroy();
});

test('preserves a user-renamed mapped IM session title when loading conversations', () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const session = coworkStore.createSession('客户沟通', process.cwd(), '', 'auto');
  session.titleUserRenamed = true;
  imStore.createSessionMapping('default:user-42', 'weixin', session.id as string);

  const handler = new IMCoworkHandler({ coworkRuntime: runtime, coworkStore, imStore });

  expect(coworkStore.getSession(session.id as string)?.title).toBe('客户沟通');
  handler.destroy();
});

test('runs a normal agent turn for non-reminder requests', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();

  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
  });

  const pending = handler.processMessage(
    createMessage({ content: '帮我总结一下今天的会议纪要' }),
    undefined,
    'workspace-1',
  );
  await new Promise(resolve => setImmediate(resolve));

  expect(runtime.continueCalls.length).toBe(1);
  expect(runtime.continueCalls[0].prompt).toBe('帮我总结一下今天的会议纪要');

  coworkStore.addMessage('session-1', {
    type: 'assistant',
    content: '这是会议纪要摘要。',
    metadata: { isStreaming: false },
  });
  runtime.emit('complete', 'session-1');

  const reply = await pending;
  expect(reply).toBe('这是会议纪要摘要。');

  handler.destroy();
});

test('uses only the IM platform for WeChat session titles', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore: new FakeIMStore(),
  });

  const response = handler.processMessage(
    createMessage({ platform: 'weixin', senderName: '微信用户', content: '你好' }),
    undefined,
    'workspace-1',
  );
  await vi.waitFor(() => expect(runtime.continueCalls).toHaveLength(1));

  expect(coworkStore.getSession('session-1')?.title).toBe('微信会话');

  coworkStore.addMessage('session-1', {
    id: 'assistant-1',
    type: 'assistant',
    content: '你好',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', 'session-1');

  await expect(response).resolves.toBe('你好');
  handler.destroy();
});

test('uses only the IM platform for group and direct session titles', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore: new FakeIMStore(),
  });

  const groupResponse = handler.processMessage(
    createMessage({ chatType: 'group', groupName: '产品讨论组', senderName: '测试用户' }),
    undefined,
    'workspace-1',
  );
  await vi.waitFor(() => expect(runtime.continueCalls).toHaveLength(1));
  expect(coworkStore.getSession('session-1')?.title).toBe('钉钉会话');
  coworkStore.addMessage('session-1', {
    id: 'assistant-group',
    type: 'assistant',
    content: '群聊回复',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', 'session-1');
  await expect(groupResponse).resolves.toBe('群聊回复');

  const fallbackResponse = handler.processMessage(
    createMessage({ messageId: 'im-msg-2', conversationId: 'opaque-123', senderName: undefined }),
    undefined,
    'workspace-1',
  );
  await vi.waitFor(() => expect(runtime.continueCalls).toHaveLength(2));
  expect(coworkStore.getSession('session-2')?.title).toBe('钉钉会话');
  coworkStore.addMessage('session-2', {
    id: 'assistant-fallback',
    type: 'assistant',
    content: '兜底回复',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', 'session-2');
  await expect(fallbackResponse).resolves.toBe('兜底回复');

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
  await vi.waitFor(() => expect(runtime.continueCalls).toHaveLength(1));
  controller.abort();

  await expect(response).rejects.toThrow('Channel request was cancelled');
  expect(runtime.stopCalls).toEqual(['session-1']);

  coworkStore.addMessage('session-1', {
    id: 'late-assistant',
    type: 'assistant',
    content: 'This late result must not resolve the cancelled bridge request.',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', 'session-1');
  handler.destroy();
});

test.each(['stop', 'timeout'])('reads the current Pi reply on channel %s', async exit => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore: new FakeIMStore(),
  });
  const readLive = vi.spyOn(runtime, 'getLiveStreamTexts').mockReturnValue([
    { messageId: 'assistant-1', content: 'Current partial reply.', metadata: {} },
    { messageId: 'unrelated', content: 'Unrelated reply.', metadata: {} },
  ]);
  try {
    const pending = handler.processMessage(createMessage(), undefined, 'workspace-1');
    await new Promise(resolve => setImmediate(resolve));
    coworkStore.addMessage('session-1', {
      id: 'assistant-1',
      type: 'assistant',
      content: 'Initial reply.',
      timestamp: Date.now(),
      metadata: { isStreaming: true },
    });
    runtime.emit('message', 'session-1', {
      id: 'discarded-answer',
      type: 'assistant',
      content: 'Discarded by Pi recovery.',
      timestamp: Date.now(),
    });
    runtime.emit('messageRemoved', 'session-1', 'discarded-answer');
    runtime.emit('messageUpdate', 'session-1', 'assistant-1', 'Per-token snapshot.', {
      isStreaming: true,
    });
    expect(readLive).not.toHaveBeenCalled();
    if (exit === 'stop') {
      runtime.emit('sessionStopped', 'session-1');
      await expect(pending).resolves.toBe('Current partial reply.');
    } else {
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 30 * 1000);
      await expect(pending).resolves.toBe('Current partial reply.\n\n[处理超时，以上为部分结果]');
      expect(runtime.stopCalls).toEqual(['session-1']);
    }
    expect(readLive).toHaveBeenCalledExactlyOnceWith('session-1');
  } finally {
    handler.destroy();
    vi.useRealTimers();
  }
});

test('stops and rejects a timed-out Channel turn when the reply cannot be read', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  vi.spyOn(coworkStore.messages, 'getPagedSessionMessages').mockImplementation(() => {
    throw new Error('transcript unavailable');
  });
  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore: new FakeIMStore(),
  });
  try {
    const pending = handler.processMessage(createMessage(), undefined, 'workspace-1');
    const rejection = expect(pending).rejects.toThrow('transcript unavailable');
    await new Promise(resolve => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 30 * 1000);
    await rejection;
    expect(runtime.stopCalls).toEqual(['session-1']);
  } finally {
    handler.destroy();
    vi.useRealTimers();
  }
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
    source: CoworkSessionSource.Im,
  });
  expect(runtime.continueCalls[0].options).toMatchObject({
    skillIds: [],
    workspaceRoot: session.cwd,
    sessionMode: 'work',
  });
  expect(runtime.continueCalls[0].options.systemPrompt).toContain(
    'Use the workspace conversation context.',
  );
  expect(runtime.continueCalls[0].options).not.toHaveProperty('confirmationMode');
  expect(runtime.continueCalls[0].options).not.toHaveProperty('approvalMode');

  coworkStore.addMessage('session-1', {
    type: 'assistant',
    content: 'First response.',
    metadata: {},
  });
  runtime.emit('complete', 'session-1');
  await expect(firstResponse).resolves.toBe('First response.');

  const secondResponse = handler.processMessage(
    createMessage({ messageId: 'im-msg-2', content: 'Continue.' }),
    undefined,
    'workspace-2',
  );
  await new Promise(resolve => setImmediate(resolve));
  expect(runtime.continueCalls[1].options).toMatchObject({
    skillIds: [],
    workspaceRoot: session.cwd,
    sessionMode: 'work',
  });

  coworkStore.addMessage('session-1', {
    type: 'assistant',
    content: 'Second response.',
    metadata: {},
  });
  runtime.emit('complete', 'session-1');
  await expect(secondResponse).resolves.toBe('Second response.');

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

  coworkStore.addMessage('session-2', {
    id: 'assistant-3',
    type: 'assistant',
    content: 'Third response.',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', 'session-2');
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

test('maps newly classified error kinds to dedicated IM replies', async () => {
  const cases = [
    { kind: CoworkErrorKind.ModelCapabilityUnsupported, key: 'imErrorModelCapabilityUnsupported' },
    { kind: CoworkErrorKind.ProviderUnavailable, key: 'imErrorProviderUnavailable' },
    { kind: CoworkErrorKind.StreamInterrupted, key: 'imErrorStreamInterrupted' },
  ] as const;
  for (const { kind, key } of cases) {
    const runtime = new FakeRuntime();
    const handler = new IMCoworkHandler({
      coworkRuntime: runtime,
      coworkStore: new FakeCoworkStore(),
      imStore: new FakeIMStore(),
    });
    try {
      const response = handler.processMessage(
        createMessage({ content: '处理一下' }),
        undefined,
        'workspace-1',
      );
      await new Promise(resolve => setImmediate(resolve));
      runtime.emit('error', 'session-1', { kind, message: 'upstream detail' });
      await expect(response).rejects.toThrow(t(key));
    } finally {
      handler.destroy();
    }
  }
});

test('emits a matching terminal run event when a session fails while waiting for permission', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  const activityUpdates: Array<Record<string, unknown>> = [];
  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
    activityService: {
      recordChannelRun: run => {
        activityUpdates.push(run);
        return null;
      },
    },
  });

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

  expect(activityUpdates).toHaveLength(2);
  expect(activityUpdates.map(event => event.status)).toEqual([
    ActivityStatus.Running,
    ActivityStatus.Failed,
  ]);
  expect(activityUpdates[1].id).toBe(activityUpdates[0].id);

  handler.destroy();
});

test.each([true, false])(
  'approval resumes only while its Channel mapping exists (%s)',
  async mapped => {
    const runtime = new FakeRuntime();
    const coworkStore = new FakeCoworkStore();
    const imStore = new FakeIMStore();
    vi.spyOn(runtime, 'isSessionActive').mockReturnValue(true);
    const respond = vi.spyOn(runtime, 'respondToPermission');
    const handler = new IMCoworkHandler({ coworkRuntime: runtime, coworkStore, imStore });
    try {
      const request = createMessage();
      const first = handler.processMessage(request, undefined, 'workspace-1');
      await vi.waitFor(() => expect(runtime.continueCalls).toHaveLength(1));
      runtime.emit('permissionRequest', 'session-1', {
        requestId: 'permission-1',
        toolName: 'read',
        toolInput: { path: 'fixture.txt' },
      });
      await expect(first).resolves.toMatch(/请在 60 秒内回复/u);

      if (!mapped) imStore.deleteSessionMapping(request.conversationId, request.platform);
      const confirmation = handler.processMessage(createMessage({ content: '允许' }));
      if (mapped) {
        expect(respond).toHaveBeenCalledWith(
          'permission-1',
          expect.objectContaining({ behavior: 'allow' }),
        );
        coworkStore.addMessage('session-1', {
          id: 'answer',
          type: 'assistant',
          content: 'Done',
          timestamp: Date.now(),
        });
        runtime.emit('complete', 'session-1');
        await expect(confirmation).resolves.toBe('Done');
      } else {
        await expect(confirmation).resolves.toMatch(/已过期/u);
        expect(respond).not.toHaveBeenCalled();
      }
    } finally {
      handler.destroy();
    }
  },
);

test('closes a started run when existing-session setup fails before runtime execution', async () => {
  const runtime = new FakeRuntime();
  const coworkStore = new FakeCoworkStore();
  const imStore = new FakeIMStore();
  let failSkillsPrompt = false;
  const activityUpdates: Array<Record<string, unknown>> = [];
  const handler = new IMCoworkHandler({
    coworkRuntime: runtime,
    coworkStore,
    imStore,
    getSkillsPrompt: async () => {
      if (failSkillsPrompt) throw new Error('skill prompt unavailable');
      return null;
    },
    activityService: {
      recordChannelRun: run => {
        activityUpdates.push(run);
        return null;
      },
    },
  });

  const firstResponse = handler.processMessage(
    createMessage({ content: '第一条消息' }),
    undefined,
    'workspace-1',
  );
  await new Promise(resolve => setImmediate(resolve));
  coworkStore.addMessage('session-1', {
    id: 'assistant-1',
    type: 'assistant',
    content: '第一条回复',
    timestamp: Date.now(),
    metadata: {},
  });
  runtime.emit('complete', 'session-1');
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

  const secondRunUpdates = activityUpdates.slice(-2);
  expect(secondRunUpdates.map(event => event.status)).toEqual([
    ActivityStatus.Running,
    ActivityStatus.Failed,
  ]);
  expect(secondRunUpdates[1].id).toBe(secondRunUpdates[0].id);
  expect(secondRunUpdates[1].errorMessage).toBe('skill prompt unavailable');

  handler.destroy();
});
