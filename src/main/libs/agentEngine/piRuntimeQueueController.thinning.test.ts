import { describe, expect, it, vi, beforeEach } from 'vitest';
import { CoworkQueueDelivery } from '../../../shared/cowork/pendingMessageQueue';
import { ImageInputVerdict } from './piImageInputFallback';
import { PiRuntimeQueueController } from './piRuntimeQueueController';
import type { ActivePiSession } from './piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from './piRuntimeAdapterHost';

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
      addMessage: vi.fn((_id: string, msg: any) => msg),
    };

    mockHost = {
      activeSessions: new Map([[sessionId, activeSession]]),
      isSessionRunning: vi.fn((id: string) => id === sessionId && activeSession.isRunning),
      isSessionActive: vi.fn((id: string) => id === sessionId && !activeSession.aborted),
      isStoredSessionWorkMode: vi.fn(() => true),
      persistImageAttachments: vi.fn((_id: string, imgs: any) => imgs),
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
    it('enqueues metadata in sidecar and delegates prompt dispatch to Pi native followUp', () => {
      const result = queueController.enqueuePendingMessage(
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
      expect(mockPiSession.sendUserMessage).toHaveBeenCalledWith(expect.anything(), {
        deliverAs: 'followUp',
      });
    });

    it('rejects enqueue when session is not in work mode or not running', () => {
      activeSession.isRunning = false;
      const result = queueController.enqueuePendingMessage(sessionId, 'Should fail');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not running');
    });
  });

  describe('onNativeUserMessageStart sidecar synchronization', () => {
    it('pops pending follow-up from sidecar and persists to SQLite upon native user message start', () => {
      const enqueued = queueController.enqueuePendingMessage(sessionId, 'Queued item');
      expect(enqueued.success).toBe(true);

      expect(queueController.list(sessionId)).toHaveLength(1);

      // Simulate Pi emitting message_start for user
      queueController.onNativeUserMessageStart(sessionId, activeSession);

      // Sidecar item is taken and finished
      expect(queueController.list(sessionId)).toHaveLength(0);
      expect(mockStore.addMessage).toHaveBeenCalledWith(
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
      queueController.onNativeUserMessageStart(sessionId, activeSession);

      // No message added since direct prompt is already saved prior to dispatch
      expect(mockStore.addMessage).not.toHaveBeenCalled();
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
