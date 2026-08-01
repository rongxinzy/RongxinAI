import { useCallback, useState } from 'react';

/**
 * Session-lifetime expansion memory for collapsible turn content. Turn
 * rows unmount under virtualization (and remount during image export), so
 * expansion state lives outside the component tree (issue #141).
 */
const expansionMemory = new Map<string, boolean>();

export const usePersistentToggle = (
  key: string,
  defaultValue: boolean,
): [boolean, (next: boolean) => void] => {
  const [value, setValue] = useState(() => expansionMemory.get(key) ?? defaultValue);
  const setPersistedValue = useCallback(
    (next: boolean) => {
      expansionMemory.set(key, next);
      setValue(next);
    },
    [key],
  );
  return [value, setPersistedValue];
};
