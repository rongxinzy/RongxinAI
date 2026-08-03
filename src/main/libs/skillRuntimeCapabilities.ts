import { spawnSync } from 'child_process';
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

function probe(
  executable: string | null,
  args: string[],
  versionArgs = args,
): SkillRuntimeCapability {
  if (!executable) {
    return { available: false, executable: null, version: null, error: 'executable not found' };
  }
  const result = spawnSync(executable, versionArgs, {
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 30_000,
    shell: false,
    windowsHide: true,
  });
  const output = `${result.stdout || result.stderr || ''}`.trim();
  if (result.status === 0) return { available: true, executable, version: output || 'available' };
  return {
    available: false,
    executable,
    version: null,
    error: `${output || result.error?.message || `exit code ${result.status}`}`.trim(),
  };
}

function skillPythonCapabilities(): Record<string, SkillRuntimeCapability> {
  const root = resolveOptional(() => getSkillsRoot());
  const result: Record<string, SkillRuntimeCapability> = {};
  const skillIds = ['xlsx', 'pdf', 'programming-tutor'];
  if (!root) {
    for (const skillId of skillIds) {
      result[skillId] = probe(null, ['--version']);
    }
    return result;
  }
  for (const skillId of skillIds) {
    const requirementsPath = path.join(root, skillId, 'requirements.txt');
    const executable = resolveOptional(() => findSkillPythonExecutable(skillId, requirementsPath));
    result[skillId] = probe(executable, ['--version']);
  }
  return result;
}

/** Probe only application-owned runtimes used by Skill execution. */
export function probeSkillRuntimeCapabilities(): SkillRuntimeCapabilities {
  const python = resolveOptional(() => getManagedPythonExecutable());
  const uv = resolveOptional(() =>
    findBundledUvExecutable(process.platform === 'win32' ? 'uv.exe' : 'uv'),
  );
  const node = resolveOptional(() => getElectronNodeRuntimePath());
  const bash =
    process.platform === 'win32' ? resolveOptional(() => resolveGitBashPathForPi()) : '/bin/bash';
  const powershell = process.platform === 'win32' ? 'powershell.exe' : null;
  const pandoc = resolveOptional(() => findBundledPandocExecutable());

  const bashCapability = probe(bash, ['--version']);
  if (!bashCapability.available && process.platform === 'win32') {
    const resolutionError = getGitBashResolutionErrorForPi();
    if (resolutionError) bashCapability.error = resolutionError;
  }

  return {
    platform: process.platform,
    arch: process.arch,
    python: probe(python, ['--version']),
    uv: probe(uv, ['--version']),
    node: probe(node, ['--version'], ['--version']),
    bash: bashCapability,
    powershell: probe(powershell, [
      '-NoProfile',
      '-Command',
      '$PSVersionTable.PSVersion.ToString()',
    ]),
    pandoc: probe(pandoc, ['--version']),
    skillPython: skillPythonCapabilities(),
  };
}
