import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  createLlamaCppRuntimeInstallPlan,
  ensureLlamaCppRuntimeCurrent,
  resolveLlamaCppRuntimeDownloadUrl,
  resolveLlamaCppRuntimeDownloadUrls,
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

  test('plans an in-app download for packaged Windows users when runtime is missing', () => {
    const runtimeRoot = path.join(
      'C:',
      'Users',
      'tester',
      'AppData',
      'Roaming',
      'ZhiYuanAgent',
      'llamacpp-runtime',
    );
    const plan = createLlamaCppRuntimeInstallPlan({
      platform: 'win32',
      arch: 'x64',
      isPackaged: true,
      existingExecutablePath: null,
      userRuntimeRoot: runtimeRoot,
    });

    expect(plan).toEqual({
      kind: 'download',
      targetId: 'win-x64',
      runtimeRoot,
      executablePath: path.join(runtimeRoot, 'current', 'bin', 'llama-server.exe'),
      url: 'https://rongxinai.krli.org/llamacpp/b9505/llama-b9505-bin-win-cpu-x64.tar.gz',
      fallbackUrls: [
        'https://github.com/ggml-org/llama.cpp/releases/download/b9505/llama-b9505-bin-win-cpu-x64.tar.gz',
      ],
      companionDownloads: [],
    });
  });

  test('plans the fixed CUDA 12 runtime when preferred target id is set', () => {
    const runtimeRoot = path.join(
      'C:',
      'Users',
      'tester',
      'AppData',
      'Roaming',
      'ZhiYuanAgent',
      'llamacpp-runtime',
    );
    const plan = createLlamaCppRuntimeInstallPlan({
      platform: 'win32',
      arch: 'x64',
      isPackaged: true,
      existingExecutablePath: null,
      userRuntimeRoot: runtimeRoot,
      preferredTargetId: 'win-x64-cuda-12',
    });

    expect(plan).toEqual({
      kind: 'download',
      targetId: 'win-x64-cuda-12',
      runtimeRoot,
      executablePath: path.join(runtimeRoot, 'current', 'bin', 'llama-server.exe'),
      url: 'https://rongxinai.krli.org/llamacpp/b9505/llama-b9505-bin-win-cuda-12.4-x64.tar.gz',
      fallbackUrls: [
        'https://github.com/ggml-org/llama.cpp/releases/download/b9505/llama-b9505-bin-win-cuda-12.4-x64.tar.gz',
      ],
      companionDownloads: [
        {
          assetName: 'cudart-llama-bin-win-cuda-12.4-x64.tar.gz',
          url: 'https://rongxinai.krli.org/llamacpp/b9505/cudart-llama-bin-win-cuda-12.4-x64.tar.gz',
          fallbackUrls: [
            'https://github.com/ggml-org/llama.cpp/releases/download/b9505/cudart-llama-bin-win-cuda-12.4-x64.tar.gz',
          ],
        },
      ],
    });
  });

  test('resolves platform target ids', () => {
    expect(resolveLlamaCppRuntimeTargetId('darwin', 'arm64')).toBe('mac-arm64');
    expect(resolveLlamaCppRuntimeTargetId('darwin', 'x64')).toBe('mac-x64');
    expect(resolveLlamaCppRuntimeTargetId('win32', 'x64')).toBe('win-x64');
    expect(resolveLlamaCppRuntimeTargetId('linux', 'arm64')).toBe('linux-arm64');
  });

  test('resolves official runtime download URLs for packaged installs', () => {
    expect(resolveLlamaCppRuntimeDownloadUrl('mac-arm64')).toBe(
      'https://rongxinai.krli.org/llamacpp/b9505/llama-b9505-bin-macos-arm64.tar.gz',
    );
    expect(resolveLlamaCppRuntimeDownloadUrls('mac-arm64')).toEqual([
      'https://rongxinai.krli.org/llamacpp/b9505/llama-b9505-bin-macos-arm64.tar.gz',
      'https://github.com/ggml-org/llama.cpp/releases/download/b9505/llama-b9505-bin-macos-arm64.tar.gz',
    ]);
    expect(resolveLlamaCppRuntimeDownloadUrl('win-x64-cuda-12')).toBe(
      'https://rongxinai.krli.org/llamacpp/b9505/llama-b9505-bin-win-cuda-12.4-x64.tar.gz',
    );
  });

  test('repairs current runtime when a target runtime already exists', async () => {
    const projectRoot = createTempProjectRoot();
    writeTargetExecutable(projectRoot, 'mac-arm64');

    const executablePath = await ensureLlamaCppRuntimeCurrent(projectRoot, 'mac-arm64', 'darwin');

    expect(executablePath).toBe(
      resolveLlamaCppRuntimeExecutablePath(projectRoot, 'current', 'darwin'),
    );
    expect(
      fs.existsSync(resolveLlamaCppRuntimeExecutablePath(projectRoot, 'current', 'darwin')),
    ).toBe(true);
  });
});
