import Database from 'better-sqlite3';
import { expect, test, vi } from 'vitest';
import { WorkbenchContractKind, WorkbenchOutputMode } from '../../../shared/workbenchTask';
import { initializeProductionLoopSchema } from '../../productionLoop/schema';
import { collectWorkbenchArtifacts } from '../../workbenchTask/artifactCollector';
import { initializeWorkbenchTaskSchema } from '../../workbenchTask/schema';
import { WorkbenchTaskService } from '../../workbenchTask/taskService';
import { buildPiConversationPrompt } from './piConversationContext';
import { prependWorkbenchTaskBoundary } from './piWorkbenchTaskBoundary';

vi.mock('../../workbenchTask/artifactWorkerPool', () => ({
  collectWorkbenchArtifactsAsync: async (input: Parameters<typeof collectWorkbenchArtifacts>[0]) =>
    collectWorkbenchArtifacts(input),
}));

test('user acceptance is persisted and injected into reused and restored conversation prompts', async () => {
  const db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  initializeProductionLoopSchema(db);
  const service = new WorkbenchTaskService(db);
  try {
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'Create a quarterly written summary',
      contract: {
        kind: WorkbenchContractKind.GenericWork,
        requiresUserAcceptance: true,
        outputRequirements: [{ mode: WorkbenchOutputMode.Text, formats: [] }],
      },
    });
    await service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'Final written summary',
    });
    service.acceptTask(task.id);
    service.beginRun({
      sessionId: 'session',
      goal: '哈哈',
      contract: { kind: WorkbenchContractKind.Chat, requiresUserAcceptance: false },
    });
    const reused = prependWorkbenchTaskBoundary('哈哈', service, 'session');
    expect(reused).toContain('accepted by the user');
    expect(reused).toContain('Do not resume');
    expect(reused).toContain('explicit request to revise or continue');
    expect(reused.endsWith('哈哈')).toBe(true);
    const restoredService = new WorkbenchTaskService(db);
    const restored = prependWorkbenchTaskBoundary(
      buildPiConversationPrompt(
        [
          {
            id: 'old',
            type: 'assistant',
            content: 'I will generate the slides next.',
            timestamp: 1,
          },
        ],
        '哈哈',
      ),
      restoredService,
      'session',
    );
    expect(restored).toContain('accepted by the user');
    expect(restored).toContain('PREVIOUS CONVERSATION');
    expect(prependWorkbenchTaskBoundary('Hello', service, 'other-session')).toBe('Hello');
  } finally {
    db.close();
  }
});
