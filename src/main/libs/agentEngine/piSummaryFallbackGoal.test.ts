import {
  createTestPiRuntime,
  createTemporaryWorkspace,
  setupPiRuntimeAdapterSuite,
} from './piRuntimeAdapter.testHarness';

import { describe, expect, test, vi } from 'vitest';

import { CoworkSessionMode } from '../../../shared/cowork/constants';
import { createCoworkStoreHarness } from '../../coworkStore/coworkStore.testHarness';
import type { ProjectMemoryService } from '../../memory/projectMemoryService';
import { SessionCheckpointSyncState } from '../../memory/constants';

describe('summary fallback goal', () => {
  setupPiRuntimeAdapterSuite();

  test.each([false, true])(
    'launch, continuation and recreation retain the request (queued input: %s)',
    async queuedInput => {
      const { db, store } = createCoworkStoreHarness();
      const root = createTemporaryWorkspace();
      const session = store.createSession('Summary regression', root, '');
      const saveSessionSummary = vi.fn(async (_input: { summary: string }) => ({
        checkpointId: 'checkpoint-1',
        syncState: SessionCheckpointSyncState.Pending,
      }));
      const memory = {
        saveSessionSummary,
        buildProjectContext: vi.fn(async () => 'Prior memory that is not the current goal'),
        registerSession: vi.fn(async () => {}),
      } as unknown as ProjectMemoryService;
      const adapter = createTestPiRuntime({ coworkStore: store, projectMemoryService: memory });
      const checkGoal = async (goal: string) => {
        const active = adapter.activeSessions.get(session.id)!;
        const answer = store.messages.addMessage(session.id, {
          type: 'assistant',
          content: 'Task completed.',
        });
        expect(store.getSession(session.id, 1)?.messages.map(message => message.id)).toEqual([
          answer.id,
        ]);
        // A queued future input must not change the goal of the settling turn.
        if (queuedInput) {
          store.messages.addMessage(session.id, {
            type: 'user',
            content: 'A different queued request',
          });
        }
        active.lastCompletedAnswerMessageId = answer.id;
        active.lastCompletedAnswerText = answer.content;
        await adapter.recordSummaryOmission(session.id, active, []);
        const saved = saveSessionSummary.mock.calls.at(-1)![0].summary;
        expect(saved).toContain(`## Goal\n${goal}\n`);
        expect(saved).not.toContain('A different queued request');
        expect(saved).not.toContain('Prior memory that is not the current goal');
        expect(saved).not.toContain('Restored transcript');
      };
      try {
        await adapter.startSession(session.id, 'Create a workbook', {
          workspaceRoot: root,
          sessionMode: CoworkSessionMode.Work,
        });
        await checkGoal('Create a workbook');
        await adapter.continueSession(session.id, 'Correct the workbook totals');
        await checkGoal('Correct the workbook totals');
        adapter.stopSession(session.id);
        await adapter.continueSession(session.id, 'Add a final worksheet');
        await checkGoal('Add a final worksheet');
        expect(saveSessionSummary).toHaveBeenCalledTimes(3);
      } finally {
        adapter.stopAllSessions();
        db.close();
      }
    },
  );
});
