import {
  HarnessInfraStatus,
  type HarnessActivationEvent,
  type HarnessFailureInput,
  type HarnessModelProfile,
  type HarnessModelProfileInput,
} from '../../shared/harness';
import { WorkbenchRunEventType, type WorkbenchJsonObject } from '../../shared/workbenchTask';
import { serializeForLog } from '../libs/sanitizeForLog';
import type { WorkbenchTaskRepository } from '../workbenchTask/repository';
import { classifyHarnessFailure } from './failureClassifier';
import { createHarnessModelProfile } from './modelProfile';

const MAX_FAILURE_MESSAGE_LENGTH = 1_000;
const SECRET_TEXT_PATTERNS = [
  { pattern: /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, replacement: 'Bearer [redacted]' },
  {
    pattern:
      /((?:api[-_]?key|token|secret|password|authorization|cookie|credential)\s*[:=]\s*)([^\s,;]+)/gi,
    replacement: '$1[redacted]',
  },
] as const;

const sanitizeFailureText = (value: string): string => {
  const redacted = SECRET_TEXT_PATTERNS.reduce(
    (text, entry) => text.replace(entry.pattern, entry.replacement),
    value,
  );
  return redacted.length <= MAX_FAILURE_MESSAGE_LENGTH
    ? redacted
    : `${redacted.slice(0, MAX_FAILURE_MESSAGE_LENGTH)}...`;
};

export class HarnessMeasurementService {
  constructor(private readonly repository: WorkbenchTaskRepository) {}

  recordModelProfile(runId: string, input: HarnessModelProfileInput): HarnessModelProfile {
    const profile = createHarnessModelProfile(input);
    this.repository.appendRunEvent(runId, WorkbenchRunEventType.HarnessProfiled, { profile });
    return profile;
  }

  recordActivation(runId: string, input: HarnessActivationEvent): void {
    this.repository.appendRunEvent(runId, WorkbenchRunEventType.HarnessActivation, {
      ...input,
    });
  }

  recordFailure(runId: string, input: HarnessFailureInput): void {
    const classification = classifyHarnessFailure(input);
    this.repository.appendRunEvent(runId, WorkbenchRunEventType.HarnessFailure, {
      ...classification,
      message: sanitizeFailureText(input.message),
      stage: input.stage,
      code: input.code,
      toolName: input.toolName,
      evidenceSummary: input.evidence
        ? sanitizeFailureText(serializeForLog(input.evidence, MAX_FAILURE_MESSAGE_LENGTH))
        : undefined,
      coverage: classification.infraStatus === HarnessInfraStatus.NotApplicable ? 'agent' : 'infra',
    });
  }

  recordVerification(runId: string, payload: WorkbenchJsonObject & { passed: boolean }): void {
    this.repository.appendRunEvent(runId, WorkbenchRunEventType.HarnessQualityMeasured, payload);
  }
}
