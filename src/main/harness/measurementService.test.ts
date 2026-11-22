import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { HarnessActivationType, HarnessFailureWhy, HarnessVersion } from '../../shared/harness';
import {
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchRunTrigger,
} from '../../shared/workbenchTask';
import { initializeWorkbenchTaskSchema } from '../workbenchTask/schema';
import { WorkbenchTaskService } from '../workbenchTask/taskService';

test('appends profile, activation, failure, and quality events in sequence', () => {
  const db = new Database(':memory:');
  try {
    initializeWorkbenchTaskSchema(db);
    const service = new WorkbenchTaskService(db);
    const { repository, measurement } = service;
    const task = repository.createTask('session', 'goal', {
      kind: WorkbenchContractKind.Chat,
    });
    const run = repository.createRun(task.id, WorkbenchRunTrigger.Message);
    const context = {
      provider: 'OpenAI',
      model: 'gemma-4-31B-it',
      reasoningProfile: 'default',
      skillIds: [],
      workspaceRoot: '/fixture',
    };
    service.updateRunContext(run.id, context, {
      workflowKind: WorkbenchContractKind.Chat,
      harnessVersion: HarnessVersion,
    });
    measurement.recordActivation(run.id, {
      activation: HarnessActivationType.PrematureFinalizeBlocked,
      iteration: 1,
    });
    measurement.recordFailure(run.id, {
      message: 'request timed out with apiKey=top-secret',
      evidence: { authorization: 'Bearer top-secret' },
    });
    measurement.recordVerification(run.id, { passed: false, outcome: 'failed' });

    const events = repository.getDetail(task.id)?.events ?? [];
    expect(events.map(event => event.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(events.map(event => event.type)).toEqual([
      WorkbenchRunEventType.RunCreated,
      WorkbenchRunEventType.HarnessProfiled,
      WorkbenchRunEventType.HarnessActivation,
      WorkbenchRunEventType.HarnessFailure,
      WorkbenchRunEventType.HarnessQualityMeasured,
    ]);
    const stored = db
      .prepare('SELECT payload_json FROM workbench_run_events WHERE run_id = ? AND type = ?')
      .pluck()
      .get(run.id, WorkbenchRunEventType.HarnessProfiled);
    expect(JSON.parse(String(stored))).toEqual({
      profile: {
        id: expect.any(String),
        workflowKind: WorkbenchContractKind.Chat,
        harnessVersion: HarnessVersion,
      },
    });
    expect(repository.getRun(run.id)?.context).toEqual(context);
    expect(events[1].payload).toMatchObject({
      profile: { provider: 'openai', model: context.model, reasoningProfile: 'default' },
    });
    expect(events[3].payload).toMatchObject({ why: HarnessFailureWhy.InfraFailure });
    expect(JSON.stringify(events[3].payload)).not.toContain('top-secret');

    const historicalProfile = { model: 'earlier-model', provider: 'earlier-provider' };
    repository.appendRunEvent(run.id, WorkbenchRunEventType.HarnessProfiled, {
      profile: historicalProfile,
    });
    expect(service.getDetail(task.id)?.events.at(-1)?.payload).toEqual({
      profile: historicalProfile,
    });
  } finally {
    db.close();
  }
});
