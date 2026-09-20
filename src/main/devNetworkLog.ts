import { BrowserWindow, protocol } from 'electron';

import {
  DEV_NETWORK_SCHEME,
  sanitizeNetworkUrl,
  type DevNetworkLogEntry,
  type DevNetworkLogSource,
} from '../shared/devNetworkLog';
import { DevNetworkIpc } from '../shared/ipc/channels';

const isDevNetworkEnabled = (): boolean => process.env.NODE_ENV === 'development';

export function publishDevNetworkLog(entry: DevNetworkLogEntry): void {
  if (!isDevNetworkEnabled()) return;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(DevNetworkIpc.Entry, entry);
    }
  }
}

export async function trackDevNetworkRequest<T>(options: {
  source: DevNetworkLogSource;
  method: string;
  url: string;
  run: () => Promise<T>;
  getStatus: (result: T) => number | undefined;
  getRequestBody?: () => string | undefined;
  getResponseBody?: (result: T) => string | undefined;
}): Promise<T> {
  if (!isDevNetworkEnabled()) return options.run();

  const startedAt = Date.now();
  const id = `${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const requestBody = options.getRequestBody?.();
  try {
    const result = await options.run();
    publishDevNetworkLog({
      id,
      source: options.source,
      method: options.method,
      url: sanitizeNetworkUrl(options.url),
      status: options.getStatus(result),
      durationMs: Date.now() - startedAt,
      requestBody,
      responseBody: options.getResponseBody?.(result),
      startedAt,
    });
    return result;
  } catch (error) {
    publishDevNetworkLog({
      id,
      source: options.source,
      method: options.method,
      url: sanitizeNetworkUrl(options.url),
      status: 0,
      durationMs: Date.now() - startedAt,
      requestBody,
      error: error instanceof Error ? error.message : String(error),
      startedAt,
    });
    throw error;
  }
}

/** 2026/09/17 lixiang  开发态注册 xr-net；POST body 回显到 Network Response */
export function registerDevNetworkProtocol(): void {
  if (!isDevNetworkEnabled()) return;
  protocol.handle(DEV_NETWORK_SCHEME, async request => {
    try {
      const statusParam = Number(new URL(request.url).searchParams.get('status') || '200');
      // status 0（连接失败）用 502，保证 DevTools 仍能展示 Response 正文
      const normalized = statusParam === 0 ? 502 : statusParam;
      const status =
        Number.isFinite(normalized) && normalized >= 100 && normalized < 600 ? normalized : 200;
      const body =
        request.method === 'POST' || request.method === 'PUT' ? await request.text() : null;
      return new Response(body, {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    } catch {
      return new Response(JSON.stringify({ error: 'xr-net beacon failed' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  });
}
