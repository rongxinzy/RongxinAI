export type CheckRun = {
  name: string;
  conclusion: string | null;
  status: string;
};

export type WorkflowRun = {
  conclusion: string | null;
  status: string;
  head_sha: string;
  name?: string;
};

export function findSuccessfulCheck(checkRuns: CheckRun[], checkName: string): CheckRun | null {
  return (
    checkRuns.find(
      run => run.name === checkName && run.status === 'completed' && run.conclusion === 'success',
    ) ?? null
  );
}

export function findSuccessfulWorkflowRun(
  runs: WorkflowRun[],
  headSha: string,
): WorkflowRun | null {
  return (
    runs.find(
      run => run.head_sha === headSha && run.status === 'completed' && run.conclusion === 'success',
    ) ?? null
  );
}
