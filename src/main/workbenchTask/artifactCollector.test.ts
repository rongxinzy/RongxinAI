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

test('accepts workspace files while rejecting absolute and relative escapes', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-outside-'));
  const filePath = path.join(workspace, 'result.md');
  const dotFilePath = path.join(workspace, '..draft.md');
  const outsidePath = path.join(outside, 'outside.md');
  fs.writeFileSync(filePath, '# result');
  fs.writeFileSync(dotFilePath, '# draft');
  fs.writeFileSync(outsidePath, '# outside');
  try {
    expect(resolveWorkspaceFile(workspace, 'result.md')).toBe(fs.realpathSync(filePath));
    expect(resolveWorkspaceFile(workspace, filePath)).toBe(fs.realpathSync(filePath));
    expect(resolveWorkspaceFile(workspace, '..draft.md')).toBe(fs.realpathSync(dotFilePath));
    expect(resolveWorkspaceFile(workspace, outsidePath)).toBeNull();
    expect(resolveWorkspaceFile(workspace, '../outside.md')).toBeNull();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
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

test('uses the final message id in message-block references', () => {
  const [artifact] = collectWorkbenchArtifacts({
    taskId: 'task',
    runId: 'run',
    workspaceRoot: process.cwd(),
    finalAnswer: '```artifact:html title="Preview"\n<h1>Hello</h1>\n```',
    finalMessageId: 'assistant-1',
  });

  expect(artifact.reference).toBe('message:assistant-1:block:0');
});

test('accepts a declared deliverable outside the workspace as an external artifact', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-ws-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-user-specified-'));
  const deliverablePath = path.join(outsideDir, 'report.md');
  fs.writeFileSync(deliverablePath, '# user specified output');
  try {
    const [artifact] = collectWorkbenchArtifacts({
      taskId: 'task',
      runId: 'run',
      workspaceRoot: workspace,
      finalAnswer: '',
      artifactCandidates: [
        {
          path: deliverablePath,
          role: 'deliverable',
          source: WorkbenchArtifactCandidateSource.Declaration,
        },
      ],
    });

    // The workspace gate no longer swallows user-specified output locations:
    // the file keeps its absolute path and is marked as external.
    expect(artifact.reference).toBe(fs.realpathSync(deliverablePath));
    expect(artifact.provenance).toBe(WorkbenchArtifactProvenance.External);
    expect(artifact.metadata).toMatchObject({ outsideWorkspace: true });
    expect(artifact.contentHash).toBeTruthy();
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('still throws when the declared deliverable is actually missing', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-ws-'));
  try {
    expect(() =>
      collectWorkbenchArtifacts({
        taskId: 'task',
        runId: 'run',
        workspaceRoot: workspace,
        finalAnswer: '',
        artifactCandidates: [
          {
            path: path.join(workspace, 'does-not-exist.md'),
            role: 'deliverable',
            source: WorkbenchArtifactCandidateSource.Declaration,
          },
        ],
      }),
    ).toThrow('The declared deliverable is missing');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('skips non-deliverable declarations outside the workspace', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-ws-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-scratch-'));
  const scratchPath = path.join(outsideDir, 'notes.md');
  fs.writeFileSync(scratchPath, '# scratch');
  try {
    const artifacts = collectWorkbenchArtifacts({
      taskId: 'task',
      runId: 'run',
      workspaceRoot: workspace,
      finalAnswer: '',
      artifactCandidates: [
        {
          path: scratchPath,
          role: 'intermediate',
          source: WorkbenchArtifactCandidateSource.Declaration,
        },
      ],
    });

    expect(artifacts).toEqual([]);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('reports a directory declaration as not a readable file instead of missing', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-ws-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workbench-artifact-dir-'));
  try {
    expect(() =>
      collectWorkbenchArtifacts({
        taskId: 'task',
        runId: 'run',
        workspaceRoot: workspace,
        finalAnswer: '',
        artifactCandidates: [
          {
            path: outsideDir,
            role: 'deliverable',
            source: WorkbenchArtifactCandidateSource.Declaration,
          },
        ],
      }),
    ).toThrow('The declared deliverable is not a readable file');
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});
