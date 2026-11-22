/**
 * PiRuntimeAdapter unit tests: session start resource wiring.
 *
 * Covers prompt/resource loading, Chat wiring, codemode/MCP extension routing,
 * model routing, and image-attachment gating. Split from the original
 * piRuntimeAdapter.test.ts; the shared mocks and adapter lifecycle live in
 * piRuntimeAdapter.testHarness.ts (imported first so the Pi SDK mocks are
 * registered before any module under test loads).
 */

import {
  createTestPiRuntime,
  adapter,
  applyTestResolution,
  createTemporaryPiSessionRoot,
  createTemporaryWorkspace,
  mockCreateAgentSession,
  mockCodemodeExtensionFactory,
  mockCreateMcpExtension,
  mockDefaultResourceLoader,
  mockGetModel,
  mockMcpExtensionFactory,
  mockModelRuntime,
  mockSession,
  mockSessionManagerOpen,
  mockSettingsManagerCreate,
  mockSettingsManagerInMemory,
  mockToolSearchExtensionFactory,
  seedPersistedPiSession,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';

import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import path from 'node:path';
import { CanonicalScheduledTaskService } from '../../../scheduledTask/canonicalScheduledTaskService';
import { SchedulerRuntime } from '../../../scheduledTask/schedulerRuntime';
import { ScheduleKind } from '../../../scheduledTask/constants';
import { initializeScheduledTaskSchema } from '../../../scheduledTask/schema';
import { SqliteScheduledTaskStore } from '../../../scheduledTask/sqliteScheduledTaskStore';
import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { PiWebSearchToolName } from './constants';
import { getZhiyuanProductPreamble } from './piPromptOverrides';
import { TEST_MAGPIE_GATEWAY } from '../../../../tests/helpers/createTestMagpie';
import { ModelCapabilityStatus } from '../../../shared/providers';
import { resolveBundledOcrHelper } from '../ocrHelper';
import { PiDocumentReaderToolName } from './piDocumentReaderTool';
import { PiSubagentToolName } from './piSubagentTool';
import { CONVERSATION_HISTORY_TOOL_NAME } from '../../conversationHistory/constants';
import { applyPiPlatformToolOverrides } from './piRuntimeSettingsOverrides';
import type { CoworkStore } from '../../coworkStore';
import type { McpServerRecord } from '../../mcpStore';
import type { PiLoadedMcpConfig } from './piMcpExtensionBridge';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { piCompanionChatSessionId } from './piRuntimeTypes';
import { readCoworkImageAsync } from '../../workbenchTask/artifactWorkerPool';
import { MagpieModelService } from '../../magpie/modelService';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  it('rejects an unpublished Companion model before registering its fallback with Pi', async () => {
    const modelService = new MagpieModelService(
      {
        status: () => ({ state: 'running', version: 'test', gatewayUrl: TEST_MAGPIE_GATEWAY }),
        models: async () => [{ id: 'vendor/fallback' }],
        providers: async () => [
          {
            id: 'vendor',
            name: 'Vendor',
            api: 'openai-completions',
            baseUrl: TEST_MAGPIE_GATEWAY,
            off: false,
            hasKey: true,
            models: ['vendor/removed'],
            fallback: ['vendor/fallback'],
          },
        ],
      },
      { readDefaultModelId: () => 'vendor/removed', writeDefaultModelId: vi.fn() },
    );
    const runtime = createTestPiRuntime({ modelService });
    await expect(
      runtime.continueSession(piCompanionChatSessionId('pet'), 'Private input', {
        companionChat: true,
        modelOverride: 'vendor/removed',
      }),
    ).rejects.toThrow();
    expect(mockModelRuntime.registerNativeProvider).not.toHaveBeenCalled();
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it('can save a scheduled task on the first Work turn without arming saved schedules', async () => {
    const db = new Database(':memory:');
    initializeScheduledTaskSchema(db);
    const store = new SqliteScheduledTaskStore(db);
    const clock = { upsert: vi.fn(), remove: vi.fn(), stop: vi.fn() };
    const scheduledTaskService = new CanonicalScheduledTaskService(
      store,
      new SchedulerRuntime(store, clock, async () => ({})),
    );
    const runtime = createTestPiRuntime({ scheduledTaskService });

    try {
      await runtime.startSession('first-work', 'Schedule a report', {
        workspaceRoot: createTemporaryWorkspace(),
        sessionMode: CoworkSessionMode.Work,
      });
      const options = mockCreateAgentSession.mock.calls.at(-1)?.[0] as {
        customTools: Array<{
          name: string;
          execute: (id: string, params: object) => Promise<unknown>;
        }>;
      };
      const tool = options.customTools.find(tool => tool.name === 'scheduled_task');
      expect(clock.upsert).not.toHaveBeenCalled();
      await expect(
        tool?.execute('schedule-1', {
          name: 'Daily report',
          message: 'Report progress',
          schedule: { kind: ScheduleKind.Cron, expr: '0 9 * * *' },
        }),
      ).resolves.toMatchObject({ details: { taskId: expect.any(String) } });
      expect(store.list()).toMatchObject([{ name: 'Daily report', sessionKey: 'first-work' }]);
      expect(clock.upsert).toHaveBeenCalledOnce();
    } finally {
      runtime.stopAllSessions();
      db.close();
    }
  });

  it('settles a tool-free private Companion session and reopens its native history', async () => {
    const root = createTemporaryPiSessionRoot();
    const sessionId = piCompanionChatSessionId('pet');
    const sessionFile = seedPersistedPiSession(path.join(root, 'companion-chat'), sessionId);
    const onSettled = vi.fn();
    const options = { companionChat: true, systemPrompt: 'You are Xiaoyuan.', onSettled } as const;
    const store = {
      getSession: vi.fn(),
      messages: { addMessage: vi.fn() },
      updateSession: vi.fn(),
    };
    const memory = { registerSession: vi.fn() };
    const workbench = { beginRun: vi.fn(), cancelRun: vi.fn() };
    const publicEvent = vi.fn();
    const runtime = createTestPiRuntime({
      piSessionStoreRoot: root,
      coworkStore: store as unknown as CoworkStore,
      projectMemoryService: memory as never,
      workbenchTaskService: workbench as unknown as WorkbenchTaskService,
    });
    runtime.on('executionEvent', publicEvent);
    runtime.on('messageUpdate', publicEvent);
    runtime.on('complete', publicEvent);

    await expect(runtime.startSession(sessionId, 'Public input')).rejects.toThrow(
      'Invalid Companion chat session.',
    );
    await expect(runtime.continueSession(sessionId, 'Public input')).rejects.toThrow();
    await expect(
      runtime.continueSession('ordinary-session', 'Private input', options),
    ).rejects.toThrow('Invalid Companion chat session.');
    await runtime.continueSession(sessionId, 'Hello', {
      ...options,
      sessionMode: CoworkSessionMode.Work,
      skillIds: ['not-for-companion'],
    });
    const listener = mockSession.subscribe.mock.calls.at(-1)![0];
    listener({ type: 'agent_start' });
    listener({ type: 'turn_start' });
    listener({
      type: 'message_end',
      message: {
        role: 'assistant',
        stopReason: 'stop',
        content: [{ type: 'text', text: 'Hello from Xiaoyuan.' }],
      },
    });
    listener({ type: 'agent_end' });
    listener({ type: 'agent_settled' });
    await vi.waitFor(() =>
      expect(onSettled).toHaveBeenCalledExactlyOnceWith({
        ok: true,
        output: 'Hello from Xiaoyuan.',
      }),
    );
    expect(mockSessionManagerOpen).toHaveBeenCalledWith(
      sessionFile,
      path.dirname(sessionFile),
      expect.any(String),
    );
    expect(mockCreateAgentSession.mock.calls.at(-1)?.[0]).toMatchObject({ noTools: 'all' });
    expect(mockCreateAgentSession.mock.calls.at(-1)?.[0]).not.toHaveProperty('customTools');
    expect(mockDefaultResourceLoader.mock.calls.at(-1)?.[0]).toMatchObject({
      noExtensions: true,
      noSkills: true,
      noContextFiles: true,
      noPromptTemplates: true,
      appendSystemPrompt: [],
    });
    expect(mockDefaultResourceLoader.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      'extensionFactories',
    );
    expect(store.getSession).not.toHaveBeenCalled();
    expect(store.messages.addMessage).not.toHaveBeenCalled();
    expect(store.updateSession).not.toHaveBeenCalled();
    expect(memory.registerSession).not.toHaveBeenCalled();
    expect(workbench.beginRun).not.toHaveBeenCalled();
    expect(publicEvent).not.toHaveBeenCalled();

    runtime.stopSession(sessionId);
    expect(mockSession.abort).not.toHaveBeenCalled();
    runtime.stopSession(sessionId, { companionChat: true });
    expect(mockSession.abort).toHaveBeenCalledOnce();
    expect(workbench.cancelRun).not.toHaveBeenCalled();
  });

  it('does not send Companion input with its image removed', async () => {
    applyTestResolution({
      providerMetadata: { capabilities: { imageInput: ModelCapabilityStatus.Unsupported } },
    });
    const sessionId = piCompanionChatSessionId('pet');
    await expect(
      adapter.continueSession(sessionId, 'Look at this', {
        companionChat: true,
        imageAttachments: [{ name: 'sample.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
      }),
    ).rejects.toThrow();
    expect(mockSession.prompt).not.toHaveBeenCalled();
    expect(mockSession.sendUserMessage).not.toHaveBeenCalled();
  });

  describe('startSession', () => {
    it('should inject the session system prompt through Pi resource loading', async () => {
      await adapter.startSession('test', 'Hello Pi', {
        systemPrompt: 'You are the selected expert.',
      });

      expect(mockDefaultResourceLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          agentDir: '/tmp/pi-agent',
          cwd: process.cwd(),
          noExtensions: true,
          noPromptTemplates: true,
          noSkills: true,
          noThemes: true,
          appendSystemPromptOverride: expect.any(Function),
          systemPromptOverride: expect.any(Function),
        }),
      );
      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        systemPromptOverride: (base: string | undefined) => string | undefined;
      };
      expect(loaderOptions.systemPromptOverride('Pi default prompt')).toBe(
        getZhiyuanProductPreamble(),
      );
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceLoader: expect.any(Object),
        }),
      );
      expect(mockCreateAgentSession.mock.calls[0]?.[0]).not.toHaveProperty('systemPrompt');
    });

    it('keeps Chat on Pi while skipping Work prompt, default Skill, and MCP resources', async () => {
      const listEnabled = vi.fn(() => []);
      const beginRun = vi.fn();
      const runtime = createTestPiRuntime({
        mcpServerSource: { listEnabled },
        projectMemoryService: {} as never,
        conversationHistoryService: { search: vi.fn(() => []) } as never,
        workbenchTaskService: {
          on: vi.fn(),
          off: vi.fn(),
          beginRun,
        } as unknown as WorkbenchTaskService,
      });

      await runtime.startSession('chat-resources', 'Hello', {
        sessionMode: 'chat',
        systemPrompt: 'Only the explicitly selected chat prompt.',
      });

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        additionalSkillPaths?: string[];
        extensionFactories?: unknown[];
        systemPromptOverride: (base: string | undefined) => string | undefined;
        appendSystemPromptOverride: () => string[];
      };
      expect(loaderOptions.additionalSkillPaths).toEqual([]);
      expect(loaderOptions.extensionFactories ?? []).not.toContain(mockMcpExtensionFactory);
      expect(loaderOptions.extensionFactories ?? []).not.toContain(mockCodemodeExtensionFactory);
      expect(listEnabled).not.toHaveBeenCalled();
      expect(mockSession.bindExtensions).not.toHaveBeenCalled();
      expect(loaderOptions.systemPromptOverride('Discovered custom prompt')).toBe(
        getZhiyuanProductPreamble(),
      );
      expect(loaderOptions.appendSystemPromptOverride()).toContain(
        'Only the explicitly selected chat prompt.',
      );
      expect(loaderOptions.appendSystemPromptOverride().join('\n')).toContain('知远智能体');
      expect(loaderOptions.appendSystemPromptOverride().join('\n')).not.toContain('Supabase');

      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{ name?: string }>;
      };
      const customToolNames = sessionOptions.customTools?.map(tool => tool.name) ?? [];
      expect(customToolNames).toContain(PiWebSearchToolName);
      expect(customToolNames).not.toContain(CONVERSATION_HISTORY_TOOL_NAME);
      expect(customToolNames).not.toContain(PiDocumentReaderToolName);
      expect(customToolNames).not.toContain(PiSubagentToolName);
      expect(beginRun).not.toHaveBeenCalled();
    });

    it('reuses one Pi AgentSession across Chat continuations', async () => {
      await adapter.startSession('chat-continuation', 'First', {
        sessionMode: 'chat',
      });
      await adapter.continueSession('chat-continuation', 'Second', {
        sessionMode: 'chat',
      });

      expect(mockCreateAgentSession).toHaveBeenCalledOnce();
      expect(mockSession.reload).not.toHaveBeenCalled();
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);
    });

    it('passes the Chat context window to Pi without replacing native compaction policy', async () => {
      mockGetModel.mockImplementationOnce(() => undefined);
      await adapter.startSession('chat-context-limit', 'First', {
        sessionMode: 'chat',
        modelOverride: 'openai/gpt-5.2',
      });

      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        model?: { contextWindow?: number };
      };
      expect(sessionOptions.model?.contextWindow).toBe(272_000);

      const settingsManager = mockSettingsManagerInMemory.mock.results[0]?.value;
      expect(settingsManager.applyOverrides).not.toHaveBeenCalledWith(
        expect.objectContaining({ compaction: expect.anything() }),
      );
    });

    it('shares one isolated Pi SettingsManager with resource loading and the agent session', async () => {
      await adapter.startSession('settings-manager', 'Hello Pi');

      expect(mockSettingsManagerInMemory).toHaveBeenCalledOnce();
      expect(mockSettingsManagerCreate).not.toHaveBeenCalled();
      const settingsManager = mockSettingsManagerInMemory.mock.results[0]?.value;
      expect(mockDefaultResourceLoader.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ settingsManager }),
      );
      expect(mockCreateAgentSession.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ settingsManager }),
      );
      expect(settingsManager.applyOverrides).not.toHaveBeenCalledWith(
        expect.objectContaining({ compaction: expect.anything() }),
      );
    });

    it('registers codemode and tool_search dormantly on work sessions unless codemode is activated', async () => {
      await adapter.startSession('codemode-off', 'Hello Pi');

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: unknown[];
      };
      const factories = loaderOptions?.extensionFactories ?? [];
      expect(factories).toContain(mockCodemodeExtensionFactory);
      expect(factories).toContain(mockToolSearchExtensionFactory);
      const settingsManager = mockSettingsManagerInMemory.mock.results[0]?.value;
      expect(settingsManager.applyOverrides).not.toHaveBeenCalledWith(
        expect.objectContaining({ defaultTools: expect.arrayContaining(['+codemode']) }),
      );
    });

    it('activates codemode when requested on work sessions', async () => {
      await adapter.startSession('codemode-on', 'Hello Pi', { codemode: true });

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: unknown[];
      };
      const factories = loaderOptions?.extensionFactories ?? [];
      expect(factories).toContain(mockCodemodeExtensionFactory);
      expect(factories).toContain(mockToolSearchExtensionFactory);
      const settingsManager = mockSettingsManagerInMemory.mock.results[0]?.value;
      expect(settingsManager.applyOverrides).toHaveBeenCalledWith({
        defaultTools: ['+codemode'],
      });
    });

    it('switches default shell tool to native powershell on win32 only', () => {
      const applyOverrides = vi.fn();
      applyPiPlatformToolOverrides({ applyOverrides } as never, 'darwin');
      expect(applyOverrides).not.toHaveBeenCalled();

      applyPiPlatformToolOverrides({ applyOverrides } as never, 'win32');
      expect(applyOverrides).toHaveBeenCalledWith({
        defaultTools: ['read', 'powershell', 'edit', 'write'],
      });
    });

    it('uses additive tool modifiers so platform defaultTools are preserved and excludes bash on win32', async () => {
      const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
      try {
        await adapter.startSession('additive-tools-win', 'Hello Pi');
      } finally {
        if (originalPlatform) {
          Object.defineProperty(process, 'platform', originalPlatform);
        }
      }

      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        tools?: string[];
        excludeTools?: string[];
      };
      expect(sessionOptions.tools).toEqual(expect.arrayContaining(['+grep', '+find', '+ls']));
      expect(sessionOptions.tools?.every(entry => entry.startsWith('+'))).toBe(true);
      expect(sessionOptions.excludeTools).toEqual(['bash']);
    });

    it('loads current MCP configuration through Pi and keeps the expert server scope', async () => {
      const records: McpServerRecord[] = [];
      const getSessionExperts = vi.fn(() => [
        {
          expertId: 'expert',
          expertName: 'Fixture expert',
          packageId: 'fixture-package',
          capabilityPolicy: { mcpIds: ['by-id', 'by-name'] },
        },
      ]);
      const addMessage = vi.fn();
      const runtime = createTestPiRuntime({
        mcpServerSource: { listEnabled: () => records },
        coworkStore: {
          getSessionExperts,
          getAgent: vi.fn(),
          messages: { addMessage },
          updateSession: vi.fn(),
        } as unknown as CoworkStore,
      });
      await runtime.startSession('mcp-native', 'Hello Pi', { expertIds: ['expert'] });
      expect(getSessionExperts).toHaveBeenCalledExactlyOnceWith('mcp-native');
      expect(addMessage).toHaveBeenCalledWith(
        'mcp-native',
        expect.objectContaining({
          type: 'user',
          metadata: {
            experts: [
              { expertId: 'expert', expertName: 'Fixture expert', presetId: 'fixture-package' },
            ],
          },
        }),
      );

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: unknown[];
      };
      expect(loaderOptions?.extensionFactories).toContain(mockMcpExtensionFactory);
      expect(mockCreateMcpExtension).toHaveBeenCalledWith(
        expect.objectContaining({
          loadConfig: expect.any(Function),
          createTransport: expect.any(Function),
        }),
      );
      expect(mockSession.bindExtensions).toHaveBeenCalled();

      const [{ loadConfig }] = mockCreateMcpExtension.mock.lastCall as unknown as [
        { loadConfig: () => PiLoadedMcpConfig },
      ];
      expect(loadConfig().servers).toEqual([]);
      const record = (id: string, name: string): McpServerRecord => ({
        id,
        name,
        enabled: true,
        description: '',
        transportType: 'http',
        url: 'http://127.0.0.1/mcp',
        timeout: 60,
        isBuiltIn: false,
        createdAt: 1,
        updatedAt: 1,
      });
      records.push(
        record('by-id', 'first'),
        record('second', 'by-name'),
        record('third', 'hidden'),
      );
      expect(loadConfig().servers.map(server => server.name)).toEqual(['first', 'by-name']);
    });

    it('excludes codemode from chat sessions even when requested', async () => {
      await adapter.startSession('codemode-chat', 'Hello', {
        codemode: true,
        sessionMode: 'chat',
      });

      const loaderOptions = mockDefaultResourceLoader.mock.calls.at(-1)?.[0] as {
        extensionFactories?: unknown[];
      };
      expect(loaderOptions?.extensionFactories ?? []).not.toContain('codemode-extension-factory');
    });

    it('routes the selected gateway model through the owned endpoint', async () => {
      await adapter.startSession('test', 'Hello Pi', { modelOverride: 'llamacpp/qwen-local' });

      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            provider: 'magpie',
            id: 'llamacpp/qwen-local',
            baseUrl: `${TEST_MAGPIE_GATEWAY}/v1`,
          }),
        }),
      );
      expect(mockModelRuntime.registerNativeProvider).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'magpie',
          baseUrl: `${TEST_MAGPIE_GATEWAY}/v1`,
          models: [expect.objectContaining({ id: 'llamacpp/qwen-local' })],
        }),
      );
      expect(mockModelRuntime.setRuntimeApiKey).not.toHaveBeenCalled();
    });

    it('should make session active after start', async () => {
      expect(adapter.isSessionActive('test')).toBe(false);
      await adapter.startSession('test', 'Hello');
      expect(adapter.isSessionActive('test')).toBe(true);
    });

    it('uses the cloud fallback when provider metadata has no capacity limits', async () => {
      applyTestResolution({
        config: {
          apiKey: 'sk-cloud',
          baseURL: 'https://example.com/v1',
          model: 'unknown-cloud-model',
          apiType: 'openai',
        },
        providerMetadata: {
          providerName: 'custom_0',
          codingPlanEnabled: false,
          supportsImage: false,
        },
      });

      await adapter.startSession('cloud-fallback', 'Hello Pi');

      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            contextWindow: 32768,
            maxTokens: 4096,
          }),
        }),
      );
    });

    it('should throw on empty prompt with no images', async () => {
      await expect(adapter.startSession('test', '')).rejects.toThrow('Prompt is required.');
    });

    it('forwards image attachments to vision-capable models', async () => {
      applyTestResolution({
        config: {
          apiKey: 'sk-vision',
          baseURL: 'https://api.moonshot.cn/v1',
          model: 'kimi-k2.6',
          apiType: 'openai',
        },
        providerMetadata: {
          providerName: 'moonshot',
          codingPlanEnabled: false,
          supportsImage: true,
          capabilities: { imageInput: ModelCapabilityStatus.Supported },
        },
      });

      await adapter.startSession('vision', 'Describe this image', {
        imageAttachments: [{ name: 'example.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
      });

      expect(mockSession.sendUserMessage).toHaveBeenCalledWith(
        [
          { type: 'text', text: 'Describe this image' },
          { type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' },
        ],
        undefined,
      );
    });

    it.each(['start', 'continue'])(
      'does not send a saved image if the %s turn is stopped during its read',
      async action => {
        applyTestResolution({
          config: {
            apiKey: 'sk-vision',
            baseURL: 'https://api.moonshot.cn/v1',
            model: 'kimi-k2.6',
            apiType: 'openai',
          },
          providerMetadata: {
            providerName: 'moonshot',
            codingPlanEnabled: false,
            supportsImage: true,
            capabilities: { imageInput: ModelCapabilityStatus.Supported },
          },
        });
        const id = 'stopped-image';
        if (action === 'continue') await adapter.startSession(id, 'Choose a picture');

        const reading = Promise.withResolvers<AbortSignal>();
        const bytes = Promise.withResolvers<string>();
        vi.mocked(readCoworkImageAsync).mockImplementationOnce((_file, signal) => {
          reading.resolve(signal!);
          return bytes.promise;
        });
        const options = {
          imageAttachments: [
            { name: 'saved.png', mimeType: 'image/png', path: path.resolve('saved.png') },
          ],
        };
        const submission =
          action === 'start'
            ? adapter.startSession(id, 'Describe this image', options)
            : adapter.continueSession(id, 'Describe this image', options);
        const signal = await reading.promise;
        adapter.stopSession(id);
        bytes.resolve('aW1hZ2U=');

        await submission;
        expect(signal.aborted).toBe(true);
        expect(mockSession.sendUserMessage).not.toHaveBeenCalled();
      },
    );

    it('keeps an image attachment as a text hint for non-vision models', async () => {
      const savedPath = 'C:\\cowork-images\\s\\example.png';
      using persist = vi
        .spyOn(adapter, 'persistImageAttachments')
        .mockResolvedValueOnce([{ name: 'example.png', mimeType: 'image/png', path: savedPath }]);
      await adapter.startSession('text-only', 'Describe this image', {
        imageAttachments: [{ name: 'example.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
      });

      const [sentPrompt] = mockSession.prompt.mock.calls[0] as [string];
      // Pi's in-band note for a non-vision model, mirrored for composer images:
      // the bytes are withheld and the model is told why. An unconfigured model
      // is reported as unconfirmed, not as a confirmed text-only model.
      expect(sentPrompt).toContain('Describe this image');
      expect(sentPrompt).toContain('not sent');
      expect(sentPrompt).toContain(savedPath);
      expect(sentPrompt).toMatch(/not confirmed/i);
      expect(persist).toHaveBeenCalledOnce();
      expect(mockSession.sendUserMessage).not.toHaveBeenCalled();
    });

    it('hands the persisted image path to a non-vision model', async () => {
      await adapter.startSession('text-only-path', 'Describe this image', {
        imageAttachments: [
          { name: 'example.png', mimeType: 'image/png', path: 'C:\\cowork-images\\s\\hash.png' },
        ],
      });

      const [sentPrompt] = mockSession.prompt.mock.calls.at(-1) as [string];
      // The path is what lets the model act instead of guessing.
      expect(sentPrompt).toContain('C:\\cowork-images\\s\\hash.png');
      expect(mockSession.sendUserMessage).not.toHaveBeenCalled();
    });

    it('points a text-only model at the bundled OCR helper when an image arrives as a path', async () => {
      await adapter.startSession('text-only-file', 'Describe this image', {
        fileAttachments: [
          {
            name: 'shot.png',
            path: 'C:\\cowork-images\\s\\shot.png',
            extension: 'PNG',
            isImage: true,
          },
          { name: 'notes.txt', path: 'C:\\docs\\notes.txt', extension: 'TXT' },
        ],
      });

      const [sentPrompt] = mockSession.prompt.mock.calls.at(-1) as [string];
      expect(sentPrompt).toContain('Describe this image');
      expect(sentPrompt).toContain('C:\\cowork-images\\s\\shot.png');
      expect(sentPrompt).toMatch(/not confirmed/i);
      // A text attachment must not be advertised as an image.
      expect(sentPrompt).not.toContain('notes.txt');
      if (resolveBundledOcrHelper()) {
        expect(sentPrompt).toContain('ocr-image.ps1');
      }
    });

    it('leaves a path-only image alone for a vision-capable model', async () => {
      applyTestResolution({
        config: {
          apiKey: 'sk-vision',
          baseURL: 'https://api.moonshot.cn/v1',
          model: 'kimi-k2.6',
          apiType: 'openai',
        },
        providerMetadata: {
          providerName: 'moonshot',
          codingPlanEnabled: false,
          supportsImage: true,
          capabilities: { imageInput: ModelCapabilityStatus.Supported },
        },
      });

      await adapter.startSession('vision-file', 'Describe this image', {
        fileAttachments: [
          {
            name: 'shot.png',
            path: 'C:\\cowork-images\\s\\shot.png',
            extension: 'PNG',
            isImage: true,
          },
        ],
      });

      const [sentPrompt] = mockSession.prompt.mock.calls.at(-1) as [string];
      // A vision-capable model can open the file itself: no capability claim,
      // no OCR script, no withheld-image notice.
      expect(sentPrompt).toBe('Describe this image');
    });

    it('tells the user when images were withheld from a text-only turn', async () => {
      const notices: unknown[] = [];
      adapter.on('message', (_sessionId, message) => {
        const isSystemMessage =
          typeof message === 'object' &&
          message !== null &&
          Reflect.get(message, 'type') === 'system';
        if (isSystemMessage) notices.push(message);
      });

      await adapter.startSession('text-only-notice', 'Describe this image', {
        imageAttachments: [
          { name: 'example.png', mimeType: 'image/png', path: 'C:\\cowork-images\\s\\hash.png' },
        ],
      });

      expect(notices).toHaveLength(1);
    });

    it('should replace existing session with same id', async () => {
      await adapter.startSession('test', 'First');
      const staleListener = mockSession.subscribe.mock.calls[0]?.[0] as (event: {
        type: string;
      }) => void;
      await adapter.startSession('test', 'Second');
      // Old session aborted, new one created
      expect(mockSession.abort).toHaveBeenCalled();
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);

      staleListener({ type: 'agent_end' });

      expect(adapter.isSessionRunning('test')).toBe(true);
      expect(mockSession.abort).toHaveBeenCalledTimes(1);
      expect(mockSession.dispose).toHaveBeenCalledTimes(1);
    });

    it('does not clamp Chat maxTokens below the resolved model limit and calls dispose on stopSession', async () => {
      applyTestResolution({
        config: {
          apiKey: 'sk-test',
          baseURL: 'https://api.openai.com/v1',
          model: 'gpt-5.4',
          apiType: 'openai',
        },
        providerMetadata: {
          providerName: 'openai',
          codingPlanEnabled: false,
          supportsImage: true,
          contextWindow: 128_000,
          maxTokens: 32_768,
        },
      });

      await adapter.startSession('chat-unclamped', 'Hello Pi', { sessionMode: 'chat' });

      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            maxTokens: 32_768,
          }),
        }),
      );

      adapter.stopSession('chat-unclamped');
      await adapter.waitForNativeSessionStop('chat-unclamped');
      expect(mockSession.dispose).toHaveBeenCalledOnce();
    });

    it('injects project memory through before_agent_start custom messages instead of mutating systemPrompt sections', async () => {
      const runtime = createTestPiRuntime({
        projectMemoryService: {
          buildProjectContext: vi
            .fn()
            .mockResolvedValue('<project_memory>\nRemember convention X\n</project_memory>'),
          registerSession: vi.fn().mockResolvedValue(undefined),
        } as never,
      });

      await runtime.startSession('memory-section', 'Inspect repository', {
        sessionMode: 'work',
        workspaceRoot: createTemporaryWorkspace(),
      });

      expect(mockSession.prompt).toHaveBeenCalledWith('Inspect repository');
      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: Array<
          (api: { on: (event: string, handler: (event: unknown) => unknown) => void }) => void
        >;
      };
      const beforeHandlers: Array<(event: unknown) => unknown> = [];
      for (const factory of loaderOptions.extensionFactories ?? []) {
        factory({
          on: (event, handler) => {
            if (event === 'before_agent_start') beforeHandlers.push(handler);
          },
        });
      }
      const sections: Record<string, string> = {};
      const injectedMessages: unknown[] = [];
      for (const handler of beforeHandlers) {
        const result = (await handler({
          prompt: 'Inspect repository',
          systemPromptOptions: { sections },
        })) as { message?: unknown } | undefined;
        if (result?.message) injectedMessages.push(result.message);
      }
      expect(sections.project_memory).toBeUndefined();
      expect(injectedMessages).toEqual([
        {
          customType: 'project_memory',
          display: false,
          content: expect.stringContaining('Remember convention X'),
        },
      ]);
    });

    it('defaults goal-mode Work sessions to high thinkingLevel unless overridden or in Chat mode', async () => {
      await adapter.startSession('goal-thinking', 'Solve complex task', {
        sessionMode: 'work',
        goalMode: true,
      });
      expect(mockCreateAgentSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ thinkingLevel: 'high' }),
      );

      await adapter.startSession('explicit-thinking', 'Solve complex task', {
        sessionMode: 'work',
        goalMode: true,
        thinkingLevel: 'low',
      });
      expect(mockCreateAgentSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ thinkingLevel: 'low' }),
      );

      await adapter.startSession('chat-goal', 'Chat message', {
        sessionMode: 'chat',
        goalMode: true,
      });
      const lastOptions = mockCreateAgentSession.mock.calls.at(-1)?.[0] as {
        thinkingLevel?: string;
      };
      expect(lastOptions.thinkingLevel).toBeUndefined();
    });

    it('keeps run_skill_script and skill_runtime_capabilities dormant when skillIds is empty and activates them when a skill is attached', async () => {
      await adapter.startSession('no-skills', 'Hello Pi', {
        sessionMode: 'work',
        skillIds: [],
      });

      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        tools?: string[];
        customTools?: Array<{ name: string; defaultActive?: boolean }>;
      };
      expect(sessionOptions.tools).not.toContain('+run_skill_script');
      expect(sessionOptions.tools).not.toContain('+skill_runtime_capabilities');
      const skillScriptTool = sessionOptions.customTools?.find(t => t.name === 'run_skill_script');
      const skillCapTool = sessionOptions.customTools?.find(
        t => t.name === 'skill_runtime_capabilities',
      );
      expect(skillScriptTool?.defaultActive).toBe(false);
      expect(skillCapTool?.defaultActive).toBe(false);

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: Array<
          (api: { on: (event: string, handler: (event: unknown) => unknown) => void }) => void
        >;
      };
      const beforeHandlers: Array<(event: unknown) => unknown> = [];
      for (const factory of loaderOptions.extensionFactories ?? []) {
        factory({
          on: (event, handler) => {
            if (event === 'before_agent_start') beforeHandlers.push(handler);
          },
        });
      }

      const active = adapter.activeSessions.get('no-skills')!;
      active.resourceState.skillIds = ['docx'];
      const selectedTools = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];
      for (const handler of beforeHandlers) {
        await handler({
          prompt: 'Now use docx skill',
          systemPromptOptions: { sections: {}, selectedTools },
        });
      }
      expect(selectedTools).toContain('run_skill_script');
      expect(selectedTools).toContain('skill_runtime_capabilities');
    });
  });
});
