import { t } from '../../i18n';
import {
  BuiltinCodingControlCommand,
  type ParsedBuiltinCodingControlCommand,
} from '../drivers/builtinCodingCommands';
import { buildBuiltinCodingMcpReport } from '../builtinCodingMcpReport';
import {
  CodingAgentProfileStatus,
  CodingAssignmentStatus,
  CodingErrorMessage,
  CodingEventKind,
  CodingWorkflowStage,
  type CodingAgentLane,
  type CodingRoomSnapshot,
  type CreateCodingCollaborationPresetInput,
} from '../../../shared/codingAgent';
import type { CoworkPendingMessage } from '../../../shared/cowork/pendingMessageQueue';
import { CodingRoomServiceWorkspaceAdmin } from './workspaceAdmin';
import { randomUUID } from 'crypto';

/**
 * Built-in lane controls: the follow-up prompt queue and the slash-style
 * control commands (/compact, /mcp, /status). One class because the queue
 * and the commands share a single scheduling boundary — a command waits
 * behind queued prompts while a turn is in flight.
 */
export abstract class CodingRoomServiceBuiltinControlCommands extends CodingRoomServiceWorkspaceAdmin {
  // ── Follow-up prompt queue (delegates to the CodingPendingMessageQueue collaborator) ──

  listPendingMessages(laneId: string): CoworkPendingMessage[] {
    return this.pendingMessageQueue.list(laneId);
  }

  protected emitPendingMessagesChanged(laneId: string): void {
    this.emit('pendingMessagesChanged', { laneId, items: this.listPendingMessages(laneId) });
  }

  enqueuePendingMessage(
    laneId: string,
    text: string,
  ): { success: boolean; item?: CoworkPendingMessage; error?: string } {
    const result = this.pendingMessageQueue.enqueue(laneId, text);
    if (result.success) this.emitPendingMessagesChanged(laneId);
    return result;
  }

  updatePendingMessage(
    laneId: string,
    itemId: string,
    text: string,
  ): { success: boolean; error?: string } {
    const result = this.pendingMessageQueue.update(laneId, itemId, text);
    if (result.success) this.emitPendingMessagesChanged(laneId);
    return result;
  }

  deletePendingMessage(laneId: string, itemId: string): { success: boolean; error?: string } {
    const result = this.pendingMessageQueue.delete(laneId, itemId);
    if (result.success) this.emitPendingMessagesChanged(laneId);
    return result;
  }

  protected failAcpPendingMessage(laneId: string, itemId: string, error: unknown): void {
    this.pendingMessageQueue.fail(laneId, itemId, error, message => this.errorMessage(message));
    this.emitPendingMessagesChanged(laneId);
  }

  // ── Slash-style control commands ─────────────────────────────────────────

  /**
   * Built-in control commands never become model input. While a turn is in
   * flight they wait behind the queued prompts, otherwise they run now.
   */
  protected async dispatchBuiltinControlCommand(
    workspaceRoot: string,
    lane: CodingAgentLane,
    invocation: ParsedBuiltinCodingControlCommand,
  ): Promise<CodingRoomSnapshot> {
    const execute = () => this.runBuiltinControlCommand(workspaceRoot, lane, invocation);
    if (this.runtime.isBuiltinSessionRunning?.(lane.localSessionId)) {
      const queued = this.runtime.enqueueBuiltinControlAction?.(lane.localSessionId, execute);
      if (!queued?.success) {
        this.appendBuiltinControlFailure(
          lane,
          invocation.command,
          queued?.error ?? t('codingAgentCommandQueueUnavailable'),
        );
      }
      return this.publish(workspaceRoot);
    }
    await execute();
    return this.publish(workspaceRoot);
  }

