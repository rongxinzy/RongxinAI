import { execFile } from 'child_process';
import { promisify } from 'util';

import type { LlamaCppRuntimeListDevicesResult } from '../../shared/llamacpp';
import { resolveLlamaCppRuntimeMetadata } from './llamacppRuntimePaths';
import { buildLlamaCppServeEnv, parseLlamaCppListDevicesOutput } from './llamacppServe';

type ExecFileRunner = (
  file: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
    encoding: 'utf8';
    maxBuffer: number;
    timeout: number;
    windowsHide: boolean;
  },
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);
const defaultExecFileRunner: ExecFileRunner = (file, args, options) =>
  execFileAsync(file, args, options);

export async function listLlamaCppRuntimeDevices(input: {
  executablePath: string;
  platform: NodeJS.Platform;
  baseEnv?: NodeJS.ProcessEnv;
  runner?: ExecFileRunner;
}): Promise<LlamaCppRuntimeListDevicesResult> {
  const runner = input.runner ?? defaultExecFileRunner;
  const metadata = resolveLlamaCppRuntimeMetadata(input.executablePath);
  try {
    const { stdout, stderr } = await runner(input.executablePath, ['--list-devices'], {
      env: buildLlamaCppServeEnv(
        input.baseEnv ?? process.env,
        input.executablePath,
        input.platform,
      ),
      encoding: 'utf8',
      maxBuffer: 256 * 1024,
      timeout: 10_000,
      windowsHide: true,
    });
    const rawOutput = [stdout, stderr].filter(Boolean).join(stderr ? '\n' : '');
    return {
      success: true,
      executablePath: input.executablePath,
      runtimeTargetId: metadata.runtimeTargetId,
      rawOutput,
      devices: parseLlamaCppListDevicesOutput(rawOutput),
    };
  } catch (error) {
    return {
      success: false,
      executablePath: input.executablePath,
      runtimeTargetId: metadata.runtimeTargetId,
      devices: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
