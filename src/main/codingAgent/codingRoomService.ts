import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { statSync } from 'fs';
import path from 'path';

import {
  CodingAgentDriverKind,
  CodingAssignmentStatus,
  CodingWorkflowStage,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
  CodingPermissionOutcome,
  CodingAgentProfileStatus,
  type CodingAgentLane,
  type CodingAgentProfile,
  type CodingAgentConfigOption,
  type AddCodingAgentProfileInput,
  type CodingLaneConfigOptionInput,
  type CodingLaneChangePreview,
  type CodingGitCommitInput,
  type CodingGitDiffInput,
  type CodingGitPathActionInput,
  type CodingGitStatus,
  type CodingGitTargetInput,
  type CreateCodingCollaborationPresetInput,
  type CodingLaneViewStateInput,
  type CodingPermissionResponse,
  type CodingPromptInput,
  CodingPromptDelivery,
  type CodingRoomSnapshot,
  type CodingWorkspaceSummary,
  type CreateCodingSessionInput,
  type StartCodingSessionInput,
  type CreateCodingWorkspaceInput,
  type CreateCodingMissionInput,
  type UpdateCodingWorkspaceInput,
} from '../../shared/codingAgent';
import { CodingAgentRegistry } from './codingAgentRegistry';
import { AuthTerminalService } from './authTerminalService';
import { CollaborationService } from './collaborationService';
import { CodingGitController } from './codingGitController';
import { CodingRoomRepository } from './codingRoomRepository';
import { isAssistantResponseEvent } from './codingTurnResponse';
import {
  persistCodingSessionRecord,
  prepareCodingSession,
  resolveSessionTarget,
} from './codingSessionStartup';
import { t } from '../i18n';
import type { CodingAgentDriver } from './drivers/codingAgentDriver';
import { CodingDriverFactory } from './drivers/driverFactory';
import type { CoworkSessionInterruption } from '../../shared/cowork/interruption';
import type { WorkbenchApprovalMode } from '../../shared/workbenchTask';
import type { CoworkPendingMessage } from '../../shared/cowork/pendingMessageQueue';
import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
} from '../../shared/cowork/pendingMessageQueue';

export interface CodingRoomRuntime {
  startBuiltinSession(input: {
    sessionId: string;
    workspaceRoot: string;
    prompt: string;
    modelOverride?: string | null;
    thinkingLevel?: string;
    permissionMode?: WorkbenchApprovalMode;
  }): Promise<void>;
  /** Applies approval-mode changes to a live built-in session. */
  setBuiltinApprovalMode?(sessionId: string, mode: WorkbenchApprovalMode): void;
  cancelBuiltinSession(sessionId: string): Promise<void>;
  enqueueBuiltinMessage?(sessionId: string, prompt: string): { success: boolean; error?: string };
  steerBuiltinMessage?(
    sessionId: string,
    prompt: string,
  ): Promise<{ success: boolean; error?: string }>;
  /** Applies model/thinking-level changes to a live built-in session. */
  patchBuiltinSession?(
    sessionId: string,
    patch: { model?: string | null; thinkingLevel?: string | null },
  ): Promise<void>;
  getBuiltinWorkbenchLink(sessionId: string): { taskId: string; runId: string } | null;
  beginExternalWorkbenchRun(input: { sessionId: string; goal: string; workspaceRoot: string }): {
    taskId: string;
    runId: string;
  };
  completeExternalWorkbenchRun(input: {
    sessionId: string;
    runId: string;
    workspaceRoot: string;
    finalAnswer: string;
  }): void;
  failExternalWorkbenchRun?(input: { sessionId: string; runId: string; error: string }): void;
  cancelExternalWorkbenchRun?(input: { sessionId: string; runId: string }): void;
  respondBuiltinPermission?(requestId: string, approved: boolean): void;
  validateBuiltinModel?(): Promise<void>;
  createIsolatedWorkspace?(input: {
    workspaceRoot: string;
    laneId: string;
    baseline: string;
  }): Promise<string>;
  getWorkspaceBaseline?(workspaceRoot: string): Promise<string | null>;
  getWorkspaceDiff?(workspaceRoot: string): Promise<string | null>;
  getIsolatedWorkspaceDiff?(workspaceRoot: string): Promise<string>;
  applyIsolatedWorkspaceDiff?(input: {
    workspaceRoot: string;
    isolatedWorkspaceRoot: string;
  }): Promise<void>;
  applyWorkspacePatch?(input: { workspaceRoot: string; patch: string }): Promise<void>;
}

type DriverSession = { id: string; connectionGeneration: number | null };

const ACP_ENVIRONMENT_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TMPDIR',
  'TEMP',
  'TMP',
  'LANG',
  'LC_ALL',
  // Windows-specific variables needed for npm global resolution, shell
  // helpers, and credential stores used by ACP agents (e.g. Kimi Code CLI).
  'APPDATA',
  'LOCALAPPDATA',
  'COMSPEC',
  'PATHEXT',
  'SystemRoot',
  'USERPROFILE',
  'USERNAME',
  'ProgramFiles',
  'ProgramFiles(x86)',
] as const;

export class CodingRoomService extends EventEmitter {
  private readonly drivers = new Map<string, CodingAgentDriver>();
  private readonly driverSessionIds = new Map<string, DriverSession>();
  private readonly driverSessionPromises = new Map<
    string,
    Promise<{ id: string; recoveryContext: string | null }>
  >();
  private readonly driverProfileIds = new Map<string, string>();
  private readonly driverFactory: CodingDriverFactory;
  private readonly collaboration = new CollaborationService();
  private readonly authTerminals = new AuthTerminalService();
  private readonly git: CodingGitController;
  private readonly laneTurnGenerations = new Map<string, number>();
  private readonly cancelledTurnGenerations = new Map<string, number>();
  private readonly acpPendingMessages = new Map<string, CoworkPendingMessage[]>();
  private readonly stagedLaneIds = new Set<string>();
  /** Maps builtin sessionId → laneId to avoid scanning all rooms per event. */
  private readonly builtinSessionLaneMap = new Map<string, string>();
  /** Throttle timer for publishing builtin event batches. */
  private builtinPublishTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly BUILTIN_PUBLISH_THROTTLE_MS = 100;

  constructor(
    private readonly repository: CodingRoomRepository,
    readonly registry: CodingAgentRegistry,
    private readonly runtime: CodingRoomRuntime,
    acpEnvironment: Record<string, string | undefined> = {},
  ) {
    super();
    this.git = new CodingGitController(repository);
    const patchBuiltinSession = this.runtime.patchBuiltinSession?.bind(this.runtime);
    this.driverFactory = new CodingDriverFactory(
      {
        start: (sessionId, workspaceRoot, prompt, options) =>
          this.runtime.startBuiltinSession({
            sessionId,
            workspaceRoot,
            prompt,
            ...(options?.modelOverride ? { modelOverride: options.modelOverride } : {}),
            ...(options?.thinkingLevel ? { thinkingLevel: options.thinkingLevel } : {}),
            ...(options?.permissionMode ? { permissionMode: options.permissionMode } : {}),
          }),
        cancel: sessionId => this.runtime.cancelBuiltinSession(sessionId),
        patchSession: patchBuiltinSession,
        setApprovalMode: this.runtime.setBuiltinApprovalMode?.bind(this.runtime),
      },
      {
        ...Object.fromEntries(ACP_ENVIRONMENT_KEYS.map(key => [key, process.env[key]])),
        ...acpEnvironment,
      },
    );
    registry.on('changed', () => {
      for (const room of this.repository.listRooms()) this.publish(room.workspaceRoot);
    });
    this.authTerminals.on('data', event => this.emit('authTerminalData', event));
    this.authTerminals.on('exit', event => {
      void this.completeTerminalAuthentication(event);
    });
  }

  bootstrap(workspaceRoot: string): CodingRoomSnapshot {
    this.registry.refreshBuiltinReadiness();
    const room = this.repository.getOrCreateRoom(workspaceRoot);
    const missions = this.repository.listMissions(room.id);
    const lanes = this.repository.listLanes(missions.map(mission => mission.id));
    const assignments = this.repository.listAssignments(missions.map(mission => mission.id));
    return {
      room,
      profiles: this.registry.list(),
      missions,
      lanes,
      assignments,
      events: this.repository.listEvents(lanes.map(lane => lane.id)),
    };
  }

  listProfiles() {
    this.registry.refreshBuiltinReadiness();
    return this.registry.list();
  }

