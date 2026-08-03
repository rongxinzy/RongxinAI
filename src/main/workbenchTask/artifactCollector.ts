import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';

import {
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
  discoverWorkbenchMessageArtifactBlocks,
  type WorkbenchArtifact,
} from '../../shared/workbenchTask';

type ArtifactInput = Omit<WorkbenchArtifact, 'id' | 'createdAt' | 'updatedAt'>;

const hashText = (value: string): string => createHash('sha256').update(value).digest('hex');

const mimeForPath = (filePath: string): string => {
  const extension = path.extname(filePath).toLowerCase();
  const mapping: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
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

const resolveWorkspaceFile = (workspaceRoot: string, reference: string): string | null => {
  if (!reference.trim() || path.isAbsolute(reference)) return null;
  const lexical = path.resolve(workspaceRoot, reference);
  const relative = path.relative(workspaceRoot, lexical);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(lexical))
    return null;
  try {
    const resolvedRoot = fs.realpathSync(workspaceRoot);
    const resolved = fs.realpathSync(lexical);
    const realRelative = path.relative(resolvedRoot, resolved);
    const stat = fs.statSync(resolved);
    return realRelative.startsWith('..') || path.isAbsolute(realRelative) || !stat.isFile()
      ? null
      : resolved;
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
  toolArtifacts?: Array<Record<string, unknown>>;
}): ArtifactInput[] {
  const artifacts: ArtifactInput[] = [];
  for (const block of discoverWorkbenchMessageArtifactBlocks(input.finalAnswer)) {
    const content = block.content.trim();
    if (!content) continue;
    artifacts.push({
      taskId: input.taskId,
      runId: input.runId,
      kind: WorkbenchArtifactKind.MessageBlock,
      mimeType: block.language === 'html' ? 'text/html' : 'text/plain',
      reference: `message:${input.finalMessageId || 'final'}:block:${block.index}`,
      contentHash: hashText(content),
      provenance: WorkbenchArtifactProvenance.Message,
      verificationStatus: WorkbenchArtifactVerificationStatus.Verified,
      metadata: { language: block.language, blockIndex: block.index },
    });
  }

  const snapshotFiles: Array<{
    value: unknown;
    provenance: WorkbenchArtifactProvenance;
  }> = [
    ...(Array.isArray(input.workflowSnapshot?.files) ? input.workflowSnapshot.files : []).map(
      value => ({ value, provenance: WorkbenchArtifactProvenance.Controller }),
    ),
    ...(Array.isArray(input.workflowSnapshot?.artifacts)
      ? input.workflowSnapshot.artifacts
      : []
    ).map(value => ({ value, provenance: WorkbenchArtifactProvenance.Controller })),
    ...(input.toolArtifacts ?? []).map(value => ({
      value,
      provenance: WorkbenchArtifactProvenance.Workspace,
    })),
  ];
  for (const { value, provenance } of snapshotFiles) {
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    const reference = typeof record.path === 'string' ? record.path : '';
    const resolved = resolveWorkspaceFile(input.workspaceRoot, reference);
    if (!resolved) continue;
    const contentHash = createHash('sha256').update(fs.readFileSync(resolved)).digest('hex');
    const declaredHash = typeof record.sha256 === 'string' ? record.sha256 : null;
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
          : WorkbenchArtifactVerificationStatus.Verified,
      metadata: {
        ...(typeof record.role === 'string' ? { role: record.role } : {}),
        ...(typeof record.verifiedAt === 'string' ? { verifiedAt: record.verifiedAt } : {}),
        ...(declaredHash ? { declaredHash } : {}),
      },
    });
  }
  return artifacts;
}

export { resolveWorkspaceFile };
