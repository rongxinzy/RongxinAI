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
        recordImagePrompt: vi.fn(),
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

  describe('steer promotion with clean native clear and follow-up re-enqueue', () => {
    it('clears Pi native queue, dispatches steer prompt, and re-enqueues remaining follow-ups preserving attachments', async () => {
      // Enqueue two follow-ups
      const first = queueController.enqueuePendingMessage(
        sessionId,
        'Follow-up 1',
        undefined,
        undefined,
        ['s1'],
      );
      const second = queueController.enqueuePendingMessage(sessionId, 'Follow-up 2 with image', [
        { name: 'chart.png', mimeType: 'image/png', base64Data: 'abc' },
      ]);
      expect(first.success && second.success).toBe(true);

      mockPiSession.clearQueue.mockClear();
      mockPiSession.sendUserMessage.mockClear();
      mockPiSession.prompt.mockClear();

      // Steer the first item
      const steerResult = await queueController.steerPendingMessage(sessionId, first.item!.id);
      expect(steerResult.success).toBe(true);

      // 1. Cleared native queue
      expect(mockPiSession.clearQueue).toHaveBeenCalled();

      // 2. Prompt sent as steer
      expect(mockPiSession.prompt).toHaveBeenCalledWith('Follow-up 1', {
        streamingBehavior: 'steer',
      });

      // 3. Remaining follow-up 2 re-enqueued with image preserved
      expect(mockPiSession.sendUserMessage).toHaveBeenCalledWith(expect.anything(), {
        deliverAs: 'followUp',
      });

      // Sidecar only has follow-up 2 now
      const list = queueController.list(sessionId);
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(second.item?.id);
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

    it('does not pop pending follow-ups when an in-flight steer message starts', async () => {
      const first = queueController.enqueuePendingMessage(sessionId, 'Steer candidate');
      const second = queueController.enqueuePendingMessage(sessionId, 'Remaining follow-up');
      expect(first.success && second.success).toBe(true);

      mockStore.addMessage.mockClear();

      // Steer candidate
      await queueController.steerPendingMessage(sessionId, first.item!.id);
      expect(mockStore.addMessage).toHaveBeenCalledTimes(1); // Steer message persisted

      // Now message_start arrives for the steer turn
      queueController.onNativeUserMessageStart(sessionId, activeSession);

      // Remaining follow-up is NOT consumed prematurely
      expect(queueController.list(sessionId)).toHaveLength(1);
      expect(mockStore.addMessage).toHaveBeenCalledTimes(1); // No additional message persisted
      expect(activeSession.summaryCheckpointGoal).toBe('Steer candidate');

      // Subsequent message_start for remaining follow-up consumes it
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      expect(queueController.list(sessionId)).toHaveLength(0);
      expect(mockStore.addMessage).toHaveBeenCalledTimes(2);
      expect(activeSession.summaryCheckpointGoal).toBe('Remaining follow-up');
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
      await queueController.flushFollowUpQueue(sessionId, activeSession);

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

      await queueController.flushFollowUpQueue(sessionId, activeSession);

      expect(queueController.hasQueuedControlActions(sessionId)).toBe(false);
    });
  });

  describe('clear queue', () => {
    it('clears both Pi native queue and sidecar metadata', () => {
      queueController.enqueuePendingMessage(sessionId, 'Queued 1');
      queueController.enqueuePendingMessage(sessionId, 'Queued 2');
      expect(queueController.list(sessionId)).toHaveLength(2);

      queueController.clear(sessionId);

      expect(mockPiSession.clearQueue).toHaveBeenCalled();
      expect(queueController.list(sessionId)).toHaveLength(0);
    });
  });
});
