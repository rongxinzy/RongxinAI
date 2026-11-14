import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { app, ipcMain } from 'electron';
import { afterEach, expect, test, vi } from 'vitest';
import {
  DeliveryMode,
  PayloadKind,
  ScheduleKind,
  SessionTarget,
  WakeMode,
} from '../../scheduledTask/constants';
import type { ScheduledTask } from '../../scheduledTask/types';
import {
  CoworkExecutionMode,
  CoworkSessionMode,
  CoworkSessionSource,
} from '../../shared/cowork/constants';
import { coworkSessionAdminContract } from '../../shared/ipc/coworkContract';
import { DurableAutomationService } from '../automations/durableAutomationService.mjs';
import { AutomationTaskKind, automationSessionId } from '../automations/automationState.mjs';
import { automationContext } from '../automations/automationStorage.mjs';
import type { CoworkStore } from '../coworkStore';
import { createCoworkStoreHarness } from '../coworkStore/coworkStore.testHarness';
import { DurableModelCatalog } from '../libs/agentEngine/durableModelCatalog.mjs';
import { DurableSession } from '../libs/agentEngine/durableSession.mjs';
import {
  durableSessionFile,
  hasDurableSession,
  listDurableSessionFiles,
} from '../libs/agentEngine/durableSessionStore';
import { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import { registerCoworkSessionAdminIpc } from './sessionAdmin';

const services = vi.hoisted(() => ({
  store: null as CoworkStore | null,
  adapter: null as PiRuntimeAdapter | null,
}));
// Only the application service locator is replaced. IPC validation, teardown,
// native Harness tasks, model provider and both SQLite stores are real.
vi.mock('../appBootstrap/runtimeServices', () => ({ getCoworkStore: () => services.store }));
vi.mock('../appBootstrap/sessionServices', () => ({ getPiRuntimeAdapter: () => services.adapter }));

const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
  vi.restoreAllMocks();
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'delete-native-automation-'));
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  const { db, store } = createCoworkStoreHarness();
  cleanup.push(() => db.close());
  const faux = fauxProvider();
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  const sessions = new Map<string, DurableSession>();
  const createProjection = (id: string) =>
    store.createSession(
      'Automation conversation',
      root,
      '',
      CoworkExecutionMode.Local,
      [],
      'main',
      '',
      CoworkSessionMode.Work,
      id,
      undefined,
      [],
      CoworkSessionSource.Scheduled,
    );
  const options = {
    listSessionFiles: () => listDurableSessionFiles(root),
    fileForSession: (id: string) => durableSessionFile(root, id),
    openAutomationSession: async (job: ScheduledTask, file: string) => {
      const id = automationSessionId(job.id);
      if (!store.getSession(id)) createProjection(id);
      const session = await DurableSession.open({
        cwd: root,
        durableFile: file,
        modelRuntime: catalog,
        model: faux.getModel() as unknown as Record<string, unknown>,
      });
      sessions.set(id, session);
      return session;
    },
  };
  const service = new DurableAutomationService(options);
  cleanup.push(() => service.stop());
  const adapter = new PiRuntimeAdapter();
  adapter.setPiSessionStoreRoot(root);
  adapter.setCoworkStore(store);
  adapter.setScheduledTaskService(service);
  services.store = store;
  services.adapter = adapter;
  vi.spyOn(app, 'getPath').mockReturnValue(root);
  type Handler = (event: unknown, ...args: unknown[]) => unknown;
  const handlers = new Map<string, Handler>();
  vi.spyOn(ipcMain, 'handle').mockImplementation((channel, handler) => {
    handlers.set(channel, handler as Handler);
  });
  registerCoworkSessionAdminIpc({
    getCoworkStore: () => store,
    getPiRuntimeAdapter: () => adapter,
  });
  return { root, store, faux, service, sessions, options, createProjection, handlers };
}

test.each(['single', 'batch'] as const)(
  '%s product deletion unmounts the native schedule before deleting its conversation and database',
  async mode => {
    const f = await fixture();
    const due = Date.now() + 1500;
    const job = await f.service.addJob({
      name: 'Do not execute after deletion',
      description: '',
      enabled: true,
      schedule: { kind: ScheduleKind.At, at: new Date(due).toISOString() },
      sessionTarget: SessionTarget.Task,
      wakeMode: WakeMode.Now,
      payload: { kind: PayloadKind.AgentTurn, message: 'This must never reach the model.' },
      delivery: { mode: DeliveryMode.None },
      sessionKey: null,
    });
    const id = automationSessionId(job.id);
    const session = f.sessions.get(id)!;
    await expect
      .poll(async () =>
        (await session.getDurableHost().harness.inspect(automationContext)).tasks.some(
          task =>
            task.record.kind === AutomationTaskKind.Schedule && task.state.kind === 'sleeping',
        ),
      )
      .toBe(true);
    expect(hasDurableSession(f.root, id)).toBe(true);
    const deleteRows = f.store.deleteSessions.bind(f.store);
    vi.spyOn(f.store, 'deleteSessions').mockImplementation(ids => {
      expect(session.storageClosed).toBe(true);
      expect(hasDurableSession(f.root, id)).toBe(false);
      deleteRows(ids);
    });
    // A historical automation-prefixed conversation with no live definition
    // remains explicitly deletable, including in the batch handler.
    const orphan = automationSessionId('missing-definition');
    if (mode === 'batch') f.createProjection(orphan);
    const contract =
      mode === 'single'
        ? coworkSessionAdminContract.deleteSession
        : coworkSessionAdminContract.deleteSessions;
    const argument = mode === 'single' ? id : [id, orphan];
    await expect(f.handlers.get(contract.channel)!({}, argument)).resolves.toEqual({
      success: true,
    });
    expect(f.store.getSession(id)).toBeNull();
    expect(f.store.getSession(orphan)).toBeNull();
    expect(await f.service.getJob(job.id)).toBeNull();
    expect(await f.service.listJobs()).toEqual([]);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, due - Date.now()) + 100));
    expect(f.faux.state.callCount).toBe(0);
    await f.service.stop();
    const reopened = new DurableAutomationService(f.options);
    cleanup.push(() => reopened.stop());
    expect(await reopened.listJobs()).toEqual([]);
    expect(listDurableSessionFiles(f.root)).toEqual([]);
    expect(f.faux.state.callCount).toBe(0);
  },
);
