import {
  ApiFormat,
  buildAnthropicMessagesUrl,
  resolveCodingPlanBaseUrl,
  type ProviderConfig,
} from '../../shared/providers';

export interface ProviderModelConnectionTarget {
  id: string;
  name: string;
}

export interface ProviderModelConnectionTestInput {
  providerId: string;
  provider: ProviderConfig;
  baseUrl: string;
  apiFormat: ApiFormat;
  model: ProviderModelConnectionTarget;
}

export type ProviderModelConnectionTestResult =
  | { success: true }
  | { success: false; message: string };

export interface ProviderModelConnectionTestResponse {
  ok: boolean;
  status: number;
  data?: unknown;
}

const CONNECTIVITY_TEST_TOKEN_BUDGET = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const getResponseErrorMessage = (data: unknown, status: number): string => {
  if (isRecord(data)) {
    const error = isRecord(data.error) ? data.error : undefined;
    const message = error?.message ?? data.message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return `HTTP ${status}`;
};

const buildOpenAICompatibleChatCompletionsUrl = (baseUrl: string, provider: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) return '/v1/chat/completions';
  if (normalized.endsWith('/chat/completions')) return normalized;

  const isGeminiLike =
    provider === 'gemini' || normalized.includes('generativelanguage.googleapis.com');
  if (isGeminiLike) {
    if (normalized.endsWith('/v1beta/openai') || normalized.endsWith('/v1/openai')) {
      return `${normalized}/chat/completions`;
    }
    if (normalized.endsWith('/v1beta') || normalized.endsWith('/v1')) {
      const betaBase = normalized.endsWith('/v1') ? `${normalized.slice(0, -3)}v1beta` : normalized;
      return `${betaBase}/openai/chat/completions`;
    }
    return `${normalized}/v1beta/openai/chat/completions`;
  }

  if (provider === 'github-copilot') return `${normalized}/chat/completions`;
  return /\/v\d+$/.test(normalized)
    ? `${normalized}/chat/completions`
    : `${normalized}/v1/chat/completions`;
};

const buildOpenAIResponsesUrl = (baseUrl: string): string => {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!normalized) return '/v1/responses';
  if (normalized.endsWith('/responses')) return normalized;
  return normalized.endsWith('/v1') ? `${normalized}/responses` : `${normalized}/v1/responses`;
};

const shouldUseMaxCompletionTokensForOpenAI = (provider: string, modelId: string): boolean => {
  if (provider !== 'openai') return false;
  const normalized = modelId.toLowerCase();
  const resolved = normalized.includes('/') ? normalized.slice(normalized.lastIndexOf('/') + 1) : normalized;
  return (
    resolved.startsWith('gpt-5') ||
    resolved.startsWith('o1') ||
    resolved.startsWith('o3') ||
    resolved.startsWith('o4')
  );
};

export function getProviderModelConnectionTestResult(
  response: ProviderModelConnectionTestResponse,
): ProviderModelConnectionTestResult {
  if (response.ok) return { success: true };

  const message = getResponseErrorMessage(response.data, response.status);
  if (message.toLowerCase().includes('model output limit was reached')) {
    return { success: true };
  }
  return { success: false, message };
}

export async function testProviderModelConnection(
  input: ProviderModelConnectionTestInput,
): Promise<ProviderModelConnectionTestResult> {
  const resolved =
    input.apiFormat === ApiFormat.Gemini
      ? { baseUrl: input.baseUrl, effectiveFormat: input.apiFormat }
      : resolveCodingPlanBaseUrl(
          input.providerId,
          input.provider.codingPlanEnabled === true,
          input.apiFormat,
          input.baseUrl,
        );
  const baseUrl = resolved.baseUrl.trim().replace(/\/+$/, '');
  const apiFormat = resolved.effectiveFormat;
  const apiKey = input.provider.apiKey;

  try {
    if (apiFormat === ApiFormat.Anthropic) {
      const response = await window.electron.api.fetch({
        url: buildAnthropicMessagesUrl(baseUrl),
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model.id,
          max_tokens: CONNECTIVITY_TEST_TOKEN_BUDGET,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      });
      return getProviderModelConnectionTestResult(response);
    }

    const useResponsesApi = input.providerId === 'openai';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (input.providerId === 'github-copilot') {
      headers['Copilot-Integration-Id'] = 'vscode-chat';
      headers['Editor-Version'] = 'vscode/1.96.2';
      headers['Editor-Plugin-Version'] = 'copilot-chat/0.26.7';
      headers['User-Agent'] = 'GitHubCopilotChat/0.26.7';
      headers['Openai-Intent'] = 'conversation-panel';
    }

    const body: Record<string, unknown> = useResponsesApi
      ? {
          model: input.model.id,
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'Hi' }] }],
          max_output_tokens: CONNECTIVITY_TEST_TOKEN_BUDGET,
        }
      : {
          model: input.model.id,
          messages: [{ role: 'user', content: 'Hi' }],
        };
    if (!useResponsesApi) {
      body[
        shouldUseMaxCompletionTokensForOpenAI(input.providerId, input.model.id)
          ? 'max_completion_tokens'
          : 'max_tokens'
      ] = CONNECTIVITY_TEST_TOKEN_BUDGET;
    }

    const response = await window.electron.api.fetch({
      url: useResponsesApi
        ? buildOpenAIResponsesUrl(baseUrl)
        : buildOpenAICompatibleChatCompletionsUrl(baseUrl, input.providerId),
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return getProviderModelConnectionTestResult(response);
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Connection test failed',
    };
  }
}

export async function testProviderModelsSequentially(
  input: Omit<ProviderModelConnectionTestInput, 'model'> & {
    models: readonly ProviderModelConnectionTarget[];
  },
): Promise<Array<{ model: ProviderModelConnectionTarget; result: ProviderModelConnectionTestResult }>> {
  const results: Array<{
    model: ProviderModelConnectionTarget;
    result: ProviderModelConnectionTestResult;
  }> = [];
  for (const model of input.models) {
    const result = await testProviderModelConnection({ ...input, model });
    results.push({ model, result });
  }
  return results;
}
