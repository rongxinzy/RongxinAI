import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import type {
  AddCodingAgentProfileInput,
  CodingAgentConfigOption,
  CodingAgentLane,
  CodingAgentProfile,
  CodingElicitation,
  CodingPermissionOutcome,
  CodingPromptAttachment,
  CodingRoomSnapshot,
} from '../../../shared/codingAgent';
import { CodingAgentDriverKind, CodingLaneStatus } from '../../../shared/codingAgent';
import { reportAppError } from '../../services/appErrorText';
import { showAppError, showAppToast } from '../../services/appToast';
import { createCodingQueueService } from '../../services/codingQueue';
import { i18nService } from '../../services/i18n';
import type { Model } from '../../store/slices/modelSlice';
import { toAgentModelRef } from '../../utils/agentModelRef';
import type { CodingSessionDraft } from './CodingWorkspaceSidebar';

type CodingQueueService = ReturnType<typeof createCodingQueueService>;
type SetSnapshot = Dispatch<SetStateAction<CodingRoomSnapshot | null>>;
type CodingDriverKind = (typeof CodingAgentDriverKind)[keyof typeof CodingAgentDriverKind];

interface UseCodingLanePreparationOptions {
  workspaceRoot: string;
  activeLaneId: string | null;
  activeRemoteSessionId: string | null;
  activeDriverKind: CodingDriverKind | null;
  setSnapshot: SetSnapshot;
}

/**
 * ACP lanes need a driver session and built-in lanes re-project their config
 * options and slash commands whenever they open.
 */
export function useCodingLanePreparation({
  workspaceRoot,
  activeLaneId,
  activeRemoteSessionId,
  activeDriverKind,
  setSnapshot,
}: UseCodingLanePreparationOptions): void {
  useEffect(() => {
    const needsPrepare =
      activeDriverKind === CodingAgentDriverKind.Acp
        ? !activeRemoteSessionId
        : // Built-in lanes project their config options and slash commands from
          // driver code, so a persisted row can be stale or empty; every open
          // re-projects it (in-memory and idempotent for the built-in agent).
          activeDriverKind === CodingAgentDriverKind.Builtin;
    if (!activeLaneId || !needsPrepare) {
      return;
    }
    let cancelled = false;
    void window.electron.codingAgent
      .prepareLane({ workspaceRoot, laneId: activeLaneId })
      .then(result => {
        if (cancelled) return;
        if (result.success && result.snapshot) setSnapshot(result.snapshot);
        else showAppError(result.error, 'codingAgentActionFailed');
      })
      .catch(() => {
        if (!cancelled) showAppToast(i18nService.t('codingAgentActionFailed'), { isError: true });
      });
    return () => {
      cancelled = true;
    };
  }, [activeDriverKind, activeLaneId, activeRemoteSessionId, setSnapshot, workspaceRoot]);
}

interface UseCodingProfileActionsOptions {
  workspaceRoot: string;
  activeLane: CodingAgentLane | null;
  activeProfile: CodingAgentProfile | null;
  codingQueue: CodingQueueService;
  setSnapshot: SetSnapshot;
  setManagerProfiles: Dispatch<SetStateAction<CodingAgentProfile[]>>;
}

/** Discovery, probing and registration of agent profiles (manager dialog). */
export function useCodingProfileActions({
  workspaceRoot,
  activeLane,
  activeProfile,
  codingQueue,
  setSnapshot,
  setManagerProfiles,
}: UseCodingProfileActionsOptions) {
  const discoverAgents = async (): Promise<boolean> => {
    const result = await window.electron.codingAgent.discoverAgents({ workspaceRoot });
    if (!result.success) {
      showAppError(result.error, 'codingAgentActionFailed');
      return false;
    }
    if (result.profiles) setManagerProfiles(result.profiles);
    if (result.snapshot) {
      setSnapshot(result.snapshot);
      if (activeLane?.status === CodingLaneStatus.Running)
        void codingQueue.load(
          activeProfile?.driverKind === CodingAgentDriverKind.Acp
            ? activeLane.id
            : activeLane.localSessionId,
        );
    }
    return true;
  };
  const probeAgent = async (profileId: string): Promise<boolean> => {
    const result = await window.electron.codingAgent.probeAgent({ workspaceRoot, profileId });
    if (!result.success) {
      showAppError(result.error, 'codingAgentActionFailed');
      return false;
    }
    if (result.profiles) setManagerProfiles(result.profiles);
    if (result.snapshot) {
      setSnapshot(result.snapshot);
      if (activeProfile?.driverKind === CodingAgentDriverKind.Acp && activeLane) {
        void codingQueue.load(activeLane.id);
      }
    }
    return true;
  };
  const addProfile = async (profile: AddCodingAgentProfileInput): Promise<boolean> => {
    const result = await window.electron.codingAgent.addProfile({ workspaceRoot, profile });
    if (!result.success) {
      showAppError(result.error, 'codingAgentActionFailed');
      return false;
    }
    if (result.profiles) setManagerProfiles(result.profiles);
    if (result.snapshot) setSnapshot(result.snapshot);
    return true;
  };
  const trustProfile = async (profileId: string): Promise<boolean> => {
    const result = await window.electron.codingAgent.trustProfile({ workspaceRoot, profileId });
    if (!result.success) {
      showAppError(result.error, 'codingAgentActionFailed');
      return false;
    }
    if (result.profiles) setManagerProfiles(result.profiles);
    if (result.snapshot) setSnapshot(result.snapshot);
    return true;
  };
  return { addProfile, discoverAgents, probeAgent, trustProfile };
}

