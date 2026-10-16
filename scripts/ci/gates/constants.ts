export const CiEvent = {
  PullRequest: 'pull_request',
  Push: 'push',
  Manual: 'workflow_dispatch',
} as const;

export const JobResult = {
  Success: 'success',
  Skipped: 'skipped',
  Failure: 'failure',
  Cancelled: 'cancelled',
} as const;

export const HeavyJob = {
  Linux: 'linux-install',
  Windows: 'windows-install',
  Memory: 'memory-leak',
} as const;

export const BaselineJob = {
  Changes: 'changes',
  ElectronCompile: 'electron-compile',
  Knip: 'knip',
  Lint: 'lint',
  Test: 'test',
  Bundle: 'bundle-budget',
  Enterprise: 'enterprise',
} as const;

export const PathJob = {
  ChannelRuntime: 'channel-runtime',
  PythonRuntimeLinux: 'python-runtime-linux',
  PythonRuntimeWindows: 'python-runtime-windows',
  InstallerPreview: 'installer-preview',
  BrowserPreview: 'browser-preview',
} as const;

export const TestShardCount = 2;
