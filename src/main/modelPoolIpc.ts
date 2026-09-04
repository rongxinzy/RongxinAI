import { app, ipcMain, session } from 'electron';

import { ModelPoolIpc } from '../shared/ipc/channels';
import { ModelPoolModelsSchema, ModelPoolStreamSchema } from '../shared/ipc/schemas';
import { ZhiyuanModelPool } from '../shared/modelPool/constants';
import type { CommunityAuthSessionManager } from './communityAuthSession';
import { t } from './i18n';

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

function modelPoolErrorMessage(rawBody: string, status: number): string {
  if (status === 401) return t('modelPoolServiceUnavailable');
  if (status === 429) return t('modelPoolQuotaExceeded');
  try {
    const payload = JSON.parse(rawBody) as { error?: { code?: unknown } };
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

async function fetchModelPool(
  body: Record<string, unknown>,
  token: string,
  signal: AbortSignal,
): Promise<Response> {
  return session.defaultSession.fetch(`${modelPoolBaseUrl()}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ...body, model: ZhiyuanModelPool.FreeModelId, stream: true }),
    signal,
  });
}

async function fetchModelPoolModels(
  communityAuthSession: CommunityAuthSessionManager,
): Promise<Response> {
  const fetchModels = (token: string) =>
    session.defaultSession.fetch(`${modelPoolBaseUrl()}/v1/models`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  let accessToken = await communityAuthSession.getModelPoolAccessToken();
  let response = await fetchModels(accessToken);
  if (response.status === 401) {
    accessToken = await communityAuthSession.getModelPoolAccessToken({ forceRefresh: true });
    response = await fetchModels(accessToken);
  }
  return response;
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
  ipcMain.handle(ModelPoolIpc.ListModels, async () => {
    try {
      const response = await fetchModelPoolModels(communityAuthSession);
      if (!response.ok) {
        const result = {
          ok: false,
          status: response.status,
          models: [] as string[],
          error: modelPoolErrorMessage(await response.text(), response.status),
        };
        return ModelPoolModelsSchema.output.parse(result);
      }
      const result = {
        ok: true,
        status: response.status,
        models: parseModelIds((await response.json()) as unknown),
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

    try {
      let accessToken = await communityAuthSession.getModelPoolAccessToken();
      let response = await fetchModelPool(input.body, accessToken, controller.signal);
      if (response.status === 401) {
        accessToken = await communityAuthSession.getModelPoolAccessToken({ forceRefresh: true });
        response = await fetchModelPool(input.body, accessToken, controller.signal);
      }

      if (!response.ok || !response.body) {
        const error = response.body
          ? modelPoolErrorMessage(await response.text(), response.status)
          : t('modelPoolServiceUnavailable');
        activeModelPoolStreams.delete(input.requestId);
        return { ok: false, status: response.status, statusText: response.statusText, error };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      void (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              const finalChunk = decoder.decode();
              if (finalChunk) {
                event.sender.send(ModelPoolIpc.streamData(input.requestId), finalChunk);
              }
              event.sender.send(ModelPoolIpc.streamDone(input.requestId));
              break;
            }
            event.sender.send(
              ModelPoolIpc.streamData(input.requestId),
              decoder.decode(value, { stream: true }),
            );
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            event.sender.send(ModelPoolIpc.streamAbort(input.requestId));
          } else {
            event.sender.send(
              ModelPoolIpc.streamError(input.requestId),
              t('modelPoolServiceUnavailable'),
            );
          }
        } finally {
          activeModelPoolStreams.delete(input.requestId);
        }
      })();

      return { ok: true, status: response.status, statusText: response.statusText };
    } catch {
      activeModelPoolStreams.delete(input.requestId);
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
