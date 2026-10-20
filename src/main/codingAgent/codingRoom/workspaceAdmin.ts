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
import { CodingRoomServiceDriverLifecycle } from './driverLifecycle';

/** Workspace CRUD plus per-lane view and config settings. */
export abstract class CodingRoomServiceWorkspaceAdmin extends CodingRoomServiceDriverLifecycle {
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
      void this.drivers.get(lane.id)?.dispose();
      this.drivers.delete(lane.id);
      this.driverProfileIds.delete(lane.id);
      this.driverSessionIds.delete(lane.id);
      this.driverSessionPromises.delete(lane.id);
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
      void this.drivers.get(removed.id)?.dispose();
      this.drivers.delete(removed.id);
      this.driverProfileIds.delete(removed.id);
      this.driverSessionIds.delete(removed.id);
      this.driverSessionPromises.delete(removed.id);
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
}
