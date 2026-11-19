import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { app } from 'electron';

import { installTestMagpie } from '../../tests/helpers/installTestMagpie';
import { CoworkStore } from '../main/coworkStore';
import { PiRuntimeAdapter } from '../main/libs/agentEngine/piRuntimeAdapter';
import { SqliteStore } from '../main/sqliteStore';
import { CoworkExecutionMode } from '../shared/cowork/constants';
import { DeliveryMode, PayloadKind, ScheduleKind, SessionTarget, WakeMode } from './constants';
import { PiScheduledTaskExecutor } from './piScheduledTaskExecutor';
import { SqliteScheduledTaskStore } from './sqliteScheduledTaskStore';

const mockApp = app as unknown as Record<string, unknown>;
if (typeof mockApp.getAppPath !== 'function') mockApp.getAppPath = () => process.cwd();

test('a real Pi turn without a final answer does not reuse the previous scheduled reply', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'zhiyuan-scheduled-output-'));
  const model = 'scheduled-output';
  let requests = 0;
  const upstream = createServer((req, res) => {
    req.resume();
    requests++;
    const content = requests === 1 ? 'Previous scheduled answer.' : '';
    const chunk = (delta: unknown, finishReason: string | null) =>
      `data: ${JSON.stringify({ id: `run-${requests}`, object: 'chat.completion.chunk', model, choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(chunk({ role: 'assistant', content }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const gateway = installTestMagpie({
    gatewayUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
    defaultModelId: model,
  });
  gateway.upsert(model, { context_window: 65_536, max_output_tokens: 4096 });
  const sqlite = await SqliteStore.create(directory);
  const coworkStore = new CoworkStore(sqlite.getDatabase());
  const scheduledStore = new SqliteScheduledTaskStore(sqlite.getDatabase());
  const adapter = new PiRuntimeAdapter();
  adapter.setCoworkStore(coworkStore);
  adapter.setPiSessionStoreRoot(directory);
  const failures: string[] = [];
  adapter.on('error', (_id, error) => failures.push(error.message));
  try {
    const session = coworkStore.createSession(
      'Scheduled output',
      directory,
      '',
      CoworkExecutionMode.Local,
    );
    const task = scheduledStore.create({
      name: 'Scheduled output',
      description: '',
      enabled: true,
      schedule: { kind: ScheduleKind.Every, everyMs: 60_000 },
      sessionTarget: SessionTarget.Main,
      sessionKey: session.id,
      wakeMode: WakeMode.Now,
      payload: { kind: PayloadKind.AgentTurn, message: 'Respond if needed.', timeoutSeconds: 15 },
      delivery: { mode: DeliveryMode.None },
      workspaceId: session.workspaceId,
    });
    const executor = new PiScheduledTaskExecutor(adapter, coworkStore);
    const first = scheduledStore.claimTrigger({
      taskId: task.id,
      scheduleVersion: task.scheduleVersion!,
      scheduledAt: '2030-01-01T00:00:00.000Z',
    })!;
    const second = scheduledStore.claimTrigger({
      taskId: task.id,
      scheduleVersion: task.scheduleVersion!,
      scheduledAt: '2030-01-01T00:01:00.000Z',
    })!;
    await expect(executor.execute(task, first)).resolves.toEqual({
      sessionId: session.id,
      output: 'Previous scheduled answer.',
    });
    await expect(executor.execute(task, second)).resolves.toEqual({
      sessionId: session.id,
      output: null,
    });
    expect(coworkStore.getSession(session.id)?.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: 'Previous scheduled answer.' })]),
    );
    expect(requests).toBe(2);
    expect(failures).toEqual([]);
  } finally {
    adapter.stopAllSessions();
    gateway.dispose();
    await sqlite.close();
    await new Promise<void>(resolve => {
      upstream.close(() => resolve());
      upstream.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
});
