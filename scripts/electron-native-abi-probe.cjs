// Runs only in the installed Electron with ELECTRON_RUN_AS_NODE=1.
const path = require('node:path');
const { createRequire } = require('node:module');
const {
  NativeAbiProbeExitCode,
  NativeAbiStatus,
  classifyNativeAbi,
  NATIVE_MODULE,
} = require('./electron-native-abi.mjs');

let database;
try {
  if (!process.versions.electron || !process.argv[2]) {
    throw new Error('The native addon probe requires the target Electron runtime.');
  }
  const requireFromProject = createRequire(path.join(process.argv[2], 'package.json'));
  const Database = requireFromProject(NATIVE_MODULE);
  // Loading the JS wrapper alone does not load the native addon.
  database = new Database(':memory:');
  database.prepare('SELECT 1').get();
  process.exitCode = NativeAbiProbeExitCode.Compatible;
} catch (error) {
  process.exitCode =
    classifyNativeAbi(error) === NativeAbiStatus.Incompatible
      ? NativeAbiProbeExitCode.Incompatible
      : NativeAbiProbeExitCode.Unavailable;
} finally {
  database?.close();
}