  listWorkspaces(): CodingWorkspaceSummary[] {
    return this.repository.listRooms().map(room => {
      const missions = this.repository.listMissions(room.id);
      const lanes = this.repository.listLanes(missions.map(mission => mission.id));
      const assignments = this.repository.listAssignments(missions.map(mission => mission.id));
      const missionById = new Map(missions.map(mission => [mission.id, mission]));
      const primaryLaneByMission = new Map<string, string>();
      for (const mission of missions) {
        const implementationLaneId = assignments.find(
          assignment =>
            assignment.missionId === mission.id &&
            assignment.workflowStage === CodingWorkflowStage.Implementation,
        )?.laneId;
        const primaryLane =
          lanes.find(lane => lane.id === implementationLaneId) ??
          lanes.find(lane => lane.missionId === mission.id);
        if (primaryLane) primaryLaneByMission.set(mission.id, primaryLane.id);
      }
      return {
        id: room.id,
        name: room.name,
        primaryRoot: room.workspaceRoot,
        defaultProfileId: room.defaultProfileId,
        sources: this.repository.listWorkspaceSources(room.id),
        sessions: lanes
          .map(lane => {
            const mission = missionById.get(lane.missionId);
            if (!mission) return null;
            const primaryLaneId = primaryLaneByMission.get(mission.id) ?? lane.id;
            return {
              id: lane.id,
              workspaceId: room.id,
              missionId: mission.id,
              parentSessionId: lane.id === primaryLaneId ? null : primaryLaneId,
              title: mission.title,
              profileId: lane.profileId,
              sourceRoot: lane.sourceRoot || room.workspaceRoot,
              status: lane.status,
              createdAt: mission.createdAt,
              updatedAt: mission.updatedAt,
            };
          })
          .filter(session => session !== null),
        activeSessionId: room.activeLaneId,
      } satisfies CodingWorkspaceSummary;
    });
  }

  createWorkspace(input: CreateCodingWorkspaceInput): CodingWorkspaceSummary[] {
    const name = this.requireWorkspaceName(input.name);
    const sourceFolders = this.requireSourceFolders(input.sourceFolders);
    const defaultProfileId = this.requireProfile(input.defaultProfileId).id;
    if (sourceFolders.some(source => this.repository.findWorkspaceIdBySource(source))) {
      throw new Error('A source folder already belongs to another coding workspace.');
    }
    this.repository.createWorkspace(name, sourceFolders, defaultProfileId);
    return this.listWorkspaces();
  }

  updateWorkspace(input: UpdateCodingWorkspaceInput): CodingWorkspaceSummary[] {
    const room = this.repository.getRoomById(input.workspaceId);
    if (!room) throw new Error('Coding workspace was not found.');
    const name = this.requireWorkspaceName(input.name);
    const sourceFolders = this.requireSourceFolders(input.sourceFolders);
    const defaultProfileId = this.requireProfile(input.defaultProfileId).id;
    const missions = this.repository.listMissions(room.id);
    const lanes = this.repository.listLanes(missions.map(mission => mission.id));
    const referencedSources = new Set(lanes.map(lane => path.resolve(lane.sourceRoot)));
    const nextSources = new Set(sourceFolders);
    if ([...referencedSources].some(source => !nextSources.has(source))) {
      throw new Error('A source folder with existing coding sessions cannot be removed.');
    }
    if (missions.length > 0 && sourceFolders[0] !== path.resolve(room.workspaceRoot)) {
      throw new Error('The primary source folder cannot change after a coding session is created.');
    }
    if (
      sourceFolders.some(source => {
        const owner = this.repository.findWorkspaceIdBySource(source);
        return owner !== null && owner !== room.id;
      })
    ) {
      throw new Error('A source folder already belongs to another coding workspace.');
    }
    const conflict = this.repository.getRoomByRoot(sourceFolders[0]);
    if (conflict && conflict.id !== room.id) {
      throw new Error('A coding workspace already uses this primary source folder.');
    }
    this.repository.updateWorkspace(room.id, name, sourceFolders, defaultProfileId);
    return this.listWorkspaces();
  }

  deleteWorkspace(workspaceId: string): CodingWorkspaceSummary[] {
    const room = this.repository.getRoomById(workspaceId);
    if (!room) throw new Error('Coding workspace was not found.');
    const missions = this.repository.listMissions(room.id);
    const lanes = this.repository.listLanes(missions.map(mission => mission.id));
    if (
      lanes.some(
        lane =>
          lane.status === CodingLaneStatus.Running ||
          lane.status === CodingLaneStatus.WaitingApproval,
      )
    ) {
      throw new Error('Stop all running coding sessions before removing this workspace.');
    }
    for (const lane of lanes) {
      void this.drivers.get(lane.id)?.dispose();
      this.drivers.delete(lane.id);
      this.driverProfileIds.delete(lane.id);
      this.driverSessionIds.delete(lane.id);
      this.driverSessionPromises.delete(lane.id);
      this.builtinSessionLaneMap.delete(lane.localSessionId);
    }
    this.repository.deleteWorkspace(room.id);
    return this.listWorkspaces();
  }

  deleteSession(workspaceRoot: string, laneId: string): CodingWorkspaceSummary[] {
    const room =
      this.repository.getRoomByRoot(workspaceRoot) ??
      this.repository.getRoomByRoot(path.resolve(workspaceRoot));
    if (!room) throw new Error('Coding workspace was not found.');
    const missions = this.repository.listMissions(room.id);
    const lanes = this.repository.listLanes(missions.map(mission => mission.id));
    const lane = lanes.find(candidate => candidate.id === laneId);
    if (!lane) throw new Error('The coding session was not found.');
    if (
      lane.status === CodingLaneStatus.Running ||
      lane.status === CodingLaneStatus.WaitingApproval
    ) {
      throw new Error('Stop the running coding session before deleting it.');
    }
    const missionLanes = lanes.filter(candidate => candidate.missionId === lane.missionId);
    const implementationLaneId = this.repository
      .listAssignments([lane.missionId])
      .find(assignment => assignment.workflowStage === CodingWorkflowStage.Implementation)?.laneId;
    const isPrimaryLane = lane.id === (implementationLaneId ?? missionLanes[0]?.id);
    // Deleting the primary session removes the whole mission (collaborators
    // included); deleting a collaborator removes only that lane.
    const removedLanes = isPrimaryLane ? missionLanes : [lane];
    for (const removed of removedLanes) {
      void this.drivers.get(removed.id)?.dispose();
      this.drivers.delete(removed.id);
      this.driverProfileIds.delete(removed.id);
      this.driverSessionIds.delete(removed.id);
      this.driverSessionPromises.delete(removed.id);
      this.builtinSessionLaneMap.delete(removed.localSessionId);
    }
    if (isPrimaryLane) {
      this.repository.deleteMission(room.id, lane.missionId);
    } else {
      this.repository.deleteLane(room.id, lane.id);
    }
    this.publish(room.workspaceRoot);
    return this.listWorkspaces();
  }

  async createSession(input: CreateCodingSessionInput): Promise<CodingRoomSnapshot> {
    return await this.createSessionRecord(input, true);
  }

  private async createSessionRecord(
    input: CreateCodingSessionInput,
    notify: boolean,
  ): Promise<CodingRoomSnapshot> {
    const target = resolveSessionTarget(this.repository, this.registry, input);
    await persistCodingSessionRecord({
      repository: this.repository,
      target,
      title: input.title?.trim() || t('codingAgentDefaultMissionTitle'),
      getWorkspaceBaseline: sourceRoot => this.getWorkspaceBaseline(sourceRoot),
    });
    return notify
      ? this.publish(target.room.workspaceRoot)
      : this.bootstrap(target.room.workspaceRoot);
  }

  async startSession(input: StartCodingSessionInput): Promise<CodingRoomSnapshot> {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('Prompt is required.');
    const selectedProfile = this.registry.get(input.profileId);
    if (
      selectedProfile &&
      selectedProfile.driverKind === CodingAgentDriverKind.Acp &&
      selectedProfile.status === CodingAgentProfileStatus.Detected
    ) {
      await this.registry.probe(selectedProfile.id, input.sourceRoot);
    }
    const prepared = await prepareCodingSession({
      request: input,
      prompt,
      repository: this.repository,
      registry: this.registry,
      driverFactory: this.driverFactory,
      validateBuiltinModel: this.runtime.validateBuiltinModel?.bind(this.runtime),
      getWorkspaceBaseline: sourceRoot => this.getWorkspaceBaseline(sourceRoot),
    });
    const { room, profile, lane, driver, driverSession } = prepared;
    this.stagedLaneIds.add(lane.id);
    // Register builtin session → lane mapping so recordBuiltinEvent can find
    // the lane without scanning every room.
    if (profile.driverKind === CodingAgentDriverKind.Builtin) {
      this.builtinSessionLaneMap.set(lane.localSessionId, lane.id);
    }
    try {
      this.registerDriver(lane, profile, driver);
      this.driverSessionIds.set(lane.id, {
        id: driverSession.id,
        connectionGeneration: driver.getConnectionGeneration?.() ?? null,
      });
      const snapshot = await this.prompt(room.workspaceRoot, {
        laneId: lane.id,
        prompt,
        attachments: input.attachments,
      });
      this.stagedLaneIds.delete(lane.id);
      return snapshot;
    } catch (error) {
      this.stagedLaneIds.delete(lane.id);
      await this.rollbackCreatedSession(room.id, lane);
      this.publish(room.workspaceRoot);
      throw error;
    }
  }

