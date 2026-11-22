/**
 * Pi-native tool permission gate.
 *
 * Replaces Workbench's blocking `authorizeToolCall` + idempotency-replay breaker
 * with a direct risk check + user permission request when required by the
 * session's approvalMode (`Ask` / `Auto` / `AllowAll`). Passive run/approval
 * recording is forwarded best-effort to WorkbenchTaskService so the read-only
 * trace tab still reflects tool activity without gating Pi execution.
 */

import { observeWorkbench } from '../../workbenchTask/observe';

import { randomUUID } from 'crypto';

import type { ToolAnnotations } from '@earendil-works/pi-coding-agent';

import {
  WorkbenchApprovalDecision,
  WorkbenchApprovalMode,
  WorkbenchApprovalRiskLevel,
} from '../../../shared/workbenchTask';
import { classifyWorkbenchToolRisk } from '../../workbenchTask/riskClassifier';
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
  getWorkbenchTaskService(): WorkbenchTaskService | null;
  emit(event: 'permissionRequest', sessionId: string, request: PiPermissionRequest): unknown;
  emit(event: 'permissionDismiss', requestId: string): unknown;
}

type PendingToolApproval = {
  sessionId: string;
  requestedAt: number;
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
    const promptRequired = requiresToolPermissionPrompt(input.approvalMode, riskLevel);
    const requestId = randomUUID();

    observeWorkbench(input.sessionId, () => {
      this.host.getWorkbenchTaskService()?.recordToolCallObserved?.({
        runId: input.runId,
        approvalId: requestId,
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        toolInput: input.toolInput,
        riskLevel,
        idempotencyKey: requestId,
        autoApproved: !promptRequired,
      });
    });
    if (!promptRequired) return { allow: true };
    const decisionPromise = new Promise<PiToolAuthorizationResult>(resolve => {
      this.pendingApprovals.set(requestId, {
        sessionId: input.sessionId,
        requestedAt: performance.now(),
        resolve,
      });
    });

    this.host.emit('permissionRequest', input.sessionId, {
      requestId,
      toolName: input.toolName,
      toolInput: input.toolInput,
      toolUseId: input.toolCallId,
    });

    return await decisionPromise;
  }

  firstPendingApproval(
    matches: (sessionId: string) => boolean,
  ): Pick<PendingToolApproval, 'sessionId' | 'requestedAt'> | undefined {
    for (const pending of this.pendingApprovals.values()) {
      if (matches(pending.sessionId)) return pending;
    }
  }

  resolvePermission(requestId: string, result: PiPermissionResult): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return;

    this.pendingApprovals.delete(requestId);

    const denied = result.behavior === 'deny';
    const reason = denied ? result.message || 'The user denied this action.' : undefined;
    observeWorkbench(pending.sessionId, () => {
      this.host.getWorkbenchTaskService()?.recordToolApprovalDecision?.({
        approvalId: requestId,
        decision: denied ? WorkbenchApprovalDecision.Denied : WorkbenchApprovalDecision.Approved,
        reason,
      });
    });
    pending.resolve(denied ? { allow: false, reason } : { allow: true });
    this.host.emit('permissionDismiss', requestId);
  }

  clearBySession(
    sessionId: string,
    reason = 'The session stopped before the approval resolved.',
  ): void {
    for (const [requestId, pending] of this.pendingApprovals.entries()) {
      if (pending.sessionId !== sessionId) continue;
      this.pendingApprovals.delete(requestId);
      observeWorkbench(sessionId, () => {
        this.host.getWorkbenchTaskService()?.recordToolApprovalDecision?.({
          approvalId: requestId,
          decision: WorkbenchApprovalDecision.Expired,
          reason,
        });
      });
      pending.resolve({ allow: false, reason });
      this.host.emit('permissionDismiss', requestId);
    }
  }
}
