import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { CoworkArtifactRole } from '../../shared/cowork/artifacts';
import {
  WorkbenchApprovalMode,
  WorkbenchApprovalRiskLevel,
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactKind,
  WorkbenchArtifactVerificationStatus,
  WorkbenchContractKind,
  WorkbenchOutputMode,
  WorkbenchOutputToolName,
  WorkbenchRunTrigger,
  WorkbenchVerificationOutcome,
} from '../../shared/workbenchTask';
import { collectWorkbenchArtifacts } from './artifactCollector';
import { setWorkbenchOutputRequirements, normalizeOutputRequirements } from './outputContract';
import { initializeWorkbenchTaskSchema } from './schema';
import { initializeProductionLoopSchema } from '../productionLoop/schema';
import { WorkbenchTaskService } from './taskService';
import { classifyWorkbenchToolRisk } from './riskClassifier';

vi.mock('./artifactWorkerPool', () => ({
  collectWorkbenchArtifactsAsync: async (input: Parameters<typeof collectWorkbenchArtifacts>[0]) =>
    collectWorkbenchArtifacts(input),
}));

const fixture = () => {
  const db = new Database(':memory:');
  initializeWorkbenchTaskSchema(db);
  initializeProductionLoopSchema(db);
  const service = new WorkbenchTaskService(db);
  const { task, run } = service.beginRun({
    sessionId: 'session',
    goal: 'user requested output',
    contract: {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: false,
      outputRequirements: [],
    },
  });
  return { db, service, task, run };
};

test('persists normalized requirements across service reconstruction and retry; refuses downgrades and foreign runs', () => {
  const { db, service, task, run } = fixture();
  try {
    setWorkbenchOutputRequirements(service.repository, 'session', run.id, [
      { mode: WorkbenchOutputMode.File, formats: ['.XLSX', 'xlsx'] },
    ]);
    const requirements = [{ mode: WorkbenchOutputMode.File, formats: ['xlsx'] }];
    expect(
      new WorkbenchTaskService(db).getDetail(task.id)?.task.contract.outputRequirements,
    ).toEqual(requirements);
    setWorkbenchOutputRequirements(service.repository, 'session', run.id, requirements);
    expect(() =>
      setWorkbenchOutputRequirements(service.repository, 'other', run.id, requirements),
    ).toThrow('active run');
    expect(() =>
      setWorkbenchOutputRequirements(service.repository, 'session', run.id, [
        { mode: WorkbenchOutputMode.Text, formats: [] },
      ]),
    ).toThrow('already committed');
    service.pauseRun('session', 'retry');
    const retry = service.prepareRun(task.id, WorkbenchRunTrigger.Resume);
    service.beginRun({
      sessionId: 'session',
      goal: task.goal,
      contract: task.contract,
      preparedRunId: retry.run.id,
    });
    expect(service.getDetail(task.id)?.task.contract.outputRequirements).toEqual(requirements);
    expect(() =>
      setWorkbenchOutputRequirements(service.repository, 'session', run.id, requirements),
    ).toThrow('active run');
  } finally {
    db.close();
  }
});

test('requires the contract before side effects, but the output tool itself never prompts for permission', async () => {
  const { db, service, run } = fixture();
  try {
    expect(classifyWorkbenchToolRisk(WorkbenchOutputToolName, {})).toBe(
      WorkbenchApprovalRiskLevel.ReadOnly,
    );
    const action = {
      sessionId: 'session',
      runId: run.id,
      toolCallId: 'write',
      toolName: 'write',
      toolInput: { path: 'scratch.py' },
      approvalMode: WorkbenchApprovalMode.AllowAll,
    };
    expect((await service.authorizeToolCall(action)).allow).toBe(false);
    setWorkbenchOutputRequirements(service.repository, 'session', run.id, [
      { mode: WorkbenchOutputMode.Text, formats: [] },
    ]);
    expect((await service.authorizeToolCall(action)).allow).toBe(true);
  } finally {
    db.close();
  }
});

test.each([false, true])(
  'CSV cannot replace required XLSX when productionActive=%s',
  async productionActive => {
    const { db, service, task, run } = fixture();
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'output-contract-'));
    try {
      fs.writeFileSync(path.join(workspace, 'table.csv'), 'a,b\n1,2');
      setWorkbenchOutputRequirements(service.repository, 'session', run.id, [
        { mode: WorkbenchOutputMode.File, formats: ['xlsx'] },
      ]);
      const detail = await service.completeRun({
        sessionId: 'session',
        runId: run.id,
        workspaceRoot: workspace,
        finalAnswer: '```python\nprint(1)\n```',
        workflowSnapshot: { productionActive },
        artifactCandidates: [
          {
            path: 'table.csv',
            source: WorkbenchArtifactCandidateSource.Declaration,
            role: CoworkArtifactRole.Deliverable,
          },
        ],
      });
      expect(detail.runs[0].verificationResult?.outcome).toBe(WorkbenchVerificationOutcome.Failed);
      expect(
        detail.artifacts.find(artifact => artifact.kind === WorkbenchArtifactKind.File)?.mimeType,
      ).toBe('text/csv');
      expect(
        detail.artifacts.find(artifact => artifact.kind === WorkbenchArtifactKind.MessageBlock)
          ?.verificationStatus,
      ).toBe(WorkbenchArtifactVerificationStatus.Pending);
      expect(() => service.acceptTask(task.id)).toThrow('cannot be accepted');
    } finally {
      db.close();
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  },
);

