import {
  HarnessFailureWhere,
  HarnessFailureWhy,
  HarnessInfraStatus,
  type HarnessFailureClassification,
  type HarnessFailureInput,
} from '../../shared/harness';

const includesAny = (value: string, terms: string[]): boolean =>
  terms.some(term => value.includes(term));

export function classifyHarnessFailure(input: HarnessFailureInput): HarnessFailureClassification {
  const message = `${input.code || ''} ${input.stage || ''} ${input.message}`.toLowerCase();

  if (
    includesAny(message, [
      'econnreset',
      'econnrefused',
      'enotfound',
      'network',
      'timed out',
      'timeout',
      'rate limit',
      '429',
      '503',
      'sandbox unavailable',
      'renderer unavailable',
      'dependency unavailable',
    ])
  ) {
    return {
      where: HarnessFailureWhere.Runtime,
      why: HarnessFailureWhy.InfraFailure,
      infraStatus: HarnessInfraStatus.Retryable,
      retryable: true,
    };
  }

  if (includesAny(message, ['unauthorized', 'forbidden', 'invalid api key', '401', '403'])) {
    return {
      where: HarnessFailureWhere.Config,
      why: HarnessFailureWhy.InfraFailure,
      infraStatus: HarnessInfraStatus.Terminal,
      retryable: false,
    };
  }

  if (includesAny(message, ['context length', 'context window', 'tool calling unsupported'])) {
    return {
      where: HarnessFailureWhere.Config,
      why: HarnessFailureWhy.ModelCapabilityLimit,
      infraStatus: HarnessInfraStatus.NotApplicable,
      retryable: false,
    };
  }

  if (includesAny(message, ['missing artifact', 'invalid artifact', 'artifact verification'])) {
    return {
      where: HarnessFailureWhere.Runtime,
      why: HarnessFailureWhy.MissingOrInvalidArtifact,
      infraStatus: HarnessInfraStatus.NotApplicable,
      retryable: false,
    };
  }

  return {
    where: input.toolName ? HarnessFailureWhere.Runtime : HarnessFailureWhere.Prompt,
    why: HarnessFailureWhy.UnverifiedDelivery,
    infraStatus: HarnessInfraStatus.NotApplicable,
    retryable: false,
  };
}
