import type { WorkbenchContractKind, WorkbenchJsonObject } from '../workbenchTask';
import type {
  ProductionCriticSeverity,
  ProductionLoopPhase,
  ProductionLoopRecoveryReason,
  ProductionLoopStatus,
  ProductionPlanItemStatus,
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
  passed: boolean;
  evidence: string;
}

export interface ProductionInspectionEvidence {
  artifacts: ProductionArtifactEvidence[];
  verifiers: ProductionVerifierEvidence[];
  createdAt: number;
}

export interface ProductionCriticFinding {
  severity: ProductionCriticSeverity;
  summary: string;
  evidence?: string;
}

export interface ProductionCriticState {
  requested: boolean;
  toolCallId: string | null;
  passed: boolean;
  findings: ProductionCriticFinding[];
  outputSummary: string | null;
}

export interface ProductionRevision {
  summary: string;
  evidence: WorkbenchJsonObject;
  createdAt: number;
}

export interface ProductionRecovery {
  reason: ProductionLoopRecoveryReason;
  detail: string;
  createdAt: number;
}

export interface ProductionSkip {
  reason: string;
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
