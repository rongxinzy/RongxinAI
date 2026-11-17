import { useCallback, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';

import { setDraftPrompt } from '../../../store/slices/coworkSlice';
import { isImagePath } from './promptInputUtils';
import type { CoworkAttachment } from './types';
import { PromptDraftKey } from './constants';

interface UsePromptDraftSyncParams {
  draftKey: string;
  draftPrompt: string;
  draftDoc?: Record<string, unknown> | null;
  value: string;
  doc?: Record<string, unknown> | null;
  setValue: (value: string) => void;
  setDraftState?: (value: string, doc: Record<string, unknown> | null) => void;
  attachments: CoworkAttachment[];
  modelSupportsImage: boolean;
  setImageVisionHint: (hint: boolean) => void;
}

const buildDraftPayload = (
  sessionId: string,
  draft: string,
  doc: Record<string, unknown> | null | undefined,
) => (doc !== undefined ? { sessionId, draft, doc } : { sessionId, draft });

/**
 * Draft persistence for the composer: syncs from the Redux draft on session
 * switches, debounces writes while typing, and flushes the pending draft on
 * unmount or session transitions (preserving rich Tiptap JSON docs when provided).
 */
export function usePromptDraftSync({
  draftKey,
  draftPrompt,
  draftDoc,
  value,
  doc,
  setValue,
  setDraftState,
  attachments,
  modelSupportsImage,
  setImageVisionHint,
}: UsePromptDraftSyncParams) {
  const dispatch = useDispatch();

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressedDraftKeyRef = useRef<string | null>(null);
  const previousDraftKeyRef = useRef(draftKey);
  const previousDraftRef = useRef({ draftKey, value, draftPrompt, doc, draftDoc });
  if (previousDraftKeyRef.current === draftKey) {
    previousDraftRef.current = { draftKey, value, draftPrompt, doc, draftDoc };
  }

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
        if (previousDraft.value !== draftPrompt || previousDraft.doc !== draftDoc) {
          dispatch(
            setDraftPrompt(buildDraftPayload(draftKey, previousDraft.value, previousDraft.doc)),
          );
        }
      } else if (
        previousDraft.value !== previousDraft.draftPrompt ||
        previousDraft.doc !== previousDraft.draftDoc
      ) {
        dispatch(
          setDraftPrompt(
            buildDraftPayload(previousDraftKey, previousDraft.value, previousDraft.doc),
          ),
        );
      }
    }

    previousDraftRef.current = {
      draftKey,
      value: isTempPromotion ? previousDraft.value : draftPrompt,
      draftPrompt,
      doc: isTempPromotion ? previousDraft.doc : (draftDoc ?? null),
      draftDoc,
    };
    suppressedDraftKeyRef.current = null;
    if (!isTempPromotion) {
      if (setDraftState) {
        setDraftState(draftPrompt, draftDoc ?? null);
      } else {
        setValue(draftPrompt);
      }
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
    if (value !== draftPrompt || (doc !== undefined && doc !== draftDoc)) {
      if (value) {
        suppressedDraftKeyRef.current = null;
      }
      if (suppressedDraftKeyRef.current === draftKey && !value) {
        return;
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (suppressedDraftKeyRef.current === draftKey && !value) return;
        dispatch(setDraftPrompt(buildDraftPayload(draftKey, value, doc)));
      }, 300);
      return () => {
        if (debounceTimerRef.current !== null) {
          clearTimeout(debounceTimerRef.current);
          debounceTimerRef.current = null;
        }
      };
    }
  }, [value, doc, draftPrompt, draftDoc, dispatch, draftKey]);

  const latestDraftRef = useRef({ value, doc, draftPrompt, draftDoc, draftKey });
  latestDraftRef.current = { value, doc, draftPrompt, draftDoc, draftKey };
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const latest = latestDraftRef.current;
      if (suppressedDraftKeyRef.current === latest.draftKey) return;
      if (
        latest.value !== latest.draftPrompt ||
        (latest.doc !== undefined && latest.doc !== latest.draftDoc)
      ) {
        dispatch(setDraftPrompt(buildDraftPayload(latest.draftKey, latest.value, latest.doc)));
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
      doc: null,
      draftPrompt: '',
      draftDoc: null,
    };
    previousDraftRef.current = {
      ...previousDraftRef.current,
      value: '',
      doc: null,
      draftPrompt: '',
      draftDoc: null,
    };
  }, []);

  const clearSuppressedDraft = useCallback(() => {
    suppressedDraftKeyRef.current = null;
  }, []);

  return { markDraftCleared, clearSuppressedDraft };
}
