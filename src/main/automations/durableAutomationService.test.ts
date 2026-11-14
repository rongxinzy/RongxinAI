import { expect, test } from 'vitest';
import { fauxAssistantMessage, fauxToolCall } from '@earendil-works/pi-ai/providers/faux';
import { PayloadKind } from '../../scheduledTask/constants';
import { automationContext, readAutomationFile, withAutomationFile } from './automationStorage.mjs';
import { AutomationDoc, AutomationTaskKind } from './automationState.mjs';
import { fixture, input } from './automationServiceFixture';

test('manual execution uses one native input receipt and native task/run history', async () => {
  const f = await fixture();
  f.faux.setResponses([fauxAssistantMessage('Executed.')]);
  const service = f.createService();
  const job = await service.addJob(input());
  expect(f.faux.state.callCount).toBe(0);
  await service.runJob(job.id);
  const runs = await service.listRuns(job.id);
  expect(runs).toHaveLength(1);
  expect(runs[0]).toMatchObject({
    taskId: job.id,
    status: 'success',
    sessionId: `automation:${job.id}`,
  });
  expect(await service.countRuns(job.id)).toBe(1);
  expect((await service.getJob(job.id))?.state).toMatchObject({
    lastStatus: 'success',
    runningAtMs: null,
  });
  const session = [...f.opens.values()][0];
  const { harness } = session.getDurableHost();
  const state = await harness.snapshot(AutomationDoc, automationContext);
  expect(state?.runCount).toBe(1);
  expect(f.faux.state.callCount).toBe(1);
});

test('one-time trigger persists a native sleeping checkpoint and executes only when due', async () => {
  const f = await fixture();
  f.faux.setResponses([fauxAssistantMessage('Due now.')]);
  const service = f.createService();
  const job = await service.addJob(
    input({
      enabled: true,
      schedule: { kind: 'at', at: new Date(Date.now() + 250).toISOString() },
    }),
  );
  const { harness } = [...f.opens.values()][0].getDurableHost();
  await expect
    .poll(async () =>
      (await harness.inspect(automationContext)).tasks.some(
        task => task.record.kind === AutomationTaskKind.Schedule && task.state.kind === 'sleeping',
      ),
    )
    .toBe(true);
  expect(f.faux.state.callCount).toBe(0);
  await expect.poll(async () => (await service.listRuns(job.id))[0]?.status).toBe('success');
  expect((await service.getJob(job.id))?.state.nextRunAtMs).toBeNull();
  expect(f.faux.state.callCount).toBe(1);
});

test('model failure parks the definition and native schedule checkpoint for later recovery', async () => {
  const f = await fixture();
  f.setUnavailable(true);
  const service = f.createService();
  const job = await service.addJob(input({ enabled: true }));
  expect(job.state.lastError).toContain('unavailable');
  const file = f.options.fileForSession(`automation:${job.id}`);
  expect((await readAutomationFile(file))?.id).toBe(job.id);
  await withAutomationFile(
    file,
    async harness => {
      expect((await harness.inspect(automationContext)).tasks).toEqual([
        expect.objectContaining({
          record: expect.objectContaining({ kind: AutomationTaskKind.Schedule }),
        }),
      ]);
    },
    true,
  );
  expect(f.faux.state.callCount).toBe(0);
  await service.stop();
  f.setUnavailable(false);
  f.faux.setResponses([fauxAssistantMessage('Recovered.')]);
  const reopened = f.createService();
  await reopened.start();
  await reopened.runJob(job.id);
  expect((await reopened.listRuns(job.id))[0]?.status).toBe('success');
});

test('restart resumes an unfinished native run without repeating a committed external effect', async () => {
  const f = await fixture(200);
  f.faux.setResponses([
    fauxAssistantMessage(fauxToolCall('effect', {}), { stopReason: 'toolUse' }),
    fauxAssistantMessage('A slow response. '.repeat(400)),
  ]);
  const service = f.createService();
  const job = await service.addJob(input());
  const pending = service.runJob(job.id).catch(() => {});
  await expect.poll(f.effects).toBe(1);
  await expect.poll(() => f.faux.state.callCount).toBe(2);
  await service.stop();
  await pending;
  f.faux.setResponses([fauxAssistantMessage('Resumed.')]);
  const reopened = f.createService();
  await reopened.start();
  await expect.poll(async () => (await reopened.listRuns(job.id))[0]?.status).toBe('success');
  expect(f.effects()).toBe(1);
  expect(await reopened.countRuns(job.id)).toBe(1);
});

