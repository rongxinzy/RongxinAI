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
  adapter,
  applyTestResolution,
  mockCreateAgentSession,
  mockCreateMcpExtension,
  mockDefaultResourceLoader,
  mockGetModel,
  mockModelRuntime,
  mockSession,
  mockSettingsManagerCreate,
  mockSettingsManagerInMemory,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';

import path from 'path';

import { describe, expect, it, vi } from 'vitest';
import { PiWebSearchToolName } from './constants';
import { TEST_MAGPIE_GATEWAY } from '../../../../tests/helpers/installTestMagpie';
import { ModelCapabilityStatus } from '../../../shared/providers';
import { PiMcpTool } from './piMcpCapabilityPrompt';
import { resolveBundledOcrHelper } from '../ocrHelper';
import { PiDocumentReaderSystemPrompt, PiDocumentReaderToolName } from './piDocumentReaderTool';
import { DeclareArtifactSystemPrompt } from '../../declareArtifact/tool';
import { PiSubagentToolName } from './piSubagentTool';
import { CONVERSATION_HISTORY_TOOL_NAME } from '../../conversationHistory/constants';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

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
        'Pi default prompt\n\nYou are the selected expert.',
      );
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceLoader: expect.any(Object),
        }),
      );
      expect(mockCreateAgentSession.mock.calls[0]?.[0]).not.toHaveProperty('systemPrompt');
    });

    it('keeps Chat on Pi while skipping Work prompt, default Skill, and MCP resources', async () => {
      adapter.setMcpServerManager({
        toolManifest: [{ name: 'list_projects', description: 'List projects' }],
        serverStatuses: [{ name: 'Supabase', connected: true, toolCount: 1 }],
      } as never);
      adapter.setProjectMemoryService({} as never);
      adapter.setConversationHistoryService({ search: vi.fn(() => []) } as never);
      const beginRun = vi.fn();
      adapter.setWorkbenchTaskService({
        on: vi.fn(),
        off: vi.fn(),
        beginRun,
      } as unknown as WorkbenchTaskService);

      await adapter.startSession('chat-resources', 'Hello', {
        sessionMode: 'chat',
        systemPrompt: 'Only the explicitly selected chat prompt.',
      });

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        additionalSkillPaths?: string[];
        systemPromptOverride: (base: string | undefined) => string | undefined;
        appendSystemPromptOverride: () => string[];
      };
      expect(loaderOptions.additionalSkillPaths).toEqual([]);
      expect(loaderOptions.systemPromptOverride('Discovered custom prompt')).toBeUndefined();
      expect(loaderOptions.appendSystemPromptOverride()).toContain(
        'Only the explicitly selected chat prompt.',
      );
      expect(loaderOptions.appendSystemPromptOverride().join('\n')).toContain('知远智能体');
      expect(loaderOptions.appendSystemPromptOverride().join('\n')).not.toContain('Supabase');
      expect(loaderOptions.appendSystemPromptOverride()).not.toContain(
        PiDocumentReaderSystemPrompt,
      );
      expect(loaderOptions.appendSystemPromptOverride()).not.toContain(DeclareArtifactSystemPrompt);

      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{ name?: string }>;
      };
      const customToolNames = sessionOptions.customTools?.map(tool => tool.name) ?? [];
      expect(customToolNames).toContain(PiWebSearchToolName);
      expect(customToolNames).not.toContain(PiMcpTool.Name);
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

    it('passes the model context window through to Chat Pi sessions and caps compaction at fixed ceilings', async () => {
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
      expect(settingsManager.applyOverrides).toHaveBeenCalledWith({
        compaction: {
          enabled: true,
          reserveTokens: 16_384,
          keepRecentTokens: 20_000,
        },
      });
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
      expect(settingsManager.applyOverrides).toHaveBeenCalledWith({
        compaction: {
          enabled: true,
          reserveTokens: 8_192,
          keepRecentTokens: 16_384,
        },
      });
    });

    it('keeps codemode extensions off the default session wiring', async () => {
      await adapter.startSession('codemode-off', 'Hello Pi');

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: unknown[];
      };
      const factories = loaderOptions?.extensionFactories ?? [];
      expect(factories).not.toContain('codemode-extension-factory');
      expect(factories).not.toContain('tool-search-extension-factory');
      const settingsManager = mockSettingsManagerInMemory.mock.results[0]?.value;
      expect(settingsManager.applyOverrides).not.toHaveBeenCalledWith(
        expect.objectContaining({ defaultTools: expect.any(Array) }),
      );
    });

    it('registers codemode extensions and activates the tool when requested', async () => {
      await adapter.startSession('codemode-on', 'Hello Pi', { codemode: true });

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: unknown[];
      };
      const factories = loaderOptions?.extensionFactories ?? [];
      expect(factories).toContain('codemode-extension-factory');
      expect(factories).toContain('tool-search-extension-factory');
      const settingsManager = mockSettingsManagerInMemory.mock.results[0]?.value;
      expect(settingsManager.applyOverrides).toHaveBeenCalledWith({
        defaultTools: ['+codemode'],
      });
    });

    it('routes work sessions through the native MCP extension when enabled', async () => {
      adapter.setMcpServerManager({
        toolManifest: [
          {
            server: 'Supabase',
            name: 'list_projects',
            description: 'List projects',
            inputSchema: { type: 'object' },
          },
        ],
        lastEnabledRecords: [],
      } as never);
      await adapter.startSession('mcp-native', 'Hello Pi', { mcpNativeBridge: true });

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: unknown[];
      };
      expect(loaderOptions?.extensionFactories).toContain('mcp-extension-factory');
      expect(mockCreateMcpExtension).toHaveBeenCalledWith(
        expect.objectContaining({
          loadConfig: expect.any(Function),
          createTransport: expect.any(Function),
        }),
      );
      expect(mockSession.bindExtensions).toHaveBeenCalled();
      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(sessionOptions?.customTools?.map(tool => tool.name)).not.toContain(PiMcpTool.Name);
    });

    it('keeps the gateway tool when the native bridge is off', async () => {
      adapter.setMcpServerManager({
        toolManifest: [
          {
            server: 'Supabase',
            name: 'list_projects',
            description: 'List projects',
            inputSchema: { type: 'object' },
          },
        ],
      } as never);
      await adapter.startSession('mcp-gateway', 'Hello Pi');

      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        extensionFactories?: unknown[];
      };
      expect(loaderOptions?.extensionFactories ?? []).not.toContain('mcp-extension-factory');
      expect(mockSession.bindExtensions).not.toHaveBeenCalled();
      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{ name: string }>;
      };
      expect(sessionOptions?.customTools?.map(tool => tool.name)).toContain(PiMcpTool.Name);
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
      expect(mockModelRuntime.registerProvider).toHaveBeenCalledWith(
        'magpie',
        expect.objectContaining({
          baseUrl: `${TEST_MAGPIE_GATEWAY}/v1`,
          api: 'openai-completions',
          models: [expect.objectContaining({ id: 'llamacpp/qwen-local' })],
        }),
      );
      expect(mockModelRuntime.setRuntimeApiKey).toHaveBeenCalledWith('magpie', 'magpie-zhiyuan');
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

    it('keeps an image attachment as a text hint for non-vision models', async () => {
      await adapter.startSession('text-only', 'Describe this image', {
        imageAttachments: [{ name: 'example.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
      });

      const [sentPrompt] = mockSession.prompt.mock.calls[0] as [string];
      // Pi's in-band note for a non-vision model, mirrored for composer images:
      // the bytes are withheld and the model is told why. An unconfigured model
      // is reported as unconfirmed, not as a confirmed text-only model.
      expect(sentPrompt).toContain('Describe this image');
      expect(sentPrompt).toContain('not sent');
      expect(sentPrompt).toMatch(/not confirmed/i);
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
    });
  });
});
