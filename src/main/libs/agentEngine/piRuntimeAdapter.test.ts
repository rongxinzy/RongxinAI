/**
 * PiRuntimeAdapter unit tests.
 *
 * Tests CoworkRuntime contract compliance using mocked Pi SDK modules.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const mockSession = {
    prompt: vi.fn().mockResolvedValue(undefined),
    abort: vi.fn().mockResolvedValue(undefined),
    abortBash: vi.fn(),
    setModel: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  };

  return {
    mockSession,
    mockCreateAgentSession: vi.fn().mockResolvedValue({ session: mockSession }),
    mockDefaultResourceLoader: vi.fn(function (this: { reload: () => Promise<void> }) {
      this.reload = vi.fn().mockResolvedValue(undefined);
    }),
    mockGetAgentDir: vi.fn(() => '/tmp/pi-agent'),
    mockCompleteSimple: vi.fn().mockResolvedValue({ content: [{ text: 'Hello from Pi' }] }),
    mockGetModel: vi.fn((provider: string, modelId: string) => ({ provider, id: modelId })),
    mockAuthStorage: {
      setRuntimeApiKey: vi.fn(),
    },
    mockResolveRawApiConfig: vi.fn(() => ({
      config: {
        apiKey: 'sk-test',
        baseURL: 'http://127.0.0.1:11434/v1',
        model: 'qwen-local',
        apiType: 'openai' as const,
      },
      providerMetadata: {
        providerName: 'llamacpp',
        codingPlanEnabled: false,
        supportsImage: false,
        modelName: 'qwen-local',
        contextWindow: 32768,
        contextTokens: 32768,
        maxTokens: 4096,
      },
    })),
    mockResolveRawApiConfigForModelRef: vi.fn((modelRef: string) => {
      const [providerName = 'llamacpp', modelName = modelRef] = modelRef.includes('/')
        ? modelRef.split('/')
        : ['llamacpp', modelRef];

      if (providerName === 'openai') {
        return {
          config: {
            apiKey: 'sk-openai',
            baseURL: 'https://api.openai.com/v1',
            model: modelName,
            apiType: 'openai' as const,
          },
          providerMetadata: {
            providerName: 'openai',
            codingPlanEnabled: false,
            supportsImage: true,
            modelName,
            contextWindow: 272000,
            contextTokens: 272000,
            maxTokens: 16384,
          },
        };
      }

      return {
        config: {
          apiKey: 'sk-test',
          baseURL: 'http://127.0.0.1:11434/v1',
          model: modelName,
          apiType: 'openai' as const,
        },
        providerMetadata: {
          providerName,
          codingPlanEnabled: false,
          supportsImage: false,
          modelName,
          contextWindow: 32768,
          contextTokens: 32768,
          maxTokens: 4096,
        },
      };
    }),
  };
});

// ── Mocks ──

const mockSession = hoisted.mockSession;
const mockCreateAgentSession = hoisted.mockCreateAgentSession;
const mockDefaultResourceLoader = hoisted.mockDefaultResourceLoader;
const mockGetModel = hoisted.mockGetModel;
const mockAuthStorage = hoisted.mockAuthStorage;
const mockResolveRawApiConfigForModelRef = hoisted.mockResolveRawApiConfigForModelRef;

vi.mock('@earendil-works/pi-coding-agent', () => ({
  createAgentSession: hoisted.mockCreateAgentSession,
  DefaultResourceLoader: hoisted.mockDefaultResourceLoader,
  getAgentDir: hoisted.mockGetAgentDir,
  AuthStorage: {
    inMemory: vi.fn(() => hoisted.mockAuthStorage),
  },
}));

vi.mock('@earendil-works/pi-ai/compat', () => ({
  getModel: hoisted.mockGetModel,
  completeSimple: hoisted.mockCompleteSimple,
}));

vi.mock('../claudeSettings', () => ({
  resolveRawApiConfig: hoisted.mockResolveRawApiConfig,
  resolveRawApiConfigForModelRef: hoisted.mockResolveRawApiConfigForModelRef,
}));

import { PiRuntimeAdapter } from './piRuntimeAdapter';

describe('PiRuntimeAdapter', () => {
  let adapter: PiRuntimeAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    adapter = new PiRuntimeAdapter();
  });

  // ── Session lifecycle ──

  describe('startSession', () => {
    it('should create a session and subscribe to events', async () => {
      await adapter.startSession('test', 'Hello Pi');
      expect(mockSession.subscribe).toHaveBeenCalled();
      expect(mockSession.prompt).toHaveBeenCalledWith('Hello Pi');
    });

    it('should inject the session system prompt through Pi resource loading', async () => {
      await adapter.startSession('test', 'Hello Pi', {
        systemPrompt: 'You are the selected expert.',
      });

      expect(mockDefaultResourceLoader).toHaveBeenCalledWith(
        expect.objectContaining({
          agentDir: '/tmp/pi-agent',
          cwd: process.cwd(),
          appendSystemPromptOverride: expect.any(Function),
          systemPromptOverride: expect.any(Function),
        }),
      );
      const loaderOptions = mockDefaultResourceLoader.mock.calls[0]?.[0] as {
        systemPromptOverride: (base: string | undefined) => string | undefined;
      };
      expect(loaderOptions.systemPromptOverride('Pi default prompt')).toBe(
        'You are the selected expert.',
      );
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceLoader: expect.any(Object),
        }),
      );
      expect(mockCreateAgentSession.mock.calls[0]?.[0]).not.toHaveProperty('systemPrompt');
    });

    it('should resolve the explicit model override for a new session', async () => {
      await adapter.startSession('test', 'Hello Pi', { modelOverride: 'llamacpp/qwen-local' });

      expect(mockResolveRawApiConfigForModelRef).toHaveBeenCalledWith('llamacpp/qwen-local');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            provider: 'llamacpp',
            id: 'qwen-local',
            baseUrl: 'http://127.0.0.1:11434/v1',
          }),
        }),
      );
      expect(mockGetModel).not.toHaveBeenCalled();
      expect(mockAuthStorage.setRuntimeApiKey).toHaveBeenCalledWith('llamacpp', 'sk-test');
    });

    it('should keep supported remote models on the Pi built-in path', async () => {
      await adapter.startSession('test', 'Hello Pi', { modelOverride: 'openai/gpt-5.2' });

      expect(mockResolveRawApiConfigForModelRef).toHaveBeenCalledWith('openai/gpt-5.2');
      expect(mockGetModel).toHaveBeenCalledWith('openai', 'gpt-5.2');
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          model: expect.objectContaining({
            provider: 'openai',
            id: 'gpt-5.2',
          }),
        }),
      );
      expect(mockAuthStorage.setRuntimeApiKey).toHaveBeenCalledWith('openai', 'sk-openai');
    });

    it('should make session active after start', async () => {
      expect(adapter.isSessionActive('test')).toBe(false);
      await adapter.startSession('test', 'Hello');
      expect(adapter.isSessionActive('test')).toBe(true);
    });

    it('should throw on empty prompt with no images', async () => {
      await expect(adapter.startSession('test', '')).rejects.toThrow('Prompt is required.');
    });

    it('should replace existing session with same id', async () => {
      await adapter.startSession('test', 'First');
      await adapter.startSession('test', 'Second');
      // Old session aborted, new one created
      expect(mockSession.abort).toHaveBeenCalled();
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);
    });
  });

  describe('continueSession', () => {
    it('should fall back to startSession for unknown session', async () => {
      await adapter.continueSession('unknown', 'Hello');
      // Should not throw; falls back to creating new session
      expect(mockSession.subscribe).toHaveBeenCalled();
    });

    it('should reuse existing session for continuation', async () => {
      await adapter.startSession('test', 'First');
      await adapter.continueSession('test', 'Second');
      // prompt() called twice total (once for start, once for continue)
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);
    });

    it('should recreate an active session when its system prompt changes', async () => {
      await adapter.startSession('test', 'First', { systemPrompt: 'You are the original expert.' });
      await adapter.continueSession('test', 'Second', {
        systemPrompt: 'You are the replacement expert.',
      });

      expect(mockSession.abort).toHaveBeenCalled();
      expect(mockDefaultResourceLoader).toHaveBeenCalledTimes(2);
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);
    });
  });

  describe('stopSession', () => {
    it('should keep session active (preserves history for continueSession)', async () => {
      await adapter.startSession('test', 'Hello');
      adapter.stopSession('test');
      // Session stays active so continueSession can find it and preserve history
      expect(adapter.isSessionActive('test')).toBe(true);
      expect(mockSession.abort).toHaveBeenCalled();
    });

    it('should be safe to call on unknown session', () => {
      adapter.stopSession('unknown');
      // Should not throw
    });
  });

  describe('stopAllSessions', () => {
    it('should keep all sessions active (preserves history)', async () => {
      await adapter.startSession('s1', 'A');
      await adapter.startSession('s2', 'B');
      adapter.stopAllSessions();
      // Sessions stay active so continueSession can find them
      expect(adapter.isSessionActive('s1')).toBe(true);
      expect(adapter.isSessionActive('s2')).toBe(true);
    });
  });

  // ── Session state ──

  describe('isSessionActive', () => {
    it('should return false for unknown session', () => {
      expect(adapter.isSessionActive('nope')).toBe(false);
    });
  });

  describe('getSessionConfirmationMode', () => {
    it('should return null for unknown session', () => {
      expect(adapter.getSessionConfirmationMode('nope')).toBeNull();
    });

    it('should return modal by default', async () => {
      await adapter.startSession('test', 'Hello');
      expect(adapter.getSessionConfirmationMode('test')).toBe('modal');
    });

    it('should return text when Chat mode is set', async () => {
      await adapter.startSession('test', 'Hello', { confirmationMode: 'text' });
      expect(adapter.getSessionConfirmationMode('test')).toBe('text');
    });
  });

  // ── Model updates ──

  describe('patchSession', () => {
    it('should call setModel when model is provided', async () => {
      await adapter.startSession('test', 'Hello');
      await adapter.patchSession('test', { model: 'llamacpp/qwen-local-2' });
      expect(mockSession.setModel).toHaveBeenCalled();
      expect(mockResolveRawApiConfigForModelRef).toHaveBeenCalledWith('llamacpp/qwen-local-2');
    });

    it('should not call setModel when no model in patch', async () => {
      await adapter.startSession('test', 'Hello');
      await adapter.patchSession('test', {});
      expect(mockSession.setModel).not.toHaveBeenCalled();
    });

    it('should be a no-op for unknown session', async () => {
      await expect(adapter.patchSession('nope', { model: 'x' })).resolves.not.toThrow();
    });
  });

  // ── Permission ──

  describe('respondToPermission', () => {
    it('should be a no-op for unknown request IDs', () => {
      expect(() => adapter.respondToPermission('unknown', { behavior: 'allow' })).not.toThrow();
      expect(() =>
        adapter.respondToPermission('unknown', { behavior: 'deny', message: 'no' }),
      ).not.toThrow();
    });
  });

  // ── Cleanup ──

  describe('onSessionDeleted', () => {
    it('should stop the session', async () => {
      await adapter.startSession('test', 'Hello');
      adapter.onSessionDeleted('test');
      expect(adapter.isSessionActive('test')).toBe(false);
    });
  });

  // ── Event mapping: tool execution ──

  describe('tool execution event mapping', () => {
    // Capture the Pi event listener so we can drive events manually.
    let listener: ((event: unknown) => void) | null = null;

    beforeEach(() => {
      listener = null;
      mockSession.subscribe.mockImplementation((cb: (event: unknown) => void) => {
        listener = cb;
        return () => {};
      });
    });

    it('should emit a tool_use message on tool_execution_start', async () => {
      const messages: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      await adapter.startSession('test', 'Do something');

      listener!({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'Bash',
        args: { command: 'ls' },
      });

      const toolUse = messages.find(m => m.type === 'tool_use');
      expect(toolUse).toBeDefined();
      expect(toolUse!.metadata?.toolName).toBe('Bash');
      expect(toolUse!.metadata?.toolUseId).toBe('call-1');
      expect(toolUse!.metadata?.toolInput).toEqual({ command: 'ls' });
    });

    it('should emit a linked tool_result message on tool_execution_end', async () => {
      const messages: Array<{ type: string; content: string; metadata?: Record<string, unknown> }> =
        [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      await adapter.startSession('test', 'Do something');

      listener!({ type: 'tool_execution_start', toolCallId: 'call-1', toolName: 'Bash', args: {} });
      listener!({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'Bash',
        result: 'file1.txt\nfile2.txt',
        isError: false,
      });

      const toolResult = messages.find(m => m.type === 'tool_result');
      expect(toolResult).toBeDefined();
      expect(toolResult!.metadata?.toolUseId).toBe('call-1');
      expect(toolResult!.metadata?.isError).toBe(false);
      expect(toolResult!.content).toContain('file1.txt');
    });

    it('should not emit duplicate tool_result for the same call', async () => {
      const results: unknown[] = [];
      adapter.on('message', (_sid, msg) => {
        if ((msg as { type: string }).type === 'tool_result') results.push(msg);
      });
      await adapter.startSession('test', 'Do something');

      const endEvent = {
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'Bash',
        result: 'x',
        isError: false,
      };
      listener!(endEvent);
      listener!(endEvent);

      expect(results).toHaveLength(1);
    });

    it('should flag tool_result as error when isError is true', async () => {
      const messages: Array<{ type: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      await adapter.startSession('test', 'Do something');

      listener!({
        type: 'tool_execution_end',
        toolCallId: 'call-err',
        toolName: 'Bash',
        result: 'command not found',
        isError: true,
      });

      const toolResult = messages.find(m => m.type === 'tool_result');
      expect(toolResult!.metadata?.isError).toBe(true);
    });
  });

  // ── Event mapping: assistant streaming (duplicate-render regression) ──

  describe('assistant streaming event mapping', () => {
    let listener: ((event: unknown) => void) | null = null;

    beforeEach(() => {
      listener = null;
      mockSession.subscribe.mockImplementation((cb: (event: unknown) => void) => {
        listener = cb;
        return () => {};
      });
    });

    /**
     * Drive a full assistant turn. message_update carries the FULL accumulating
     * snapshot (blocks of {type:'text',text}), matching real Pi behavior.
     */
    const driveAssistantTurn = (text: string) => {
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      });
      listener!({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
      });
    };

    it('should emit exactly ONE assistant message event per turn (no duplicate bubble)', async () => {
      const assistantMessages: Array<{ id: string; type: string }> = [];
      const updates: Array<{ messageId: string; content: string }> = [];
      adapter.on('message', (_sid, msg) => {
        if ((msg as { type: string }).type === 'assistant') assistantMessages.push(msg as never);
      });
      adapter.on('messageUpdate', (_sid, messageId, content) =>
        updates.push({ messageId, content }),
      );

      await adapter.startSession('test', 'Hi');
      driveAssistantTurn('Hello world');

      // Exactly one 'message' event (the streaming seed), finalized via messageUpdate —
      // NOT a second 'message' event, which is what caused duplicate rendering.
      expect(assistantMessages).toHaveLength(1);
      // The final content is delivered on the same message id.
      const finalUpdate = updates[updates.length - 1];
      expect(finalUpdate.messageId).toBe(assistantMessages[0].id);
      expect(finalUpdate.content).toBe('Hello world');
    });

    it('should keep the same message id across stream and finalize', async () => {
      const ids = new Set<string>();
      adapter.on('message', (_sid, msg) => {
        if ((msg as { type: string }).type === 'assistant') ids.add((msg as { id: string }).id);
      });
      adapter.on('messageUpdate', (_sid, messageId) => ids.add(messageId));

      await adapter.startSession('test', 'Hi');
      driveAssistantTurn('One two three');

      // Streaming updates and the seeded message must all share a single id.
      expect(ids.size).toBe(1);
    });

    it('should SET content from snapshots, never append (no repeated content)', async () => {
      const updates: string[] = [];
      adapter.on('messageUpdate', (_sid, _id, content) => updates.push(content));
      await adapter.startSession('test', 'Hi');

      // Three accumulating snapshots (as Pi sends them), not deltas.
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hel' }] },
      });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello world' }] },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello world' }],
          stopReason: 'stop',
        },
      });

      // The final content must be exactly the last snapshot — NOT "HelHelloHello world".
      expect(updates[updates.length - 1]).toBe('Hello world');
      // No emitted content should ever contain a duplicated prefix.
      expect(updates.some(c => c.includes('HelHello') || c.includes('HelloHello'))).toBe(false);
    });

    it('should render thinking as a separate isThinking message, not as the answer', async () => {
      const messages: Array<{ id: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('message', (_sid, msg) => messages.push(msg as never));
      const updates: Array<{ messageId: string; metadata?: Record<string, unknown> }> = [];
      adapter.on('messageUpdate', (_sid, messageId, _c, metadata) =>
        updates.push({ messageId, metadata }),
      );

      await adapter.startSession('test', 'Think then answer');
      listener!({ type: 'turn_start' });
      // A snapshot containing both thinking and answer blocks.
      listener!({
        type: 'message_update',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me reason...' },
            { type: 'text', text: 'The answer is 42.' },
          ],
        },
      });
      listener!({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me reason...' },
            { type: 'text', text: 'The answer is 42.' },
          ],
          stopReason: 'stop',
        },
      });

      // Two distinct assistant messages: one thinking, one answer — with different ids.
      const thinkingMsg = messages.find(m => m.metadata?.isThinking === true);
      const answerMsg = messages.find(
        m =>
          m.metadata?.isThinking !== true &&
          (m.metadata as Record<string, unknown>)?.isStreaming !== undefined,
      );
      expect(thinkingMsg).toBeDefined();
      expect(answerMsg).toBeDefined();
      expect(thinkingMsg!.id).not.toBe(answerMsg!.id);

      // The thinking message must be finalized WITH isThinking:true (never as a plain answer).
      const thinkingFinal = updates.filter(u => u.messageId === thinkingMsg!.id).pop();
      expect(thinkingFinal?.metadata?.isThinking).toBe(true);
      expect(thinkingFinal?.metadata?.isFinal).toBe(true);
    });

    it('should not lose intermediate updates during a fast stream (no burst-freeze)', async () => {
      vi.useFakeTimers();
      try {
        const updates: string[] = [];
        adapter.on('messageUpdate', (_sid, _id, content) => updates.push(content));
        await adapter.startSession('test', 'Hi');

        listener!({ type: 'turn_start' });
        // Rapid snapshots 50ms apart (faster than the 200ms throttle window).
        const snaps = ['a', 'ab', 'abc', 'abcd', 'abcde'];
        for (const s of snaps) {
          listener!({
            type: 'message_update',
            message: { role: 'assistant', content: [{ type: 'text', text: s }] },
          });
          vi.advanceTimersByTime(50);
        }
        // Let any trailing throttle timer fire.
        vi.advanceTimersByTime(250);

        // Leading emit fires immediately; a trailing emit must deliver the latest
        // content — the timer must NOT be perpetually re-armed (which would freeze
        // the UI until the stream paused).
        expect(updates.length).toBeGreaterThanOrEqual(2);
        expect(updates[updates.length - 1]).toBe('abcde');
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
