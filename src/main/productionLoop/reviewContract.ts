import type { ProductionLoopState } from '../../shared/productionLoop';
import { PiSubagentToolName } from '../libs/agentEngine/piSubagentConstants';

const MAX_GENERAL_TEXT_LENGTH = 600;
const MAX_GOAL_LENGTH = 1_200;
const MAX_EVIDENCE_TEXT_LENGTH = 320;
const MAX_OBSERVED_RESULTS = 12;

const SECRET_ASSIGNMENT_PATTERN =
  /(["']?(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*)(["']?)([^"'\s,}]+)\2/gi;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[^\s,;]+/gi;
const AUTHORIZATION_VALUE_PATTERN = /\bAuthorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi;
const PROVIDER_TOKEN_PATTERN =
  /\b(?:sk-[a-z0-9_-]{12,}|ghp_[a-z0-9]{20,}|github_pat_[a-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/gi;
const URL_CREDENTIAL_PATTERN = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

const redactSecrets = (value: string): string =>
  value
    .replace(AUTHORIZATION_VALUE_PATTERN, 'Authorization: [REDACTED]')
    .replace(BEARER_TOKEN_PATTERN, 'Bearer [REDACTED]')
    .replace(SECRET_ASSIGNMENT_PATTERN, '$1[REDACTED]')
    .replace(PROVIDER_TOKEN_PATTERN, '[REDACTED]')
    .replace(URL_CREDENTIAL_PATTERN, '$1[REDACTED]@');

const boundedText = (value: string, maxLength = MAX_GENERAL_TEXT_LENGTH): string =>
  redactSecrets(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);

type ProductionReviewContractSource = Pick<
  ProductionLoopState,
  | 'goal'
  | 'constraints'
  | 'acceptanceCriteria'
  | 'expectedArtifacts'
  | 'expectedVerifiers'
  | 'planItems'
  | 'inspections'
  | 'observedToolResults'
  | 'revisions'
>;

export const ProductionReviewContractRef = {
  Goal: 'goal',
  Constraints: 'constraints',
  AcceptanceCriteria: 'acceptanceCriteria',
  Artifacts: 'artifacts',
  Verifiers: 'verifiers',
  Plan: 'plan',
} as const;

const indexedContractRef = (section: string, index: number): string => `${section}[${index}]`;

export const getProductionReviewContractRefs = (
  state: ProductionReviewContractSource,
): ReadonlySet<string> =>
  new Set([
    ProductionReviewContractRef.Goal,
    ...state.constraints.map((_, index) =>
      indexedContractRef(ProductionReviewContractRef.Constraints, index),
    ),
    ...state.acceptanceCriteria.map((_, index) =>
      indexedContractRef(ProductionReviewContractRef.AcceptanceCriteria, index),
    ),
    ...state.expectedArtifacts.map((_, index) =>
      indexedContractRef(ProductionReviewContractRef.Artifacts, index),
    ),
    ...state.expectedVerifiers.map((_, index) =>
      indexedContractRef(ProductionReviewContractRef.Verifiers, index),
    ),
    ...state.planItems.map((_, index) =>
      indexedContractRef(ProductionReviewContractRef.Plan, index),
    ),
  ]);

export const buildProductionReviewContract = (state: ProductionReviewContractSource) => {
  const latestRevision = state.revisions[state.revisions.length - 1];
  const latestInspection = state.inspections[state.inspections.length - 1];
  const observedExecution = state.observedToolResults
    .filter(
      result =>
        result.toolName !== PiSubagentToolName &&
        (latestRevision?.progressVersion !== undefined
          ? result.progressVersion >= latestRevision.progressVersion
          : result.createdAt >= (latestRevision?.createdAt ?? Number.NEGATIVE_INFINITY)),
    )
    .sort((left, right) => left.createdAt - right.createdAt)
    .slice(-MAX_OBSERVED_RESULTS)
    .map(result => ({
      toolName: boundedText(result.toolName),
      toolCallId: boundedText(result.toolCallId),
      isError: result.isError,
      outputSummary: boundedText(result.output, MAX_EVIDENCE_TEXT_LENGTH),
    }));

  return {
    goal: {
      ref: ProductionReviewContractRef.Goal,
      text: boundedText(state.goal, MAX_GOAL_LENGTH),
    },
    constraints: state.constraints.map((value, index) => ({
      ref: indexedContractRef(ProductionReviewContractRef.Constraints, index),
      text: boundedText(value),
    })),
    acceptanceCriteria: state.acceptanceCriteria.map((value, index) => ({
      ref: indexedContractRef(ProductionReviewContractRef.AcceptanceCriteria, index),
      text: boundedText(value),
    })),
    artifacts: state.expectedArtifacts.map((artifact, index) => ({
      ref: indexedContractRef(ProductionReviewContractRef.Artifacts, index),
      kind: boundedText(artifact.kind),
      description: boundedText(artifact.description),
      required: artifact.required,
    })),
    verifiers: state.expectedVerifiers.map((verifier, index) => ({
      ref: indexedContractRef(ProductionReviewContractRef.Verifiers, index),
      name: boundedText(verifier.name),
      deterministic: verifier.deterministic,
    })),
    plan: state.planItems.map((item, index) => ({
      ref: indexedContractRef(ProductionReviewContractRef.Plan, index),
      status: item.status,
      title: boundedText(item.title),
    })),
    inspection: latestInspection
      ? {
          artifacts: latestInspection.artifacts.map(artifact => ({
            kind: boundedText(artifact.kind),
            reference: boundedText(artifact.reference),
          })),
          verifiers: latestInspection.verifiers.map(verifier => ({
            name: boundedText(verifier.name),
            toolName: boundedText(verifier.toolName),
            toolCallId: boundedText(verifier.toolCallId),
            evidence: boundedText(verifier.evidence, MAX_EVIDENCE_TEXT_LENGTH),
          })),
        }
      : null,
    observedExecution,
  };
};
