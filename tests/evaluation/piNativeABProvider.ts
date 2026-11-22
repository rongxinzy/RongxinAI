import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ZhiyuanModelPool,
  ZhiyuanModelPoolHeader,
  ZhiyuanModelPoolWorkload,
} from '../../src/shared/modelPool/constants';
import {
  attributePiWorkRequest,
  type PiWorkRequestByteAttribution,
} from './piWorkTokenAttribution';

export interface Provider {
  baseUrl: string;
  apiKey?: string;
  model: string;
  contextWindow: number;
  maxTokens: number;
}

export interface RequestMetrics {
  status: number;
  model?: string;
  finishReason?: string;
  errorCode?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  tools: number;
  systemBytes: number;
  requestBytes: number;
  compaction: boolean;
  attribution?: PiWorkRequestByteAttribution;
}

export type LivePiRequest = {
  model?: string;
  tools?: Array<{ type?: string; function?: { name?: string } }>;
  messages?: Array<{ role?: string; content?: unknown }>;
} & Record<string, unknown>;

export type LiveRequestTransform = (request: LivePiRequest) => LivePiRequest;

export async function provider(): Promise<Provider> {
  const contextWindow = Number(process.env.PI_AB_CONTEXT_WINDOW || 65536);
  const maxTokens = Number(process.env.PI_AB_MAX_OUTPUT || 4096);
  if (
    !Number.isInteger(contextWindow) ||
    !Number.isInteger(maxTokens) ||
    maxTokens < 1 ||
    maxTokens >= contextWindow
  ) {
    throw new Error('Set valid PI_AB_CONTEXT_WINDOW and PI_AB_MAX_OUTPUT values.');
  }
  if (process.env.PI_AB_USE_ZHIYUAN_INTRANET === '1') {
    const apiKey = process.env.PI_AB_API_KEY?.trim();
    if (!apiKey) throw new Error('Set PI_AB_API_KEY for the ZhiYuan intranet gateway.');
    return {
      baseUrl: `${ZhiyuanModelPool.IntranetBaseUrl}/v1`,
      apiKey,
      model: ZhiyuanModelPool.IntranetModelId,
      contextWindow,
      maxTokens,
    };
  }
  if (process.env.PI_AB_USE_ZHIYUAN_FREE === '1') {
    const response = await fetch('https://account.rongxzyai.com/v1/auth/guest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ installation_id: randomUUID() }),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    });
    const payload = (await response.json().catch((): null => null)) as {
      access_token?: string;
    } | null;
    if (!response.ok || !payload?.access_token)
      throw new Error(`Guest authorization failed (HTTP ${response.status}).`);
    return {
      baseUrl: `${ZhiyuanModelPool.ProductionBaseUrl}/v1`,
      apiKey: payload.access_token,
      model: ZhiyuanModelPool.FreeModelId,
      contextWindow,
      maxTokens,
    };
  }
  if (!process.env.PI_AB_BASE_URL || !process.env.PI_AB_MODEL)
    throw new Error('Set PI_AB_BASE_URL and PI_AB_MODEL, or PI_AB_USE_ZHIYUAN_FREE=1.');
  const baseUrl = new URL(process.env.PI_AB_BASE_URL);
  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error(
      'PI_AB_BASE_URL must use HTTP or HTTPS without credentials, query, or fragment.',
    );
  }
  return {
    baseUrl: baseUrl.href.replace(/\/$/, ''),
    apiKey: process.env.PI_AB_API_KEY,
    model: process.env.PI_AB_MODEL,
    contextWindow,
    maxTokens,
  };
}

