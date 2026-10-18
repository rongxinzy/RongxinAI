import { describe, expect, test } from 'vitest';

import { codingAgentContract } from './codingAgentContract';
import { CodingGitFileStatus, CodingPermissionOutcome } from '../codingAgent/constants';
import { CoworkQueueDelivery } from '../cowork/pendingMessageQueue';

/**
 * Schema fidelity tests: fixtures below are copied from real renderer call
 * sites (useCodingWorkbenchActions, codingQueue, CodingGitPanel,
 * useLedgerArtifacts) so a schema drift that would reject a valid production
 * invoke fails here, and representative bad inputs are proven rejected.
 */

describe('codingAgent contract args', () => {
  test('startSession accepts the useCodingWorkbenchActions payload', () => {
    // src/renderer/components/coding/useCodingWorkbenchActions.ts sendPrompt
    expect(
      codingAgentContract.startSession.args.safeParse([
        {
          workspaceId: 'ws-1',
          sourceRoot: '/repo',
          profileId: 'claude',
          modelOverride: 'glm-4.6',
          prompt: 'fix the failing test',
          attachments: [{ name: 'log.txt', path: '/repo/log.txt' }],
          configOptionOverrides: { theme: 'dark' },
        },
      ]).success,
    ).toBe(true);
    // Optional fields omitted (draft without model/attachments/overrides).
    expect(
      codingAgentContract.startSession.args.safeParse([
        { workspaceId: 'ws-1', sourceRoot: '/repo', profileId: 'claude', prompt: 'hi' },
      ]).success,
    ).toBe(true);
  });

  test('prompt accepts the active-lane payload with optional delivery', () => {
    expect(
      codingAgentContract.prompt.args.safeParse([
        {
          workspaceRoot: '/repo',
          prompt: {
            laneId: 'lane-1',
            prompt: 'continue',
            delivery: CoworkQueueDelivery.Steer,
            attachments: [{ name: 'a.png', path: '/repo/a.png' }],
          },
        },
      ]).success,
    ).toBe(true);
    expect(
      codingAgentContract.prompt.args.safeParse([
        { workspaceRoot: '/repo', prompt: { laneId: 'lane-1', prompt: 'continue' } },
      ]).success,
    ).toBe(true);
    // Unknown delivery kinds are rejected (queue only knows steer/follow-up).
    expect(
      codingAgentContract.prompt.args.safeParse([
        { workspaceRoot: '/repo', prompt: { laneId: 'lane-1', prompt: 'p', delivery: 'later' } },
      ]).success,
    ).toBe(false);
  });

  test('respondPermission accepts exactly the permission outcome union', () => {
    for (const outcome of [CodingPermissionOutcome.Selected, CodingPermissionOutcome.Cancelled]) {
      expect(
        codingAgentContract.respondPermission.args.safeParse([
          { workspaceRoot: '/repo', response: { requestId: 'req-1', outcome } },
        ]).success,
      ).toBe(true);
    }
    expect(
      codingAgentContract.respondPermission.args.safeParse([
        { workspaceRoot: '/repo', response: { requestId: 'req-1', outcome: 'defer' } },
      ]).success,
    ).toBe(false);
  });

  test('pending-message helpers accept the codingQueue payload shapes', () => {
    // codingQueue.update / remove / steer / followUp
    expect(
      codingAgentContract.updatePendingMessage.args.safeParse([
        { laneId: 'lane-1', itemId: 'item-1', text: 'edited' },
      ]).success,
    ).toBe(true);
    expect(
      codingAgentContract.deletePendingMessage.args.safeParse([
        { laneId: 'lane-1', itemId: 'item-1' },
      ]).success,
    ).toBe(true);
    expect(
      codingAgentContract.steerPendingMessage.args.safeParse([
        { workspaceRoot: '/repo', laneId: 'lane-1', itemId: 'item-1' },
      ]).success,
    ).toBe(true);
    expect(
      codingAgentContract.followUpPendingMessage.args.safeParse([
        { workspaceRoot: '/repo', laneId: 'lane-1', itemId: 'item-1' },
      ]).success,
    ).toBe(true);
    // steer without a workspace root is rejected.
    expect(
      codingAgentContract.steerPendingMessage.args.safeParse([
        { laneId: 'lane-1', itemId: 'item-1' },
      ]).success,
    ).toBe(false);
  });

  test('saveLaneView accepts the draft-view payload', () => {
    // useCodingWorkbenchActions after a successful prompt
    expect(
      codingAgentContract.saveLaneView.args.safeParse([
        { workspaceRoot: '/repo', view: { laneId: 'lane-1', draft: '', scrollPosition: 42 } },
      ]).success,
    ).toBe(true);
    expect(
      codingAgentContract.saveLaneView.args.safeParse([
        { workspaceRoot: '/repo', view: { laneId: 'lane-1', draft: 'txt', scrollPosition: 'top' } },
      ]).success,
    ).toBe(false);
  });

  test('git targets accept lane/source scoped variants', () => {
    // getGitStatus with laneId (CodingGitPanel lane mode)
    expect(
      codingAgentContract.getGitStatus.args.safeParse([
        { workspaceRoot: '/repo', laneId: 'lane-1' },
      ]).success,
    ).toBe(true);
    // sourceRoot-only variant (workspace file browser)
    expect(
      codingAgentContract.getGitStatus.args.safeParse([
        { workspaceRoot: '/repo', sourceRoot: '/repo/sub' },
      ]).success,
    ).toBe(true);
    // commit carries message + paths
    expect(
      codingAgentContract.commitGitChanges.args.safeParse([
        { workspaceRoot: '/repo', message: 'fix: lint', paths: ['src/a.ts'] },
      ]).success,
    ).toBe(true);
    expect(
      codingAgentContract.commitGitChanges.args.safeParse([
        { workspaceRoot: '/repo', message: 'fix: lint', paths: 'src/a.ts' },
      ]).success,
    ).toBe(false);
  });
});

