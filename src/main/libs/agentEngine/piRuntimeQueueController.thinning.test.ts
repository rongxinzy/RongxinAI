import path from 'node:path';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
} from '../../../shared/cowork/pendingMessageQueue';
import { ImageInputVerdict } from './piImageInputFallback';
import { PiRuntimeQueueController } from './piRuntimeQueueController';
import type { ActivePiSession } from './piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';
import { readCoworkImageAsync } from '../../workbenchTask/artifactWorkerPool';

vi.mock('../../workbenchTask/artifactWorkerPool', () => ({ readCoworkImageAsync: vi.fn() }));

describe('PiRuntimeQueueController thinning & native delegation', () => {
  let mockHost: any;
  let mockPiSession: any;
  let mockStore: any;
  let activeSession: ActivePiSession;
  let queueController: PiRuntimeQueueController;
  const sessionId = 'test-session-thinning';

  beforeEach(() => {
    mockPiSession = {
      prompt: vi.fn().mockResolvedValue(undefined),
      sendUserMessage: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue('queued'),
      clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
    };

    activeSession = {
      sessionId,
      piSession: mockPiSession,
      isRunning: true,
      aborted: false,
      abortController: new AbortController(),
      resourceState: {
        chatMode: false,
        skillIds: ['skill-1'],
        skillRoots: [],
        expertSkillDirs: [],
      },
    } as unknown as ActivePiSession;

    mockStore = {
      messages: { addMessage: vi.fn((_id: string, msg: any) => msg) },
    };

    mockHost = {
      activeSessions: new Map([[sessionId, activeSession]]),
      isSessionRunning: vi.fn((id: string) => id === sessionId && activeSession.isRunning),
      isSessionActive: vi.fn((id: string) => id === sessionId && !activeSession.aborted),
      isStoredSessionWorkMode: vi.fn(() => true),
      persistImageAttachments: vi.fn(async (_id: string, imgs: unknown) => imgs),
      recovery: {
        imageInputVerdictForActive: vi.fn(() => ImageInputVerdict.Supported),
        reportOmittedImages: vi.fn(),
      },
      getOcrCommandFor: vi.fn(),
      getStore: vi.fn(() => mockStore),
      emit: vi.fn(),
      continueSession: vi.fn().mockResolvedValue(undefined),
    } as unknown as PiRuntimeAdapterHost;

    queueController = new PiRuntimeQueueController(mockHost);
  });

  describe('native delegation of follow-ups', () => {
    it('enqueues metadata in sidecar and delegates prompt dispatch to Pi native followUp', async () => {
      const result = await queueController.enqueuePendingMessage(
        sessionId,
        'Process file data',
        [{ name: 'input.png', mimeType: 'image/png', base64Data: 'data' }],
        [{ name: 'data.csv', path: '/workspace/data.csv', extension: 'CSV' }],
        ['skill-csv'],
      );

      expect(result.success).toBe(true);
      expect(result.item).toBeDefined();
      expect(result.item?.text).toBe('Process file data');
      expect(result.item?.delivery).toBe(CoworkQueueDelivery.FollowUp);
      expect(result.item?.fileAttachments?.[0].name).toBe('data.csv');

      // Sidecar list contains the item
      const list = queueController.list(sessionId);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(result.item?.id);

      // Verify native send called with followUp
      expect(mockPiSession.followUp).toHaveBeenCalledWith('Process file data', expect.any(Array), {
        onQueued: expect.any(Function),
      });
    });

    it('rejects enqueue before writing an image when the session is not running', async () => {
      activeSession.isRunning = false;
      const result = await queueController.enqueuePendingMessage(sessionId, 'Should fail', [
        { name: 'input.png', mimeType: 'image/png', base64Data: 'data' },
      ]);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not running');
      expect(mockHost.persistImageAttachments).not.toHaveBeenCalled();
    });

    it('dispatches a text follow-up after the preceding image finishes saving', async () => {
      const image = { name: 'input.png', mimeType: 'image/png', base64Data: 'data' };
      const writing = Promise.withResolvers<[typeof image]>();
      mockHost.persistImageAttachments.mockReturnValueOnce(writing.promise);

      const first = queueController.enqueuePendingMessage(sessionId, 'First image', [image]);
      const second = queueController.enqueuePendingMessage(sessionId, 'Second text');
      expect(mockPiSession.followUp).not.toHaveBeenCalled();
      writing.resolve([image]);

      await expect(Promise.all([first, second])).resolves.toEqual([
        expect.objectContaining({ success: true }),
        expect.objectContaining({ success: true }),
      ]);
      expect(mockPiSession.followUp.mock.calls.map(([text]: [string]) => text)).toEqual([
        'First image',
        'Second text',
      ]);
    });

    it('does not send an image whose turn was stopped while saving it', async () => {
      const image = { name: 'input.png', mimeType: 'image/png', base64Data: 'data' };
      const writing = Promise.withResolvers<[typeof image]>();
      mockHost.persistImageAttachments.mockReturnValueOnce(writing.promise);
      const pending = queueController.enqueuePendingMessage(sessionId, 'Pending image', [image]);

      activeSession.abortController.abort();
      queueController.clear(sessionId);
      writing.resolve([image]);

      await expect(pending).resolves.toMatchObject({ success: false });
      expect(mockPiSession.followUp).not.toHaveBeenCalled();
      expect(queueController.list(sessionId)).toEqual([]);
    });

    it('keeps later text behind a pending file read and publishes only prepared queue items', async () => {
      const image = { name: 'input.png', mimeType: 'image/png', path: path.resolve('input.png') };
      const reading = Promise.withResolvers<void>();
      const bytes = Promise.withResolvers<string>();
      vi.mocked(readCoworkImageAsync).mockImplementationOnce(() => {
        reading.resolve();
        return bytes.promise;
      });
      const first = queueController.enqueuePendingMessage(sessionId, 'First image', [image]);
      await reading.promise;
      const second = queueController.enqueuePendingMessage(sessionId, 'Second text');

      expect(mockPiSession.followUp).not.toHaveBeenCalled();
      expect(queueController.list(sessionId)).toEqual([]);
      bytes.resolve('aW1hZ2U=');

      await Promise.all([first, second]);
      expect(mockPiSession.followUp).toHaveBeenNthCalledWith(
        1,
        'First image',
        [{ type: 'image', mimeType: 'image/png', data: 'aW1hZ2U=' }],
        expect.any(Object),
      );
      expect(mockPiSession.followUp).toHaveBeenNthCalledWith(
        2,
        'Second text',
        undefined,
        expect.any(Object),
      );
    });

    it('fails a draft whose native input processing finishes after its submitting turn', async () => {
      const inputProcessing = Promise.withResolvers<void>();
      mockPiSession.followUp.mockImplementationOnce(async (text, _images, options) => {
        await inputProcessing.promise;
        options.onQueued({ role: 'user', content: text });
        return 'queued';
      });
      expect((await queueController.enqueuePendingMessage(sessionId, 'late draft')).success).toBe(
        true,
      );
      activeSession.submissionToken = Symbol('next submission');
      inputProcessing.resolve();

      await vi.waitFor(() =>
        expect(queueController.list(sessionId)).toEqual([
          expect.objectContaining({ text: 'late draft', status: CoworkQueueItemStatus.Failed }),
        ]),
      );
      expect(mockStore.messages.addMessage).not.toHaveBeenCalled();
    });
  });

  describe('onNativeUserMessageStart sidecar synchronization', () => {
    it('pops pending follow-up from sidecar and persists to SQLite upon native user message start', async () => {
      const enqueued = await queueController.enqueuePendingMessage(sessionId, 'Queued item');
      expect(enqueued.success).toBe(true);

      expect(queueController.list(sessionId)).toHaveLength(1);

      // Simulate Pi emitting message_start for user
      const message = { role: 'user', content: 'Queued item' };
      mockPiSession.followUp.mock.calls[0][2].onQueued(message);
      queueController.onNativeUserMessageStart(sessionId, activeSession, message);

      // Sidecar item is taken and finished
      expect(queueController.list(sessionId)).toHaveLength(0);
      expect(mockStore.messages.addMessage).toHaveBeenCalledWith(
        sessionId,
        expect.objectContaining({
          type: 'user',
          content: 'Queued item',
          metadata: expect.objectContaining({ queueDelivery: CoworkQueueDelivery.FollowUp }),
        }),
      );
    });

    it('ignores direct user prompts when no follow-up is pending in sidecar without duplicate persistence', () => {
      expect(queueController.list(sessionId)).toHaveLength(0);

      // Fire message_start for direct prompt
      queueController.onNativeUserMessageStart(sessionId, activeSession, {
        role: 'user',
        content: 'Direct prompt',
      });

      // No message added since direct prompt is already saved prior to dispatch
      expect(mockStore.messages.addMessage).not.toHaveBeenCalled();
    });

    it('keeps an accepted native input projectable when Pi drains it in the next run', () => {
      queueController.enqueuePendingMessage(sessionId, 'retained native follow-up');
      const message = { role: 'user', content: 'retained native follow-up' };
      mockPiSession.followUp.mock.calls[0][2].onQueued(message);
      activeSession.submissionToken = Symbol('next submission');
      queueController.onNativeUserMessageStart(sessionId, activeSession, message);

      expect(queueController.list(sessionId)).toEqual([]);
      expect(mockStore.messages.addMessage).toHaveBeenCalledExactlyOnceWith(
        sessionId,
        expect.objectContaining({ content: 'retained native follow-up' }),
      );
    });
  });

  describe('control actions lifecycle', () => {
    it('executes queued control actions sequentially when turns settle', async () => {
      const executionOrder: number[] = [];
      activeSession.isRunning = true;

      queueController.enqueueControlAction(sessionId, async () => {
        executionOrder.push(1);
      });
      queueController.enqueueControlAction(sessionId, async () => {
        executionOrder.push(2);
      });

      expect(queueController.hasQueuedControlActions(sessionId)).toBe(true);

      // Settle run
      activeSession.isRunning = false;
      await queueController.flushControlActions(sessionId, activeSession);

      expect(executionOrder).toEqual([1, 2]);
      expect(queueController.hasQueuedControlActions(sessionId)).toBe(false);
    });

    it('drops control actions when a turn fails', async () => {
      activeSession.isRunning = true;

      queueController.enqueueControlAction(sessionId, async () => {});
      expect(queueController.hasQueuedControlActions(sessionId)).toBe(true);

      // Settle run with failure
      activeSession.isRunning = false;
      activeSession.turnFailed = true;

      await queueController.flushControlActions(sessionId, activeSession);

      expect(queueController.hasQueuedControlActions(sessionId)).toBe(false);
    });
  });

  describe('clear queue', () => {
    it('clears sidecar metadata without mutating Pi queues', () => {
      queueController.enqueuePendingMessage(sessionId, 'Queued 1');
      queueController.enqueuePendingMessage(sessionId, 'Queued 2');
      expect(queueController.list(sessionId)).toHaveLength(2);

      queueController.clear(sessionId);

      expect(mockPiSession.clearQueue).not.toHaveBeenCalled();
      expect(queueController.list(sessionId)).toHaveLength(0);
    });
  });
});
