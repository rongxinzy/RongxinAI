import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { FileDiff, PanelRight } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type { CodingAgentProfile, CodingPromptAttachment } from '../../../shared/codingAgent';
import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingElicitationStatus,
  CodingEventKind,
  CodingLaneStatus,
} from '../../../shared/codingAgent';
import { showAppError } from '../../services/appToast';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { MIN_PANEL_WIDTH } from '../../store/slices/artifactSlice';
import { toAgentModelRef, resolveAgentModelRef } from '../../utils/agentModelRef';
import { LogoLoadingState } from '../LogoLoadingState';
import PageHeader from '../PageHeader';
import { ArtifactPanelErrorBoundary } from '../artifacts/ArtifactPanelErrorBoundary';
import { CoworkModelPicker } from '../cowork/CoworkModelPicker';
import { CodingAgentManager } from './CodingAgentManager';
import { CodingAuthTerminalDialog } from './CodingAuthTerminalDialog';
import { CodingComposer } from './CodingComposer';
import { CodingEventStream } from './CodingEventStream';
import { CodingGitQuickActions } from './CodingGitQuickActions';
import { CodingParticipants } from './CodingParticipants';
import { CodingPermissionOverlay } from './CodingPermissionOverlay';
import { CodingSessionSetupDialog } from './CodingSessionSetupDialog';
import type { CodingSessionDraft, CodingSidebarSelection } from './CodingWorkspaceSidebar';
import {
  CodingApplyConflictDialog,
  CodingLaneChangesDialog,
  CodingSessionRecoveryDialog,
} from './codingWorkbenchDialogs';
import { CodingSidePanelBottomSheet, CodingSidePanelFrame } from './codingWorkbenchSidePanel';
import { CodingAgentStatusI18nKey, CodingSidePanelView } from './constants';
import { findPendingCodingPermission } from './codingPermission';
import { useCodingAgentManager } from './useCodingAgentManager';
import { useCodingArtifactPanel } from './useCodingArtifactPanel';
import { useCodingAuthTerminal } from './useCodingAuthTerminal';
import { useCodingConversationDraft } from './useCodingConversationDraft';
import { useCodingDraftSessionControls } from './useCodingDraftSessionControls';
import { useCodingEventHistory } from './useCodingEventHistory';
import { useCodingRoomSnapshot } from './useCodingRoomSnapshot';
import { useCodingSessionSetup } from './useCodingSessionSetup';
import { useCodingSidePanelController } from './useCodingSidePanelController';
import {
  useCodingLaneActions,
  useCodingLanePreparation,
  useCodingProfileActions,
  useCodingPromptSubmit,
} from './useCodingWorkbenchActions';
import { useTurnFailureToast } from './useTurnFailureToast';
import { createCodingQueueService } from '../../services/codingQueue';

const profileStatusText = (status: CodingAgentProfileStatus): string =>
  i18nService.t(CodingAgentStatusI18nKey[status]);

const ArtifactPanelFrame = lazy(() =>
  import('../artifacts').then(module => ({ default: module.ArtifactPanelFrame })),
);

interface CodingWorkbenchViewProps {
  workspaceRoot: string;
  selectedLaneId: string | null;
  draftSession: CodingSessionDraft | null;
  onSessionDraftCreated: (selection: CodingSidebarSelection) => void;
  onSessionCreated: (laneId: string) => void;
  onLaneSelected: (laneId: string) => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebar?: () => void;
}

