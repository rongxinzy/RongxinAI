export const RendererStartupEnvironment = {
  DisableGpu: 'ZHIYUAN_DISABLE_GPU',
  ElectronDisableGpu: 'ELECTRON_DISABLE_GPU',
  EnableGpu: 'ZHIYUAN_ENABLE_GPU',
} as const;

type RendererPlatform = 'darwin' | 'linux' | 'win32' | string;

type ChromiumCommandLine = {
  appendSwitch(name: string, value?: string): void;
};

type RendererStartupInput = {
  platform: RendererPlatform;
  env: NodeJS.ProcessEnv;
  commandLine: ChromiumCommandLine;
  disableHardwareAcceleration: () => void;
};

const isEnabled = (value: string | undefined): boolean => value === '1' || value === 'true';

export function configureRendererStartup(input: RendererStartupInput): {
  softwareRenderingEnabled: boolean;
} {
  const { platform, env, commandLine, disableHardwareAcceleration } = input;
  const isLinux = platform === 'linux';
  const isWindows = platform === 'win32';

  if (isLinux || isWindows) {
    commandLine.appendSwitch('no-sandbox');
  }
  if (isLinux) {
    commandLine.appendSwitch('disable-dev-shm-usage');
  }

  const gpuDisabledByEnvironment =
    isEnabled(env[RendererStartupEnvironment.DisableGpu]) ||
    isEnabled(env[RendererStartupEnvironment.ElectronDisableGpu]);
  const linuxGpuOptIn = isEnabled(env[RendererStartupEnvironment.EnableGpu]);
  const softwareRenderingEnabled = gpuDisabledByEnvironment || (isLinux && !linuxGpuOptIn);

  if (softwareRenderingEnabled) {
    commandLine.appendSwitch('disable-gpu');
    disableHardwareAcceleration();
  }

  return { softwareRenderingEnabled };
}
