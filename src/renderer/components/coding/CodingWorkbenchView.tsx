import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@shared/components/ui/sheet';
import { cn } from '@shared/lib/utils';
import {
  FileDiff,
  FolderGit2,
  GitBranch,
  Layers,
  PanelRight,
  Settings2,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import type { CodingAgentConfigOption, CodingRoomSnapshot } from '../../../shared/codingAgent';
import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingEventKind,
  CodingLaneStatus,
  CodingPermissionOutcome,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import {
  activateSessionArtifactView,
  closePanel,
  EMPTY_ARTIFACTS,
  MIN_PANEL_WIDTH,
  selectIsSessionArtifactPanelOpen,
  selectSessionArtifactLayoutMode,
  selectSessionArtifacts,
  togglePanel,
} from '../../store/slices/artifactSlice';
import PageHeader from '../PageHeader';
import { ArtifactPanelErrorBoundary } from '../artifacts/ArtifactPanelErrorBoundary';
import { resolveArtifactPanelMaxWidth } from '../artifacts/artifactPanelResize';
import type { RootState } from '../../store';
import { toAgentModelRef, resolveAgentModelRef } from '../../utils/agentModelRef';
import { CodingAgentManager } from './CodingAgentManager';
import { CodingAuthAndPermissionDialogs } from './CodingAuthAndPermissionDialogs';
import { CodingComposer } from './CodingComposer';
import { CodingDraftControls } from './CodingDraftControls';
import { CodingEventStream } from './CodingEventStream';
import { CodingGitPanel } from './CodingGitPanel';
import { CodingInspector } from './CodingInspector';
import { CodingParticipants } from './CodingParticipants';
import { CodingAgentStatusI18nKey, CodingSidePanelView } from './constants';
import type { CodingSidePanelView as CodingSidePanelViewType } from './constants';
import type { CodingSessionDraft } from './CodingWorkspaceSidebar';
import { CoworkModelPicker } from '../cowork/CoworkModelPicker';
import { createCodingQueueService } from '../../services/codingQueue';

const profileStatusText = (status: CodingAgentProfileStatus): string =>
  i18nService.t(CodingAgentStatusI18nKey[status]);

const EMPTY_SNAPSHOT: CodingRoomSnapshot | null = null;

const ArtifactPanelFrame = lazy(() =>
  import('../artifacts').then(module => ({ default: module.ArtifactPanelFrame })),
);

interface CodingWorkbenchViewProps {
  workspaceRoot: string;
  selectedLaneId: string | null;
  draftSession: CodingSessionDraft | null;
  onDraftSessionChange: (draft: CodingSessionDraft) => void;
  onSessionCreated: (laneId: string) => void;
  onLaneSelected: (laneId: string) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export const CodingWorkbenchView = ({
  workspaceRoot,
  selectedLaneId,
  draftSession,
  onDraftSessionChange,
  onSessionCreated,
  onLaneSelected,
  isSidebarCollapsed = false,
  onToggleSidebar,
}: CodingWorkbenchViewProps) => {
  const [snapshot, setSnapshot] = useState<CodingRoomSnapshot | null>(EMPTY_SNAPSHOT);
  const [draftState, setDraftState] = useState({ laneId: '', value: '' });
  const [newSessionDraftState, setNewSessionDraftState] = useState({ id: '', value: '' });
  const [error, setError] = useState<string | null>(null);
  const codingQueue = useMemo(() => createCodingQueueService(workspaceRoot), [workspaceRoot]);
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);
  const [gitSheetOpen, setGitSheetOpen] = useState(false);
  const [sidePanelView, setSidePanelView] = useState<CodingSidePanelViewType | null>(null);
  const [laneChangePreview, setLaneChangePreview] = useState<string | null>(null);
  const [applyConflict, setApplyConflict] = useState<string | null>(null);
  const [authTerminal, setAuthTerminal] = useState<{
    id: string;
    profileId: string;
    output: string;
  } | null>(null);
  const [authTerminalInput, setAuthTerminalInput] = useState('');
  const [agentManagerOpen, setAgentManagerOpen] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const defaultSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventStreamRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!workspaceRoot) {
      setSnapshot(null);
      return;
    }
    let cancelled = false;
    void window.electron.codingAgent.bootstrap(workspaceRoot).then(result => {
      if (!cancelled && result.success && result.snapshot) setSnapshot(result.snapshot);
    });
    const unsubscribe = window.electron.codingAgent.onChanged(next => {
      if (next.room.workspaceRoot === workspaceRoot) setSnapshot(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [workspaceRoot]);
  useEffect(() => {
    if (
      !workspaceRoot ||
      !selectedLaneId ||
      !snapshot?.lanes.some(lane => lane.id === selectedLaneId) ||
      snapshot.room.activeLaneId === selectedLaneId
    ) {
      return;
    }
    void window.electron.codingAgent
      .selectLane({ workspaceRoot, laneId: selectedLaneId })
      .then(result => {
        if (result.success && result.snapshot) setSnapshot(result.snapshot);
        else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
      });
  }, [selectedLaneId, snapshot, workspaceRoot]);
  useEffect(() => {
    const openManager = (event: Event) => {
      const detail = (event as CustomEvent<{ workspaceRoot?: string }>).detail;
      if (detail?.workspaceRoot === workspaceRoot) setAgentManagerOpen(true);
    };
    window.addEventListener('coding:manage-agents', openManager);
    return () => window.removeEventListener('coding:manage-agents', openManager);
  }, [workspaceRoot]);
  useEffect(() => {
    const removeData = window.electron.codingAgent.onAuthTerminalData(event => {
      setAuthTerminal(current =>
        current?.id === event.id
          ? { ...current, output: `${current.output}${event.data}` }
          : current,
      );
    });
    const removeExit = window.electron.codingAgent.onAuthTerminalExit(event => {
      setAuthTerminal(current => (current?.id === event.id ? null : current));
      if (event.exitCode !== 0) setError(i18nService.t('codingAgentTerminalAuthenticationFailed'));
    });
    return () => {
      removeData();
      removeExit();
    };
  }, []);

  const activeLane = useMemo(
    () =>
      draftSession
        ? null
        : // Optimistic selection: show the clicked lane immediately instead of
          // waiting for the selectLane IPC round-trip to update activeLaneId.
          (snapshot?.lanes.find(lane => lane.id === selectedLaneId) ??
          snapshot?.lanes.find(lane => lane.id === snapshot.room.activeLaneId) ??
          null),
    [draftSession, selectedLaneId, snapshot],
  );
  const activeProfile = useMemo(
    () =>
      snapshot?.profiles.find(profile =>
        draftSession ? profile.id === draftSession.profileId : profile.id === activeLane?.profileId,
      ) ?? null,
    [activeLane?.profileId, draftSession, snapshot],
  );
  const activeLaneId = activeLane?.id ?? null;
  const activeRemoteSessionId = activeLane?.remoteSessionId ?? null;
  const dispatch = useDispatch();
  const artifactSessionKey = activeLaneId;
  const laneArtifacts = useSelector((state: RootState) =>
    artifactSessionKey ? selectSessionArtifacts(state, artifactSessionKey) : EMPTY_ARTIFACTS,
  );
  const isArtifactPanelOpen = useSelector((state: RootState) =>
    selectIsSessionArtifactPanelOpen(state, artifactSessionKey ?? undefined),
  );
  const artifactLayoutMode = useSelector((state: RootState) =>
    selectSessionArtifactLayoutMode(state, artifactSessionKey ?? undefined),
  );
  // Artifacts detected in coding conversations share the cowork artifact store,
  // keyed by lane id; activate the lane's view whenever the selection changes.
  useEffect(() => {
    dispatch(activateSessionArtifactView(artifactSessionKey));
  }, [artifactSessionKey, dispatch]);
  const artifactRowRef = useRef<HTMLDivElement | null>(null);
  const [artifactPanelMaxWidth, setArtifactPanelMaxWidth] = useState(() =>
    typeof window === 'undefined'
      ? MIN_PANEL_WIDTH
      : resolveArtifactPanelMaxWidth(Math.max(MIN_PANEL_WIDTH, window.innerWidth), MIN_PANEL_WIDTH),
  );
  const updateArtifactPanelMaxWidth = useCallback(() => {
    const contentWidth = artifactRowRef.current?.clientWidth ?? 0;
    if (contentWidth <= 0) return;
    const nextMaxWidth = resolveArtifactPanelMaxWidth(contentWidth, MIN_PANEL_WIDTH);
    setArtifactPanelMaxWidth(prev => (prev === nextMaxWidth ? prev : nextMaxWidth));
  }, []);
  // ResizeObserver must run in useEffect, not useLayoutEffect: a layout-effect
  // setState triggered by our own resize feedback loops into React's nested
  // update limit.
  useEffect(() => {
    updateArtifactPanelMaxWidth();
    const container = artifactRowRef.current;
    const resizeObserver = new ResizeObserver(updateArtifactPanelMaxWidth);
    if (container) resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [activeLaneId, updateArtifactPanelMaxWidth]);
  const activeDriverKind = activeProfile?.driverKind ?? null;
  const activeConfigOptionCount = activeLane?.configOptions.length ?? 0;
  const [draftConfigOptions, setDraftConfigOptions] = useState<CodingAgentConfigOption[]>([]);
  const [draftConfigOverrides, setDraftConfigOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    const needsPrepare =
      activeDriverKind === CodingAgentDriverKind.Acp
        ? !activeRemoteSessionId
        : // Built-in lanes created before config options existed need one
          // prepare pass to populate them.
          activeDriverKind === CodingAgentDriverKind.Builtin && activeConfigOptionCount === 0;
    if (!activeLaneId || !needsPrepare) {
      return;
    }
    let cancelled = false;
    void window.electron.codingAgent
      .prepareLane({ workspaceRoot, laneId: activeLaneId })
      .then(result => {
        if (cancelled) return;
        if (result.success && result.snapshot) setSnapshot(result.snapshot);
        else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
      })
      .catch(() => {
        if (!cancelled) setError(i18nService.t('codingAgentActionFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [activeDriverKind, activeLaneId, activeRemoteSessionId, activeConfigOptionCount, workspaceRoot]);
  // A draft has no lane yet, so fetch the default config options of its
  // profile to show model/thinking controls before the session exists.
  const draftProfileId = draftSession?.profileId ?? null;
  useEffect(() => {
    setDraftConfigOverrides({});
    if (!draftProfileId || activeDriverKind !== CodingAgentDriverKind.Builtin) {
      setDraftConfigOptions([]);
      return;
    }
    let cancelled = false;
    void window.electron.codingAgent
      .getProfileConfigOptions(draftProfileId)
      .then(result => {
        if (!cancelled && result.success) setDraftConfigOptions(result.configOptions ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [draftSession?.id, draftProfileId, activeDriverKind]);
  const activeEvents = useMemo(
    () =>
      activeLane ? (snapshot?.events.filter(event => event.laneId === activeLane.id) ?? []) : [],
    [activeLane, snapshot],
  );
  const activeMissionLanes = useMemo(
    () =>
      activeLane
        ? (snapshot?.lanes.filter(lane => lane.missionId === activeLane.missionId) ?? [])
        : [],
    [activeLane, snapshot],
  );
  const hasInspectorContent = useMemo(
    () =>
      activeEvents.some(
        event =>
          event.kind === CodingEventKind.FileChange || event.kind === CodingEventKind.Terminal,
      ),
    [activeEvents],
  );
  const gitSourceRoot =
    draftSession?.sourceRoot ??
    activeLane?.sourceRoot ??
    snapshot?.room.workspaceRoot ??
    workspaceRoot;
  const gitRefreshKey = `${activeLane?.id ?? draftSession?.id ?? 'workspace'}:${activeLane?.status ?? 'draft'}:${activeEvents.length}`;
  const desktopSidePanelOpen =
    sidePanelView === CodingSidePanelView.Git ||
    (sidePanelView === CodingSidePanelView.Inspector && hasInspectorContent);
  const activePermission = useMemo(
    () =>
      activeLane?.status === CodingLaneStatus.WaitingApproval
        ? (activeEvents
            .slice()
            .reverse()
            .find(event => event.kind === CodingEventKind.Permission) ?? null)
        : null,
    [activeEvents, activeLane?.status],
  );
  const recoveryLane =
    activeLane?.pendingRecoveryPrompt && activeLane.pendingRecoveryContext ? activeLane : null;

  // The activeLane object is re-created on every streamed snapshot update, so
  // an effect keyed on it would re-assign viewport.scrollTop on each streamed
  // event — overriding the stick-to-bottom auto-scroll and making the viewport
  // jump away from the latest message. Restore the saved scroll position only
  // when the lane id actually changes (lane switch or initial load).
  const activeLaneSnapshotRef = useRef(activeLane);
  activeLaneSnapshotRef.current = activeLane;
  const restoredScrollLaneRef = useRef<string | null>(null);
  useEffect(() => {
    const lane = activeLaneSnapshotRef.current;
    if (!lane) return;
    if (restoredScrollLaneRef.current === lane.id) return;
    restoredScrollLaneRef.current = lane.id;
    const frame = requestAnimationFrame(() => {
      const viewport = eventStreamRef.current?.querySelector<HTMLElement>(
        '.coding-conversation-scroll',
      );
      if (viewport) viewport.scrollTop = lane.scrollPosition;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeLane?.id]);

  useEffect(() => {
    setSidePanelView(current => (current === CodingSidePanelView.Inspector ? null : current));
    setInspectorSheetOpen(false);
    setGitSheetOpen(false);
  }, [activeLane?.id]);

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
    [workspaceRoot],
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

  const discoverAgents = async (): Promise<boolean> => {
    const result = await window.electron.codingAgent.discoverAgents({ workspaceRoot });
    if (result.success && result.snapshot) {
      setSnapshot(result.snapshot);
      if (activeLane?.status === CodingLaneStatus.Running)
        void codingQueue.load(
          activeProfile?.driverKind === CodingAgentDriverKind.Acp
            ? activeLane.id
            : activeLane.localSessionId,
        );
      return true;
    }
    setError(result.error ?? i18nService.t('codingAgentActionFailed'));
    return false;
  };
  const probeAgent = async (profileId: string): Promise<boolean> => {
    const result = await window.electron.codingAgent.probeAgent({ workspaceRoot, profileId });
    if (result.success && result.snapshot) {
      setSnapshot(result.snapshot);
      if (activeProfile?.driverKind === CodingAgentDriverKind.Acp && activeLane) {
        void codingQueue.load(activeLane.id);
      }
      return true;
    }
    setError(result.error ?? i18nService.t('codingAgentActionFailed'));
    return false;
  };
  const addProfile = async (
    profile: import('../../../shared/codingAgent').AddCodingAgentProfileInput,
  ): Promise<boolean> => {
    const result = await window.electron.codingAgent.addProfile({ workspaceRoot, profile });
    if (result.success && result.snapshot) {
      setSnapshot(result.snapshot);
      return true;
    }
    setError(result.error ?? i18nService.t('codingAgentActionFailed'));
    return false;
  };
  const trustProfile = async (profileId: string): Promise<boolean> => {
    const result = await window.electron.codingAgent.trustProfile({ workspaceRoot, profileId });
    if (result.success && result.snapshot) {
      setSnapshot(result.snapshot);
      return true;
    }
    setError(result.error ?? i18nService.t('codingAgentActionFailed'));
    return false;
  };
  const authenticateProfile = async (profileId: string, methodId: string): Promise<boolean> => {
    const result = await window.electron.codingAgent.authenticateProfile({
      workspaceRoot,
      profileId,
      methodId,
    });
    if (result.success && result.snapshot) {
      setSnapshot(result.snapshot);
      return true;
    }
    setError(result.error ?? i18nService.t('codingAgentActionFailed'));
    return false;
  };
  const startTerminalAuthentication = async (
    profileId: string,
    methodId: string,
  ): Promise<boolean> => {
    const result = await window.electron.codingAgent.startAuthTerminal({
      workspaceRoot,
      profileId,
      methodId,
    });
    if (result.success && result.terminal) {
      setAuthTerminal({ ...result.terminal, output: '' });
      setAuthTerminalInput('');
      return true;
    }
    setError(result.error ?? i18nService.t('codingAgentActionFailed'));
    return false;
  };
  const submitAuthTerminalInput = () => {
    if (!authTerminal) return;
    void window.electron.codingAgent.writeAuthTerminal({
      id: authTerminal.id,
      data: `${authTerminalInput}\r`,
    });
    setAuthTerminalInput('');
  };
  const respondToPermission = async (outcome: CodingPermissionOutcome, optionId?: string) => {
    if (!activePermission || typeof activePermission.payload.requestId !== 'string') return;
    const result = await window.electron.codingAgent.respondPermission({
      workspaceRoot,
      response: { requestId: activePermission.payload.requestId, outcome, optionId },
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
  };
  const sendPrompt = async (delivery?: 'followUp' | 'steer') => {
    if (!prompt.trim()) return;
    if (draftSession) {
      setError(null);
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
        ...(Object.keys(draftConfigOverrides).length > 0
          ? { configOptionOverrides: draftConfigOverrides }
          : {}),
      });
      const laneId = result.snapshot?.room.activeLaneId;
      if (result.success && result.snapshot && laneId) {
        setSnapshot(result.snapshot);
        setNewSessionDraftState({ id: '', value: '' });
        onSessionCreated(laneId);
      } else {
        setError(result.error ?? i18nService.t('codingSessionCreateFailed'));
      }
      return;
    }
    if (!activeLane) return;
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    const result = await window.electron.codingAgent.prompt({
      workspaceRoot,
      prompt: { laneId: activeLane.id, prompt, delivery },
    });
    if (result.success && result.snapshot) {
      setDraftState({ laneId: activeLane.id, value: '' });
      void window.electron.codingAgent.saveLaneView({
        workspaceRoot,
        view: { laneId: activeLane.id, draft: '', scrollPosition: activeLane.scrollPosition },
      });
      setSnapshot(result.snapshot);
    } else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
  };
  const confirmSessionRecovery = async (includeRecoveryContext: boolean) => {
    if (!recoveryLane) return;
    const result = await window.electron.codingAgent.confirmSessionRecovery({
      workspaceRoot,
      laneId: recoveryLane.id,
      includeRecoveryContext,
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
  };
  const cancel = async () => {
    if (!activeLane) return;
    const result = await window.electron.codingAgent.cancel({
      workspaceRoot,
      laneId: activeLane.id,
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
  };
  const setLaneConfigOption = async (configId: string, value: string | boolean) => {
    if (!activeLane) return;
    const result = await window.electron.codingAgent.setLaneConfigOption({
      workspaceRoot,
      option: { laneId: activeLane.id, configId, value },
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
  };
  const setLaneModel = async (modelRef: string) => {
    if (!activeLane) return;
    const result = await window.electron.codingAgent.setLaneModelOverride({
      workspaceRoot,
      laneId: activeLane.id,
      modelOverride: modelRef,
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
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
    setError(result.error ?? i18nService.t('codingAgentActionFailed'));
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
      setApplyConflict(result.error ?? i18nService.t('codingAgentActionFailed'));
      return;
    }
    setError(result.error ?? i18nService.t('codingAgentActionFailed'));
  };
  const selectLane = async (laneId: string) => {
    const result = await window.electron.codingAgent.selectLane({ workspaceRoot, laneId });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
    if (result.success) onLaneSelected(laneId);
  };

  if (!workspaceRoot)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {i18nService.t('codingAgentSelectWorkspace')}
      </div>
    );
  if (!snapshot)
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {i18nService.t('codingAgentLoading')}
      </div>
    );

  return (
    <div
      className={cn(
        'grid h-full min-h-0 bg-background',
        desktopSidePanelOpen ? 'grid-cols-[minmax(0,1fr)_360px] max-lg:grid-cols-1' : 'grid-cols-1',
      )}
    >
      <main className="flex min-h-0 flex-col">
        <CodingAuthAndPermissionDialogs
          authTerminal={authTerminal}
          authTerminalInput={authTerminalInput}
          permission={activePermission}
          profile={activeProfile}
          onAuthTerminalInputChange={setAuthTerminalInput}
          onCancelAuthTerminal={id => void window.electron.codingAgent.cancelAuthTerminal(id)}
          onSubmitAuthTerminalInput={submitAuthTerminalInput}
          onRespondToPermission={(outcome, optionId) => void respondToPermission(outcome, optionId)}
        />
        <CodingAgentManager
          open={agentManagerOpen}
          onOpenChange={setAgentManagerOpen}
          profiles={snapshot.profiles.filter(profile => !profile.isBuiltin)}
          onDiscover={discoverAgents}
          onProbe={probeAgent}
          onAddProfile={addProfile}
          onTrust={trustProfile}
          onAuthenticate={authenticateProfile}
          onTerminalAuthenticate={startTerminalAuthentication}
        />
        {recoveryLane && (
          <Dialog open>
            <DialogContent showCloseButton={false}>
              <DialogHeader>
                <DialogTitle>{i18nService.t('codingAgentRecoveryTitle')}</DialogTitle>
                <DialogDescription>
                  {i18nService.t('codingAgentRecoveryDescription')}
                </DialogDescription>
              </DialogHeader>
              <pre className="max-h-52 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
                {recoveryLane.pendingRecoveryContext}
              </pre>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void confirmSessionRecovery(false)}
                >
                  {i18nService.t('codingAgentRecoveryStartFresh')}
                </Button>
                <Button type="button" onClick={() => void confirmSessionRecovery(true)}>
                  {i18nService.t('codingAgentRecoverySendSummary')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {activeLane && laneChangePreview !== null && (
          <Dialog open onOpenChange={open => !open && setLaneChangePreview(null)}>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>{i18nService.t('codingAgentApplyChangesTitle')}</DialogTitle>
                <DialogDescription>
                  {i18nService.t('codingAgentApplyChangesDescription')}
                </DialogDescription>
              </DialogHeader>
              <pre className="max-h-[50dvh] overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
                {laneChangePreview || i18nService.t('codingAgentNoChanges')}
              </pre>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setLaneChangePreview(null)}>
                  {i18nService.t('codingAgentHandoffCancel')}
                </Button>
                <Button
                  type="button"
                  disabled={!laneChangePreview.trim()}
                  onClick={applyLaneChanges}
                >
                  {i18nService.t('codingAgentApplyChangesConfirm')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        {applyConflict && (
          <Dialog open onOpenChange={open => !open && setApplyConflict(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{i18nService.t('codingAgentConflictTitle')}</DialogTitle>
                <DialogDescription>
                  {i18nService.t('codingAgentConflictDescription')}
                </DialogDescription>
              </DialogHeader>
              <div>
                <p className="mb-2 text-sm font-medium">
                  {i18nService.t('codingAgentConflictDetails')}
                </p>
                <pre className="max-h-52 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
                  {applyConflict}
                </pre>
              </div>
              <DialogFooter>
                <Button type="button" onClick={() => setApplyConflict(null)}>
                  {i18nService.t('codingAgentConflictClose')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
        <PageHeader
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
          leftContent={
            <>
            <span className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <FolderGit2 className="size-4 shrink-0" />
              <span className="truncate">{snapshot.room.name}</span>
            </span>
            <CodingParticipants
              activeLaneId={activeLane?.id ?? null}
              lanes={activeMissionLanes}
              profiles={snapshot.profiles}
              onSelect={laneId => void selectLane(laneId)}
            />
            {activeProfile && (
              <Badge variant="secondary" className="shrink-0">
                {profileStatusText(activeProfile.status)}
              </Badge>
            )}
            </>
          }
          actions={
            <>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={i18nService.t('codingAgentManageAgents')}
              onClick={() => setAgentManagerOpen(true)}
            >
              <Settings2 />
            </Button>
            {artifactSessionKey && laneArtifacts.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={i18nService.t('codingAgentArtifacts')}
                aria-pressed={isArtifactPanelOpen}
                onClick={() => dispatch(togglePanel())}
              >
                <Layers className="mr-1 size-4" />
                {i18nService.t('codingAgentArtifacts')}
                <Badge variant="secondary">{laneArtifacts.length}</Badge>
              </Button>
            )}
            {activeLane && activeLane.executionRoot !== activeLane.sourceRoot && (
              <Button size="sm" variant="outline" onClick={() => void previewLaneChanges()}>
                <FileDiff className="mr-1 size-4" />
                {i18nService.t('codingAgentReviewChanges')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="max-lg:hidden"
              aria-label={i18nService.t('codingGitPanel')}
              aria-pressed={sidePanelView === CodingSidePanelView.Git}
              onClick={() =>
                setSidePanelView(current =>
                  current === CodingSidePanelView.Git ? null : CodingSidePanelView.Git,
                )
              }
            >
              <GitBranch />
            </Button>
            <Sheet open={gitSheetOpen} onOpenChange={setGitSheetOpen}>
              <SheetTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="lg:hidden"
                    aria-label={i18nService.t('codingGitPanel')}
                  />
                }
              >
                <GitBranch />
              </SheetTrigger>
              <SheetContent side="bottom" className="h-[80dvh] p-0">
                <SheetHeader className="sr-only">
                  <SheetTitle>{i18nService.t('codingGitPanel')}</SheetTitle>
                </SheetHeader>
                <CodingGitPanel
                  workspaceRoot={workspaceRoot}
                  laneId={activeLane?.id ?? null}
                  sourceRoot={gitSourceRoot}
                  refreshKey={gitRefreshKey}
                />
              </SheetContent>
            </Sheet>
            {hasInspectorContent && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="max-lg:hidden"
                  aria-label={i18nService.t('codingAgentInspector')}
                  aria-pressed={sidePanelView === CodingSidePanelView.Inspector}
                  onClick={() =>
                    setSidePanelView(current =>
                      current === CodingSidePanelView.Inspector
                        ? null
                        : CodingSidePanelView.Inspector,
                    )
                  }
                >
                  <PanelRight />
                </Button>
                <Sheet open={inspectorSheetOpen} onOpenChange={setInspectorSheetOpen}>
                  <SheetTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="lg:hidden"
                        aria-label={i18nService.t('codingAgentInspector')}
                      >
                        <PanelRight />
                      </Button>
                    }
                  />
                  <SheetContent side="bottom" className="h-[70dvh] p-0">
                    <SheetHeader>
                      <SheetTitle>{i18nService.t('codingAgentInspector')}</SheetTitle>
                    </SheetHeader>
                    <div className="min-h-0 flex-1">
                      <CodingInspector events={activeEvents} />
                    </div>
                  </SheetContent>
                </Sheet>
              </>
            )}
            </>
          }
        />
        <div ref={artifactRowRef} className="flex min-h-0 flex-1">
          <CodingEventStream
            events={activeEvents}
            isStreaming={activeLane?.status === CodingLaneStatus.Running}
            emptyDescription={
              draftSession ? i18nService.t('codingSessionDraftDescription') : undefined
            }
            scrollAreaRef={eventStreamRef}
            artifactSessionKey={artifactSessionKey}
            artifactBaseDir={activeLane?.executionRoot ?? null}
            onScrollPositionChange={scrollPosition => {
              if (activeLane) saveScrollPosition(activeLane.id, scrollPosition);
            }}
          />
          {artifactSessionKey && isArtifactPanelOpen && (
            <ArtifactPanelErrorBoundary onClose={() => dispatch(closePanel())}>
              <Suspense fallback={null}>
                <ArtifactPanelFrame
                  sessionId={artifactSessionKey}
                  artifacts={laneArtifacts}
                  isOpen={isArtifactPanelOpen}
                  isVisible
                  isTransitioning={false}
                  layoutMode={artifactLayoutMode}
                  minPanelWidth={MIN_PANEL_WIDTH}
                  maxPanelWidth={artifactPanelMaxWidth}
                />
              </Suspense>
            </ArtifactPanelErrorBoundary>
          )}
        </div>
        <CodingComposer
          availableCommands={activeLane?.availableCommands ?? []}
          configOptions={activeLane ? activeLane.configOptions : draftConfigOptions}
          disabled={
            draftSession
              ? !draftSession.profileId || !draftSession.sourceRoot
              : !activeLane || activeLane.status === CodingLaneStatus.WaitingApproval
          }
          isRunning={activeLane?.status === CodingLaneStatus.Running}
          prompt={prompt}
          recipientName={activeProfile?.name ?? i18nService.t('codingAgentChooseAgent')}
          showRecipient={!draftSession}
          sessionId={
            activeProfile?.driverKind === CodingAgentDriverKind.Acp
              ? activeLane?.id
              : activeProfile?.driverKind === CodingAgentDriverKind.Builtin
                ? activeLane?.localSessionId
                : undefined
          }
          queueService={
            activeProfile?.driverKind === CodingAgentDriverKind.Acp ? codingQueue : undefined
          }
          leadingTools={
            draftSession ? (
              <CodingDraftControls
                draft={draftSession}
                profiles={snapshot.profiles}
                sources={draftSession.sources}
                onChange={onDraftSessionChange}
              />
            ) : activeProfile?.driverKind === CodingAgentDriverKind.Builtin && activeLane ? (
              <CoworkModelPicker
                models={availableModels}
                selectedModel={
                  (activeLane.modelOverride
                    ? resolveAgentModelRef(activeLane.modelOverride, availableModels)
                    : null) ??
                  defaultSelectedModel ??
                  null
                }
                open={modelPickerOpen}
                onOpenChange={setModelPickerOpen}
                onSelect={model => void setLaneModel(toAgentModelRef(model))}
              />
            ) : undefined
          }
          onChange={next => {
            if (draftSession) {
              setNewSessionDraftState({ id: draftSession.id, value: next });
            } else if (activeLane) {
              setDraftState({ laneId: activeLane.id, value: next });
              saveDraft(activeLane.id, next);
            }
          }}
          onConfigOptionChange={(optionId, value) => void changeConfigOption(optionId, value)}
          supportsSteerShortcut={activeProfile?.driverKind === CodingAgentDriverKind.Builtin}
          onSend={() => void sendPrompt()}
          onSteer={() => void sendPrompt('steer')}
          onStop={() => void cancel()}
        />
        {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
      </main>
      {desktopSidePanelOpen && (
        <aside className="min-h-0 border-l border-border-subtle max-lg:hidden">
          {sidePanelView === CodingSidePanelView.Git ? (
            <CodingGitPanel
              workspaceRoot={workspaceRoot}
              laneId={activeLane?.id ?? null}
              sourceRoot={gitSourceRoot}
              refreshKey={gitRefreshKey}
              onClose={() => setSidePanelView(null)}
            />
          ) : (
            <CodingInspector events={activeEvents} />
          )}
        </aside>
      )}
    </div>
  );
};

const thisScrollPosition = (root: HTMLDivElement | null): number =>
  root?.querySelector<HTMLElement>('.coding-conversation-scroll')?.scrollTop ?? 0;
