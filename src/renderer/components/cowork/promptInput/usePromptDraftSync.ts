import { useCallback, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';

import { setDraftPrompt } from '../../../store/slices/coworkSlice';
import { isImagePath } from './promptInputUtils';
import type { CoworkAttachment } from './types';

interface UsePromptDraftSyncParams {
  draftKey: string;
  draftPrompt: string;
  value: string;
  setValue: (value: string) => void;
  attachments: CoworkAttachment[];
  modelSupportsImage: boolean;
  setImageVisionHint: (hint: boolean) => void;
}

/**
 * Draft persistence for the composer: syncs from the Redux draft on session
 * switches, debounces writes while typing, and flushes the pending draft on
 * unmount (unless the composer was explicitly cleared for submission).
 */
export function usePromptDraftSync({
  draftKey,
  draftPrompt,
  value,
  setValue,
  attachments,
  modelSupportsImage,
  setImageVisionHint,
}: UsePromptDraftSyncParams) {
  const dispatch = useDispatch();

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressedDraftKeyRef = useRef<string | null>(null);
  const previousDraftKeyRef = useRef(draftKey);
  // Sync value from draft when sessionId changes
  useEffect(() => {
    const previousDraftKey = previousDraftKeyRef.current;
    previousDraftKeyRef.current = draftKey;
    suppressedDraftKeyRef.current = null;
    const isTempPromotion =
      previousDraftKey.startsWith('temp-') &&
      draftKey !== '__home__' &&
      !draftKey.startsWith('temp-');
    if (!isTempPromotion) {
      setValue(draftPrompt);
      // Re-derive imageVisionHint from the new session's draft attachments
      const hasImageWithoutVision =
        !modelSupportsImage && attachments.some(a => a.isImage || isImagePath(a.path));
      setImageVisionHint(hasImageWithoutVision);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]); // intentionally omit other deps to only trigger on session switch

  useEffect(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (value !== draftPrompt) {
      if (value) {
        suppressedDraftKeyRef.current = null;
      }
      if (suppressedDraftKeyRef.current === draftKey && !value) {
        return;
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (suppressedDraftKeyRef.current === draftKey && !value) return;
        dispatch(setDraftPrompt({ sessionId: draftKey, draft: value }));
      }, 300);
      return () => {
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
      };
    }
  }, [value, draftPrompt, dispatch, draftKey]);

  // Flush the pending debounced draft on unmount so navigating away (e.g.
  // opening the full-page settings) does not lose the last keystrokes.
  const latestDraftRef = useRef({ value, draftPrompt, draftKey });
  latestDraftRef.current = { value, draftPrompt, draftKey };
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const latest = latestDraftRef.current;
      if (suppressedDraftKeyRef.current === latest.draftKey) return;
      if (latest.value !== latest.draftPrompt) {
        dispatch(setDraftPrompt({ sessionId: latest.draftKey, draft: latest.value }));
      }
    };
  }, [dispatch]);

  const markDraftCleared = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    suppressedDraftKeyRef.current = latestDraftRef.current.draftKey;
    latestDraftRef.current = {
      ...latestDraftRef.current,
      value: '',
      draftPrompt: '',
    };
  }, []);

  const clearSuppressedDraft = useCallback(() => {
    suppressedDraftKeyRef.current = null;
  }, []);

  return { markDraftCleared, clearSuppressedDraft };
}
