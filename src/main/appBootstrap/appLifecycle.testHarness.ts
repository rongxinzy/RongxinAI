import { afterEach, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  on: vi.fn<(event: string, listener: (event: { preventDefault(): void }) => void) => void>(),
  exit: vi.fn(),
  close: vi.fn(),
  persistWindowState: vi.fn(),
  getStorePreference: vi.fn(),
  disconnectAgents: vi.fn<(signal?: AbortSignal) => Promise<void>>(),
  closeMagpieAdmission: vi.fn<() => Promise<void>>(),
  stopMagpie: vi.fn<() => Promise<void>>(),
  stopManagedGateway: vi.fn<() => Promise<void>>(),
  stopPython: vi.fn<() => Promise<void>>(),
  stopChannel: vi.fn<() => Promise<void>>(),
  stopChannelProcesses: vi.fn<() => Promise<void>>(),
  stopBackup: vi.fn<typeof import('./runtimeServices').shutdownSqliteBackup>(),
  stopSkillWatcher: vi.fn<() => Promise<void>>(),
  stopSkillScripts: vi.fn<() => Promise<void>>(),
  stopUpdates: vi.fn<() => Promise<void>>(),
  shutdownMcpAuthorizations: vi.fn<() => Promise<void>>(),
  shutdownMcpOAuthRefreshes: vi.fn<() => Promise<void>>(),
  shutdownMcp: vi.fn<() => Promise<void>>(),
  destroyTray: vi.fn(),
  disposeDesktopPet: vi.fn(),
  disposeCompanionWindow: vi.fn<typeof import('../companion/window').disposeCompanionWindow>(),
  drainDesktopPetSensors: vi.fn<() => Promise<void>>(),
  shutdownMemory: vi.fn<() => Promise<void>>(),
  stopEngram: vi.fn<() => Promise<void>>(),
  stopTodoReminders: vi.fn(),
  interruptCompanion: vi.fn(),
  stopSessionRuntime: vi.fn<typeof import('./sessionServices').shutdownSessionRuntime>(),
  shutdownCodingRoom: vi.fn<import('./codingRoomRuntime').CodingRoomRuntime['stop']>(),
  stopLocalInference: vi.fn<
    (readyToStop: Promise<void>) => {
      drained: Promise<void>;
      stopped: Promise<void>;
    }
  >(),
  drainPromotions: vi.fn<typeof import('./sessionServices').drainSettledRunPromotions>(),
}));
const lifecycleRuntime = vi.hoisted(() => ({ isQuitting: false }));
vi.mock('electron', () => ({
  app: { on: mocks.on, exit: mocks.exit, whenReady: () => Promise.resolve() },
  BrowserWindow: { getAllWindows: () => [] },
}));
vi.mock('./ccConnectRuntime', () => ({
  drainCcConnectIngress: mocks.stopChannel,
  stopCcConnectProcesses: mocks.stopChannelProcesses,
}));
vi.mock('./lifecycleRuntimeState', () => ({ lifecycleRuntime }));
vi.mock('./windowManagement', () => ({ persistAppWindowState: mocks.persistWindowState }));
vi.mock('../todo/ipc', () => ({ stopTodoReminders: mocks.stopTodoReminders }));
vi.mock('./runtimeServices', () => ({
  clearActiveRunSleepBlockers: vi.fn(),
  closeStore: mocks.close,
  getStoreIfOpen: () => ({ get: mocks.getStorePreference }),
  shutdownSqliteBackup: mocks.stopBackup,
  shutdownAppUpdates: mocks.stopUpdates,
  shutdownSkillManager: mocks.stopSkillWatcher,
}));
vi.mock('./companionTasks', () => ({ interruptCompanionChat: mocks.interruptCompanion }));
vi.mock('./mcpBootstrap', () => ({ shutdownMcpBridge: mocks.shutdownMcp }));
vi.mock('./mcpOAuthHeaders', () => ({
  shutdownMcpOAuthRefreshes: mocks.shutdownMcpOAuthRefreshes,
}));
vi.mock('./sessionServices', () => ({
  drainSettledRunPromotions: mocks.drainPromotions,
  shutdownMemoryWrites: mocks.shutdownMemory,
  stopEngram: mocks.stopEngram,
  shutdownSessionRuntime: mocks.stopSessionRuntime,
}));
vi.mock('../trayManager', () => ({ destroyTray: mocks.destroyTray }));
vi.mock('../desktopPet/controller', () => ({ disposeDesktopPet: mocks.disposeDesktopPet }));
vi.mock('../desktopPet/windows/observer', () => ({
  drainDesktopPetSensors: mocks.drainDesktopPetSensors,
}));
vi.mock('../companion/window', () => ({ disposeCompanionWindow: mocks.disposeCompanionWindow }));
vi.mock('../enterpriseExtension/host', () => ({
  disposeZhiyuanEnterpriseExtension: async () => {},
}));
vi.mock('../pythonRuntime/host', () => ({ shutdownPythonRuntime: mocks.stopPython }));
vi.mock('../libs/skillRuntimeRunner', () => ({
  shutdownManagedSkillScripts: mocks.stopSkillScripts,
}));

