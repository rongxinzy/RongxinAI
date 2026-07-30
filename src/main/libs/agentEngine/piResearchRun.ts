/**
 * Persistent academic-research run controller.
 *
 * The generic Pi loop decides how turns continue. This controller owns the
 * research-specific invariants that a language model must not be allowed to
 * waive: persisted evidence, direction diversity, independent review, and a
 * deterministic completion gate.
 */

import {
  addResearchClaim,
  addResearchDirection,
  setResearchContradictionCheck,
  setResearchPlan,
  verifyResearchSource,
} from './piResearchEvidence';
import {
  buildResearchInitialPrompt,
  buildResearchIterationPrompt,
  buildResearchReviewPrompt,
  collectCompletionFailures,
  collectEvidenceFailures,
  extractSubagentIds,
  resumeResearchState,
} from './piResearchPolicy';
import { PiResearchRunStore } from './piResearchStore';
import {
  RESEARCH_MAX_ITERATIONS,
  ResearchRunStatus,
  type PiResearchRunOptions,
  type ResearchEndDecision,
  type ResearchRunState,
  type ResearchSourceType,
} from './piResearchTypes';

export {
  isAcademicResearchSkillSet,
  MIN_PRIMARY_SOURCE_RATIO,
  MIN_RESEARCH_ITERATIONS,
  MIN_RESEARCH_SUBQUESTIONS,
  MIN_VERIFIED_SOURCES,
  PiResearchStateAction,
  PiResearchStateToolName,
  RESEARCH_MAX_ITERATIONS,
  ResearchRunStatus,
  ResearchSourceType,
} from './piResearchTypes';

export class PiResearchRunController {
  readonly runDirectory: string;
  private readonly store: PiResearchRunStore;
  private state: ResearchRunState;
  private researcherRanThisIteration = false;
  private reviewerRanThisRequest = false;
  private readonly reviewerToolCallIds = new Set<string>();

  constructor(options: PiResearchRunOptions) {
    this.store = new PiResearchRunStore(options);
    this.runDirectory = this.store.runDirectory;
    this.state = this.store.loadOrCreate();
    this.store.writeState(this.state);
    this.store.log(
      'orchestrator',
      'info',
      'run_resumed',
      'Academic research state loaded and ready.',
    );
  }

  get goal(): string {
    return `Produce a verified academic research result for: ${this.state.task}`;
  }

  resumeForPrompt(task: string): void {
    if (!resumeResearchState(this.state, task)) return;
    this.researcherRanThisIteration = false;
    this.reviewerRanThisRequest = false;
    this.reviewerToolCallIds.clear();
    this.store.appendFollowUpTask(task);
    this.store.writeState(this.state);
    this.store.log(
      'orchestrator',
      'decision',
      'run_resumed_for_follow_up',
      `Academic research resumed at iteration ${this.state.iteration}.`,
    );
  }

  buildInitialPrompt(userPrompt: string): string {
    return buildResearchInitialPrompt(this.runDirectory, userPrompt);
  }

  recordSubagentStart(toolCallId: string, args: unknown): void {
    const roles = extractSubagentIds(args);
    if (roles.includes('researcher')) {
      this.researcherRanThisIteration = true;
      if (!this.state.researcherIterations.includes(this.state.iteration)) {
        this.state.researcherIterations.push(this.state.iteration);
        this.store.writeState(this.state);
      }
      this.store.log(
        'orchestrator',
        'info',
        'researcher_started',
        `Researcher subagent started: ${toolCallId}`,
      );
    }
    if (this.state.review.requested && roles.includes('reviewer')) {
      this.reviewerRanThisRequest = true;
      this.reviewerToolCallIds.add(toolCallId);
      this.store.log(
        'orchestrator',
        'info',
        'reviewer_started',
        `Independent reviewer started: ${toolCallId}`,
      );
    }
  }

  recordSubagentResult(toolCallId: string, output: string, isError: boolean): void {
    if (
      !this.state.review.requested ||
      !this.reviewerRanThisRequest ||
      !this.reviewerToolCallIds.has(toolCallId) ||
      isError
    ) {
      return;
    }
    this.reviewerToolCallIds.delete(toolCallId);
    if (output.trim() === 'REVIEW_VERDICT: PASS') {
      this.state.review = { requested: true, passed: true, output };
      this.store.writeState(this.state);
      this.store.log(
        'orchestrator',
        'info',
        'reviewer_passed',
        `Reviewer accepted completion: ${toolCallId}`,
      );
      return;
    }
    this.state.review = { requested: true, passed: false, output };
    this.store.writeState(this.state);
    this.store.log(
      'orchestrator',
      'warn',
      'reviewer_rejected',
      `Reviewer did not issue PASS: ${toolCallId}`,
    );
  }

