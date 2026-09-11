import { describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSolPiRuntime } from './solPiIntegration';
import { SolPiProfile } from './solPiProfile';
import type { SolPiSessionManagerLike } from './solPiSessionScope';
import { FakeExtensionApi } from './solPiTestFixtures';

const fakeInMemoryManager = (): SolPiSessionManagerLike & Record<string, unknown> => {
  const manager = {
    cwd: '',
    getSessionDir: (): string => '',
    getSessionId: (): string => 'pi-inner-session',
    appendMessage: (): void => undefined,
  };
  return manager;
};

describe('buildSolPiRuntime', () => {
  const baseOptions = {
    createInMemorySessionManager: fakeInMemoryManager,
    cwd: '/workspace/demo',
    sessionId: 'app-session-1',
    authorizeThenRun: async () => ({ allow: true }),
  };

  test('returns null when the profile is off (default)', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'solpi-int-'));
    const parts = await buildSolPiRuntime({
      ...baseOptions,
      profile: SolPiProfile.Off,
      userDataPath: userData,
    });
    expect(parts).toBeNull();
  });

  test('conservative profile wires guard + vendored extension over an app-owned session dir', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'solpi-int-'));
    const parts = await buildSolPiRuntime({
      ...baseOptions,
      profile: SolPiProfile.Conservative,
      userDataPath: userData,
    });
    expect(parts).not.toBeNull();
    // Guard factory + vendored SoL-Pi factory.
    expect(parts!.extensionFactories).toHaveLength(2);

    // The wrapped manager keeps the in-memory delegation but exposes the
    // app-owned storage directory.
    expect(parts!.sessionManager.getSessionId()).toBe('pi-inner-session');
    expect(parts!.sessionManager.getSessionDir()).toBe(
      path.join(userData, 'solPi', 'sessions', 'app-session-1'),
    );
    expect(parts!.storageDir).toBe(path.join(userData, 'solPi', 'sessions', 'app-session-1'));
    // Delegation to the in-memory base stays intact.
    expect((parts!.sessionManager as unknown as Record<string, unknown>).appendMessage).toBeTypeOf(
      'function',
    );
  });

  test('conservative profile registers fused edit/write and obs_recall on a fake API', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'solpi-int-'));
    const parts = await buildSolPiRuntime({
      ...baseOptions,
      profile: SolPiProfile.Conservative,
      userDataPath: userData,
    });
    const api = new FakeExtensionApi();
    parts!.extensionFactories.forEach(factory => factory(api as never));
    // The vendored entry registers its features on session_start (upstream
    // behavior); trigger it like Pi would.
    await api.emitSessionStart(undefined);

    expect(api.tools.get('edit')).toBeDefined();
    expect(api.tools.get('write')).toBeDefined();
    // The fused write schema exposes then_run; the base schema stays intact.
    const writeParameters = api.tools.get('write')!.parameters as {
      properties: Record<string, unknown>;
    };
    expect(writeParameters.properties).toHaveProperty('then_run');
    expect(writeParameters.properties).toHaveProperty('path');
    expect(api.tools.get('obs_recall')).toBeDefined();
    // No tools from disabled mechanisms.
    expect([...api.tools.keys()].sort()).toEqual(['edit', 'obs_recall', 'write']);
  });
});
