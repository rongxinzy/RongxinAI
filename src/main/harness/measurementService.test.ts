import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { HarnessActivationType, HarnessFailureWhy, HarnessVersion } from '../../shared/harness';
import {
  WorkbenchContractKind,
  WorkbenchRunEventType,
  WorkbenchRunTrigger,
} from '../../shared/workbenchTask';
import { initializeWorkbenchTaskSchema } from '../workbenchTask/schema';
import { WorkbenchTaskRepository } from '../workbenchTask/repository';
import { HarnessMeasurementService } from './measurementService';

test('appends profile, activation, failure, and quality events in sequence', () => {
  const db = new Database(':memory:');
  try {
    initializeWorkbenchTaskSchema(db);
    const repository = new WorkbenchTaskRepository(db);
    const task = repository.createTask('session', 'goal', {
      kind: WorkbenchContractKind.Chat,
      requiresUserAcceptance: false,
    });
    const run = repository.createRun(task.id, WorkbenchRunTrigger.Message);
    const measurement = new HarnessMeasurementService(repository);

    measurement.recordModelProfile(run.id, {
      provider: 'openai',
      model: 'gemma-4-31B-it',
      reasoningProfile: 'default',
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
    expect(events[3].payload).toMatchObject({ why: HarnessFailureWhy.InfraFailure });
    expect(JSON.stringify(events[3].payload)).not.toContain('top-secret');
  } finally {
    db.close();
  }
});
