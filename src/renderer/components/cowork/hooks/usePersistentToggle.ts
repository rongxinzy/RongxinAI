import { useCallback, useEffect, useState } from 'react';

/**
 * Expansion memory for collapsible turn content. Turn rows unmount under
 * virtualization (and remount during image export), so expansion state
 * lives outside the component tree (issue #141).
 *
 * Keys are namespaced per session: orphan turn ids are positional and
 * would collide across sessions otherwise. The map is bounded; the oldest
 * entries are dropped past the cap.
 */
const expansionMemory = new Map<string, boolean>();
const EXPANSION_MEMORY_LIMIT = 2000;

/**
 * Maps a backend session id back to the optimistic `temp-*` id it replaced,
 * so React keys (`VirtualizedTurnList`, `CoworkRunStatus`) and persisted
 * collapsible states remain continuous when `startSession` resolves.
 */
const promotedSessionKeyMap = new Map<string, string>();
const PROMOTED_SESSION_KEY_LIMIT = 200;

let currentNamespace = '';

const persistValue = (scoped: string, next: boolean): void => {
  expansionMemory.delete(scoped); // refresh recency
  expansionMemory.set(scoped, next);
  if (expansionMemory.size > EXPANSION_MEMORY_LIMIT) {
    const oldest = expansionMemory.keys().next().value;
    if (oldest !== undefined) expansionMemory.delete(oldest);
  }
};

/**
 * Associates a temporary session id (`temp-*`) with its persisted backend
 * session id and copies any already-recorded toggle states across namespaces.
 */
export const promotePersistentToggleNamespace = (
  temporaryNamespace: string,
  realNamespace: string,
): void => {
  if (!temporaryNamespace || !realNamespace || temporaryNamespace === realNamespace) {
    return;
  }
  const canonicalKey = promotedSessionKeyMap.get(temporaryNamespace) ?? temporaryNamespace;
  promotedSessionKeyMap.delete(realNamespace);
  promotedSessionKeyMap.set(realNamespace, canonicalKey);
  if (promotedSessionKeyMap.size > PROMOTED_SESSION_KEY_LIMIT) {
    const oldest = promotedSessionKeyMap.keys().next().value;
    if (oldest !== undefined) promotedSessionKeyMap.delete(oldest);
  }
  const prefix = `${temporaryNamespace}:`;
  for (const [entryKey, entryValue] of Array.from(expansionMemory.entries())) {
    if (entryKey.startsWith(prefix)) {
      const suffix = entryKey.slice(prefix.length);
      persistValue(`${realNamespace}:${suffix}`, entryValue);
      if (canonicalKey !== temporaryNamespace) {
        persistValue(`${canonicalKey}:${suffix}`, entryValue);
      }
    }
  }
};

/** Returns a stable React key across `temp-*` -> real session id promotion. */
export const resolveStableSessionKey = (sessionId: string | undefined): string | undefined => {
  if (!sessionId) return sessionId;
  return promotedSessionKeyMap.get(sessionId) ?? sessionId;
};

/** Scopes subsequently persisted toggles to one session. */
export const setPersistentToggleNamespace = (namespace: string): void => {
  if (
    currentNamespace.startsWith('temp-') &&
    namespace &&
    !namespace.startsWith('temp-') &&
    !promotedSessionKeyMap.has(namespace)
  ) {
    promotePersistentToggleNamespace(currentNamespace, namespace);
  }
  currentNamespace = namespace;
};

const scopedKey = (key: string): string => {
  const canonicalNamespace = promotedSessionKeyMap.get(currentNamespace) ?? currentNamespace;
  return `${canonicalNamespace}:${key}`;
};

/** Reads a persisted toggle state in the active session namespace if recorded. */
export const getPersistentToggleValue = (key: string): boolean | undefined =>
  expansionMemory.get(scopedKey(key)) ?? expansionMemory.get(`${currentNamespace}:${key}`);

export const usePersistentToggle = (
  key: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] => {
  const [value, setValue] = useState(() => {
    const scoped = scopedKey(key);
    const existing = getPersistentToggleValue(key);
    if (existing !== undefined) return existing;
    if (defaultValue) {
      persistValue(scoped, defaultValue);
    }
    return defaultValue;
  });

  useEffect(() => {
    const existing = getPersistentToggleValue(key);
    if (existing !== undefined) {
      setValue(prev => (prev === existing ? prev : existing));
      return;
    }
    if (defaultValue) {
      persistValue(scopedKey(key), true);
      setValue(true);
    }
  }, [key, defaultValue]);

  const setPersistedValue = useCallback(
    (next: boolean) => {
      const scoped = scopedKey(key);
      persistValue(scoped, next);
      if (currentNamespace && scoped !== `${currentNamespace}:${key}`) {
        persistValue(`${currentNamespace}:${key}`, next);
      }
      setValue(next);
    },
    [key],
  );
  return [value, setPersistedValue];
};
