import { realpathSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { CoworkArtifactRole } from '../../shared/cowork/artifacts';
import {
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactKind,
  WorkbenchArtifactProvenance,
  WorkbenchArtifactVerificationStatus,
} from '../../shared/workbenchTask';
import {
  isValidArtifactWorkerResult,
  resolveDeclaredDeliverablePaths,
} from './artifactWorkerResult';

const input = {
  taskId: 'task',
  runId: 'run',
  workspaceRoot: path.resolve('workspace'),
  finalAnswer: '',
};
const externalPath = path.resolve('external', '项目', 'presentation.pptx');
const artifact = {
  taskId: input.taskId,
  runId: input.runId,
  kind: WorkbenchArtifactKind.File,
  mimeType: 'application/octet-stream',
  reference: externalPath,
  contentHash: 'a'.repeat(64),
  provenance: WorkbenchArtifactProvenance.External,
  verificationStatus: WorkbenchArtifactVerificationStatus.Pending,
  metadata: {
    source: WorkbenchArtifactCandidateSource.Declaration,
    role: CoworkArtifactRole.Deliverable,
    outsideWorkspace: true,
  },
};

test('accepts only the resolved external file declared by the current job', () => {
  expect(isValidArtifactWorkerResult(artifact, input, [externalPath])).toBe(true);
  expect(isValidArtifactWorkerResult(artifact, input, [])).toBe(false);
  expect(
    isValidArtifactWorkerResult(artifact, input, [path.resolve('another', 'presentation.pptx')]),
  ).toBe(false);
  expect(isValidArtifactWorkerResult({ ...artifact, runId: 'other' }, input, [externalPath])).toBe(
    false,
  );
  expect(
    isValidArtifactWorkerResult({ ...artifact, contentHash: 'invalid' }, input, [externalPath]),
  ).toBe(false);
});

test('external flags cannot turn intermediate or automatic artifacts into deliverables', () => {
  for (const metadata of [
    { ...artifact.metadata, role: CoworkArtifactRole.Intermediate },
    { ...artifact.metadata, source: WorkbenchArtifactCandidateSource.ToolEffect },
    { ...artifact.metadata, outsideWorkspace: false },
  ]) {
    expect(isValidArtifactWorkerResult({ ...artifact, metadata }, input, [externalPath])).toBe(
      false,
    );
  }
  expect(
    isValidArtifactWorkerResult(
      { ...artifact, provenance: WorkbenchArtifactProvenance.Workspace },
      input,
      [externalPath],
    ),
  ).toBe(false);
});

test('accepts nested workspace files and rejects relative traversal', () => {
  const workspaceArtifact = {
    ...artifact,
    reference: path.join('project', 'output', 'report.html'),
    provenance: WorkbenchArtifactProvenance.Workspace,
    metadata: {},
  };
  expect(isValidArtifactWorkerResult(workspaceArtifact, input, [])).toBe(true);
  for (const reference of ['../report.html', 'project/../../report.html']) {
    expect(isValidArtifactWorkerResult({ ...workspaceArtifact, reference }, input, [])).toBe(false);
  }
});

test('resolves linked declarations while excluding external intermediate and automatic files', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'artifact-result-'));
  const target = path.join(fixture, 'target');
  const linked = path.join(fixture, 'linked');
  await mkdir(target);
  await writeFile(path.join(target, 'report.md'), '# report');
  await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const candidate = {
    path: path.join(linked, 'report.md'),
    source: WorkbenchArtifactCandidateSource.Declaration,
    role: CoworkArtifactRole.Deliverable,
  };
  try {
    const resolved = await resolveDeclaredDeliverablePaths({
      ...input,
      artifactCandidates: [
        candidate,
        { ...candidate, role: CoworkArtifactRole.Intermediate },
        { ...candidate, source: WorkbenchArtifactCandidateSource.ToolEffect },
        { ...candidate, path: path.join(fixture, 'missing.md') },
        { ...candidate, path: 'relative.md' },
      ],
    });
    expect(resolved).toEqual([realpathSync(candidate.path)]);
    expect(
      isValidArtifactWorkerResult({ ...artifact, reference: resolved[0] }, input, resolved),
    ).toBe(true);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
