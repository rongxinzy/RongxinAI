import fs from 'fs';
import path from 'path';

import type {
  LlamaCppRuntimeInstallPlan,
  LlamaCppRuntimeInstallResult,
} from '../../shared/llamacpp';

export type LlamaCppRuntimeInstallContext = {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  existingExecutablePath: string | null;
};

export function resolveLlamaCppExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

export function resolveLlamaCppRuntimeTargetId(platform: NodeJS.Platform, arch: string): string | null {
  const normalizedArch = arch === 'arm64' ? 'arm64' : arch === 'ia32' ? 'ia32' : 'x64';
  if (platform === 'darwin') return normalizedArch === 'x64' ? 'mac-x64' : 'mac-arm64';
  if (platform === 'win32') return normalizedArch === 'arm64' ? 'win-arm64' : 'win-x64';
  if (platform === 'linux') return normalizedArch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  return null;
}

export function createLlamaCppRuntimeInstallPlan(context: LlamaCppRuntimeInstallContext): LlamaCppRuntimeInstallPlan {
  if (context.existingExecutablePath) {
    return {
      kind: 'ready',
      executablePath: context.existingExecutablePath,
    };
  }

  const targetId = resolveLlamaCppRuntimeTargetId(context.platform, context.arch);
  if (!targetId) {
    return {
      kind: 'needs-manual',
      message: `Unsupported platform for bundled llama.cpp runtime: ${context.platform}/${context.arch}.`,
    };
  }

  if (context.isPackaged) {
    return {
      kind: 'needs-manual',
      message: 'The packaged app is missing the bundled llama.cpp runtime. Please reinstall using the full installer that includes resources/llamacpp.',
    };
  }

  return {
    kind: 'needs-manual',
    message: `The prebuilt llama.cpp runtime is missing. Run npm run llamacpp:runtime:download -- ${targetId} before starting the app. If the download returns 404, the published release asset is missing and you must either set LLAMACPP_RUNTIME_URL / LLAMACPP_RUNTIME_BASE_URL, build locally with npm run llamacpp:runtime:${targetId}, or set LLAMACPP_BIN to a prebuilt llama-server executable.`,
  };
}

export async function executeLlamaCppRuntimeInstallPlan(
  plan: LlamaCppRuntimeInstallPlan,
): Promise<LlamaCppRuntimeInstallResult> {
  if (plan.kind === 'ready') {
    return {
      success: true,
      plan,
      executablePath: plan.executablePath,
    };
  }

  if (plan.kind === 'needs-manual') {
    return {
      success: false,
      plan,
      error: plan.message,
    };
  }
}

export async function ensureLlamaCppRuntimeCurrent(
  projectRoot: string,
  targetId: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const currentExecutablePath = resolveLlamaCppRuntimeExecutablePath(projectRoot, 'current', platform);
  if (fs.existsSync(currentExecutablePath)) return currentExecutablePath;

  const targetExecutablePath = resolveLlamaCppRuntimeExecutablePath(projectRoot, targetId, platform);
  if (!fs.existsSync(targetExecutablePath)) return null;

  await syncLlamaCppRuntimeCurrent(projectRoot, targetId);
  return fs.existsSync(currentExecutablePath) ? currentExecutablePath : null;
}

export async function syncLlamaCppRuntimeCurrent(projectRoot: string, targetId: string): Promise<void> {
  const runtimeBaseDir = path.join(projectRoot, 'vendor', 'llamacpp-runtime');
  const targetRuntimeDir = path.join(runtimeBaseDir, targetId);
  const currentRuntimeDir = path.join(runtimeBaseDir, 'current');

  if (!fs.existsSync(targetRuntimeDir)) {
    throw new Error(`Target runtime does not exist: ${targetRuntimeDir}`);
  }

  try {
    const stat = fs.lstatSync(currentRuntimeDir);
    if (stat.isSymbolicLink()) {
      fs.unlinkSync(currentRuntimeDir);
    } else {
      fs.rmSync(currentRuntimeDir, { recursive: true, force: true });
    }
  } catch {
    // Missing current runtime is the normal repair path.
  }

  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(targetRuntimeDir, currentRuntimeDir, linkType);
}

export function resolveLlamaCppRuntimeExecutablePath(
  projectRoot: string,
  runtimeId: string,
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(projectRoot, 'vendor', 'llamacpp-runtime', runtimeId, 'bin', resolveLlamaCppExecutableName(platform));
}

export function getProjectRoot(): string {
  return process.cwd();
}
