import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { CoworkArtifactRole } from '../../shared/cowork/artifacts';
import {
  WorkbenchApprovalMode,
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchTaskStatus,
  WorkbenchVerificationOutcome,
} from '../../shared/workbenchTask';
import { initializeProductionLoopSchema } from '../productionLoop/schema';
import { collectWorkbenchArtifacts } from './artifactCollector';
import { collectWorkbenchArtifactsAsync } from './artifactWorkerPool';
import { initializeWorkbenchTaskSchema } from './schema';
import { WorkbenchTaskService } from './taskService';

vi.mock('./artifactWorkerPool', () => ({
  collectWorkbenchArtifactsAsync: vi.fn(
    async (input: Parameters<typeof collectWorkbenchArtifacts>[0]) =>
      collectWorkbenchArtifacts(input),
  ),
}));

const fixtures: Array<{ db: Database.Database; workspace: string }> = [];
const createFixture = () => {
  const db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  initializeProductionLoopSchema(db);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-acceptance-'));
  fixtures.push({ db, workspace });
  const onVerifiedRun = vi.fn();
  const service = new WorkbenchTaskService(db, { onVerifiedRun });
  return { service, workspace, onVerifiedRun };
};
afterEach(() => {
  vi.clearAllMocks();
  for (const fixture of fixtures.splice(0)) {
    fixture.db.close();
    fs.rmSync(fixture.workspace, { recursive: true, force: true });
  }
});

test.each([undefined, { productionActive: false }, { skipped: true }])(
  'process text and a successful script edit cannot be accepted (%j)',
  async workflowSnapshot => {
    const { service, workspace, onVerifiedRun } = createFixture();
    const { task, run } = service.beginRun({
      sessionId: 'session',
      goal: 'Create a presentation',
      contract: { kind: WorkbenchContractKind.GenericWork, requiresUserAcceptance: false },
    });
    fs.writeFileSync(path.join(workspace, 'build-slides.py'), 'print("intermediate")');
    await service.authorizeToolCall({
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'edit',
      toolName: 'edit',
      toolInput: { path: 'build-slides.py' },
      approvalMode: WorkbenchApprovalMode.AllowAll,
    });
    service.recordToolResult(run.id, 'edit', { content: [] }, false);
    const detail = await service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      finalAnswer: 'The icon series needs a fill type first.',
      workflowSnapshot,
    });
    expect(detail.task.status).toBe(WorkbenchTaskStatus.NeedsReview);
    expect(detail.runs[0].verificationResult?.outcome).toBe(WorkbenchVerificationOutcome.Failed);
    expect(() => service.acceptTask(task.id)).toThrow('deterministic verification failed');
    expect(onVerifiedRun).not.toHaveBeenCalled();
  },
);

test('declaring only intermediate files does not open the acceptance gate', async () => {
  const { service, workspace } = createFixture();
  fs.writeFileSync(path.join(workspace, 'script.py'), 'print(1)');
  const { run } = service.beginRun({
    sessionId: 'session',
    goal: 'Create a report',
    contract: { kind: WorkbenchContractKind.GenericWork, requiresUserAcceptance: true },
  });
  await service.registerArtifact({
    sessionId: 'session',
    runId: run.id,
    workspaceRoot: workspace,
    candidate: {
      path: 'script.py',
      source: WorkbenchArtifactCandidateSource.Declaration,
      role: CoworkArtifactRole.Intermediate,
    },
  });
  const detail = await service.completeRun({
    sessionId: 'session',
    runId: run.id,
    workspaceRoot: workspace,
    finalAnswer: 'I still need to generate the report.',
  });
  expect(detail.runs[0].verificationResult?.outcome).toBe(WorkbenchVerificationOutcome.Failed);
});

