import { useCallback, useState } from 'react';

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

let currentNamespace = '';

/** Scopes subsequently persisted toggles to one session. */
export const setPersistentToggleNamespace = (namespace: string): void => {
  currentNamespace = namespace;
};

const scopedKey = (key: string): string => `${currentNamespace}:${key}`;

const persistValue = (scoped: string, next: boolean): void => {
  expansionMemory.delete(scoped); // refresh recency
  expansionMemory.set(scoped, next);
  if (expansionMemory.size > EXPANSION_MEMORY_LIMIT) {
    const oldest = expansionMemory.keys().next().value;
    if (oldest !== undefined) expansionMemory.delete(oldest);
  }
};

export const usePersistentToggle = (
  key: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] => {
  const [value, setValue] = useState(() => {
    const scoped = scopedKey(key);
    const existing = expansionMemory.get(scoped);
    if (existing !== undefined) return existing;
    if (defaultValue) {
      persistValue(scoped, defaultValue);
    }
    return defaultValue;
  });
  const setPersistedValue = useCallback(
    (next: boolean) => {
      const scoped = scopedKey(key);
      persistValue(scoped, next);
      setValue(next);
    },
    [key],
  );
  return [value, setPersistedValue];
};
