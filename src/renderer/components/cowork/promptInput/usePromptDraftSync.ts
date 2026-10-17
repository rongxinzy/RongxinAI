import { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import type { usePromptInputController } from '@shared/components/ai-elements/prompt-input';

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
  controller: ReturnType<typeof usePromptInputController>;
}

/**
 * Draft persistence for the composer: mirrors the local value into the
 * PromptInput controller, syncs from the Redux draft on session switches,
 * debounces writes while typing, and flushes the pending draft on unmount.
 */
export function usePromptDraftSync({
  draftKey,
  draftPrompt,
  value,
  setValue,
  attachments,
  modelSupportsImage,
  setImageVisionHint,
  controller,
}: UsePromptDraftSyncParams) {
  const dispatch = useDispatch();

  // Keep a stable ref to the controller to avoid [controller] dep in the sync effect.
  // Without this, every controller reference change triggers a re-render cascade
  // which can cause OOM when switching to sessions with large message histories.
  const controllerRef = useRef(controller);
  controllerRef.current = controller;

  // Sync local value to PromptInput's controller on all changes
  // (clear on submit, external setValue, session switch, etc.)
  useEffect(() => {
    const ctrl = controllerRef.current;
    if (ctrl.textInput.value !== value) {
      ctrl.textInput.setInput(value);
    }
  }, [value]);

  const previousDraftKeyRef = useRef(draftKey);
  // Sync value from draft when sessionId changes
  useEffect(() => {
    const previousDraftKey = previousDraftKeyRef.current;
    previousDraftKeyRef.current = draftKey;
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
    if (value !== draftPrompt) {
      const timer = setTimeout(() => {
        dispatch(setDraftPrompt({ sessionId: draftKey, draft: value }));
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [value, draftPrompt, dispatch, draftKey]);

  // Flush the pending debounced draft on unmount so navigating away (e.g.
  // opening the full-page settings) does not lose the last keystrokes.
  const latestDraftRef = useRef({ value, draftPrompt, draftKey });
  latestDraftRef.current = { value, draftPrompt, draftKey };
  useEffect(() => {
    return () => {
      const latest = latestDraftRef.current;
      if (latest.value !== latest.draftPrompt) {
        dispatch(setDraftPrompt({ sessionId: latest.draftKey, draft: latest.value }));
      }
    };
  }, [dispatch]);
}
