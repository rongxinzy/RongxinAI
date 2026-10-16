/** Main-process api:fetch proxy IPC: renderer fetch mirroring with Copilot token refresh. */
import { ipcMain, session } from 'electron';

import { ApiFetchSchema } from '../../shared/ipc/schemas';
import { shouldRecordApiRequest } from '../../shared/ipc/apiRequest';
import { serializeForLog } from '../libs/sanitizeForLog';
import { truncateNetworkBody } from '../../shared/devNetworkLog';
import { trackDevNetworkRequest } from '../devNetworkLog';
import { refreshCopilotTokenNow } from '../libs/copilotTokenManager';
import { ApiIpc } from '../../shared/ipc/channels';

export const registerApiFetchIpc = (): void => {
  // Helper: detect if a URL belongs to GitHub Copilot and apply token refresh on 401.
  const isCopilotUrl = (url: string) => url.includes('githubcopilot.com');
  const retryCopilotWithRefreshedToken = async (opts: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }): Promise<{ headers: Record<string, string>; retried: boolean }> => {
    try {
      const state = await refreshCopilotTokenNow();
      const refreshedHeaders = { ...opts.headers, Authorization: `Bearer ${state.copilotToken}` };
      console.log('[CopilotRetry] token refreshed, retrying request');
      return { headers: refreshedHeaders, retried: true };
    } catch (err) {
      console.warn('[CopilotRetry] token refresh failed, not retrying:', err);
      return { headers: opts.headers, retried: false };
    }
  };

  ipcMain.handle(ApiIpc.Fetch, async (_event, rawOptions: unknown) => {
    const options = ApiFetchSchema.input.parse(rawOptions);
    const shouldRecord = shouldRecordApiRequest(options.purpose);
    if (shouldRecord) {
      console.log(
        `[api:fetch] ${options.method} ${options.url}, headers: ${serializeForLog(options.headers)}, body: ${options.body}`,
      );
    }

    const doFetch = async (headers: Record<string, string>) => {
      const response = await session.defaultSession.fetch(options.url, {
        method: options.method,
        headers,
        body: options.body,
        signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
      });

      const contentType = response.headers.get('content-type') || '';
      let data: string | object;

      if (contentType.includes('text/event-stream')) {
        data = await response.text();
      } else if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        data,
      };
    };

    const runApiFetch = async () => {
      try {
        let result = await doFetch(options.headers);
        if (shouldRecord) {
          console.log(
            `[api:fetch] ${options.method} ${options.url} -> ${result.status} ${result.statusText}`,
            typeof result.data === 'object' ? JSON.stringify(result.data) : result.data,
          );
        }

        // Auto-retry once for Copilot 401/403
        if (
          !result.ok &&
          (result.status === 401 || result.status === 403) &&
          isCopilotUrl(options.url)
        ) {
          if (shouldRecord) {
            console.log('[api:fetch] Copilot auth error, attempting token refresh and retry');
          }
          const { headers: refreshedHeaders, retried } =
            await retryCopilotWithRefreshedToken(options);
          if (retried) {
            result = await doFetch(refreshedHeaders);
            if (shouldRecord) {
              console.log(`[api:fetch] retry -> ${result.status} ${result.statusText}`);
            }
          }
        }

        return result;
      } catch (error) {
        if (shouldRecord) {
          console.error(
            `[api:fetch] ${options.method} ${options.url} -> ERROR:`,
            error instanceof Error ? error.message : error,
          );
        }
        return {
          ok: false,
          status: 0,
          statusText: error instanceof Error ? error.message : 'Network error',
          headers: {},
          data: null as null,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    };

    if (!shouldRecord) return runApiFetch();

    // 2026/09/17 lixiang  开发态把主进程 api:fetch 镜像到 DevTools Network（xr-net beacon）
    return trackDevNetworkRequest({
      source: 'api-fetch',
      method: options.method,
      url: options.url,
      getStatus: result => result.status,
      getRequestBody: () => truncateNetworkBody(options.body),
      getResponseBody: result =>
        truncateNetworkBody('error' in result ? result.error : (result.data ?? result.statusText)),
      run: runApiFetch,
    });
  });

  // ─── end OAuth ───
};
