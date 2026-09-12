import { describe, expect, test, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSolPiRuntime } from './solPiIntegration';
import { SolPiProfile } from './solPiProfile';
import type { SolPiSessionManagerLike } from './solPiSessionScope';
import { FakeExtensionApi } from './solPiTestFixtures';

// Marker compute hooks: pin that buildSolPiRuntime actually threads the pool
// API into the vendored projection path (a dropped hook would silently
// revert that observation to main-thread hashing with every other test
// green). Null return mirrors the pool's fail-open contract.
const markers = vi.hoisted(() => {
  const calls: Array<{ runtimeRoot: string; bytes: number }> = [];
  return {
    calls,
    compute: {
      prepareObservation: async (
        message: { content: Array<{ type: string; text: string }> },
        runtimeRoot: string,
      ): Promise<null> => {
        calls.push({ runtimeRoot, bytes: message.content[0]?.text.length ?? 0 });
        return null;
      },
      fileHash: async (): Promise<string> => 'marker-file-hash',
      hashBuffer: async (): Promise<string> => 'marker-buffer-hash',
    },
  };
});
vi.mock('./solPiComputePool', () => ({ getSolPiCompute: () => markers.compute }));

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

  test('threads the compute pool hooks into the vendored projection path', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'solpi-int-'));
    const parts = await buildSolPiRuntime({
      ...baseOptions,
      profile: SolPiProfile.Conservative,
      userDataPath: userData,
    });
    expect(parts).not.toBeNull();
    const api = new FakeExtensionApi();
    parts!.extensionFactories.forEach(factory => factory(api as never));
    await api.emitSessionStart(undefined);
    const ctx = { cwd: baseOptions.cwd, sessionManager: parts!.sessionManager };

    const big = `${'0123456789abcdef\n'.repeat(4096)}`;
    const message = {
      role: 'toolResult',
      toolCallId: 'call-big',
      toolName: 'bash',
      isError: false,
      content: [{ type: 'text', text: big }],
    };
    const projected = (await api.emitContext([message], ctx)) as typeof message[];

    // The marker hook ran, against the app-owned runtime root.
    expect(markers.calls.length).toBeGreaterThanOrEqual(1);
    expect(markers.calls[0].runtimeRoot).toBe(path.join(parts!.storageDir, 'sol-pi'));
    expect(markers.calls[0].bytes).toBe(big.length);
    // Null (pool fail-open) keeps the full text in context.
    expect((projected[0].content[0] as { text: string }).text).toBe(big);
  });
});
