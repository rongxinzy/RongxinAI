import { spawn, type ChildProcess } from 'child_process';
import path from 'path';

import {
  getElectronNodeRuntimePath,
  getGitBashResolutionErrorForPi,
  getSkillsRoot,
  resolveGitBashPathForPi,
} from './coworkUtil';
import { findBundledPandocExecutable } from './pandocRuntime';
import { getManagedPythonExecutable } from './pythonRuntime';
import { findSkillPythonExecutable } from './skillPythonRuntime';
import { findBundledUvExecutable } from './uvRuntime';

export type SkillRuntimeCapability = {
  available: boolean;
  executable: string | null;
  version: string | null;
  error?: string;
};

export type SkillRuntimeCapabilities = {
  platform: NodeJS.Platform;
  arch: string;
  python: SkillRuntimeCapability;
  uv: SkillRuntimeCapability;
  node: SkillRuntimeCapability;
  bash: SkillRuntimeCapability;
  powershell: SkillRuntimeCapability;
  pandoc: SkillRuntimeCapability;
  skillPython: Record<string, SkillRuntimeCapability>;
};

function resolveOptional<T>(resolver: () => T): T | null {
  try {
    return resolver();
  } catch {
    return null;
  }
}

const PROBE_TIMEOUT_MS = 30_000;
const MAX_PROBE_OUTPUT_BYTES = 64 * 1024;

function probe(
  executable: string | null,
  args: string[],
  versionArgs = args,
): Promise<SkillRuntimeCapability> {
  if (!executable) {
    return Promise.resolve({
      available: false,
      executable: null,
      version: null,
      error: 'executable not found',
    });
  }

  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let timeout: NodeJS.Timeout | null = null;
    let forceKillTimeout: NodeJS.Timeout | null = null;

    const append = (current: string, chunk: Buffer | string): string => {
      const remaining = MAX_PROBE_OUTPUT_BYTES - Buffer.byteLength(current, 'utf8');
      if (remaining <= 0) return current;
      const bytes = Buffer.from(chunk);
      return current + bytes.subarray(0, remaining).toString('utf8');
    };

    const finish = (capability: SkillRuntimeCapability): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKillTimeout) clearTimeout(forceKillTimeout);
      resolve(capability);
    };

    let child: ChildProcess;
    try {
      child = spawn(executable, versionArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      finish({
        available: false,
        executable,
        version: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    child.stdout?.on('data', chunk => {
      stdout = append(stdout, chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr = append(stderr, chunk);
    });
    child.once('error', error => {
      finish({
        available: false,
        executable,
        version: null,
        error: `${stderr || stdout || error.message}`.trim(),
      });
    });
    child.once('close', code => {
      const output = `${stdout || stderr}`.trim();
      if (code === 0 && !timedOut) {
        finish({ available: true, executable, version: output || 'available' });
        return;
      }
      finish({
        available: false,
        executable,
        version: null,
        error: timedOut
          ? `runtime probe timed out after ${PROBE_TIMEOUT_MS}ms`
          : `${output || `exit code ${code}`}`.trim(),
      });
    });
    timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
      forceKillTimeout = setTimeout(() => {
        if (settled) return;
        child.kill();
        finish({
          available: false,
          executable,
          version: null,
          error: `runtime probe timed out after ${PROBE_TIMEOUT_MS}ms`,
        });
      }, 2_000);
    }, PROBE_TIMEOUT_MS);
  });
}

async function skillPythonCapabilities(): Promise<Record<string, SkillRuntimeCapability>> {
  const root = resolveOptional(() => getSkillsRoot());
  const result: Record<string, SkillRuntimeCapability> = {};
  const skillIds = ['xlsx', 'pdf', 'programming-tutor'];
  if (!root) {
    const capabilities = await Promise.all(skillIds.map(() => probe(null, ['--version'])));
    skillIds.forEach((skillId, index) => {
      result[skillId] = capabilities[index];
    });
    return result;
  }
  const capabilities = await Promise.all(
    skillIds.map(skillId => {
      const requirementsPath = path.join(root, skillId, 'requirements.txt');
      const executable = resolveOptional(() =>
        findSkillPythonExecutable(skillId, requirementsPath),
      );
      return probe(executable, ['--version']);
    }),
  );
  skillIds.forEach((skillId, index) => {
    result[skillId] = capabilities[index];
  });
  return result;
}

/** Probe only application-owned runtimes used by Skill execution. */
export async function probeSkillRuntimeCapabilities(): Promise<SkillRuntimeCapabilities> {
  const python = resolveOptional(() => getManagedPythonExecutable());
  const uv = resolveOptional(() =>
    findBundledUvExecutable(process.platform === 'win32' ? 'uv.exe' : 'uv'),
  );
  const node = resolveOptional(() => getElectronNodeRuntimePath());
  const bash =
    process.platform === 'win32' ? resolveOptional(() => resolveGitBashPathForPi()) : '/bin/bash';
  const powershell = process.platform === 'win32' ? 'powershell.exe' : null;
  const pandoc = resolveOptional(() => findBundledPandocExecutable());

  const [
    bashCapability,
    pythonCapability,
    uvCapability,
    nodeCapability,
    powershellCapability,
    pandocCapability,
    skillPython,
  ] = await Promise.all([
    probe(bash, ['--version']),
    probe(python, ['--version']),
    probe(uv, ['--version']),
    probe(node, ['--version'], ['--version']),
    probe(powershell, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()']),
    probe(pandoc, ['--version']),
    skillPythonCapabilities(),
  ]);
  if (!bashCapability.available && process.platform === 'win32') {
    const resolutionError = getGitBashResolutionErrorForPi();
    if (resolutionError) bashCapability.error = resolutionError;
  }

  return {
    platform: process.platform,
    arch: process.arch,
    python: pythonCapability,
    uv: uvCapability,
    node: nodeCapability,
    bash: bashCapability,
    powershell: powershellCapability,
    pandoc: pandocCapability,
    skillPython,
  };
}
