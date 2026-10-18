import { useLayoutEffect } from 'react';
import { useDispatch } from 'react-redux';

import { collectInlineArtifacts } from '../../../services/inlineArtifacts';
import { addArtifact } from '../../../store/slices/artifactSlice';
import type { CoworkMessage } from '../../../types/cowork';

interface UseInlineArtifactsOptions {
  sessionId: string | undefined;
  messages: CoworkMessage[] | undefined;
  isStreaming: boolean;
}

/**
 * Projects the inline code-block artifacts of the loaded assistant messages
 * into the artifact store synchronously, so cards appear in the first-paint
 * frame. File-backed artifacts are not derived here: they come from the
 * main-process ledger (persisted seed + live IPC upserts).
 */
export const useInlineArtifacts = ({
  sessionId,
  messages,
  isStreaming,
}: UseInlineArtifactsOptions): void => {
  const dispatch = useDispatch();

  useLayoutEffect(() => {
    if (!sessionId || isStreaming || !messages?.length) return;
    for (const artifact of collectInlineArtifacts(messages, sessionId)) {
      // Idempotent: re-projection merges onto the same `artifact-<id>-<index>` row.
      dispatch(addArtifact({ sessionId, artifact }));
    }
    // Re-run only when the session changes or its transcript settles; message
    // content edits inside a settled session are covered by identity changes
    // of the messages array itself.
  }, [sessionId, messages, isStreaming, dispatch]);
};
