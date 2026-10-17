/**
 * PiRuntimeAdapter unit tests: auto-retry error storm (image capability
 * verdicts and retry bookkeeping).
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import {
  adapter,
  applyTestResolution,
  mockCreateAgentSession,
  mockSession,
  setupPiRuntimeAdapterSuite,
  VISION_MODEL_RESOLUTION,
} from './piRuntimeAdapter.testHarness';

import path from 'path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_MAGPIE_GATEWAY } from '../../../../tests/helpers/installTestMagpie';
import { ModelCapabilityStatus } from '../../../shared/providers';
import { WorkbenchApprovalMode } from '../../../shared/workbenchTask';
import { imageCapabilityFingerprint, isImageInputRejected } from './piImageInputFallback';
import { PiAgentLoopAction, PiAgentLoopMode, PiAgentLoopToolName } from './piAgentLoop';
import { CoworkErrorKind, type CoworkError } from '../../../common/coworkError';
import type { CoworkStore } from '../../coworkStore';

describe('PiRuntimeAdapter', () => {
  setupPiRuntimeAdapterSuite();

  describe('auto-retry error storm', () => {
    let listener: ((event: unknown) => void) | null = null;
    let mockStore: {
      updateSession: ReturnType<typeof vi.fn>;
      updateMessage: ReturnType<typeof vi.fn>;
      addMessage: ReturnType<typeof vi.fn>;
      getSession: ReturnType<typeof vi.fn>;
      getAgent: ReturnType<typeof vi.fn>;
      listAgents: ReturnType<typeof vi.fn>;
    };
    let errors: CoworkError[];
    let completes: string[];
    let emittedMessages: Array<Record<string, unknown>>;

    const failedAttempt = (errorMessage: string) => {
      listener!({
        type: 'message_end',
        message: { role: 'assistant', content: '', stopReason: 'error', errorMessage },
      });
      listener!({ type: 'turn_end' });
      listener!({ type: 'agent_end' });
    };

    const successfulTurn = (text: string) => {
      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text }] },
      });
      listener!({
        type: 'message_end',
        message: { role: 'assistant', content: [{ type: 'text', text }], stopReason: 'stop' },
      });
      listener!({ type: 'agent_end' });
    };

    const systemErrorMessages = () =>
      mockStore.addMessage.mock.calls.filter(
        ([, message]) => (message as { type: string }).type === 'system',
      );

    beforeEach(() => {
      listener = null;
      mockSession.subscribe.mockImplementation((cb: (event: unknown) => void) => {
        listener = cb;
        return () => {};
      });
      mockStore = {
        updateSession: vi.fn(),
        updateMessage: vi.fn(),
        addMessage: vi.fn((_sessionId: string, message: Record<string, unknown>) => ({
          ...message,
          id: (message.id as string) ?? 'stored-id',
        })),
        getSession: vi.fn(() => undefined),
        getAgent: vi.fn(() => undefined),
        listAgents: vi.fn(() => []),
      };
      adapter.setCoworkStore(mockStore as unknown as CoworkStore);
      errors = [];
      completes = [];
      emittedMessages = [];
      adapter.on('message', (_sid, message) =>
        emittedMessages.push(message as unknown as Record<string, unknown>),
      );
      adapter.on('error', (_sid, error) => errors.push(error as CoworkError));
      adapter.on('complete', sessionId => completes.push(sessionId));
    });

    it('does not treat a refused image format as a capability verdict', async () => {
      applyTestResolution(VISION_MODEL_RESOLUTION);
      await adapter.startSession('format-issue', 'Describe this image', {
        imageAttachments: [
          {
            name: 'example.webp',
            mimeType: 'image/webp',
            base64Data: 'aW1hZ2U=',
            path: 'C:\\cowork-images\\s\\hash.webp',
          },
        ],
      });

      listener!({ type: 'turn_start' });
      failedAttempt('400 this model does not support image format image/webp');
      listener!({ type: 'agent_settled' });

      // The image turn went out once and was not retried as text.
      expect(mockSession.sendUserMessage).toHaveBeenCalledTimes(1);
      expect(mockSession.prompt).not.toHaveBeenCalled();
      expect(errors.length).toBeGreaterThan(0);
      // No capability verdict was recorded: normal PNG/JPEG still ships.
      expect(
        isImageInputRejected(
          'magpie',
          'kimi-k2.6',
          imageCapabilityFingerprint({
            supportsImage: true,
            imageInput: ModelCapabilityStatus.Supported,
            endpointKey: `${TEST_MAGPIE_GATEWAY}/v1`,
          }),
        ),
      ).toBe(false);
    });

    it('retries when the rejection arrives before the send promise resolves', async () => {
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
      // The SDK can report a rejected payload through events that land before the
      // send promise settles; the turn's image state must already be recorded.
      mockSession.sendUserMessage.mockImplementationOnce(async () => {
        failedAttempt(
          '400: {"message":"this server was started without the vision encoder (run setup again and choose \'vision\'), so it cannot read images"}',
        );
        listener!({ type: 'agent_settled' });
      });

      await adapter.startSession('image-retry-race', 'Describe this image', {
        imageAttachments: [
          {
            name: 'example.png',
            mimeType: 'image/png',
            base64Data: 'aW1hZ2U=',
            path: 'C:\\cowork-images\\s\\hash.png',
          },
        ],
      });

      await vi.waitFor(() => expect(mockSession.prompt).toHaveBeenCalledTimes(1));
      const [retryPrompt] = mockSession.prompt.mock.calls[0] as [string];
      expect(retryPrompt).toContain('C:\\cowork-images\\s\\hash.png');
    });

    it('keeps the session approval mode when the retry rebuilds the session', async () => {
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

      await adapter.startSession('image-retry-approval', 'Describe this image', {
        approvalMode: WorkbenchApprovalMode.AllowAll,
        imageAttachments: [
          {
            name: 'example.png',
            mimeType: 'image/png',
            base64Data: 'aW1hZ2U=',
            path: 'C:\\cowork-images\\s\\hash.png',
          },
        ],
      });

      // The retry rebuilds the Pi session; "allow all" must travel with it or the
      // user starts getting permission prompts again mid-task.
      const continueSpy = vi.spyOn(adapter, 'continueSession');
      listener!({ type: 'turn_start' });
      failedAttempt(
        '400: {"message":"this server was started without the vision encoder (run setup again and choose \'vision\'), so it cannot read images"}',
      );
      listener!({ type: 'agent_settled' });

      await vi.waitFor(() => expect(continueSpy).toHaveBeenCalled());
      const retryOptions = continueSpy.mock.calls.at(-1)?.[2];
      expect(retryOptions?.approvalMode).toBe(WorkbenchApprovalMode.AllowAll);
    });

    it('leaves a non-image capability error on the normal failure path', async () => {
      await adapter.startSession('test', 'Hi');

      listener!({ type: 'turn_start' });
      failedAttempt('500 {"code":500,"message":"this model does not support audio input"}');
      listener!({ type: 'agent_settled' });

      // Audio/video verdicts must never be mistaken for an image rejection.
      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe(CoworkErrorKind.ModelCapabilityUnsupported);
      expect(systemErrorMessages()).toHaveLength(1);
      expect(completes).toHaveLength(0);
    });

    it('cancels a non-retryable SDK retry and reports failure only after it settles', async () => {
      const notices: Array<{ kind: string; attempt: number }> = [];
      adapter.on('retryNotice', (_sid, notice) =>
        notices.push({ kind: notice.kind, attempt: notice.attempt }),
      );
      await adapter.startSession('test', 'Hi');

      listener!({ type: 'turn_start' });
      failedAttempt('502 invalid api key');

      expect(errors).toHaveLength(0);
      expect(adapter.isSessionRunning('test')).toBe(true);
      expect(systemErrorMessages()).toHaveLength(0);
      expect(completes).toHaveLength(0);
      expect(mockSession.abort).not.toHaveBeenCalled();

      // Cancelling the SDK retry must retain the original error until idle.
      listener!({ type: 'auto_retry_start', attempt: 1 });
      await Promise.resolve();
      expect(mockSession.abort).toHaveBeenCalledOnce();
      listener!({
        type: 'auto_retry_end',
        success: false,
        attempt: 1,
        finalError: 'Retry cancelled',
      });
      expect(errors).toHaveLength(0);
      expect(adapter.isSessionRunning('test')).toBe(true);
      listener!({ type: 'agent_settled' });

      expect(notices).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe(CoworkErrorKind.AuthExpired);
      expect(systemErrorMessages()).toHaveLength(1);
      expect(completes).toHaveLength(0);
    });

    it('announces a retryable failure once while Pi keeps retrying', async () => {
      const notices: Array<{ kind: string; attempt: number }> = [];
      adapter.on('retryNotice', (_sid, notice) =>
        notices.push({ kind: notice.kind, attempt: notice.attempt }),
      );
      await adapter.startSession('test', 'Hi');

      listener!({ type: 'turn_start' });
      failedAttempt('429 Too Many Requests: overloaded');
      listener!({ type: 'auto_retry_start', attempt: 1 });
      listener!({ type: 'auto_retry_start', attempt: 2 });

      expect(notices).toEqual([{ kind: CoworkErrorKind.RateLimited, attempt: 1 }]);
      // A retryable failure keeps retrying: the runtime must not end the turn.
      expect(errors).toHaveLength(0);
      expect(mockSession.abort).not.toHaveBeenCalled();
    });

    it('retains a non-retryable failure if the SDK emits a successful-looking cancellation', async () => {
      await adapter.startSession('test', 'Hi');

      listener!({ type: 'turn_start' });
      failedAttempt('401 Unauthorized: invalid api key');
      expect(errors).toHaveLength(0);
      expect(completes).toEqual([]);

      listener!({ type: 'auto_retry_end', success: true, attempt: 1 });
      listener!({ type: 'agent_settled' });

      expect(completes).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe(CoworkErrorKind.AuthExpired);
    });

    it('runs the next turn in the same session after a non-retryable failure', async () => {
      await adapter.startSession('test', 'Hi');

      listener!({ type: 'turn_start' });
      failedAttempt('502 invalid api key');
      let finishAbort: (() => void) | undefined;
      mockSession.abort.mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            finishAbort = resolve;
          }),
      );
      listener!({ type: 'auto_retry_start', attempt: 1 });
      await Promise.resolve();
      const continuation = adapter.continueSession('test', 'Next message');
      await Promise.resolve();
      expect(mockSession.prompt).toHaveBeenCalledTimes(1);
      listener!({ type: 'auto_retry_end', success: false, finalError: 'Retry cancelled' });
      listener!({ type: 'agent_settled' });
      finishAbort!();
      await continuation;
      expect(mockSession.prompt).toHaveBeenCalledTimes(2);

      // The user sends another message: this turn must run and complete.
      listener!({ type: 'turn_start' });
      successfulTurn('Second answer');
      listener!({ type: 'agent_settled' });

      expect(errors).toHaveLength(1);
      expect(completes).toEqual(['test']);
    });

    it('finalizes a partial answer before surfacing the terminal error', async () => {
      const updates: Array<{
        messageId: string;
        content: string;
        metadata?: Record<string, unknown>;
      }> = [];
      adapter.on('messageUpdate', (_sid, messageId, content, metadata) =>
        updates.push({ messageId, content, metadata }),
      );
      await adapter.startSession('test', 'Hi');

      listener!({ type: 'turn_start' });
      listener!({
        type: 'message_update',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Partial answer' }] },
      });
      failedAttempt('network error');
      listener!({ type: 'agent_settled' });

      expect(
        updates.some(
          update =>
            update.content === 'Partial answer' &&
            update.metadata?.isStreaming === false &&
            update.metadata?.isFinal === true,
        ),
      ).toBe(true);
      expect(emittedMessages.map(message => message.type)).toEqual(['user', 'assistant', 'system']);
    });

    it('does not complete or continue the agent loop on a failed turn', async () => {
      await adapter.startSession('test', 'Hi', { goalMode: true, sessionMode: 'work' });
      const sessionOptions = mockCreateAgentSession.mock.calls[0]?.[0] as {
        customTools?: Array<{
          name: string;
          execute: (toolCallId: string, params: Record<string, unknown>) => Promise<unknown>;
        }>;
      };
      const loopTool = sessionOptions.customTools?.find(tool => tool.name === PiAgentLoopToolName);
      expect(loopTool).toBeDefined();
      // Arm the loop so agent_end would normally continue with iteration 2.
      await loopTool!.execute('call-1', {
        action: PiAgentLoopAction.Start,
        mode: PiAgentLoopMode.Passes,
        passes: 3,
      });
      await loopTool!.execute('call-2', { action: PiAgentLoopAction.Next, summary: 'iter 1 done' });

      listener!({ type: 'turn_start' });
      failedAttempt('429 Too Many Requests: overloaded');
      listener!({
        type: 'auto_retry_end',
        success: false,
        attempt: 3,
        finalError: '429 Too Many Requests: overloaded',
      });

      // No continuation prompt beyond the initial startSession prompt.
      expect(mockSession.prompt).toHaveBeenCalledTimes(1);
      expect(completes).toHaveLength(0);
      expect(mockStore.updateSession).not.toHaveBeenCalledWith('test', { status: 'completed' });
    });
  });
});
