import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoworkQueueDelivery } from '../src/shared/cowork/pendingMessageQueue';
import { ImageInputVerdict } from '../src/main/libs/agentEngine/piImageInputFallback';
import { PiRuntimeQueueController } from '../src/main/libs/agentEngine/piRuntimeQueueController';
import type {
  ActivePiSession,
  PiSession,
} from '../src/main/libs/agentEngine/piRuntimeSessionState';
import type { PiRuntimeAdapterHost } from '../src/main/libs/agentEngine/piRuntimeAdapterHost';

describe('Milestone 3 Adversarial Challenge: Queue', () => {
  describe('Dimension 1: Queue Controller Thinning & Steer/Follow-Up Race Conditions', () => {
    let mockHost: any;
    let mockPiSession: any;
    let mockStore: any;
    let activeSession: ActivePiSession;
    let queueController: PiRuntimeQueueController;
    const sessionId = 'adversarial-queue-session';
    const persistedMessages: any[] = [];
    const nativeFollowUps: Array<{ role: 'user'; content: string }> = [];

    beforeEach(() => {
      persistedMessages.length = 0;
      nativeFollowUps.length = 0;
      mockPiSession = {
        prompt: vi.fn().mockResolvedValue(undefined),
        sendUserMessage: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn<PiSession['followUp']>(async (text, _images, options) => {
          const message = { role: 'user' as const, content: text };
          options?.onQueued?.(message);
          nativeFollowUps.push(message);
          return 'queued';
        }),
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
        messages: {
          addMessage: vi.fn((_id: string, msg: any) => {
            persistedMessages.push(msg);
            return msg;
          }),
        },
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

    it('Scenario 1.1: Direct prompts do not cause duplicate SQLite persistence on native message_start', () => {
      expect(queueController.list(sessionId)).toHaveLength(0);

      // A direct prompt starts in Pi: onNativeUserMessageStart should be a no-op
      queueController.onNativeUserMessageStart(sessionId, activeSession, {
        role: 'user',
        content: 'Direct prompt',
      });

      expect(mockStore.messages.addMessage).not.toHaveBeenCalled();
      expect(persistedMessages).toHaveLength(0);
    });

    it('Scenario 1.3: Control actions queue and execution lifecycle under heavy interleaving', async () => {
      const order: string[] = [];
      activeSession.isRunning = true;

      // Enqueue follow-up
      await expect(
        queueController.enqueuePendingMessage(sessionId, 'Interleaved Prompt'),
      ).resolves.toMatchObject({ success: true });

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

      queueController.onNativeUserMessageStart(sessionId, activeSession, nativeFollowUps[0]);
      // Pi consumes the follow-up before settling.
      activeSession.isRunning = false;
      await queueController.flushControlActions(sessionId, activeSession);

      // Wait for chained background microtasks of control actions to complete
      while (queueController.hasQueuedControlActions(sessionId)) {
        await new Promise(r => setTimeout(r, 5));
      }

      // Follow-up must have executed first via continueSession, then control actions
      expect(mockHost.continueSession).not.toHaveBeenCalled();
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

      await queueController.flushControlActions(sessionId, activeSession);

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

      await queueController.flushControlActions(sessionId, activeSession);

      expect(executed).toBe(false);
      expect(queueController.hasQueuedControlActions(sessionId)).toBe(false);
    });

    it('Scenario 1.6: Control actions are rejected when session is chatMode', () => {
      activeSession.resourceState.chatMode = true;
      const res = queueController.enqueueControlAction(sessionId, async () => {});
      expect(res.success).toBe(false);
      expect(res.error).toContain('require a Work session');
    });

    it('Scenario 1.7: Clear removes sidecar metadata without mutating Pi queues', async () => {
      await queueController.enqueuePendingMessage(sessionId, 'Q1');
      await queueController.enqueuePendingMessage(sessionId, 'Q2');
      expect(queueController.list(sessionId)).toHaveLength(2);

      const cleared = queueController.clear(sessionId);
      expect(cleared).toBe(true);
      expect(mockPiSession.clearQueue).not.toHaveBeenCalled();
      expect(queueController.list(sessionId)).toHaveLength(0);
    });
  });
});
