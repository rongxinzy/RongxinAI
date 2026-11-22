import {
  CodingAssignmentStatus,
  CodingErrorMessage,
  CodingEventKind,
  CodingWorkflowStage,
  type CodingAgentLane,
  type CodingPromptInput,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';
import type { CodingRoomRepository } from '../codingRoomRepository';
import { CollaborationService } from '../collaborationService';
import type { CodingRoomRuntime } from './runtimeContract';

type RoomAccess = {
  bootstrap(workspaceRoot: string): CodingRoomSnapshot;
  prompt(workspaceRoot: string, input: CodingPromptInput): Promise<CodingRoomSnapshot>;
  requireLane(lanes: CodingAgentLane[], laneId: string): CodingAgentLane;
  executionRoot(lane: CodingAgentLane, workspaceRoot: string): string;
};

export class CodingRoomCollaboration {
  private readonly handoffs = new CollaborationService();

  constructor(
    private readonly repository: CodingRoomRepository,
    private readonly runtime: Pick<CodingRoomRuntime, 'applyWorkspacePatch' | 'getWorkspaceDiff'>,
    private readonly room: RoomAccess,
  ) {}

  async handoff(
    workspaceRoot: string,
    sourceLaneId: string,
    targetLaneId: string,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.room.bootstrap(workspaceRoot);
    const source = this.room.requireLane(snapshot.lanes, sourceLaneId);
    const target = this.room.requireLane(snapshot.lanes, targetLaneId);
    if (source.missionId !== target.missionId) {
      throw new Error(CodingErrorMessage.HandoffSameMission);
    }
    const content = this.handoffs.buildHandoff({
      snapshot,
      sourceLane: source,
      targetLane: target,
      baseline: this.requireMissionBaseline(
        snapshot.missions.find(mission => mission.id === source.missionId),
      ),
      diff: await this.getWorkspaceDiff(this.room.executionRoot(source, workspaceRoot)),
    });
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
    return await this.room.prompt(workspaceRoot, {
      laneId: target.id,
      prompt: this.handoffPrompt(content),
    });
  }

  private handoffPrompt(content: Record<string, unknown>): string {
    return `You are receiving a coding handoff. Continue from this handoff package:\n${JSON.stringify(
      content,
      null,
      2,
    )}`;
  }

  async startNextStage(workspaceRoot: string, completedLaneId: string): Promise<void> {
    const snapshot = this.room.bootstrap(workspaceRoot);
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
    const source = this.room.requireLane(snapshot.lanes, completedLaneId);
    const target = this.room.requireLane(snapshot.lanes, nextAssignment.laneId);
    if (source.missionId !== target.missionId) return;
    const implementation = snapshot.assignments.find(
      assignment =>
        assignment.missionId === source.missionId &&
        assignment.workflowStage === CodingWorkflowStage.Implementation,
    );
    const implementationLane = implementation
      ? snapshot.lanes.find(lane => lane.id === implementation.laneId)
      : null;
    const handoff = this.handoffs.buildHandoff({
      snapshot,
      sourceLane: source,
      targetLane: target,
      baseline: this.requireMissionBaseline(
        snapshot.missions.find(mission => mission.id === source.missionId),
      ),
      diff: await this.getWorkspaceDiff(this.room.executionRoot(source, workspaceRoot)),
    });
    if (implementationLane && implementationLane.id !== source.id) {
      handoff.implementationDiff = await this.getWorkspaceDiff(
        this.room.executionRoot(implementationLane, workspaceRoot),
      );
    }
    const implementationDiff =
      typeof handoff.implementationDiff === 'string' ? handoff.implementationDiff : null;
    if (implementationDiff?.trim()) {
      if (!this.runtime.applyWorkspacePatch) {
        throw new Error(CodingErrorMessage.CollaboratorPatchUnsupported);
      }
      await this.runtime.applyWorkspacePatch({
        workspaceRoot: this.room.executionRoot(target, workspaceRoot),
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
    await this.room.prompt(workspaceRoot, {
      laneId: target.id,
      prompt: this.handoffPrompt(handoff),
    });
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
      throw new Error(CodingErrorMessage.CollaboratorBaselineRequired);
    }
    return mission.gitBaseline;
  }
}
