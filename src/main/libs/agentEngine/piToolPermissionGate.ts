/**
 * Pi-native tool permission gate.
 *
 * Replaces Workbench's blocking `authorizeToolCall` + idempotency-replay breaker
 * with a direct risk check + user permission request when required by the
 * session's approvalMode (`Ask` / `Auto` / `AllowAll`). Passive run/approval
 * recording is forwarded best-effort to WorkbenchTaskService so the read-only
 * trace tab still reflects tool activity without gating Pi execution.
 */

import { randomUUID } from 'crypto';

import type { ToolAnnotations } from './durableToolTypes';

import { CoworkInterruptionCause } from '../../../shared/cowork/interruption';
import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalMode,
  WorkbenchApprovalRiskLevel,
} from '../../../shared/workbenchTask';
import {
  classifyWorkbenchToolRisk,
  createToolIdempotencyKey,
} from '../../workbenchTask/riskClassifier';
import type { WorkbenchTaskService } from '../../workbenchTask/taskService';
import type { PiPermissionRequest, PiPermissionResult } from './piRuntimeTypes';

export interface PiToolAuthorizationInput {
  sessionId: string;
  runId: string | null;
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  approvalMode: WorkbenchApprovalMode;
  annotations?: ToolAnnotations;
}

export interface PiToolAuthorizationResult {
  allow: boolean;
  reason?: string;
}

export interface PiToolPermissionGateHost {
  approvalSessionMap: Map<string, string>;
  getWorkbenchTaskService(): WorkbenchTaskService | null;
  emit(event: 'permissionRequest', sessionId: string, request: PiPermissionRequest): unknown;
  emit(event: 'permissionDismiss', requestId: string): unknown;
  stopActiveSession(
    sessionId: string,
    reason: string,
    drainQueuedFollowUp: boolean,
    cause?: CoworkInterruptionCause,
  ): void;
}

type PendingToolApproval = {
  sessionId: string;
  runId: string | null;
  toolCallId: string;
  resolve: (result: PiToolAuthorizationResult) => void;
};

function requiresToolPermissionPrompt(
  approvalMode: WorkbenchApprovalMode,
  riskLevel: WorkbenchApprovalRiskLevel,
): boolean {
  if (approvalMode === WorkbenchApprovalMode.AllowAll) return false;
  if (riskLevel === WorkbenchApprovalRiskLevel.ReadOnly) return false;
  if (approvalMode === WorkbenchApprovalMode.Auto) {
    return riskLevel !== WorkbenchApprovalRiskLevel.Reversible;
  }
  return true;
}

export class PiToolPermissionGate {
  private readonly pendingApprovals = new Map<string, PendingToolApproval>();

  constructor(private readonly host: PiToolPermissionGateHost) {}

  async authorizeToolCall(input: PiToolAuthorizationInput): Promise<PiToolAuthorizationResult> {
    const riskLevel = classifyWorkbenchToolRisk(input.toolName, input.toolInput, input.annotations);
    const idempotencyKey = createToolIdempotencyKey(
      input.runId ?? input.sessionId,
      input.toolCallId,
      input.toolInput,
    );
    const promptRequired = requiresToolPermissionPrompt(input.approvalMode, riskLevel);
    const requestId = randomUUID();
    const workbench = this.host.getWorkbenchTaskService();

    if (!promptRequired) {
      workbench?.recordToolCallObserved?.({
        runId: input.runId,
        approvalId: requestId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        toolInput: input.toolInput,
        riskLevel,
        idempotencyKey,
        autoApproved: true,
      });
      return { allow: true };
    }

    workbench?.recordToolCallObserved?.({
      runId: input.runId,
      approvalId: requestId,
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      toolInput: input.toolInput,
      riskLevel,
      idempotencyKey,
      autoApproved: false,
    });

    const decisionPromise = new Promise<PiToolAuthorizationResult>(resolve => {
      this.pendingApprovals.set(requestId, {
        sessionId: input.sessionId,
        runId: input.runId,
        toolCallId: input.toolCallId,
        resolve,
      });
    });

    this.host.approvalSessionMap.set(requestId, input.sessionId);
    this.host.emit('permissionRequest', input.sessionId, {
      requestId,
      toolName: input.toolName,
      toolInput: input.toolInput,
      toolUseId: input.toolCallId,
    });

    return await decisionPromise;
  }

  hasPendingApproval(requestId: string): boolean {
    return this.pendingApprovals.has(requestId);
  }

  resolvePermission(requestId: string, result: PiPermissionResult): boolean {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return false;

    this.pendingApprovals.delete(requestId);
    this.host.approvalSessionMap.delete(requestId);

    const denied = result.behavior === 'deny';
    const reason = denied ? result.message || 'The user denied this action.' : undefined;
    this.host.getWorkbenchTaskService()?.recordToolApprovalDecision?.({
      approvalId: requestId,
      runId: pending.runId,
      decision: denied ? WorkbenchApprovalDecision.Denied : WorkbenchApprovalDecision.Approved,
      reason,
    });

    pending.resolve(denied ? { allow: false, reason } : { allow: true });
    return true;
  }

  clearBySession(
    sessionId: string,
    reason = 'The session stopped before the approval resolved.',
  ): void {
    for (const [requestId, pending] of this.pendingApprovals.entries()) {
      if (pending.sessionId !== sessionId) continue;
      this.pendingApprovals.delete(requestId);
      this.host.approvalSessionMap.delete(requestId);
      this.host.getWorkbenchTaskService()?.recordToolApprovalDecision?.({
        approvalId: requestId,
        runId: pending.runId,
        decision: WorkbenchApprovalDecision.Expired,
        reason,
      });
      pending.resolve({ allow: false, reason });
      this.host.emit('permissionDismiss', requestId);
    }
  }
}
