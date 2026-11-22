import { stat } from 'node:fs/promises';
import path from 'path';
import {
  CodingErrorDetailMessage,
  CodingErrorMessage,
  CodingLaneStatus,
  CodingWorkflowStage,
  type CodingAgentProfile,
  type CodingWorkspaceSummary,
  type CreateCodingWorkspaceInput,
  type UpdateCodingWorkspaceInput,
} from '../../../shared/codingAgent';
import type { CodingAgentRegistry } from '../codingAgentRegistry';
import type { CodingRoomRepository } from '../codingRoomRepository';
import type { CodingDriverPool } from './codingDriverPool';

export class CodingRoomWorkspaces {
  constructor(
    private readonly repository: CodingRoomRepository,
    private readonly registry: CodingAgentRegistry,
    private readonly driverPool: CodingDriverPool,
    private readonly publish: (workspaceRoot: string) => void,
  ) {}

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

  async createWorkspace(input: CreateCodingWorkspaceInput): Promise<CodingWorkspaceSummary[]> {
    const name = this.requireWorkspaceName(input.name);
    const sourceFolders = await this.requireSourceFolders(input.sourceFolders);
    const defaultProfileId = this.requireProfile(input.defaultProfileId).id;
    if (sourceFolders.some(source => this.repository.findWorkspaceIdBySource(source))) {
      throw new Error(CodingErrorMessage.WorkspaceSourceInUse);
    }
    this.repository.createWorkspace(name, sourceFolders, defaultProfileId);
    return this.listWorkspaces();
  }

  async updateWorkspace(input: UpdateCodingWorkspaceInput): Promise<CodingWorkspaceSummary[]> {
    if (!this.repository.getRoomById(input.workspaceId)) {
      throw new Error(CodingErrorMessage.WorkspaceNotFound);
    }
    const name = this.requireWorkspaceName(input.name);
    const sourceFolders = await this.requireSourceFolders(input.sourceFolders);
    const room = this.repository.getRoomById(input.workspaceId);
    if (!room) throw new Error(CodingErrorMessage.WorkspaceNotFound);
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
      void this.driverPool
        .retire(lane.id)
        .catch(error =>
          console.warn(`[CodingRoom] Failed to stop the agent for lane ${lane.id}:`, error),
        );
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
      void this.driverPool
        .retire(removed.id)
        .catch(error =>
          console.warn(`[CodingRoom] Failed to stop the agent for lane ${removed.id}:`, error),
        );
    }
    if (isPrimaryLane) {
      this.repository.deleteMission(room.id, lane.missionId);
    } else {
      this.repository.deleteLane(room.id, lane.id);
    }
    this.publish(room.workspaceRoot);
    return this.listWorkspaces();
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

  private async requireSourceFolders(values: string[]): Promise<string[]> {
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
      let info;
      try {
        info = await stat(folder);
      } catch {
        throw new Error(`${CodingErrorDetailMessage.WorkspaceSourceMissing} ${folder}`);
      }
      if (!info.isDirectory()) {
        throw new Error(`${CodingErrorDetailMessage.WorkspaceSourceNotDirectory} ${folder}`);
      }
    }
    return folders;
  }
}
