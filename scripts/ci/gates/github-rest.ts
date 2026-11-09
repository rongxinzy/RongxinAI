export type GitHubWorkflowRun = {
  id: number;
  run_number: number;
  run_attempt?: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
  head_branch?: string;
  event?: string;
  path?: string;
  created_at?: string;
};

export type GitHubWorkflowJob = {
  id?: number;
  name: string;
  status: string;
  conclusion: string | null;
  run_attempt?: number;
};

export type GitHubArtifact = {
  id: number;
  name: string;
  expired: boolean;
  size_in_bytes?: number;
  archive_download_url?: string;
  workflow_run?: {
    id: number;
    head_sha?: string;
    head_branch?: string;
    repository_id?: number;
  } | null;
};

export function parseWorkflowRuns(payload: Record<string, unknown>): GitHubWorkflowRun[] {
  const runs = payload.workflow_runs;
  if (!Array.isArray(runs)) throw new Error('workflow_runs must be an array');
  return runs as GitHubWorkflowRun[];
}

export function parseWorkflowJobs(payload: Record<string, unknown>): GitHubWorkflowJob[] {
  const jobs = payload.jobs;
  if (!Array.isArray(jobs)) throw new Error('jobs must be an array');
  return jobs as GitHubWorkflowJob[];
}

export function parseRunArtifacts(payload: Record<string, unknown>): GitHubArtifact[] {
  const artifacts = payload.artifacts;
  if (!Array.isArray(artifacts)) throw new Error('artifacts must be an array');
  return artifacts as GitHubArtifact[];
}

export function assertArtifactBoundToRun(artifact: GitHubArtifact, runId: number): void {
  const nestedId = artifact.workflow_run?.id;
  if (nestedId == null) {
    throw new Error(`Artifact ${artifact.id} is missing workflow_run.id`);
  }
  if (nestedId !== runId) {
    throw new Error(
      `Artifact ${artifact.id} workflow_run.id ${nestedId} does not match workflow run ${runId}`,
    );
  }
}
