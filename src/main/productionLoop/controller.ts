import {
  ProductionLoopPhase,
  ProductionLoopRecoveryReason,
  ProductionLoopStatus,
  type ProductionLoopState,
} from '../../shared/productionLoop';
import type { WorkbenchContractKind, WorkbenchJsonObject } from '../../shared/workbenchTask';
import type { ProductionLoopService } from './service';

interface DownstreamCompletionWorkflow {
  readonly goal: string;
  resumeForPrompt?(prompt: string): void;
  requestCompletion(reason: string): string;
  onAgentEnd(): { shouldFinish: boolean; reason?: string; nextPrompt?: string };
}

const hasReviewer = (args: unknown): boolean => {
  if (!args || typeof args !== 'object') return false;
  const raw = args as Record<string, unknown>;
  if (raw.agent === 'reviewer') return true;
  for (const key of ['parallel', 'chain']) {
    const values = raw[key];
    if (
      Array.isArray(values) &&
      values.some(value => value && typeof value === 'object' && value.agent === 'reviewer')
    ) {
      return true;
    }
  }
  return false;
};

export class ProductionLoopController {
  private state: ProductionLoopState;

  constructor(
    private readonly service: ProductionLoopService,
    initial: {
      taskId: string;
      runId: string;
      workflowKind: WorkbenchContractKind;
      goal: string;
      prototypeRequired: boolean;
    },
    private readonly downstream?: DownstreamCompletionWorkflow,
  ) {
    this.state = this.service.beginRun(initial);
  }

  get goal(): string {
    return this.downstream?.goal || this.state.goal;
  }

  getState(): ProductionLoopState {
    return structuredClone(this.state);
  }

  startRun(input: {
    taskId: string;
    runId: string;
    workflowKind: WorkbenchContractKind;
    goal: string;
    prototypeRequired: boolean;
  }): void {
    this.downstream?.resumeForPrompt?.(input.goal);
    this.state = this.service.beginRun(input);
  }

  buildInitialPrompt(): string {
    const phaseInstruction = this.state.prototypeRequired
      ? 'Begin by creating a concrete prototype or materially distinct direction, then record it with production_loop record_prototype.'
      : 'Begin by committing an executable plan with production_loop commit_plan before making changes.';
    return [
      '## Production workflow',
      `Persistent phase: ${this.state.phase}`,
      phaseInstruction,
      'The plan must include acceptance criteria, expected artifacts, and deterministic verifiers.',
      'After commit_plan, read the returned state and use each generated plan item ID with update_plan_item.',
      'After execution, call start_inspection, then request_critique and delegate a read-only review to the reviewer subagent.',
      'A reviewer PASS does not replace artifact verification or the completion contract.',
      'When findings exist, revise the work, record_revision, inspect again, and request another critique.',
      'Call agent_loop done only after the production loop reports ready_to_deliver.',
    ].join('\n');
  }

  requestCriticPrompt(): string {
    return [
      'Call the subagent tool with agent "reviewer". The reviewer must remain read-only.',
      'Ask it to inspect the implementation and available evidence against this persisted plan:',
      JSON.stringify({
        goal: this.state.goal,
        constraints: this.state.constraints,
        acceptanceCriteria: this.state.acceptanceCriteria,
        expectedArtifacts: this.state.expectedArtifacts,
        expectedVerifiers: this.state.expectedVerifiers,
        planItems: this.state.planItems,
      }),
      'Require exactly one JSON object as output: {"verdict":"pass"|"revise","findings":[{"severity":"critical"|"major"|"minor","summary":"...","evidence":"..."}]}.',
      'A pass must have an empty findings array.',
    ].join('\n');
  }

  recordPrototype(reference: string, summary: string): ProductionLoopState {
    return this.update(this.service.recordPrototype(this.state.runId, reference, summary));
  }

  commitPlan(input: Parameters<ProductionLoopService['commitPlan']>[1]): ProductionLoopState {
    return this.update(this.service.commitPlan(this.state.runId, input));
  }

