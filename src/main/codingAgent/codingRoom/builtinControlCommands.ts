import { t } from '../../i18n';
import {
  BuiltinCodingControlCommand,
  type ParsedBuiltinCodingControlCommand,
} from '../drivers/builtinCodingCommands';
import { buildBuiltinCodingMcpReport } from '../builtinCodingMcpReport';
import {
  CodingEventKind,
  type CodingAgentLane,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';
import type { CoworkPendingMessage } from '../../../shared/cowork/pendingMessageQueue';
import { CodingRoomServiceSessionLifecycle } from './sessionLifecycle';

/**
 * Built-in lane controls: the follow-up prompt queue and the slash-style
 * control commands (/compact, /mcp, /status). One class because the queue
 * and the commands share a single scheduling boundary — a command waits
 * behind queued prompts while a turn is in flight.
 */
export abstract class CodingRoomServiceBuiltinControlCommands extends CodingRoomServiceSessionLifecycle {
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
}