function observeSseLine(line: string, metrics: RequestMetrics): void {
  if (!line.startsWith('data:')) return;
  const data = line.slice(5).trim();
  if (!data || data === '[DONE]') return;
  const packet = JSON.parse(data) as {
    model?: string;
    choices?: Array<{ finish_reason?: string | null }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  if (packet.model) metrics.model = packet.model;
  if (packet.choices?.[0]?.finish_reason) metrics.finishReason = packet.choices[0].finish_reason;
  if (packet.usage?.prompt_tokens !== undefined) metrics.input = packet.usage.prompt_tokens;
  if (packet.usage?.completion_tokens !== undefined)
    metrics.output = packet.usage.completion_tokens;
  if (packet.usage?.prompt_tokens_details?.cached_tokens !== undefined)
    metrics.cacheRead = packet.usage.prompt_tokens_details.cached_tokens;
}

export async function forwardRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: Provider,
  requests: RequestMetrics[],
  conversationId: string,
  options?: {
    transform?: LiveRequestTransform;
    knownMemory?: readonly string[];
    captureOnly?: boolean;
  },
): Promise<void> {
  if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const originalBody = Buffer.concat(chunks).toString('utf8');
  const originalRequest = JSON.parse(originalBody) as LivePiRequest;
  const request = options?.transform?.(originalRequest) ?? originalRequest;
  const body = request === originalRequest ? originalBody : JSON.stringify(request);
  if (originalRequest.model !== config.model || request.model !== config.model)
    throw new Error('The compared arms must request the same model.');
  if (options?.captureOnly) {
    res.writeHead(400, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        error: { message: 'Evaluation captured request; no inference requested.' },
      }),
    );
    return;
  }
  const instructions =
    request.messages?.filter(message => ['system', 'developer'].includes(message.role ?? '')) ?? [];
  const metrics: RequestMetrics = {
    status: 0,
    tools: request.tools?.length ?? 0,
    systemBytes: Buffer.byteLength(JSON.stringify(instructions)),
    requestBytes: Buffer.byteLength(body),
    attribution: attributePiWorkRequest(request, Buffer.byteLength(body), options?.knownMemory),
    compaction: instructions.some(
      message =>
        typeof message.content === 'string' &&
        message.content.includes('context summarization assistant'),
    ),
  };
  requests.push(metrics);
  const abort = new AbortController();
  res.once('close', () => abort.abort());
  const upstream = await openLiveResponse(config, body, conversationId, abort.signal);
  metrics.status = upstream.status;
  if (!upstream.ok || !upstream.body) {
    const error = (await upstream.json().catch((): null => null)) as {
      error?: { code?: string; type?: string };
    } | null;
    const code = error?.error?.code ?? error?.error?.type;
    if (typeof code === 'string' && /^[a-z0-9_-]{1,90}$/i.test(code)) metrics.errorCode = code;
    res
      .writeHead(upstream.status, { 'content-type': 'application/json' })
      .end(
        JSON.stringify({ error: { message: `Model provider returned HTTP ${upstream.status}.` } }),
      );
    return;
  }
  res.writeHead(upstream.status, {
    'content-type': upstream.headers.get('content-type') ?? 'text/event-stream',
  });
  await consumeLiveResponse(upstream.body, metrics, async chunk => {
    if (!res.write(chunk)) await once(res, 'drain', { signal: abort.signal });
  });
  res.end();
}

function openLiveResponse(
  config: Provider,
  body: string,
  conversationId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const timeout = AbortSignal.timeout(90000);
  return fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
      [ZhiyuanModelPoolHeader.ConversationId]: conversationId,
      [ZhiyuanModelPoolHeader.Workload]: ZhiyuanModelPoolWorkload.Work,
    },
    body,
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

async function consumeLiveResponse(
  body: ReadableStream<Uint8Array>,
  metrics: RequestMetrics,
  forward?: (chunk: Uint8Array) => Promise<void>,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      pending += decoder.decode(next.value, { stream: true });
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) observeSseLine(line, metrics);
      if (forward) await forward(next.value);
    }
    observeSseLine(pending + decoder.decode(), metrics);
  } finally {
    await reader.cancel().catch((): undefined => undefined);
    reader.releaseLock();
  }
}

export async function probeInputTokens(config: Provider, originalRequest: LivePiRequest) {
  if (originalRequest.model !== config.model) {
    throw new Error('Token probe must use the captured model.');
  }
  const request: LivePiRequest = { ...originalRequest, max_tokens: 1, stream: true };
  delete request.max_completion_tokens;
  const body = JSON.stringify(request);
  const response = await openLiveResponse(config, body, randomUUID());
  const metrics: RequestMetrics = {
    status: response.status,
    tools: request.tools?.length ?? 0,
    requestBytes: Buffer.byteLength(body),
    systemBytes: 0,
    compaction: false,
  };
  if (response.ok && response.body) await consumeLiveResponse(response.body, metrics);
  else await response.body?.cancel();
  return {
    status: metrics.status,
    observedModel: metrics.model,
    inputTokens: metrics.input ?? null,
  };
}
