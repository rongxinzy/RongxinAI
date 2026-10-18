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

const resolveViaMain = (candidate: string, cwd: string | undefined): Promise<string | null> => {
  const key = cacheKey(candidate, cwd);
  const cached = cache.get(key);
  if (cached !== undefined) return Promise.resolve(cached);
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const resolveLocalPath = window.electron?.shell?.resolveLocalPath;
  if (typeof resolveLocalPath !== 'function') {
    cache.set(key, null);
    return Promise.resolve(null);
  }

  const promise = resolveLocalPath(candidate, cwd)
    .then(result => {
      const resolved = typeof result?.path === 'string' && result.path ? result.path : null;
      cache.set(key, resolved);
      return resolved;
    })
    .catch(() => {
      cache.set(key, null);
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
export const useResolvedLocalPath = (
  candidate: string | null | undefined,
  cwd: string | undefined,
  enabled: boolean,
): string | null => {
  const applicable = enabled && typeof candidate === 'string' && isLocalPathCandidate(candidate);
  const key = applicable && typeof candidate === 'string' ? cacheKey(candidate, cwd) : null;
  const [resolved, setResolved] = useState<string | null>(() => readCache(key) ?? null);

  useEffect(() => {
    if (!applicable || key === null || typeof candidate !== 'string') {
      setResolved(null);
      return;
    }
    const cachedNow = cache.get(key);
    if (cachedNow !== undefined) {
      setResolved(cachedNow);
      return;
    }
    let cancelled = false;
    void resolveViaMain(candidate, cwd).then(value => {
      if (!cancelled) setResolved(value);
    });
    return () => {
      cancelled = true;
    };
  }, [applicable, key, candidate, cwd]);

  return applicable ? resolved : null;
};