test('explicit stop aborts native scopes and reopening cannot revive withdrawn work', async () => {
  const f = await fixture(200);
  f.faux.setResponses([fauxAssistantMessage('Slow response. '.repeat(400))]);
  const service = f.createService();
  const job = await service.addJob(input());
  const pending = service.runJob(job.id).catch(() => {});
  await expect.poll(() => f.faux.state.callCount).toBe(1);
  expect(await service.stopJob(job.id)).toBe(true);
  await pending;
  expect((await service.listRuns(job.id))[0]?.status).toBe('error');
  expect(service.hasRunningJobs()).toBe(false);
  await service.stop();
  const reopened = f.createService();
  await reopened.start();
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(f.faux.state.callCount).toBe(1);
  expect((await reopened.listRuns(job.id))[0]?.error).toContain('stopped');
});

test('native deadline aborts timed-out generation and records a visible failure', async () => {
  const f = await fixture(50);
  f.faux.setResponses([fauxAssistantMessage('Slow response. '.repeat(400))]);
  const service = f.createService();
  const job = await service.addJob(
    input({
      payload: {
        kind: PayloadKind.AgentTurn,
        message: 'Run.',
        timeoutSeconds: 1,
      },
    }),
  );
  await expect(service.runJob(job.id)).rejects.toThrow('timed out after 1s');
  const [run] = await service.listRuns(job.id);
  expect(run).toMatchObject({ status: 'error', error: 'Automation timed out after 1s.' });
  expect(service.hasRunningJobs()).toBe(false);
});

test('recurring task resumes its existing deadline after restart, and rename preserves it', async () => {
  const f = await fixture();
  f.faux.setResponses([fauxAssistantMessage('Recurring execution.')]);
  const service = f.createService();
  const job = await service.addJob(
    input({ enabled: true, schedule: { kind: 'every', everyMs: 350 } }),
  );
  const due = job.state.nextRunAtMs;
  await service.updateJob(job.id, { name: 'Renamed' });
  expect((await service.getJob(job.id))?.state.nextRunAtMs).toBe(due);
  await service.stop();
  const reopened = f.createService();
  await reopened.start();
  expect((await reopened.getJob(job.id))?.state.nextRunAtMs).toBe(due);
  await expect.poll(async () => (await reopened.listRuns(job.id))[0]?.status).toBe('success');
  await reopened.toggleJob(job.id, false);
  expect(f.faux.state.callCount).toBe(1);
  expect((await reopened.getJob(job.id))?.state.nextRunAtMs).toBeNull();
});

test('a parked automation can be stopped and removed without resolving a model', async () => {
  const f = await fixture();
  f.setUnavailable(true);
  const service = f.createService();
  const job = await service.addJob(input({ enabled: true }));
  expect(await service.stopJob(job.id)).toBe(false);
  expect((await service.getJob(job.id))?.enabled).toBe(true);
  await service.removeJob(job.id);
  expect(await service.getJob(job.id)).toBeNull();
  await service.stop();
  const reopened = f.createService();
  expect(await reopened.listJobs()).toEqual([]);
  expect(f.faux.state.callCount).toBe(0);
});

test('resource readiness remounts a parked native checkpoint and runs its overdue trigger once', async () => {
  const f = await fixture();
  f.setUnavailable(true);
  const service = f.createService();
  const due = Date.now() + 150;
  const job = await service.addJob(
    input({ enabled: true, schedule: { kind: 'at', at: new Date(due).toISOString() } }),
  );
  await expect.poll(() => Date.now()).toBeGreaterThan(due);
  expect(f.faux.state.callCount).toBe(0);
  f.setUnavailable(false);
  f.faux.setResponses([fauxAssistantMessage('Resources are ready.')]);
  await service.retryParked();
  await expect.poll(async () => (await service.listRuns(job.id))[0]?.status).toBe('success');
  expect((await service.getJob(job.id))?.state.lastError).toBeNull();
  await service.retryParked();
  expect(f.faux.state.callCount).toBe(1);
});

test('output-token exhaustion records one native automation failure and never a successful run', async () => {
  const f = await fixture();
  const projected: Array<{ status: string }> = [];
  Object.assign(f.options, { onRun: (run: { status: string }) => projected.push(run) });
  f.faux.setResponses([fauxAssistantMessage('Incomplete result.', { stopReason: 'length' })]);
  const service = f.createService();
  const job = await service.addJob(input());
  await expect(service.runJob(job.id)).rejects.toThrow('output token limit');
  expect((await service.listRuns(job.id))[0]).toMatchObject({
    status: 'error',
    error: 'Model response reached its output token limit; completion is incomplete.',
  });
  expect((await service.getJob(job.id))?.state.lastStatus).toBe('error');
  expect(projected.some(run => run.status === 'success')).toBe(false);
  expect(f.faux.state.callCount).toBe(1);
  await service.stop();
  const reopened = f.createService();
  await reopened.start();
  expect((await reopened.listRuns(job.id))[0]?.status).toBe('error');
  expect(f.faux.state.callCount).toBe(1);
});
