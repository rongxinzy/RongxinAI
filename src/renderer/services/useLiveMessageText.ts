import { useSyncExternalStore } from 'react';

import { coworkLiveTextStore } from './liveTextStore';

export const useLiveMessageText = (messageId: string, enabled: boolean): string | undefined => {
  const snapshot = useSyncExternalStore(
    listener => coworkLiveTextStore.subscribe(listener),
    () => (enabled ? coworkLiveTextStore.getSnapshot(messageId) : undefined),
    () => undefined,
  );
  return snapshot;
};
