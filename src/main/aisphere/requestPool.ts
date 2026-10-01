import { AISphereError } from '../../shared/aisphere';

export interface PreparedAISphereRequest {
  readonly model: string;
  readonly body: string;
}

const TOKEN_FIELDS = ['max_tokens', 'max_completion_tokens'] as const;

function rejectRequest(): never {
  throw new Error(AISphereError.RequestRejected);
}

/** Parse a chat completion body and clamp output-token fields to the model limit. */
export function prepareAISphereRequest(body: string, maxTokens?: number): PreparedAISphereRequest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    rejectRequest();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) rejectRequest();
  const record = parsed as Record<string, unknown>;
  const model = record.model;
  if (typeof model !== 'string' || model.trim().length === 0) rejectRequest();

  if (typeof maxTokens !== 'number' || !Number.isFinite(maxTokens) || maxTokens <= 0) {
    return { model, body };
  }

  let changed = false;
  for (const field of TOKEN_FIELDS) {
    const value = record[field];
    if (typeof value === 'number' && Number.isFinite(value) && value > maxTokens) {
      record[field] = maxTokens;
      changed = true;
    }
  }
  return { model, body: changed ? JSON.stringify(record) : body };
}

export class AISphereRequestPool {
  #closed = false;

  async run(
    body: string,
    signal: AbortSignal,
    maxTokens?: number,
  ): Promise<PreparedAISphereRequest> {
    if (this.#closed || signal.aborted) rejectRequest();
    return prepareAISphereRequest(body, maxTokens);
  }

  close(): void {
    this.#closed = true;
  }
}