  /** Running drivers are process-local, so an app restart must never leave stale lanes running. */
  recoverInterruptedState(): number {
    const interrupted = this.repository.recoverInterruptedLanes();
    for (const lane of interrupted) {
      this.repository.appendEvent(lane.id, CodingEventKind.TurnCancelled, {
        reason: 'application_restart',
      });
    }
    return interrupted.length;
  }

  async createMission(input: CreateCodingMissionInput): Promise<CodingRoomSnapshot> {
    this.registry.refreshBuiltinReadiness();
    const profile = this.registry.get(input.profileId);
    if (!profile) throw new Error('Coding agent profile was not found.');
    if (profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error('The selected coding agent is not ready to run.');
    }
    const room = this.repository.getOrCreateRoom(input.workspaceRoot);
    const mission = this.repository.createMission(
      room.id,
      input.title?.trim() || t('codingAgentDefaultMissionTitle'),
      await this.getWorkspaceBaseline(input.workspaceRoot),
    );
    const lane = this.repository.createLane(mission.id, profile.id, input.workspaceRoot);
    this.repository.createAssignment({
      missionId: mission.id,
      laneId: lane.id,
      title: mission.title,
      instructions: mission.goal,
      workflowStage: CodingWorkflowStage.Implementation,
    });
    this.repository.setActive(room.id, mission.id, lane.id);
    return this.publish(input.workspaceRoot);
  }

  async prepareLane(workspaceRoot: string, laneId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const profile = this.registry.get(lane.profileId);
    if (
      lane.remoteSessionId ||
      !profile ||
      profile.status !== CodingAgentProfileStatus.Ready ||
      (profile.driverKind !== CodingAgentDriverKind.Acp &&
        profile.driverKind !== CodingAgentDriverKind.Builtin) ||
      // Built-in lanes only need preparing when their config options were
      // persisted before config option support existed.
      (profile.driverKind === CodingAgentDriverKind.Builtin && lane.configOptions.length > 0)
    ) {
      return snapshot;
    }
    const driver = this.getDriver(lane);
    await this.ensureDriverSession(driver, lane, this.executionRoot(lane, workspaceRoot));
    return this.publish(workspaceRoot);
  }

  /** Default config options a new session of this profile would start with. */
  getProfileConfigOptions(profileId: string): CodingAgentConfigOption[] {
    const profile = this.registry.get(profileId);
    if (!profile || profile.driverKind !== CodingAgentDriverKind.Builtin) return [];
    const driver = this.driverFactory.create(profile);
    return driver.getDefaultConfigOptions?.() ?? [];
  }

  selectLane(workspaceRoot: string, laneId: string): CodingRoomSnapshot {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    this.repository.setActive(snapshot.room.id, lane.missionId, lane.id);
    return this.publish(workspaceRoot);
  }

  listPendingMessages(laneId: string): CoworkPendingMessage[] {
    return (this.acpPendingMessages.get(laneId) ?? []).map(item => ({ ...item }));
  }

  private emitPendingMessagesChanged(laneId: string): void {
    this.emit('pendingMessagesChanged', { laneId, items: this.listPendingMessages(laneId) });
  }

  enqueuePendingMessage(
    laneId: string,
    text: string,
  ): { success: boolean; item?: CoworkPendingMessage; error?: string } {
    const normalized = text.trim();
    if (!normalized) return { success: false, error: 'Message text is required.' };
    const item: CoworkPendingMessage = {
      id: randomUUID(),
      text: normalized,
      delivery: CoworkQueueDelivery.FollowUp,
      createdAt: Date.now(),
      status: CoworkQueueItemStatus.Pending,
    };
    const items = this.acpPendingMessages.get(laneId) ?? [];
    items.push(item);
    this.acpPendingMessages.set(laneId, items);
    this.emitPendingMessagesChanged(laneId);
    return { success: true, item };
  }

  updatePendingMessage(
    laneId: string,
    itemId: string,
    text: string,
  ): { success: boolean; error?: string } {
    const normalized = text.trim();
    if (!normalized) return { success: false, error: 'Message text is required.' };
    const items = this.acpPendingMessages.get(laneId) ?? [];
    const item = items.find(candidate => candidate.id === itemId);
    if (!item) return { success: false, error: 'Pending message was not found.' };
    if (item.status === CoworkQueueItemStatus.Sending) {
      return { success: false, error: 'A pending message cannot be edited while sending.' };
    }
    item.text = normalized;
    item.status = CoworkQueueItemStatus.Pending;
    delete item.error;
    this.emitPendingMessagesChanged(laneId);
    return { success: true };
  }

  deletePendingMessage(laneId: string, itemId: string): { success: boolean; error?: string } {
    const items = this.acpPendingMessages.get(laneId) ?? [];
    const next = items.filter(item => item.id !== itemId);
    if (next.length === items.length)
      return { success: false, error: 'Pending message was not found.' };
    if (next.length) this.acpPendingMessages.set(laneId, next);
    else this.acpPendingMessages.delete(laneId);
    this.emitPendingMessagesChanged(laneId);
    return { success: true };
  }

  async steerPendingMessage(
    workspaceRoot: string,
    laneId: string,
    itemId: string,
  ): Promise<CodingRoomSnapshot> {
    const items = this.acpPendingMessages.get(laneId) ?? [];
    const item = items.find(candidate => candidate.id === itemId);
    if (!item) throw new Error('Pending message was not found.');
    if (item.status === CoworkQueueItemStatus.Sending) {
      throw new Error('A pending message is already being sent.');
    }
    item.delivery = CoworkQueueDelivery.Steer;
    item.status = CoworkQueueItemStatus.Sending;
    delete item.error;
    this.emitPendingMessagesChanged(laneId);
    try {
      await this.cancel(workspaceRoot, laneId);
    } catch (error) {
      this.failAcpPendingMessage(laneId, item.id, error);
      throw error;
    }
    return await this.prompt(workspaceRoot, { laneId, prompt: item.text }, item.id);
  }

  async followUpPendingMessage(
    workspaceRoot: string,
    laneId: string,
    itemId: string,
  ): Promise<CodingRoomSnapshot> {
    const item = (this.acpPendingMessages.get(laneId) ?? []).find(
      candidate => candidate.id === itemId,
    );
    if (!item) throw new Error('Pending message was not found.');
    if (item.delivery !== CoworkQueueDelivery.FollowUp) {
      throw new Error('This pending message must be sent as a steer.');
    }
    if (item.status === CoworkQueueItemStatus.Sending) {
      throw new Error('A pending message is already being sent.');
    }
    item.status = CoworkQueueItemStatus.Sending;
    delete item.error;
    this.emitPendingMessagesChanged(laneId);
    return await this.prompt(workspaceRoot, { laneId, prompt: item.text }, item.id);
  }

  async prompt(
    workspaceRoot: string,
    input: CodingPromptInput,
    queuedItemId?: string,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, input.laneId);
    if (
      lane.status === CodingLaneStatus.Running ||
      lane.status === CodingLaneStatus.WaitingApproval
    ) {
      const profile = this.registry.get(lane.profileId);
      const prompt = input.prompt.trim();
      if (!prompt) throw new Error('Prompt is required.');
      if (profile?.driverKind === CodingAgentDriverKind.Builtin) {
        const driver = this.getDriver(lane);
        const session = await this.ensureDriverSession(
          driver,
          lane,
          this.executionRoot(lane, workspaceRoot),
        );
        if (input.delivery === CodingPromptDelivery.Steer) {
          const result = await this.runtime.steerBuiltinMessage?.(session.id, prompt);
          if (result?.success) return this.publish(workspaceRoot);
          throw new Error(result?.error ?? 'Failed to steer the coding agent.');
        }
        const result = this.runtime.enqueueBuiltinMessage?.(session.id, prompt);
        if (result?.success) return this.publish(workspaceRoot);
        throw new Error(result?.error ?? 'Failed to queue the coding prompt.');
      }
      if (profile?.driverKind === CodingAgentDriverKind.Acp) {
        const queued = this.enqueuePendingMessage(lane.id, prompt);
        if (!queued.success || !queued.item)
          throw new Error(queued.error ?? 'Failed to queue the coding prompt.');
        if (input.delivery === CodingPromptDelivery.Steer) {
          return await this.steerPendingMessage(workspaceRoot, lane.id, queued.item.id);
        }
        return this.publish(workspaceRoot);
      }
      throw new Error('This coding agent lane already has an active turn.');
    }
    const profile = this.registry.get(lane.profileId);
    if (!profile) throw new Error('Coding agent profile was not found.');
    if (profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error('The selected coding agent is not ready to run.');
    }
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('Prompt is required.');

