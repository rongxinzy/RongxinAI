/** Cowork session image persistence and session teardown helpers. */
import { app } from 'electron';

import { getCoworkStore } from './runtimeServices';
import { getPiRuntimeAdapter } from './sessionServices';
import type { CoworkMessageMetadata } from '../coworkStore';
import {
  coworkImageRoot,
  deleteCoworkSessionImages,
  persistMessageImageMetadata,
} from '../coworkImageAttachments';

export const getCoworkImageRoot = (): string => coworkImageRoot(app.getPath('userData'));

const materializeSessionImages = (
  sessionId: string,
  messages: Array<{ id: string; metadata?: unknown }>,
): void => {
  const root = getCoworkImageRoot();
  const store = getCoworkStore();
  for (const message of messages) {
    if (!message.metadata || typeof message.metadata !== 'object') continue;
    const next = persistMessageImageMetadata(
      root,
      sessionId,
      message.metadata as Record<string, unknown>,
    );
    if (!next.changed || !next.metadata) continue;
    store.updateMessage(
      sessionId,
      message.id,
      { metadata: next.metadata as CoworkMessageMetadata },
      { touchUpdatedAt: false },
    );
    message.metadata = next.metadata;
  }
};

export const scheduleBackgroundMaterialize = (
  sessionId: string,
  messages: Array<{ id: string; metadata?: unknown }>,
): void => {
  const hasInlineImages = messages.some(
    m =>
      m.metadata &&
      typeof m.metadata === 'object' &&
      Array.isArray((m.metadata as Record<string, unknown>).imageAttachments) &&
      ((m.metadata as Record<string, unknown>).imageAttachments as unknown[]).some(img =>
        Boolean(
          img &&
          typeof img === 'object' &&
          'base64Data' in img &&
          (img as { base64Data?: string }).base64Data,
        ),
      ),
  );
  if (!hasInlineImages) return;

  setImmediate(() => {
    try {
      materializeSessionImages(sessionId, messages);
    } catch (error) {
      console.warn('[CoworkImages] background materialize failed for session:', sessionId, error);
    }
  });
};

export const listAllMatchingSessionIds = (filter: {
  agentId?: string;
  workspaceId?: string;
}): string[] => {
  const store = getCoworkStore();
  const ids: string[] = [];
  const pageSize = 200;
  for (let offset = 0; ; offset += pageSize) {
    const batch = store.listSessions(pageSize, offset, filter.agentId, filter.workspaceId);
    ids.push(...batch.map(session => session.id));
    if (batch.length < pageSize) break;
  }
  return ids;
};

export const forgetCoworkSession = (sessionId: string): void => {
  try {
    getPiRuntimeAdapter().onSessionDeleted(sessionId);
  } catch (error) {
    console.error('[Cowork] failed to release session runtime:', error);
  }
  try {
    deleteCoworkSessionImages(getCoworkImageRoot(), sessionId);
  } catch (error) {
    console.error('[Cowork] failed to delete session images:', error);
  }
};
