import Database from 'better-sqlite3';
import { expect, test } from 'vitest';

import { WorkbenchContractKind, WorkbenchRunTrigger } from '../../shared/workbenchTask';
import { WorkbenchTaskRepository } from './repository';
import { initializeWorkbenchTaskSchema } from './schema';

test('retiring workflow state preserves task history and releases foreign keys', () => {
  const db = new Database(':memory:');
  try {
    initializeWorkbenchTaskSchema(db);
    const repository = new WorkbenchTaskRepository(db);
    const task = repository.createTask('session', 'Keep the task', {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: false,
    });
    const run = repository.createRun(task.id, WorkbenchRunTrigger.Message);
    db.exec(`CREATE TABLE workbench_production_loops (
      run_id TEXT REFERENCES workbench_runs(id),
      task_id TEXT REFERENCES workbench_tasks(id)
    )`);
    db.prepare('INSERT INTO workbench_production_loops VALUES (?, ?)').run(run.id, task.id);
    initializeWorkbenchTaskSchema(db);
    expect(repository.getTask(task.id)?.goal).toBe('Keep the task');
    expect(repository.getRun(run.id)?.id).toBe(run.id);
    expect(() => repository.deleteSessionDomainData('session')).not.toThrow();
    expect(repository.getTask(task.id)).toBeNull();
  } finally {
    db.close();
  }
});
