#!/usr/bin/env node
/**
 * Guard for the Electron dev launch: `npm test` rebuilds better-sqlite3 against
 * Node's ABI and restores Electron's ABI afterwards, so launching the app inside
 * that window dies later with an opaque `ERR_DLOPEN_FAILED` inside `initStore`.
 *
 * CLI: `node scripts/electron-native-abi.mjs [projectRoot]` — exits non-zero with
 * the fix command when the native module is built for the wrong ABI.
 */
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const NATIVE_MODULE = 'better-sqlite3';
export const NativeAbiStatus = {
  Compatible: 'electron-abi',
  Incompatible: 'incompatible-abi',
  Unavailable: 'unavailable',
};
export const NativeAbiProbeExitCode = { Compatible: 0, Unavailable: 1, Incompatible: 2 };
export const NATIVE_ABI_PROBE_TIMEOUT_MS = 10_000;
const probePath = fileURLToPath(new URL('./electron-native-abi-probe.cjs', import.meta.url));

/** Classify errors from the target Electron process, never from the host Node. */
export const classifyNativeAbi = error => {
  if (!error) {
    return NativeAbiStatus.Compatible;
  }
  const message = String(error?.message ?? error);
  return /NODE_MODULE_VERSION/.test(message)
    ? NativeAbiStatus.Incompatible
    : NativeAbiStatus.Unavailable;
};

export const inspectNativeAbi = projectRoot => {
  try {
    const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));
    const electronBinary = requireFromProject('electron');
    // A mismatch under host Node does not prove compatibility with Electron.
    // Load the addon in the actual installed Electron, without booting the app.
    const { NODE_OPTIONS: _nodeOptions, NODE_PATH: _nodePath, ...env } = process.env;
    const result = spawnSync(electronBinary, [probePath, path.resolve(projectRoot)], {
      cwd: projectRoot,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      timeout: NATIVE_ABI_PROBE_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
      windowsHide: true,
    });
    if (result.error || result.signal) return NativeAbiStatus.Unavailable;
    if (result.status === NativeAbiProbeExitCode.Compatible) return NativeAbiStatus.Compatible;
    if (result.status === NativeAbiProbeExitCode.Incompatible) return NativeAbiStatus.Incompatible;
    return NativeAbiStatus.Unavailable;
  } catch {
    return NativeAbiStatus.Unavailable;
  }
};

const FIX_COMMAND = 'npm run rebuild:electron-native';

export const describeNativeAbi = status => {
  if (status === NativeAbiStatus.Incompatible) {
    return [
      `[native-abi] ${NATIVE_MODULE} does not match the installed Electron's ABI.`,
      `[native-abi] The app would crash in initStore with ERR_DLOPEN_FAILED.`,
      `[native-abi] Run: ${FIX_COMMAND}`,
    ].join('\n');
  }
  if (status === NativeAbiStatus.Unavailable) {
    return [
      `[native-abi] Electron could not verify ${NATIVE_MODULE}.`,
      `[native-abi] Run: bun install  (then ${FIX_COMMAND} if the app still fails)`,
    ].join('\n');
  }
  return `[native-abi] ${NATIVE_MODULE} is built for Electron.`;
};

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (scriptPath === fileURLToPath(import.meta.url)) {
  const projectRoot = path.resolve(process.argv[2] ?? path.join(path.dirname(scriptPath), '..'));
  const status = inspectNativeAbi(projectRoot);
  console.log(describeNativeAbi(status));
  process.exit(status === NativeAbiStatus.Compatible ? 0 : 1);
}
