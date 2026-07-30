import { useEffect, useState } from 'react';

const DEFAULT_VISIBILITY_DELAY_MS = 200;

export function useDelayedVisibility(
  requestedVisible: boolean,
  delayMs = DEFAULT_VISIBILITY_DELAY_MS,
): boolean {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!requestedVisible) {
      setVisible(false);
      return;
    }

    const timer = setTimeout(() => {
      setVisible(true);
    }, delayMs);

    return () => {
      clearTimeout(timer);
    };
  }, [delayMs, requestedVisible]);

  return visible;
}
