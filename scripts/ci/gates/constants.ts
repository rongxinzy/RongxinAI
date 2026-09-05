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
  Lint: 'lint',
  Test: 'test',
  Bundle: 'bundle-budget',
} as const;
