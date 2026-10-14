type ApiFetchOptions = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  timeoutMs?: number;
};

/**
 * 统一 API 传输：无论是开发环境还是生产环境，API 请求一律通过 window.electron.api.fetch 走主进程代理，
 * 避免底层网络协议栈行为不一致并保留主进程统一的证书校验、CORS 绕过、重试以及代理配置。
 * 如需在 DevTools 中观测主进程网络请求，依赖现有的 devNetworkBeacon 机制。
 */
export function shouldExposeApiInDevtoolsNetwork(): boolean {
  return false;
}

export async function apiFetch(options: ApiFetchOptions) {
  console.debug(`[visibleApiTransport] ipc: ${options.method} ${options.url}`);
  return window.electron.api.fetch(options);
}
