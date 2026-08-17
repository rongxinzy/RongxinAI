import { createHash, randomUUID } from 'crypto';

import { HarnessActivationType } from '../../shared/harness';
import {
  ProductionCriticSeverity,
  ProductionCriticVerdict,
  ProductionLoopPhase,
  ProductionLoopRecoveryReason,
  ProductionLoopStatus,
  ProductionPlanItemStatus,
  type ProductionAvailableVerifierEvidence,
  type ProductionCriticFinding,
  type ProductionCriticExecution,
  type ProductionArtifactEvidence,
  type ProductionExpectedArtifact,
  type ProductionExpectedVerifier,
  type ProductionInspectionEvidence,
  type ProductionLoopState,
  type ProductionObservedToolResult,
  type ProductionPlanItem,
} from '../../shared/productionLoop';
import {
  WorkbenchVerificationOutcome,
  type WorkbenchContractKind,
  type WorkbenchJsonObject,
} from '../../shared/workbenchTask';
import type { ProductionLoopMeasurement, ProductionLoopStore } from './ports';
import { getProductionReviewContractRefs } from './reviewContract';
import { assertProductionLoopTransition } from './stateMachine';

const MAX_CRITIC_OUTPUT_LENGTH = 8_000;
const MAX_MODEL_EVIDENCE_SUMMARY_LENGTH = 300;
const MAX_MODEL_VERIFIER_EVIDENCE = 32;
export const MAX_OBSERVED_TOOL_RESULTS = 256;

const createEvidenceRef = (runId: string, toolCallId: string): string =>
  `ev-${createHash('sha256').update(`${runId}\0${toolCallId}`).digest('hex').slice(0, 16)}`;

interface CriticPayload {
  verdict: ProductionCriticVerdict;
  findings: ProductionCriticFinding[];
}

const normalizeStrings = (values: string[]): string[] => [
  ...new Set(values.map(value => value.trim()).filter(Boolean)),
];

const parseJsonRecord = (output: string): Record<string, unknown> => {
  const trimmed = output.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const objectStart = trimmed.indexOf('{');
  const objectEnd = trimmed.lastIndexOf('}');
  const embedded =
    objectStart >= 0 && objectEnd > objectStart
      ? trimmed.slice(objectStart, objectEnd + 1)
      : undefined;

  for (const candidate of [trimmed, fenced, embedded]) {
    if (!candidate) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next bounded representation.
    }
  }
  throw new Error('No JSON object found in critic output.');
};

const parseCriticPayload = (
  output: string,
  isError: boolean,
  allowedContractRefs: ReadonlySet<string>,
): CriticPayload => {
  if (isError) {
    return {
      verdict: ProductionCriticVerdict.Revise,
      findings: [
        {
          severity: ProductionCriticSeverity.Major,
          summary: 'The independent critic did not complete successfully.',
          evidence: output.slice(0, MAX_CRITIC_OUTPUT_LENGTH),
        },
      ],
    };
  }
  try {
    const parsed = parseJsonRecord(output);
    if (
      !Object.values(ProductionCriticVerdict).includes(parsed.verdict as ProductionCriticVerdict)
    ) {
      throw new Error('Critic verdict is missing or invalid.');
    }
    if (!Array.isArray(parsed.findings)) {
      throw new Error('Critic findings must be an array.');
    }
    const verdict = parsed.verdict as ProductionCriticVerdict;
    const findings = parsed.findings.map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Critic finding must be an object.');
      }
      const raw = value as Record<string, unknown>;
      if (typeof raw.summary !== 'string' || !raw.summary.trim()) {
        throw new Error('Critic finding summary is required.');
      }
      if (
        !Object.values(ProductionCriticSeverity).includes(raw.severity as ProductionCriticSeverity)
      ) {
        throw new Error('Critic finding severity is invalid.');
      }
      if (typeof raw.contractRef !== 'string' || !allowedContractRefs.has(raw.contractRef.trim())) {
        throw new Error('Critic finding contractRef is missing or invalid.');
      }
      if (typeof raw.evidence !== 'string' || !raw.evidence.trim()) {
        throw new Error('Critic finding evidence is required.');
      }
      return {
        severity: raw.severity as ProductionCriticSeverity,
        contractRef: raw.contractRef.trim(),
        summary: raw.summary.trim(),
        evidence: raw.evidence.trim(),
      };
    });
    if (verdict === ProductionCriticVerdict.Pass && findings.length > 0) {
      return { verdict: ProductionCriticVerdict.Revise, findings };
    }
    if (verdict === ProductionCriticVerdict.Revise && findings.length === 0) {
      throw new Error('A revise verdict requires at least one finding.');
    }
    return { verdict, findings };
  } catch {
    return {
      verdict: ProductionCriticVerdict.Revise,
      findings: [
        {
          severity: ProductionCriticSeverity.Major,
          summary: 'The independent critic returned an invalid structured response.',
          evidence: output.slice(0, MAX_CRITIC_OUTPUT_LENGTH),
        },
      ],
    };
  }
};

