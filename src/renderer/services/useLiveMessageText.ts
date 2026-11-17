import { useCallback, useSyncExternalStore } from 'react';

import { coworkLiveTextStore } from './liveTextStore';

const NOOP_UNSUBSCRIBE = () => {};

export const useLiveMessageText = (messageId: string, enabled: boolean): string | undefined => {
  const subscribe = useCallback(
    (listener: () => void) =>
      enabled && messageId
        ? coworkLiveTextStore.subscribeMessage(messageId, listener)
        : NOOP_UNSUBSCRIBE,
    [enabled, messageId],
  );
  const getSnapshot = useCallback(
    () => (enabled && messageId ? coworkLiveTextStore.getSnapshot(messageId) : undefined),
    [enabled, messageId],
  );

  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
};
