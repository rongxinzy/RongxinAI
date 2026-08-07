import { describe, expect, test, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  getAllWindows: vi.fn((): unknown[] => []),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: electronMocks.getAllWindows,
  },
}));

import { DeliveryMode, GatewayStatus, IpcChannel, TaskStatus } from './constants';
import {
  CronJobService,
  mapGatewayJob,
  mapGatewayRun,
  mapGatewayTaskState,
} from './cronJobService';

test('listJobs establishes the gateway client when it is not connected yet', async () => {
  const request = vi.fn();
  const gatewayClient = {
    request: async <T = Record<string, unknown>>(
      method: string,
      params?: unknown,
      opts?: { expectFinal?: boolean },
    ): Promise<T> => {
      request(method, params, opts);
      return { jobs: [] } as T;
    },
  };
  let currentClient: typeof gatewayClient | null = null;
  const ensureGatewayReady = vi.fn(async () => {
    currentClient = gatewayClient;
  });
  const service = new CronJobService({
    getGatewayClient: () => currentClient,
    ensureGatewayReady,
  });

  await expect(service.listJobs()).resolves.toEqual([]);
  expect(ensureGatewayReady).toHaveBeenCalledOnce();
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0]?.[1]).toEqual({ includeDisabled: true, limit: 200 });
});

test('gateway reconnection emits a full task-list refresh', () => {
  const send = vi.fn();
  electronMocks.getAllWindows.mockReturnValue([
    {
      isDestroyed: () => false,
      webContents: { send },
    },
  ]);
  const service = new CronJobService({
    getGatewayClient: () => null,
    ensureGatewayReady: async () => {},
  });

  service.handleGatewayConnected();

  expect(send).toHaveBeenCalledWith(IpcChannel.Refresh);
  electronMocks.getAllWindows.mockReturnValue([]);
});

test('polling projects a cron run into the channel activity event stream', async () => {
  const onChannelRunEvent = vi.fn();
  let poll = 0;
  const job = {
    id: 'job-1',
    name: 'Morning brief',
    enabled: true,
    schedule: { kind: 'cron', expr: '0 9 * * *' },
    sessionTarget: 'isolated',
    wakeMode: 'now',
    payload: { kind: 'agentTurn', message: 'Summarize updates' },
    delivery: { mode: 'announce', channel: 'feishu', to: 'chat-1' },
    sessionKey: 'session-1',
    state: { runningAtMs: 1700000000000, lastRunAtMs: 1 },
    createdAtMs: 1,
    updatedAtMs: 1,
  };
  const gatewayClient = {
    request: vi.fn(async <T = Record<string, unknown>>(method: string): Promise<T> => {
      if (method === 'cron.list') {
        poll += 1;
        const currentJob =
          poll === 1
            ? { ...job, state: { runningAtMs: undefined, lastRunAtMs: 1 } }
            : poll === 2
              ? job
              : {
                  ...job,
                  state: {
                    runningAtMs: undefined,
                    lastRunAtMs: 2,
                    lastRunStatus: GatewayStatus.Ok,
                  },
                };
        return { jobs: [currentJob] } as T;
      }
      return {
        entries: [
          {
            ts: 1700000010000,
            jobId: 'job-1',
            status: GatewayStatus.Ok,
            runAtMs: 1700000000000,
            durationMs: 10000,
            summary: 'Done',
          },
        ],
      } as T;
    }),
  };
  const service = new CronJobService({
    getGatewayClient: () => gatewayClient,
    ensureGatewayReady: async () => {},
    onChannelRunEvent,
  });
  (service as unknown as { polling: boolean }).polling = true;

  await (service as unknown as { pollOnce: () => Promise<void> }).pollOnce();
  service.handleGatewayConnected();
  await (service as unknown as { pollOnce: () => Promise<void> }).pollOnce();
  await (service as unknown as { pollOnce: () => Promise<void> }).pollOnce();

  expect(onChannelRunEvent).toHaveBeenCalledTimes(2);
  expect(onChannelRunEvent.mock.calls[0]?.[0]).toMatchObject({
    runId: 'job-1-1700000000000',
    trigger: 'cron',
    status: 'started',
    inputPreview: 'Summarize updates',
  });
  expect(onChannelRunEvent.mock.calls[1]?.[0]).toMatchObject({
    runId: 'job-1-1700000000000',
    trigger: 'cron',
    status: 'completed',
  });
});