describe('codingAgent contract results', () => {
  /** Real `CodingGitStatus` projection shape (CodingGitPanel consumer). */
  const gitStatus = {
    isRepository: true,
    targetRoot: '/repo',
    repositoryRoot: '/repo',
    githubRepositoryUrl: null,
    hasOrigin: true,
    hasRemoteBranch: true,
    defaultBranch: 'main',
    branch: 'feat/x',
    localBranches: ['main', 'feat/x'],
    head: 'abc123',
    detached: false,
    upstream: 'origin/feat/x',
    ahead: 1,
    behind: 0,
    additions: 12,
    deletions: 3,
    files: [
      {
        path: 'src/a.ts',
        indexStatus: CodingGitFileStatus.Modified,
        worktreeStatus: null,
        additions: 10,
        deletions: 2,
      },
      {
        path: 'src/renamed.ts',
        originalPath: 'src/old.ts',
        indexStatus: CodingGitFileStatus.Renamed,
        worktreeStatus: CodingGitFileStatus.Untracked,
        additions: null,
        deletions: null,
      },
    ],
    isIsolated: false,
    isBusy: false,
    canMutate: true,
  };

  test('git status result accepts a real status projection', () => {
    expect(
      codingAgentContract.getGitStatus.result.safeParse({ success: true, status: gitStatus })
        .success,
    ).toBe(true);
    expect(
      codingAgentContract.getGitStatus.result.safeParse({
        success: false,
        error: 'not a repository',
      }).success,
    ).toBe(true);
  });

  test('git status rejects an unknown file status', () => {
    expect(
      codingAgentContract.getGitStatus.result.safeParse({
        success: true,
        status: {
          ...gitStatus,
          files: [{ ...gitStatus.files[0], indexStatus: 'kinda-changed' }],
        },
      }).success,
    ).toBe(false);
  });

  test('action envelope accepts snapshot-bearing and failure results', () => {
    // Snapshots stay opaque (z.unknown) — only the envelope is pinned.
    expect(
      codingAgentContract.startSession.result.safeParse({
        success: true,
        snapshot: { room: { activeLaneId: 'lane-1' } },
      }).success,
    ).toBe(true);
    expect(
      codingAgentContract.startSession.result.safeParse({
        success: false,
        error: 'workspace missing',
        conflict: true,
      }).success,
    ).toBe(true);
    expect(codingAgentContract.startSession.result.safeParse({ success: 'yes' }).success).toBe(
      false,
    );
  });

  test('pending-message list result accepts queued items', () => {
    // codingQueue.load reads items with CoworkPendingMessage shape
    expect(
      codingAgentContract.listPendingMessages.result.safeParse({
        success: true,
        items: [
          {
            id: 'item-1',
            text: 'follow-up question',
            delivery: CoworkQueueDelivery.FollowUp,
            createdAt: 1770000000000,
            status: 'queued',
            skillIds: ['web-search'],
          },
        ],
      }).success,
    ).toBe(true);
  });

  test('list profiles result accepts a builtin profile row', () => {
    const profile = {
      id: 'claude',
      name: 'Claude Code',
      description: 'Anthropic coding agent',
      driverKind: 'external',
      status: 'available',
      capabilities: {
        supportsLoadSession: true,
        supportsResumeSession: true,
        supportsPlans: true,
        supportsPermissions: true,
        supportsFilesystem: true,
        supportsTerminal: true,
        supportsConfigOptions: true,
        supportsUsage: true,
        supportsElicitation: true,
      },
      authMethods: [
        {
          id: 'api-key',
          name: 'API key',
          type: 'env',
          args: ['--key'],
          environment: { KEY: 'x' },
        },
      ],
      command: null,
      args: [],
      environment: {},
      isBuiltin: true,
    };
    expect(
      codingAgentContract.listProfiles.result.safeParse({ success: true, profiles: [profile] })
        .success,
    ).toBe(true);
    expect(
      codingAgentContract.listProfiles.result.safeParse({
        success: true,
        profiles: [{ ...profile, capabilities: null }],
      }).success,
    ).toBe(false);
  });
});
