import { app } from 'electron';
import { chmodSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import { join } from 'path';

import { coworkLog } from '../coworkLogger';

export function ensureElectronNodeShim(electronPath: string, npmBinDir?: string): string | null {
  try {
    const shimDir = join(app.getPath('userData'), 'cowork', 'bin');
    mkdirSync(shimDir, { recursive: true });
    coworkLog(
      'INFO',
      'resolveNodeShim',
      `Shim directory: ${shimDir}, electronPath: ${electronPath}, npmBinDir: ${npmBinDir || '(none)'}`,
    );

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

    // --- npx / npm shims ---
    // Create shims that invoke npx-cli.js / npm-cli.js from the bundled npm
    // package via the node shim above. This avoids relying on symlinks in
    // node_modules/.bin which do not work on Windows cross-platform builds.
    if (npmBinDir && existsSync(npmBinDir)) {
      const npxCliJs = join(npmBinDir, 'npx-cli.js');
      const npmCliJs = join(npmBinDir, 'npm-cli.js');

      // Convert to POSIX path for bash scripts on Windows (git-bash)
      const npxCliJsPosix = npxCliJs.replace(/\\/g, '/');
      const npmCliJsPosix = npmCliJs.replace(/\\/g, '/');

      coworkLog(
        'INFO',
        'resolveNodeShim',
        `npmBinDir exists: true, npx-cli.js exists: ${existsSync(npxCliJs)}, npm-cli.js exists: ${existsSync(npmCliJs)}`,
      );

      if (existsSync(npxCliJs)) {
        // npx bash shim
        const npxSh = join(shimDir, 'npx');
        const npxShContent = [
          '#!/usr/bin/env bash',
          'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
          `exec "$SCRIPT_DIR/node" "${npxCliJsPosix}" "$@"`,
          '',
        ].join('\n');
        writeFileSync(npxSh, npxShContent, 'utf8');
        try {
          chmodSync(npxSh, 0o755);
        } catch {
          /* ignore */
        }
        coworkLog('INFO', 'resolveNodeShim', `Created npx bash shim: ${npxSh} -> ${npxCliJsPosix}`);

        // npx.cmd for Windows — hardcode the absolute npmBinDir path so the
        // shim works without ZHIYUAN_NPM_BIN_DIR env var (e.g. dev mode).
        if (process.platform === 'win32') {
          const npxCmd = join(shimDir, 'npx.cmd');
          // normalise backslashes; cmd.exe accepts forward slashes for paths
          const npxCliJsArg = npxCliJs.replace(/\\/g, '/');
          const npxCmdContent = ['@echo off', `"%~dp0node.cmd" "${npxCliJsArg}" %*`, ''].join(
            '\r\n',
          );
          writeFileSync(npxCmd, npxCmdContent, 'utf8');
          coworkLog('INFO', 'resolveNodeShim', `Created npx.cmd shim: ${npxCmd} -> ${npxCliJsArg}`);
        }
      } else {
        coworkLog('WARN', 'resolveNodeShim', `npx-cli.js not found at: ${npxCliJs}`);
      }

      if (existsSync(npmCliJs)) {
        // npm bash shim
        const npmSh = join(shimDir, 'npm');
        const npmShContent = [
          '#!/usr/bin/env bash',
          'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
          `exec "$SCRIPT_DIR/node" "${npmCliJsPosix}" "$@"`,
          '',
        ].join('\n');
        writeFileSync(npmSh, npmShContent, 'utf8');
        try {
          chmodSync(npmSh, 0o755);
        } catch {
          /* ignore */
        }
        coworkLog('INFO', 'resolveNodeShim', `Created npm bash shim: ${npmSh} -> ${npmCliJsPosix}`);

        // npm.cmd for Windows — hardcode the absolute npmBinDir path so the
        // shim works without ZHIYUAN_NPM_BIN_DIR env var (e.g. dev mode).
        if (process.platform === 'win32') {
          const npmCmd = join(shimDir, 'npm.cmd');
          // normalise backslashes; cmd.exe accepts forward slashes for paths
          const npmCliJsArg = npmCliJs.replace(/\\/g, '/');
          const npmCmdContent = ['@echo off', `"%~dp0node.cmd" "${npmCliJsArg}" %*`, ''].join(
            '\r\n',
          );
          writeFileSync(npmCmd, npmCmdContent, 'utf8');
          coworkLog('INFO', 'resolveNodeShim', `Created npm.cmd shim: ${npmCmd} -> ${npmCliJsArg}`);
        }
      } else {
        coworkLog('WARN', 'resolveNodeShim', `npm-cli.js not found at: ${npmCliJs}`);
      }

      coworkLog('INFO', 'resolveNodeShim', `Created npx/npm shims pointing to: ${npmBinDir}`);
    } else {
      coworkLog(
        'WARN',
        'resolveNodeShim',
        `npmBinDir not available: ${npmBinDir || '(not provided)'}, exists: ${npmBinDir ? existsSync(npmBinDir) : 'N/A'}`,
      );
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