const resumePlanItemStatus = (status: ProductionPlanItemStatus): ProductionPlanItemStatus =>
  status === ProductionPlanItemStatus.InProgress ? ProductionPlanItemStatus.Pending : status;

const resolveInitialPhase = (
  previous: ProductionLoopState | null,
  prototypeRequired: boolean,
): ProductionLoopPhase => {
  if (!previous) {
    return prototypeRequired ? ProductionLoopPhase.Explore : ProductionLoopPhase.Plan;
  }
  if (previous.planItems.length > 0) return ProductionLoopPhase.Execute;
  if (prototypeRequired && previous.prototypes.length === 0) {
    return ProductionLoopPhase.Explore;
  }
  return ProductionLoopPhase.Plan;
};

export class ProductionLoopService {
  readonly repository: ProductionLoopStore;

  constructor(
    repository: ProductionLoopStore,
    private readonly measurement: ProductionLoopMeasurement,
    private readonly onPlanChanged?: (state: ProductionLoopState) => void,
  ) {
    this.repository = repository;
  }

  getState(runId: string): ProductionLoopState {
    const state = this.repository.get(runId);
    if (!state) throw new Error(`Production loop not found: ${runId}`);
    return state;
  }

  getAvailableVerifierEvidence(runId: string): ProductionAvailableVerifierEvidence[] {
    const state = this.getState(runId);
    return (state.observedToolResults ?? [])
      .filter(result => !result.isError && result.progressVersion === state.progressVersion)
      .slice(-MAX_MODEL_VERIFIER_EVIDENCE)
      .map(result => ({
        evidenceRef: createEvidenceRef(runId, result.toolCallId),
        toolName: result.toolName,
        outputSummary:
          result.output.trim().slice(0, MAX_MODEL_EVIDENCE_SUMMARY_LENGTH) ||
          `Tool ${result.toolName} completed successfully.`,
      }));
  }

