export const JobResult = {
  Success: 'success',
  Skipped: 'skipped',
  Failure: 'failure',
  Cancelled: 'cancelled',
} as const;

export const BaselineJob = { Lint: 'lint', Typecheck: 'typecheck', Test: 'test' } as const;

export const PreflightJob = {
  Source: 'source',
  Quality: 'quality',
  Enterprise: 'enterprise',
  NativeRuntime: 'native-runtime',
  PythonLinux: 'python-runtime-linux',
  Browser: 'browser-preview',
  Memory: 'memory-leak',
} as const;

export const PackagingJob = { Linux: 'linux-install', Windows: 'windows-install' } as const;
export const TestShardCount = 2;
