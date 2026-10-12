import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ControlEvent, JsonObject } from '@aep/sdk-node';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { AgentControlRuntime } from './runtime.js';
import { AgentControlState } from './state.js';
import { type AgentControlClient, InboxState, type SkillReconciler } from './types.js';

const temporaryDirectories: string[] = [];
const now = new Date('2026-08-26T01:00:00.000Z');

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('Agent control runtime', () => {
  test('persists an event before acknowledgement and leaves the cursor unchanged on failure', async () => {
    const state = createState();
    const event = controlEvent();
    const acknowledge = vi.fn(async () => {
      expect(state.listPendingInbox().map(item => item.deliveryId)).toContain(event.deliveryId);
      throw new Error('connection lost');
    });
    const client = clientFixture({
      heartbeat: async () => heartbeat(true),
      listControlEvents: async () => ({ items: [event], nextCursor: event.cursor }),
      acknowledgeControlEvent: acknowledge,
    });
    const runtime = createRuntime(client, state);
    try {
      await expect(runtime.runOnce()).rejects.toThrow('connection lost');
      expect(acknowledge).toHaveBeenCalledOnce();
      expect(state.listPendingInbox()).toHaveLength(1);
      expect(state.getValue('control_cursor')).toBeNull();
    } finally {
      state.close();
    }
  });

  test('acknowledges, executes, reports, and flushes telemetry end to end', async () => {
    const state = createState();
    const event = controlEvent();
    state.persistInbox(event);
    const reportResult = vi.fn<AgentControlClient['reportControlEventResult']>(
      async () => undefined,
    );
    const reportSkillSync = vi.fn<AgentControlClient['reportSkillSyncResult']>(
      async () => undefined,
    );
    const uploadTelemetry = vi.fn(async (events: JsonObject[]) => ({
      accepted: events.map(item => String(item.eventId)),
      rejected: [],
    }));
    const client = clientFixture({
      reportControlEventResult: reportResult,
      reportSkillSyncResult: reportSkillSync,
      uploadEventBatch: uploadTelemetry,
    });
    const reconciler = reconcilerFixture();
    const runtime = createRuntime(client, state, reconciler);
    try {
      await expect(runtime.runOnce()).resolves.toBe(30_000);
      expect(reportResult.mock.calls.map(call => call[1])).toEqual([
        expect.objectContaining({ status: 'running' }),
        expect.objectContaining({ status: 'succeeded', appliedRevision: 'revision-1' }),
      ]);
      expect(reportSkillSync).toHaveBeenCalledWith({
        revision: 'revision-1',
        status: 'succeeded',
        items: [{ skillId: 'demo', status: 'installed' }],
      });
      expect(uploadTelemetry).toHaveBeenCalledWith([
        expect.objectContaining({
          eventId: 'telemetry-1',
          type: 'skill.sync.completed',
          result: 'success',
        }),
      ]);
      expect(state.listPendingInbox()).toEqual([]);
      expect(state.listTelemetry()).toEqual([]);
    } finally {
      state.close();
    }
  });

  test('resumes running work without sending a duplicate running transition', async () => {
    const state = createState();
    const event = controlEvent();
    state.persistInbox(event);
    state.setInboxState(event.deliveryId, InboxState.Running);
    const reportResult = vi.fn<AgentControlClient['reportControlEventResult']>(
      async () => undefined,
    );
    const runtime = createRuntime(clientFixture({ reportControlEventResult: reportResult }), state);
    try {
      await runtime.runOnce();
      expect(reportResult).toHaveBeenCalledTimes(1);
      expect(reportResult).toHaveBeenCalledWith(
        event.deliveryId,
        expect.objectContaining({ status: 'succeeded' }),
      );
    } finally {
      state.close();
    }
  });

  test.each([
    {
      name: 'expired event',
      event: controlEvent({ expiresAt: '2026-08-26T00:59:59.000Z' }),
      errorCode: 'EVENT_EXPIRED',
    },
    {
      name: 'unsupported task',
      event: controlEvent({ task: { type: 'plugin.reconcile' } }),
      errorCode: 'UNSUPPORTED_TASK',
    },
  ])('reports an $name once as a terminal failure', async ({ event, errorCode }) => {
    const state = createState();
    state.persistInbox(event);
    const reportResult = vi.fn<AgentControlClient['reportControlEventResult']>(
      async () => undefined,
    );
    const reconciler = reconcilerFixture();
    const runtime = createRuntime(
      clientFixture({ reportControlEventResult: reportResult }),
      state,
      reconciler,
    );
    try {
      await runtime.runOnce();
      await runtime.runOnce();
      expect(reportResult).toHaveBeenCalledTimes(errorCode === 'UNSUPPORTED_TASK' ? 2 : 1);
      expect(reportResult).toHaveBeenLastCalledWith(
        event.deliveryId,
        expect.objectContaining({
          status: 'failed',
          errorCode,
          retryable: false,
        }),
      );
      expect(reconciler.reconcile).not.toHaveBeenCalled();
      expect(state.listPendingInbox()).toEqual([]);
    } finally {
      state.close();
    }
  });

  test('retains telemetry not accepted by the service', async () => {
    const state = createState();
    state.enqueueTelemetry({ eventId: 'retry-me', type: 'skill.sync.failed' });
    const uploadTelemetry = vi.fn(async () => ({ accepted: [], rejected: [] }));
    const runtime = createRuntime(clientFixture({ uploadEventBatch: uploadTelemetry }), state);
    try {
      await runtime.flushTelemetry();
      expect(state.listTelemetry()).toEqual([{ eventId: 'retry-me', type: 'skill.sync.failed' }]);
    } finally {
      state.close();
    }
  });

  test('coalesces concurrent cycles so control work cannot overlap', async () => {
    const state = createState();
    let releaseHeartbeat: () => void = () => {};
    const heartbeatGate = new Promise<void>(resolve => {
      releaseHeartbeat = resolve;
    });
    const heartbeatRequest = vi.fn(async () => {
      await heartbeatGate;
      return heartbeat(false);
    });
    const runtime = createRuntime(clientFixture({ heartbeat: heartbeatRequest }), state);
    try {
      const first = runtime.runOnce();
      const second = runtime.runOnce();
      expect(first).toBe(second);
      await vi.waitFor(() => expect(heartbeatRequest).toHaveBeenCalledOnce());
      releaseHeartbeat();
      await expect(Promise.all([first, second])).resolves.toEqual([30_000, 30_000]);
      expect(heartbeatRequest).toHaveBeenCalledOnce();
    } finally {
      state.close();
    }
  });
});

