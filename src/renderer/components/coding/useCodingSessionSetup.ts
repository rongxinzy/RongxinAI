import { useEffect, useRef, useState } from 'react';

import type { CodingWorkspaceSummary } from '../../../shared/codingAgent';
import type { CodingSidebarSelection } from './CodingWorkspaceSidebar';
import { buildCodingSessionDraftSelection } from './codingSessionDraft';
import { CodingUiEvent, type CodingCreateSessionEventDetail } from './constants';

interface UseCodingSessionSetupOptions {
  /** Current workspace/lane/draft selection; changing it closes the dialog. */
  selectionKey: string;
  onSessionDraftCreated: (selection: CodingSidebarSelection) => void;
}

/**
 * State of the "new coding session" dialog, opened through the
 * `coding:create-session` window event. Closes automatically when the user
 * switches selection while it is open.
 */
export function useCodingSessionSetup({
  selectionKey,
  onSessionDraftCreated,
}: UseCodingSessionSetupOptions) {
  const [sessionSetupWorkspace, setSessionSetupWorkspace] = useState<CodingWorkspaceSummary | null>(
    null,
  );
  const sessionSetupSelectionKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const openSessionSetup = (event: Event) => {
      const detail = (event as CustomEvent<CodingCreateSessionEventDetail>).detail;
      // 新建工作区时默认 Agent 已经确定：直接进入会话，不再让用户选一次。
      if (detail.profileId) {
        onSessionDraftCreated(buildCodingSessionDraftSelection(detail.workspace, detail.profileId));
        return;
      }
      sessionSetupSelectionKeyRef.current = selectionKey;
      setSessionSetupWorkspace(detail.workspace);
    };
    window.addEventListener(CodingUiEvent.CreateSession, openSessionSetup);
    return () => window.removeEventListener(CodingUiEvent.CreateSession, openSessionSetup);
  }, [onSessionDraftCreated, selectionKey]);

  useEffect(() => {
    if (
      sessionSetupWorkspace &&
      sessionSetupSelectionKeyRef.current !== null &&
      sessionSetupSelectionKeyRef.current !== selectionKey
    ) {
      setSessionSetupWorkspace(null);
      sessionSetupSelectionKeyRef.current = null;
    }
  }, [selectionKey, sessionSetupWorkspace]);

  const closeSessionSetup = () => {
    setSessionSetupWorkspace(null);
    sessionSetupSelectionKeyRef.current = null;
  };

  const submitSessionSetup = (
    workspace: CodingWorkspaceSummary,
    input: { profileId: string; sourceRoot: string },
  ) => {
    onSessionDraftCreated(
      buildCodingSessionDraftSelection(workspace, input.profileId, input.sourceRoot),
    );
    closeSessionSetup();
  };

  return { closeSessionSetup, sessionSetupWorkspace, submitSessionSetup };
}
