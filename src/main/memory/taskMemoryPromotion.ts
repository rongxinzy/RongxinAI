import { MemoryScope } from '../../shared/memory';
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
import { AtomicMemoryExtractor } from './atomicMemoryExtractor';
import { AtomicMemorySourceKind } from './constants';
import type { ProjectMemoryService } from './projectMemoryService';
import type { SessionMemoryCompletion } from './sessionMemoryExtractor';

export interface VerifiedWorkbenchRunMemorySource {
  task: WorkbenchTask;
  run: WorkbenchRun;
  artifacts: WorkbenchArtifact[];
  approvals: WorkbenchApproval[];
  verificationResult: WorkbenchVerificationResult;
  workspaceRoot: string;
  finalAnswer: string;
}

export async function promoteVerifiedWorkbenchRun(
  service: ProjectMemoryService,
  source: VerifiedWorkbenchRunMemorySource,
  complete: SessionMemoryCompletion,
  extractor = new AtomicMemoryExtractor(),
): Promise<string[]> {
  if (source.verificationResult.outcome !== WorkbenchVerificationOutcome.Passed) return [];
  if (source.task.contract.kind === WorkbenchContractKind.Chat) return [];
  if (!source.finalAnswer.trim()) return [];
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
  const extracted = await extractor.extract({
    scope: MemoryScope.Project,
    maxItems: 5,
    complete,
    sources: [
      {
        id: `task:${source.task.id}:goal`,
        kind: AtomicMemorySourceKind.TaskGoal,
        content: source.task.goal,
      },
      {
        id: `run:${source.run.id}:final-answer`,
        kind: AtomicMemorySourceKind.FinalAnswer,
        content: source.finalAnswer,
      },
      {
        id: `run:${source.run.id}:verification`,
        kind: AtomicMemorySourceKind.Verification,
        content: JSON.stringify({
          summary: source.verificationResult.summary,
          checks: source.verificationResult.checks,
          evidence: source.verificationResult.evidence,
        }),
      },
      ...artifacts.map(artifact => ({
        id: `artifact:${artifact.id}`,
        kind: AtomicMemorySourceKind.Artifact,
        content: JSON.stringify({
          reference: artifact.reference,
          contentHash: artifact.contentHash,
          provenance: artifact.provenance,
          metadata: artifact.metadata,
        }),
      })),
      ...approvals.map(approval => ({
        id: `approval:${approval.id}`,
        kind: AtomicMemorySourceKind.Approval,
        content: JSON.stringify({
          toolName: approval.toolName,
          decision: approval.decision,
          effectStatus: approval.effectStatus,
        }),
      })),
    ],
  });
  if (!extracted) return [];
  return extracted.memories.map((memory, index) => {
    const artifact = artifacts.find(item =>
      memory.evidenceSourceIds.includes(`artifact:${item.id}`),
    );
    const approval = approvals.find(item =>
      memory.evidenceSourceIds.includes(`approval:${item.id}`),
    );
    return service.proposeProjectMemoryCandidate({
      sessionId: source.task.sessionId,
      workingDirectory: source.workspaceRoot,
      type: memory.kind,
      title: memory.title,
      content: memory.content,
      topicKey: `task/${source.task.id}/${index + 1}`,
      importance: memory.importance,
      confidence: memory.confidence,
      sensitivity: memory.sensitivity,
      taskId: source.task.id,
      runId: source.run.id,
      artifactId: artifact?.id,
      approvalId: approval?.id,
      metadata: {
        artifactIds: artifacts.map(item => item.id),
        approvalIds: approvals.map(item => item.id),
        verificationSummary: source.verificationResult.summary,
        extraction: extracted.metadataFor(memory),
      },
    });
  });
}
