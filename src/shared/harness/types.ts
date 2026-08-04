import type { WorkbenchContractKind, WorkbenchJsonObject } from '../workbenchTask';
import type {
  HarnessActivationType,
  HarnessFailureWhere,
  HarnessFailureWhy,
  HarnessFeatureFlag,
  HarnessInfraStatus,
  HarnessPatchStatus,
  HarnessPathClass,
} from './constants';

export interface HarnessModelProfile {
  id: string;
  provider: string;
  model: string;
  reasoningProfile: string;
  workflowKind: WorkbenchContractKind;
  harnessVersion: string;
}

export interface HarnessModelProfileInput extends Omit<HarnessModelProfile, 'id'> {}

export interface HarnessFailureClassification {
  where: HarnessFailureWhere;
  why: HarnessFailureWhy;
  infraStatus: HarnessInfraStatus;
  retryable: boolean;
}

export interface HarnessFailureInput {
  message: string;
  stage?: string;
  code?: string;
  toolName?: string;
  evidence?: WorkbenchJsonObject;
}

export interface HarnessActivationEvent {
  activation: HarnessActivationType;
  iteration?: number;
  mechanism?: string;
  evidence?: WorkbenchJsonObject;
}

export interface HarnessFeatureFlagState {
  flag: HarnessFeatureFlag;
  enabled: boolean;
  source: 'default' | 'profile';
}

export interface HarnessPatchManifest {
  id: string;
  parentId: string | null;
  status: HarnessPatchStatus;
  modelProfileId: string;
  workflowKind: WorkbenchContractKind;
  where: HarnessFailureWhere;
  why: HarnessFailureWhy;
  touchedFiles: string[];
  activationPredicate: string;
  featureFlag: HarnessFeatureFlag;
  defaultOff: true;
  expectedEffect: string;
  rollback: string;
  evaluationIds: string[];
  promotedVersion: string | null;
}

export interface HarnessPathDecision {
  path: string;
  classification: HarnessPathClass;
  allowed: boolean;
  reason: string;
}
