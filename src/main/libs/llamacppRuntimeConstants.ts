export const LlamaCppRuntimeTargetId = {
  MacArm64: 'mac-arm64',
  MacX64: 'mac-x64',
  WinX64: 'win-x64',
  WinX64Cuda12: 'win-x64-cuda-12',
  WinArm64: 'win-arm64',
  LinuxX64: 'linux-x64',
  LinuxArm64: 'linux-arm64',
} as const;

export type LlamaCppRuntimeTargetId =
  (typeof LlamaCppRuntimeTargetId)[keyof typeof LlamaCppRuntimeTargetId];