describe('mapGatewayRun', () => {
  const baseEntry = {
    ts: 1700000000000,
    jobId: 'job-1',
    status: GatewayStatus.Ok,
    sessionId: 'sess-1',
    runAtMs: 1699999990000,
    durationMs: 10000,
    summary: 'All good',
  };

  test('maps ok status to success', () => {
    const run = mapGatewayRun(baseEntry);
    expect(run.status).toBe(TaskStatus.Success);
    expect(run.error).toBeNull();
  });

  test('maps error status to error', () => {
    const run = mapGatewayRun({
      ...baseEntry,
      status: GatewayStatus.Error,
      error: 'something broke',
    });
    expect(run.status).toBe(TaskStatus.Error);
    expect(run.error).toBe('something broke');
  });

  test('maps running action to running', () => {
    const run = mapGatewayRun({ ...baseEntry, action: 'started' });
    expect(run.status).toBe(TaskStatus.Running);
  });

  test('suppresses delivery-only error to success', () => {
    const run = mapGatewayRun({
      ...baseEntry,
      status: GatewayStatus.Error,
      error: '⚠️ ✉️ Message failed',
      deliveryStatus: 'not-delivered',
      deliveryError: '⚠️ ✉️ Message failed',
      summary: 'Agent produced a valid summary',
    });
    expect(run.status).toBe(TaskStatus.Success);
    expect(run.error).toBeNull();
  });

  test('keeps execution error when deliveryError mirrors the run error', () => {
    const run = mapGatewayRun({
      ...baseEntry,
      status: GatewayStatus.Error,
      error: 'LLM request failed: network connection error.',
      deliveryStatus: 'not-delivered',
      deliveryError: 'LLM request failed: network connection error.',
      summary: 'LLM request failed: network connection error.',
    });
    expect(run.status).toBe(TaskStatus.Error);
    expect(run.error).toBe('LLM request failed: network connection error.');
  });

  test('does not suppress error when error differs from deliveryError', () => {
    const run = mapGatewayRun({
      ...baseEntry,
      status: GatewayStatus.Error,
      error: 'agent crashed',
      deliveryStatus: 'not-delivered',
      deliveryError: '⚠️ ✉️ Message failed',
    });
    expect(run.status).toBe(TaskStatus.Error);
    expect(run.error).toBe('agent crashed');
  });

  test('does not suppress error when no deliveryError is present', () => {
    const run = mapGatewayRun({
      ...baseEntry,
      status: GatewayStatus.Error,
      error: 'timeout',
    });
    expect(run.status).toBe(TaskStatus.Error);
    expect(run.error).toBe('timeout');
  });
});

describe('mapGatewayJob', () => {
  test('keeps native cron fields without legacy wrappers', () => {
    const job = mapGatewayJob({
      id: 'job-1',
      name: 'Morning brief',
      description: 'Send a summary',
      enabled: true,
      schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' },
      sessionTarget: 'isolated',
      wakeMode: 'now',
      payload: { kind: 'agentTurn', message: 'Summarize updates', timeoutSeconds: 45 },
      delivery: { mode: 'announce', channel: 'last', to: 'chat-1' },
      agentId: 'agent-42',
      sessionKey: 'session-1',
      state: {
        nextRunAtMs: 100,
        lastRunAtMs: 90,
        lastRunStatus: 'skipped',
      },
      createdAtMs: 1_700_000_000_000,
      updatedAtMs: 1_700_000_100_000,
    });

    expect(job.schedule.kind).toBe('cron');
    expect((job.schedule as { expr: string }).expr).toBe('0 9 * * *');
    expect((job.schedule as { tz: string }).tz).toBe('Asia/Shanghai');
    expect(job.payload.kind).toBe('agentTurn');
    expect((job.payload as { timeoutSeconds: number }).timeoutSeconds).toBe(45);
    expect(job.delivery).toEqual({
      mode: 'announce',
      channel: 'last',
      to: 'chat-1',
    });
    expect(job.agentId).toBe('agent-42');
    expect(job.sessionKey).toBe('session-1');
    expect(job.state.lastStatus).toBe('skipped');
  });
});

describe('mapGatewayTaskState', () => {
  test('maps ok status to success', () => {
    const state = mapGatewayTaskState({
      lastRunStatus: GatewayStatus.Ok,
      lastRunAtMs: 1700000000000,
    });
    expect(state.lastStatus).toBe(TaskStatus.Success);
    expect(state.lastError).toBeNull();
  });

  test('maps error status to error', () => {
    const state = mapGatewayTaskState({ lastRunStatus: GatewayStatus.Error, lastError: 'fail' });
    expect(state.lastStatus).toBe(TaskStatus.Error);
    expect(state.lastError).toBe('fail');
  });

  test('maps running state', () => {
    const state = mapGatewayTaskState({ runningAtMs: Date.now(), lastRunStatus: GatewayStatus.Ok });
    expect(state.lastStatus).toBe(TaskStatus.Running);
  });

  test('keeps ambiguous delivery error in task state', () => {
    const state = mapGatewayTaskState(
      {
        lastRunStatus: GatewayStatus.Error,
        lastError: '⚠️ ✉️ Message failed',
        lastDeliveryStatus: 'not-delivered',
        lastDeliveryError: '⚠️ ✉️ Message failed',
      },
      DeliveryMode.None,
    );
    expect(state.lastStatus).toBe(TaskStatus.Error);
    expect(state.lastError).toBe('⚠️ ✉️ Message failed');
  });

  test('does not suppress delivery error when delivery mode is announce', () => {
    const state = mapGatewayTaskState(
      {
        lastRunStatus: GatewayStatus.Error,
        lastError: '⚠️ ✉️ Message failed',
        lastDeliveryStatus: 'not-delivered',
        lastDeliveryError: '⚠️ ✉️ Message failed',
      },
      DeliveryMode.Announce,
    );
    expect(state.lastStatus).toBe(TaskStatus.Error);
    expect(state.lastError).toBe('⚠️ ✉️ Message failed');
  });

  test('does not suppress non-delivery errors even for mode none', () => {
    const state = mapGatewayTaskState(
      {
        lastRunStatus: GatewayStatus.Error,
        lastError: 'agent timeout',
      },
      DeliveryMode.None,
    );
    expect(state.lastStatus).toBe(TaskStatus.Error);
    expect(state.lastError).toBe('agent timeout');
  });
});
