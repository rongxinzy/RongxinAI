import type { WorkbenchContractKind, WorkbenchJsonObject } from '../workbenchTask';
import type {
  ProductionCriticSeverity,
  ProductionLoopPhase,
  ProductionLoopRecoveryReason,
  ProductionLoopStatus,
  ProductionPlanItemStatus,
  ProductionSkipSource,
} from './constants';

export interface ProductionPlanItem {
  id: string;
  title: string;
  status: ProductionPlanItemStatus;
  detail?: string;
}

export interface ProductionPrototype {
  reference: string;
  summary: string;
  createdAt: number;
}

export interface ProductionExpectedArtifact {
  kind: string;
  description: string;
  required: boolean;
}

export interface ProductionExpectedVerifier {
  name: string;
  deterministic: boolean;
}

export interface ProductionArtifactEvidence {
  kind: string;
  reference: string;
}

export interface ProductionVerifierEvidence {
  name: string;
  toolCallId: string;
  toolName: string;
  evidence: string;
}

export interface ProductionObservedToolResult {
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
  progressVersion: number;
  createdAt: number;
}

export interface ProductionAvailableVerifierEvidence {
  evidenceRef: string;
  toolName: string;
  outputSummary: string;
}

export interface ProductionInspectionEvidence {
  artifacts: ProductionArtifactEvidence[];
  verifiers: ProductionVerifierEvidence[];
  createdAt: number;
}

export interface ProductionCriticFinding {
  severity: ProductionCriticSeverity;
  summary: string;
  /** Explicit persisted contract entry that this blocking finding violates. */
  contractRef?: string;
  evidence?: string;
}

export interface ProductionCriticExecution {
  durationMs: number;
  assistantTurns: number;
  toolCalls: number;
  steerRequested: boolean;
  timedOut: boolean;
}

export interface ProductionCriticState {
  requested: boolean;
  toolCallId: string | null;
  passed: boolean;
  findings: ProductionCriticFinding[];
  outputSummary: string | null;
  execution: ProductionCriticExecution | null;
  /**
   * True when the critique phase was bypassed by lightweight review mode.
   * passed stays false so skipped review cannot be mistaken for approval;
   * the flag preserves the distinction for audit.
   */
  skipped?: boolean;
}

export interface ProductionRevision {
  summary: string;
  evidence: WorkbenchJsonObject;
  createdAt: number;
  progressVersion?: number;
}

export interface ProductionRecovery {
  reason: ProductionLoopRecoveryReason;
  detail: string;
  createdAt: number;
}

export interface ProductionSkip {
  reason: string;
  /** Missing on production-loop records created before skip sources existed. */
  source?: ProductionSkipSource;
  createdAt: number;
}

export interface ProductionLoopState {
  version: 1;
  taskId: string;
  runId: string;
  workflowKind: WorkbenchContractKind;
  goal: string;
  phase: ProductionLoopPhase;
  status: ProductionLoopStatus;
  prototypeRequired: boolean;
  prototypes: ProductionPrototype[];
  selectedDirection: string | null;
  constraints: string[];
  acceptanceCriteria: string[];
  expectedArtifacts: ProductionExpectedArtifact[];
  expectedVerifiers: ProductionExpectedVerifier[];
  observedToolResults: ProductionObservedToolResult[];
  inspections: ProductionInspectionEvidence[];
  planItems: ProductionPlanItem[];
  critic: ProductionCriticState;
  revisions: ProductionRevision[];
  recoveries: ProductionRecovery[];
  /** Set when the model declares the task needs no production workflow. */
  skip: ProductionSkip | null;
  deliveryReason: string | null;
  progressVersion: number;
  lastObservedProgressVersion: number;
  staleCount: number;
  createdAt: number;
  updatedAt: number;
}
