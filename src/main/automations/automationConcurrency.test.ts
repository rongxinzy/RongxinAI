import { expect, test } from 'vitest';
import { fauxAssistantMessage } from '@earendil-works/pi-ai/providers/faux';
import { SessionTarget } from '../../scheduledTask/constants';
import { fixture, input } from './automationServiceFixture';
import { AutomationTaskKind } from './automationState.mjs';
import { automationContext } from './automationStorage.mjs';

test('stop cancels an active native run and queued manual work, while later run-now is admitted', async () => {
  const f = await fixture(200);
  f.faux.setResponses([fauxAssistantMessage('Slow first response. '.repeat(400))]);
  const service = f.createService();
  const job = await service.addJob(input());
  const first = service.runJob(job.id).catch(error => error);
  await expect.poll(() => f.faux.state.callCount).toBe(1);
  const queued = service.runJob(job.id).catch(error => error);
  const { harness } = [...f.opens.values()][0].getDurableHost();
  await expect
    .poll(
      async () =>
        (await harness.inspect(automationContext)).tasks.filter(
          task => task.record.kind === AutomationTaskKind.Run,
        ).length,
    )
    .toBe(2);
  expect(await service.stopJob(job.id)).toBe(true);
  await Promise.all([first, queued]);
  expect(f.faux.state.callCount).toBe(1);
  expect(service.hasRunningJobs()).toBe(false);
  f.faux.setResponses([fauxAssistantMessage('New user-requested execution.')]);
  await service.runJob(job.id);
  expect(f.faux.state.callCount).toBe(2);
  const runs = await service.listRuns(job.id);
  expect(runs.map(run => run.status)).toEqual(['success', 'error']);
  await service.stop();
  const reopened = f.createService();
  await reopened.start();
  expect(await reopened.countRuns(job.id)).toBe(2);
  expect(f.faux.state.callCount).toBe(2);
});

test('rename affects future runs while immutable native history keeps its original task name', async () => {
  const f = await fixture();
  f.faux.setResponses([fauxAssistantMessage('First.'), fauxAssistantMessage('Second.')]);
  const service = f.createService();
  const job = await service.addJob(input({ name: 'Original name' }));
  await service.runJob(job.id);
  await service.updateJob(job.id, { name: 'New name' });
  await service.runJob(job.id);
  expect((await service.listAllRuns()).map(run => run.taskName)).toEqual([
    'New name',
    'Original name',
  ]);
  await service.stop();
  const reopened = f.createService();
  expect((await reopened.listAllRuns()).map(run => run.taskName)).toEqual([
    'New name',
    'Original name',
  ]);
});

test('isolated runs reset native model context while retaining native execution history', async () => {
  const f = await fixture();
  f.faux.setResponses([
    fauxAssistantMessage('Private first result.'),
    context => {
      expect(JSON.stringify(context.messages)).not.toContain('Private first result.');
      return fauxAssistantMessage('Independent second result.');
    },
  ]);
  const service = f.createService();
  const job = await service.addJob(input({ sessionTarget: SessionTarget.Isolated }));
  await service.runJob(job.id);
  await service.runJob(job.id);
  expect(await service.countRuns(job.id)).toBe(2);
  expect(await service.listRuns(job.id)).toHaveLength(2);
});

test('enabling an expired one-time definition fails explicitly without creating phantom work', async () => {
  const f = await fixture();
  const service = f.createService();
  const job = await service.addJob(input({ schedule: { kind: 'at', at: '2000-01-01T00:00:00Z' } }));
  await expect(service.toggleJob(job.id, true)).rejects.toThrow('future ISO timestamp');
  expect((await service.getJob(job.id))?.enabled).toBe(false);
  expect(f.faux.state.callCount).toBe(0);
});