  private async runBuiltinControlCommand(
    workspaceRoot: string,
    lane: CodingAgentLane,
    invocation: ParsedBuiltinCodingControlCommand,
  ): Promise<void> {
    const { command, target } = invocation;
    try {
      if (command === BuiltinCodingControlCommand.Compact) {
        // `=== false` keeps runtimes that do not report liveness on the normal
        // path; only a runtime that explicitly says "no session" short-circuits.
        if (this.runtime.isBuiltinSessionActive?.(lane.localSessionId) === false) {
          this.appendBuiltinControlMessage(lane, t('codingAgentCommandCompactNoSession'));
        } else {
          const result = await this.runtime.compactBuiltinSession?.(lane.localSessionId);
          if (!result) throw new Error(t('codingAgentCommandCompactionUnavailable'));
          this.appendBuiltinControlMessage(
            lane,
            result.cancelled
              ? t('codingAgentCommandCompactCancelled')
              : t('codingAgentCommandCompactSuccess'),
          );
        }
      } else if (command === BuiltinCodingControlCommand.Mcp) {
        const snapshot = this.runtime.describeBuiltinMcp?.(target ?? undefined) ?? null;
        this.appendBuiltinControlMessage(
          lane,
          snapshot
            ? buildBuiltinCodingMcpReport(snapshot)
            : t('codingAgentCommandMcpGatewayUnavailable'),
        );
      } else {
        this.appendBuiltinControlMessage(
          lane,
          t('codingAgentCommandStatusResult', {
            status: this.runtime.isBuiltinSessionRunning?.(lane.localSessionId)
              ? t('codingAgentCommandStatusRunning')
              : t('codingAgentCommandStatusIdle'),
            model: lane.modelOverride ?? t('codingAgentCommandStatusDefaultModel'),
            thinkingLevel: this.getThinkingLevel(lane) ?? t('codingAgentCommandStatusUnknown'),
            compaction: this.runtime.compactBuiltinSession
              ? t('codingAgentCommandStatusAvailable')
              : t('codingAgentCommandStatusUnavailable'),
          }),
        );
      }
    } catch (error) {
      if (
        command === BuiltinCodingControlCommand.Compact &&
        this.isCompactionNotNeededError(error)
      ) {
        this.appendBuiltinControlMessage(lane, t('codingAgentCommandCompactNotNeeded'));
        this.publish(workspaceRoot);
        return;
      }
      this.appendBuiltinControlFailure(lane, command, this.errorMessage(error));
    }
    this.publish(workspaceRoot);
  }

  private appendBuiltinControlMessage(lane: CodingAgentLane, content: string): void {
    this.repository.appendEvent(lane.id, CodingEventKind.Message, { role: 'system', content });
  }

  private appendBuiltinControlFailure(
    lane: CodingAgentLane,
    command: BuiltinCodingControlCommand,
    error: string,
  ): void {
    this.repository.appendEvent(lane.id, CodingEventKind.Message, {
      role: 'system',
      content:
        command === BuiltinCodingControlCommand.Compact
          ? t('codingAgentCommandCompactFailed', { error })
          : t('codingAgentCommandFailed', { error }),
    });
  }

  private isCompactionNotNeededError(error: unknown): boolean {
    return /nothing to compact|session too small/i.test(this.errorMessage(error));
  }

  // ── Collaboration stages (merged from collaborationStages.ts) ──────────────
  async previewHandoff(
    workspaceRoot: string,
    sourceLaneId: string,
    targetLaneId: string,
  ): Promise<Record<string, unknown>> {
    const snapshot = this.bootstrap(workspaceRoot);
    const source = this.requireLane(snapshot.lanes, sourceLaneId);
    const target = this.requireLane(snapshot.lanes, targetLaneId);
    if (source.missionId !== target.missionId) {
      throw new Error(CodingErrorMessage.HandoffSameMission);
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
      throw new Error(CodingErrorMessage.HandoffSameMission);
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
      throw new Error(CodingErrorMessage.MissionNotFound);
    }
    const profile = this.registry.get(profileId);
    if (!profile) throw new Error(CodingErrorMessage.ProfileNotFound);
    if (profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error(CodingErrorMessage.ProfileNotReady);
    }
    if (!this.runtime.createIsolatedWorkspace) {
      throw new Error(CodingErrorMessage.RuntimeIsolatedUnsupported);
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
    if (!mission) throw new Error(CodingErrorMessage.MissionNotFound);
    if (!this.runtime.createIsolatedWorkspace) {
      throw new Error(CodingErrorMessage.RuntimeIsolatedUnsupported);
    }
    const implementation = snapshot.assignments.find(
      assignment =>
        assignment.missionId === mission.id &&
        assignment.workflowStage === CodingWorkflowStage.Implementation,
    );
    if (!implementation) throw new Error(CodingErrorMessage.MissionNoImplementation);
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
      if (!profile) throw new Error(CodingErrorMessage.ProfileNotFound);
      if (profile.status !== CodingAgentProfileStatus.Ready) {
        throw new Error(CodingErrorMessage.ProfileNotReady);
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

  protected linkLaneAssignment(
    snapshot: CodingRoomSnapshot,
    laneId: string,
    workbenchTaskId: string,
    workbenchRunId: string,
  ): void {
    const assignment = snapshot.assignments.find(candidate => candidate.laneId === laneId);
    if (assignment)
      this.repository.linkAssignmentWorkbench(assignment.id, workbenchTaskId, workbenchRunId);
  }

  private handoffPrompt(content: Record<string, unknown>): string {
    return `You are receiving a coding handoff. Continue from this handoff package:\n${JSON.stringify(
      content,
      null,
      2,
    )}`;
  }

  protected async startNextCollaborationStage(
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
        throw new Error(CodingErrorMessage.CollaboratorPatchUnsupported);
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
}
