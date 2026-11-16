import type { RefObject } from 'react';
import { useSelector } from 'react-redux';

import { CoworkSessionMode, type CoworkPermissionMode } from '../../../../shared/cowork/constants';
import { i18nService } from '../../../services/i18n';
import {
  selectCurrentSession,
  selectIsStreaming,
  selectLoadingSessionId,
  selectRemoteManaged,
} from '../../../store/selectors/coworkSelectors';
import { selectWorkMode } from '../../../store/selectors/workModeSelectors';
import PendingMessageQueue from '../../cowork/PendingMessageQueue';
import type { CoworkPromptInputProps, CoworkPromptInputRef } from '../../cowork/promptInput/types';
import { ConversationComposer } from './ConversationComposer';

interface StageComposerProps {
  homeProps: CoworkPromptInputProps;
  inputRef: RefObject<CoworkPromptInputRef | null>;
  displayedSessionId: string | null;
  onContinue: CoworkPromptInputProps['onSubmit'];
  sessionPermissionMode?: CoworkPermissionMode;
  onSessionPermissionModeChange: (mode: CoworkPermissionMode) => void;
  awaitingQuestion: boolean;
  awaitingPermission: boolean;
}

/** Home and session share this single component and ProseMirror document. */
export function StageComposer({
  homeProps,
  inputRef,
  displayedSessionId,
  onContinue,
  sessionPermissionMode,
  onSessionPermissionModeChange,
  awaitingQuestion,
  awaitingPermission,
}: StageComposerProps) {
  const currentSession = useSelector(selectCurrentSession);
  const loadingSessionId = useSelector(selectLoadingSessionId);
  const isStreaming = useSelector(selectIsStreaming);
  const remoteManaged = useSelector(selectRemoteManaged);
  const workMode = useSelector(selectWorkMode);
  const switching = Boolean(
    displayedSessionId &&
    loadingSessionId === displayedSessionId &&
    currentSession?.id !== displayedSessionId,
  );
  const managed = Boolean(displayedSessionId && !switching && remoteManaged);
  const props: CoworkPromptInputProps = displayedSessionId
    ? {
        ...homeProps,
        onSubmit: onContinue,
        sessionId: displayedSessionId,
        topAccessory:
          !switching && workMode === CoworkSessionMode.Work && currentSession ? (
            <PendingMessageQueue sessionId={currentSession.id} isStreaming={isStreaming} />
          ) : null,
        isStreaming: !switching && isStreaming,
        sessionContextPending: switching,
        disabled: !switching && (managed || awaitingQuestion || awaitingPermission),
        placeholder: i18nService.t(
          managed
            ? 'coworkRemoteManagedPlaceholder'
            : workMode === CoworkSessionMode.Chat
              ? 'chatPlaceholder'
              : 'coworkContinuePlaceholder',
        ),
        remoteManaged: managed,
        showFolderSelector: false,
        onManageModels: managed ? undefined : homeProps.onManageModels,
        onManageSkills: managed ? undefined : homeProps.onManageSkills,
        onManageConnectors: managed ? undefined : homeProps.onManageConnectors,
        permissionMode: sessionPermissionMode,
        onPermissionModeChange: onSessionPermissionModeChange,
      }
    : homeProps;
  return <ConversationComposer {...props} ref={inputRef} />;
}