function createRuntime(
  client: AgentControlClient,
  state: AgentControlState,
  reconciler = reconcilerFixture(),
): AgentControlRuntime {
  return new AgentControlRuntime({
    client,
    state,
    reconciler,
    agentVersion: '2026.8.0',
    platform: 'windows',
    now: () => now,
    createEventId: () => 'telemetry-1',
  });
}

function createState(): AgentControlState {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-agent-runtime-'));
  temporaryDirectories.push(directory);
  return new AgentControlState(path.join(directory, 'state.sqlite'));
}

function reconcilerFixture(): SkillReconciler & { reconcile: ReturnType<typeof vi.fn> } {
  return {
    reconcile: vi.fn(async () => ({
      revision: 'revision-1',
      items: [{ skillId: 'demo', version: '1.0.0', status: 'installed' as const }],
    })),
  };
}

function clientFixture(overrides: Partial<AgentControlClient> = {}): AgentControlClient {
  return {
    getSkillManifest: async () => ({ notModified: true, etag: null }),
    downloadSkillPackage: async () => new Uint8Array(),
    reportSkillSyncResult: async () => undefined,
    uploadEventBatch: async events => ({
      accepted: events.map(item => String(item.eventId)),
      rejected: [],
    }),
    heartbeat: async () => heartbeat(false),
    listControlEvents: async () => ({ items: [], nextCursor: null }),
    acknowledgeControlEvent: async () => undefined,
    reportControlEventResult: async () => undefined,
    ...overrides,
  };
}

function heartbeat(hasPendingControlEvents: boolean) {
  return {
    serverTime: now.toISOString(),
    controlEvents: { pending: hasPendingControlEvents, watermark: '' },
    nextHeartbeatAfterSeconds: 30,
  };
}

function controlEvent(overrides: Partial<ControlEvent> = {}): ControlEvent {
  return {
    deliveryId: 'delivery-1',
    eventId: 'event-1',
    cursor: '1',
    type: 'skill.manifest.changed',
    scope: { type: 'global' },
    resource: { type: 'skill', id: 'demo', revision: 'revision-1' },
    task: { type: 'skill.reconcile' },
    createdAt: '2026-08-26T00:00:00.000Z',
    expiresAt: '2026-08-27T00:00:00.000Z',
    ...overrides,
  };
}
