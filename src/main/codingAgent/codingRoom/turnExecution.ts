import { t } from '../../i18n';
import type { CodingAgentDriver } from '../drivers/codingAgentDriver';
import { isAcpAuthenticationRequired } from '../acp/authMethods';
import { isAssistantResponseEvent } from '../codingTurnResponse';
import {
  BuiltinCodingControlCommand,
  parseBuiltinCodingControlCommand,
  type ParsedBuiltinCodingControlCommand,
} from '../drivers/builtinCodingCommands';
import { buildBuiltinCodingMcpReport } from '../builtinCodingMcpReport';
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
  type CodingAgentProfile,
  type CodingPromptAttachment,
  type CodingPromptInput,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';
import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { CodingRoomCollaboration } from './collaboration';
import { CodingPendingMessageQueue } from './codingPendingMessageQueue';
import type { CodingRoomState } from './roomState';
import type { CoworkSessionInterruption } from '../../../shared/cowork/interruption';

/** Prompt dispatch, cancellation, recovery and the turn execution engine. */
export class CodingRoomTurnExecution {
  private readonly pendingMessageQueue = new CodingPendingMessageQueue();
  readonly collaboration: CodingRoomCollaboration;

  constructor(private readonly room: CodingRoomState) {
    this.collaboration = new CodingRoomCollaboration(this.room.repository, this.room.runtime, {
      bootstrap: workspaceRoot => this.room.bootstrap(workspaceRoot),
      prompt: (workspaceRoot, input) => this.prompt(workspaceRoot, input),
      requireLane: (lanes, laneId) => this.room.requireLane(lanes, laneId),
      executionRoot: (lane, workspaceRoot) => this.room.executionRoot(lane, workspaceRoot),
    });
  }

  // ── Follow-up prompt queue (delegates to the CodingPendingMessageQueue collaborator) ──

  listPendingMessages(laneId: string): CoworkPendingMessage[] {
    return this.pendingMessageQueue.list(laneId);
  }

