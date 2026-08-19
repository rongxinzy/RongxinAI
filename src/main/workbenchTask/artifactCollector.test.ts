import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import {
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
} from '../../shared/workbenchTask';
import { collectWorkbenchArtifacts, resolveWorkspaceFile } from './artifactCollector';

test('accepts relative and absolute workspace files and rejects traversing references', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-'));
  const filePath = path.join(workspace, 'result.md');
  fs.writeFileSync(filePath, '# result');
  try {
    expect(resolveWorkspaceFile(workspace, 'result.md')).toBe(fs.realpathSync(filePath));
    expect(resolveWorkspaceFile(workspace, filePath)).toBe(fs.realpathSync(filePath));
    expect(resolveWorkspaceFile(workspace, '../outside.md')).toBeNull();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('rejects files reached through a symlink outside the workspace', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-workspace-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-outside-'));
  const linkedDirectory = path.join(workspace, 'linked');
  fs.writeFileSync(path.join(outside, 'outside.md'), '# outside');
  fs.symlinkSync(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  try {
    expect(resolveWorkspaceFile(workspace, 'linked/outside.md')).toBeNull();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('collects successful tool files using actual content hashes', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-tool-artifact-'));
  fs.writeFileSync(path.join(workspace, 'result.txt'), 'actual content');
  try {
    const [artifact] = collectWorkbenchArtifacts({
      taskId: 'task',
      runId: 'run',
      workspaceRoot: workspace,
      finalAnswer: '',
      artifactCandidates: [
        {
          path: 'result.txt',
          sha256: 'incorrect',
          source: WorkbenchArtifactCandidateSource.ToolEffect,
        },
      ],
    });
    expect(artifact.provenance).toBe(WorkbenchArtifactProvenance.Workspace);
    expect(artifact.contentHash).not.toBe('incorrect');
    expect(artifact.verificationStatus).toBe(WorkbenchArtifactVerificationStatus.Failed);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('marks declared files as pending until a workflow verifies them', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-declared-artifact-'));
  const filePath = path.join(workspace, 'result.md');
  fs.writeFileSync(filePath, '# result');
  try {
    const [artifact] = collectWorkbenchArtifacts({
      taskId: 'task',
      runId: 'run',
      workspaceRoot: workspace,
      finalAnswer: '',
      artifactCandidates: [
        {
          path: filePath,
          role: 'deliverable',
          source: WorkbenchArtifactCandidateSource.Declaration,
        },
      ],
    });
    expect(artifact.reference).toBe('result.md');
    expect(artifact.verificationStatus).toBe(WorkbenchArtifactVerificationStatus.Pending);
    expect(artifact.metadata).toMatchObject({
      role: 'deliverable',
      source: WorkbenchArtifactCandidateSource.Declaration,
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});