    const executionRoot = this.executionRoot(lane, workspaceRoot);
    if (this.requiresWriterLease(lane.sourceRoot, executionRoot)) {
      this.repository.acquireWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
    }
    this.repository.appendEvent(lane.id, CodingEventKind.Message, {
      role: 'user',
      content: prompt,
      ...(input.attachments?.length
        ? { attachments: input.attachments.map(attachment => ({ name: attachment.name })) }
        : {}),
    });
    this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
    this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
    this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);

    try {
      const driver = this.getDriver(lane);
      const session = await this.ensureDriverSession(driver, lane, executionRoot);
      if (session.recoveryContext) {
        if (this.requiresWriterLease(lane.sourceRoot, executionRoot)) {
          this.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
        }
        this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Idle);
        this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.NeedsReview);
        this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Planned);
        this.repository.updateLaneRecovery(lane.id, prompt, session.recoveryContext);
        return this.publish(workspaceRoot);
      }
      if (profile.driverKind !== CodingAgentDriverKind.Builtin) {
        const workbench = this.runtime.beginExternalWorkbenchRun({
          sessionId: lane.localSessionId,
          goal: prompt,
          workspaceRoot: executionRoot,
        });
        this.linkLaneAssignment(snapshot, lane.id, workbench.taskId, workbench.runId);
      }
      const turnGeneration = this.beginLaneTurn(lane.id);
      void this.runTurn(
        workspaceRoot,
        executionRoot,
        snapshot.room.id,
        lane,
        profile.driverKind,
        driver,
        session.id,
        prompt,
        queuedItemId,
        turnGeneration,
        input.attachments,
      );
    } catch (error) {
      if (this.requiresWriterLease(lane.sourceRoot, executionRoot)) {
        this.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
      }
      const failureStatus = this.failureStatus(lane, error);
      this.repository.updateLaneStatus(lane.id, failureStatus);
      this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Failed);
      this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Failed);
      this.repository.appendEvent(lane.id, CodingEventKind.TurnFailed, {
        error: this.errorMessage(error),
      });
      if (queuedItemId) this.failAcpPendingMessage(lane.id, queuedItemId, error);
      throw error;
    }
    return this.publish(workspaceRoot);
  }

  async confirmSessionRecovery(
    workspaceRoot: string,
    laneId: string,
    includeRecoveryContext: boolean,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const profile = this.registry.get(lane.profileId);
    if (!profile || profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error('The selected coding agent is not ready to run.');
    }
    if (!lane.pendingRecoveryPrompt || !lane.pendingRecoveryContext) {
      throw new Error('The coding session does not require recovery confirmation.');
    }
    const executionRoot = this.executionRoot(lane, workspaceRoot);
    if (this.requiresWriterLease(lane.sourceRoot, executionRoot)) {
      this.repository.acquireWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
    }
    try {
      const driver = this.getDriver(lane);
      const session = await this.ensureDriverSession(driver, lane, executionRoot);
      if (session.recoveryContext) {
        if (this.requiresWriterLease(lane.sourceRoot, executionRoot)) {
          this.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
        }
        this.repository.updateLaneRecovery(
          lane.id,
          lane.pendingRecoveryPrompt,
          session.recoveryContext,
        );
        return this.publish(workspaceRoot);
      }
      this.repository.updateLaneRecovery(lane.id, null, null);
      this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
      this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
      this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
      if (profile.driverKind !== CodingAgentDriverKind.Builtin) {
        const workbench = this.runtime.beginExternalWorkbenchRun({
          sessionId: lane.localSessionId,
          goal: lane.pendingRecoveryPrompt,
          workspaceRoot: executionRoot,
        });
        this.linkLaneAssignment(snapshot, lane.id, workbench.taskId, workbench.runId);
      }
      const turnGeneration = this.beginLaneTurn(lane.id);
      void this.runTurn(
        workspaceRoot,
        executionRoot,
        snapshot.room.id,
        lane,
        profile.driverKind,
        driver,
        session.id,
        includeRecoveryContext
          ? `${lane.pendingRecoveryContext}\n\n${lane.pendingRecoveryPrompt}`
          : lane.pendingRecoveryPrompt,
        undefined,
        turnGeneration,
      );
    } catch (error) {
      if (this.requiresWriterLease(lane.sourceRoot, executionRoot)) {
        this.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
      }
      throw error;
    }
    return this.publish(workspaceRoot);
  }

  async cancel(workspaceRoot: string, laneId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const driver = this.getDriver(lane);
    const session = await this.ensureDriverSession(
      driver,
      lane,
      this.executionRoot(lane, workspaceRoot),
    );
    const activeTurnGeneration = this.laneTurnGenerations.get(lane.id);
    if (activeTurnGeneration !== undefined) {
      this.cancelledTurnGenerations.set(lane.id, activeTurnGeneration);
    }
    await driver.cancel(session.id);
    const assignment = this.repository.getLatestAssignmentForLane(lane.id);
    if (assignment?.workbenchRunId) {
      this.runtime.cancelExternalWorkbenchRun?.({
        sessionId: lane.localSessionId,
        runId: assignment.workbenchRunId,
      });
    }
    if (this.requiresWriterLease(lane.sourceRoot, this.executionRoot(lane, workspaceRoot))) {
      this.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
    }
    this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Idle);
    this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Cancelled);
    this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Cancelled);
    this.repository.appendEvent(lane.id, CodingEventKind.TurnCancelled, {});
    return this.publish(workspaceRoot);
  }

  async previewHandoff(
    workspaceRoot: string,
    sourceLaneId: string,
    targetLaneId: string,
  ): Promise<Record<string, unknown>> {
    const snapshot = this.bootstrap(workspaceRoot);
    const source = this.requireLane(snapshot.lanes, sourceLaneId);
    const target = this.requireLane(snapshot.lanes, targetLaneId);
    if (source.missionId !== target.missionId) {
      throw new Error('Handoffs require lanes in the same coding mission.');
    }
    return this.collaboration.buildHandoff({
      snapshot,
      sourceLane: source,
      targetLane: target,
      baseline: this.requireMissionBaseline(
        snapshot.missions.find(mission => mission.id === source.missionId),
      ),
      diff: await this.getWorkspaceDiff(this.executionRoot(source, workspaceRoot)),
    });
  }

  async handoff(
    workspaceRoot: string,
    sourceLaneId: string,
    targetLaneId: string,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const source = this.requireLane(snapshot.lanes, sourceLaneId);
    const target = this.requireLane(snapshot.lanes, targetLaneId);
    if (source.missionId !== target.missionId) {
      throw new Error('Handoffs require lanes in the same coding mission.');
    }
    const content = await this.previewHandoff(workspaceRoot, sourceLaneId, targetLaneId);
    const handoffId = this.repository.createHandoff(
      source.missionId,
      sourceLaneId,
      targetLaneId,
      content,
    );
    this.repository.appendEvent(targetLaneId, CodingEventKind.Message, {
      role: 'handoff',
      handoffId,
      content,
    });
    this.repository.setActive(snapshot.room.id, target.missionId, target.id);
    // A handoff is an executable delivery, not only an activity-log record.  ACP
    // receives it through the same text content block used for ordinary prompts.
    return await this.prompt(workspaceRoot, {
      laneId: target.id,
      prompt: this.handoffPrompt(content),
    });
  }

  async addLane(
    workspaceRoot: string,
    missionId: string,
    profileId: string,
  ): Promise<CodingRoomSnapshot> {
    this.registry.refreshBuiltinReadiness();
    const snapshot = this.bootstrap(workspaceRoot);
    if (!snapshot.missions.some(mission => mission.id === missionId)) {
      throw new Error('Coding mission was not found.');
    }
    const profile = this.registry.get(profileId);
    if (!profile) throw new Error('Coding agent profile was not found.');
    if (profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error('The selected coding agent is not ready to run.');
    }
    if (!this.runtime.createIsolatedWorkspace) {
      throw new Error('The coding runtime cannot create an isolated workspace.');
    }
    const mission = snapshot.missions.find(candidate => candidate.id === missionId);
    const laneId = randomUUID();
    const sourceRoot =
      snapshot.lanes.find(lane => lane.missionId === missionId)?.sourceRoot ?? workspaceRoot;
    const executionRoot = await this.runtime.createIsolatedWorkspace({
      workspaceRoot: sourceRoot,
      laneId,
      baseline: this.requireMissionBaseline(mission),
    });
    const lane = this.repository.createLane(
      missionId,
      profileId,
      sourceRoot,
      executionRoot,
      laneId,
    );
    this.repository.createAssignment({
      missionId,
      laneId: lane.id,
      title: mission?.title ?? 'Coding assignment',
      instructions: mission?.goal ?? '',
    });
    return this.publish(workspaceRoot);
  }

  async createImplementationReviewVerificationPreset(
    input: CreateCodingCollaborationPresetInput,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(input.workspaceRoot);
    const mission = snapshot.missions.find(candidate => candidate.id === input.missionId);
    if (!mission) throw new Error('Coding mission was not found.');
    if (!this.runtime.createIsolatedWorkspace) {
      throw new Error('The coding runtime cannot create an isolated workspace.');
    }
    const implementation = snapshot.assignments.find(
      assignment =>
        assignment.missionId === mission.id &&
        assignment.workflowStage === CodingWorkflowStage.Implementation,
    );
    if (!implementation) throw new Error('The coding mission has no implementation assignment.');
    const stages = [
      {
        profileId: input.reviewerProfileId,
        workflowStage: CodingWorkflowStage.Review,
        title: `Review: ${mission.title}`,
        instructions:
          'Review the implementation in an isolated worktree. Do not apply changes to the primary workspace.',
      },
      {
        profileId: input.verifierProfileId,
        workflowStage: CodingWorkflowStage.Verification,
        title: `Verify: ${mission.title}`,
        instructions: 'Verify the implementation in an isolated worktree and report test results.',
      },
    ];
    let previousAssignmentId = implementation.id;
    for (const stage of stages) {
      const profile = this.registry.get(stage.profileId);
      if (!profile) throw new Error('Coding agent profile was not found.');
      if (profile.status !== CodingAgentProfileStatus.Ready) {
        throw new Error('The selected coding agent is not ready to run.');
      }
      const laneId = randomUUID();
      const sourceRoot =
        snapshot.lanes.find(lane => lane.missionId === mission.id)?.sourceRoot ??
        input.workspaceRoot;
      const executionRoot = await this.runtime.createIsolatedWorkspace({
        workspaceRoot: sourceRoot,
        laneId,
        baseline: this.requireMissionBaseline(mission),
      });
      const lane = this.repository.createLane(
        mission.id,
        profile.id,
        sourceRoot,
        executionRoot,
        laneId,
      );
      const assignment = this.repository.createAssignment({
        missionId: mission.id,
        laneId: lane.id,
        title: stage.title,
        instructions: stage.instructions,
        workflowStage: stage.workflowStage,
        previousAssignmentId,
      });
      previousAssignmentId = assignment.id;
      this.repository.appendEvent(lane.id, CodingEventKind.Message, {
        role: 'system',
        content: stage.instructions,
      });
    }
    return this.publish(input.workspaceRoot);
  }

  saveLaneView(workspaceRoot: string, input: CodingLaneViewStateInput): CodingRoomSnapshot {
    const snapshot = this.bootstrap(workspaceRoot);
    this.requireLane(snapshot.lanes, input.laneId);
    this.repository.updateLaneViewState(
      input.laneId,
      input.draft,
      Math.max(0, Math.floor(input.scrollPosition)),
    );
    return this.publish(workspaceRoot);
  }

  async setLaneConfigOption(
    workspaceRoot: string,
    input: CodingLaneConfigOptionInput,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, input.laneId);
    const option = lane.configOptions.find(candidate => candidate.id === input.configId);
    if (!option) throw new Error('The coding agent configuration option was not found.');
    if (option.type === 'select') {
      if (
        typeof input.value !== 'string' ||
        !option.options?.some(candidate => candidate.value === input.value)
      ) {
        throw new Error('The selected coding agent configuration value is invalid.');
      }
    } else if (typeof input.value !== 'boolean') {
      throw new Error('The selected coding agent configuration value is invalid.');
    }
    const driver = this.getDriver(lane);
    const session = await this.ensureDriverSession(
      driver,
      lane,
      this.executionRoot(lane, workspaceRoot),
    );
    const configOptions = await driver.setConfigOption(session.id, input.configId, input.value);
    this.repository.updateLaneConfigOptions(lane.id, configOptions);
    return this.publish(workspaceRoot);
  }

  /** Switch the model of a built-in lane; applies live when the session is running. */
  async setLaneModelOverride(
    workspaceRoot: string,
    laneId: string,
    modelOverride: string | null,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const profile = this.registry.get(lane.profileId);
    if (profile?.driverKind !== CodingAgentDriverKind.Builtin) {
      throw new Error('Only the built-in coding agent supports switching models here.');
    }
    const normalized = modelOverride?.trim() || null;
    this.repository.updateLaneModelOverride(lane.id, normalized);
    if (normalized) {
      await this.runtime.patchBuiltinSession?.(lane.localSessionId, { model: normalized });
    }
    return this.publish(workspaceRoot);
  }

  async previewLaneChanges(
    workspaceRoot: string,
    laneId: string,
  ): Promise<CodingLaneChangePreview> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const executionRoot = this.executionRoot(lane, workspaceRoot);
    if (this.requiresWriterLease(lane.sourceRoot, executionRoot)) {
      throw new Error('Only isolated collaborator worktrees can be previewed for application.');
    }
    if (!this.runtime.getIsolatedWorkspaceDiff) {
      throw new Error('The coding runtime cannot inspect isolated workspace changes.');
    }
    return { laneId: lane.id, diff: await this.runtime.getIsolatedWorkspaceDiff(executionRoot) };
  }

  async applyLaneChanges(workspaceRoot: string, laneId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const executionRoot = this.executionRoot(lane, workspaceRoot);
    if (this.requiresWriterLease(lane.sourceRoot, executionRoot)) {
      throw new Error('Only isolated collaborator worktrees can be applied.');
    }
    if (this.repository.getWriterLease(snapshot.room.id, lane.sourceRoot)) {
      throw new Error('Wait for the active workspace writer before applying collaborator changes.');
    }
    if (!this.runtime.applyIsolatedWorkspaceDiff) {
      throw new Error('The coding runtime cannot apply isolated workspace changes.');
    }
    await this.runtime.applyIsolatedWorkspaceDiff({
      workspaceRoot: lane.sourceRoot,
      isolatedWorkspaceRoot: executionRoot,
    });
    this.repository.appendEvent(lane.id, CodingEventKind.FileChange, {
      role: 'system',
      action: 'applied_to_workspace',
      workspaceRoot: lane.sourceRoot,
    });
    return this.publish(workspaceRoot);
  }

  async getGitStatus(input: CodingGitTargetInput): Promise<CodingGitStatus> {
    return await this.git.getStatus(input);
  }

  async getGitDiff(input: CodingGitDiffInput): Promise<string> {
    return await this.git.getDiff(input);
  }

  async stageGitPaths(input: CodingGitPathActionInput): Promise<CodingGitStatus> {
    return await this.git.stage(input);
  }

  async unstageGitPaths(input: CodingGitPathActionInput): Promise<CodingGitStatus> {
    return await this.git.unstage(input);
  }

  async commitGitChanges(input: CodingGitCommitInput): Promise<CodingGitStatus> {
    return await this.git.commit(input);
  }

  async pushGitBranch(input: CodingGitTargetInput): Promise<CodingGitStatus> {
    return await this.git.push(input);
  }

  async probeAgent(workspaceRoot: string, profileId: string): Promise<CodingRoomSnapshot> {
    await this.registry.probe(profileId, workspaceRoot);
    return this.publish(workspaceRoot);
  }

  async discoverAgents(workspaceRoot: string): Promise<CodingRoomSnapshot> {
    await this.registry.discoverExternalAgents();
    return this.publish(workspaceRoot);
  }

  addProfile(workspaceRoot: string, input: AddCodingAgentProfileInput): CodingRoomSnapshot {
    this.registry.addUntrustedProfile(input);
    return this.publish(workspaceRoot);
  }

  trustProfile(workspaceRoot: string, profileId: string): CodingRoomSnapshot {
    this.registry.trust(profileId);
    return this.publish(workspaceRoot);
  }

  async authenticateProfile(
    workspaceRoot: string,
    profileId: string,
    methodId: string,
  ): Promise<CodingRoomSnapshot> {
    const profile = this.registry.get(profileId);
    if (!profile || profile.isBuiltin || profile.status !== CodingAgentProfileStatus.NeedsAuth) {
      throw new Error('The coding agent profile is not waiting for authentication.');
    }
    const method = profile.authMethods.find(candidate => candidate.id === methodId);
    if (!method) throw new Error('The coding agent authentication method was not found.');
    if (method.type === 'terminal') {
      throw new Error('This coding agent requires interactive terminal authentication.');
    }
    const driver = this.driverFactory.create(profile);
    try {
      await driver.authenticate({ methodId, workspaceRoot });
      this.registry.markReady(profileId);
    } finally {
      await driver.dispose();
    }
    return this.publish(workspaceRoot);
  }

  startTerminalAuthentication(
    workspaceRoot: string,
    profileId: string,
    methodId: string,
  ): { id: string; profileId: string; methodId: string } {
    const profile = this.registry.get(profileId);
    if (!profile || profile.isBuiltin || profile.status !== CodingAgentProfileStatus.NeedsAuth) {
      throw new Error('The coding agent profile is not waiting for authentication.');
    }
    const method = profile.authMethods.find(candidate => candidate.id === methodId);
    if (!method || method.type !== 'terminal' || !profile.command) {
      throw new Error('The coding agent terminal authentication method is not available.');
    }
    return this.authTerminals.start({
      profileId,
      methodId,
      executable: profile.command,
      baseArgs: profile.args,
      authArgs: method.args ?? [],
      cwd: workspaceRoot,
      environment: this.allowedEnvironment(),
      authEnvironment: method.environment,
    });
  }

  writeAuthTerminal(id: string, data: string): void {
    this.authTerminals.write(id, data);
  }

  resizeAuthTerminal(id: string, columns: number, rows: number): void {
    this.authTerminals.resize(id, columns, rows);
  }

  cancelAuthTerminal(id: string): void {
    this.authTerminals.cancel(id);
  }

  async respondToPermission(
    workspaceRoot: string,
    response: CodingPermissionResponse,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const event = snapshot.events.find(
      candidate =>
        candidate.kind === CodingEventKind.Permission &&
        candidate.payload.requestId === response.requestId,
    );
    if (!event) throw new Error('The coding permission request was not found.');
    const lane = this.requireLane(snapshot.lanes, event.laneId);
    if (this.registry.get(lane.profileId)?.driverKind === CodingAgentDriverKind.Builtin) {
      if (!this.runtime.respondBuiltinPermission) {
        throw new Error('The built-in coding runtime cannot respond to permissions.');
      }
      this.runtime.respondBuiltinPermission(
        response.requestId,
        response.outcome === CodingPermissionOutcome.Selected,
      );
      if (response.outcome === CodingPermissionOutcome.Selected) {
        this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
        this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
        this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
      }
      this.repository.appendEvent(lane.id, CodingEventKind.ToolCall, {
        permissionRequestId: response.requestId,
        permissionOutcome: response.outcome,
      });
      return this.publish(workspaceRoot);
    }
    await this.getDriver(lane).respondToPermission(response);
    this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
    this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
    this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
    this.repository.appendEvent(lane.id, CodingEventKind.ToolCall, {
      permissionRequestId: response.requestId,
      permissionOutcome: response.outcome,
      optionId: response.optionId,
    });
    return this.publish(workspaceRoot);
  }

  recordBuiltinEvent(
    sessionId: string,
    kind: (typeof CodingEventKind)[keyof typeof CodingEventKind],
    payload: Record<string, unknown>,
  ): void {
    const laneId = this.builtinSessionLaneMap.get(sessionId);
    if (!laneId) {
      // Cache miss: scan rooms once to find the lane, then cache the mapping.
      for (const workspaceRoot of this.knownRooms()) {
        const snapshot = this.bootstrap(workspaceRoot);
        const lane = snapshot.lanes.find(candidate => candidate.localSessionId === sessionId);
        if (!lane) continue;
        this.builtinSessionLaneMap.set(sessionId, lane.id);
        this.applyBuiltinEvent(workspaceRoot, snapshot, lane, kind, payload);
        return;
      }
      return;
    }
    // Fast path: use cached lane mapping without re-scanning rooms.
    for (const workspaceRoot of this.knownRooms()) {
      const snapshot = this.bootstrap(workspaceRoot);
      const lane = snapshot.lanes.find(candidate => candidate.id === laneId);
      if (!lane) continue;
      this.applyBuiltinEvent(workspaceRoot, snapshot, lane, kind, payload);
      return;
    }
  }

  private applyBuiltinEvent(
    workspaceRoot: string,
    snapshot: CodingRoomSnapshot,
    lane: CodingAgentLane,
    kind: (typeof CodingEventKind)[keyof typeof CodingEventKind],
    payload: Record<string, unknown>,
  ): void {
    this.repository.appendOrMergeStreamEvent(lane.id, kind, payload);
    if (kind === CodingEventKind.Permission) {
      this.repository.updateLaneStatus(lane.id, CodingLaneStatus.WaitingApproval);
      this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.WaitingApproval);
      this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.WaitingApproval);
    }
    if (kind === CodingEventKind.TurnComplete) {
      this.finishTurn(
        snapshot.room.id,
        snapshot.room.workspaceRoot,
        lane,
        CodingLaneStatus.Completed,
      );
      this.publish(workspaceRoot);
      return;
    }
    if (kind === CodingEventKind.TurnFailed) {
      this.finishTurn(snapshot.room.id, snapshot.room.workspaceRoot, lane, CodingLaneStatus.Failed);
      this.publish(workspaceRoot);
      return;
    }
    // Throttle streaming events to avoid flooding the renderer with publishes.
    this.scheduleBuiltinPublish(workspaceRoot);
  }

  private scheduleBuiltinPublish(workspaceRoot: string): void {
    if (this.builtinPublishTimer || this.isDisposed) return;
    this.builtinPublishTimer = setTimeout(() => {
      this.builtinPublishTimer = null;
      if (!this.isDisposed) {
        try {
          this.publish(workspaceRoot);
        } catch (error) {
          // The database may have been closed during test teardown.
          console.debug('[CodingRoom] Skipped publish because the service is disposed:', error);
        }
      }
    }, this.BUILTIN_PUBLISH_THROTTLE_MS);
  }

  private isDisposed = false;

  recordBuiltinInterruption(interruption: CoworkSessionInterruption): void {
    for (const workspaceRoot of this.knownRooms()) {
      const snapshot = this.bootstrap(workspaceRoot);
      const lane = snapshot.lanes.find(
        candidate => candidate.localSessionId === interruption.sessionId,
      );
      if (!lane) continue;
      this.repository.appendEvent(lane.id, CodingEventKind.TurnCancelled, {
        reason: interruption.cause,
        interruption,
      });
      this.repository.updateLaneStatus(lane.id, CodingLaneStatus.Idle);
      this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.NeedsReview);
      this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Planned);
      this.publish(workspaceRoot);
      return;
    }
  }

  async dispose(): Promise<void> {
    this.isDisposed = true;
    await Promise.all([...this.drivers.values()].map(driver => driver.dispose()));
    this.drivers.clear();
    this.driverProfileIds.clear();
    this.driverSessionIds.clear();
    this.driverSessionPromises.clear();
    this.authTerminals.dispose();
    this.builtinSessionLaneMap.clear();
    if (this.builtinPublishTimer) {
      clearTimeout(this.builtinPublishTimer);
      this.builtinPublishTimer = null;
    }
  }

  private getDriver(lane: CodingAgentLane): CodingAgentDriver {
    const existing = this.drivers.get(lane.id);
    if (existing) return existing;
    const profile = this.registry.get(lane.profileId);
    if (!profile) throw new Error('Coding agent profile was not found.');
    const driver = this.driverFactory.create(profile);
    this.registerDriver(lane, profile, driver);
    return driver;
  }

  private registerDriver(
    lane: CodingAgentLane,
    profile: CodingAgentProfile,
    driver: CodingAgentDriver,
  ): void {
    driver.onAvailableCommandsChanged((_sessionId, commands) => {
      this.repository.updateLaneAvailableCommands(lane.id, commands);
      if (!this.stagedLaneIds.has(lane.id)) this.publishLane(lane.id);
    });
    driver.onSessionTitleChanged((_sessionId, title) => {
      this.repository.updateMissionTitle(lane.missionId, title);
      if (!this.stagedLaneIds.has(lane.id)) this.publishLane(lane.id);
    });
    this.drivers.set(lane.id, driver);
    this.driverProfileIds.set(lane.id, profile.id);
  }

  private async rollbackCreatedSession(roomId: string, lane: CodingAgentLane): Promise<void> {
    const driver = this.drivers.get(lane.id);
    const session = this.driverSessionIds.get(lane.id);
    if (driver && session) {
      try {
        await driver.disposeSession(session.id);
      } catch {
        // The failed creation is already being rolled back locally.
      }
    }
    if (driver) {
      try {
        await driver.dispose();
      } catch {
        // The failed creation is already being rolled back locally.
      }
    }
    this.drivers.delete(lane.id);
    this.driverProfileIds.delete(lane.id);
    this.driverSessionIds.delete(lane.id);
    this.driverSessionPromises.delete(lane.id);
    this.builtinSessionLaneMap.delete(lane.localSessionId);
    this.repository.deleteMission(roomId, lane.missionId);
  }

  private async ensureDriverSession(
    driver: CodingAgentDriver,
    lane: CodingAgentLane,
    workspaceRoot: string,
  ): Promise<{ id: string; recoveryContext: string | null }> {
    const activeSession = this.driverSessionIds.get(lane.id);
    if (
      activeSession &&
      (activeSession.connectionGeneration === null ||
        (driver.isConnectionRunning?.() &&
          driver.getConnectionGeneration?.() === activeSession.connectionGeneration))
    ) {
      return { id: activeSession.id, recoveryContext: null };
    }
    const pendingSession = this.driverSessionPromises.get(lane.id);
    if (pendingSession) return await pendingSession;
    const sessionPromise = this.openDriverSession(driver, lane, workspaceRoot);
    this.driverSessionPromises.set(lane.id, sessionPromise);
    try {
      return await sessionPromise;
    } finally {
      if (this.driverSessionPromises.get(lane.id) === sessionPromise) {
        this.driverSessionPromises.delete(lane.id);
      }
    }
  }

  private async openDriverSession(
    driver: CodingAgentDriver,
    lane: CodingAgentLane,
    workspaceRoot: string,
  ): Promise<{ id: string; recoveryContext: string | null }> {
    let recoveryContext: string | null = null;
    let session;
    if (lane.remoteSessionId) {
      try {
        session = await driver.loadSession({
          remoteSessionId: lane.remoteSessionId,
          workspaceRoot,
        });
      } catch (error) {
        recoveryContext = this.buildRecoveryContext(lane.id);
        this.repository.appendEvent(lane.id, CodingEventKind.Message, {
          role: 'system',
          content: t('codingAgentSessionRecovery'),
          error: this.errorMessage(error),
        });
        session = await driver.createSession({
          workspaceRoot,
          localSessionId: lane.localSessionId,
          existingConfigOptions: lane.configOptions,
        });
      }
    } else {
      session = await driver.createSession({
        workspaceRoot,
        localSessionId: lane.localSessionId,
        existingConfigOptions: lane.configOptions,
      });
    }
    this.driverSessionIds.set(lane.id, {
      id: session.id,
      connectionGeneration: driver.getConnectionGeneration?.() ?? null,
    });
    if (session.remoteSessionId !== lane.remoteSessionId) {
      this.repository.updateLaneRemoteSession(lane.id, session.remoteSessionId);
    }
    this.repository.updateLaneConfigOptions(lane.id, session.configOptions);
    this.repository.updateLaneAvailableCommands(lane.id, session.availableCommands);
    return { id: session.id, recoveryContext };
  }

  private async runTurn(
    roomWorkspaceRoot: string,
    executionRoot: string,
    roomId: string,
    lane: CodingAgentLane,
    driverKind: (typeof CodingAgentDriverKind)[keyof typeof CodingAgentDriverKind],
    driver: CodingAgentDriver,
    sessionId: string,
    prompt: string,
    queuedItemId: string | undefined,
    turnGeneration: number,
    attachments?: CodingPromptAttachment[],
  ): Promise<void> {
    try {
      let receivedAssistantResponse = false;
      for await (const event of driver.prompt({
        sessionId,
        workspaceRoot: executionRoot,
        prompt,
        attachments,
        modelOverride: lane.modelOverride,
      })) {
        if (isAssistantResponseEvent(event)) receivedAssistantResponse = true;
        this.repository.appendOrMergeStreamEvent(lane.id, event.kind, event.payload);
        this.repository.updateLaneConfigOptions(lane.id, driver.getSessionConfigOptions(sessionId));
        this.repository.updateLaneAvailableCommands(
          lane.id,
          driver.getSessionAvailableCommands(sessionId),
        );
        if (event.kind === CodingEventKind.Permission) {
          this.repository.updateLaneStatus(lane.id, CodingLaneStatus.WaitingApproval);
          this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.WaitingApproval);
          const assignment = this.repository.getLatestAssignmentForLane(lane.id);
          if (assignment) {
            this.repository.updateAssignmentStatus(
              assignment.id,
              CodingAssignmentStatus.WaitingApproval,
            );
          }
        }
        this.publish(roomWorkspaceRoot);
      }
      if (this.consumeCancelledTurn(lane.id, turnGeneration)) {
        if (queuedItemId) this.deletePendingMessage(lane.id, queuedItemId);
        return;
      }
      if (driverKind !== CodingAgentDriverKind.Builtin && !receivedAssistantResponse) {
        throw new Error(t('codingAgentNoAssistantResponse'));
      }
      if (driverKind === CodingAgentDriverKind.Builtin) {
        const workbench = this.runtime.getBuiltinWorkbenchLink(lane.localSessionId);
        const assignment = this.repository.getLatestAssignmentForLane(lane.id);
        if (workbench && assignment) {
          this.repository.linkAssignmentWorkbench(assignment.id, workbench.taskId, workbench.runId);
        }
      }
      if (driverKind !== CodingAgentDriverKind.Builtin) {
        const answer = this.eventsToAnswer(lane.id);
        const assignment = this.repository.getLatestAssignmentForLane(lane.id);
        if (assignment?.workbenchRunId) {
          this.runtime.completeExternalWorkbenchRun({
            sessionId: lane.localSessionId,
            runId: assignment.workbenchRunId,
            workspaceRoot: executionRoot,
            finalAnswer: answer,
          });
        }
        this.repository.appendEvent(lane.id, CodingEventKind.TurnComplete, {});
        this.finishTurn(roomId, roomWorkspaceRoot, lane, CodingLaneStatus.Completed);
        if (queuedItemId) this.deletePendingMessage(lane.id, queuedItemId);
        this.startNextAcpPendingMessage(roomWorkspaceRoot, lane);
      }
      this.publish(roomWorkspaceRoot);
    } catch (error) {
      if (this.consumeCancelledTurn(lane.id, turnGeneration)) {
        if (queuedItemId) this.deletePendingMessage(lane.id, queuedItemId);
        return;
      }
      const assignment = this.repository.getLatestAssignmentForLane(lane.id);
      if (assignment?.workbenchRunId) {
        this.runtime.failExternalWorkbenchRun?.({
          sessionId: lane.localSessionId,
          runId: assignment.workbenchRunId,
          error: this.errorMessage(error),
        });
      }
      this.repository.appendEvent(lane.id, CodingEventKind.TurnFailed, {
        error: this.errorMessage(error),
      });
      if (queuedItemId) this.failAcpPendingMessage(lane.id, queuedItemId, error);
      this.finishTurn(roomId, roomWorkspaceRoot, lane, this.failureStatus(lane, error));
      this.publish(roomWorkspaceRoot);
    }
  }

  private startNextAcpPendingMessage(workspaceRoot: string, lane: CodingAgentLane): void {
    const profile = this.registry.get(lane.profileId);
    if (profile?.driverKind !== CodingAgentDriverKind.Acp) return;
    const next = this.acpPendingMessages
      .get(lane.id)
      ?.find(item => item.status === CoworkQueueItemStatus.Pending);
    if (!next) return;
    next.status = CoworkQueueItemStatus.Sending;
    this.emitPendingMessagesChanged(lane.id);
    void this.prompt(workspaceRoot, { laneId: lane.id, prompt: next.text }, next.id).catch(
      error => {
        console.error('[CodingRoom] failed to start queued ACP message:', error);
      },
    );
  }

  private beginLaneTurn(laneId: string): number {
    const turnGeneration = (this.laneTurnGenerations.get(laneId) ?? 0) + 1;
    this.laneTurnGenerations.set(laneId, turnGeneration);
    return turnGeneration;
  }

  private consumeCancelledTurn(laneId: string, turnGeneration: number): boolean {
    if (this.cancelledTurnGenerations.get(laneId) !== turnGeneration) {
      return false;
    }
    this.cancelledTurnGenerations.delete(laneId);
    return true;
  }

  private failAcpPendingMessage(laneId: string, itemId: string, error: unknown): void {
    const item = (this.acpPendingMessages.get(laneId) ?? []).find(
      candidate => candidate.id === itemId,
    );
    if (!item) return;
    item.status = CoworkQueueItemStatus.Failed;
    item.error = this.errorMessage(error);
    this.emitPendingMessagesChanged(laneId);
  }

  private finishTurn(
    roomId: string,
    roomWorkspaceRoot: string,
    lane: CodingAgentLane,
    laneStatus: CodingLaneStatus,
  ): void {
    this.repository.updateLaneStatus(lane.id, laneStatus);
    this.repository.updateMissionStatus(
      lane.missionId,
      laneStatus === CodingLaneStatus.Completed
        ? CodingMissionStatus.NeedsReview
        : CodingMissionStatus.Failed,
    );
    const assignment = this.repository.getLatestAssignmentForLane(lane.id);
    if (assignment) {
      this.repository.updateAssignmentStatus(
        assignment.id,
        laneStatus === CodingLaneStatus.Completed
          ? CodingAssignmentStatus.NeedsReview
          : CodingAssignmentStatus.Failed,
      );
    }
    if (this.requiresWriterLease(lane.sourceRoot, this.executionRoot(lane, roomWorkspaceRoot))) {
      this.repository.releaseWriterLease(roomId, lane.sourceRoot, lane.id);
    }
    if (laneStatus === CodingLaneStatus.Completed) {
      void this.startNextCollaborationStage(roomWorkspaceRoot, lane.id);
    }
  }

  private updateLaneAssignmentStatus(
    snapshot: CodingRoomSnapshot,
    laneId: string,
    status: CodingAssignmentStatus,
  ): void {
    const assignment = snapshot.assignments.find(candidate => candidate.laneId === laneId);
    if (assignment) this.repository.updateAssignmentStatus(assignment.id, status);
  }

  private linkLaneAssignment(
    snapshot: CodingRoomSnapshot,
    laneId: string,
    workbenchTaskId: string,
    workbenchRunId: string,
  ): void {
    const assignment = snapshot.assignments.find(candidate => candidate.laneId === laneId);
    if (assignment)
      this.repository.linkAssignmentWorkbench(assignment.id, workbenchTaskId, workbenchRunId);
  }

  private eventsToAnswer(laneId: string): string {
    return this.repository
      .listEvents([laneId])
      .map(event => event.payload.content)
      .filter((content): content is string => typeof content === 'string')
      .join('\n');
  }

  private handoffPrompt(content: Record<string, unknown>): string {
    return `You are receiving a coding handoff. Continue from this handoff package:\n${JSON.stringify(
      content,
      null,
      2,
    )}`;
  }

  private async startNextCollaborationStage(
    workspaceRoot: string,
    completedLaneId: string,
  ): Promise<void> {
    const snapshot = this.bootstrap(workspaceRoot);
    const completedAssignment = snapshot.assignments.find(
      assignment => assignment.laneId === completedLaneId,
    );
    if (!completedAssignment) return;
    const nextAssignment = snapshot.assignments.find(
      assignment =>
        assignment.status === CodingAssignmentStatus.Planned &&
        assignment.previousAssignmentId === completedAssignment.id,
    );
    if (!nextAssignment) return;
    const source = this.requireLane(snapshot.lanes, completedLaneId);
    const target = this.requireLane(snapshot.lanes, nextAssignment.laneId);
    if (source.missionId !== target.missionId) return;
    const implementation = snapshot.assignments.find(
      assignment =>
        assignment.missionId === source.missionId &&
        assignment.workflowStage === CodingWorkflowStage.Implementation,
    );
    const implementationLane = implementation
      ? snapshot.lanes.find(lane => lane.id === implementation.laneId)
      : null;
    const handoff = this.collaboration.buildHandoff({
      snapshot,
      sourceLane: source,
      targetLane: target,
      baseline: this.requireMissionBaseline(
        snapshot.missions.find(mission => mission.id === source.missionId),
      ),
      diff: await this.getWorkspaceDiff(this.executionRoot(source, workspaceRoot)),
    });
    if (implementationLane && implementationLane.id !== source.id) {
      handoff.implementationDiff = await this.getWorkspaceDiff(
        this.executionRoot(implementationLane, workspaceRoot),
      );
    }
    const implementationDiff =
      typeof handoff.implementationDiff === 'string' ? handoff.implementationDiff : null;
    if (implementationDiff?.trim()) {
      if (!this.runtime.applyWorkspacePatch) {
        throw new Error('The coding runtime cannot materialize a collaborator patch.');
      }
      await this.runtime.applyWorkspacePatch({
        workspaceRoot: this.executionRoot(target, workspaceRoot),
        patch: implementationDiff,
      });
    }
    const handoffId = this.repository.createHandoff(
      source.missionId,
      source.id,
      target.id,
      handoff,
    );
    this.repository.appendEvent(target.id, CodingEventKind.Message, {
      role: 'handoff',
      handoffId,
      content: handoff,
    });
    await this.prompt(workspaceRoot, { laneId: target.id, prompt: this.handoffPrompt(handoff) });
  }

  private buildRecoveryContext(laneId: string): string {
    const context = this.eventsToAnswer(laneId).trim();
    return context
      ? `Continue this coding task from the following handoff summary:\n${context}`
      : 'Continue this coding task in a new session. The prior session is unavailable.';
  }

  private failureStatus(lane: CodingAgentLane, error: unknown): CodingLaneStatus {
    const profile = this.registry.get(lane.profileId);
    if (
      profile?.driverKind !== CodingAgentDriverKind.Builtin &&
      /auth_required|authentication(?:\s+is)?\s+required|login required/i.test(
        this.errorMessage(error),
      )
    ) {
      this.registry.markNeedsAuth(profile.id);
      return CodingLaneStatus.NeedsAuth;
    }
    return CodingLaneStatus.Failed;
  }

  private publish(workspaceRoot: string): CodingRoomSnapshot {
    const snapshot = this.bootstrap(workspaceRoot);
    this.emit('changed', snapshot);
    return snapshot;
  }

  private publishLane(laneId: string): void {
    for (const workspaceRoot of this.knownRooms()) {
      const snapshot = this.bootstrap(workspaceRoot);
      if (!snapshot.lanes.some(lane => lane.id === laneId)) continue;
      this.emit('changed', snapshot);
      return;
    }
  }

  private requireLane(lanes: CodingAgentLane[], laneId: string): CodingAgentLane {
    const lane = lanes.find(candidate => candidate.id === laneId);
    if (!lane) throw new Error('Coding agent lane was not found.');
    return lane;
  }

  private knownRooms(): string[] {
    return this.repository.listRooms().map(room => room.workspaceRoot);
  }

  private executionRoot(lane: CodingAgentLane, roomWorkspaceRoot: string): string {
    return lane.executionRoot || roomWorkspaceRoot;
  }

  private async getWorkspaceBaseline(workspaceRoot: string): Promise<string | null> {
    if (!this.runtime.getWorkspaceBaseline) return null;
    try {
      return await this.runtime.getWorkspaceBaseline(workspaceRoot);
    } catch (error) {
      console.debug('[CodingRoom] Unable to read the workspace Git baseline:', error);
      return null;
    }
  }

  private async getWorkspaceDiff(workspaceRoot: string): Promise<string | null> {
    if (!this.runtime.getWorkspaceDiff) return null;
    try {
      return await this.runtime.getWorkspaceDiff(workspaceRoot);
    } catch (error) {
      console.debug('[CodingRoom] Unable to read the workspace Git diff:', error);
      return null;
    }
  }

  private requireMissionBaseline(mission: { gitBaseline: string | null } | undefined): string {
    if (!mission?.gitBaseline) {
      throw new Error('Parallel collaborators require a Git workspace with a frozen baseline.');
    }
    return mission.gitBaseline;
  }

  private allowedEnvironment(): Record<string, string | undefined> {
    return Object.fromEntries(ACP_ENVIRONMENT_KEYS.map(key => [key, process.env[key]]));
  }

  private async completeTerminalAuthentication(event: {
    id: string;
    profileId: string;
    methodId: string;
    exitCode: number;
    signal?: number;
  }): Promise<void> {
    for (const [laneId, profileId] of this.driverProfileIds) {
      if (profileId !== event.profileId) continue;
      await this.drivers.get(laneId)?.dispose();
      this.drivers.delete(laneId);
      this.driverProfileIds.delete(laneId);
      this.driverSessionIds.delete(laneId);
    }
    if (event.exitCode === 0) {
      const profile = this.registry.get(event.profileId);
      if (!profile) {
        console.warn(
          '[CodingRoom] Authentication completed for an unavailable coding agent profile.',
        );
      } else {
        const driver = this.driverFactory.create(profile);
        try {
          await driver.getAuthState();
          this.registry.markReady(event.profileId);
        } catch (error) {
          console.warn(
            '[CodingRoom] ACP reinitialization after terminal authentication failed:',
            error,
          );
          this.registry.markNeedsAuth(event.profileId);
        } finally {
          await driver.dispose();
        }
      }
    } else {
      this.registry.markNeedsAuth(event.profileId);
    }
    this.emit('authTerminalExit', event);
  }

  private requireWorkspaceName(value: string): string {
    const name = value.trim();
    if (!name) throw new Error('Coding workspace name is required.');
    return name;
  }

  private requireProfile(profileId: string): CodingAgentProfile {
    this.registry.refreshBuiltinReadiness();
    const profile = this.registry.get(profileId);
    if (!profile) throw new Error('Coding agent profile was not found.');
    return profile;
  }

  private requireSourceFolders(values: string[]): string[] {
    const folders = [
      ...new Set(
        values
          .map(value => value.trim())
          .filter(Boolean)
          .map(value => path.resolve(value)),
      ),
    ];
    if (!folders.length) throw new Error('A coding workspace requires at least one source folder.');
    for (const folder of folders) {
      if (path.parse(folder).root === folder) {
        throw new Error('A filesystem root cannot be used as a coding workspace source.');
      }
      let stat;
      try {
        stat = statSync(folder);
      } catch {
        throw new Error(`Coding workspace source does not exist: ${folder}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Coding workspace source is not a directory: ${folder}`);
      }
    }
    return folders;
  }

  private requiresWriterLease(sourceRoot: string, executionRoot: string): boolean {
    return path.resolve(sourceRoot) === path.resolve(executionRoot);
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
