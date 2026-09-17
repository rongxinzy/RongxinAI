// 2026/09/17 lixiang  开发环境用页面 fetch 发 API，DevTools Network 可见；生产仍走主进程 IPC（避 CORS / 保留 Copilot 重试）

type ApiFetchOptions = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

type ApiStreamOptions = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  requestId: string;
};

type StreamListenerMap = {
  data: Set<(chunk: string) => void>;
  done: Set<() => void>;
  error: Set<(error: string | { message: string }) => void>;
  abort: Set<() => void>;
};

const streamListeners = new Map<string, StreamListenerMap>();
const streamControllers = new Map<string, AbortController>();

function ensureListeners(requestId: string): StreamListenerMap {
  let entry = streamListeners.get(requestId);
  if (!entry) {
    entry = {
      data: new Set(),
      done: new Set(),
      error: new Set(),
      abort: new Set(),
    };
    streamListeners.set(requestId, entry);
  }
  return entry;
}

function clearStream(requestId: string): void {
  streamControllers.delete(requestId);
  streamListeners.delete(requestId);
}

/** Vite DEV：请求在页面发起，会出现在调试器 Network。 */
export function shouldExposeApiInDevtoolsNetwork(): boolean {
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

export function apiCancelStream(requestId: string): Promise<boolean> {
  if (!shouldExposeApiInDevtoolsNetwork()) {
    return window.electron.api.cancelStream(requestId);
  }
  const controller = streamControllers.get(requestId);
  if (controller) {
    controller.abort();
    streamControllers.delete(requestId);
  }
  return Promise.resolve(true);
}

export function apiOnStreamData(requestId: string, callback: (chunk: string) => void): () => void {
  if (!shouldExposeApiInDevtoolsNetwork()) {
    return window.electron.api.onStreamData(requestId, callback);
  }
  const entry = ensureListeners(requestId);
  entry.data.add(callback);
  return () => entry.data.delete(callback);
}

export function apiOnStreamDone(requestId: string, callback: () => void): () => void {
  if (!shouldExposeApiInDevtoolsNetwork()) {
    return window.electron.api.onStreamDone(requestId, callback);
  }
  const entry = ensureListeners(requestId);
  entry.done.add(callback);
  return () => entry.done.delete(callback);
}

export function apiOnStreamError(
  requestId: string,
  callback: (error: string | { message: string }) => void,
): () => void {
  if (!shouldExposeApiInDevtoolsNetwork()) {
    return window.electron.api.onStreamError(requestId, callback);
  }
  const entry = ensureListeners(requestId);
  entry.error.add(callback);
  return () => entry.error.delete(callback);
}

export function apiOnStreamAbort(requestId: string, callback: () => void): () => void {
  if (!shouldExposeApiInDevtoolsNetwork()) {
    return window.electron.api.onStreamAbort(requestId, callback);
  }
  const entry = ensureListeners(requestId);
  entry.abort.add(callback);
  return () => entry.abort.delete(callback);
}

export async function apiStream(options: ApiStreamOptions) {
  if (!shouldExposeApiInDevtoolsNetwork()) {
    logTransportPath('ipc', `${options.method} ${options.url}`);
    return window.electron.api.stream(options);
  }

  logTransportPath('page-fetch', `${options.method} ${options.url}`);
  const controller = new AbortController();
  streamControllers.set(options.requestId, controller);
  const listeners = ensureListeners(options.requestId);

  try {
    const response = await fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorData = await response.text();
      clearStream(options.requestId);
      return {
        ok: false,
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      };
    }

    if (!response.body) {
      clearStream(options.requestId);
      return {
        ok: false,
        status: response.status,
        statusText: 'No response body',
      };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    void (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            listeners.done.forEach(cb => cb());
            break;
          }
          const chunk = decoder.decode(value, { stream: true });
          listeners.data.forEach(cb => cb(chunk));
        }
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          listeners.abort.forEach(cb => cb());
        } else {
          const message = error instanceof Error ? error.message : 'Stream error';
          listeners.error.forEach(cb => cb(message));
        }
      } finally {
        clearStream(options.requestId);
      }
    })();

    return {
      ok: true,
      status: response.status,
      statusText: response.statusText,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      listeners.abort.forEach(cb => cb());
    }
    clearStream(options.requestId);
    return {
      ok: false,
      status: 0,
      statusText: error instanceof Error ? error.message : 'Network error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
