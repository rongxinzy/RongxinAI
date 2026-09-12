import { afterEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildSolPiRuntime } from './solPiIntegration';
import { SolPiProfile } from './solPiProfile';
import type { SolPiSessionManagerLike } from './solPiSessionScope';
import {
  createFakeExtensionContext,
  FakeExtensionApi,
  loadVendorModule,
} from './solPiTestFixtures';
import type { SolPiVendorConfig, SolPiVendorOptions } from './solPiVendor';

// Shared mutable state for the default-resolution tests (vi.hoisted so the
// vi.mock factories below can close over it).
const mocks = vi.hoisted(() => ({
  vendorFactoryOptions: [] as Array<unknown>,
  gitBashPath: null as string | null,
}));

vi.mock('./solPiVendor', () => ({
  loadSolPiVendor: async () => ({
    createSolPiExtension: (_loadConfig: unknown, options?: unknown) => {
      mocks.vendorFactoryOptions.push(options);
      return (_pi: unknown) => undefined;
    },
  }),
}));

vi.mock('../coworkUtil', () => ({
  resolveGitBashPathForPi: () => mocks.gitBashPath,
}));

interface VendorEntryModule {
  createSolPiExtension: (
    loadConfig: () => SolPiVendorConfig,
    options?: SolPiVendorOptions,
  ) => (pi: unknown) => void;
}

interface VendorActionFusionModule {
  THEN_RUN_FAILED: string;
  THEN_RUN_SUCCEEDED: string;
}

/** Conservative config with Action Fusion on and ObservationPack off. */
const fusionOnlyConfig = (): SolPiVendorConfig => ({
  version: 1,
  actionFusion: true,
  observationPack: false,
  evidencePreservingReducer: false,
  evidencePreservingReducerModel: 'unused',
  evidencePreservingReducerProvider: 'unused',
  onlineContextCompact: false,
  cacheWriteReadRatio: 12.5,
});

/**
 * Load the vendored entry, build an extension with the given options, and
 * register it on a fake API (upstream registers on session_start).
 */
const loadFusedWriteTool = async (
  options: SolPiVendorOptions | undefined,
  cwd: string,
): Promise<FakeExtensionApi> => {
  const vendor = await loadVendorModule<VendorEntryModule>('index.ts');
  const api = new FakeExtensionApi();
  vendor.createSolPiExtension(() => fusionOnlyConfig(), options)(api);
  await api.emitSessionStart(createFakeExtensionContext(cwd, cwd));
  return api;
};

const writeToolInput = (file: string, content: string, command: string) => ({
  path: file,
  content,
  then_run: { command },
});

const resultText = (result: { content: Array<{ type: string; text?: string }> }): string =>
  result.content.map(block => block.text ?? '').join('\n');

describe('bashOptions threading into the vendored Action Fusion extension', () => {
  test('a commandPrefix option prefixes the fused then_run command', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-bashopt-'));
    const file = path.join(dir, 'prefixed.txt');
    const ctx = createFakeExtensionContext(dir, dir);
    const fusion = await loadVendorModule<VendorActionFusionModule>(
      'extensions/action-fusion/index.ts',
    );

    const api = await loadFusedWriteTool(
      { bashOptions: { commandPrefix: 'echo solpi-pfx &&' } },
      dir,
    );
    const write = api.tools.get('write');
    expect(write).toBeDefined();

    const result = await write!.execute(
      'call-prefix',
      writeToolInput(file, 'payload', 'printf solpi-ran'),
      undefined,
      undefined,
      ctx,
    );
    const text = resultText(result);
    expect(text).toContain(fusion.THEN_RUN_SUCCEEDED);
    // The marker only appears if the prefix actually ran before the command.
    expect(text).toContain('solpi-pfx');
    expect(text).toContain('solpi-ran');
    expect(readFileSync(file, 'utf8')).toBe('payload');
  });

  test('without options the fused command runs without the prefix (differential)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-bashopt-'));
    const file = path.join(dir, 'plain.txt');
    const ctx = createFakeExtensionContext(dir, dir);

    const api = await loadFusedWriteTool(undefined, dir);
    const write = api.tools.get('write');
    const result = await write!.execute(
      'call-plain',
      writeToolInput(file, 'payload', 'printf solpi-ran'),
      undefined,
      undefined,
      ctx,
    );
    const text = resultText(result);
    expect(text).toContain('solpi-ran');
    expect(text).not.toContain('solpi-pfx');
    expect(readFileSync(file, 'utf8')).toBe('payload');
  });

  test('a shellPath option reaches the inner bash: the write lands but then_run fails', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'solpi-bashopt-'));
    const file = path.join(dir, 'gated.txt');
    const ctx = createFakeExtensionContext(dir, dir);
    const fusion = await loadVendorModule<VendorActionFusionModule>(
      'extensions/action-fusion/index.ts',
    );

    const api = await loadFusedWriteTool(
      { bashOptions: { shellPath: '/nonexistent/solpi-gate-shell' } },
      dir,
    );
    const write = api.tools.get('write')!;

    const failure = await write
      .execute(
        'call-gate',
        writeToolInput(file, 'payload', 'printf never'),
        undefined,
        undefined,
        ctx,
      )
      .then(
        () => {
          throw new Error('expected the fused call to fail');
        },
        (error: unknown) => error,
      );
    const message = failure instanceof Error ? failure.message : String(failure);
    expect(message).toContain(fusion.THEN_RUN_FAILED);
    expect(message).toContain('Custom shell path not found: /nonexistent/solpi-gate-shell');
    // The file mutation itself completed before the gated shell rejected it.
    expect(readFileSync(file, 'utf8')).toBe('payload');
  });
});

