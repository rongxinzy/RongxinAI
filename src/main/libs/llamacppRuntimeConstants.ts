export const LlamaCppRuntimeTargetId = {
  MacArm64: 'mac-arm64',
  MacX64: 'mac-x64',
  WinX64: 'win-x64',
  WinX64Cuda12: 'win-x64-cuda-12',
  WinArm64: 'win-arm64',
  LinuxX64: 'linux-x64',
  LinuxX64Cuda12: 'linux-x64-cuda-12',
  LinuxX64Cuda13: 'linux-x64-cuda-13',
  LinuxArm64: 'linux-arm64',
} as const;

export type LlamaCppRuntimeTargetId =
  (typeof LlamaCppRuntimeTargetId)[keyof typeof LlamaCppRuntimeTargetId];

export function resolveLlamaCppExecutableName(platform: NodeJS.Platform): string {
  return platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

export function resolveLlamaCppRuntimeTargetId(
  platform: NodeJS.Platform,
  arch: string,
): string | null {
  if (platform === 'darwin') {
    return arch === 'arm64' || arch === 'ia32'
      ? LlamaCppRuntimeTargetId.MacArm64
      : LlamaCppRuntimeTargetId.MacX64;
  }
  if (platform === 'win32') {
    return arch === 'arm64' ? LlamaCppRuntimeTargetId.WinArm64 : LlamaCppRuntimeTargetId.WinX64;
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? LlamaCppRuntimeTargetId.LinuxArm64 : LlamaCppRuntimeTargetId.LinuxX64;
  }
  return null;
}
