'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const OUTPUT_REL_PATH = path.join('resources', 'python-runtime', 'job-runner.exe');
const SOURCE_REL_PATH = path.join('scripts', 'python-runtime', 'job-runner.cpp');
const BUILD_SCRIPT_REL_PATH = path.join('scripts', 'python-runtime', 'build-job-runner.ps1');

function statMtimeMs(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0) return null;
    return stat.mtimeMs;
  } catch {
    return null;
  }
}

/** Checks whether the compiled Windows Job Object helper exists and is at least as new as its source inputs. */
function isJobRunnerFresh({ outputPath, sourcePath, buildScriptPath }) {
  const outputMtime = statMtimeMs(outputPath);
  if (outputMtime === null) return false;
  const sourceMtime = statMtimeMs(sourcePath) ?? 0;
  const scriptMtime = statMtimeMs(buildScriptPath) ?? 0;
  return outputMtime >= Math.max(sourceMtime, scriptMtime);
}

/**
 * Ensures `resources/python-runtime/job-runner.exe` is compiled and up to date on Windows.
 * No-ops on non-Windows platforms.
 */
function ensureWindowsJobRunner(options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return { status: 'skipped', outputPath: null };
  }

  const projectRoot = options.projectRoot ?? DEFAULT_PROJECT_ROOT;
  const outputPath = options.outputPath ?? path.join(projectRoot, OUTPUT_REL_PATH);
  const sourcePath = options.sourcePath ?? path.join(projectRoot, SOURCE_REL_PATH);
  const buildScriptPath = options.buildScriptPath ?? path.join(projectRoot, BUILD_SCRIPT_REL_PATH);

  if (isJobRunnerFresh({ outputPath, sourcePath, buildScriptPath })) {
    return { status: 'fresh', outputPath };
  }

  const runSpawn = options.spawnSync ?? spawnSync;
  const powershell = options.powershell ?? 'powershell.exe';
  console.log(
    '[python-runtime] Building Windows Job Object helper (resources/python-runtime/job-runner.exe)...',
  );
  const result = runSpawn(
    powershell,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', buildScriptPath, '-Output', outputPath],
    {
      cwd: projectRoot,
      env: options.env ?? process.env,
      stdio: options.stdio ?? 'inherit',
      windowsHide: true,
    },
  );
  if (result.error) {
    throw new Error(`Failed to invoke PowerShell to build job-runner.exe: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(
      `Failed to build resources/python-runtime/job-runner.exe (exit code ${result.status}). Run "bun run python:build:job-runner" to inspect details.`,
    );
  }
  if (statMtimeMs(outputPath) === null) {
    throw new Error(`Build finished cleanly, but ${outputPath} is missing or empty.`);
  }
  return { status: 'built', outputPath };
}

module.exports = {
  isJobRunnerFresh,
  ensureWindowsJobRunner,
};