  beginRun(input: {
    taskId: string;
    runId: string;
    workflowKind: WorkbenchContractKind;
    goal: string;
    prototypeRequired: boolean;
  }): ProductionLoopState {
    const existing = this.repository.get(input.runId);
    if (existing) return existing;
    const previous = this.repository.getLatestForTask(input.taskId, input.runId);
    const now = Date.now();
    const progressBaseline = previous?.progressVersion ?? 0;
    const state = this.repository.create({
      version: 1,
      taskId: input.taskId,
      runId: input.runId,
      workflowKind: input.workflowKind,
      goal: previous?.goal ?? input.goal,
      phase: resolveInitialPhase(previous, input.prototypeRequired),
      status: ProductionLoopStatus.Active,
      prototypeRequired: input.prototypeRequired,
      prototypes: previous?.prototypes ?? [],
      selectedDirection: previous?.selectedDirection ?? null,
      constraints: previous?.constraints ?? [],
      acceptanceCriteria: previous?.acceptanceCriteria ?? [],
      expectedArtifacts: previous?.expectedArtifacts ?? [],
      expectedVerifiers: previous?.expectedVerifiers ?? [],
      observedToolResults: [],
      inspections: [],
      planItems:
        previous?.planItems.map(item => ({
          ...item,
          status: resumePlanItemStatus(item.status),
        })) ?? [],
      critic: {
        requested: false,
        toolCallId: null,
        passed: false,
        findings: [],
        outputSummary: null,
        execution: null,
      },
      revisions: [],
      recoveries: [],
      skip: null,
      deliveryReason: null,
      progressVersion: progressBaseline,
      lastObservedProgressVersion: progressBaseline,
      staleCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    this.onPlanChanged?.(state);
    return state;
  }

  recordPrototype(runId: string, reference: string, summary: string): ProductionLoopState {
    return this.mutate(runId, state => {
      if (state.phase !== ProductionLoopPhase.Explore) {
        throw new Error('Prototypes can only be recorded during the explore phase.');
      }
      const normalizedReference = reference.trim();
      const normalizedSummary = summary.trim();
      if (!normalizedReference || !normalizedSummary) {
        throw new Error('A prototype requires a reference and summary.');
      }
      state.prototypes.push({
        reference: normalizedReference,
        summary: normalizedSummary,
        createdAt: Date.now(),
      });
      state.progressVersion += 1;
      this.measurement.recordActivation(runId, {
        activation: HarnessActivationType.PrototypeGenerated,
        mechanism: 'production_loop',
        evidence: { reference: normalizedReference },
      });
    });
  }

  commitPlan(
    runId: string,
    input: {
      items: Array<{ title: string; detail?: string }>;
      constraints: string[];
      acceptanceCriteria: string[];
      expectedArtifacts: ProductionExpectedArtifact[];
      expectedVerifiers: ProductionExpectedVerifier[];
      selectedDirection?: string;
    },
  ): ProductionLoopState {
    const state = this.mutate(runId, state => {
      if (state.phase === ProductionLoopPhase.Explore) {
        if (state.prototypeRequired && state.prototypes.length === 0) {
          throw new Error('At least one prototype is required before committing the plan.');
        }
        this.transition(state, ProductionLoopPhase.Plan);
      }
      if (state.phase !== ProductionLoopPhase.Plan) {
        throw new Error('The execution plan can only be committed during the plan phase.');
      }
      const items = input.items
        .map(item => ({ title: item.title.trim(), detail: item.detail?.trim() }))
        .filter(item => item.title);
      const acceptanceCriteria = normalizeStrings(input.acceptanceCriteria);
      const expectedArtifacts = input.expectedArtifacts.flatMap(artifact => {
        const kind = artifact.kind?.trim();
        const description = artifact.description?.trim();
        return kind && description
          ? [{ kind, description, required: artifact.required !== false }]
          : [];
      });
      const expectedVerifiers = input.expectedVerifiers.flatMap(verifier => {
        const name = verifier.name?.trim();
        return name ? [{ name, deterministic: verifier.deterministic === true }] : [];
      });
      const selectedDirection = input.selectedDirection?.trim() || null;
      if (
        items.length === 0 ||
        acceptanceCriteria.length === 0 ||
        !expectedVerifiers.some(verifier => verifier.deterministic)
      ) {
        throw new Error(
          'A plan requires at least one item, one acceptance criterion, and one deterministic verifier.',
        );
      }
      if (state.prototypeRequired && !selectedDirection) {
        throw new Error('A prototype-based plan must name the selected direction.');
      }
      state.planItems = items.map<ProductionPlanItem>(item => ({
        id: randomUUID(),
        title: item.title,
        detail: item.detail || undefined,
        status: ProductionPlanItemStatus.Pending,
      }));
      state.constraints = normalizeStrings(input.constraints);
      state.acceptanceCriteria = acceptanceCriteria;
      state.expectedArtifacts = expectedArtifacts;
      state.expectedVerifiers = expectedVerifiers;
      state.selectedDirection = selectedDirection;
      state.progressVersion += 1;
      this.transition(state, ProductionLoopPhase.Execute);
      this.measurement.recordActivation(runId, {
        activation: HarnessActivationType.PlanCommitted,
        mechanism: 'production_loop',
        evidence: {
          itemCount: state.planItems.length,
          acceptanceCriterionCount: state.acceptanceCriteria.length,
        },
      });
    });
    this.onPlanChanged?.(state);
    return state;
  }

  updatePlanItem(
    runId: string,
    itemId: string,
    status: ProductionPlanItemStatus,
  ): ProductionLoopState {
    const state = this.mutate(runId, state => {
      if (
        state.phase !== ProductionLoopPhase.Execute &&
        state.phase !== ProductionLoopPhase.Revise
      ) {
        throw new Error('Plan items can only be updated while executing or revising.');
      }
      const item = state.planItems.find(candidate => candidate.id === itemId);
      if (!item) throw new Error(`Production plan item not found: ${itemId}`);
      if (!Object.values(ProductionPlanItemStatus).includes(status)) {
        throw new Error(`Invalid production plan item status: ${String(status)}`);
      }
      if (item.status !== status) {
        item.status = status;
        state.progressVersion += 1;
      }
    });
    this.onPlanChanged?.(state);
    return state;
  }

  startInspection(
    runId: string,
    input: {
      artifacts: ProductionArtifactEvidence[];
      verifiers: Array<{ name: string; evidenceRef: string }>;
    },
  ): ProductionLoopState {
    return this.mutate(runId, state => {
      if (state.planItems.some(item => item.status !== ProductionPlanItemStatus.Completed)) {
        throw new Error('Every production plan item must be completed before inspection.');
      }
      const artifacts = input.artifacts.flatMap(artifact => {
        const kind = artifact.kind.trim();
        const reference = artifact.reference.trim();
        return kind && reference ? [{ kind, reference }] : [];
      });
      const observedToolResults = state.observedToolResults ?? [];
      const verifiers = input.verifiers.flatMap(verifier => {
        const name = verifier.name.trim();
        const evidenceRef = verifier.evidenceRef.trim();
        const observed = observedToolResults.find(
          result => createEvidenceRef(runId, result.toolCallId) === evidenceRef,
        );
        if (
          !name ||
          !evidenceRef ||
          !observed ||
          observed.isError ||
          observed.progressVersion !== state.progressVersion
        ) {
          return [];
        }
        return [
          {
            name,
            toolCallId: observed.toolCallId,
            toolName: observed.toolName,
            evidence: observed.output.trim() || `Tool ${observed.toolName} completed successfully.`,
          },
        ];
      });
      const missingArtifact = state.expectedArtifacts.find(
        expected =>
          expected.required && !artifacts.some(artifact => artifact.kind === expected.kind),
      );
      if (missingArtifact) {
        throw new Error(`Required artifact evidence is missing for kind: ${missingArtifact.kind}`);
      }
      const failedVerifier = state.expectedVerifiers.find(
        expected =>
          expected.deterministic && !verifiers.some(verifier => verifier.name === expected.name),
      );
      if (failedVerifier) {
        throw new Error(
          `Passing deterministic verifier evidence is missing for: ${failedVerifier.name}`,
        );
      }
      const inspection: ProductionInspectionEvidence = {
        artifacts,
        verifiers,
        createdAt: Date.now(),
      };
      state.inspections ??= [];
      state.inspections.push(inspection);
      this.transition(state, ProductionLoopPhase.Inspect);
      state.progressVersion += 1;
    });
  }

  requestCritique(runId: string): ProductionLoopState {
    return this.mutate(runId, state => {
      this.transition(state, ProductionLoopPhase.Critique);
      state.status = ProductionLoopStatus.WaitingCritic;
      state.critic = {
        requested: true,
        toolCallId: null,
        passed: false,
        findings: [],
        outputSummary: null,
        execution: null,
      };
      state.progressVersion += 1;
      this.measurement.recordActivation(runId, {
        activation: HarnessActivationType.CriticRequested,
        mechanism: 'production_loop_reviewer',
      });
    });
  }

  recordToolResult(
    runId: string,
    input: Omit<ProductionObservedToolResult, 'createdAt' | 'progressVersion'>,
  ): ProductionLoopState {
    return this.mutate(runId, state => {
      const toolCallId = input.toolCallId.trim();
      const toolName = input.toolName.trim();
      if (!toolCallId || !toolName) return;
      const result: ProductionObservedToolResult = {
        toolCallId,
        toolName,
        output: input.output.slice(0, MAX_CRITIC_OUTPUT_LENGTH),
        isError: input.isError,
        progressVersion: state.progressVersion,
        createdAt: Date.now(),
      };
      state.observedToolResults = (state.observedToolResults ?? []).filter(
        existing => existing.toolCallId !== toolCallId,
      );
      state.observedToolResults.push(result);
      if (state.observedToolResults.length > MAX_OBSERVED_TOOL_RESULTS) {
        state.observedToolResults = state.observedToolResults.slice(-MAX_OBSERVED_TOOL_RESULTS);
      }
    });
  }

  recordCriticStart(runId: string, toolCallId: string): ProductionLoopState {
    return this.mutate(runId, state => {
      if (state.phase !== ProductionLoopPhase.Critique || !state.critic.requested) {
        throw new Error('The production loop is not waiting for a critic.');
      }
      state.critic.toolCallId = toolCallId;
    });
  }

  recordCriticResult(
    runId: string,
    toolCallId: string,
    output: string,
    isError: boolean,
    execution?: ProductionCriticExecution,
  ): ProductionLoopState {
    return this.mutate(runId, state => {
      if (state.critic.toolCallId !== toolCallId) return;
      state.critic.outputSummary = output.slice(0, MAX_CRITIC_OUTPUT_LENGTH);
      state.critic.execution = execution ?? null;
      if (execution?.timedOut) {
        state.critic.toolCallId = null;
        state.critic.passed = false;
        state.critic.findings = [];
        state.progressVersion += 1;
        console.warn(
          `[ProductionLoop] critic timed out after ${execution.durationMs}ms; retaining critique phase for retry`,
        );
        this.measurement.recordActivation(runId, {
          activation: HarnessActivationType.RecoveryTriggered,
          mechanism: 'production_loop_reviewer',
          evidence: {
            durationMs: execution.durationMs,
            assistantTurns: execution.assistantTurns,
            toolCalls: execution.toolCalls,
            steerRequested: execution.steerRequested,
            timedOut: true,
          },
        });
        return;
      }
      const result = parseCriticPayload(output, isError, getProductionReviewContractRefs(state));
      state.critic.findings = result.findings;
      state.critic.passed = result.verdict === ProductionCriticVerdict.Pass;
      state.progressVersion += 1;
      if (result.verdict === ProductionCriticVerdict.Pass) {
        this.transition(state, ProductionLoopPhase.Deliver);
        state.status = ProductionLoopStatus.ReadyToDeliver;
        return;
      }
      this.transition(state, ProductionLoopPhase.Revise);
      state.status = ProductionLoopStatus.NeedsRevision;
      this.measurement.recordActivation(runId, {
        activation: HarnessActivationType.CriticRejected,
        mechanism: 'production_loop_reviewer',
        evidence: { findingCount: result.findings.length },
      });
    });
  }

  recordRevision(
    runId: string,
    summary: string,
    evidence: WorkbenchJsonObject,
  ): ProductionLoopState {
    return this.mutate(runId, state => {
      if (state.phase !== ProductionLoopPhase.Revise) {
        throw new Error('Revisions can only be recorded after critic findings.');
      }
      const normalizedSummary = summary.trim();
      if (!normalizedSummary) throw new Error('A revision requires a summary.');
      state.revisions.push({
        summary: normalizedSummary,
        evidence,
        createdAt: Date.now(),
        progressVersion: state.progressVersion + 1,
      });
      state.status = ProductionLoopStatus.Active;
      state.progressVersion += 1;
      state.observedToolResults = [];
      this.measurement.recordActivation(runId, {
        activation: HarnessActivationType.RevisionApplied,
        mechanism: 'production_loop',
        evidence: { revisionCount: state.revisions.length },
      });
    });
  }

  recordRecovery(
    runId: string,
    reason: ProductionLoopRecoveryReason,
    detail: string,
  ): ProductionLoopState {
    return this.mutate(runId, state => {
      state.recoveries.push({ reason, detail, createdAt: Date.now() });
      if (state.progressVersion === state.lastObservedProgressVersion) state.staleCount += 1;
      else state.staleCount = 0;
      state.lastObservedProgressVersion = state.progressVersion;
      this.measurement.recordActivation(runId, {
        activation:
          reason === ProductionLoopRecoveryReason.StaleProgress
            ? HarnessActivationType.StaleIterationPivoted
            : HarnessActivationType.RecoveryTriggered,
        mechanism: 'production_loop',
        evidence: { reason, staleCount: state.staleCount },
      });
    });
  }

  recordDeliveryRequest(runId: string, reason: string): ProductionLoopState {
    return this.mutate(runId, state => {
      if (state.status !== ProductionLoopStatus.ReadyToDeliver) {
        throw new Error('The production loop is not ready to deliver.');
      }
      state.deliveryReason = reason.trim() || 'Production loop completed.';
    });
  }

  /**
   * Declare that this task needs no production workflow (pure information
   * requests, trivial edits). Only valid before a plan is committed. The loop
   * is marked completed so the agent may end the turn without a completion
   * gate; deterministic verification still applies on run completion.
   */
  skipWorkflow(runId: string, reason: string): ProductionLoopState {
    return this.mutate(runId, state => {
      if (state.skip) return;
      if (state.phase !== ProductionLoopPhase.Explore && state.phase !== ProductionLoopPhase.Plan) {
        throw new Error('The workflow can only be skipped before a plan is committed.');
      }
      const normalized = reason.trim();
      if (!normalized) throw new Error('A skip reason is required.');
      state.skip = { reason: normalized, createdAt: Date.now() };
      state.status = ProductionLoopStatus.Completed;
      state.progressVersion += 1;
      this.measurement.recordActivation(runId, {
        activation: HarnessActivationType.WorkflowSkipped,
        mechanism: 'production_loop',
        evidence: { reason: normalized },
      });
    });
  }

  recordVerificationResult(
    runId: string,
    outcome: WorkbenchVerificationOutcome,
    summary: string,
  ): ProductionLoopState | null {
    if (!this.repository.get(runId)) return null;
    return this.mutate(runId, state => {
      // The loop may have been skipped or never reached delivery readiness
      // (e.g. the run settled outside the workflow). That is not an error:
      // verification outcome still applies to the underlying run.
      if (state.status !== ProductionLoopStatus.ReadyToDeliver || !state.deliveryReason) {
        return;
      }
      if (outcome === WorkbenchVerificationOutcome.Passed) {
        state.status = ProductionLoopStatus.Completed;
        return;
      }
      if (outcome === WorkbenchVerificationOutcome.AcceptanceRequired) return;
      this.transition(state, ProductionLoopPhase.Revise);
      state.status = ProductionLoopStatus.NeedsRevision;
      state.critic = {
        requested: false,
        toolCallId: null,
        passed: false,
        findings: [
          {
            severity: ProductionCriticSeverity.Major,
            summary: 'Deterministic completion verification failed.',
            evidence: summary,
          },
        ],
        outputSummary: null,
        execution: null,
      };
      state.deliveryReason = null;
    });
  }

  deleteSession(sessionId: string): void {
    this.repository.deleteForSession(sessionId);
  }

  private mutate(
    runId: string,
    operation: (state: ProductionLoopState) => void,
  ): ProductionLoopState {
    return this.repository.transaction(() => {
      const state = this.repository.get(runId);
      if (!state) throw new Error(`Production loop not found: ${runId}`);
      operation(state);
      return this.repository.update(state);
    });
  }

  private transition(state: ProductionLoopState, phase: ProductionLoopPhase): void {
    assertProductionLoopTransition(state.phase, phase);
    state.phase = phase;
  }
}
