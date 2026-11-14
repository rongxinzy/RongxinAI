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
  createTemporaryWorkspace,
  mockCreateAgentSession,
  mockModelRuntime,
  mockSession,
  setupPiRuntimeAdapterSuite,
  createdResources,
} from './piRuntimeAdapter.testHarness';

import { describe, expect, it, vi } from 'vitest';
import { PiWebSearchToolName } from './constants';
import { getZhiyuanProductPreamble } from './piPromptOverrides';
import { TEST_MAGPIE_GATEWAY } from '../../../../tests/helpers/installTestMagpie';
import { ModelCapabilityStatus } from '../../../shared/providers';
import { resolveBundledOcrHelper } from '../ocrHelper';
import { PiDocumentReaderToolName } from './piDocumentReaderTool';
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
      const resource = await createdResources();
      expect(resource.getSystemPrompt()).toContain(getZhiyuanProductPreamble());
      expect(resource.getSystemPrompt()).toContain('You are the selected expert.');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ resourceLoader: resource }),
      );
      expect(mockCreateAgentSession.mock.calls[0][0]).not.toHaveProperty('systemPrompt');
    });

    it('keeps Chat on Pi while skipping Work prompt, default Skill, and MCP resources', async () => {
      adapter.setMcpServerManager({ toolManifest: [], lastEnabledRecords: [] } as never);
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
      const resources = await createdResources();
      expect(resources.getSkills().skills).toEqual([]);
      expect(
        resources.extensions.flatMap(extension => extension.tools ?? []).map(tool => tool.name),
      ).not.toContain('codemode');
      expect(resources.getSystemPrompt()).toContain('Only the explicitly selected chat prompt.');
      const names = mockCreateAgentSession.mock.calls[0][0].customTools.map(
        (tool: { name: string }) => tool.name,
      );
      expect(names).toContain(PiWebSearchToolName);
      expect(names).not.toContain(CONVERSATION_HISTORY_TOOL_NAME);
      expect(names).not.toContain(PiDocumentReaderToolName);
      expect(names).not.toContain(PiSubagentToolName);
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
      await adapter.startSession('chat-context-limit', 'First', {
        sessionMode: 'chat',
        modelOverride: 'openai/gpt-5.2',
      });
      const options = mockCreateAgentSession.mock.calls[0][0];
      expect(options.model.contextWindow).toBe(272000);
      expect(options).not.toHaveProperty('settingsManager');
      expect(options).not.toHaveProperty('compaction');
    });

    it('keeps each session Durable resource bundle isolated', async () => {
      await adapter.startSession('resources-a', 'First', { systemPrompt: 'Policy A' });
      await adapter.startSession('resources-b', 'Second', { systemPrompt: 'Policy B' });
      const first = await createdResources(0);
      const second = await createdResources(1);
      expect(first).not.toBe(second);
      expect(first.getSystemPrompt()).toContain('Policy A');
      expect(first.getSystemPrompt()).not.toContain('Policy B');
      expect(second.getSystemPrompt()).toContain('Policy B');
      expect(mockCreateAgentSession.mock.calls[0][0]).not.toHaveProperty('settingsManager');
    });

    it('keeps unused codemode out of the default Work tool surface', async () => {
      await adapter.startSession('codemode-off', 'Hello Pi');
      const resources = await createdResources();
      const names = resources.extensions
        .flatMap(extension => extension.tools ?? [])
        .map(tool => tool.name);
      expect(names).not.toContain('codemode');
      expect(names).not.toContain('tool_search');
    });

    it('activates codemode when requested on work sessions', async () => {
      await adapter.startSession('codemode-on', 'Hello Pi', { codemode: true });
      const resources = await createdResources();
      const names = resources.extensions
        .flatMap(extension => extension.tools ?? [])
        .map(tool => tool.name);
      expect(names).toContain('codemode');
      expect(names).toContain('tool_search');
    });

    it('lets Durable select execution tools without host settings overrides', async () => {
      await adapter.startSession('native-shell', 'Hello Pi');
      expect(mockCreateAgentSession.mock.calls[0][0]).not.toHaveProperty('settingsManager');
      expect(mockCreateAgentSession.mock.calls[0][0].cwd).toBe(process.cwd());
    });

    it('registers app-owned MCP tools directly in Durable', async () => {
      adapter.setMcpServerManager({
        toolManifest: [
          {
            server: 'Docs',
            name: 'search',
            description: 'Search docs',
            inputSchema: { type: 'object', properties: {} },
          },
        ],
        lastEnabledRecords: [{ id: 'docs', name: 'Docs', enabled: true, exposure: 'direct' }],
        callTool: vi.fn(),
      } as never);
      await adapter.startSession('mcp-native', 'Hello Pi');
      const resources = await createdResources();
      expect(
        resources.extensions.flatMap(extension => extension.tools ?? []).map(tool => tool.name),
      ).toContain('mcp__Docs__search');
    });

    it('excludes codemode from chat sessions even when requested', async () => {
      await adapter.startSession('codemode-chat', 'Hello', { codemode: true, sessionMode: 'chat' });
      const resources = await createdResources();
      expect(
        resources.extensions.flatMap(extension => extension.tools ?? []).map(tool => tool.name),
      ).not.toContain('codemode');
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
      expect(mockSession.dispose).toHaveBeenCalledOnce();
    });

    it('routes memory through the native session binding without rewriting user input', async () => {
      const memoryBinding = {
        extension: { name: 'test.memory' },
        bindConversation: vi.fn(),
        runSettled: vi.fn(),
        maintain: vi.fn(),
      };
      const createDurableMemoryBinding = vi.fn().mockResolvedValue(memoryBinding);
      const buildProjectContext = vi.fn();
      adapter.setProjectMemoryService({
        createDurableMemoryBinding,
        buildProjectContext,
        registerSession: vi.fn().mockResolvedValue(undefined),
      } as never);
      const workspace = createTemporaryWorkspace();
      await adapter.startSession('memory-section', 'Inspect repository', {
        sessionMode: 'work',
        workspaceRoot: workspace,
      });
      expect(mockSession.prompt).toHaveBeenCalledWith('Inspect repository');
      expect(createDurableMemoryBinding).toHaveBeenCalledWith(workspace, 'memory-section');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({ memoryBinding }),
      );
      expect(buildProjectContext).not.toHaveBeenCalled();
    });
  });
});
