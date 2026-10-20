import { randomUUID } from 'crypto';

import { t } from '../../i18n';
import {
  BuiltinCodingControlCommand,
  type ParsedBuiltinCodingControlCommand,
} from '../drivers/builtinCodingCommands';
import { buildBuiltinCodingMcpReport } from '../builtinCodingMcpReport';
import {
  CodingErrorMessage,
  CodingEventKind,
  type CodingAgentLane,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';
import {
  CoworkQueueDelivery,
  CoworkQueueItemStatus,
  type CoworkPendingMessage,
} from '../../../shared/cowork/pendingMessageQueue';
import { CodingRoomServiceSessionLifecycle } from './sessionLifecycle';

/**
 * Built-in lane controls: the follow-up prompt queue and the slash-style
 * control commands (/compact, /mcp, /status). One class because the queue
 * and the commands share a single scheduling boundary — a command waits
 * behind queued prompts while a turn is in flight.
 */
export abstract class CodingRoomServiceBuiltinControlCommands extends CodingRoomServiceSessionLifecycle {
  // ── Follow-up prompt queue ────────────────────────────────────────────────

  listPendingMessages(laneId: string): CoworkPendingMessage[] {
    return (this.acpPendingMessages.get(laneId) ?? []).map(item => ({ ...item }));
  }

  protected emitPendingMessagesChanged(laneId: string): void {
    this.emit('pendingMessagesChanged', { laneId, items: this.listPendingMessages(laneId) });
  }

  enqueuePendingMessage(
    laneId: string,
    text: string,
  ): { success: boolean; item?: CoworkPendingMessage; error?: string } {
    const normalized = text.trim();
    if (!normalized) return { success: false, error: CodingErrorMessage.MessageTextRequired };
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
    if (!normalized) return { success: false, error: CodingErrorMessage.MessageTextRequired };
    const items = this.acpPendingMessages.get(laneId) ?? [];
    const item = items.find(candidate => candidate.id === itemId);
    if (!item) return { success: false, error: CodingErrorMessage.PendingMessageNotFound };
    if (item.status === CoworkQueueItemStatus.Sending) {
      return { success: false, error: CodingErrorMessage.PendingMessageEditWhileSending };
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
      return { success: false, error: CodingErrorMessage.PendingMessageNotFound };
    if (next.length) this.acpPendingMessages.set(laneId, next);
    else this.acpPendingMessages.delete(laneId);
    this.emitPendingMessagesChanged(laneId);
    return { success: true };
  }

  protected failAcpPendingMessage(laneId: string, itemId: string, error: unknown): void {
    const item = (this.acpPendingMessages.get(laneId) ?? []).find(
      candidate => candidate.id === itemId,
    );
    if (!item) return;
    item.status = CoworkQueueItemStatus.Failed;
    item.error = this.errorMessage(error);
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
