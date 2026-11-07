export type WorkflowRunSummary = {
  id: number;
  run_number: number;
  run_attempt?: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
  created_at: string;
  event?: string;
  path?: string;
  name?: string;
};

export type WorkflowJobSummary = {
  name: string;
  status: string;
  conclusion: string | null;
  started_at?: string;
  completed_at?: string;
};

export type ArtifactSummary = {
  id: number;
  name: string;
  workflow_run_id?: number;
  created_at: string;
  expired: boolean;
};

const terminalIncomplete = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

export function compareWorkflowRunsNewestFirst(
  a: WorkflowRunSummary,
  b: WorkflowRunSummary,
): number {
  if (a.run_number !== b.run_number) return b.run_number - a.run_number;
  const attemptA = a.run_attempt ?? 1;
  const attemptB = b.run_attempt ?? 1;
  if (attemptA !== attemptB) return attemptB - attemptA;
  return b.created_at.localeCompare(a.created_at);
}

export function selectLatestWorkflowRun(runs: WorkflowRunSummary[]): WorkflowRunSummary | null {
  if (runs.length === 0) return null;
  return [...runs].sort(compareWorkflowRunsNewestFirst)[0] ?? null;
}

export function assertLatestDailyCiPermitsRelease(
  runs: WorkflowRunSummary[],
  jobsForLatestRun: WorkflowJobSummary[] | undefined,
  expectedSourceCommit: string,
): WorkflowRunSummary {
  const forCommit = runs.filter(run => run.head_sha === expectedSourceCommit);
  const latest = selectLatestWorkflowRun(forCommit);
  if (!latest) {
    throw new Error(
      `No CI workflow run found for commit ${expectedSourceCommit}. Push or re-run CI on that commit.`,
    );
  }
  if (terminalIncomplete.has(latest.status)) {
    throw new Error(
      `Latest CI run ${latest.id} for ${expectedSourceCommit} is still ${latest.status}; wait for completion.`,
    );
  }
  if (latest.status !== 'completed') {
    throw new Error(`Latest CI run ${latest.id} ended with status ${latest.status}`);
  }
  if (latest.conclusion !== 'success') {
    throw new Error(
      `Latest CI run ${latest.id} for ${expectedSourceCommit} concluded ${latest.conclusion}; an older green run cannot release.`,
    );
  }
  const ciGate = jobsForLatestRun?.find(job => job.name === 'ci-gate');
  if (!ciGate || ciGate.status !== 'completed' || ciGate.conclusion !== 'success') {
    throw new Error(
      `Latest CI run ${latest.id} is green but ci-gate is ${ciGate?.conclusion ?? 'missing'}`,
    );
  }
  return latest;
}

export function selectNewestValidAttestation<
  T extends { sourceCommit: string; issuedAt: string; createdAt: string },
>(candidates: T[], expectedSourceCommit: string): T | null {
  const matching = candidates.filter(item => item.sourceCommit === expectedSourceCommit);
  if (matching.length === 0) return null;
  return (
    [...matching].sort((a, b) => {
      const artifactTime = b.createdAt.localeCompare(a.createdAt);
      if (artifactTime !== 0) return artifactTime;
      return b.issuedAt.localeCompare(a.issuedAt);
    })[0] ?? null
  );
}

export type PaginatedPage<T> = { items: T[]; totalCount: number | null };

export function mergePaginatedPages<T>(pages: PaginatedPage<T>[]): T[] {
  return pages.flatMap(page => page.items);
}

export function paginateItemsOrThrow<T>(pages: Array<{ items?: T[] }>): T[] {
  const normalized = pages.map((page, index) => {
    if (!Array.isArray(page.items)) {
      throw new Error(`Paginated response page ${index + 1} is missing items array`);
    }
    return { items: page.items, totalCount: page.items.length };
  });
  return mergePaginatedPages(normalized);
}
