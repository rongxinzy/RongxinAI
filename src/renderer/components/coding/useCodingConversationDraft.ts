import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { CodingAgentLane } from '../../../shared/codingAgent';
import type { CodingSessionDraft } from './CodingWorkspaceSidebar';

const thisScrollPosition = (root: HTMLDivElement | null): number =>
  root?.querySelector<HTMLElement>('.coding-conversation-scroll')?.scrollTop ?? 0;

export interface CodingLaneDraftState {
  laneId: string;
  value: string;
}

export interface CodingNewSessionDraftState {
  id: string;
  value: string;
}

interface UseCodingConversationDraftOptions {
  workspaceRoot: string;
  activeLane: CodingAgentLane | null;
  draftSession: CodingSessionDraft | null;
  eventStreamRef: RefObject<HTMLDivElement | null>;
  /** Clears the prompt attachments (re-editing a message resets them). */
  onClearAttachments: () => void;
}

/**
 * Tracks the composer draft for the active lane and for a not-yet-created
 * session, and persists draft text plus scroll position (debounced) through
 * `saveLaneView`.
 */
export function useCodingConversationDraft({
  workspaceRoot,
  activeLane,
  draftSession,
  eventStreamRef,
  onClearAttachments,
}: UseCodingConversationDraftOptions) {
  const [draftState, setDraftState] = useState<CodingLaneDraftState>({ laneId: '', value: '' });
  const [newSessionDraftState, setNewSessionDraftState] = useState<CodingNewSessionDraftState>({
    id: '',
    value: '',
  });
  const [composerFocusRequestKey, setComposerFocusRequestKey] = useState(0);
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const prompt = draftSession
    ? newSessionDraftState.id === draftSession.id
      ? newSessionDraftState.value
      : ''
    : draftState.laneId === activeLane?.id
      ? draftState.value
      : (activeLane?.draft ?? '');

  useEffect(
    () => () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
      if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
    },
    [],
  );

  const saveDraft = useCallback(
    (laneId: string, draft: string) => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = setTimeout(() => {
        void window.electron.codingAgent.saveLaneView({
          workspaceRoot,
          view: { laneId, draft, scrollPosition: thisScrollPosition(eventStreamRef.current) },
        });
      }, 300);
    },
    [eventStreamRef, workspaceRoot],
  );

  const clearPendingDraftSave = useCallback(() => {
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
  }, []);

  const reEditUserMessage = useCallback(
    (content: string) => {
      if (!activeLane) return;
      setDraftState({ laneId: activeLane.id, value: content });
      onClearAttachments();
      saveDraft(activeLane.id, content);
      setComposerFocusRequestKey(current => current + 1);
    },
    [activeLane, onClearAttachments, saveDraft],
  );

  const saveScrollPosition = useCallback(
    (laneId: string, scrollPosition: number) => {
      if (scrollSaveTimer.current) clearTimeout(scrollSaveTimer.current);
      scrollSaveTimer.current = setTimeout(() => {
        void window.electron.codingAgent.saveLaneView({
          workspaceRoot,
          view: { laneId, draft: prompt, scrollPosition },
        });
      }, 300);
    },
    [prompt, workspaceRoot],
  );

  return {
    clearPendingDraftSave,
    composerFocusRequestKey,
    prompt,
    reEditUserMessage,
    saveDraft,
    saveScrollPosition,
    setDraftState,
    setNewSessionDraftState,
  };
}