  private emitPendingMessagesChanged(laneId: string): void {
    this.room.emit('pendingMessagesChanged', { laneId, items: this.listPendingMessages(laneId) });
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

  private failAcpPendingMessage(laneId: string, itemId: string, error: unknown): void {
    this.pendingMessageQueue.fail(laneId, itemId, error, message =>
      this.room.errorMessage(message),
    );
    this.emitPendingMessagesChanged(laneId);
  }

  // ── Slash-style control commands ─────────────────────────────────────────

  /**
   * Built-in control commands never become model input. While a turn is in
   * flight they wait behind the queued prompts, otherwise they run now.
   */
  private async dispatchBuiltinControlCommand(
    workspaceRoot: string,
    lane: CodingAgentLane,
    invocation: ParsedBuiltinCodingControlCommand,
  ): Promise<CodingRoomSnapshot> {
    const execute = () => this.runBuiltinControlCommand(workspaceRoot, lane, invocation);
    if (this.room.runtime.isBuiltinSessionRunning?.(lane.localSessionId)) {
      const queued = this.room.runtime.enqueueBuiltinControlAction?.(lane.localSessionId, () => {
        const control = execute();
        this.room.turnTracker.trackTurn(control);
        return control;
      });
      if (!queued?.success) {
        this.appendBuiltinControlFailure(
          lane,
          invocation.command,
          queued?.error ?? t('codingAgentCommandQueueUnavailable'),
        );
      }
      return this.room.publish(workspaceRoot);
    }
    const control = execute().then(() => this.room.publish(workspaceRoot));
    this.room.turnTracker.trackTurn(control);
    return control;
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
        if (this.room.runtime.isBuiltinSessionActive?.(lane.localSessionId) === false) {
          this.appendBuiltinControlMessage(lane, t('codingAgentCommandCompactNoSession'));
        } else {
          const result = await this.room.runtime.compactBuiltinSession?.(lane.localSessionId);
          if (!result) throw new Error(t('codingAgentCommandCompactionUnavailable'));
          this.appendBuiltinControlMessage(
            lane,
            result.cancelled
              ? t('codingAgentCommandCompactCancelled')
              : t('codingAgentCommandCompactSuccess'),
          );
        }
      } else if (command === BuiltinCodingControlCommand.Mcp) {
        const snapshot = await this.room.runtime.describeBuiltinMcp?.(target ?? undefined);
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
            status: this.room.runtime.isBuiltinSessionRunning?.(lane.localSessionId)
              ? t('codingAgentCommandStatusRunning')
              : t('codingAgentCommandStatusIdle'),
            model: lane.modelOverride ?? t('codingAgentCommandStatusDefaultModel'),
            thinkingLevel: this.room.getThinkingLevel(lane) ?? t('codingAgentCommandStatusUnknown'),
            compaction: this.room.runtime.compactBuiltinSession
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
        this.room.publish(workspaceRoot);
        return;
      }
      this.appendBuiltinControlFailure(lane, command, this.room.errorMessage(error));
    }
    this.room.publish(workspaceRoot);
  }

  private appendBuiltinControlMessage(lane: CodingAgentLane, content: string): void {
    this.room.repository.appendEvent(lane.id, CodingEventKind.Message, { role: 'system', content });
  }

  private appendBuiltinControlFailure(
    lane: CodingAgentLane,
    command: BuiltinCodingControlCommand,
    error: string,
  ): void {
    this.room.repository.appendEvent(lane.id, CodingEventKind.Message, {
      role: 'system',
      content:
        command === BuiltinCodingControlCommand.Compact
          ? t('codingAgentCommandCompactFailed', { error })
          : t('codingAgentCommandFailed', { error }),
    });
  }

  private isCompactionNotNeededError(error: unknown): boolean {
    return /nothing to compact|session too small/i.test(this.room.errorMessage(error));
  }

  private linkLaneAssignment(
    snapshot: CodingRoomSnapshot,
    laneId: string,
    workbenchTaskId: string,
    workbenchRunId: string,
  ): void {
    const assignment = snapshot.assignments.find(candidate => candidate.laneId === laneId);
    if (assignment)
      this.room.repository.linkAssignmentWorkbench(assignment.id, workbenchTaskId, workbenchRunId);
  }

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
    const snapshot = this.room.bootstrap(workspaceRoot);
    const lane = this.room.requireLane(snapshot.lanes, input.laneId);
    // A pending question owns the turn; answer or cancel it before sending more.
    if (lane.status === CodingLaneStatus.WaitingElicitation) {
      throw new Error(t('codingAgentElicitationPromptBlocked'));
    }
    const controlInvocation = parseBuiltinCodingControlCommand(input.prompt);
    if (
      controlInvocation &&
      this.room.registry.get(lane.profileId)?.driverKind === CodingAgentDriverKind.Builtin
    ) {
      return await this.dispatchBuiltinControlCommand(workspaceRoot, lane, controlInvocation);
    }
    if (
      lane.status === CodingLaneStatus.Running ||
      lane.status === CodingLaneStatus.WaitingApproval
    ) {
      const profile = this.room.registry.get(lane.profileId);
      const prompt = input.prompt.trim();
      if (!prompt) throw new Error(CodingErrorMessage.PromptRequired);
      if (profile?.driverKind === CodingAgentDriverKind.Builtin) {
        const driver = this.room.getDriver(lane);
        const session = await this.room.ensureDriverSession(
          driver,
          lane,
          this.room.executionRoot(lane, workspaceRoot),
        );
        if (input.delivery === CodingPromptDelivery.Steer) {
          const result = await this.room.runtime.steerBuiltinMessage?.(session.id, prompt);
          if (result?.success) return this.room.publish(workspaceRoot);
          throw new Error(result?.error ?? CodingErrorMessage.SteerFailed);
        }
        const result = await this.room.runtime.enqueueBuiltinMessage?.(session.id, prompt);
        if (result?.success) return this.room.publish(workspaceRoot);
        throw new Error(result?.error ?? CodingErrorMessage.QueuePromptFailed);
      }
      if (profile?.driverKind === CodingAgentDriverKind.Acp) {
        const queued = this.enqueuePendingMessage(lane.id, prompt);
        if (!queued.success || !queued.item)
          throw new Error(queued.error ?? CodingErrorMessage.QueuePromptFailed);
        if (input.delivery === CodingPromptDelivery.Steer) {
          return await this.steerPendingMessage(workspaceRoot, lane.id, queued.item.id);
        }
        return this.room.publish(workspaceRoot);
      }
      throw new Error(CodingErrorMessage.LaneTurnActive);
    }
    const profile = this.room.registry.get(lane.profileId);
    if (!profile) throw new Error(CodingErrorMessage.ProfileNotFound);
    if (
      profile.status !== CodingAgentProfileStatus.Ready &&
      !(
        profile.status === CodingAgentProfileStatus.Detected &&
        profile.driverKind === CodingAgentDriverKind.Acp &&
        this.room.turnTracker.isLaneStaged(lane.id)
      )
    ) {
      throw new Error(CodingErrorMessage.ProfileNotReady);
    }
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error(CodingErrorMessage.PromptRequired);

    const executionRoot = this.room.executionRoot(lane, workspaceRoot);
    if (this.room.requiresWriterLease(lane.sourceRoot, executionRoot)) {
      this.room.repository.acquireWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
    }
    this.room.repository.appendEvent(lane.id, CodingEventKind.Message, {
      role: 'user',
      content: prompt,
      ...(input.attachments?.length
        ? { attachments: input.attachments.map(attachment => ({ name: attachment.name })) }
        : {}),
    });
    this.room.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
    this.room.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
    this.room.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);

    try {
      const driver = this.room.getDriver(lane);
      const session = await this.room.ensureDriverSession(driver, lane, executionRoot);
      if (session.recoveryContext) {
        if (this.room.requiresWriterLease(lane.sourceRoot, executionRoot)) {
          this.room.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
        }
        this.room.repository.updateLaneStatus(lane.id, CodingLaneStatus.Idle);
        this.room.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.NeedsReview);
        this.room.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Planned);
        this.room.repository.updateLaneRecovery(lane.id, prompt, session.recoveryContext);
        return this.room.publish(workspaceRoot);
      }
      if (profile.driverKind !== CodingAgentDriverKind.Builtin) {
        const workbench = this.room.runtime.beginExternalWorkbenchRun({
          sessionId: lane.localSessionId,
          goal: prompt,
          workspaceRoot: executionRoot,
        });
        this.linkLaneAssignment(snapshot, lane.id, workbench.taskId, workbench.runId);
      }
      const turnGeneration = this.room.turnTracker.beginLaneTurn(lane.id);
      this.room.turnTracker.trackTurn(
        this.runTurn(
          workspaceRoot,
          executionRoot,
          snapshot.room.id,
          lane,
          profile,
          driver,
          session.id,
          prompt,
          queuedItemId,
          turnGeneration,
          input.attachments,
        ),
      );
    } catch (error) {
      if (this.room.requiresWriterLease(lane.sourceRoot, executionRoot)) {
        this.room.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
      }
      const failureStatus = this.failureStatus(lane, error);
      this.room.repository.updateLaneStatus(lane.id, failureStatus);
      this.room.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Failed);
      this.room.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Failed);
      console.error('[CodingRoom] turn failed:', error);
      this.room.repository.appendEvent(lane.id, CodingEventKind.TurnFailed, {
        error: this.room.errorMessage(error),
      });
      if (queuedItemId) this.failAcpPendingMessage(lane.id, queuedItemId, error);
      throw error;
    }
    return this.room.publish(workspaceRoot);
  }

  async confirmSessionRecovery(
    workspaceRoot: string,
    laneId: string,
    includeRecoveryContext: boolean,
  ): Promise<CodingRoomSnapshot> {
    const snapshot = this.room.bootstrap(workspaceRoot);
    const lane = this.room.requireLane(snapshot.lanes, laneId);
    const profile = this.room.registry.get(lane.profileId);
    if (!profile || profile.status !== CodingAgentProfileStatus.Ready) {
      throw new Error(CodingErrorMessage.ProfileNotReady);
    }
    if (!lane.pendingRecoveryPrompt || !lane.pendingRecoveryContext) {
      throw new Error(CodingErrorMessage.RecoveryNotRequired);
    }
    const executionRoot = this.room.executionRoot(lane, workspaceRoot);
    if (this.room.requiresWriterLease(lane.sourceRoot, executionRoot)) {
      this.room.repository.acquireWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
    }
    try {
      const driver = this.room.getDriver(lane);
      const session = await this.room.ensureDriverSession(driver, lane, executionRoot);
      if (session.recoveryContext) {
        if (this.room.requiresWriterLease(lane.sourceRoot, executionRoot)) {
          this.room.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
        }
        this.room.repository.updateLaneRecovery(
          lane.id,
          lane.pendingRecoveryPrompt,
          session.recoveryContext,
        );
        return this.room.publish(workspaceRoot);
      }
      this.room.repository.updateLaneRecovery(lane.id, null, null);
      this.room.repository.updateLaneStatus(lane.id, CodingLaneStatus.Running);
      this.room.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Running);
      this.room.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Running);
      if (profile.driverKind !== CodingAgentDriverKind.Builtin) {
        const workbench = this.room.runtime.beginExternalWorkbenchRun({
          sessionId: lane.localSessionId,
          goal: lane.pendingRecoveryPrompt,
          workspaceRoot: executionRoot,
        });
        this.linkLaneAssignment(snapshot, lane.id, workbench.taskId, workbench.runId);
      }
      const turnGeneration = this.room.turnTracker.beginLaneTurn(lane.id);
      this.room.turnTracker.trackTurn(
        this.runTurn(
          workspaceRoot,
          executionRoot,
          snapshot.room.id,
          lane,
          profile,
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
      if (this.room.requiresWriterLease(lane.sourceRoot, executionRoot)) {
        this.room.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
      }
      throw error;
    }
    return this.room.publish(workspaceRoot);
  }

  async cancel(workspaceRoot: string, laneId: string): Promise<CodingRoomSnapshot> {
    const snapshot = this.room.bootstrap(workspaceRoot);
    const lane = this.room.requireLane(snapshot.lanes, laneId);
    // A pending question keeps the turn alive in the Pi runtime, so it must be
    // resolved before the turn itself is cancelled.
    const pendingElicitation = snapshot.elicitations.find(
      elicitation =>
        elicitation.laneId === lane.id && elicitation.status === CodingElicitationStatus.Pending,
    );
    if (pendingElicitation) {
      const reason = t('codingAgentElicitationCancelledBySessionStop');
      this.room.repository.cancelElicitation(pendingElicitation.id, reason);
      this.room.runtime.cancelBuiltinElicitation?.(pendingElicitation.id, reason);
      this.room.repository.appendEvent(lane.id, CodingEventKind.Elicitation, {
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
    const driver = this.room.getDriver(lane);
    this.room.turnTracker.cancelCurrentTurn(lane.id);
    const activeSession =
      this.room.registry.get(lane.profileId)?.driverKind === CodingAgentDriverKind.Builtin
        ? this.room.driverPool.sessionFor(lane.id)
        : undefined;
    const { id } =
      activeSession ??
      (await this.room.ensureDriverSession(
        driver,
        lane,
        this.room.executionRoot(lane, workspaceRoot),
      ));
    await driver.cancel(id);
    const assignment = this.room.repository.getLatestAssignmentForLane(lane.id);
    if (assignment?.workbenchRunId) {
      this.room.runtime.cancelExternalWorkbenchRun?.({
        sessionId: lane.localSessionId,
        runId: assignment.workbenchRunId,
      });
    }
    if (
      this.room.requiresWriterLease(lane.sourceRoot, this.room.executionRoot(lane, workspaceRoot))
    ) {
      this.room.repository.releaseWriterLease(snapshot.room.id, lane.sourceRoot, lane.id);
    }
    this.room.repository.updateLaneStatus(lane.id, CodingLaneStatus.Idle);
    this.room.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.Cancelled);
    this.room.updateLaneAssignmentStatus(snapshot, lane.id, CodingAssignmentStatus.Cancelled);
    this.room.repository.appendEvent(lane.id, CodingEventKind.TurnCancelled, {});
    return this.room.publish(workspaceRoot);
  }

  private async runTurn(
    roomWorkspaceRoot: string,
    executionRoot: string,
    roomId: string,
    lane: CodingAgentLane,
    profile: CodingAgentProfile,
    driver: CodingAgentDriver,
    sessionId: string,
    prompt: string,
    queuedItemId: string | undefined,
    turnGeneration: number,
    attachments?: CodingPromptAttachment[],
  ): Promise<void> {
    const { driverKind } = profile;
    try {
      let receivedAssistantResponse = false;
      const isCurrentTurn = () => this.room.turnTracker.isCurrentTurn(lane.id, turnGeneration);
      for await (const event of driver.prompt({
        sessionId,
        workspaceRoot: executionRoot,
        prompt,
        attachments,
        modelOverride: lane.modelOverride,
        isCurrentTurn,
      })) {
        if (!receivedAssistantResponse && isAssistantResponseEvent(event)) {
          receivedAssistantResponse = true;
          const metadata = driver.getProfileMetadata?.();
          if (metadata && isCurrentTurn()) {
            this.room.registry.recordFirstSessionCheck(profile, metadata, { success: true });
          }
        }
        const availableCommands = driver.getSessionAvailableCommands(sessionId);
        const commands = Array.isArray(availableCommands)
          ? availableCommands
          : await availableCommands;
        const storedEvent = this.room.repository.appendOrMergeStreamEvent(
          lane.id,
          event.kind,
          event.payload,
        );
        this.room.repository.updateLaneConfigOptions(
          lane.id,
          driver.getSessionConfigOptions(sessionId),
        );
        this.room.repository.updateLaneAvailableCommands(lane.id, commands);
        if (event.kind === CodingEventKind.Permission) {
          console.debug(
            `[CodingRoom] published permission request for lane ${lane.id} while session ${sessionId} is waiting`,
          );
          this.room.repository.updateLaneStatus(lane.id, CodingLaneStatus.WaitingApproval);
          this.room.repository.updateMissionStatus(
            lane.missionId,
            CodingMissionStatus.WaitingApproval,
          );
          const assignment = this.room.repository.getLatestAssignmentForLane(lane.id);
          if (assignment) {
            this.room.repository.updateAssignmentStatus(
              assignment.id,
              CodingAssignmentStatus.WaitingApproval,
            );
          }
        }
        if (event.kind === CodingEventKind.Permission) {
          this.room.publish(roomWorkspaceRoot);
        } else {
          this.room.eventDeltaBatcher.enqueue(roomWorkspaceRoot, storedEvent);
        }
      }
      if (this.room.turnTracker.consumeCancelledTurn(lane.id, turnGeneration)) {
        if (queuedItemId) this.deletePendingMessage(lane.id, queuedItemId);
        return;
      }
      if (!isCurrentTurn()) return;
      if (driverKind !== CodingAgentDriverKind.Builtin && !receivedAssistantResponse) {
        // The agent answered the prompt with nothing. ACP agents do not report
        // an unusable credential, so the renderer copy names the likely causes
        // (not signed in / missing or invalid API key / unreachable endpoint).
        throw new Error(CodingErrorMessage.AgentNoOutput);
      }
      if (driverKind === CodingAgentDriverKind.Builtin) {
        const workbench = this.room.runtime.getBuiltinWorkbenchLink(lane.localSessionId);
        const assignment = this.room.repository.getLatestAssignmentForLane(lane.id);
        if (workbench && assignment) {
          this.room.repository.linkAssignmentWorkbench(
            assignment.id,
            workbench.taskId,
            workbench.runId,
          );
        }
      }
      if (driverKind !== CodingAgentDriverKind.Builtin) {
        const answer = this.room.eventsToAnswer(lane.id);
        const assignment = this.room.repository.getLatestAssignmentForLane(lane.id);
        if (assignment?.workbenchRunId) {
          await this.room.runtime.completeExternalWorkbenchRun({
            sessionId: lane.localSessionId,
            laneId: lane.id,
            runId: assignment.workbenchRunId,
            workspaceRoot: executionRoot,
            finalAnswer: answer,
          });
        }
        this.room.repository.appendEvent(lane.id, CodingEventKind.TurnComplete, {});
        this.finishTurn(roomId, roomWorkspaceRoot, lane, CodingLaneStatus.Completed);
        if (queuedItemId) this.deletePendingMessage(lane.id, queuedItemId);
        this.startNextAcpPendingMessage(roomWorkspaceRoot, lane);
      }
      this.room.publish(roomWorkspaceRoot);
    } catch (error) {
      if (this.room.turnTracker.consumeCancelledTurn(lane.id, turnGeneration)) {
        if (queuedItemId) this.deletePendingMessage(lane.id, queuedItemId);
        return;
      }
      if (!this.room.turnTracker.isCurrentTurn(lane.id, turnGeneration)) return;
      const metadata = driver.getProfileMetadata?.();
      if (metadata) {
        this.room.registry.recordFirstSessionCheck(profile, metadata, { success: false, error });
      }
      const assignment = this.room.repository.getLatestAssignmentForLane(lane.id);
      console.error(`[CodingRoom] coding turn failed for lane ${lane.id}:`, error);
      if (assignment?.workbenchRunId) {
        this.room.runtime.failExternalWorkbenchRun?.({
          sessionId: lane.localSessionId,
          runId: assignment.workbenchRunId,
          error: this.room.errorMessage(error),
        });
      }
      console.error('[CodingRoom] turn failed:', error);
      this.room.repository.appendEvent(lane.id, CodingEventKind.TurnFailed, {
        error: this.room.errorMessage(error),
      });
      if (queuedItemId) this.failAcpPendingMessage(lane.id, queuedItemId, error);
      this.finishTurn(roomId, roomWorkspaceRoot, lane, this.failureStatus(lane, error));
      this.room.publish(roomWorkspaceRoot);
    }
  }

  private startNextAcpPendingMessage(workspaceRoot: string, lane: CodingAgentLane): void {
    const profile = this.room.registry.get(lane.profileId);
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

  private finishTurn(
    roomId: string,
    roomWorkspaceRoot: string,
    lane: CodingAgentLane,
    laneStatus: CodingLaneStatus,
  ): void {
    this.room.repository.updateLaneStatus(lane.id, laneStatus);
    this.room.repository.updateMissionStatus(
      lane.missionId,
      laneStatus === CodingLaneStatus.Completed
        ? CodingMissionStatus.NeedsReview
        : CodingMissionStatus.Failed,
    );
    const assignment = this.room.repository.getLatestAssignmentForLane(lane.id);
    if (assignment) {
      this.room.repository.updateAssignmentStatus(
        assignment.id,
        laneStatus === CodingLaneStatus.Completed
          ? CodingAssignmentStatus.NeedsReview
          : CodingAssignmentStatus.Failed,
      );
    }
    if (
      this.room.requiresWriterLease(
        lane.sourceRoot,
        this.room.executionRoot(lane, roomWorkspaceRoot),
      )
    ) {
      this.room.repository.releaseWriterLease(roomId, lane.sourceRoot, lane.id);
    }
    if (laneStatus === CodingLaneStatus.Completed) {
      void this.collaboration.startNextStage(roomWorkspaceRoot, lane.id).catch(error => {
        console.error('[CodingRoom] failed to start the next collaboration stage:', error);
        // The next assignment stays Planned, so surface the failure in the
        // completed lane's conversation instead of leaving silent state.
        try {
          this.room.repository.appendEvent(lane.id, CodingEventKind.Message, {
            role: 'system',
            content: t('codingAgentNextStageFailed'),
            error: this.room.errorMessage(error),
          });
          this.room.publish(roomWorkspaceRoot);
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
    const profile = this.room.registry.get(lane.profileId);
    if (profile?.driverKind === CodingAgentDriverKind.Acp && isAcpAuthenticationRequired(error)) {
      if (profile.status !== CodingAgentProfileStatus.NeedsAuth) {
        this.room.registry.markNeedsAuth(profile.id);
      }
      return CodingLaneStatus.NeedsAuth;
    }
    return CodingLaneStatus.Failed;
  }

  // ── Builtin agent event projection (merged from builtinAgentEvents.ts) ────
  recordBuiltinElicitation(
    sessionId: string,
    request: { requestId: string; question: string },
  ): void {
    const question = request.question.trim();
    if (!question) return;
    const location = this.room.repository.getBuiltinLaneSession(sessionId);
    if (location) {
      this.applyBuiltinElicitation(
        location.workspaceRoot,
        location.roomId,
        location.lane,
        request,
        question,
      );
    }
  }

  private applyBuiltinElicitation(
    workspaceRoot: string,
    roomId: string,
    lane: CodingAgentLane,
    request: { requestId: string; question: string },
    question: string,
  ): void {
    this.room.repository.createElicitation(lane.id, question, request.requestId);
    this.room.repository.appendEvent(lane.id, CodingEventKind.Elicitation, {
      requestId: request.requestId,
      question,
      status: CodingElicitationStatus.Pending,
    });
    this.room.repository.updateLaneStatus(lane.id, CodingLaneStatus.WaitingElicitation);
    this.room.repository.updateMissionStatus(
      lane.missionId,
      CodingMissionStatus.WaitingElicitation,
    );
    const assignment = this.room.repository.getLatestAssignmentForLane(lane.id);
    if (assignment) {
      this.room.repository.updateAssignmentStatus(
        assignment.id,
        CodingAssignmentStatus.WaitingElicitation,
      );
    }
    if (
      this.room.requiresWriterLease(lane.sourceRoot, this.room.executionRoot(lane, workspaceRoot))
    ) {
      this.room.repository.releaseWriterLease(roomId, lane.sourceRoot, lane.id);
    }
    this.room.publish(workspaceRoot);
  }

  recordBuiltinEvent(
    sessionId: string,
    kind: (typeof CodingEventKind)[keyof typeof CodingEventKind],
    payload: Record<string, unknown>,
  ): void {
    const location = this.room.repository.getBuiltinLaneSession(sessionId);
    if (location)
      this.applyBuiltinEvent(location.workspaceRoot, location.roomId, location.lane, kind, payload);
  }

  private applyBuiltinEvent(
    workspaceRoot: string,
    roomId: string,
    lane: CodingAgentLane,
    kind: (typeof CodingEventKind)[keyof typeof CodingEventKind],
    payload: Record<string, unknown>,
  ): void {
    const event = this.room.repository.appendOrMergeStreamEvent(lane.id, kind, payload);
    if (kind === CodingEventKind.Permission) {
      this.room.repository.updateLaneStatus(lane.id, CodingLaneStatus.WaitingApproval);
      this.room.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.WaitingApproval);
      const assignment = this.room.repository.getLatestAssignmentForLane(lane.id);
      if (assignment) {
        this.room.repository.updateAssignmentStatus(
          assignment.id,
          CodingAssignmentStatus.WaitingApproval,
        );
      }
    }
    if (kind === CodingEventKind.TurnComplete || kind === CodingEventKind.TurnFailed) {
      this.room.repository.flushPendingStreamWrites(lane.id);
      this.finishTurn(
        roomId,
        workspaceRoot,
        lane,
        kind === CodingEventKind.TurnComplete
          ? CodingLaneStatus.Completed
          : CodingLaneStatus.Failed,
      );
      this.room.publish(workspaceRoot);
      return;
    }
    this.room.eventDeltaBatcher.enqueue(workspaceRoot, event);
  }

  recordBuiltinInterruption(interruption: CoworkSessionInterruption): void {
    const location = this.room.repository.getBuiltinLaneSession(interruption.sessionId);
    if (location)
      this.applyBuiltinInterruption(location.workspaceRoot, location.lane, interruption);
  }

  private applyBuiltinInterruption(
    workspaceRoot: string,
    lane: CodingAgentLane,
    interruption: CoworkSessionInterruption,
  ): void {
    this.room.repository.appendEvent(lane.id, CodingEventKind.TurnCancelled, {
      reason: interruption.cause,
      interruption,
    });
    this.room.repository.updateLaneStatus(lane.id, CodingLaneStatus.Idle);
    this.room.repository.updateMissionStatus(lane.missionId, CodingMissionStatus.NeedsReview);
    const assignment = this.room.repository.getLatestAssignmentForLane(lane.id);
    if (assignment) {
      this.room.repository.updateAssignmentStatus(assignment.id, CodingAssignmentStatus.Planned);
    }
    this.room.publish(workspaceRoot);
  }
}
