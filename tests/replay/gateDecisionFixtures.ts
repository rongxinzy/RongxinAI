import {
  PiAgentLoopController,
  PiAgentLoopMode,
} from '../../src/main/libs/agentEngine/piAgentLoop';
import { collectEvidenceFailures } from '../../src/main/libs/agentEngine/piResearchPolicy';
import {
  ResearchRunStatus,
  ResearchSourceType,
  type ResearchRunState,
} from '../../src/main/libs/agentEngine/piResearchTypes';
import type { HarnessActivationEvent } from '../../src/shared/harness';

export const LoopTraceSignal = {
  Omitted: 'omitted',
  Next: 'next',
  Done: 'done',
} as const;
type LoopTraceSignal = (typeof LoopTraceSignal)[keyof typeof LoopTraceSignal];

/** Synthetic control-flow trace, not provider replay or a task-quality score. */
export function observeLoopTrace(signals: LoopTraceSignal[], startLoop: boolean) {
  const activations: HarnessActivationEvent[] = [];
  const controller = new PiAgentLoopController(undefined, event => activations.push(event));
  if (startLoop) {
    controller.start({ mode: PiAgentLoopMode.Goal, goal: 'fixture', passes: 0, stages: [] });
  }
  let agentEnds = 0;
  let continuationRequests = 0;
  let terminated = false;
  for (const signal of signals) {
    if (signal === LoopTraceSignal.Next) controller.next('fixture work remains');
    if (signal === LoopTraceSignal.Done) controller.done('fixture declared done');
    const decision = controller.handleAgentEnd();
    agentEnds += 1;
    if (!decision.shouldContinue) {
      terminated = true;
      break;
    }
    continuationRequests += 1;
  }
  return { agentEnds, continuationRequests, terminated, activations };
}

/** Already-verified synthetic state. No URLs/files are opened by this fixture. */
export function makeResearchEvidenceFixture(): ResearchRunState {
  const verifiedAt = '2026-10-01T00:00:00.000Z';
  const sources = Array.from({ length: 6 }, (_, index) => ({
    url: `https://source-${index}.example/report`,
    sourceType: index < 2 ? ResearchSourceType.Primary : ResearchSourceType.Secondary,
    verifiedAt,
  }));
  const subquestions = Array.from({ length: 3 }, (_, index) => ({
    id: `q${index}`,
    question: `Fixture question ${index}`,
  }));
  return {
    version: 1,
    sessionId: 'offline-gate-fixture',
    task: 'Compare deterministic gate decisions, not research quality',
    status: ResearchRunStatus.Running,
    iteration: 3,
    staleCount: 0,
    lastFindingCount: 0,
    researcherIterations: [1, 2, 3],
    subquestions,
    sources,
    claims: subquestions.map(question => ({
      id: `claim-${question.id}`,
      questionId: question.id,
      statement: 'Synthetic supported statement',
      sourceUrls: sources.slice(0, 2).map(source => source.url),
    })),
    artifacts: [
      { path: 'fixture-report.md', role: 'deliverable', verifiedAt },
      { path: 'fixture-validation.md', role: 'validation', verifiedAt },
    ],
    directionsTried: ['first', 'second', 'third'],
    contradictionCheck: 'Synthetic contradiction check',
    review: { requested: true, passed: true },
    updatedAt: verifiedAt,
  };
}

/** Paired input sensitivity, NOT a gate-disabled model counterfactual. */
export function compareResearchEvidence(change: (state: ResearchRunState) => void) {
  const baseline = makeResearchEvidenceFixture();
  const candidate = structuredClone(baseline);
  change(candidate);
  return {
    baselineFailures: collectEvidenceFailures(baseline),
    candidateFailures: collectEvidenceFailures(candidate),
  };
}
