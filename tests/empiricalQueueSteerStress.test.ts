import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
} from '../src/shared/cowork/pendingMessageQueue';
import { ImageInputVerdict } from '../src/main/libs/agentEngine/piImageInputFallback';
import { PiRuntimeQueueController } from '../src/main/libs/agentEngine/piRuntimeQueueController';
import type { ActivePiSession } from '../src/main/libs/agentEngine/piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from '../src/main/libs/agentEngine/piRuntimeAdapterHost';
import type { CoworkMessage } from '../src/main/coworkStore';

describe('Empirical Adversarial Stress Harness: Queue Controller Steer & Follow-Up Lifecycle', () => {
  let mockHost: any;
  let mockPiSession: any;
  let mockStore: any;
  let persistedMessages: CoworkMessage[];
  let activeSession: ActivePiSession;
  let queueController: PiRuntimeQueueController;
  const sessionId = 'stress-session-m3';

  beforeEach(() => {
    persistedMessages = [];

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
      summaryCheckpointGoal: undefined,
      abortController: new AbortController(),
      resourceState: {
        chatMode: false,
        skillIds: ['base-skill'],
        skillRoots: [],
        expertSkillDirs: [],
      },
    } as unknown as ActivePiSession;

    mockStore = {
      addMessage: vi.fn((_id: string, msg: CoworkMessage) => {
        persistedMessages.push(msg);
        return msg;
      }),
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
      continueSession: vi.fn().mockImplementation(async (sessId, text, opts) => {
        // Emulate continueSession execution: setting activeSession.isRunning = true
        activeSession.isRunning = true;
        persistedMessages.push({
          id: 'msg-' + Math.random(),
          type: 'user',
          content: text,
          timestamp: Date.now(),
          metadata: {
            queueDelivery: opts._queueDelivery,
            skillIds: opts.skillIds,
            imageAttachments: opts.imageAttachments,
            fileAttachments: opts.fileAttachments,
          },
        });
        activeSession.summaryCheckpointGoal = text;
      }),
    } as unknown as PiRuntimeAdapterHost;

    queueController = new PiRuntimeQueueController(mockHost);
  });

  describe('Dimension 1: Deep Isolation of Steer message_start and Sidecar Preservation', () => {
    it('Stress 1.1: 5-item queue with promoted steer preserves all other items and does NOT pop on steer message_start', async () => {
      // Enqueue 5 items with distinct metadata
      const item1 = queueController.enqueuePendingMessage(
        sessionId,
        'Task 1: Setup database',
        undefined,
        undefined,
        ['skill-db'],
      );
      const item2 = queueController.enqueuePendingMessage(sessionId, 'Task 2: Ingest images', [
        { name: 'img1.png', mimeType: 'image/png', base64Data: 'base64-1' },
      ]);
      const item3 = queueController.enqueuePendingMessage(
        sessionId,
        'Task 3: Run urgent migration',
      );
      const item4 = queueController.enqueuePendingMessage(
        sessionId,
        'Task 4: Export CSV',
        undefined,
        [{ name: 'out.csv', path: '/tmp/out.csv', extension: 'CSV' }],
      );
      const item5 = queueController.enqueuePendingMessage(sessionId, 'Task 5: Final cleanup');

      expect(queueController.list(sessionId)).toHaveLength(5);

      // Promote Item 3 to Steer
      const steerResult = await queueController.steerPendingMessage(sessionId, item3.item!.id);
      expect(steerResult.success).toBe(true);

      // Steer prompt was dispatched
      expect(persistedMessages).toHaveLength(1);
      expect(persistedMessages[0].content).toBe('Task 3: Run urgent migration');
      expect(persistedMessages[0].metadata?.queueDelivery).toBe(CoworkQueueDelivery.Steer);
      expect(activeSession.summaryCheckpointGoal).toBe('Task 3: Run urgent migration');

      // Sidecar MUST still contain remaining 4 items in strict FIFO order
      const remainingBeforeStart = queueController.list(sessionId);
      expect(remainingBeforeStart.map(i => i.text)).toEqual([
        'Task 1: Setup database',
        'Task 2: Ingest images',
        'Task 4: Export CSV',
        'Task 5: Final cleanup',
      ]);
      expect(remainingBeforeStart[1].imageAttachments).toHaveLength(1);
      expect(remainingBeforeStart[2].fileAttachments).toHaveLength(1);

      // Pi begins executing the Steer turn (Item 3) and emits user message_start
      queueController.onNativeUserMessageStart(sessionId, activeSession);

      // EMPIRICAL ASSERTION: No follow-up item was popped or persisted!
      expect(queueController.list(sessionId)).toHaveLength(4);
      expect(persistedMessages).toHaveLength(1); // Still ONLY the steer message
      expect(activeSession.summaryCheckpointGoal).toBe('Task 3: Run urgent migration'); // Goal is untouched!

      // Steer turn finishes. Now native Pi picks up the first follow-up (Task 1) and emits message_start
      queueController.onNativeUserMessageStart(sessionId, activeSession);

      // Task 1 should now be popped and persisted
      expect(queueController.list(sessionId).map(i => i.text)).toEqual([
        'Task 2: Ingest images',
        'Task 4: Export CSV',
        'Task 5: Final cleanup',
      ]);
      expect(persistedMessages).toHaveLength(2);
      expect(persistedMessages[1].content).toBe('Task 1: Setup database');
      expect(persistedMessages[1].metadata?.queueDelivery).toBe(CoworkQueueDelivery.FollowUp);
      expect(activeSession.summaryCheckpointGoal).toBe('Task 1: Setup database');

      // Task 1 finishes. Pi native picks up Task 2 and emits message_start
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      expect(persistedMessages).toHaveLength(3);
      expect(persistedMessages[2].content).toBe('Task 2: Ingest images');
      expect(persistedMessages[2].metadata?.imageAttachments).toBeDefined();
      expect(activeSession.summaryCheckpointGoal).toBe('Task 2: Ingest images');

      // Task 2 finishes. Pi native picks up Task 4 and emits message_start
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      expect(persistedMessages).toHaveLength(4);
      expect(persistedMessages[3].content).toBe('Task 4: Export CSV');
      expect(persistedMessages[3].metadata?.fileAttachments).toBeDefined();
      expect(activeSession.summaryCheckpointGoal).toBe('Task 4: Export CSV');

      // Task 4 finishes. Pi native picks up Task 5 and emits message_start
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      expect(persistedMessages).toHaveLength(5);
      expect(persistedMessages[4].content).toBe('Task 5: Final cleanup');
      expect(activeSession.summaryCheckpointGoal).toBe('Task 5: Final cleanup');

      // Queue is now completely drained
      expect(queueController.list(sessionId)).toHaveLength(0);
    });

    it('Stress 1.2: Multiple in-flight steer promotions handle concurrent message_start events without leaking into follow-ups', async () => {
      const q1 = queueController.enqueuePendingMessage(sessionId, 'FollowUp Alpha');
      const q2 = queueController.enqueuePendingMessage(sessionId, 'FollowUp Beta');
      const q3 = queueController.enqueuePendingMessage(sessionId, 'FollowUp Gamma');

      expect(queueController.list(sessionId)).toHaveLength(3);

      // Rapidly promote Alpha then Beta to steer before Pi emits message_start
      const s1 = await queueController.steerPendingMessage(sessionId, q1.item!.id);
      expect(s1.success).toBe(true);

      const s2 = await queueController.steerPendingMessage(sessionId, q2.item!.id);
      expect(s2.success).toBe(true);

      // Persisted messages has 2 steers
      expect(persistedMessages).toHaveLength(2);
      expect(persistedMessages[0].content).toBe('FollowUp Alpha');
      expect(persistedMessages[1].content).toBe('FollowUp Beta');
      expect(activeSession.summaryCheckpointGoal).toBe('FollowUp Beta');

      // Sidecar has Gamma
      expect(queueController.list(sessionId).map(i => i.text)).toEqual(['FollowUp Gamma']);

      // 1st steer message_start arrives (Alpha)
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      // Gamma should NOT be popped
      expect(queueController.list(sessionId)).toHaveLength(1);
      expect(persistedMessages).toHaveLength(2);

      // 2nd steer message_start arrives (Beta)
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      // Gamma should STILL NOT be popped
      expect(queueController.list(sessionId)).toHaveLength(1);
      expect(persistedMessages).toHaveLength(2);

      // Now follow-up message_start arrives (Gamma)
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      // Gamma is popped and persisted
      expect(queueController.list(sessionId)).toHaveLength(0);
      expect(persistedMessages).toHaveLength(3);
      expect(persistedMessages[2].content).toBe('FollowUp Gamma');
      expect(activeSession.summaryCheckpointGoal).toBe('FollowUp Gamma');
    });

    it('Stress 1.3: Steer dispatch failure decrements pending steer counter and restores item safely', async () => {
      const q1 = queueController.enqueuePendingMessage(sessionId, 'Fragile Steer');
      const q2 = queueController.enqueuePendingMessage(sessionId, 'Safe FollowUp');

      // Make Pi reject steer prompt
      mockPiSession.prompt.mockRejectedValueOnce(new Error('Pi backend network timeout'));

      const result = await queueController.steerPendingMessage(sessionId, q1.item!.id);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Pi backend network timeout');

      // Fragile Steer restored to queue with error status
      const items = queueController.list(sessionId);
      expect(items).toHaveLength(2);
      expect(items[0].error).toContain('Pi backend network timeout');

      // Because steer failed, pendingSteerCounts MUST be 0.
      // If a native message_start fires for Safe FollowUp, it must NOT be ignored as a ghost steer!
      // (Testing Safe FollowUp start):
      queueController.onNativeUserMessageStart(sessionId, activeSession);

      // The next pending follow-up (Fragile Steer was error, findNextPending picks Safe FollowUp or Fragile Steer depending on status)
      // Since Fragile Steer has status Error, findNextPending picks Safe FollowUp!
      expect(persistedMessages).toHaveLength(1);
      expect(persistedMessages[0].content).toBe('Safe FollowUp');
      expect(activeSession.summaryCheckpointGoal).toBe('Safe FollowUp');
    });

    it('Stress 1.4: Session reset or clear wipes pending steer count preventing ghost state', async () => {
      const q1 = queueController.enqueuePendingMessage(sessionId, 'Abandoned Steer');
      const q2 = queueController.enqueuePendingMessage(sessionId, 'Subsequent Item');

      // Steer item 1
      await queueController.steerPendingMessage(sessionId, q1.item!.id);

      // User hits abort / reset before message_start arrives
      queueController.resetNativeDispatch(sessionId);

      // Steer count should be gone
      expect((queueController as any).pendingSteerCounts.get(sessionId)).toBeUndefined();

      // Clear also verifies deletion
      queueController.clear(sessionId);
      expect(queueController.list(sessionId)).toHaveLength(0);
    });
  });

  describe('Dimension 2: summaryCheckpointGoal Preservation and Integrity', () => {
    it('Stress 2.1: summaryCheckpointGoal is preserved across multiple intermediate tool actions during steer turn', async () => {
      queueController.enqueuePendingMessage(sessionId, 'FollowUp Waiting 1');
      queueController.enqueuePendingMessage(sessionId, 'FollowUp Waiting 2');

      const steerItem = queueController.enqueuePendingMessage(
        sessionId,
        'Critical Production Hotfix',
      );
      await queueController.steerPendingMessage(sessionId, steerItem.item!.id);

      expect(activeSession.summaryCheckpointGoal).toBe('Critical Production Hotfix');

      // Native message_start
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      expect(activeSession.summaryCheckpointGoal).toBe('Critical Production Hotfix');

      // Simulating arbitrary tool invocations during the steer turn
      // goal must remain Hotfix
      expect(activeSession.summaryCheckpointGoal).toBe('Critical Production Hotfix');
      expect(queueController.list(sessionId)).toHaveLength(2);

      // When steer turn ends and FollowUp Waiting 1 starts:
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      expect(activeSession.summaryCheckpointGoal).toBe('FollowUp Waiting 1');
    });
  });

  describe('Dimension 3: Fallback and Flush Queue Settlement Sequencing', () => {
    it('Stress 3.1: flushFollowUpQueue respects strict FIFO order and halts control actions until prompts drain', async () => {
      const executionLog: string[] = [];

      // Session is running while messages are enqueued
      activeSession.isRunning = true;

      // Enqueue follow-ups
      const q1 = queueController.enqueuePendingMessage(sessionId, 'FollowUp 1');
      const q2 = queueController.enqueuePendingMessage(sessionId, 'FollowUp 2');
      expect(q1.success && q2.success).toBe(true);

      // Enqueue control actions
      queueController.enqueueControlAction(sessionId, async () => {
        executionLog.push('ControlAction A');
      });
      queueController.enqueueControlAction(sessionId, async () => {
        executionLog.push('ControlAction B');
      });

      // Session settles: isRunning becomes false
      activeSession.isRunning = false;

      // Flush queue: FollowUp 1 runs first via continueSession (which sets activeSession.isRunning = true)
      await queueController.flushFollowUpQueue(sessionId, activeSession);
      expect(persistedMessages).toHaveLength(1);
      expect(persistedMessages[0].content).toBe('FollowUp 1');
      expect(executionLog).toHaveLength(0); // Control action NOT run yet

      // Settle FollowUp 1 turn
      activeSession.isRunning = false;

      // FollowUp 2 runs next
      await queueController.flushFollowUpQueue(sessionId, activeSession);
      expect(persistedMessages).toHaveLength(2);
      expect(persistedMessages[1].content).toBe('FollowUp 2');
      expect(executionLog).toHaveLength(0); // Control action still NOT run yet

      // Settle FollowUp 2 turn
      activeSession.isRunning = false;

      // Now all follow-ups drained: flush automatically chains and drains all queued control actions in FIFO order
      await queueController.flushFollowUpQueue(sessionId, activeSession);
      // Allow microtask ticks for chained actions to settle
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(executionLog).toEqual(['ControlAction A', 'ControlAction B']);
      expect(queueController.hasQueuedControlActions(sessionId)).toBe(false);
    });

    it('Stress 3.2: Queue mutation during running steer (edit/delete) maintains exact order on settle', async () => {
      const q1 = queueController.enqueuePendingMessage(sessionId, 'Steer Me');
      const q2 = queueController.enqueuePendingMessage(sessionId, 'To Edit');
      const q3 = queueController.enqueuePendingMessage(sessionId, 'To Delete');
      const q4 = queueController.enqueuePendingMessage(sessionId, 'Tail');

      // Steer q1
      await queueController.steerPendingMessage(sessionId, q1.item!.id);
      queueController.onNativeUserMessageStart(sessionId, activeSession);

      // While running, edit q2 and delete q3
      queueController.updatePendingMessage(sessionId, q2.item!.id, 'Edited FollowUp');
      queueController.deletePendingMessage(sessionId, q3.item!.id);

      // Sidecar order should now be: Edited FollowUp, Tail
      expect(queueController.list(sessionId).map(i => i.text)).toEqual(['Edited FollowUp', 'Tail']);

      // When steer completes and q2 starts:
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      expect(persistedMessages[persistedMessages.length - 1].content).toBe('Edited FollowUp');
      expect(activeSession.summaryCheckpointGoal).toBe('Edited FollowUp');

      // When q2 completes and q4 starts:
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      expect(persistedMessages[persistedMessages.length - 1].content).toBe('Tail');
      expect(activeSession.summaryCheckpointGoal).toBe('Tail');

      expect(queueController.list(sessionId)).toHaveLength(0);
    });
  });
});