  requestCompletion(reason: string): string {
    this.state.status = ResearchRunStatus.CompletionRequested;
    this.state.completionReason = reason;
    this.state.review = { requested: true, passed: false };
    this.reviewerRanThisRequest = false;
    this.reviewerToolCallIds.clear();
    this.store.writeState(this.state);
    this.store.log('orchestrator', 'decision', 'completion_requested', reason);
    return 'Completion recorded as a request. The run remains active until an isolated reviewer returns REVIEW_VERDICT: PASS and every evidence gate passes.';
  }

  onAgentEnd(): ResearchEndDecision {
    let deferredFailures: string[] = [];
    if (this.state.status === ResearchRunStatus.CompletionRequested) {
      deferredFailures = collectEvidenceFailures(this.state);
      if (deferredFailures.length > 0) {
        this.state.status = ResearchRunStatus.Running;
        this.state.review = { requested: false, passed: false };
        this.reviewerRanThisRequest = false;
        this.reviewerToolCallIds.clear();
        this.store.writeState(this.state);
        this.store.log(
          'orchestrator',
          'decision',
          'completion_deferred',
          deferredFailures.join('; '),
        );
      } else {
        const failures = collectCompletionFailures(this.state, this.reviewerRanThisRequest);
        if (this.state.review.passed && failures.length === 0) {
          this.state.status = ResearchRunStatus.Completed;
          this.store.writeState(this.state);
          this.store.log(
            'orchestrator',
            'info',
            'completion_approved',
            this.state.completionReason || 'Approved',
          );
          return {
            shouldFinish: true,
            reason: this.state.completionReason || 'Academic research gate passed',
          };
        }
        return {
          shouldFinish: false,
          nextPrompt: buildResearchReviewPrompt(failures, this.runDirectory),
        };
      }
    }

    const previousFindingCount = this.state.sources.length + this.state.claims.length;
    if (!this.researcherRanThisIteration) {
      this.state.staleCount += 1;
      this.store.writeState(this.state);
      this.store.log(
        'orchestrator',
        'warn',
        'researcher_missing',
        `Iteration ${this.state.iteration} was not advanced because no researcher subagent ran.`,
      );
      return {
        shouldFinish: false,
        nextPrompt: [
          ...(deferredFailures.length > 0
            ? [
                '## Completion deferred — evidence gates remain open',
                ...deferredFailures.map(failure => `- ${failure}`),
                '',
              ]
            : []),
          `Iteration ${this.state.iteration} was not advanced because no isolated researcher ran.`,
          buildResearchIterationPrompt(this.state, this.runDirectory),
        ].join('\n'),
      };
    }
    this.state.staleCount =
      previousFindingCount <= this.state.lastFindingCount ? this.state.staleCount + 1 : 0;
    this.state.lastFindingCount = previousFindingCount;
    this.state.iteration += 1;
    this.researcherRanThisIteration = false;
    this.store.writeState(this.state);
    this.store.log(
      'orchestrator',
      'info',
      'iteration_advanced',
      `Advanced to iteration ${this.state.iteration}.`,
    );

    if (this.state.iteration > RESEARCH_MAX_ITERATIONS) {
      this.state.status = ResearchRunStatus.NeedsAttention;
      this.store.writeState(this.state);
      this.store.log(
        'orchestrator',
        'warn',
        'iteration_cap_reached',
        'Evidence gates remain unmet at the research iteration cap.',
      );
      return {
        shouldFinish: false,
        nextPrompt:
          'The academic-research iteration cap was reached before the evidence gates passed. Do not claim completion. Summarize the verified evidence and the remaining gaps, then call agent_loop done to submit the report for reviewer evaluation.',
      };
    }

    return {
      shouldFinish: false,
      nextPrompt: [
        ...(deferredFailures.length > 0
          ? [
              '## Completion deferred — evidence gates remain open',
              ...deferredFailures.map(failure => `- ${failure}`),
              '',
            ]
          : []),
        buildResearchIterationPrompt(this.state, this.runDirectory),
      ].join('\n'),
    };
  }

  async verifySource(url: string, sourceType: ResearchSourceType): Promise<string> {
    return verifyResearchSource(this.state, this.store, url, sourceType);
  }

  setPlan(subquestions: string[]): string {
    return setResearchPlan(this.state, this.store, subquestions);
  }

  addDirection(direction: string): string {
    return addResearchDirection(this.state, this.store, direction);
  }

  addClaim(id: string, questionId: string, statement: string, sourceUrls: string[]): string {
    return addResearchClaim(this.state, this.store, id, questionId, statement, sourceUrls);
  }

  setContradictionCheck(summary: string): string {
    return setResearchContradictionCheck(this.state, this.store, summary);
  }

  getSnapshot(): Record<string, unknown> {
    return {
      ...this.state,
      runDirectory: this.runDirectory,
      completionFailures: collectCompletionFailures(this.state, this.reviewerRanThisRequest),
    };
  }
}
