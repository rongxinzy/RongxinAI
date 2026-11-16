import { useCallback, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';

import { setDraftPrompt } from '../../../store/slices/coworkSlice';
import { isImagePath } from './promptInputUtils';
import type { CoworkAttachment } from './types';
import { PromptDraftKey } from './constants';

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
  const previousDraftRef = useRef({ draftKey, value, draftPrompt });
  if (previousDraftKeyRef.current === draftKey) {
    previousDraftRef.current = { draftKey, value, draftPrompt };
  }
  // Sync value from draft when sessionId changes
  useEffect(() => {
    const previousDraftKey = previousDraftKeyRef.current;
    const previousDraft = previousDraftRef.current;
    previousDraftKeyRef.current = draftKey;
    const isTempPromotion =
      (previousDraftKey === PromptDraftKey.Home &&
        draftKey.startsWith(PromptDraftKey.TemporaryPrefix)) ||
      (previousDraftKey.startsWith(PromptDraftKey.TemporaryPrefix) &&
        draftKey !== PromptDraftKey.Home &&
        !draftKey.startsWith(PromptDraftKey.TemporaryPrefix));
    // A persistent editor switches draft identities without unmounting. Flush
    // its previous key before cancelling the debounce, or the last keystrokes
    // disappear when switching sessions within 300ms.
    if (previousDraftKey !== draftKey && suppressedDraftKeyRef.current !== previousDraftKey) {
      if (isTempPromotion) {
        if (previousDraft.value !== draftPrompt) {
          dispatch(setDraftPrompt({ sessionId: draftKey, draft: previousDraft.value }));
        }
      } else if (previousDraft.value !== previousDraft.draftPrompt) {
        dispatch(setDraftPrompt({ sessionId: previousDraftKey, draft: previousDraft.value }));
      }
    }
    previousDraftRef.current = {
      draftKey,
      value: isTempPromotion ? previousDraft.value : draftPrompt,
      draftPrompt,
    };
    suppressedDraftKeyRef.current = null;
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
    previousDraftRef.current = { ...previousDraftRef.current, value: '', draftPrompt: '' };
  }, []);

  const clearSuppressedDraft = useCallback(() => {
    suppressedDraftKeyRef.current = null;
  }, []);

  return { markDraftCleared, clearSuppressedDraft };
}
