import { t } from '../../i18n';
import type { CodingAgentDriver } from '../drivers/codingAgentDriver';
import { isAssistantResponseEvent } from '../codingTurnResponse';
import { parseBuiltinCodingControlCommand } from '../drivers/builtinCodingCommands';
import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingAssignmentStatus,
  CodingElicitationStatus,
  CodingErrorMessage,
  CodingEventKind,
  CodingLaneStatus,
  CodingMissionStatus,
  CodingPromptDelivery,
  type CodingAgentLane,
  type CodingPromptAttachment,
  type CodingPromptInput,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';
import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
} from '../../../shared/cowork/pendingMessageQueue';
import { CodingRoomServiceCollaborationStages } from './collaborationStages';

/** Prompt dispatch, cancellation, recovery and the turn execution engine. */
export abstract class CodingRoomServiceTurnExecution extends CodingRoomServiceCollaborationStages {
  async steerPendingMessage(
    workspaceRoot: string,
    laneId: string,
    itemId: string,
  ): Promise<CodingRoomSnapshot> {
    const item = this.pendingMessageQueue.find(laneId, itemId);
    if (!item) throw new Error(CodingErrorMessage.PendingMessageNotFound);
    if (item.status === CoworkQueueItemStatus.Sending) {
      throw new Error(CodingErrorMessage.PendingMessageSending);
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
    const item = this.pendingMessageQueue.find(laneId, itemId);
    if (!item) throw new Error(CodingErrorMessage.PendingMessageNotFound);
    if (item.delivery !== CoworkQueueDelivery.FollowUp) {
      throw new Error(CodingErrorMessage.PendingMessageSteerOnly);
    }
    if (item.status === CoworkQueueItemStatus.Sending) {
      throw new Error(CodingErrorMessage.PendingMessageSending);
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
    // A pending question owns the turn; answer or cancel it before sending more.
    if (lane.status === CodingLaneStatus.WaitingElicitation) {
      throw new Error(t('codingAgentElicitationPromptBlocked'));
    }
    const controlInvocation = parseBuiltinCodingControlCommand(input.prompt);
    if (
      controlInvocation &&
      this.registry.get(lane.profileId)?.driverKind === CodingAgentDriverKind.Builtin
    ) {
      return await this.dispatchBuiltinControlCommand(workspaceRoot, lane, controlInvocation);
    }
    if (
      lane.status === CodingLaneStatus.Running ||
      lane.status === CodingLaneStatus.WaitingApproval
    ) {
      const profile = this.registry.get(lane.profileId);
      const prompt = input.prompt.trim();
      if (!prompt) throw new Error(CodingErrorMessage.PromptRequired);
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
          throw new Error(result?.error ?? CodingErrorMessage.SteerFailed);
        }
        const result = this.runtime.enqueueBuiltinMessage?.(session.id, prompt);
        if (result?.success) return this.publish(workspaceRoot);
        throw new Error(result?.error ?? CodingErrorMessage.QueuePromptFailed);
      }
      if (profile?.driverKind === CodingAgentDriverKind.Acp) {
        const queued = this.enqueuePendingMessage(lane.id, prompt);
        if (!queued.success || !queued.item)
          throw new Error(queued.error ?? CodingErrorMessage.QueuePromptFailed);
        if (input.delivery === CodingPromptDelivery.Steer) {
          return await this.steerPendingMessage(workspaceRoot, lane.id, queued.item.id);
        }
        return this.publish(workspaceRoot);
      }
      throw new Error(CodingErrorMessage.LaneTurnActive);
    }
    const profile = this.registry.get(lane.profileId);
    if (!profile) throw new Error(CodingErrorMessage.ProfileNotFound);
    if (profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error(CodingErrorMessage.ProfileNotReady);
    }
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error(CodingErrorMessage.PromptRequired);

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
      this.trackTurn(
        this.runTurn(
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
        ),
      );
    } catch (error) {
      if (this.requiresWriterLease(lane.sourceRoot, executionRoot)) {
        this.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
      }
      const failureStatus = this.failureStatus(lane, error);
      this.repository.updateLaneStatus(lane.id, failureStatus);
      this.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Failed);
      this.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Failed);
      console.error('[CodingRoom] turn failed:', error);
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
      throw new Error(CodingErrorMessage.ProfileNotReady);
    }
    if (!lane.pendingRecoveryPrompt || !lane.pendingRecoveryContext) {
      throw new Error(CodingErrorMessage.RecoveryNotRequired);
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
      this.trackTurn(
        this.runTurn(
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
        ),
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
    // A pending question keeps the turn alive in the Pi runtime, so it must be
    // resolved before the turn itself is cancelled.
    const pendingElicitation = snapshot.elicitations.find(
      elicitation =>
        elicitation.laneId === lane.id && elicitation.status === CodingElicitationStatus.Pending,
    );
    if (pendingElicitation) {
      const reason = t('codingAgentElicitationCancelledBySessionStop');
      this.repository.cancelElicitation(pendingElicitation.id, reason);
      this.runtime.cancelBuiltinElicitation?.(pendingElicitation.id, reason);
      this.repository.appendEvent(lane.id, CodingEventKind.Elicitation, {
        requestId: pendingElicitation.id,
        question: pendingElicitation.question,
        cancelReason: reason,
        status: CodingElicitationStatus.Cancelled,
      });
    }
    if (
      lane.status !== CodingLaneStatus.Running &&
      lane.status !== CodingLaneStatus.WaitingApproval &&
      lane.status !== CodingLaneStatus.WaitingElicitation
    ) {
      // Only an active turn can be cancelled; stopping an idle, completed, or
      // failed lane must not overwrite its mission outcome with "cancelled".
      return snapshot;
    }
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
      // The built-in driver yields no events, so project its session snapshot
      // before the turn instead of relying on the stream loop below.
      this.syncLaneDriverSnapshot(lane, driver, sessionId);
      for await (const event of driver.prompt({
        sessionId,
        workspaceRoot: executionRoot,
        prompt,
        attachments,
        modelOverride: lane.modelOverride,
      })) {
        if (isAssistantResponseEvent(event)) receivedAssistantResponse = true;
        const storedEvent = this.repository.appendOrMergeStreamEvent(
          lane.id,
          event.kind,
          event.payload,
        );
        this.repository.updateLaneConfigOptions(lane.id, driver.getSessionConfigOptions(sessionId));
        this.repository.updateLaneAvailableCommands(
          lane.id,
          driver.getSessionAvailableCommands(sessionId),
        );
        if (event.kind === CodingEventKind.Permission) {
          console.debug(
            `[CodingRoom] published permission request for lane ${lane.id} while session ${sessionId} is waiting`,
          );
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
        if (event.kind === CodingEventKind.Permission) {
          this.publish(roomWorkspaceRoot);
        } else {
          this.eventDeltaBatcher.enqueue(roomWorkspaceRoot, storedEvent);
        }
      }
      if (this.consumeCancelledTurn(lane.id, turnGeneration)) {
        if (queuedItemId) this.deletePendingMessage(lane.id, queuedItemId);
        return;
      }
      if (driverKind !== CodingAgentDriverKind.Builtin && !receivedAssistantResponse) {
        // The agent answered the prompt with nothing. ACP agents do not report
        // an unusable credential, so the renderer copy names the likely causes
        // (not signed in / missing or invalid API key / unreachable endpoint).
        throw new Error(CodingErrorMessage.AgentNoOutput);
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
          await this.runtime.completeExternalWorkbenchRun({
            sessionId: lane.localSessionId,
            laneId: lane.id,
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
      console.error(`[CodingRoom] coding turn failed for lane ${lane.id}:`, error);
      if (assignment?.workbenchRunId) {
        this.runtime.failExternalWorkbenchRun?.({
          sessionId: lane.localSessionId,
          runId: assignment.workbenchRunId,
          error: this.errorMessage(error),
        });
      }
      console.error('[CodingRoom] turn failed:', error);
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
    const next = this.pendingMessageQueue.findNextPending(lane.id);
    if (!next) return;
    next.status = CoworkQueueItemStatus.Sending;
    this.emitPendingMessagesChanged(lane.id);
    void this.prompt(workspaceRoot, { laneId: lane.id, prompt: next.text }, next.id).catch(
      error => {
        console.error('[CodingRoom] failed to start queued ACP message:', error);
      },
    );
  }

  private trackTurn(turn: Promise<void>): void {
    const tracked = turn
      .catch(error => {
        // runTurn records turn failures itself; a rejection here means the
        // failure handler itself threw, e.g. the repository was closed first.
        console.error('[CodingRoom] turn failure handling did not complete:', error);
      })
      .finally(() => {
        this.inFlightTurns.delete(tracked);
      });
    this.inFlightTurns.add(tracked);
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

  protected finishTurn(
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
      void this.startNextCollaborationStage(roomWorkspaceRoot, lane.id).catch(error => {
        console.error('[CodingRoom] failed to start the next collaboration stage:', error);
        // The next assignment stays Planned, so surface the failure in the
        // completed lane's conversation instead of leaving silent state.
        try {
          this.repository.appendEvent(lane.id, CodingEventKind.Message, {
            role: 'system',
            content: t('codingAgentNextStageFailed'),
            error: this.errorMessage(error),
          });
          this.publish(roomWorkspaceRoot);
        } catch (publishError) {
          console.debug(
            '[CodingRoom] Skipped publishing the collaboration stage failure:',
            publishError,
          );
        }
      });
    }
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
}