  updatePlanItem(
    itemId: string,
    status: Parameters<ProductionLoopService['updatePlanItem']>[2],
  ): ProductionLoopState {
    return this.update(this.service.updatePlanItem(this.state.runId, itemId, status));
  }

  startInspection(): ProductionLoopState {
    return this.update(this.service.startInspection(this.state.runId));
  }

  requestCritique(): string {
    this.update(this.service.requestCritique(this.state.runId));
    return this.requestCriticPrompt();
  }

  recordSubagentStart(toolCallId: string, args: unknown): void {
    if (!hasReviewer(args) || this.state.phase !== ProductionLoopPhase.Critique) return;
    this.update(this.service.recordCriticStart(this.state.runId, toolCallId));
  }

  recordSubagentResult(toolCallId: string, output: string, isError: boolean): void {
    if (this.state.critic.toolCallId !== toolCallId) return;
    this.update(this.service.recordCriticResult(this.state.runId, toolCallId, output, isError));
  }

  recordRevision(summary: string, evidence: WorkbenchJsonObject): ProductionLoopState {
    return this.update(this.service.recordRevision(this.state.runId, summary, evidence));
  }

  requestCompletion(reason: string): string {
    if (this.state.status !== ProductionLoopStatus.ReadyToDeliver) {
      this.update(
        this.service.recordRecovery(
          this.state.runId,
          ProductionLoopRecoveryReason.PrematureFinalize,
          `Completion requested during ${this.state.phase}.`,
        ),
      );
      return `Completion blocked: production phase is ${this.state.phase}. Continue the persisted production workflow before requesting delivery.`;
    }
    this.update(this.service.recordDeliveryRequest(this.state.runId, reason));
    return this.downstream
      ? this.downstream.requestCompletion(reason)
      : 'Delivery requested. End the turn so deterministic verification can run.';
  }

  onAgentEnd(): { shouldFinish: boolean; reason?: string; nextPrompt?: string } {
    if (this.state.status === ProductionLoopStatus.ReadyToDeliver && this.state.deliveryReason) {
      if (this.downstream) {
        const decision = this.downstream.onAgentEnd();
        if (!decision.shouldFinish) return decision;
      }
      return {
        shouldFinish: true,
        reason: this.state.deliveryReason || 'Production workflow completed.',
      };
    }

    const stale = this.state.progressVersion === this.state.lastObservedProgressVersion;
    this.update(
      this.service.recordRecovery(
        this.state.runId,
        stale
          ? ProductionLoopRecoveryReason.StaleProgress
          : ProductionLoopRecoveryReason.MissingSignal,
        `Turn ended while production phase was ${this.state.phase}.`,
      ),
    );
    return {
      shouldFinish: false,
      nextPrompt: [
        '## Production workflow continuation',
        `The previous turn ended before delivery. Current phase: ${this.state.phase}.`,
        this.nextPhaseInstruction(),
      ].join('\n'),
    };
  }

  private nextPhaseInstruction(): string {
    switch (this.state.phase) {
      case ProductionLoopPhase.Explore:
        return 'Create and record a concrete prototype, then commit the plan.';
      case ProductionLoopPhase.Plan:
        return 'Commit the executable plan before using write tools.';
      case ProductionLoopPhase.Execute:
        return 'Continue plan execution, update item states, then start inspection.';
      case ProductionLoopPhase.Inspect:
        return 'Run deterministic checks and request an independent critique.';
      case ProductionLoopPhase.Critique:
        return this.requestCriticPrompt();
      case ProductionLoopPhase.Revise:
        return 'Address the critic findings and record the revision before inspecting again.';
      case ProductionLoopPhase.Deliver:
        return 'Call agent_loop done to request deterministic completion verification.';
    }
  }

  private update(state: ProductionLoopState): ProductionLoopState {
    this.state = state;
    return this.getState();
  }
}
