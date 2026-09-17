import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { ArtifactWorkerLimit } from './artifactWorkerConstants';
import { CoworkArtifactRole } from '../../shared/cowork/artifacts';
import { getInlineArtifactRole } from '../../shared/cowork/artifactClassification';

import {
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  discoverWorkbenchMessageArtifactBlocks,
  type WorkbenchArtifact,
  type WorkbenchArtifactCandidate,
} from '../../shared/workbenchTask';

type ArtifactInput = Omit<WorkbenchArtifact, 'id' | 'createdAt' | 'updatedAt'>;

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');

const hashFile = (filePath: string): string => {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    if (size > ArtifactWorkerLimit.FileBytes) throw new Error('Artifact file size limit exceeded.');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    let count: number;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      total += count;
      if (total > ArtifactWorkerLimit.FileBytes)
        throw new Error('Artifact file size limit exceeded.');
      hash.update(buffer.subarray(0, count));
    }
    if (total !== size) throw new Error('Artifact file changed during collection.');
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
};

const mimeForPath = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  const mapping: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.json': 'application/json',
    '.html': 'text/html',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.pdf': 'application/pdf',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  return mapping[extension] || 'application/octet-stream';
};

const isOutside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative.split(path.sep)[0] === '..' || path.isAbsolute(relative);
};

const resolveWorkspaceFile = (workspaceRoot: string, reference: string): string | null => {
  if (!reference.trim()) return null;
  const root = path.resolve(workspaceRoot);
  const lexical = path.isAbsolute(reference)
    ? path.normalize(reference)
    : path.resolve(root, reference);
  if (isOutside(root, lexical) || !fs.existsSync(lexical)) return null;
  try {
    const resolvedRoot = fs.realpathSync(root);
    const resolved = fs.realpathSync(lexical);
    const stat = fs.statSync(resolved);
    return isOutside(resolvedRoot, resolved) || !stat.isFile() ? null : resolved;
  } catch {
    return null;
  }
};

export function collectWorkbenchArtifacts(input: {
  taskId: string;
  runId: string;
  workspaceRoot: string;
  finalAnswer: string;
  finalMessageId?: string | null;
  workflowSnapshot?: Record<string, unknown> | null;
  artifactCandidates?: WorkbenchArtifactCandidate[];
}): ArtifactInput[] {
  const artifacts: ArtifactInput[] = [];
  for (const block of discoverWorkbenchMessageArtifactBlocks(input.finalAnswer)) {
    const content = block.content.trim();
    if (!content) continue;
    artifacts.push({
      taskId: input.taskId,
      runId: input.runId,
      kind: WorkbenchArtifactKind.MessageBlock,
      mimeType:
        block.language === 'html'
          ? 'text/html'
          : block.language === 'csv'
            ? 'text/csv'
            : block.language === 'tsv'
              ? 'text/tab-separated-values'
              : 'text/plain',
      reference: `message:${input.finalMessageId || 'final'}:block:${block.index}`,
      contentHash: hashText(content),
      provenance: WorkbenchArtifactProvenance.Message,
      verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
      metadata: {
        language: block.language,
        blockIndex: block.index,
        explicit: block.explicit,
        role: getInlineArtifactRole(block.explicit),
      },
    });
  }

  const snapshotFiles: WorkbenchArtifactCandidate[] = [
    ...(Array.isArray(input.workflowSnapshot?.files) ? input.workflowSnapshot.files : []).map(
      value => ({
        ...(value && typeof value === 'object' ? (value as Record<string, unknown>) : {}),
        path:
          value &&
          typeof value === 'object' &&
          typeof (value as Record<string, unknown>).path === 'string'
            ? String((value as Record<string, unknown>).path)
            : '',
        source: WorkbenchArtifactCandidateSource.DomainWorkflow,
        verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
      }),
    ),
    ...(Array.isArray(input.workflowSnapshot?.artifacts)
      ? input.workflowSnapshot.artifacts
      : []
    ).map(value => ({
      ...(value && typeof value === 'object' ? (value as Record<string, unknown>) : {}),
      path:
        value &&
        typeof value === 'object' &&
        typeof (value as Record<string, unknown>).path === 'string'
          ? String((value as Record<string, unknown>).path)
          : '',
      source: WorkbenchArtifactCandidateSource.DomainWorkflow,
      verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
    })),
    ...(input.artifactCandidates ?? []),
  ];
  for (const candidate of snapshotFiles) {
    const reference = candidate.path;
    const resolved = resolveWorkspaceFile(input.workspaceRoot, reference);
    if (!resolved) {
      if (
        candidate.source === WorkbenchArtifactCandidateSource.Declaration &&
        candidate.role === CoworkArtifactRole.Deliverable
      ) {
        throw new Error('The declared deliverable is missing or outside the workspace.');
      }
      continue;
    }
    const contentHash = hashFile(resolved);
    const declaredHash = candidate.sha256 ?? null;
    const provenance =
      candidate.source === WorkbenchArtifactCandidateSource.DomainWorkflow ||
      candidate.source === WorkbenchArtifactCandidateSource.ProductionInspection
        ? WorkbenchArtifactProvenance.Controller
        : WorkbenchArtifactProvenance.Workspace;
    artifacts.push({
      taskId: input.taskId,
      runId: input.runId,
      kind: WorkbenchArtifactKind.File,
      mimeType: mimeForPath(reference),
      reference: path.relative(input.workspaceRoot, resolved),
      contentHash,
      provenance,
      verificationStatus:
        declaredHash && declaredHash !== contentHash
          ? WorkbenchArtifactVerificationStatus.Failed
          : (candidate.verificationStatus ?? WorkbenchArtifactVerificationStatus.Pending),
      metadata: {
        source: candidate.source,
        ...(candidate.role ? { role: candidate.role } : {}),
        ...(candidate.title ? { title: candidate.title } : {}),
        ...(candidate.kind ? { declaredKind: candidate.kind } : {}),
        ...(declaredHash ? { declaredHash } : {}),
      },
    });
  }
  return artifacts;
}

export { resolveWorkspaceFile };
