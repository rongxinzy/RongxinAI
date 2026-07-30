import {
  MIN_PRIMARY_SOURCE_RATIO,
  MIN_RESEARCH_ITERATIONS,
  MIN_RESEARCH_SUBQUESTIONS,
  MIN_VERIFIED_SOURCES,
  ResearchSourceType,
  type ResearchRunState,
} from './piResearchTypes';

export function collectCompletionFailures(
  state: ResearchRunState,
  reviewerRanThisRequest: boolean,
): string[] {
  const failures: string[] = [];
  if (!reviewerRanThisRequest && !state.review.passed) {
    failures.push('an isolated reviewer has not completed the request');
  }
  if (!state.review.passed) failures.push('reviewer verdict is not REVIEW_VERDICT: PASS');
  failures.push(...collectEvidenceFailures(state));
  return failures;
}

export function collectEvidenceFailures(state: ResearchRunState): string[] {
  const failures: string[] = [];
  if (state.iteration < MIN_RESEARCH_ITERATIONS) {
    failures.push(`fewer than ${MIN_RESEARCH_ITERATIONS} research iterations are recorded`);
  }
  if (state.subquestions.length < MIN_RESEARCH_SUBQUESTIONS) {
    failures.push(`fewer than ${MIN_RESEARCH_SUBQUESTIONS} subquestions are recorded`);
  }
  if (state.sources.length < MIN_VERIFIED_SOURCES) {
    failures.push(`fewer than ${MIN_VERIFIED_SOURCES} verified sources are recorded`);
  }
  const primaryCount = state.sources.filter(
    source => source.sourceType === ResearchSourceType.Primary,
  ).length;
  if (state.sources.length > 0 && primaryCount / state.sources.length < MIN_PRIMARY_SOURCE_RATIO) {
    failures.push(`primary-source ratio is below ${MIN_PRIMARY_SOURCE_RATIO}`);
  }
  for (const question of state.subquestions) {
    if (!state.claims.some(claim => claim.questionId === question.id)) {
      failures.push(`subquestion ${question.id} has no supported claim`);
    }
  }
  for (const claim of state.claims) {
    if (!claim.statement?.trim()) {
      failures.push(`claim ${claim.id} has no auditable statement`);
    }
    if (new Set(claim.sourceUrls).size < 2) {
      failures.push(`claim ${claim.id} does not have two independent sources`);
    }
  }
  for (let iteration = 1; iteration <= state.iteration; iteration += 1) {
    if (!state.researcherIterations.includes(iteration)) {
      failures.push(`iteration ${iteration} did not launch an isolated researcher`);
    }
  }
  if (!state.contradictionCheck) failures.push('no contradiction check is recorded');
  if (state.directionsTried.length < MIN_RESEARCH_SUBQUESTIONS) {
    failures.push('fewer than three distinct research directions are recorded');
  }
  return failures;
}

export function buildResearchIterationPrompt(
  state: ResearchRunState,
  runDirectory: string,
): string {
  const pivot =
    state.staleCount >= 2
      ? 'Two or more stale iterations were detected. Change a structural research constraint: corpus, language, time window, methodology, or contrary evidence.'
      : 'Choose a direction not present in directions_tried.json.';
  return [
    `## Academic research iteration ${state.iteration}`,
    `State directory: ${runDirectory}`,
    pivot,
    'You must launch an isolated researcher subagent in this iteration. Record verified sources and claims through research_state before ending the turn.',
    'When the work is incomplete, call agent_loop next. If you omit next/done, the controller will continue and record the protocol violation.',
  ].join('\n');
}

export function buildResearchReviewPrompt(failures: string[], runDirectory: string): string {
  const gateSummary = failures.length
    ? failures.map(failure => `- ${failure}`).join('\n')
    : '- none';
  return [
    '## Academic research completion review',
    `State directory: ${runDirectory}`,
    'Launch an isolated reviewer subagent now. Its task is to inspect the persisted evidence and return exactly REVIEW_VERDICT: PASS only when every gate is met; otherwise return REVIEW_VERDICT: FAIL followed by concrete gaps.',
    'Current deterministic gate failures:',
    gateSummary,
    'If the reviewer or a gate fails, continue research and record the missing evidence. Do not call done again until the gaps are resolved.',
  ].join('\n');
}

export function extractSubagentIds(args: unknown): string[] {
  if (!args || typeof args !== 'object') return [];
  const record = args as Record<string, unknown>;
  const ids: string[] = [];
  if (typeof record.agent === 'string') ids.push(record.agent);
  for (const key of ['parallel', 'chain']) {
    if (!Array.isArray(record[key])) continue;
    for (const item of record[key] as Array<Record<string, unknown>>) {
      if (typeof item?.agent === 'string') ids.push(item.agent);
    }
  }
  return ids;
}
