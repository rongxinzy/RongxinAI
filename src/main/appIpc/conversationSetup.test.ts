import { beforeEach, expect, test, vi } from 'vitest';
import { AppConfigIpc } from '../../shared/ipc/channels';
import { registerConversationSetupIpc } from './conversationSetup';

const { handlers, title } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, ...args: unknown[]) => Promise<unknown>>(),
  title: vi.fn(async () => 'Generated title'),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => Promise<unknown>) =>
      handlers.set(channel, handler),
  },
}));
vi.mock('../libs/coworkUtil', () => ({ generateSessionTitle: title }));
vi.mock('../i18n', () => ({ t: () => 'New task' }));

beforeEach(() => {
  handlers.clear();
  title.mockClear();
});
const invoke = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

test('registers only conversation setup and resolves model readiness after startup', async () => {
  let ready = false;
  registerConversationSetupIpc({
    getCoworkStore: () => ({ listRecentCwds: () => [] }),
    isInternalWorkspacePath: () => false,
    getMagpieModelService: () =>
      ready ? { checkReadiness: async () => ({ hasConfig: true, config: null }) } : undefined,
  });
  expect([...handlers.keys()].sort()).toEqual(
    [
      AppConfigIpc.CheckApiConfig,
      AppConfigIpc.GenerateSessionTitle,
      AppConfigIpc.GetRecentCwds,
    ].sort(),
  );
  expect(await invoke(AppConfigIpc.CheckApiConfig)).toEqual({ hasConfig: false, config: null });
  ready = true;
  expect(await invoke(AppConfigIpc.CheckApiConfig)).toEqual({ hasConfig: true, config: null });
  expect(await invoke(AppConfigIpc.GenerateSessionTitle, 'Analyze the sales report')).toBe(
    'Generated title',
  );
  expect(title).toHaveBeenCalledWith('Analyze the sales report', 'New task');
});

test('keeps recent projects bounded and hides internal workspace paths', async () => {
  const listRecentCwds = vi.fn(() => ['/internal/default', '/projects/a', '/projects/b']);
  registerConversationSetupIpc({
    getCoworkStore: () => ({ listRecentCwds }),
    getMagpieModelService: () => undefined,
    isInternalWorkspacePath: cwd => cwd.startsWith('/internal/'),
  });
  expect(await invoke(AppConfigIpc.GetRecentCwds, 1)).toEqual(['/projects/a']);
  expect(listRecentCwds).toHaveBeenCalledWith(20);
  await expect(invoke(AppConfigIpc.GetRecentCwds, 'invalid')).rejects.toThrow('invalid arguments');
});