test('acceptance verifies final outputs but not intermediate files', async () => {
  const { service, workspace, onVerifiedRun } = createFixture();
  const { task, run } = service.beginRun({
    sessionId: 'session',
    goal: 'Create a report',
    contract: { kind: WorkbenchContractKind.GenericWork, requiresUserAcceptance: false },
  });
  for (const [name, role] of [
    ['script.py', CoworkArtifactRole.Intermediate],
    ['report.md', CoworkArtifactRole.Deliverable],
  ] as const) {
    fs.writeFileSync(path.join(workspace, name), 'content');
    await service.registerArtifact({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      candidate: { path: name, source: WorkbenchArtifactCandidateSource.Declaration, role },
    });
  }
  const detail = await service.completeRun({
    sessionId: 'session',
    runId: run.id,
    workspaceRoot: workspace,
    finalAnswer: 'The final report is attached.',
  });
  expect(detail.runs[0].verificationResult?.outcome).toBe(
    WorkbenchVerificationOutcome.AcceptanceRequired,
  );
  const accepted = service.acceptTask(task.id);
  expect(
    accepted.artifacts.find(artifact => artifact.reference === 'script.py')?.verificationStatus,
  ).toBe(WorkbenchArtifactVerificationStatus.Pending);
  expect(
    accepted.artifacts.find(artifact => artifact.reference === 'report.md')?.verificationStatus,
  ).toBe(WorkbenchArtifactVerificationStatus.Verified);
  expect(onVerifiedRun).toHaveBeenCalledOnce();
});

test('an empty final answer cannot be accepted even with a final file', async () => {
  const { service, workspace } = createFixture();
  fs.writeFileSync(path.join(workspace, 'report.md'), '# report');
  const { run } = service.beginRun({
    sessionId: 'session',
    goal: 'Create a report',
    contract: { kind: WorkbenchContractKind.GenericWork, requiresUserAcceptance: true },
  });
  const detail = await service.completeRun({
    sessionId: 'session',
    runId: run.id,
    workspaceRoot: workspace,
    finalAnswer: '',
    artifactCandidates: [
      {
        path: 'report.md',
        role: CoworkArtifactRole.Deliverable,
        source: WorkbenchArtifactCandidateSource.Declaration,
      },
    ],
  });
  expect(detail.runs[0].verificationResult?.outcome).toBe(WorkbenchVerificationOutcome.Failed);
});

test.each(['deleted', 'changed'])('a %s declared deliverable cannot be accepted', async change => {
  const { service, workspace } = createFixture();
  const file = path.join(workspace, 'report.md');
  fs.writeFileSync(file, '# original report');
  const { task, run } = service.beginRun({
    sessionId: 'session',
    goal: 'Create a report',
    contract: { kind: WorkbenchContractKind.GenericWork, requiresUserAcceptance: false },
  });
  await service.registerArtifact({
    sessionId: 'session',
    runId: run.id,
    workspaceRoot: workspace,
    candidate: {
      path: file,
      role: CoworkArtifactRole.Deliverable,
      source: WorkbenchArtifactCandidateSource.Declaration,
    },
  });
  if (change === 'deleted') fs.unlinkSync(file);
  else fs.writeFileSync(file, '# changed after declaration');
  const detail = await service.completeRun({
    sessionId: 'session',
    runId: run.id,
    workspaceRoot: workspace,
    finalAnswer: 'Done',
  });
  expect(detail.runs[0].verificationResult?.outcome).toBe(WorkbenchVerificationOutcome.Failed);
  expect(() => service.acceptTask(task.id)).toThrow('deterministic verification failed');
});

test('a superseded run cannot publish artifacts or verified memory after worker completion', async () => {
  const { service, workspace, onVerifiedRun } = createFixture();
  const { task, run } = service.beginRun({
    sessionId: 'session',
    goal: 'Answer',
    contract: { kind: WorkbenchContractKind.Chat, requiresUserAcceptance: false },
  });
  let resolve!: (artifacts: []) => void;
  vi.mocked(collectWorkbenchArtifactsAsync).mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  const pending = service.completeRun({
    sessionId: 'session',
    runId: run.id,
    workspaceRoot: workspace,
    finalAnswer: 'Answer',
  });
  service.cancelRun('session', run.id);
  resolve([]);
  expect((await pending).task.status).toBe(WorkbenchTaskStatus.Cancelled);
  expect(service.getDetail(task.id)?.artifacts).toEqual([]);
  expect(onVerifiedRun).not.toHaveBeenCalled();
});
