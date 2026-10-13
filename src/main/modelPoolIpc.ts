import { app, ipcMain, session } from 'electron';

import { ModelPoolIpc } from '../shared/ipc/channels';
import { ModelPoolModelsSchema, ModelPoolStreamSchema } from '../shared/ipc/schemas';
import {
  ZhiyuanModelPool,
  ZhiyuanModelPoolHeader,
  ZhiyuanModelPoolWorkload,
  ModelPoolErrorCode,
} from '../shared/modelPool/constants';
import type { CommunityAuthSessionManager } from './communityAuthSession';
import { t } from './i18n';
import { readModelPoolErrorBody, retrySessionBusy } from './modelPoolRetry';
import {
  probeZhiyuanIntranet,
  warmZhiyuanIntranetProbe,
  zhiyuanIntranetApiKey,
} from './libs/zhiyuanIntranet';

const activeModelPoolStreams = new Map<string, AbortController>();

function developmentBaseUrl(): string | null {
  if (app.isPackaged) return null;
  const candidate = process.env[ZhiyuanModelPool.DevelopmentBaseUrlEnvironmentVariable]?.trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

function modelPoolBaseUrl(): string {
  return developmentBaseUrl() ?? ZhiyuanModelPool.ProductionBaseUrl;
}

/** Prefers the office intranet gateway when it is reachable and serving models. */
async function resolveModelPoolBaseUrl(): Promise<string> {
  if (await probeZhiyuanIntranet()) return ZhiyuanModelPool.IntranetBaseUrl;
  return modelPoolBaseUrl();
}

function isIntranetBaseUrl(baseUrl: string): boolean {
  return baseUrl === ZhiyuanModelPool.IntranetBaseUrl;
}

function modelPoolErrorMessage(rawBody: string, status: number): string {
  if (status === 401) return t('modelPoolServiceUnavailable');
  if (status === 429) return t('modelPoolQuotaExceeded');
  try {
    const payload = JSON.parse(rawBody) as { error?: { code?: unknown } };
    if (payload.error?.code === ModelPoolErrorCode.SessionBusy) return t('modelPoolSessionBusy');
    if (payload.error?.code === 'unauthorized') return t('modelPoolServiceUnavailable');
    if (
      payload.error?.code === 'account_disabled' ||
      payload.error?.code === 'entitlement_required'
    ) {
      return t('modelPoolEntitlementRequired');
    }
    if (payload.error?.code === 'quota_exceeded') return t('modelPoolQuotaExceeded');
  } catch {
    // Use the localized stable fallback for non-JSON upstream failures.
  }
  return t('modelPoolServiceUnavailable');
}

interface ModelPoolFetchResult {
  response: Response;
  usedIntranet: boolean;
}

type ModelPoolTokenProvider = () => Promise<string>;

async function fetchModelPool(
  body: Record<string, unknown>,
  tokenProvider: ModelPoolTokenProvider,
  signal: AbortSignal,
  conversationId: string,
): Promise<ModelPoolFetchResult> {
  const baseUrl = await resolveModelPoolBaseUrl();
  const usedIntranet = isIntranetBaseUrl(baseUrl);
  // The community token is only needed for the cloud pool: on the intranet the
  // fixed gateway key authenticates, so token acquisition stays lazy and the
  // free model keeps working without community connectivity.
  const authorization = usedIntranet ? zhiyuanIntranetApiKey() : await tokenProvider();
  const response = await retrySessionBusy(
    () =>
      session.defaultSession.fetch(`${baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${authorization}`,
          'Content-Type': 'application/json',
          [ZhiyuanModelPoolHeader.ConversationId]: conversationId,
          [ZhiyuanModelPoolHeader.Workload]: ZhiyuanModelPoolWorkload.Chat,
        },
        body: JSON.stringify({
          ...body,
          model: usedIntranet ? ZhiyuanModelPool.IntranetModelId : ZhiyuanModelPool.FreeModelId,
          stream: true,
        }),
        signal,
      }),
    signal,
  );
  return { response, usedIntranet };
}

async function fetchModelPoolModels(
  communityAuthSession: CommunityAuthSessionManager,
): Promise<ModelPoolFetchResult> {
  const baseUrl = await resolveModelPoolBaseUrl();
  const usedIntranet = isIntranetBaseUrl(baseUrl);
  if (usedIntranet) {
    const response = await session.defaultSession.fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${zhiyuanIntranetApiKey()}` },
    });
    return { response, usedIntranet };
  }
  const fetchModels = (token: string) =>
    session.defaultSession.fetch(`${baseUrl}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  let accessToken = await communityAuthSession.getModelPoolAccessToken();
  let response = await fetchModels(accessToken);
  if (response.status === 401) {
    accessToken = await communityAuthSession.getModelPoolAccessToken({ forceRefresh: true });
    response = await fetchModels(accessToken);
  }
  return { response, usedIntranet };
}

function parseModelIds(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const data = (value as Record<string, unknown>).data;
  if (!Array.isArray(data)) return [];
  return data.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const id = (item as Record<string, unknown>).id;
    return typeof id === 'string' && id.trim() ? [id] : [];
  });
}