test('declared CSV is accepted while ordinary fragments stay unverified with production dormant', async () => {
  const { db, service, task, run } = fixture();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'csv-delivery-'));
  try {
    fs.writeFileSync(path.join(workspace, 'table.csv'), 'a,b\n1,2');
    setWorkbenchOutputRequirements(service.repository, 'session', run.id, [
      { mode: WorkbenchOutputMode.File, formats: ['csv'] },
    ]);
    const detail = await service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      finalAnswer: 'Table delivered.\n```csv\na,b\n1,2\n```',
      workflowSnapshot: { productionActive: false },
      artifactCandidates: [
        {
          path: 'table.csv',
          source: WorkbenchArtifactCandidateSource.Declaration,
          role: CoworkArtifactRole.Deliverable,
        },
      ],
    });
    expect(detail.runs[0].verificationResult?.outcome).toBe(
      WorkbenchVerificationOutcome.AcceptanceRequired,
    );
    const accepted = service.acceptTask(task.id);
    expect(
      accepted.artifacts.find(artifact => artifact.kind === WorkbenchArtifactKind.File)
        ?.verificationStatus,
    ).toBe(WorkbenchArtifactVerificationStatus.Verified);
    expect(
      accepted.artifacts.find(artifact => artifact.kind === WorkbenchArtifactKind.MessageBlock)
        ?.verificationStatus,
    ).toBe(WorkbenchArtifactVerificationStatus.Pending);
  } finally {
    db.close();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('an allowed explicit inline table requires acceptance rather than automatic hash-based verification', async () => {
  const { db, service, task, run } = fixture();
  try {
    setWorkbenchOutputRequirements(service.repository, 'session', run.id, [
      { mode: WorkbenchOutputMode.Inline, formats: ['tsv'] },
    ]);
    const detail = await service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: '```artifact:tsv\na\tb\n1\t2\n```',
      workflowSnapshot: { productionActive: false },
    });
    expect(detail.runs[0].verificationResult?.outcome).toBe(
      WorkbenchVerificationOutcome.AcceptanceRequired,
    );
    expect(detail.artifacts[0].mimeType).toBe('text/tab-separated-values');
    expect(service.acceptTask(task.id).artifacts[0].verificationStatus).toBe(
      WorkbenchArtifactVerificationStatus.Verified,
    );
  } finally {
    db.close();
  }
});

test('old Work acceptance records cannot bypass delivery by omitting the output contract', async () => {
  const { db, service, task, run } = fixture();
  try {
    setWorkbenchOutputRequirements(service.repository, 'session', run.id, [
      { mode: WorkbenchOutputMode.Inline, formats: ['csv'] },
    ]);
    await service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: '```artifact:csv\na,b\n1,2\n```',
      workflowSnapshot: { productionActive: false },
    });
    service.repository.updateTaskContract(task.id, {
      kind: WorkbenchContractKind.GenericWork,
      requiresUserAcceptance: true,
    });
    expect(() => service.acceptTask(task.id)).toThrow('no final deliverable');
    expect(service.getDetail(task.id)?.artifacts[0].verificationStatus).toBe(
      WorkbenchArtifactVerificationStatus.Pending,
    );
  } finally {
    db.close();
  }
});

test('rejects invalid and unbounded output contracts', () => {
  expect(() => normalizeOutputRequirements([])).toThrow();
  expect(() =>
    normalizeOutputRequirements([{ mode: WorkbenchOutputMode.File, formats: ['../xlsx'] }]),
  ).toThrow();
  expect(() =>
    normalizeOutputRequirements([{ mode: WorkbenchOutputMode.Text, formats: ['xlsx'] }]),
  ).toThrow();
  expect(() =>
    normalizeOutputRequirements(
      Array.from({ length: 17 }, () => ({ mode: WorkbenchOutputMode.Text, formats: [] })),
    ),
  ).toThrow();
});

test('a text task with a scratch script completes without accepting the script or response fragment', async () => {
  const { db, service, run } = fixture();
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'text-output-'));
  try {
    fs.writeFileSync(path.join(workspace, 'scratch.py'), 'print(1)');
    setWorkbenchOutputRequirements(service.repository, 'session', run.id, [
      { mode: WorkbenchOutputMode.Text, formats: [] },
    ]);
    const detail = await service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: workspace,
      finalAnswer: 'The answer is one.\n```python\nprint(1)\n```',
      workflowSnapshot: { productionActive: false },
      artifactCandidates: [
        { path: 'scratch.py', source: WorkbenchArtifactCandidateSource.ToolEffect },
      ],
    });
    expect(detail.runs[0].verificationResult?.outcome).toBe(WorkbenchVerificationOutcome.Passed);
    expect(
      detail.artifacts.every(
        artifact => artifact.verificationStatus === WorkbenchArtifactVerificationStatus.Pending,
      ),
    ).toBe(true);
  } finally {
    db.close();
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

test('a nonempty final answer cannot complete an uncommitted Work contract', async () => {
  const { db, service, task, run } = fixture();
  try {
    const detail = await service.completeRun({
      sessionId: 'session',
      runId: run.id,
      workspaceRoot: process.cwd(),
      finalAnswer: 'Not finished yet.',
      workflowSnapshot: { productionActive: false },
    });
    expect(detail.runs[0].verificationResult?.outcome).toBe(WorkbenchVerificationOutcome.Failed);
    expect(() => service.acceptTask(task.id)).toThrow('cannot be accepted');
  } finally {
    db.close();
  }
});
