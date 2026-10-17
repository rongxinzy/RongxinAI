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
import { CodingRoomServicePendingMessageQueue } from './pendingMessageQueue';

/** Slash-style control commands (/compact, /mcp, /status) for built-in lanes. */
export abstract class CodingRoomServiceBuiltinControlCommands extends CodingRoomServicePendingMessageQueue {
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