export function registerModelPoolIpcHandlers(
  communityAuthSession: CommunityAuthSessionManager,
): void {
  warmZhiyuanIntranetProbe();
  ipcMain.handle(ModelPoolIpc.ListModels, async () => {
    try {
      const fetchResult = await fetchModelPoolModels(communityAuthSession);
      const response = fetchResult.response;
      if (!response.ok) {
        const result = {
          ok: false,
          status: response.status,
          models: [] as string[],
          error: modelPoolErrorMessage(await response.text(), response.status),
        };
        return ModelPoolModelsSchema.output.parse(result);
      }
      let models = parseModelIds((await response.json()) as unknown);
      if (fetchResult.usedIntranet) {
        // The renderer only knows the logical free model id; report the
        // intranet model under that id instead of the physical gateway name.
        models = models.map(modelId =>
          modelId === ZhiyuanModelPool.IntranetModelId ? ZhiyuanModelPool.FreeModelId : modelId,
        );
      }
      const result = {
        ok: true,
        status: response.status,
        models,
      };
      return ModelPoolModelsSchema.output.parse(result);
    } catch {
      return ModelPoolModelsSchema.output.parse({
        ok: false,
        status: 0,
        models: [] as string[],
        error: t('modelPoolServiceUnavailable'),
      });
    }
  });

  ipcMain.handle(ModelPoolIpc.Stream, async (event, rawInput: unknown) => {
    const input = ModelPoolStreamSchema.input.parse(rawInput);
    const controller = new AbortController();
    activeModelPoolStreams.set(input.requestId, controller);
    const destroyed = () => controller.abort();
    event.sender.once?.('destroyed', destroyed);
    const cleanup = () => {
      event.sender.removeListener?.('destroyed', destroyed);
      if (activeModelPoolStreams.get(input.requestId) === controller)
        activeModelPoolStreams.delete(input.requestId);
    };
    const send = (channel: string, ...args: unknown[]) => {
      if (!event.sender.isDestroyed?.()) event.sender.send(channel, ...args);
    };

    try {
      let forceTokenRefresh = false;
      const tokenProvider: ModelPoolTokenProvider = async () =>
        forceTokenRefresh
          ? communityAuthSession.getModelPoolAccessToken({ forceRefresh: true })
          : communityAuthSession.getModelPoolAccessToken();
      let fetchResult = await fetchModelPool(
        input.body,
        tokenProvider,
        controller.signal,
        input.conversationId,
      );
      if (fetchResult.response.status === 401 && !fetchResult.usedIntranet) {
        await fetchResult.response.body?.cancel();
        forceTokenRefresh = true;
        fetchResult = await fetchModelPool(
          input.body,
          tokenProvider,
          controller.signal,
          input.conversationId,
        );
      }
      const response = fetchResult.response;

      if (!response.ok || !response.body) {
        const error = response.body
          ? modelPoolErrorMessage(await readModelPoolErrorBody(response), response.status)
          : t('modelPoolServiceUnavailable');
        cleanup();
        return { ok: false, status: response.status, statusText: response.statusText, error };
      }

      const reader = response.body.getReader();
      const cancelReader = () => {
        void reader.cancel().catch((): void => undefined);
      };
      controller.signal.addEventListener('abort', cancelReader, { once: true });
      const decoder = new TextDecoder();
      void (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            controller.signal.throwIfAborted();
            if (done) {
              const finalChunk = decoder.decode();
              if (finalChunk) {
                send(ModelPoolIpc.streamData(input.requestId), finalChunk);
              }
              send(ModelPoolIpc.streamDone(input.requestId));
              break;
            }
            send(ModelPoolIpc.streamData(input.requestId), decoder.decode(value, { stream: true }));
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            send(ModelPoolIpc.streamAbort(input.requestId));
          } else {
            send(ModelPoolIpc.streamError(input.requestId), t('modelPoolStreamInterrupted'));
          }
        } finally {
          controller.signal.removeEventListener('abort', cancelReader);
          await reader.cancel().catch((): void => undefined);
          reader.releaseLock();
          cleanup();
        }
      })();

      return { ok: true, status: response.status, statusText: response.statusText };
    } catch {
      cleanup();
      return {
        ok: false,
        status: 0,
        statusText: 'Model Pool request failed',
        error: t('modelPoolServiceUnavailable'),
      };
    }
  });

  ipcMain.handle(ModelPoolIpc.CancelStream, (_event, requestId: string) => {
    const controller = activeModelPoolStreams.get(requestId);
    if (!controller) return false;
    controller.abort();
    activeModelPoolStreams.delete(requestId);
    return true;
  });
}
