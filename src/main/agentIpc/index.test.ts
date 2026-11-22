import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { AgentId, AgentIpcChannel } from '../../shared/agent/constants';
import { CoworkExecutionMode } from '../../shared/cowork/constants';
import { AgentManager } from '../agentManager';
import { createCoworkSessionDeletion } from '../coworkSessionDeletion';
import { createCoworkStoreHarness } from '../coworkStore/coworkStore.testHarness';
import { IMStore } from '../im/imStore';
import { initializeIMSchema } from '../im/schema';
import { ProjectMemoryService } from '../memory/projectMemoryService';
import { resolveProjectIdentity } from '../memory/projectIdentity';
import { MemoryRepository } from '../memory/repository';
import { WorkbenchTaskService } from '../workbenchTask/taskService';
import { initializeWorkbenchTaskSchema } from '../workbenchTask/schema';
import { registerAgentIpc } from './index';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: object, id: string) => Promise<unknown>>(),
  forgetCoworkSession: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {},
  ipcMain: {
    handle: (...args: Parameters<typeof mocks.handlers.set>) => mocks.handlers.set(...args),
  },
}));
let harness: ReturnType<typeof createCoworkStoreHarness>;
let im: IMStore;
let repository: MemoryRepository;
const bumpCodingCommandCatalog = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  harness = createCoworkStoreHarness();
  const now = Date.now();
  harness.db
    .prepare(
      'INSERT INTO agents (id, name, is_default, created_at, updated_at) VALUES (?, ?, 1, ?, ?)',
    )
    .run(AgentId.Main, AgentId.Main, now, now);
  const manager = new AgentManager(harness.store);
  initializeIMSchema(harness.db);
  initializeWorkbenchTaskSchema(harness.db);
  const workbench = new WorkbenchTaskService(harness.db);
  im = new IMStore(harness.db);
  repository = new MemoryRepository(harness.db);
  const memory = new ProjectMemoryService(
    repository,
    {} as never,
    resolveProjectIdentity,
    '/memory',
  );
  const deleteCoworkSessions = createCoworkSessionDeletion({
    getCoworkStore: () => harness.store,
    getProjectMemoryService: () => memory,
    getIMStore: () => im,
    getWorkbenchTaskService: () => workbench,
    forgetSession: mocks.forgetCoworkSession,
  });
  registerAgentIpc({
    getAgentManager: () => manager,
    getSkillManager: vi.fn(),
    deleteAgentWithSessions: id =>
      deleteCoworkSessions({ agentId: id }, () => manager.deleteAgent(id)),
    bumpCodingCommandCatalog,
    resolveDefaultAgentModelRef: () => '',
  });
});

afterEach(() => harness.db.close());

test.each([AgentId.Main, 'missing-agent'])(
  'keeps sessions when %s is not deleted',
  async agentId => {
    const session = harness.store.createSession(
      'Keep me',
      '/work',
      '',
      CoworkExecutionMode.Local,
      [],
      agentId,
    );
    im.createSessionMapping('keep', 'feishu', session.id);

    await expect(mocks.handlers.get(AgentIpcChannel.Delete)!({}, agentId)).resolves.toEqual({
      success: true,
      deleted: false,
    });
    expect(harness.store.getSession(session.id)).not.toBeNull();
    expect(mocks.forgetCoworkSession).not.toHaveBeenCalled();
    expect(im.getSessionMappingByCoworkSessionId(session.id)).not.toBeNull();
    expect(repository.listPending()).toEqual([]);
    expect(bumpCodingCommandCatalog).not.toHaveBeenCalled();
  },
);

test('rolls back an agent delete when deleting its sessions fails and cleans up on successful retry', async () => {
  const agent = harness.store.createAgent({ name: 'Deletable Expert' });
  const session = harness.store.createSession(
    'Expert session',
    '/work',
    '',
    CoworkExecutionMode.Local,
    [],
    agent.id,
  );
  const historyKey = harness.store.getPiHistoryKey(session.id);
  im.createSessionMapping('expert-channel', 'feishu', session.id);
  harness.db.exec(`
    CREATE TRIGGER reject_agent_sessions BEFORE DELETE ON cowork_sessions
    BEGIN SELECT RAISE(ABORT, 'sessions rejected'); END;
  `);
  const deleteAgent = mocks.handlers.get(AgentIpcChannel.Delete)!;

  await expect(deleteAgent({}, agent.id)).resolves.toEqual({
    success: false,
    error: 'sessions rejected',
  });
  expect(harness.store.getAgent(agent.id)).not.toBeNull();
  expect(harness.store.getSession(session.id)).not.toBeNull();
  expect(im.getSessionMappingByCoworkSessionId(session.id)).not.toBeNull();
  expect(repository.listPending()).toEqual([]);
  expect(mocks.forgetCoworkSession).not.toHaveBeenCalled();
  expect(bumpCodingCommandCatalog).not.toHaveBeenCalled();

  harness.db.exec('DROP TRIGGER reject_agent_sessions');
  await expect(deleteAgent({}, agent.id)).resolves.toEqual({
    success: true,
    deleted: true,
    deletedSessionIds: [session.id],
  });
  expect(harness.store.getAgent(agent.id)).toBeNull();
  expect(harness.store.getSession(session.id)).toBeNull();
  expect(mocks.forgetCoworkSession).toHaveBeenCalledExactlyOnceWith(session.id, historyKey);
  expect(im.getSessionMappingByCoworkSessionId(session.id)).toBeNull();
  expect(repository.listPending()).toMatchObject([{ payload: { sessionId: session.id } }]);
  expect(bumpCodingCommandCatalog).toHaveBeenCalledTimes(1);
});
