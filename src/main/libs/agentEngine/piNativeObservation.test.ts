import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import {
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
} from '@earendil-works/pi-coding-agent';
import { PiEventProjection } from './piEventProjection';
import { PiRuntimeQueueController } from './piRuntimeQueueController';
import { ImageInputVerdict } from './piImageInputFallback';
import type { ActivePiSession } from './piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import { PiAgentEventType } from './piStreamConstants';
import { crc32, deflateSync } from 'node:zlib';

async function createNativeFixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), 'pi-ownership-audit-'));
  const runtime = await ModelRuntime.create({
    authPath: path.join(cwd, 'auth.json'),
    modelsPath: null,
    allowModelNetwork: false,
  });
  const model = {
    id: 'audit',
    name: 'Audit',
    provider: 'ownership-audit',
    api: 'openai-completions' as const,
    baseUrl: 'http://unused.invalid/v1',
    reasoning: false,
    input: ['text' as const, 'image' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 65536,
    maxTokens: 1024,
  };
  runtime.registerProvider(model.provider, {
    api: model.api,
    baseUrl: model.baseUrl,
    models: [model],
  });
  await runtime.setRuntimeApiKey(model.provider, 'offline-test');
  const settings = SettingsManager.inMemory();
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager: settings,
    noContextFiles: true,
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
  });
  await loader.reload();
  const manager = SessionManager.inMemory(cwd);
  const { session } = await createAgentSession({
    cwd,
    model,
    modelRuntime: runtime,
    resourceLoader: loader,
    settingsManager: settings,
    sessionManager: manager,
    tools: [],
  });
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  let requests = 0;
  const firstRequest = new Promise<void>(resolve => {
    started = resolve;
  });
  session.agent.streamFunction = () => {
    const stream = createAssistantMessageEventStream();
    const message: AssistantMessage = {
      role: 'assistant',
      api: model.api,
      provider: model.provider,
      model: model.id,
      timestamp: Date.now(),
      content: [{ type: 'text', text: 'Done' }],
      stopReason: 'stop',
      usage: {
        input: 10,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 11,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    };
    const deliver = () => {
      stream.push({ type: 'done', reason: 'stop', message });
      stream.end();
    };
    if (requests++ === 0) release = deliver;
    else deliver();
    started?.();
    return stream;
  };
  return { cwd, session, manager, firstRequest, release: () => release?.() };
}

test('native control completes and persists an answer without the failing projection', async () => {
  const fixture = await createNativeFixture();
  try {
    const running = fixture.session.prompt('Hello');
    await fixture.firstRequest;
    fixture.release();
    await running;
    expect(
      fixture.manager
        .getBranch()
        .some(entry => entry.type === 'message' && entry.message.role === 'assistant'),
    ).toBe(true);
  } finally {
    fixture.session.dispose();
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});

test('real SDK persists the final answer when display projection fails', async () => {
  const fixture = await createNativeFixture();
  const onError = vi.fn();
  const projection = new PiEventProjection<{ type: string; message?: { role: string } }>(
    [
      event => {
        if (event.type === 'message_end' && event.message?.role === 'assistant')
          throw new Error('SQLite display projection unavailable');
      },
    ],
    new AbortController().signal,
    onError,
  );
  fixture.session.subscribe(event => projection.push(event));
  const running = fixture.session.prompt('Hello');
  try {
    await fixture.firstRequest;
    fixture.release();
    const error = await running.then(
      () => null,
      error => error,
    );
    const persisted = fixture.manager
      .getBranch()
      .some(entry => entry.type === 'message' && entry.message.role === 'assistant');
    expect(error).toBeNull();
    expect(persisted).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
  } finally {
    await running.catch(() => {});
    fixture.session.dispose();
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});

function pngData(): string {
  const chunk = (name: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc(14))),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

test('real native queues preserve consecutive steering inputs, follow-ups and image bytes', async () => {
  const fixture = await createNativeFixture();
  const { session } = fixture;
  const active = {
    sessionId: 'native-queue',
    piSession: session,
    isRunning: true,
    aborted: false,
    abortController: new AbortController(),
    resourceState: { chatMode: false, skillIds: [], skillRoots: {}, expertSkillDirs: [] },
  } as unknown as ActivePiSession;
  const recorded: string[] = [];
  const host = {
    activeSessions: new Map([['native-queue', active]]),
    isSessionRunning: () => true,
    persistImageAttachments: (_id: string, images: unknown) => images,
    recovery: {
      imageInputVerdictForActive: () => ImageInputVerdict.Supported,
      reportOmittedImages: vi.fn(),
    },
    getOcrCommandFor: () => undefined,
    getStore: () => null,
    emit: (event: string, _id: string, message: { content?: string }) => {
      if (event === 'message') recorded.push(message.content ?? '');
    },
  } as unknown as PiRuntimeAdapterHost;
  const queue = new PiRuntimeQueueController(host);
  const clear = vi.spyOn(session, 'clearQueue');
  session.subscribe(event => {
    if (event.type === PiAgentEventType.MessageStart && event.message.role === 'user') {
      queue.onNativeUserMessageStart('native-queue', active);
    }
  });
  const running = session.prompt('Start');
  try {
    await fixture.firstRequest;
    queue.enqueuePendingMessage('native-queue', 'Image follow-up', [
      { name: 'image.png', mimeType: 'image/png', base64Data: pngData() },
    ]);
    queue.enqueuePendingMessage('native-queue', 'Final follow-up');
    expect((await queue.steerInput('native-queue', 'First steer')).success).toBe(true);
    expect((await queue.steerInput('native-queue', 'Second steer')).success).toBe(true);
    expect(session.getSteeringMessages()).toEqual(['First steer', 'Second steer']);
    expect(session.getFollowUpMessages()).toEqual(['Image follow-up', 'Final follow-up']);
    fixture.release();
    await running;
    expect(recorded).toEqual(['First steer', 'Second steer', 'Image follow-up', 'Final follow-up']);
    const users = fixture.manager
      .getBranch()
      .filter(entry => entry.type === 'message' && entry.message.role === 'user');
    expect(users).toHaveLength(5);
    expect(JSON.stringify(users)).toContain('"type":"image"');
    expect(queue.list('native-queue')).toEqual([]);
    expect(clear).not.toHaveBeenCalled();
  } finally {
    fixture.release();
    await running.catch(() => {});
    session.dispose();
    await rm(fixture.cwd, { recursive: true, force: true });
  }
});
