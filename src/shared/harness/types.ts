import type { WorkbenchContractKind, WorkbenchJsonObject } from '../workbenchTask';
import type {
  HarnessActivationType,
  HarnessFailureWhere,
  HarnessFailureWhy,
  HarnessInfraStatus,
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
