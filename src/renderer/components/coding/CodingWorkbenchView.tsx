import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { Label } from '@shared/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@shared/components/ui/sheet';
import { Switch } from '@shared/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Bot, CircleStop, FileDiff, List, PanelRight, UsersRound } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import type { CodingRoomSnapshot } from '../../../shared/codingAgent';
import {
  CodingAgentProfileStatus,
  CodingEventKind,
  CodingLaneStatus,
  CodingPermissionOutcome,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { CodingAgentPicker } from './CodingAgentPicker';
import { CodingAuthAndPermissionDialogs } from './CodingAuthAndPermissionDialogs';
import { CodingComposer } from './CodingComposer';
import { CodingEventStream } from './CodingEventStream';
import { CodingInspector } from './CodingInspector';
import { CodingTaskList } from './CodingTaskList';

const profileStatusText = (status: CodingAgentProfileStatus): string => {
  const keys: Record<CodingAgentProfileStatus, string> = {
    [CodingAgentProfileStatus.Detected]: 'codingAgentStatusDetected',
    [CodingAgentProfileStatus.Ready]: 'codingAgentReady',
    [CodingAgentProfileStatus.NeedsConfiguration]: 'codingAgentStatusNeedsConfiguration',
    [CodingAgentProfileStatus.NeedsAdapter]: 'codingAgentStatusNeedsAdapter',
    [CodingAgentProfileStatus.NeedsAuth]: 'codingAgentStatusNeedsAuth',
    [CodingAgentProfileStatus.Incompatible]: 'codingAgentStatusIncompatible',
    [CodingAgentProfileStatus.Untrusted]: 'codingAgentStatusUntrusted',
    [CodingAgentProfileStatus.Unavailable]: 'codingAgentStatusUnavailable',
  };
  return i18nService.t(keys[status]);
};

const EMPTY_SNAPSHOT: CodingRoomSnapshot | null = null;

export const CodingWorkbenchView = () => {
  const [snapshot, setSnapshot] = useState<CodingRoomSnapshot | null>(EMPTY_SNAPSHOT);
  const [draftState, setDraftState] = useState({ laneId: '', value: '' });
  const [error, setError] = useState<string | null>(null);
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  const [inspectorSheetOpen, setInspectorSheetOpen] = useState(false);
  const [handoffTargetLaneId, setHandoffTargetLaneId] = useState<string | null>(null);
  const [handoffPreview, setHandoffPreview] = useState<Record<string, unknown> | null>(null);
  const [laneChangePreview, setLaneChangePreview] = useState<string | null>(null);
  const [applyConflict, setApplyConflict] = useState<string | null>(null);
  const [authTerminal, setAuthTerminal] = useState<{
    id: string;
    profileId: string;
    output: string;
  } | null>(null);
  const [authTerminalInput, setAuthTerminalInput] = useState('');
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [reviewerProfileId, setReviewerProfileId] = useState<string | null>(null);
  const [verifierProfileId, setVerifierProfileId] = useState<string | null>(null);
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventStreamRef = useRef<HTMLDivElement | null>(null);
  const selectedWorkspaceRoot = useSelector((state: RootState) => {
    const current = state.workspace.workspaces.find(
      workspace => workspace.id === state.workspace.currentWorkspaceId,
    );
    return current?.path ?? '';
  });
  const workspaceRoot = selectedWorkspaceRoot;

  useEffect(() => {
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
    () => snapshot?.lanes.find(lane => lane.id === snapshot.room.activeLaneId) ?? null,
    [snapshot],
  );
  const activeProfile = useMemo(
    () => snapshot?.profiles.find(profile => profile.id === activeLane?.profileId) ?? null,
    [activeLane?.profileId, snapshot],
  );
  const activeEvents = useMemo(
    () =>
      activeLane ? (snapshot?.events.filter(event => event.laneId === activeLane.id) ?? []) : [],
    [activeLane, snapshot],
  );
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
  const readyProfiles = useMemo(
    () =>
      snapshot?.profiles.filter(profile => profile.status === CodingAgentProfileStatus.Ready) ?? [],
    [snapshot],
  );
  const handoffTargetLane = useMemo(
    () => snapshot?.lanes.find(lane => lane.id === handoffTargetLaneId) ?? null,
    [handoffTargetLaneId, snapshot],
  );
  const handoffTargetProfile = useMemo(
    () => snapshot?.profiles.find(profile => profile.id === handoffTargetLane?.profileId) ?? null,
    [handoffTargetLane?.profileId, snapshot],
  );
  const recoveryLane =
    activeLane?.pendingRecoveryPrompt && activeLane.pendingRecoveryContext ? activeLane : null;

  useEffect(() => {
    if (!activeLane) return;
    const frame = requestAnimationFrame(() => {
      const viewport = eventStreamRef.current?.querySelector<HTMLElement>(
        '[data-slot="scroll-area-viewport"]',
      );
      if (viewport) viewport.scrollTop = activeLane.scrollPosition;
    });
    return () => cancelAnimationFrame(frame);
  }, [activeLane]);

  const prompt =
    draftState.laneId === activeLane?.id ? draftState.value : (activeLane?.draft ?? '');

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

  const createMission = async (profileId: string) => {
    const result = await window.electron.codingAgent.createMission({
      workspaceRoot,
      profileId,
      title: i18nService.t('codingAgentNewTask'),
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
  };
  const probeAgent = async (profileId: string) => {
    const result = await window.electron.codingAgent.probeAgent({ workspaceRoot, profileId });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
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
  const sendPrompt = async () => {
    if (!activeLane || !prompt.trim()) return;
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    const result = await window.electron.codingAgent.prompt({
      workspaceRoot,
      prompt: { laneId: activeLane.id, prompt },
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
  const addCollaborator = async (profileId: string) => {
    if (!activeLane) return;
    const result = await window.electron.codingAgent.addLane({
      workspaceRoot,
      missionId: activeLane.missionId,
      profileId,
    });
    if (result.success && result.snapshot) setSnapshot(result.snapshot);
    else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
  };
  const openCollaborationPreset = () => {
    const fallbackProfileId = readyProfiles[0]?.id ?? null;
    setReviewerProfileId(fallbackProfileId);
    setVerifierProfileId(fallbackProfileId);
    setPresetDialogOpen(true);
  };
  const createCollaborationPreset = async () => {
    if (!activeLane || !reviewerProfileId || !verifierProfileId) return;
    const result = await window.electron.codingAgent.createCollaborationPreset({
      workspaceRoot,
      missionId: activeLane.missionId,
      reviewerProfileId,
      verifierProfileId,
    });
    if (result.success && result.snapshot) {
      setSnapshot(result.snapshot);
      setPresetDialogOpen(false);
    } else setError(result.error ?? i18nService.t('codingAgentActionFailed'));
  };
  const handoff = async (targetLaneId: string): Promise<boolean> => {
    if (!activeLane) return false;
    const result = await window.electron.codingAgent.handoff({
      workspaceRoot,
      sourceLaneId: activeLane.id,
      targetLaneId,
    });
    if (result.success && result.snapshot) {
      setSnapshot(result.snapshot);
      return true;
    }
    setError(result.error ?? i18nService.t('codingAgentActionFailed'));
    return false;
  };
  const previewHandoff = async (targetLaneId: string) => {
    if (!activeLane) return;
    const result = await window.electron.codingAgent.previewHandoff({
      workspaceRoot,
      sourceLaneId: activeLane.id,
      targetLaneId,
    });
    if (result.success && result.content) {
      setHandoffPreview(result.content);
      setHandoffTargetLaneId(targetLaneId);
      return;
    }
    setError(result.error ?? i18nService.t('codingAgentActionFailed'));
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
    setTaskSheetOpen(false);
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
    <div className="grid h-full min-h-0 grid-cols-[220px_minmax(0,1fr)_260px] bg-background max-lg:grid-cols-[220px_minmax(0,1fr)] max-md:grid-cols-1">
      <aside className="flex min-h-0 flex-col border-r border-border p-3 max-md:hidden">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{i18nService.t('codingAgentTasks')}</h2>
          <CodingAgentPicker
            profiles={snapshot.profiles}
            onSelect={profileId => void createMission(profileId)}
            onProbe={profileId => void probeAgent(profileId)}
            onAddProfile={addProfile}
            onTrust={trustProfile}
            onAuthenticate={authenticateProfile}
            onTerminalAuthenticate={startTerminalAuthentication}
          />
        </div>
        <CodingTaskList snapshot={snapshot} onSelect={laneId => void selectLane(laneId)} />
      </aside>
      <main className="flex min-h-0 flex-col">
        <CodingAuthAndPermissionDialogs
          authTerminal={authTerminal}
          authTerminalInput={authTerminalInput}
          permission={activePermission}
          profile={activeProfile}
          onAuthTerminalInputChange={setAuthTerminalInput}
          onCancelAuthTerminal={id => void window.electron.codingAgent.cancelAuthTerminal(id)}
          onSubmitAuthTerminalInput={submitAuthTerminalInput}
          onRespondToPermission={(outcome, optionId) =>
            void respondToPermission(outcome, optionId)
          }
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
        <Dialog open={presetDialogOpen} onOpenChange={setPresetDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{i18nService.t('codingAgentPresetTitle')}</DialogTitle>
              <DialogDescription>{i18nService.t('codingAgentPresetDescription')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <Label>{i18nService.t('codingAgentPresetReviewer')}</Label>
              <Select value={reviewerProfileId} onValueChange={setReviewerProfileId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {readyProfiles.map(profile => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Label>{i18nService.t('codingAgentPresetVerifier')}</Label>
              <Select value={verifierProfileId} onValueChange={setVerifierProfileId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {readyProfiles.map(profile => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPresetDialogOpen(false)}>
                {i18nService.t('codingAgentHandoffCancel')}
              </Button>
              <Button
                type="button"
                disabled={!reviewerProfileId || !verifierProfileId}
                onClick={createCollaborationPreset}
              >
                {i18nService.t('codingAgentPresetCreate')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        {handoffTargetLane && handoffTargetProfile && activeLane && handoffPreview && (
          <Dialog
            open
            onOpenChange={open => {
              if (!open) {
                setHandoffTargetLaneId(null);
                setHandoffPreview(null);
              }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{i18nService.t('codingAgentHandoffConfirmTitle')}</DialogTitle>
                <DialogDescription>
                  {i18nService.t('codingAgentHandoffConfirmDescription')}
                </DialogDescription>
              </DialogHeader>
              <p className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
                {activeProfile?.name} → {handoffTargetProfile.name}
              </p>
              <div>
                <p className="mb-2 text-sm font-medium">
                  {i18nService.t('codingAgentHandoffPreview')}
                </p>
                <pre className="max-h-52 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-xs whitespace-pre-wrap break-words">
                  {JSON.stringify(handoffPreview, null, 2)}
                </pre>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setHandoffTargetLaneId(null);
                    setHandoffPreview(null);
                  }}
                >
                  {i18nService.t('codingAgentHandoffCancel')}
                </Button>
                <Button
                  type="button"
                  onClick={() => {
                    void handoff(handoffTargetLane.id).then(completed => {
                      if (completed) {
                        setHandoffTargetLaneId(null);
                        setHandoffPreview(null);
                      }
                    });
                  }}
                >
                  {i18nService.t('codingAgentHandoffConfirm')}
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
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <Sheet open={taskSheetOpen} onOpenChange={setTaskSheetOpen}>
              <SheetTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    aria-label={i18nService.t('codingAgentTasks')}
                  >
                    <List />
                  </Button>
                }
              />
              <SheetContent side="left" className="w-3/4 max-w-sm p-3">
                <SheetHeader className="flex-row items-center justify-between p-0 pb-3">
                  <SheetTitle>{i18nService.t('codingAgentTasks')}</SheetTitle>
                  <CodingAgentPicker
                    profiles={snapshot.profiles}
                    onSelect={profileId => void createMission(profileId)}
                    onProbe={profileId => void probeAgent(profileId)}
                    onAddProfile={addProfile}
                    onTrust={trustProfile}
                    onAuthenticate={authenticateProfile}
                    onTerminalAuthenticate={startTerminalAuthentication}
                  />
                </SheetHeader>
                <CodingTaskList snapshot={snapshot} onSelect={laneId => void selectLane(laneId)} />
              </SheetContent>
            </Sheet>
            <Bot className="size-4 text-primary" />
            <span className="text-sm font-medium">
              {activeProfile?.name ?? i18nService.t('codingAgentChooseAgent')}
            </span>
            {activeProfile && (
              <Badge variant="secondary">{profileStatusText(activeProfile.status)}</Badge>
            )}
            {activeLane?.configOptions.map(option =>
              option.type === 'select' ? (
                <Select
                  key={option.id}
                  value={typeof option.currentValue === 'string' ? option.currentValue : null}
                  onValueChange={value => {
                    if (value) void setLaneConfigOption(option.id, value);
                  }}
                >
                  <SelectTrigger size="sm" aria-label={option.name}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {option.options?.map(value => (
                      <SelectItem key={value.value} value={value.value}>
                        {value.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Switch
                  key={option.id}
                  size="sm"
                  checked={option.currentValue === true}
                  aria-label={option.name}
                  onCheckedChange={value => void setLaneConfigOption(option.id, value)}
                />
              ),
            )}
          </div>
          <div className="flex items-center gap-2">
            {activeLane && activeLane.executionRoot !== workspaceRoot && (
              <Button size="sm" variant="outline" onClick={() => void previewLaneChanges()}>
                <FileDiff className="mr-1 size-4" />
                {i18nService.t('codingAgentReviewChanges')}
              </Button>
            )}
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
            {activeLane && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  nativeButton
                  render={
                    <Button size="sm" variant="outline">
                      <UsersRound className="mr-1 size-4" />
                      {i18nService.t('codingAgentCollaborate')}
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={openCollaborationPreset}>
                    {i18nService.t('codingAgentPresetTitle')}
                  </DropdownMenuItem>
                  {snapshot.profiles
                    .filter(profile => profile.status === CodingAgentProfileStatus.Ready)
                    .map(profile => (
                      <DropdownMenuItem
                        key={profile.id}
                        onSelect={() => void addCollaborator(profile.id)}
                      >
                        {i18nService.t('codingAgentAddCollaborator')} {profile.name}
                      </DropdownMenuItem>
                    ))}
                  {snapshot.lanes
                    .filter(
                      lane => lane.missionId === activeLane.missionId && lane.id !== activeLane.id,
                    )
                    .map(lane => (
                      <DropdownMenuItem key={lane.id} onSelect={() => void previewHandoff(lane.id)}>
                        {i18nService.t('codingAgentHandoffTo')}{' '}
                        {snapshot.profiles.find(profile => profile.id === lane.profileId)?.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {activeLane?.status === CodingLaneStatus.Running && (
              <Button size="sm" variant="outline" onClick={cancel}>
                <CircleStop className="mr-1 size-4" />
                {i18nService.t('codingAgentStop')}
              </Button>
            )}
          </div>
        </header>
        <CodingEventStream
          events={activeEvents}
          scrollAreaRef={eventStreamRef}
          onScrollPositionChange={scrollPosition => {
            if (activeLane) saveScrollPosition(activeLane.id, scrollPosition);
          }}
        />
        <CodingComposer
          disabled={!activeLane}
          prompt={prompt}
          recipientName={activeProfile?.name ?? i18nService.t('codingAgentChooseAgent')}
          onChange={next => {
            if (activeLane) {
              setDraftState({ laneId: activeLane.id, value: next });
              saveDraft(activeLane.id, next);
            }
          }}
          onSend={() => void sendPrompt()}
        />
        {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
      </main>
      <aside className="min-h-0 border-l border-border max-lg:hidden">
        <CodingInspector events={activeEvents} />
      </aside>
    </div>
  );
};

const thisScrollPosition = (root: HTMLDivElement | null): number =>
  root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')?.scrollTop ?? 0;
