/**
 * PiRuntimeAdapter unit tests: auto-retry error storm (deferred error
 * surfacing) and image-capability rejection retries.
 *
 * Split from the original piRuntimeAdapter.test.ts; the shared mocks and
 * adapter lifecycle live in piRuntimeAdapter.testHarness.ts (imported first so
 * the Pi SDK mocks are registered before any module under test loads).
 */

import {
  activePiModel,
  adapter,
  applyTestResolution,
  mockSession,
  setupPiRuntimeAdapterSuite,
  stubRawApiConfig,
  TEXT_ONLY_MODEL_RESOLUTION,
  UNKNOWN_MODEL_RESOLUTION,
  VISION_400,
  VISION_MODEL_RESOLUTION,
} from './piRuntimeAdapter.testHarness';

import path from 'path';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelCapabilityStatus } from '../../../shared/providers';
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

    it('surfaces no error when an auto-retry succeeds', async () => {
      await adapter.startSession('test', 'Hi');

      listener!({ type: 'turn_start' });
      failedAttempt('429 Too Many Requests: overloaded');
      listener!({ type: 'auto_retry_start' });
      successfulTurn('Recovered answer');
      listener!({ type: 'auto_retry_end', success: true, attempt: 1 });
      listener!({ type: 'agent_settled' });

      expect(errors).toHaveLength(0);
      expect(systemErrorMessages()).toHaveLength(0);
      expect(emittedMessages.filter(message => message.type === 'system')).toHaveLength(0);
      expect(mockStore.updateSession).not.toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ status: 'error' }),
      );
      expect(completes).toEqual(['test']);
      expect(mockStore.updateSession).toHaveBeenCalledWith('test', { status: 'idle' });
    });

    it('surfaces the error exactly once when auto-retries are exhausted', async () => {
      await adapter.startSession('test', 'Hi');

      for (let attempt = 0; attempt < 3; attempt++) {
        listener!({ type: 'turn_start' });
        failedAttempt('429 Too Many Requests: overloaded');
        if (attempt < 2) {
          listener!({ type: 'auto_retry_start', attempt: attempt + 1 });
        } else {
          listener!({
            type: 'auto_retry_end',
            success: false,
            attempt: attempt + 1,
            finalError: '429 Too Many Requests: overloaded',
          });
        }
      }
      listener!({ type: 'agent_settled' });

      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe(CoworkErrorKind.RateLimited);
      expect(systemErrorMessages()).toHaveLength(1);
      expect(emittedMessages.filter(message => message.type === 'system')).toHaveLength(1);
      expect(mockStore.updateSession).toHaveBeenCalledWith('test', { status: 'error' });
      expect(mockStore.updateSession).not.toHaveBeenCalledWith('test', { status: 'completed' });
      expect(completes).toHaveLength(0);
    });

    it('surfaces a non-retryable error once on agent_settled', async () => {
      await adapter.startSession('test', 'Hi');

      listener!({ type: 'turn_start' });
      failedAttempt('401 Unauthorized: invalid api key');
      listener!({ type: 'agent_settled' });

      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe(CoworkErrorKind.AuthExpired);
      expect(systemErrorMessages()).toHaveLength(1);
      expect(emittedMessages.filter(message => message.type === 'system')).toHaveLength(1);
      expect(completes).toHaveLength(0);
    });

    it('classifies an image capability mismatch and cancels the SDK retry', async () => {
      await adapter.startSession('test', 'Hi');

      listener!({ type: 'turn_start' });
      failedAttempt(
        '500 {"code":500,"message":"image input is not supported - hint: the mmproj file is missing","type":"server_error"}',
      );

      // The stored capability verdict is never rewritten: the rejection stays a
      // runtime observation (see piImageInputFallback) so the user's own setting
      // survives, and the SDK retry is cancelled because retrying cannot help.
      expect(errors).toHaveLength(0);
      listener!({ type: 'auto_retry_start', attempt: 1 });
      await Promise.resolve();
      expect(mockSession.abort).toHaveBeenCalledOnce();
      listener!({ type: 'agent_settled' });

      expect(errors).toHaveLength(1);
      expect(errors[0].kind).toBe(CoworkErrorKind.ModelCapabilityUnsupported);
      expect(systemErrorMessages()).toHaveLength(1);
      expect(completes).toHaveLength(0);
    });

    it('retries an image-carrying turn as text after the server rejects the payload', async () => {
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

      await adapter.startSession('image-retry', 'Describe this image', {
        imageAttachments: [
          {
            name: 'example.png',
            mimeType: 'image/png',
            base64Data: 'aW1hZ2U=',
            path: 'C:\\cowork-images\\s\\hash.png',
          },
        ],
      });
      expect(mockSession.sendUserMessage).toHaveBeenCalledTimes(1);

      listener!({ type: 'turn_start' });
      failedAttempt(
        '400: {"message":"this server was started without the vision encoder (run setup again and choose \'vision\'), so it cannot read images"}',
      );
      listener!({ type: 'agent_settled' });

      // Instead of a dead end: one text-only retry whose prompt carries the file
      // path, plus a system notice explaining what happened.
      await vi.waitFor(() => expect(mockSession.prompt).toHaveBeenCalledTimes(1));
      const [retryPrompt] = mockSession.prompt.mock.calls[0] as [string];
      expect(retryPrompt).toContain('Describe this image');
      expect(retryPrompt).toContain('C:\\cowork-images\\s\\hash.png');
      expect(errors).toHaveLength(0);
      expect(systemErrorMessages()).toHaveLength(1);
      // The retried session no longer advertises image input to Pi: every image
      // source (attachments, native `read` results, replayed history) is
      // downgraded by the SDK, so a `read` cannot re-send the rejected payload.
      expect(activePiModel(adapter, 'image-retry')?.input).toEqual(['text']);
    });

    it('retries an image-only turn as text when the server rejects the payload', async () => {
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

      // A submission with an image and no text at all is a normal turn.
      await adapter.startSession('image-only', '', {
        imageAttachments: [
          {
            name: 'example.png',
            mimeType: 'image/png',
            base64Data: 'aW1hZ2U=',
            path: 'C:\\cowork-images\\s\\hash.png',
          },
        ],
      });
      expect(mockSession.sendUserMessage).toHaveBeenCalledTimes(1);

      listener!({ type: 'turn_start' });
      failedAttempt(
        '400: {"message":"this server was started without the vision encoder (run setup again and choose \'vision\'), so it cannot read images"}',
      );
      listener!({ type: 'agent_settled' });

      // Without the text dependency the rejection is still classified, so the
      // turn is retried once with the file path instead of dying.
      await vi.waitFor(() => expect(mockSession.prompt).toHaveBeenCalledTimes(1));
      const [retryPrompt] = mockSession.prompt.mock.calls[0] as [string];
      expect(retryPrompt).toContain('C:\\cowork-images\\s\\hash.png');
      expect(retryPrompt).toContain('not sent');
      expect(errors).toHaveLength(0);
      expect(systemErrorMessages()).toHaveLength(1);
      expect(activePiModel(adapter, 'image-only')?.input).toEqual(['text']);
    });

    it('restores image input on open sessions when the capability is cleared', async () => {
      const restore = stubRawApiConfig(VISION_MODEL_RESOLUTION);
      try {
        await adapter.startSession('live-image', 'Describe this image', {
          imageAttachments: [
            {
              name: 'example.png',
              mimeType: 'image/png',
              base64Data: 'aW1hZ2U=',
              path: 'C:\\cowork-images\\s\\hash.png',
            },
          ],
        });
        listener!({ type: 'turn_start' });
        failedAttempt(VISION_400);
        listener!({ type: 'agent_settled' });
        await vi.waitFor(() => expect(mockSession.prompt).toHaveBeenCalledTimes(1));
        expect(activePiModel(adapter, 'live-image')?.input).toEqual(['text']);

        // The user fixed the server and edited provider settings: the live
        // session must stop downgrading images, not just the observation map.
        await adapter.resetImageInputCapabilities();
        expect(activePiModel(adapter, 'live-image')?.input).toEqual(['text', 'image']);
        expect(mockSession.setModel).toHaveBeenCalled();
      } finally {
        restore();
      }
    });

    it('applies a recorded rejection to other open sessions of the same model', async () => {
      const restore = stubRawApiConfig(VISION_MODEL_RESOLUTION);
      try {
        await adapter.startSession('peer-a', 'Describe this image', {
          imageAttachments: [
            {
              name: 'a.png',
              mimeType: 'image/png',
              base64Data: 'aW1hZ2U=',
              path: 'C:\\cowork-images\\s\\a.png',
            },
          ],
        });
        // The mock's subscribe hands every session the same listener, so the
        // last session created owns the events the failure is driven through.
        await adapter.startSession('peer-b', 'Describe this image', {
          imageAttachments: [
            {
              name: 'b.png',
              mimeType: 'image/png',
              base64Data: 'aW1hZ2U=',
              path: 'C:\\cowork-images\\s\\b.png',
            },
          ],
        });

        listener!({ type: 'turn_start' });
        failedAttempt(VISION_400);
        listener!({ type: 'agent_settled' });

        // peer-a never sent anything wrong, but its Pi snapshot still advertised
        // image input, so its own `read` would re-send the refused payload.
        await vi.waitFor(() => expect(activePiModel(adapter, 'peer-a')?.input).toEqual(['text']));
      } finally {
        restore();
      }
    });

    it('starts sending images on open sessions once the capability is enabled', async () => {
      const restore = stubRawApiConfig(UNKNOWN_MODEL_RESOLUTION);
      try {
        await adapter.startSession('cfg-enabled', 'Describe this image', {
          imageAttachments: [
            {
              name: 'example.png',
              mimeType: 'image/png',
              base64Data: 'aW1hZ2U=',
              path: 'C:\\cowork-images\\s\\hash.png',
            },
          ],
        });
        expect(mockSession.sendUserMessage).not.toHaveBeenCalled();
        expect(activePiModel(adapter, 'cfg-enabled')?.input).toEqual(['text']);

        // The user enables image input on this model in the settings.
        stubRawApiConfig(VISION_MODEL_RESOLUTION);
        await adapter.resetImageInputCapabilities();
        expect(activePiModel(adapter, 'cfg-enabled')?.input).toEqual(['text', 'image']);

        await adapter.continueSession('cfg-enabled', '再看一张', {
          imageAttachments: [
            {
              name: 'second.png',
              mimeType: 'image/png',
              base64Data: 'aW1hZ2U=',
              path: 'C:\\cowork-images\\s\\second.png',
            },
          ],
        });
        // The bytes travel again without a new session or an app restart.
        expect(mockSession.sendUserMessage).toHaveBeenCalledTimes(1);
      } finally {
        restore();
      }
    });

    it('stops sending images on open sessions once the capability is disabled', async () => {
      const restore = stubRawApiConfig(VISION_MODEL_RESOLUTION);
      try {
        await adapter.startSession('cfg-disabled', 'Describe this image', {
          imageAttachments: [
            {
              name: 'example.png',
              mimeType: 'image/png',
              base64Data: 'aW1hZ2U=',
              path: 'C:\\cowork-images\\s\\hash.png',
            },
          ],
        });
        expect(mockSession.sendUserMessage).toHaveBeenCalledTimes(1);

        // The user marks the model as text-only (or moves it to a server
        // without a vision encoder) and saves.
        stubRawApiConfig(TEXT_ONLY_MODEL_RESOLUTION);
        await adapter.resetImageInputCapabilities();
        expect(activePiModel(adapter, 'cfg-disabled')?.input).toEqual(['text']);

        await adapter.continueSession('cfg-disabled', '再看一张', {
          imageAttachments: [
            {
              name: 'second.png',
              mimeType: 'image/png',
              base64Data: 'aW1hZ2U=',
              path: 'C:\\cowork-images\\s\\second.png',
            },
          ],
        });
        // The session keeps its context, but the image stays out of the request.
        expect(mockSession.sendUserMessage).toHaveBeenCalledTimes(1);
        const [sentPrompt] = mockSession.prompt.mock.calls.at(-1) as [string];
        expect(sentPrompt).toContain('C:\\cowork-images\\s\\second.png');
      } finally {
        restore();
      }
    });
  });
});