interface UseCodingLaneActionsOptions {
  workspaceRoot: string;
  activeLane: CodingAgentLane | null;
  activeElicitation: CodingElicitation | null;
  recoveryLane: CodingAgentLane | null;
  draftSession: CodingSessionDraft | null;
  setSnapshot: SetSnapshot;
  setDraftConfigOptions: Dispatch<SetStateAction<CodingAgentConfigOption[]>>;
  setDraftConfigOverrides: Dispatch<SetStateAction<Record<string, string>>>;
  setLaneChangePreview: Dispatch<SetStateAction<string | null>>;
  setApplyConflict: Dispatch<SetStateAction<string | null>>;
  onLaneSelected: (laneId: string) => void;
}

/** Lane-scoped IPC commands: permissions, elicitation, config and git changes. */
export function useCodingLaneActions({
  workspaceRoot,
  activeLane,
  activeElicitation,
  recoveryLane,
  draftSession,
  setSnapshot,
  setDraftConfigOptions,
  setDraftConfigOverrides,
  setLaneChangePreview,
  setApplyConflict,
  onLaneSelected,
}: UseCodingLaneActionsOptions) {
  const respondToPermission = async (
    requestId: string,
    outcome: CodingPermissionOutcome,
    optionId?: string,
  ) => {
    const result = await window.electron.codingAgent.respondPermission({
      workspaceRoot,
      response: { requestId, outcome, optionId },
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else showAppError(result.error, 'codingAgentActionFailed');
  };
  const respondElicitation = async (answer: string): Promise<boolean> => {
    if (!activeElicitation) return false;
    try {
      const result = await window.electron.codingAgent.respondElicitation({
        workspaceRoot,
        response: { requestId: activeElicitation.id, answer },
      });
      if (result.success && result.snapshot) {
        setSnapshot(result.snapshot);
        return true;
      }
      showAppError(result.error, 'codingAgentActionFailed');
    } catch (error) {
      showAppError(error, 'codingAgentActionFailed');
    }
    return false;
  };
  const cancelElicitation = async (): Promise<boolean> => {
    if (!activeElicitation) return false;
    try {
      const result = await window.electron.codingAgent.cancelElicitation({
        workspaceRoot,
        requestId: activeElicitation.id,
      });
      if (result.success && result.snapshot) {
        setSnapshot(result.snapshot);
        return true;
      }
      showAppError(result.error, 'codingAgentActionFailed');
    } catch (error) {
      showAppError(error, 'codingAgentActionFailed');
    }
    return false;
  };
  const confirmSessionRecovery = async (includeRecoveryContext: boolean) => {
    if (!recoveryLane) return;
    const result = await window.electron.codingAgent.confirmSessionRecovery({
      workspaceRoot,
      laneId: recoveryLane.id,
      includeRecoveryContext,
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else showAppError(result.error, 'codingAgentActionFailed');
  };
  const cancel = async () => {
    if (!activeLane) return;
    const result = await window.electron.codingAgent.cancel({
      workspaceRoot,
      laneId: activeLane.id,
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else showAppError(result.error, 'codingAgentActionFailed');
  };
  const setLaneConfigOption = async (configId: string, value: string | boolean) => {
    if (!activeLane) return;
    const result = await window.electron.codingAgent.setLaneConfigOption({
      workspaceRoot,
      option: { laneId: activeLane.id, configId, value },
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else showAppError(result.error, 'codingAgentActionFailed');
  };
  const setLaneModel = async (modelRef: string) => {
    if (!activeLane) return;
    const result = await window.electron.codingAgent.setLaneModelOverride({
      workspaceRoot,
      laneId: activeLane.id,
      modelOverride: modelRef,
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else showAppError(result.error, 'codingAgentActionFailed');
  };
  const changeConfigOption = async (configId: string, value: string | boolean) => {
    if (draftSession) {
      // No lane exists yet; track the choice locally and send it as an
      // override when the session is created.
      if (typeof value !== 'string') return;
      setDraftConfigOverrides(current => ({ ...current, [configId]: value }));
      setDraftConfigOptions(current =>
        current.map(option =>
          option.id === configId ? { ...option, currentValue: value } : option,
        ),
      );
      return;
    }
    await setLaneConfigOption(configId, value);
  };
  const previewLaneChanges = async () => {
    if (!activeLane) return;
    const result = await window.electron.codingAgent.previewLaneChanges({
      workspaceRoot,
      laneId: activeLane.id,
    });
    if (result.success && result.preview) {
      setLaneChangePreview(result.preview.diff);
      return;
    }
    showAppError(result.error, 'codingAgentActionFailed');
  };
  const applyLaneChanges = async () => {
    if (!activeLane) return;
    const result = await window.electron.codingAgent.applyLaneChanges({
      workspaceRoot,
      laneId: activeLane.id,
    });
    if (result.success && result.snapshot) {
      setSnapshot(result.snapshot);
      setLaneChangePreview(null);
      return;
    }
    if (result.conflict) {
      setLaneChangePreview(null);
      setApplyConflict(reportAppError(result.error, 'codingAgentActionFailed'));
      return;
    }
    showAppError(result.error, 'codingAgentActionFailed');
  };
  const selectLane = async (laneId: string) => {
    const result = await window.electron.codingAgent.selectLane({ workspaceRoot, laneId });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else showAppError(result.error, 'codingAgentActionFailed');
    if (result.success) onLaneSelected(laneId);
  };
  return {
    applyLaneChanges,
    cancel,
    cancelElicitation,
    changeConfigOption,
    confirmSessionRecovery,
    previewLaneChanges,
    respondElicitation,
    respondToPermission,
    selectLane,
    setLaneConfigOption,
    setLaneModel,
  };
}

interface UseCodingPromptSubmitOptions {
  workspaceRoot: string;
  prompt: string;
  activeLane: CodingAgentLane | null;
  activeProfile: CodingAgentProfile | null;
  draftSession: CodingSessionDraft | null;
  defaultSelectedModel: Model;
  promptAttachments: CodingPromptAttachment[];
  draftConfigOverrides: Record<string, string>;
  isCurrentWorkspace: () => boolean;
  setSnapshot: SetSnapshot;
  setDraftState: Dispatch<SetStateAction<{ laneId: string; value: string }>>;
  setNewSessionDraftState: Dispatch<SetStateAction<{ id: string; value: string }>>;
  setPromptAttachments: Dispatch<SetStateAction<CodingPromptAttachment[]>>;
  clearPendingDraftSave: () => void;
  onSessionCreated: (laneId: string) => void;
}

/** Submits prompts: session creation for drafts, turns for existing lanes. */
export function useCodingPromptSubmit({
  workspaceRoot,
  prompt,
  activeLane,
  activeProfile,
  draftSession,
  defaultSelectedModel,
  promptAttachments,
  draftConfigOverrides,
  isCurrentWorkspace,
  setSnapshot,
  setDraftState,
  setNewSessionDraftState,
  setPromptAttachments,
  clearPendingDraftSave,
  onSessionCreated,
}: UseCodingPromptSubmitOptions) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const sendPrompt = async (delivery?: 'followUp' | 'steer') => {
    if (!prompt.trim()) return;
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (draftSession) {
        const result = await window.electron.codingAgent.startSession({
          workspaceId: draftSession.workspaceId,
          sourceRoot: draftSession.sourceRoot,
          profileId: draftSession.profileId,
          modelOverride:
            draftSession.modelOverride ??
            (activeProfile?.isBuiltin && defaultSelectedModel
              ? toAgentModelRef(defaultSelectedModel)
              : undefined),
          prompt,
          ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
          ...(Object.keys(draftConfigOverrides).length > 0
            ? { configOptionOverrides: draftConfigOverrides }
            : {}),
        });
        if (!isCurrentWorkspace()) return;
        const laneId = result.snapshot?.room.activeLaneId;
        if (result.success && result.snapshot && laneId) {
          setSnapshot(result.snapshot);
          setNewSessionDraftState({ id: '', value: '' });
          setPromptAttachments([]);
          onSessionCreated(laneId);
        } else {
          showAppError(result.error, 'codingSessionCreateFailed');
        }
        return;
      }
      if (!activeLane) return;
      clearPendingDraftSave();
      const result = await window.electron.codingAgent.prompt({
        workspaceRoot,
        prompt: {
          laneId: activeLane.id,
          prompt,
          delivery,
          ...(promptAttachments.length > 0 ? { attachments: promptAttachments } : {}),
        },
      });
      if (!isCurrentWorkspace()) return;
      if (result.success && result.snapshot) {
        setDraftState({ laneId: activeLane.id, value: '' });
        setPromptAttachments([]);
        void window.electron.codingAgent.saveLaneView({
          workspaceRoot,
          view: { laneId: activeLane.id, draft: '', scrollPosition: activeLane.scrollPosition },
        });
        setSnapshot(result.snapshot);
      } else showAppError(result.error, 'codingAgentActionFailed');
    } catch (error) {
      if (isCurrentWorkspace()) {
        showAppError(error, 'codingAgentActionFailed');
      }
    } finally {
      setIsSubmitting(false);
    }
  };
  return { isSubmitting, sendPrompt };
}
