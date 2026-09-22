// 2026/09/17 lixiang  开发环境用页面 fetch 发 API，DevTools Network 可见；生产仍走主进程 IPC（避 CORS / 保留 Copilot 重试）

type ApiFetchOptions = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

/** Vite DEV：请求在页面发起，会出现在调试器 Network。 */
export function shouldExposeApiInDevtoolsNetwork(): boolean {
  // Vitest also runs with DEV=true under Vite. Unit tests stub window.electron.api
  // and must keep the production IPC transport; otherwise mocks never fire and
  // page-level fetch hits real URLs (e.g. example.com) in CI.
  if (import.meta.env.MODE === 'test') {
    return false;
  }
  return import.meta.env.DEV === true;
}

function logTransportPath(kind: 'page-fetch' | 'ipc', detail: string): void {
  if (!shouldExposeApiInDevtoolsNetwork()) return;
  console.debug(`[visibleApiTransport] ${kind}: ${detail}`);
}

function parseResponseData(contentType: string, text: string): string | object {
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(text) as object;
    } catch {
      return text;
    }
  }
  return text;
}

export async function apiFetch(options: ApiFetchOptions) {
  if (!shouldExposeApiInDevtoolsNetwork()) {
    logTransportPath('ipc', `${options.method} ${options.url}`);
    return window.electron.api.fetch(options);
  }

  logTransportPath('page-fetch', `${options.method} ${options.url}`);
  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      data: parseResponseData(contentType, text),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      statusText: error instanceof Error ? error.message : 'Network error',
      headers: {},
      data: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