export const CodingWorkbenchView = ({
  workspaceRoot,
  selectedLaneId,
  draftSession,
  onSessionDraftCreated,
  onSessionCreated,
  onLaneSelected,
  isSidebarCollapsed = false,
  onToggleSidebar,
}: CodingWorkbenchViewProps) => {
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0);
  const [promptAttachments, setPromptAttachments] = useState<CodingPromptAttachment[]>([]);
  const { snapshot, setSnapshot, bootstrapError, isCurrentWorkspace } = useCodingRoomSnapshot(
    workspaceRoot,
    selectedLaneId,
    bootstrapAttempt,
    showAppError,
  );
  const codingQueue = useMemo(() => createCodingQueueService(workspaceRoot), [workspaceRoot]);
  const [gitRefreshVersion, setGitRefreshVersion] = useState(0);
  const [isNarrowViewport, setIsNarrowViewport] = useState(() => window.innerWidth < 1024);
  const [laneChangePreview, setLaneChangePreview] = useState<string | null>(null);
  const [applyConflict, setApplyConflict] = useState<string | null>(null);
  const { authTerminal, authTerminalInput, setAuthTerminalInput, submitAuthTerminalInput } =
    useCodingAuthTerminal();
  const [agentManagerOpen, setAgentManagerOpen] = useCodingAgentManager();
  const [managerProfiles, setManagerProfiles] = useState<CodingAgentProfile[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const defaultSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const eventStreamRef = useRef<HTMLDivElement | null>(null);
  const workbenchRef = useRef<HTMLDivElement | null>(null);
  const sidePanelFrameRef = useRef<HTMLElement | null>(null);
  const selectionKey = `${workspaceRoot}:${selectedLaneId ?? ''}:${draftSession?.id ?? ''}`;
  useEffect(() => {
    setPromptAttachments([]);
  }, [selectionKey]);
  const { sessionSetupWorkspace, closeSessionSetup, submitSessionSetup } = useCodingSessionSetup({
    selectionKey,
    onSessionDraftCreated,
  });

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
  const agentNeedsProbe =
    Boolean(activeProfile) &&
    !activeProfile?.isBuiltin &&
    activeProfile?.status === CodingAgentProfileStatus.Detected;
  const activeLaneId = activeLane?.id ?? null;
  const activeRemoteSessionId = activeLane?.remoteSessionId ?? null;
  const {
    artifactLayoutMode,
    artifactPanelMaxWidth,
    artifactRowRef,
    artifactSessionKey,
    closeArtifactPanel,
    isArtifactPanelOpen,
    laneArtifacts,
  } = useCodingArtifactPanel(activeLaneId);
  const activeDriverKind = activeProfile?.driverKind ?? null;
  useCodingLanePreparation({
    workspaceRoot,
    activeLaneId,
    activeRemoteSessionId,
    activeDriverKind,
    setSnapshot,
  });
  const draftProfileId = draftSession?.profileId ?? null;
  const {
    draftAvailableCommands,
    draftConfigOptions,
    draftConfigOverrides,
    setDraftConfigOptions,
    setDraftConfigOverrides,
  } = useCodingDraftSessionControls({
    draftSessionId: draftSession?.id,
    draftProfileId,
    activeDriverKind,
  });
  const activeEvents = useMemo(
    () =>
      activeLane ? (snapshot?.events.filter(event => event.laneId === activeLane.id) ?? []) : [],
    [activeLane, snapshot],
  );
  const { loadOlderEvents } = useCodingEventHistory({
    workspaceRoot,
    snapshot,
    activeLane,
    setSnapshot,
    eventStreamRef,
  });
  // All lanes, not only the selected one: a turn that fails in the background must
  // still reach the user.
  useTurnFailureToast(snapshot?.events ?? []);
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
  // Refresh the git panels on lane switch and turn status change only; keying
  // on the event count would rerun `git status` on every streamed chunk.
  const gitRefreshKey = `${activeLane?.id ?? draftSession?.id ?? 'workspace'}:${activeLane?.status ?? 'draft'}:${gitRefreshVersion}`;
  const {
    applySidePanelFrameWidth,
    closeSidePanelTab,
    completeSidePanelClose,
    completeSidePanelResize,
    isSidePanelClosing,
    isSidePanelEntering,
    isSidePanelPresent,
    isSidePanelResizing,
    openSidePanelTab,
    renderedSidePanelWidth,
    requestHideSidePanel,
    resolvedSidePanelWidth,
    restoreSidePanel,
    setIsSidePanelResizing,
    setSidePanelExpanded,
    setSidePanelSheetOpen,
    sidePanelExpanded,
    sidePanelHidden,
    sidePanelMaxWidth,
    sidePanelSheetOpen,
    sidePanelView,
    visibleSidePanelTabs,
  } = useCodingSidePanelController({
    containerRef: workbenchRef,
    isNarrowViewport,
    resetKey: activeLaneId,
  });
  const desktopSidePanelOpen =
    !isNarrowViewport &&
    !sidePanelHidden &&
    sidePanelView !== null &&
    (sidePanelView !== CodingSidePanelView.Inspector || hasInspectorContent);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const syncViewport = () => setIsNarrowViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);
  const activePermission = useMemo(() => {
    const waitingLaneIds = new Set(
      (snapshot?.lanes ?? [])
        .filter(lane => lane.status === CodingLaneStatus.WaitingApproval)
        .map(lane => lane.id),
    );
    if (waitingLaneIds.size === 0) return null;
    if (activeLane && waitingLaneIds.has(activeLane.id)) {
      const selectedPermission = findPendingCodingPermission(activeEvents);
      if (selectedPermission) return selectedPermission;
    }
    const waitingEvents = snapshot?.events.filter(event => waitingLaneIds.has(event.laneId)) ?? [];
    return findPendingCodingPermission(waitingEvents);
  }, [activeEvents, activeLane, snapshot]);
  const recoveryLane =
    activeLane?.pendingRecoveryPrompt && activeLane.pendingRecoveryContext ? activeLane : null;
  const activeElicitation = useMemo(
    () =>
      activeLane?.status === CodingLaneStatus.WaitingElicitation
        ? (snapshot?.elicitations.find(
            elicitation =>
              elicitation.laneId === activeLane.id &&
              elicitation.status === CodingElicitationStatus.Pending,
          ) ?? null)
        : null,
    [activeLane?.id, activeLane?.status, snapshot?.elicitations],
  );

  const {
    clearPendingDraftSave,
    composerFocusRequestKey,
    prompt,
    reEditUserMessage,
    saveDraft,
    saveScrollPosition,
    setDraftState,
    setNewSessionDraftState,
  } = useCodingConversationDraft({
    workspaceRoot,
    activeLane,
    draftSession,
    eventStreamRef,
    onClearAttachments: () => setPromptAttachments([]),
  });

  const { addProfile, discoverAgents, probeAgent, trustProfile } = useCodingProfileActions({
    workspaceRoot,
    activeLane,
    activeProfile,
    codingQueue,
    setSnapshot,
    setManagerProfiles,
  });
  const {
    applyLaneChanges,
    cancel,
    cancelElicitation,
    changeConfigOption,
    confirmSessionRecovery,
    previewLaneChanges,
    respondElicitation,
    respondToPermission,
    selectLane,
    setLaneModel,
  } = useCodingLaneActions({
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
  });
  const { isSubmitting, sendPrompt } = useCodingPromptSubmit({
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
  });

  // Agent profiles are global configuration, so the manager loads them without
  // depending on the workspace snapshot (there may be no workspace yet, or the
  // room may still be loading or have failed to load).
  const refreshManagerProfiles = useCallback(async () => {
    const result = await window.electron.codingAgent.listProfiles();
    if (result.success && result.profiles) setManagerProfiles(result.profiles);
  }, []);
  useEffect(() => {
    if (!agentManagerOpen) return;
    void refreshManagerProfiles();
  }, [agentManagerOpen, refreshManagerProfiles]);
  useEffect(() => {
    if (snapshot) setManagerProfiles(snapshot.profiles);
  }, [snapshot]);

  const agentManagerElement = (
    <CodingAgentManager
      open={agentManagerOpen}
      onOpenChange={setAgentManagerOpen}
      profiles={managerProfiles.filter(profile => !profile.isBuiltin)}
      onDiscover={discoverAgents}
      onProbe={probeAgent}
      onAddProfile={addProfile}
      onTrust={trustProfile}
    />
  );

  if (!workspaceRoot)
    return (
      <>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {i18nService.t('codingAgentSelectWorkspace')}
        </div>
        {agentManagerElement}
      </>
    );
  if (!snapshot)
    return (
      <>
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {bootstrapError ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p>{bootstrapError}</p>
              <Button
                type="button"
                variant="outline"
                onClick={() => setBootstrapAttempt(attempt => attempt + 1)}
              >
                {i18nService.t('retry')}
              </Button>
            </div>
          ) : (
            <LogoLoadingState label={i18nService.t('codingAgentLoading')} />
          )}
        </div>
        {agentManagerElement}
      </>
    );

  return (
    <div data-page-canvas className="flex h-full min-h-0 flex-col bg-background">
      <PageHeader
        isSidebarCollapsed={isSidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        leftContent={
          <>
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
            {activeLane && activeLane.executionRoot !== activeLane.sourceRoot && (
              <Button size="sm" variant="outline" onClick={() => void previewLaneChanges()}>
                <FileDiff className="mr-1 size-4" />
                {i18nService.t('codingAgentReviewChanges')}
              </Button>
            )}
          </>
        }
      />
      <div
        ref={workbenchRef}
        className="relative grid min-h-0 min-w-0 flex-1 grid-cols-1"
        style={isSidePanelPresent ? { gridTemplateColumns: 'minmax(0, 1fr) auto' } : undefined}
      >
        <main className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
          <CodingAuthTerminalDialog
            authTerminal={authTerminal}
            authTerminalInput={authTerminalInput}
            onAuthTerminalInputChange={setAuthTerminalInput}
            onCancelAuthTerminal={id => void window.electron.codingAgent.cancelAuthTerminal(id)}
            onSubmitAuthTerminalInput={submitAuthTerminalInput}
          />
          {agentManagerElement}
          {recoveryLane && (
            <CodingSessionRecoveryDialog
              context={recoveryLane.pendingRecoveryContext}
              onConfirm={includeRecoveryContext =>
                void confirmSessionRecovery(includeRecoveryContext)
              }
            />
          )}
          {activeLane && laneChangePreview !== null && (
            <CodingLaneChangesDialog
              diff={laneChangePreview}
              onApply={() => void applyLaneChanges()}
              onClose={() => setLaneChangePreview(null)}
            />
          )}
          {applyConflict && (
            <CodingApplyConflictDialog
              conflict={applyConflict}
              onClose={() => setApplyConflict(null)}
            />
          )}
          <div ref={artifactRowRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <CodingEventStream
              events={activeEvents}
              isStreaming={activeLane?.status === CodingLaneStatus.Running}
              headerActions={
                <>
                  <CodingGitQuickActions
                    target={{
                      workspaceRoot,
                      laneId: activeLane?.id ?? undefined,
                      sourceRoot: gitSourceRoot,
                    }}
                    refreshKey={gitRefreshKey}
                    onOpenReview={() => {
                      openSidePanelTab(CodingSidePanelView.Review);
                      if (window.innerWidth < 1024) setSidePanelSheetOpen(true);
                    }}
                  />
                  {!desktopSidePanelOpen && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={i18nService.t('codingAgentSidePanel')}
                      aria-pressed={false}
                      onClick={() => {
                        restoreSidePanel();
                        if (window.innerWidth < 1024) setSidePanelSheetOpen(true);
                      }}
                    >
                      <PanelRight />
                    </Button>
                  )}
                </>
              }
              emptyDescription={
                draftSession ? i18nService.t('codingSessionDraftDescription') : undefined
              }
              scrollAreaRef={eventStreamRef}
              artifactSessionKey={artifactSessionKey}
              artifactBaseDir={activeLane?.executionRoot ?? null}
              elicitation={activeElicitation}
              onRespondElicitation={respondElicitation}
              onCancelElicitation={cancelElicitation}
              onScrollPositionChange={scrollPosition => {
                if (activeLane) saveScrollPosition(activeLane.id, scrollPosition);
              }}
              onLoadOlderEvents={loadOlderEvents}
              onReEditUserMessage={reEditUserMessage}
            />
            {artifactSessionKey && isArtifactPanelOpen && (
              <ArtifactPanelErrorBoundary onClose={closeArtifactPanel}>
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
          <div className="relative shrink-0">
            <CodingComposer
              availableCommands={activeLane ? activeLane.availableCommands : draftAvailableCommands}
              configOptions={activeLane ? activeLane.configOptions : draftConfigOptions}
              disabled={
                draftSession
                  ? !draftSession.profileId ||
                    !draftSession.sourceRoot ||
                    activeProfile?.status !== CodingAgentProfileStatus.Ready
                  : !activeLane ||
                    activeLane.status === CodingLaneStatus.WaitingApproval ||
                    activeLane.status === CodingLaneStatus.WaitingElicitation
              }
              isRunning={activeLane?.status === CodingLaneStatus.Running}
              isSubmitting={isSubmitting}
              prompt={prompt}
              focusRequestKey={composerFocusRequestKey}
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
              attachments={promptAttachments}
              canAttachFiles={
                activeProfile?.driverKind === CodingAgentDriverKind.Acp &&
                activeProfile.status === CodingAgentProfileStatus.Ready
              }
              leadingTools={
                activeProfile?.driverKind === CodingAgentDriverKind.Builtin && activeLane ? (
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
              statusNotice={
                agentNeedsProbe ? (
                  <div className="flex items-center gap-2 px-1 pb-2 text-xs text-muted-foreground">
                    <span>{i18nService.t('codingAgentProbeRequired')}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="theme-control-sizing-8"
                      onClick={() => activeProfile && void probeAgent(activeProfile.id)}
                    >
                      {i18nService.t('codingAgentProbeAgent')}
                    </Button>
                  </div>
                ) : null
              }
              onChange={next => {
                if (draftSession) {
                  setNewSessionDraftState({ id: draftSession.id, value: next });
                } else if (activeLane) {
                  setDraftState({ laneId: activeLane.id, value: next });
                  saveDraft(activeLane.id, next);
                }
              }}
              onAddAttachments={() => {
                void window.electron.dialog
                  .selectFiles({ title: i18nService.t('codingAttachmentAdd') })
                  .then(result => {
                    if (!result.success || result.paths.length === 0) return;
                    setPromptAttachments(current => {
                      const existingPaths = new Set(current.map(attachment => attachment.path));
                      return [
                        ...current,
                        ...result.paths
                          .filter(filePath => !existingPaths.has(filePath))
                          .map(filePath => ({
                            path: filePath,
                            name: filePath.split(/[/\\\\]/).at(-1) ?? filePath,
                          })),
                      ].slice(0, 8);
                    });
                  });
              }}
              onRemoveAttachment={filePath =>
                setPromptAttachments(current =>
                  current.filter(attachment => attachment.path !== filePath),
                )
              }
              onConfigOptionChange={(optionId, value) => void changeConfigOption(optionId, value)}
              supportsSteerShortcut={activeProfile?.driverKind === CodingAgentDriverKind.Builtin}
              onSend={() => void sendPrompt()}
              onSteer={() => void sendPrompt('steer')}
              onStop={() => void cancel()}
            />
            <CodingPermissionOverlay
              permission={activePermission}
              onRespond={respondToPermission}
            />
          </div>
          {sessionSetupWorkspace ? (
            <CodingSessionSetupDialog
              workspace={sessionSetupWorkspace}
              profiles={snapshot.profiles}
              onCancel={closeSessionSetup}
              onManageAgents={() => setAgentManagerOpen(true)}
              onSubmit={input => submitSessionSetup(sessionSetupWorkspace, input)}
            />
          ) : null}
        </main>
        {isSidePanelPresent && (
          <CodingSidePanelFrame
            frameRef={sidePanelFrameRef}
            desktopOpen={desktopSidePanelOpen}
            view={sidePanelView}
            tabs={visibleSidePanelTabs}
            width={resolvedSidePanelWidth}
            renderedWidth={renderedSidePanelWidth}
            maxWidth={sidePanelMaxWidth}
            expanded={sidePanelExpanded}
            isEntering={isSidePanelEntering}
            isClosing={isSidePanelClosing}
            isResizing={isSidePanelResizing}
            workspaceRoot={workspaceRoot}
            sourceRoot={gitSourceRoot}
            laneId={activeLane?.id ?? null}
            refreshKey={gitRefreshKey}
            events={activeEvents}
            hasInspectorContent={hasInspectorContent}
            onOpenTab={openSidePanelTab}
            onCloseTab={closeSidePanelTab}
            onToggleExpanded={() => setSidePanelExpanded(current => !current)}
            onRequestHide={requestHideSidePanel}
            onResizeFrame={applySidePanelFrameWidth}
            onResizeComplete={completeSidePanelResize}
            onResizeStateChange={setIsSidePanelResizing}
            onFileSaved={() => setGitRefreshVersion(current => current + 1)}
            onTransitionEnd={event => {
              if (event.target === event.currentTarget && event.propertyName === 'width') {
                completeSidePanelClose();
              }
            }}
          />
        )}
      </div>
      <CodingSidePanelBottomSheet
        open={sidePanelSheetOpen}
        onOpenChange={setSidePanelSheetOpen}
        view={sidePanelView}
        workspaceRoot={workspaceRoot}
        sourceRoot={gitSourceRoot}
        laneId={activeLane?.id ?? null}
        refreshKey={gitRefreshKey}
        events={activeEvents}
        hasInspectorContent={hasInspectorContent}
        onOpenTab={openSidePanelTab}
        onFileSaved={() => setGitRefreshVersion(current => current + 1)}
      />
    </div>
  );
};
