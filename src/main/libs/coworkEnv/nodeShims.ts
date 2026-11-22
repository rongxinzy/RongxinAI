import { app } from 'electron';
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

import { coworkLog } from '../coworkLogger';
import { NpmCli } from '../npmRuntime';

export function ensureElectronNodeShim(
  npmCliPaths: Readonly<Record<NpmCli, string | null>>,
): string | null {
  try {
    const shimDir = join(app.getPath('userData'), 'cowork', 'bin');
    mkdirSync(shimDir, { recursive: true });
    // --- node shim ---
    // Shell script (macOS/Linux/Windows git-bash)
    const nodeSh = join(shimDir, 'node');
    const nodeShContent = [
      '#!/usr/bin/env bash',
      'if [ -z "${ZHIYUAN_ELECTRON_PATH:-}" ]; then',
      '  echo "ZHIYUAN_ELECTRON_PATH is not set" >&2',
      '  exit 127',
      'fi',
      'exec env ELECTRON_RUN_AS_NODE=1 "${ZHIYUAN_ELECTRON_PATH}" "$@"',
      '',
    ].join('\n');

    writeFileSync(nodeSh, nodeShContent, 'utf8');
    try {
      chmodSync(nodeSh, 0o755);
    } catch {
      // Ignore chmod errors on file systems that do not support POSIX modes.
    }
    coworkLog('INFO', 'resolveNodeShim', `Created node bash shim: ${nodeSh}`);

    // Windows .cmd wrapper (only needed on Windows)
    if (process.platform === 'win32') {
      const nodeCmd = join(shimDir, 'node.cmd');
      const nodeCmdContent = [
        '@echo off',
        'if "%ZHIYUAN_ELECTRON_PATH%"=="" (',
        '  echo ZHIYUAN_ELECTRON_PATH is not set 1>&2',
        '  exit /b 127',
        ')',
        'set ELECTRON_RUN_AS_NODE=1',
        '"%ZHIYUAN_ELECTRON_PATH%" %*',
        '',
      ].join('\r\n');
      writeFileSync(nodeCmd, nodeCmdContent, 'utf8');
      coworkLog('INFO', 'resolveNodeShim', `Created node.cmd shim: ${nodeCmd}`);
    }

    // Resolve package paths once, before writing either shell wrapper.
    for (const cli of Object.values(NpmCli)) {
      const cliPath = npmCliPaths[cli];
      if (!cliPath) continue;

      const windows = process.platform === 'win32';
      const shellPath = windows ? cliPath.replace(/\\/g, '/') : cliPath;
      const shim = join(shimDir, cli);
      writeFileSync(
        shim,
        [
          '#!/usr/bin/env bash',
          'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
          `exec "$SCRIPT_DIR/node" '${shellPath.replace(/'/g, "'\\''")}' "$@"`,
          '',
        ].join('\n'),
        'utf8',
      );
      try {
        chmodSync(shim, 0o755);
      } catch {
        // Some file systems do not support POSIX modes.
      }
      if (windows) {
        writeFileSync(
          join(shimDir, `${cli}.cmd`),
          ['@echo off', `"%~dp0node.cmd" "${shellPath.replace(/%/g, '%%')}" %*`, ''].join('\r\n'),
          'utf8',
        );
      }
    }

    // Verify shim files exist and are executable
    const shimFiles = ['node', 'npx', 'npm'];
    for (const name of shimFiles) {
      const shimPath = join(shimDir, name);
      const exists = existsSync(shimPath);
      if (exists) {
        try {
          const stat = statSync(shimPath);
          coworkLog(
            'INFO',
            'resolveNodeShim',
            `Shim verify: ${name} exists, mode=0o${stat.mode.toString(8)}, size=${stat.size}`,
          );
        } catch (e) {
          coworkLog(
            'WARN',
            'resolveNodeShim',
            `Shim verify: ${name} exists but stat failed: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      } else {
        coworkLog('WARN', 'resolveNodeShim', `Shim verify: ${name} NOT found at ${shimPath}`);
      }
    }

    return shimDir;
  } catch (error) {
    coworkLog(
      'WARN',
      'resolveNodeShim',
      `Failed to prepare Electron Node shim: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}
