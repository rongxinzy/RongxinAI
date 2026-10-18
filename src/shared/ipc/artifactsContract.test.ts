import { describe, expect, test } from 'vitest';

import { artifactsContract } from './artifactsContract';
import { CoworkArtifactRole, CoworkArtifactSource } from '../cowork/artifacts';

/**
 * Schema fidelity tests: fixtures below are copied from real renderer call
 * sites (useLedgerArtifacts ledger reads, artifact ledger upserts) so a
 * schema drift that would reject a valid production result fails here, and
 * representative bad inputs are proven rejected.
 */

/** `CoworkPersistedArtifact` ledger row as the artifact collector records it. */
const artifactRow = {
  id: 'art-1',
  messageId: 'msg-1',
  toolCallId: 'call-1',
  runId: 'run-1',
  type: 'html' as const,
  title: 'Deployment dashboard',
  content: '<!doctype html><html></html>',
  language: undefined,
  fileName: undefined,
  filePath: undefined,
  source: CoworkArtifactSource.Tool,
  role: CoworkArtifactRole.Deliverable,
  declared: true,
  createdAt: 1770000000000,
};

describe('artifacts contract', () => {
  test('list takes the scope id useLedgerArtifacts passes', () => {
    // useLedgerArtifacts list(scopeId)
    expect(artifactsContract.list.args.safeParse(['ws-abc/lane-1']).success).toBe(true);
    expect(artifactsContract.list.args.safeParse([42]).success).toBe(false);
    expect(artifactsContract.list.args.safeParse([]).success).toBe(false);
  });

  test('list result accepts real ledger rows', () => {
    expect(
      artifactsContract.list.result.safeParse({ success: true, artifacts: [artifactRow] }).success,
    ).toBe(true);
    // Code-block artifact variant: toolCallId null, optional fields omitted
    expect(
      artifactsContract.list.result.safeParse({
        success: true,
        artifacts: [
          {
            id: 'art-2',
            messageId: 'msg-1',
            toolCallId: null,
            runId: null,
            type: 'code',
            title: 'fix.ts',
            content: 'export {};',
            language: 'typescript',
            fileName: 'fix.ts',
            source: CoworkArtifactSource.CodeBlock,
            role: CoworkArtifactRole.Intermediate,
            declared: false,
            createdAt: 1770000000000,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      artifactsContract.list.result.safeParse({ success: false, error: 'db locked' }).success,
    ).toBe(true);
  });

  test('list result rejects an unknown artifact type or source', () => {
    expect(
      artifactsContract.list.result.safeParse({
        success: true,
        artifacts: [{ ...artifactRow, type: 'video' }],
      }).success,
    ).toBe(false);
    expect(
      artifactsContract.list.result.safeParse({
        success: true,
        artifacts: [{ ...artifactRow, source: 'model' }],
      }).success,
    ).toBe(false);
    expect(artifactsContract.list.result.safeParse({ success: 'yes', artifacts: [] }).success).toBe(
      false,
    );
  });
});
