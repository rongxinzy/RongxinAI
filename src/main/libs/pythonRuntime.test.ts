import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  userData: '',
  resourcesPath: '',
  appPath: '/nonexistent/app-path',
  copyCalls: [] as Array<{ from: string; to: string }>,
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => fixture.userData,
    getAppPath: () => fixture.appPath,
    isPackaged: true,
  },
}));

vi.mock('../fsCompat', () => ({
  cpRecursiveSync: (from: string, to: string) => {
    fixture.copyCalls.push({ from, to });
    fs.cpSync(from, to, { recursive: true, force: true });
  },
}));

const temporaryDirectories: string[] = [];

function makeSandbox(): { userData: string; resourcesPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-python-runtime-'));
  temporaryDirectories.push(root);
  return {
    userData: path.join(root, 'user'),
    resourcesPath: path.join(root, 'resources'),
  };
}

async function importRuntime(platform: NodeJS.Platform) {
  // IS_WINDOWS and the runtime directory name are captured at module load,
  // so each scenario loads a fresh module under a stubbed platform. The
  // resources path is read at call time and stays stubbed for the test body.
  vi.resetModules();
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  process.resourcesPath = fixture.resourcesPath;
  try {
    return await import('./pythonRuntime');
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  }
}

afterEach(() => {
  fixture.copyCalls.length = 0;
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('windows executes the bundled junction without copying and reclaims the legacy user copy', async () => {
  const sandbox = makeSandbox();
  fixture.userData = sandbox.userData;
  fixture.resourcesPath = sandbox.resourcesPath;
  const bundledRoot = path.join(sandbox.resourcesPath, 'python-win');
  fs.mkdirSync(bundledRoot, { recursive: true });
  fs.writeFileSync(path.join(bundledRoot, 'python.exe'), 'exe');
  fs.writeFileSync(path.join(bundledRoot, 'python3.exe'), 'exe');
  const legacyRoot = path.join(sandbox.userData, 'runtimes', 'python-win');
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, 'python.exe'), 'exe');

  const runtime = await importRuntime('win32');
  const result = await runtime.ensurePythonRuntimeReady();

  expect(result.success).toBe(true);
  expect(fixture.copyCalls).toHaveLength(0);
  expect(fs.existsSync(legacyRoot)).toBe(false);

  const env = runtime.appendPythonRuntimeToEnv({});
  expect(env.ZHIYUAN_PYTHON_ROOT).toBe(bundledRoot);
  expect(runtime.getManagedPythonExecutable()).toBe(path.join(bundledRoot, 'python.exe'));
});

test('windows falls back to a healthy legacy user copy when the junction is missing', async () => {
  const sandbox = makeSandbox();
  fixture.userData = sandbox.userData;
  fixture.resourcesPath = sandbox.resourcesPath;
  const legacyRoot = path.join(sandbox.userData, 'runtimes', 'python-win');
  fs.mkdirSync(legacyRoot, { recursive: true });
  fs.writeFileSync(path.join(legacyRoot, 'python.exe'), 'exe');
  fs.writeFileSync(path.join(legacyRoot, 'python3.exe'), 'exe');

  const runtime = await importRuntime('win32');
  const result = await runtime.ensurePythonRuntimeReady();

  expect(result.success).toBe(true);
  expect(fixture.copyCalls).toHaveLength(0);
  expect(fs.existsSync(legacyRoot)).toBe(true);
  const env = runtime.appendPythonRuntimeToEnv({});
  expect(env.ZHIYUAN_PYTHON_ROOT).toBe(legacyRoot);
});

test('windows reports failure when neither the junction nor a legacy copy exists', async () => {
  const sandbox = makeSandbox();
  fixture.userData = sandbox.userData;
  fixture.resourcesPath = sandbox.resourcesPath;

  const runtime = await importRuntime('win32');
  const result = await runtime.ensurePythonRuntimeReady();

  expect(result.success).toBe(false);
  expect(result.error).toContain('Bundled python runtime not found');
});

test('posix still syncs the bundled runtime into userData', async () => {
  const sandbox = makeSandbox();
  fixture.userData = sandbox.userData;
  fixture.resourcesPath = sandbox.resourcesPath;
  const bundledRoot = path.join(sandbox.resourcesPath, 'python-linux');
  fs.mkdirSync(path.join(bundledRoot, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(bundledRoot, 'bin', 'python3'), 'exe');

  const runtime = await importRuntime('linux');
  const result = await runtime.ensurePythonRuntimeReady();

  expect(result.success).toBe(true);
  expect(fixture.copyCalls).toHaveLength(1);
  expect(fixture.copyCalls[0]).toEqual({
    from: bundledRoot,
    to: path.join(sandbox.userData, 'runtimes', 'python-linux'),
  });
  const env = runtime.appendPythonRuntimeToEnv({});
  expect(env.ZHIYUAN_PYTHON_ROOT).toBe(path.join(sandbox.userData, 'runtimes', 'python-linux'));
});
