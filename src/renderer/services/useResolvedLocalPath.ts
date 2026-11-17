/**
 * Chat markdown 本地路径解析（issue #805）。
 *
 * 渲染层不再猜测/改写 markdown 文本；候选只来自 markdown AST（inline code 与
 * 非 http(s) 链接 href），先过廉价护栏，再交主进程 `shell.resolveLocalPath`
 * 用真实文件系统判定。路径真值在主进程（见 src/main/localPathResolver.ts）。
 */
import { useEffect, useState } from 'react';

const MAX_PATH_CANDIDATE_LENGTH = 260;

/** Cheap renderer-side guard: only path-looking single-line strings reach the IPC. */
export const isLocalPathCandidate = (candidate: string): boolean => {
  const trimmed = candidate.trim();
  if (!trimmed || trimmed.length > MAX_PATH_CANDIDATE_LENGTH) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  return trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('.');
};

const cache = new Map<string, string | null>();
const pending = new Map<string, Promise<string | null>>();

const cacheKey = (candidate: string, cwd: string | undefined): string =>
  `${cwd ?? ''}\0${candidate}`;

const resolveViaMain = (
  candidate: string,
  cwd: string | undefined,
  forceRefresh = false,
): Promise<string | null> => {
  const key = cacheKey(candidate, cwd);
  if (!forceRefresh) {
    const cached = cache.get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
  }

  const resolveLocalPath = window.electron?.shell?.resolveLocalPath;
  if (typeof resolveLocalPath !== 'function') {
    return Promise.resolve(null);
  }

  const promise = resolveLocalPath(candidate, cwd)
    .then(result => {
      const resolved = typeof result?.path === 'string' && result.path ? result.path : null;
      if (resolved) {
        cache.set(key, resolved);
      } else {
        cache.delete(key);
      }
      return resolved;
    })
    .catch(() => {
      cache.delete(key);
      return null;
    })
    .finally(() => {
      pending.delete(key);
    });
  pending.set(key, promise);
  return promise;
};

export const clearResolvedLocalPathCache = (): void => {
  cache.clear();
  pending.clear();
};

const readCache = (key: string | null): string | null | undefined =>
  key === null ? undefined : cache.get(key);

/**
 * Resolve a markdown inline-code / link candidate against the session cwd.
 * `enabled: false`（流式中的已提交块）时不发起 IPC，保持纯文本渲染。
 */
export const useResolvedLocalPathState = (
  candidate: string | null | undefined,
  cwd: string | undefined,
  enabled: boolean,
  refreshNonce = 0,
): { path: string | null; pending: boolean } => {
  const applicable = enabled && typeof candidate === 'string' && isLocalPathCandidate(candidate);
  const key = applicable && typeof candidate === 'string' ? cacheKey(candidate, cwd) : null;
  const [result, setResult] = useState<{
    key: string | null;
    refreshNonce: number;
    path: string | null;
  }>(() => ({
    key: readCache(key) !== undefined ? key : null,
    refreshNonce,
    path: readCache(key) ?? null,
  }));

  useEffect(() => {
    if (!applicable || key === null || typeof candidate !== 'string') {
      return;
    }
    const forceRefresh = refreshNonce > 0;
    const cachedNow = forceRefresh ? undefined : cache.get(key);
    if (cachedNow !== undefined) {
      setResult({ key, refreshNonce, path: cachedNow });
      return;
    }
    let cancelled = false;
    void resolveViaMain(candidate, cwd, forceRefresh).then(value => {
      if (!cancelled) setResult({ key, refreshNonce, path: value });
    });
    return () => {
      cancelled = true;
    };
  }, [applicable, key, candidate, cwd, refreshNonce]);

  const cached = refreshNonce > 0 ? undefined : readCache(key);
  const settled =
    cached !== undefined || (result.key === key && result.refreshNonce === refreshNonce);
  return {
    path: applicable ? (cached ?? (result.key === key ? result.path : null)) : null,
    pending: applicable && !settled,
  };
};

export const useResolvedLocalPath = (
  candidate: string | null | undefined,
  cwd: string | undefined,
  enabled: boolean,
): string | null => useResolvedLocalPathState(candidate, cwd, enabled).path;
