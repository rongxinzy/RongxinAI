import { statSync } from 'fs';
import path from 'path';
import {
  CodingAgentDriverKind,
  CodingErrorDetailMessage,
  CodingErrorMessage,
  CodingEventKind,
  CodingLaneStatus,
  CodingWorkflowStage,
  type CodingAgentProfile,
  type CodingLaneChangePreview,
  type CodingLaneConfigOptionInput,
  type CodingLaneViewStateInput,
  type CodingRoomSnapshot,
  type CreateCodingWorkspaceInput,
  type CodingWorkspaceSummary,
  type UpdateCodingWorkspaceInput,
} from '../../../shared/codingAgent';
import { CodingRoomServiceFoundation } from './serviceFoundation';
import {
  persistCodingSessionRecord,
  prepareCodingSession,
  resolveSessionTarget,
} from '../codingSessionStartup';
import { t } from '../../i18n';
import {
  CodingAgentProfileStatus,
  CodingElicitationStatus,
  type CodingAgentAvailableCommand,
  type CodingAgentConfigOption,
  type CodingPromptInput,
  type CreateCodingMissionInput,
  type CreateCodingSessionInput,
  type StartCodingSessionInput,
} from '../../../shared/codingAgent';

/** Workspace CRUD plus per-lane view and config settings. */
export abstract class CodingRoomServiceWorkspaceAdmin extends CodingRoomServiceFoundation {
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
      throw new Error(CodingErrorMessage.WorkspaceSourceInUse);
    }
    this.repository.createWorkspace(name, sourceFolders, defaultProfileId);
    return this.listWorkspaces();
  }

  updateWorkspace(input: UpdateCodingWorkspaceInput): CodingWorkspaceSummary[] {
    const room = this.repository.getRoomById(input.workspaceId);
    if (!room) throw new Error(CodingErrorMessage.WorkspaceNotFound);
    const name = this.requireWorkspaceName(input.name);
    const sourceFolders = this.requireSourceFolders(input.sourceFolders);
    const defaultProfileId = this.requireProfile(input.defaultProfileId).id;
    const missions = this.repository.listMissions(room.id);
    const lanes = this.repository.listLanes(missions.map(mission => mission.id));
    const referencedSources = new Set(lanes.map(lane => path.resolve(lane.sourceRoot)));
    const nextSources = new Set(sourceFolders);
    if ([...referencedSources].some(source => !nextSources.has(source))) {
      throw new Error(CodingErrorMessage.WorkspaceSourceNotRemovable);
    }
    if (missions.length > 0 && sourceFolders[0] !== path.resolve(room.workspaceRoot)) {
      throw new Error(CodingErrorMessage.WorkspacePrimaryLocked);
    }
    if (
      sourceFolders.some(source => {
        const owner = this.repository.findWorkspaceIdBySource(source);
        return owner !== null && owner !== room.id;
      })
    ) {
      throw new Error(CodingErrorMessage.WorkspaceSourceInUse);
    }
    const conflict = this.repository.getRoomByRoot(sourceFolders[0]);
    if (conflict && conflict.id !== room.id) {
      throw new Error(CodingErrorMessage.WorkspacePrimaryInUse);
    }
    this.repository.updateWorkspace(room.id, name, sourceFolders, defaultProfileId);
    return this.listWorkspaces();
  }

  deleteWorkspace(workspaceId: string): CodingWorkspaceSummary[] {
    const room = this.repository.getRoomById(workspaceId);
    if (!room) throw new Error(CodingErrorMessage.WorkspaceNotFound);
    const missions = this.repository.listMissions(room.id);
    const lanes = this.repository.listLanes(missions.map(mission => mission.id));
    if (
      lanes.some(
        lane =>
          lane.status === CodingLaneStatus.Running ||
          lane.status === CodingLaneStatus.WaitingApproval ||
          lane.status === CodingLaneStatus.WaitingElicitation,
      )
    ) {
      throw new Error(CodingErrorMessage.WorkspaceSessionsRunning);
    }
    for (const lane of lanes) {
      void this.driverPool.driverFor(lane.id)?.dispose();
      this.driverPool.forget(lane.id);
      this.laneSessionIndex.forget(lane.localSessionId);
    }
    this.repository.deleteWorkspace(room.id);
    return this.listWorkspaces();
  }

  deleteSession(workspaceRoot: string, laneId: string): CodingWorkspaceSummary[] {
    const room =
      this.repository.getRoomByRoot(workspaceRoot) ??
      this.repository.getRoomByRoot(path.resolve(workspaceRoot));
    if (!room) throw new Error(CodingErrorMessage.WorkspaceNotFound);
    const missions = this.repository.listMissions(room.id);
    const lanes = this.repository.listLanes(missions.map(mission => mission.id));
    const lane = lanes.find(candidate => candidate.id === laneId);
    if (!lane) throw new Error(CodingErrorMessage.SessionNotFound);
    if (
      lane.status === CodingLaneStatus.Running ||
      lane.status === CodingLaneStatus.WaitingApproval ||
      lane.status === CodingLaneStatus.WaitingElicitation
    ) {
      throw new Error(CodingErrorMessage.SessionRunning);
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
      void this.driverPool.driverFor(removed.id)?.dispose();
      this.driverPool.forget(removed.id);
      this.laneSessionIndex.forget(removed.localSessionId);
    }
    if (isPrimaryLane) {
      this.repository.deleteMission(room.id, lane.missionId);
    } else {
      this.repository.deleteLane(room.id, lane.id);
    }
    this.publish(room.workspaceRoot);
    return this.listWorkspaces();
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
    if (!option) throw new Error(CodingErrorMessage.ConfigOptionNotFound);
    if (option.type === 'select') {
      if (
        typeof input.value !== 'string' ||
        !option.options?.some(candidate => candidate.value === input.value)
      ) {
        throw new Error(CodingErrorMessage.ConfigValueInvalid);
      }
    } else if (typeof input.value !== 'boolean') {
      throw new Error(CodingErrorMessage.ConfigValueInvalid);
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
      throw new Error(CodingErrorMessage.ModelSwitchBuiltinOnly);
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
      throw new Error(CodingErrorMessage.CollaboratorPreviewIsolatedOnly);
    }
    if (!this.runtime.getIsolatedWorkspaceDiff) {
      throw new Error(CodingErrorMessage.RuntimeIsolatedDiffUnsupported);
    }
    return { laneId: lane.id, diff: await this.runtime.getIsolatedWorkspaceDiff(executionRoot) };
  }

  async applyLaneChanges(workspaceRoot: string, laneId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    const executionRoot = this.executionRoot(lane, workspaceRoot);
    if (this.requiresWriterLease(lane.sourceRoot, executionRoot)) {
      throw new Error(CodingErrorMessage.CollaboratorApplyIsolatedOnly);
    }
    if (this.repository.getWriterLease(snapshot.room.id, lane.sourceRoot)) {
      throw new Error(CodingErrorMessage.WorkspaceWriterBusy);
    }
    if (!this.runtime.applyIsolatedWorkspaceDiff) {
      throw new Error(CodingErrorMessage.RuntimeIsolatedApplyUnsupported);
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

  private requireWorkspaceName(value: string): string {
    const name = value.trim();
    if (!name) throw new Error(CodingErrorMessage.WorkspaceNameRequired);
    return name;
  }

  private requireProfile(profileId: string): CodingAgentProfile {
    this.registry.refreshBuiltinReadiness();
    const profile = this.registry.get(profileId);
    if (!profile) throw new Error(CodingErrorMessage.ProfileNotFound);
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
    if (!folders.length) throw new Error(CodingErrorMessage.WorkspaceSourceRequired);
    for (const folder of folders) {
      if (path.parse(folder).root === folder) {
        throw new Error(CodingErrorMessage.WorkspaceSourceRootForbidden);
      }
      let stat;
      try {
        stat = statSync(folder);
      } catch {
        throw new Error(`${CodingErrorDetailMessage.WorkspaceSourceMissing} ${folder}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`${CodingErrorDetailMessage.WorkspaceSourceNotDirectory} ${folder}`);
      }
    }
    return folders;
  }

  // ── Session lifecycle (merged from sessionLifecycle.ts) ────────────────────
  /** Sends a prompt to a lane; implemented by the turn-execution layer. */
  abstract prompt(
    workspaceRoot: string,
    input: CodingPromptInput,
    queuedItemId?: string,
  ): Promise<CodingRoomSnapshot>;

  listProfiles() {
    this.registry.refreshBuiltinReadiness();
    return this.registry.list();
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
    if (!prompt) throw new Error(CodingErrorMessage.PromptRequired);
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
    this.turnTracker.stageLane(lane.id);
    // Register builtin session → lane mapping so recordBuiltinEvent can find
    // the lane without scanning every room.
    if (profile.driverKind === CodingAgentDriverKind.Builtin) {
      this.laneSessionIndex.register(lane.localSessionId, lane.id);
      // A newly registered lane may own sessions that previously missed the
      // mapping, so the negative cache must be reset, not patched.
      this.laneSessionIndex.clearNonLaneSessions();
    }
    try {
      this.registerDriver(lane, profile, driver);
      this.driverPool.setSession(lane.id, {
        id: driverSession.id,
        connectionGeneration: driver.getConnectionGeneration?.() ?? null,
      });
      const snapshot = await this.prompt(room.workspaceRoot, {
        laneId: lane.id,
        prompt,
        attachments: input.attachments,
      });
      this.turnTracker.unstageLane(lane.id);
      return snapshot;
    } catch (error) {
      this.turnTracker.unstageLane(lane.id);
      await this.rollbackCreatedSession(room.id, lane);
      this.publish(room.workspaceRoot);
      throw error;
    }
  }

  /** Running drivers are process-local, so an app restart must never leave stale lanes running. */
  recoverInterruptedState(): number {
    // A pending question is owned by the process that asked it, so anything
    // still pending belongs to a previous run: cancel it first, otherwise the
    // lane stays in WaitingElicitation and refuses prompts and deletion.
    const elicitationReason = t('codingAgentElicitationCancelledByRestart');
    const cancelledElicitations = this.repository.cancelPendingElicitations(elicitationReason);
    const interrupted = this.repository.recoverInterruptedLanes();
    for (const lane of interrupted) {
      this.repository.appendEvent(lane.id, CodingEventKind.TurnCancelled, {
        reason: 'application_restart',
      });
    }
    for (const elicitation of cancelledElicitations) {
      this.repository.appendEvent(elicitation.laneId, CodingEventKind.Elicitation, {
        requestId: elicitation.id,
        question: elicitation.question,
        cancelReason: elicitationReason,
        status: CodingElicitationStatus.Cancelled,
      });
    }
    return interrupted.length;
  }

  async createMission(input: CreateCodingMissionInput): Promise<CodingRoomSnapshot> {
    this.registry.refreshBuiltinReadiness();
    const profile = this.registry.get(input.profileId);
    if (!profile) throw new Error(CodingErrorMessage.ProfileNotFound);
    if (profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error(CodingErrorMessage.ProfileNotReady);
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
        profile.driverKind !== CodingAgentDriverKind.Builtin)
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

  /**
   * Commands a new session of this profile would start with. A draft has no
   * driver session yet, and the composer would otherwise show no slash commands
   * until the first turn creates one.
   */
  getProfileAvailableCommands(profileId: string): CodingAgentAvailableCommand[] {
    const profile = this.registry.get(profileId);
    if (!profile || profile.driverKind !== CodingAgentDriverKind.Builtin) return [];
    const driver = this.driverFactory.create(profile);
    return driver.getDefaultAvailableCommands?.() ?? [];
  }

  selectLane(workspaceRoot: string, laneId: string): CodingRoomSnapshot {
    const snapshot = this.bootstrap(workspaceRoot);
    const lane = this.requireLane(snapshot.lanes, laneId);
    this.repository.setActive(snapshot.room.id, lane.missionId, lane.id);
    return this.publish(workspaceRoot);
  }
}