describe('buildSolPiRuntime bashOptions default resolution', () => {
  const fakeInMemoryManager = (): SolPiSessionManagerLike & Record<string, unknown> => {
    const manager = {
      cwd: '',
      getSessionDir: (): string => '',
      getSessionId: (): string => 'pi-inner-session',
      appendMessage: (): void => undefined,
    };
    return manager;
  };

  const baseOptions = {
    createInMemorySessionManager: fakeInMemoryManager,
    cwd: '/workspace/demo',
    sessionId: 'app-session-1',
    authorizeThenRun: async () => ({ allow: true }),
  };

  afterEach(() => {
    mocks.gitBashPath = null;
    mocks.vendorFactoryOptions.length = 0;
  });

  test('non-win32 without explicit options passes no vendor options', async () => {
    const userData = mkdtempSync(path.join(tmpdir(), 'solpi-default-'));
    const parts = await buildSolPiRuntime({
      ...baseOptions,
      profile: SolPiProfile.Conservative,
      userDataPath: userData,
    });
    expect(parts).not.toBeNull();
    expect(mocks.vendorFactoryOptions).toEqual([undefined]);
  });

  test('win32 threads the resolved git-bash shell path into the vendor factory', async () => {
    mocks.gitBashPath = '/mocked/PortableGit/bin/bash.exe';
    const userData = mkdtempSync(path.join(tmpdir(), 'solpi-default-'));
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      const parts = await buildSolPiRuntime({
        ...baseOptions,
        profile: SolPiProfile.Conservative,
        userDataPath: userData,
      });
      expect(parts).not.toBeNull();
      expect(mocks.vendorFactoryOptions).toEqual([
        { bashOptions: { shellPath: '/mocked/PortableGit/bin/bash.exe' } },
      ]);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  test('win32 with an unresolvable shell passes no vendor options', async () => {
    mocks.gitBashPath = null;
    const userData = mkdtempSync(path.join(tmpdir(), 'solpi-default-'));
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      await buildSolPiRuntime({
        ...baseOptions,
        profile: SolPiProfile.Conservative,
        userDataPath: userData,
      });
      expect(mocks.vendorFactoryOptions).toEqual([undefined]);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });

  test('explicit caller options win over the platform default', async () => {
    mocks.gitBashPath = '/mocked/PortableGit/bin/bash.exe';
    const userData = mkdtempSync(path.join(tmpdir(), 'solpi-default-'));
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      await buildSolPiRuntime({
        ...baseOptions,
        profile: SolPiProfile.Conservative,
        userDataPath: userData,
        bashOptions: { shellPath: '/explicit/shell', commandPrefix: 'echo pfx &&' },
      });
      expect(mocks.vendorFactoryOptions).toEqual([
        { bashOptions: { shellPath: '/explicit/shell', commandPrefix: 'echo pfx &&' } },
      ]);
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    }
  });
});
