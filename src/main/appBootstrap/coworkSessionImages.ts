/** Cowork session image persistence and session teardown helpers. */
import { isRecord } from '../../shared/lib/isRecord';

import { lifecycleRuntime } from './lifecycleRuntimeState';
import { getCoworkStore } from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';
import { getCoworkImageRoot } from './workspacePaths';
import {
  deleteCoworkSessionImages,
  hasInlineCoworkImages,
  persistInlineMessageImages,
} from '../coworkImageAttachments';

const materializeSessionImages = async (
  sessionId: string,
  piHistoryKey: string | null,
  messages: Array<{ id: string; metadata?: unknown }>,
): Promise<void> => {
  const store = getCoworkStore();
  const isCurrent = () =>
    !lifecycleRuntime.isQuitting && store.getPiHistoryKey(sessionId) === piHistoryKey;
  if (!isCurrent()) return;
  const root = getCoworkImageRoot();
  const messageStore = store.messages;
  for (const message of messages) {
    const imageAttachments = await persistInlineMessageImages(root, sessionId, message.metadata, {
      isCurrent,
    });
    if (!isCurrent()) return;
    if (!imageAttachments) continue;
    const current = messageStore.getMessage(sessionId, message.id);
    if (!hasInlineCoworkImages(current?.metadata?.imageAttachments)) continue;
    messageStore.updateMessage(
      sessionId,
      message.id,
      { metadata: { ...current.metadata, imageAttachments } },
      { touchUpdatedAt: false },
    );
  }
};

export const scheduleBackgroundMaterialize = (
  sessionId: string,
  messages: Array<{ id: string; metadata?: unknown }>,
): void => {
  const hasInlineImages = messages.some(
    m => isRecord(m.metadata) && hasInlineCoworkImages(m.metadata.imageAttachments),
  );
  if (!hasInlineImages) return;
  const piHistoryKey = getCoworkStore().getPiHistoryKey(sessionId);
  if (piHistoryKey === undefined) return;

  setImmediate(() => {
    if (lifecycleRuntime.isQuitting) return;
    void materializeSessionImages(sessionId, piHistoryKey, messages).catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.warn('[CoworkImages] background materialize failed for session:', sessionId, error);
    });
  });
};

export const forgetCoworkSession = async (
  sessionId: string,
  piHistoryKey: string | null,
): Promise<void> => {
  let runtimeCleanup: Promise<void> | undefined;
  try {
    runtimeCleanup = getPiRuntimeAdapter()
      .onSessionDeleted(sessionId, piHistoryKey)
      .catch(error => {
        console.error('[Cowork] failed to release session runtime:', error);
      });
  } catch (error) {
    console.error('[Cowork] failed to release session runtime:', error);
  }
  try {
    await deleteCoworkSessionImages(getCoworkImageRoot(), sessionId);
  } catch (error) {
    console.error('[Cowork] failed to delete session images:', error);
  }
  await runtimeCleanup;
};
