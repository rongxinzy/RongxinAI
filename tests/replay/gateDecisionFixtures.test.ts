import { expect, test } from 'vitest';

import { AGENT_LOOP_MAX_ITERATIONS } from '../../src/main/libs/agentEngine/piAgentLoop';
import { collectCompletionFailures } from '../../src/main/libs/agentEngine/piResearchPolicy';
import {
  ResearchSourceType,
  type ResearchRunState,
} from '../../src/main/libs/agentEngine/piResearchTypes';
import { HarnessActivationType } from '../../src/shared/harness';
import {
  compareResearchEvidence,
  LoopTraceSignal,
  makeResearchEvidenceFixture,
  observeLoopTrace,
} from './gateDecisionFixtures';

test('compares missing signals with explicit completion and an inactive controller', () => {
  const signals = [LoopTraceSignal.Omitted, LoopTraceSignal.Done];
  const active = observeLoopTrace(signals, true);
  const inactive = observeLoopTrace(signals, false);
  const explicit = observeLoopTrace([LoopTraceSignal.Done], true);
  expect(active).toMatchObject({ agentEnds: 2, continuationRequests: 1, terminated: true });
  expect(active.activations.map(event => event.activation)).toEqual([
    HarnessActivationType.PrematureFinalizeBlocked,
  ]);
  expect(inactive).toEqual({
    agentEnds: 1,
    continuationRequests: 0,
    terminated: true,
    activations: [],
  });
  expect(explicit).toEqual(inactive);
});

test('distinguishes requested continuation from a protocol-omission intervention', () => {
  const trace = observeLoopTrace([LoopTraceSignal.Next, LoopTraceSignal.Done], true);
  expect(trace).toEqual({
    agentEnds: 2,
    continuationRequests: 1,
    terminated: true,
    activations: [],
  });
});

test('does not report an exhausted fixture as model completion', () => {
  expect(observeLoopTrace([LoopTraceSignal.Omitted], true)).toMatchObject({
    agentEnds: 1,
    continuationRequests: 1,
    terminated: false,
  });
});

test('observes the bounded wrap-up rather than claiming an infinite hang', () => {
  const trace = observeLoopTrace(
    Array.from({ length: AGENT_LOOP_MAX_ITERATIONS + 1 }, () => LoopTraceSignal.Omitted),
    true,
  );
  expect(trace.agentEnds).toBe(AGENT_LOOP_MAX_ITERATIONS);
  expect(trace.continuationRequests).toBe(AGENT_LOOP_MAX_ITERATIONS - 1);
  expect(trace.terminated).toBe(true);
  expect(
    trace.activations.filter(event => event.activation === HarnessActivationType.RecoveryTriggered),
  ).toHaveLength(1);
});

const evidenceCases: Array<{
  name: string;
  change: (state: ResearchRunState) => void;
  failure: string;
}> = [
  {
    name: 'iteration minimum',
    change: state => {
      state.iteration = 2;
      state.researcherIterations = [1, 2];
    },
    failure: 'fewer than 3 research iterations are recorded',
  },
  {
    name: 'subquestion minimum',
    change: state => {
      state.subquestions.pop();
      state.claims.pop();
    },
    failure: 'fewer than 3 subquestions are recorded',
  },
  {
    name: 'source minimum',
    change: state => {
      state.sources.pop();
    },
    failure: 'fewer than 6 verified sources are recorded',
  },
  {
    name: 'primary-source ratio',
    change: state => {
      state.sources[1].sourceType = ResearchSourceType.Secondary;
    },
    failure: 'primary-source ratio is below 0.3',
  },
  {
    name: 'direction minimum',
    change: state => {
      state.directionsTried.pop();
    },
    failure: 'fewer than three distinct research directions are recorded',
  },
  {
    name: 'isolated researcher every iteration',
    change: state => {
      state.researcherIterations.pop();
    },
    failure: 'iteration 3 did not launch an isolated researcher',
  },
];

test.each(evidenceCases)(
  'isolates the $name gate without other failures',
  ({ change, failure }) => {
    const comparison = compareResearchEvidence(change);
    expect(comparison.baselineFailures).toEqual([]);
    expect(comparison.candidateFailures).toEqual([failure]);
  },
);

test('passing evidence thresholds is not sufficient without reviewer approval', () => {
  const state = makeResearchEvidenceFixture();
  state.review = { requested: false, passed: false };
  expect(collectCompletionFailures(state, false)).toEqual([
    'an isolated reviewer has not completed the request',
    'reviewer verdict is not REVIEW_VERDICT: PASS',
  ]);
  state.review.passed = true;
  expect(collectCompletionFailures(state, true)).toEqual([]);
});
