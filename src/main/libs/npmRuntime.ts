import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import { getElectronNodeRuntimePath } from './coworkUtil';

export const NpmCli = {
  Npm: 'npm',
  Npx: 'npx',
} as const;
export type NpmCli = (typeof NpmCli)[keyof typeof NpmCli];

export interface BundledNpmRuntime {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

function resolveCliPath(cli: NpmCli): string | null {
  const scriptName = cli === NpmCli.Npx ? 'npx-cli.js' : 'npm-cli.js';
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'npm', 'bin', scriptName)]
    : [
        path.join(app.getAppPath(), 'node_modules', 'npm', 'bin', scriptName),
        path.join(process.cwd(), 'node_modules', 'npm', 'bin', scriptName),
      ];
  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

export function resolveBundledNpmRuntime(
  cli: NpmCli,
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): BundledNpmRuntime | null {
  const cliPath = resolveCliPath(cli);
  if (!cliPath) return null;
  return {
    command: getElectronNodeRuntimePath(),
    args: [cliPath, ...args],
    env: { ...env, ELECTRON_RUN_AS_NODE: '1', COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
  };
}

