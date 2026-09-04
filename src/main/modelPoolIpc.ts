import { app, ipcMain, session } from 'electron';

import { ModelPoolIpc } from '../shared/ipc/channels';
import { ModelPoolStreamSchema } from '../shared/ipc/schemas';
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
  if (status === 401) return t('modelPoolLoginRequired');
  if (status === 429) return t('modelPoolQuotaExceeded');
  try {
    const payload = JSON.parse(rawBody) as { error?: { code?: unknown } };
    if (payload.error?.code === 'unauthorized') return t('modelPoolLoginRequired');
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

export function registerModelPoolIpcHandlers(
  communityAuthSession: CommunityAuthSessionManager,
): void {
  ipcMain.handle(ModelPoolIpc.Stream, async (event, rawInput: unknown) => {
    const input = ModelPoolStreamSchema.input.parse(rawInput);
    const controller = new AbortController();
    activeModelPoolStreams.set(input.requestId, controller);

    try {
      let accessToken = await communityAuthSession.getAccessToken();
      let response = await fetchModelPool(input.body, accessToken, controller.signal);
      if (response.status === 401) {
        accessToken = await communityAuthSession.getAccessToken({ forceRefresh: true });
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
        error: communityAuthSession.getUser()
          ? t('modelPoolServiceUnavailable')
          : t('modelPoolLoginRequired'),
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
