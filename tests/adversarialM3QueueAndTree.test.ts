import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoworkQueueDelivery } from '../src/shared/cowork/pendingMessageQueue';
import { ImageInputVerdict } from '../src/main/libs/agentEngine/piImageInputFallback';
import { PiRuntimeQueueController } from '../src/main/libs/agentEngine/piRuntimeQueueController';
import type { ActivePiSession } from '../src/main/libs/agentEngine/piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from '../src/main/libs/agentEngine/piRuntimeAdapterHost';
import { PiRuntimeAdapter } from '../src/main/libs/agentEngine/piRuntimeAdapter';

describe('Milestone 3 Adversarial Challenge: Queue, Tree, & Context Edit', () => {
  describe('Dimension 1: Queue Controller Thinning & Steer/Follow-Up Race Conditions', () => {
    let mockHost: any;
    let mockPiSession: any;
    let mockStore: any;
    let activeSession: ActivePiSession;
    let queueController: PiRuntimeQueueController;
    const sessionId = 'adversarial-queue-session';
    const persistedMessages: any[] = [];

    beforeEach(() => {
      persistedMessages.length = 0;
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
        summaryCheckpointGoal: undefined,
        resourceState: {
          chatMode: false,
          skillIds: ['skill-core'],
          skillRoots: [],
          expertSkillDirs: [],
        },
      } as unknown as ActivePiSession;

      mockStore = {
        addMessage: vi.fn((_id: string, msg: any) => {
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
        continueSession: vi.fn().mockResolvedValue(undefined),
      } as unknown as PiRuntimeAdapterHost;

      queueController = new PiRuntimeQueueController(mockHost);
    });

    it('Scenario 1.1: Direct prompts do not cause duplicate SQLite persistence on native message_start', () => {
      expect(queueController.list(sessionId)).toHaveLength(0);

      // A direct prompt starts in Pi: onNativeUserMessageStart should be a no-op
      queueController.onNativeUserMessageStart(sessionId, activeSession);

      expect(mockStore.addMessage).not.toHaveBeenCalled();
      expect(persistedMessages).toHaveLength(0);
    });

    it('Scenario 1.2: Steer promotion with remaining follow-up does not prematurely pop follow-up on steer message_start', async () => {
      // User enqueues FollowUp 1 and FollowUp 2
      const first = queueController.enqueuePendingMessage(sessionId, 'Follow-up 1');
      const second = queueController.enqueuePendingMessage(sessionId, 'Follow-up 2');
      expect(first.success && second.success).toBe(true);
      expect(queueController.list(sessionId)).toHaveLength(2);

      // User triggers Steer on Follow-up 1
      const steerResult = await queueController.steerPendingMessage(sessionId, first.item!.id);
      expect(steerResult.success).toBe(true);

      // 1. Cleared native queue
      expect(mockPiSession.clearQueue).toHaveBeenCalledTimes(1);

      // 2. Steer prompt was dispatched and persisted as Steer
      expect(persistedMessages).toHaveLength(1);
      expect(persistedMessages[0].content).toBe('Follow-up 1');
      expect(persistedMessages[0].metadata?.queueDelivery).toBe(CoworkQueueDelivery.Steer);

      // 3. Follow-up 2 was re-enqueued to Pi native queue
      expect(mockPiSession.prompt).toHaveBeenCalledWith('Follow-up 2', {
        streamingBehavior: 'followUp',
      });

      // Sidecar currently retains Follow-up 2 as Pending
      expect(queueController.list(sessionId)).toHaveLength(1);
      expect(queueController.list(sessionId)[0].id).toBe(second.item?.id);

      // NOW: Pi begins executing the STEER turn (Follow-up 1).
      // Pi emits `message_start` for user role.
      queueController.onNativeUserMessageStart(sessionId, activeSession);

      // REMEDIATED: onNativeUserMessageStart tracks in-flight steer dispatches
      // and does NOT consume Follow-up 2 from the sidecar prematurely:
      const sidecarRemaining = queueController.list(sessionId);
      expect(sidecarRemaining).toHaveLength(1); // Retained in sidecar awaiting turn completion
      expect(persistedMessages).toHaveLength(1); // Follow-up 2 not yet persisted
      expect(activeSession.summaryCheckpointGoal).toBe('Follow-up 1'); // Preserved steer goal

      // When Pi later begins executing Follow-up 2 turn:
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      expect(queueController.list(sessionId)).toHaveLength(0); // Now consumed
      expect(persistedMessages).toHaveLength(2); // Follow-up 2 persisted
      expect(persistedMessages[1].content).toBe('Follow-up 2');
      expect(activeSession.summaryCheckpointGoal).toBe('Follow-up 2');
    });

    it('Scenario 1.3: Control actions queue and execution lifecycle under heavy interleaving', async () => {
      const order: string[] = [];
      activeSession.isRunning = true;

      // Enqueue follow-up
      queueController.enqueuePendingMessage(sessionId, 'Interleaved Prompt');

      // Enqueue multiple control actions
      queueController.enqueueControlAction(sessionId, async () => {
        order.push('action-1');
      });
      queueController.enqueueControlAction(sessionId, async () => {
        order.push('action-2');
      });
      queueController.enqueueControlAction(sessionId, async () => {
        order.push('action-3');
      });

      expect(queueController.hasQueuedControlActions(sessionId)).toBe(true);

      // Turn finishes in Pi
      activeSession.isRunning = false;
      await queueController.flushFollowUpQueue(sessionId, activeSession);

      // Wait for chained background microtasks of control actions to complete
      while (queueController.hasQueuedControlActions(sessionId)) {
        await new Promise(r => setTimeout(r, 5));
      }

      // Follow-up must have executed first via continueSession, then control actions
      expect(mockHost.continueSession).toHaveBeenCalledTimes(1);
      expect(order).toEqual(['action-1', 'action-2', 'action-3']);
      expect(queueController.hasQueuedControlActions(sessionId)).toBe(false);
    });

    it('Scenario 1.4: Control actions survive single action failure without blocking remaining actions', async () => {
      const order: string[] = [];
      activeSession.isRunning = false;

      queueController.enqueueControlAction(sessionId, async () => {
        order.push('action-1');
        throw new Error('Action 1 exploded');
      });
      queueController.enqueueControlAction(sessionId, async () => {
        order.push('action-2');
      });

      await queueController.flushFollowUpQueue(sessionId, activeSession);

      expect(order).toEqual(['action-1', 'action-2']);
      expect(queueController.hasQueuedControlActions(sessionId)).toBe(false);
    });

    it('Scenario 1.5: Control actions are dropped when a turn fails with turnFailed or pendingError', async () => {
      activeSession.isRunning = true;
      let executed = false;

      queueController.enqueueControlAction(sessionId, async () => {
        executed = true;
      });

      activeSession.isRunning = false;
      activeSession.turnFailed = true;

      await queueController.flushFollowUpQueue(sessionId, activeSession);

      expect(executed).toBe(false);
      expect(queueController.hasQueuedControlActions(sessionId)).toBe(false);
    });

    it('Scenario 1.6: Control actions are rejected when session is chatMode', () => {
      activeSession.resourceState.chatMode = true;
      const res = queueController.enqueueControlAction(sessionId, async () => {});
      expect(res.success).toBe(false);
      expect(res.error).toContain('require a Work session');
    });

    it('Scenario 1.7: Clear queue wipes both native queue and sidecar cleanly', () => {
      queueController.enqueuePendingMessage(sessionId, 'Q1');
      queueController.enqueuePendingMessage(sessionId, 'Q2');
      expect(queueController.list(sessionId)).toHaveLength(2);

      const cleared = queueController.clear(sessionId);
      expect(cleared).toBe(true);
      expect(mockPiSession.clearQueue).toHaveBeenCalled();
      expect(queueController.list(sessionId)).toHaveLength(0);
    });
  });

  describe('Dimension 2: Context Edit and Tree Navigation (F18)', () => {
    let adapter: PiRuntimeAdapter;
    let mockPiSession: any;
    let mockSessionManager: any;
    let mockStore: any;
    const sessionId = 'tree-adversarial-session';

    beforeEach(() => {
      adapter = new PiRuntimeAdapter();
      mockSessionManager = {
        appendContextEdit: vi.fn((targetId: string, replacement: any) => `entry-${targetId}`),
      };
      mockPiSession = {
        sessionManager: mockSessionManager,
        navigateTree: vi.fn(async (targetId: string, options?: any) => ({
          cancelled: false,
          editorText: `Navigated to ${targetId}`,
        })),
        getSessionStats: vi.fn(() => ({
          sessionId,
          tokens: { input: 1000, output: 500, total: 1500 },
          cost: 0.015,
        })),
      };

      mockStore = {
        updateMessageMetadata: vi.fn(),
      };
      adapter.setCoworkStore(mockStore);

      (adapter as any).activeSessions.set(sessionId, {
        sessionId,
        piSession: mockPiSession,
        isRunning: false,
      });
    });

    it('Scenario 2.1: appendContextEdit masks target with null non-destructively', () => {
      const res = adapter.appendContextEdit(sessionId, 'msg-to-mask', null);
      expect(res.success).toBe(true);
      expect(res.entryId).toBe('entry-msg-to-mask');
      expect(mockSessionManager.appendContextEdit).toHaveBeenCalledWith('msg-to-mask', null);
      expect(mockStore.updateMessageMetadata).toHaveBeenCalledWith(sessionId, 'msg-to-mask', {
        contextEdit: { omitted: true },
      });
    });

    it('Scenario 2.2: appendContextEdit replaces target with content non-destructively', () => {
      const replacement = { content: 'Redacted safe content' };
      const res = adapter.appendContextEdit(sessionId, 'msg-to-replace', replacement);
      expect(res.success).toBe(true);
      expect(res.entryId).toBe('entry-msg-to-replace');
      expect(mockSessionManager.appendContextEdit).toHaveBeenCalledWith(
        'msg-to-replace',
        replacement,
      );
      expect(mockStore.updateMessageMetadata).toHaveBeenCalledWith(sessionId, 'msg-to-replace', {
        contextEdit: { replaced: true },
      });
    });

    it('Scenario 2.3: appendContextEdit rejects when session is running', () => {
      (adapter as any).activeSessions.get(sessionId).isRunning = true;
      const res = adapter.appendContextEdit(sessionId, 'msg-1', null);
      expect(res.success).toBe(false);
      expect(res.error).toContain('running');
      expect(mockSessionManager.appendContextEdit).not.toHaveBeenCalled();
    });

    it('Scenario 2.4: appendContextEdit surfaces native SessionManager exceptions cleanly', () => {
      mockSessionManager.appendContextEdit.mockImplementationOnce(() => {
        throw new Error('Entry msg-x is not on the active branch');
      });

      const res = adapter.appendContextEdit(sessionId, 'msg-x', null);
      expect(res.success).toBe(false);
      expect(res.error).toBe('Entry msg-x is not on the active branch');
    });

    it('Scenario 2.5: navigateSessionTree moves head and emits sessionsChanged event', async () => {
      const spy = vi.fn();
      adapter.on('sessionsChanged', spy);

      const res = await adapter.navigateSessionTree(sessionId, 'checkpoint-node-1', {
        summarize: true,
        label: 'Rollback point',
      });

      expect(res.success).toBe(true);
      expect(res.editorText).toBe('Navigated to checkpoint-node-1');
      expect(mockPiSession.navigateTree).toHaveBeenCalledWith('checkpoint-node-1', {
        summarize: true,
        label: 'Rollback point',
      });
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('Scenario 2.6: navigateSessionTree handles user cancellation', async () => {
      mockPiSession.navigateTree.mockResolvedValueOnce({ cancelled: true });

      const res = await adapter.navigateSessionTree(sessionId, 'checkpoint-node-1');
      expect(res.success).toBe(false);
      expect(res.cancelled).toBe(true);
    });

    it('Scenario 2.7: navigateSessionTree rejects when session is running', async () => {
      (adapter as any).activeSessions.get(sessionId).isRunning = true;
      const res = await adapter.navigateSessionTree(sessionId, 'checkpoint-node-1');
      expect(res.success).toBe(false);
      expect(res.error).toContain('running');
      expect(mockPiSession.navigateTree).not.toHaveBeenCalled();
    });

    it('Scenario 2.8: getSessionStats returns authoritative tokens and cost metrics', () => {
      const stats = adapter.getSessionStats(sessionId);
      expect(stats).not.toBeNull();
      expect(stats?.tokens.total).toBe(1500);
      expect(stats?.cost).toBe(0.015);
      expect(mockPiSession.getSessionStats).toHaveBeenCalledTimes(1);
    });

    it('Scenario 2.9: getSessionStats returns null when session is inactive or lacks method', () => {
      expect(adapter.getSessionStats('unknown-session')).toBeNull();

      (adapter as any).activeSessions.set('no-stats-session', {
        sessionId: 'no-stats-session',
        piSession: {},
      });
      expect(adapter.getSessionStats('no-stats-session')).toBeNull();
    });
  });
});
