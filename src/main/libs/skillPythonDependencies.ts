/**
 * On-demand Python dependencies for Skills that are not covered by the packaged
 * offline layer.
 *
 * The overlay is a plain `uv pip install --target` directory that we put on
 * PYTHONPATH for that Skill's scripts. A venv would bind `pyvenv.cfg` to the
 * packaged interpreter path, which changes on every app update (the component
 * junction is swapped), so every venv would break after an upgrade.
 *
 * Installs are pinned by the delta lock generated at build time and are written
 * atomically: a failed or cancelled install never destroys a working overlay.
 */

import { spawn } from 'child_process';
import crypto from 'crypto';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import {
  findSharedSkillPythonExecutable,
  resolveSkillPython,
  skillPythonDependencyStatus,
  skillPythonOverlayRoot,
} from './skillPythonRuntime';
import { configureUvForManagedPython, findBundledUvExecutable } from './uvRuntime';

export interface SkillPythonInstallOutcome {
  ok: boolean;
  skillId: string;
  /** Present on success: overlay directory that satisfies the Skill manifest. */
  sitePackages?: string;
  packageCount?: number;
  reason?: 'unavailable' | 'offline' | 'failed' | 'cancelled';
  detail?: string;
}

export interface SkillPythonInstallOptions {
  signal?: AbortSignal;
  onLog?: (line: string) => void;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const NETWORK_ERROR_PATTERN =
  /failed to (fetch|download)|error sending request|dns error|connection (refused|reset|timed out)|timed out|ENETUNREACH|EAI_AGAIN|network is unreachable|proxy/i;

function overlayInstallRoot(skillId: string): string {
  return `${skillPythonOverlayRoot(skillId)}.installing-${process.pid}-${Date.now()}`;
}

function writeOverlayManifest(
  sitePackages: string,
  skillId: string,
  lockSha256: string,
  packageCount: number,
): void {
  fs.writeFileSync(
    path.join(sitePackages, 'runtime.json'),
    `${JSON.stringify(
      {
        version: 3,
        kind: 'skill-overlay',
        skillId,
        lockSha256,
        installedAt: new Date().toISOString(),
        packageCount,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

function buildUvEnvironment(corePython: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(configureUvForManagedPython({ ...process.env }))) {
    if (typeof value === 'string') env[key] = value;
  }
  env.UV_PYTHON = corePython;
  env.UV_NO_PROGRESS = '1';
  env.UV_NO_MANAGED_PYTHON = '1';
  // Keep Skill packages in their own cache so `wheels` can be cleared or moved
  // independently of the app's own uv cache.
  env.UV_CACHE_DIR = path.join(app.getPath('userData'), 'runtimes', 'skill-python', 'wheels');
  return env;
}

function runUvInstall(
  uvPath: string,
  target: string,
  lockPath: string,
  corePython: string,
  offline: boolean,
  options: SkillPythonInstallOptions,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise(resolve => {
    const args = [
      'pip',
      'install',
      '--target',
      target,
      '--python',
      corePython,
      '--requirement',
      lockPath,
      // The lock is a complete, hash-pinned delta: packages the offline layer
      // already satisfies are intentionally absent. Without --no-deps uv would
      // re-resolve those missing transitive requirements and pull a *different*
      // version from the index (measured: pandas 3.0.6 beside a core 2.3.3),
      // which defeats both the version contract and the size saving.
      '--no-deps',
      '--link-mode',
      'copy',
      '--no-managed-python',
      '--no-python-downloads',
    ];
    if (offline) args.push('--offline');

    const child = spawn(uvPath, args, {
      env: buildUvEnvironment(corePython),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const lines: string[] = [];
    const record = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        lines.push(trimmed);
        if (lines.length > 200) lines.shift();
        options.onLog?.(trimmed);
      }
    };
    child.stdout?.on('data', record);
    child.stderr?.on('data', record);

    let settled = false;
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ ok, detail: detail || lines.slice(-5).join(' | ') });
    };
    const onAbort = () => {
      child.kill();
      finish(false, 'aborted');
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(
        false,
        `timed out after ${Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)}s`,
      );
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    if (options.signal?.aborted) onAbort();
    else options.signal?.addEventListener('abort', onAbort, { once: true });

    child.on('error', error => finish(false, error.message));
    child.on('close', code => finish(code === 0, lines.slice(-8).join(' | ')));
  });
}

/**
 * Install one Skill's delta lock into its overlay directory.
 *
 * Returns `unavailable` when the packaged layer has no matching manifest (the
 * Skill was edited locally) and `offline` when the network and the local wheel
 * cache both cannot satisfy the lock.
 */
export async function installSkillPythonDependencies(
  skillId: string,
  requirementsPath: string,
  options: SkillPythonInstallOptions = {},
): Promise<SkillPythonInstallOutcome> {
  const status = skillPythonDependencyStatus(skillId, requirementsPath);
  if (status.status === 'core') {
    return { ok: true, skillId, sitePackages: '', packageCount: 0 };
  }
  if (status.status === 'installed') {
    return {
      ok: true,
      skillId,
      sitePackages: status.sitePackages,
      packageCount: status.packageCount,
    };
  }
  if (status.status === 'unavailable') {
    return {
      ok: false,
      skillId,
      reason: 'unavailable',
      detail:
        status.reason === 'stale-skill'
          ? 'This Skill was modified locally, so it has no pinned dependency set.'
          : 'The packaged Python dependency layer is missing.',
    };
  }

  const corePython = findSharedSkillPythonExecutable();
  const uvPath = findBundledUvExecutable(process.platform === 'win32' ? 'uv.exe' : 'uv');
  if (!corePython || !uvPath) {
    return {
      ok: false,
      skillId,
      reason: 'unavailable',
      detail: 'The managed Python or uv runtime is unavailable.',
    };
  }
  if (!status.lockPath) {
    return {
      ok: false,
      skillId,
      reason: 'unavailable',
      detail: `Missing dependency lock for ${skillId}.`,
    };
  }

  const target = overlayInstallRoot(skillId);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });

  const first = await runUvInstall(uvPath, target, status.lockPath, corePython, false, options);
  let attempt = first;
  let offlineFallback = false;
  if (!first.ok && NETWORK_ERROR_PATTERN.test(first.detail)) {
    options.onLog?.('network unavailable, retrying from the local wheel cache');
    attempt = await runUvInstall(uvPath, target, status.lockPath, corePython, true, options);
    offlineFallback = true;
  }

  if (!attempt.ok) {
    fs.rmSync(target, { recursive: true, force: true });
    const aborted = options.signal?.aborted === true || /aborted/.test(attempt.detail);
    return {
      ok: false,
      skillId,
      reason: aborted ? 'cancelled' : offlineFallback ? 'offline' : 'failed',
      detail: attempt.detail,
    };
  }

  const finalTarget = skillPythonOverlayRoot(skillId);
  fs.rmSync(finalTarget, { recursive: true, force: true });
  fs.renameSync(target, finalTarget);
  const lockSha256 =
    status.lockSha256 ??
    crypto.createHash('sha256').update(fs.readFileSync(status.lockPath)).digest('hex');
  writeOverlayManifest(finalTarget, skillId, lockSha256, status.packageCount ?? 0);

  const resolution = resolveSkillPython(skillId, requirementsPath);
  if (resolution.kind !== 'ready' || !resolution.sitePackages) {
    return {
      ok: false,
      skillId,
      reason: 'failed',
      detail: 'Installed packages do not satisfy the Skill manifest.',
    };
  }
  return {
    ok: true,
    skillId,
    sitePackages: finalTarget,
    packageCount: status.packageCount ?? 0,
  };
}

/** Remove one Skill's overlay directory. The packaged layer is never touched. */
export function uninstallSkillPythonDependencies(skillId: string): void {
  fs.rmSync(skillPythonOverlayRoot(skillId), { recursive: true, force: true });
}
