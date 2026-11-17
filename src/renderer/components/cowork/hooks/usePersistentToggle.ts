import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

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
 * so persisted collapsible states remain continuous when `startSession` resolves.
 */
const promotedSessionKeyMap = new Map<string, string>();
const PROMOTED_SESSION_KEY_LIMIT = 200;

let currentNamespace = '';

const PersistentToggleNamespaceContext = createContext<string | null>(null);

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
const promotePersistentToggleNamespace = (
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

/** Returns a stable key across `temp-*` -> real session id promotion. */
export const resolveStableSessionKey = (sessionId: string | undefined): string | undefined => {
  if (!sessionId) return sessionId;
  return promotedSessionKeyMap.get(sessionId) ?? sessionId;
};

/** Scopes subsequently persisted toggles to one session when no Provider is mounted. */
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

/**
 * React-pure session boundary for collapsible expansion memory so concurrent
 * views (e.g. main transcript + RunSessionModal) never race on a global namespace.
 */
export const PersistentToggleNamespaceProvider: React.FC<{
  namespace: string;
  children?: React.ReactNode;
}> = ({ namespace, children }) => {
  const [tracked, setTracked] = useState(() => ({
    raw: namespace,
    canonical: resolveStableSessionKey(namespace) ?? namespace,
  }));

  if (tracked.raw !== namespace) {
    const isPromotion =
      tracked.raw.startsWith('temp-') && Boolean(namespace) && !namespace.startsWith('temp-');
    setTracked({
      raw: namespace,
      canonical: isPromotion
        ? tracked.canonical
        : (resolveStableSessionKey(namespace) ?? namespace),
    });
  }

  useEffect(() => {
    if (tracked.raw && tracked.canonical !== tracked.raw && tracked.canonical.startsWith('temp-')) {
      promotePersistentToggleNamespace(tracked.canonical, tracked.raw);
    }
  }, [tracked.canonical, tracked.raw]);

  return React.createElement(
    PersistentToggleNamespaceContext.Provider,
    { value: tracked.canonical },
    children,
  );
};

const scopedKeyForNamespace = (namespace: string, key: string): string => {
  const canonicalNamespace = promotedSessionKeyMap.get(namespace) ?? namespace;
  return `${canonicalNamespace}:${key}`;
};

const getPersistentToggleValueForNamespace = (
  namespace: string,
  key: string,
): boolean | undefined =>
  expansionMemory.get(scopedKeyForNamespace(namespace, key)) ??
  expansionMemory.get(`${namespace}:${key}`);

export const usePersistentToggle = (
  key: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] => {
  const contextNamespace = useContext(PersistentToggleNamespaceContext);
  const activeNamespace = contextNamespace ?? currentNamespace;

  const [value, setValue] = useState(() => {
    const scoped = scopedKeyForNamespace(activeNamespace, key);
    const existing = getPersistentToggleValueForNamespace(activeNamespace, key);
    if (existing !== undefined) return existing;
    if (defaultValue) {
      persistValue(scoped, defaultValue);
    }
    return defaultValue;
  });

  useEffect(() => {
    const existing = getPersistentToggleValueForNamespace(activeNamespace, key);
    if (existing !== undefined) {
      setValue(prev => (prev === existing ? prev : existing));
      return;
    }
    if (defaultValue) {
      persistValue(scopedKeyForNamespace(activeNamespace, key), true);
      setValue(true);
      return;
    }
    setValue(false);
  }, [activeNamespace, key, defaultValue]);

  const setPersistedValue = useCallback(
    (next: boolean) => {
      const scoped = scopedKeyForNamespace(activeNamespace, key);
      persistValue(scoped, next);
      if (activeNamespace && scoped !== `${activeNamespace}:${key}`) {
        persistValue(`${activeNamespace}:${key}`, next);
      }
      setValue(next);
    },
    [activeNamespace, key],
  );
  return [value, setPersistedValue];
};
