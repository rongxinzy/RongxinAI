import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const PANDOC_RUNTIME_DIR_NAME = 'pandoc';

function executableName(): string {
  return process.platform === 'win32' ? 'pandoc.exe' : 'pandoc';
}

function bundledCandidates(): string[] {
  if (app.isPackaged) {
    return [
      path.join(process.resourcesPath, PANDOC_RUNTIME_DIR_NAME, executableName()),
      path.join(app.getAppPath(), PANDOC_RUNTIME_DIR_NAME, executableName()),
    ];
  }
  const projectRoot = path.resolve(__dirname, '..', '..', '..');
  return [
    path.join(projectRoot, 'resources', PANDOC_RUNTIME_DIR_NAME, executableName()),
    path.join(process.cwd(), 'resources', PANDOC_RUNTIME_DIR_NAME, executableName()),
  ];
}

/** Resolve only the application-owned Pandoc binary, never a user-installed copy. */
export function findBundledPandocExecutable(): string | null {
  return bundledCandidates().find(candidate => fs.existsSync(candidate)) || null;
}

/** Make the private renderer available to Skills without adding it to the user's PATH. */
export function appendPandocRuntimeToEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const pandoc = findBundledPandocExecutable();
  if (pandoc) env.PANDOC_BIN = pandoc;
  return env;
}