const loadLifecycle = () => import('./appLifecycle');
const loadQuitOrigin = () => import('../appQuitOrigin');
const signals = ['SIGINT', 'SIGTERM'] as const;
const listeners: Array<() => void> = [];

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  lifecycleRuntime.isQuitting = false;
  mocks.closeMagpieAdmission.mockResolvedValue(undefined);
  mocks.stopPython.mockResolvedValue(undefined);
  mocks.stopChannel.mockResolvedValue(undefined);
  mocks.stopChannelProcesses.mockResolvedValue(undefined);
  mocks.stopBackup.mockReturnValue(undefined);
  mocks.stopSkillWatcher.mockResolvedValue(undefined);
  mocks.stopSkillScripts.mockResolvedValue(undefined);
  mocks.stopUpdates.mockResolvedValue(undefined);
  mocks.shutdownMcp.mockResolvedValue(undefined);
  mocks.drainDesktopPetSensors.mockResolvedValue(undefined);
  mocks.shutdownMemory.mockResolvedValue(undefined);
  mocks.stopEngram.mockResolvedValue(undefined);
  mocks.drainPromotions.mockReturnValue({
    writes: Promise.resolve([]),
    modelCompletions: Promise.resolve([]),
  });
  mocks.stopLocalInference.mockImplementation(readyToStop => ({
    drained: readyToStop,
    stopped: readyToStop,
  }));
  mocks.shutdownCodingRoom.mockReturnValue(undefined);
});

afterEach(() => {
  for (const remove of listeners.splice(0)) remove();
  vi.useRealTimers();
});

async function register(startup = Promise.resolve()) {
  const { registerAppLifecycleHandlers } = await loadLifecycle();
  const previousListeners = signals.map(signal => new Set(process.listeners(signal)));
  registerAppLifecycleHandlers(
    mocks.shutdownMcpAuthorizations,
    {
      closeAdmission: mocks.closeMagpieAdmission,
      disconnectExternalAgents: mocks.disconnectAgents,
      shutdown: mocks.stopMagpie,
      stopManagedGateway: mocks.stopManagedGateway,
    },
    { stop: mocks.stopLocalInference },
    mocks.shutdownCodingRoom,
    startup,
  );
  await Promise.resolve();
  return Object.fromEntries(
    signals.map((signal, index) => {
      const listener = process
        .listeners(signal)
        .find(candidate => !previousListeners[index].has(candidate))!;
      listeners.push(() => process.removeListener(signal, listener));
      return [signal, () => listener(signal)] as const;
    }),
  );
}

export { lifecycleRuntime, loadQuitOrigin, mocks, register, signals };
