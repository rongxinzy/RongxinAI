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
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const NATIVE_MODULE = 'better-sqlite3';

/** @returns {'electron-abi' | 'node-abi' | 'unavailable'} */
export const classifyNativeAbi = (error) => {
  if (!error) {
    // Node loaded it, so it was compiled against Node's ABI.
    return 'node-abi';
  }
  const message = String(error?.message ?? error);
  // Both ABIs produce this message; the mismatch itself is what Electron's
  // build looks like from plain Node.
  return /NODE_MODULE_VERSION/.test(message) ? 'electron-abi' : 'unavailable';
};

export const inspectNativeAbi = (projectRoot) => {
  const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));
  let database = null;
  try {
    const Database = requireFromProject(NATIVE_MODULE);
    // better-sqlite3 loads its addon lazily, so the probe must open a database;
    // an in-memory one touches no user data.
    database = new Database(':memory:');
    return classifyNativeAbi(null);
  } catch (error) {
    return classifyNativeAbi(error);
  } finally {
    try {
      database?.close();
    } catch {
      // The probe database is disposable.
    }
  }
};

const FIX_COMMAND = 'npm run rebuild:electron-native';

export const describeNativeAbi = (status) => {
  if (status === 'node-abi') {
    return [
      `[native-abi] ${NATIVE_MODULE} is built for Node's ABI, but Electron needs its own.`,
      `[native-abi] The app would crash in initStore with ERR_DLOPEN_FAILED.`,
      `[native-abi] Run: ${FIX_COMMAND}`,
    ].join('\n');
  }
  if (status === 'unavailable') {
    return [
      `[native-abi] ${NATIVE_MODULE} could not be loaded at all.`,
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
  process.exit(status === 'electron-abi' ? 0 : 1);
}
