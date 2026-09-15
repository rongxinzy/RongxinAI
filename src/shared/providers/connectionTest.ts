import { resolveCodingPlanBaseUrl } from './codingPlan';

export const ProviderModelConnectionTestStatus = {
  Success: 'success',
  Failure: 'failure',
} as const;

export type ProviderModelConnectionTestStatus =
  (typeof ProviderModelConnectionTestStatus)[keyof typeof ProviderModelConnectionTestStatus];

export const ProviderModelConnectionFailureKind = {
  Model: 'model',
  Auth: 'auth',
  RateLimit: 'rate_limit',
  Server: 'server',
  Network: 'network',
  Unknown: 'unknown',
} as const;

export type ProviderModelConnectionFailureKind =
  (typeof ProviderModelConnectionFailureKind)[keyof typeof ProviderModelConnectionFailureKind];

export interface ProviderModelConnectionTest {
  status: ProviderModelConnectionTestStatus;
  /** SHA-256 of provider connection inputs; never contains the raw credential. */
  signature: string;
  testedAt: number;
  /** Absent only for metadata written before failure classification. */
  failureKind?: ProviderModelConnectionFailureKind;
}

type ConnectionApiFormat = 'anthropic' | 'openai' | 'gemini';

type ProviderConnectionInputs = {
  codingPlanEnabled?: boolean;
  apiKey?: string;
  authType?: string;
  oauthAccessToken?: string;
};

export async function createProviderConnectionTestSignature(input: {
  providerId: string;
  baseUrl: string;
  apiFormat: ConnectionApiFormat;
  provider: ProviderConnectionInputs;
}): Promise<string> {
  const resolved =
    input.apiFormat === 'gemini'
      ? { baseUrl: input.baseUrl, effectiveFormat: input.apiFormat }
      : resolveCodingPlanBaseUrl(
          input.providerId,
          input.provider.codingPlanEnabled === true,
          input.apiFormat,
          input.baseUrl,
        );

  // The signature intentionally includes the OAuth flag and token so a credential
  // change invalidates older failure markers without storing the credential itself.
  const credential = [
    input.provider.apiKey ?? '',
    input.provider.authType ?? '',
    input.provider.oauthAccessToken ?? '',
  ].join('\u0000');
  const payload = [
    input.providerId,
    resolved.baseUrl,
    resolved.effectiveFormat,
    credential,
  ].join('\u0000');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));

  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function isCurrentModelAvailableTest(
  model: { connectionTest?: ProviderModelConnectionTest },
  signature: string,
): boolean {
  return (
    model.connectionTest?.status === ProviderModelConnectionTestStatus.Success &&
    model.connectionTest.signature === signature
  );
}

export function applyProviderModelConnectionTestResults<
  TProvider extends {
    models?: Array<{ id: string; connectionTest?: ProviderModelConnectionTest }>;
  },
>(
  provider: TProvider,
  outcomes: ReadonlyArray<{
    modelId: string;
    success: boolean;
    failureKind?: ProviderModelConnectionFailureKind;
  }>,
  signature: string,
  testedAt: number = Date.now(),
): TProvider {
  if (outcomes.length === 0) return provider;

  const outcomeById = new Map(outcomes.map(outcome => [outcome.modelId, outcome]));
  return {
    ...provider,
    models: (provider.models ?? []).map(model => {
      const outcome = outcomeById.get(model.id);
      if (!outcome) return model;

      return {
        ...model,
        connectionTest: {
          status: outcome.success
            ? ProviderModelConnectionTestStatus.Success
            : ProviderModelConnectionTestStatus.Failure,
          signature,
          testedAt,
          ...(outcome.success || !outcome.failureKind
            ? {}
            : { failureKind: outcome.failureKind }),
        },
      };
    }),
  };
}