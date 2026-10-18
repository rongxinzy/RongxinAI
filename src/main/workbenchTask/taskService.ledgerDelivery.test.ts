import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, expect, test, vi } from 'vitest';

import { CoworkArtifactRole, type CoworkPersistedArtifact } from '../../shared/cowork/artifacts';
import {
  WorkbenchArtifactCandidateSource,
  WorkbenchArtifactKind,
  WorkbenchContractKind,
} from '../../shared/workbenchTask';
import { collectWorkbenchArtifacts } from './artifactCollector';
import { getLedgerRunCandidates } from './artifactCompletion';
import { initializeWorkbenchTaskSchema } from './schema';
import { WorkbenchTaskService } from './taskService';

vi.mock('./artifactWorkerPool', () => ({
  collectWorkbenchArtifactsAsync: async (input: Parameters<typeof collectWorkbenchArtifacts>[0]) =>
    collectWorkbenchArtifacts(input),
}));

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

const row = (overrides: Partial<CoworkPersistedArtifact>): CoworkPersistedArtifact => ({
  id: 'row',
  messageId: 'answer',
  toolCallId: 'call-1',
  runId: 'run',
  type: 'markdown',
  title: 'report.md',
  content: '',
  source: 'tool',
  role: CoworkArtifactRole.Intermediate,
  declared: false,
  createdAt: 1,
  ...overrides,
});

test('ledger candidates keep only this run, skip declared files and dedupe paths', () => {
  const declared = [{ path: 'final.pptx', source: WorkbenchArtifactCandidateSource.Declaration }];
  const candidates = getLedgerRunCandidates(
    [
      row({ filePath: '/work/report.md' }),
      row({ id: 'again', filePath: 'report.md' }),
      row({ id: 'other-run', runId: 'other', filePath: '/work/old.md' }),
      row({ id: 'declared', filePath: '/work/final.pptx' }),
      row({ id: 'inline', filePath: undefined }),
    ],
    'run',
    '/work',
    declared,
  );
  expect(candidates).toEqual([
    {
      path: '/work/report.md',
      source: WorkbenchArtifactCandidateSource.ToolEffect,
      verificationStatus: 'pending',
    },
  ]);
});

test('completeRun collects the files the ledger recorded for the run once it settles', async () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-delivery-'));
  const db = new Database(':memory:');
  cleanups.push(() => {
    db.close();
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  initializeWorkbenchTaskSchema(db);
  const rows: CoworkPersistedArtifact[] = [];
  const listLedgerArtifacts = vi.fn((scopeId: string) => (scopeId === 'lane-1' ? rows : []));
  const service = new WorkbenchTaskService(db, { listLedgerArtifacts });
  const { task, run } = service.beginRun({
    sessionId: 'session',
    goal: 'write a report',
    contract: { kind: WorkbenchContractKind.Chat, requiresUserAcceptance: false },
  });
  const reportPath = path.join(workspace, 'report.md');
  fs.writeFileSync(reportPath, '# report');

  // The settle-time diff lands the row only after completion started.
  const artifactsSettled = Promise.resolve().then(() => {
    rows.push(row({ runId: run.id, filePath: reportPath }));
    rows.push(row({ id: 'stale', runId: 'older-run', filePath: reportPath }));
  });
  await service.completeRun({
    sessionId: 'session',
    artifactScopeId: 'lane-1',
    artifactsSettled,
    runId: run.id,
    workspaceRoot: workspace,
    finalAnswer: 'The report is written to report.md in the workspace.',
  });

  expect(listLedgerArtifacts).toHaveBeenCalledWith('lane-1');
  const files = service
    .getDetail(task.id)!
    .artifacts.filter(artifact => artifact.kind === WorkbenchArtifactKind.File);
  expect(files).toHaveLength(1);
  expect(files[0]).toMatchObject({
    reference: 'report.md',
    metadata: expect.objectContaining({ source: WorkbenchArtifactCandidateSource.ToolEffect }),
  });
});
