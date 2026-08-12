import {
  WorkbenchApprovalEffectStatus,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchVerificationOutcome,
  type WorkbenchApproval,
  type WorkbenchArtifact,
  type WorkbenchRun,
  type WorkbenchTask,
  type WorkbenchVerificationResult,
} from '../../shared/workbenchTask';
import { MemoryKind, MemorySensitivity } from '../../shared/memory';
import type { ProjectMemoryService } from './projectMemoryService';

const MAX_VERIFIED_RESULT_LENGTH = 1_600;

export interface VerifiedWorkbenchRunMemorySource {
  task: WorkbenchTask;
  run: WorkbenchRun;
  artifacts: WorkbenchArtifact[];
  approvals: WorkbenchApproval[];
  verificationResult: WorkbenchVerificationResult;
  workspaceRoot: string;
  finalAnswer: string;
}

export function promoteVerifiedWorkbenchRun(
  service: ProjectMemoryService,
  source: VerifiedWorkbenchRunMemorySource,
): string | null {
  if (source.verificationResult.outcome !== WorkbenchVerificationOutcome.Passed) return null;
  if (source.task.contract.kind === WorkbenchContractKind.Chat) return null;
  const content = compactVerifiedResult(source.finalAnswer);
  if (content.length < 32) return null;
  const artifacts = source.artifacts.filter(
    artifact =>
      artifact.runId === source.run.id &&
      artifact.verificationStatus === WorkbenchArtifactVerificationStatus.Verified,
  );
  const approvals = source.approvals.filter(
    approval =>
      approval.runId === source.run.id &&
      approval.effectStatus === WorkbenchApprovalEffectStatus.Succeeded,
  );
  return service.proposeProjectMemoryCandidate({
    sessionId: source.task.sessionId,
    workingDirectory: source.workspaceRoot,
    type: MemoryKind.Decision,
    title: source.task.goal.slice(0, 120),
    content,
    topicKey: `task/${source.task.id}`,
    importance: artifacts.length > 0 ? 0.8 : 0.65,
    confidence: 1,
    sensitivity: MemorySensitivity.Normal,
    taskId: source.task.id,
    runId: source.run.id,
    artifactId: artifacts[0]?.id,
    approvalId: approvals[0]?.id,
    metadata: {
      artifactIds: artifacts.map(artifact => artifact.id),
      approvalIds: approvals.map(approval => approval.id),
      verificationSummary: source.verificationResult.summary,
    },
  });
}

function compactVerifiedResult(value: string): string {
  const compact = value.trim().replace(/\n{3,}/g, '\n\n');
  if (compact.length <= MAX_VERIFIED_RESULT_LENGTH) return compact;
  return `${compact.slice(0, MAX_VERIFIED_RESULT_LENGTH - 3).trimEnd()}...`;
}
