import { AISphereError } from '../../../shared/aisphere';

export interface PreparedRequest {
  model: string;
  body: string;
}

/** Pure validation, executed in a worker for image-bearing/large chat bodies. */
export function prepareRequestBody(body: string, maxTokens?: number): PreparedRequest {
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(AISphereError.RequestRejected);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.model !== 'string' || !input.model || !Array.isArray(input.messages)) {
    throw new Error(AISphereError.RequestRejected);
  }
  if (maxTokens) {
    for (const key of ['max_tokens', 'max_completion_tokens']) {
      if (typeof input[key] === 'number') input[key] = Math.min(maxTokens, input[key]);
    }
    if (input.max_tokens === undefined && input.max_completion_tokens === undefined) {
      input.max_tokens = maxTokens;
    }
  }
  return { model: input.model, body: maxTokens ? JSON.stringify(input) : body };
}
