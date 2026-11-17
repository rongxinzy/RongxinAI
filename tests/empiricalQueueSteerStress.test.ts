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
        reportOmittedImages: vi.fn(),
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

  describe('Dimension 3: Fallback and Flush Queue Settlement Sequencing', () => {
    it('Stress 3.1: flushControlActions respects strict FIFO order and halts control actions until prompts drain', async () => {
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

      // Native Pi consumes both inputs before its one settlement signal.
      await queueController.flushControlActions(sessionId, activeSession);
      expect(executionLog).toEqual([]);
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      queueController.onNativeUserMessageStart(sessionId, activeSession);
      expect(persistedMessages.map(message => message.content)).toEqual([
        'FollowUp 1',
        'FollowUp 2',
      ]);
      activeSession.isRunning = false;
      await queueController.flushControlActions(sessionId, activeSession);
      await new Promise(resolve => setImmediate(resolve));
      expect(mockHost.continueSession).not.toHaveBeenCalled();

      expect(executionLog).toEqual(['ControlAction A', 'ControlAction B']);
      expect(queueController.hasQueuedControlActions(sessionId)).toBe(false);
    });
  });
});
