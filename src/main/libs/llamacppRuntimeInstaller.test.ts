import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  createLlamaCppRuntimeInstallPlan,
  ensureLlamaCppRuntimeCurrent,
  resolveLlamaCppRuntimeExecutablePath,
  resolveLlamaCppRuntimeTargetId,
} from './llamacppRuntimeInstaller';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempProjectRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-runtime-installer-'));
  tempDirs.push(dir);
  return dir;
}

function writeTargetExecutable(projectRoot: string, targetId: string): string {
  const executablePath = resolveLlamaCppRuntimeExecutablePath(projectRoot, targetId, 'darwin');
  fs.mkdirSync(path.dirname(executablePath), { recursive: true });
  fs.writeFileSync(executablePath, '');
  fs.chmodSync(executablePath, 0o755);
  return executablePath;
}

describe('llamacpp runtime installer planning', () => {
  test('uses an existing bundled executable without building', () => {
    const executablePath = path.join('/app', 'resources', 'llamacpp', 'bin', 'llama-server');
    const plan = createLlamaCppRuntimeInstallPlan({
      platform: 'darwin',
      arch: 'arm64',
      isPackaged: true,
      existingExecutablePath: executablePath,
    });

    expect(plan).toEqual({
      kind: 'ready',
      executablePath,
    });
  });

  test('requires a prebuilt runtime in development instead of building from source', () => {
    const plan = createLlamaCppRuntimeInstallPlan({
      platform: 'linux',
      arch: 'x64',
      isPackaged: false,
      existingExecutablePath: null,
    });

    expect(plan.kind).toBe('needs-manual');
    expect(plan.message).toContain('prebuilt');
  });

  test('does not mention CMake when the prebuilt development runtime is missing', () => {
    const plan = createLlamaCppRuntimeInstallPlan({
      platform: 'darwin',
      arch: 'arm64',
      isPackaged: false,
      existingExecutablePath: null,
    });

    expect(plan.kind).toBe('needs-manual');
    expect(plan.message).not.toContain('CMake');
    expect(plan.message).toContain('npm run llamacpp:runtime:download -- mac-arm64');
  });

  test('does not ask packaged Windows users to compile llama.cpp', () => {
    const plan = createLlamaCppRuntimeInstallPlan({
      platform: 'win32',
      arch: 'x64',
      isPackaged: true,
      existingExecutablePath: null,
    });

    expect(plan.kind).toBe('needs-manual');
    expect(plan.message).toContain('full installer');
  });

  test('resolves platform target ids', () => {
    expect(resolveLlamaCppRuntimeTargetId('darwin', 'arm64')).toBe('mac-arm64');
    expect(resolveLlamaCppRuntimeTargetId('darwin', 'x64')).toBe('mac-x64');
    expect(resolveLlamaCppRuntimeTargetId('win32', 'x64')).toBe('win-x64');
    expect(resolveLlamaCppRuntimeTargetId('linux', 'arm64')).toBe('linux-arm64');
  });

  test('repairs current runtime when a target runtime already exists', async () => {
    const projectRoot = createTempProjectRoot();
    writeTargetExecutable(projectRoot, 'mac-arm64');

    const executablePath = await ensureLlamaCppRuntimeCurrent(projectRoot, 'mac-arm64', 'darwin');

    expect(executablePath).toBe(resolveLlamaCppRuntimeExecutablePath(projectRoot, 'current', 'darwin'));
    expect(fs.existsSync(resolveLlamaCppRuntimeExecutablePath(projectRoot, 'current', 'darwin'))).toBe(true);
  });

});
