import { describe, expect, test } from 'vitest';

import {
  coworkConfigContract,
  coworkContract,
  coworkExportContract,
  coworkPiStreamContract,
  coworkQueueContract,
  coworkRunSnapshotContract,
  coworkSessionAdminContract,
  coworkSessionLifecycleContract,
  workspaceContract,
} from './coworkContract';
import { todoContract } from './todoContract';
import { workbenchTaskContract } from './workbenchTaskContract';

/**
 * Cowork-domain schema fidelity tests. Fixtures are copied from real renderer
 * call sites so a schema drift that would reject a valid production invoke
 * fails here, and representative bad inputs are proven rejected.
 */

// --- Channel uniqueness ------------------------------------------------------

const subContracts = [
  coworkRunSnapshotContract,
  coworkPiStreamContract,
  workspaceContract,
  coworkSessionLifecycleContract,
  coworkSessionAdminContract,
  coworkExportContract,
  coworkQueueContract,
  coworkConfigContract,
] as const;

describe('cowork contract registration uniqueness', () => {
  test('each channel appears in exactly one sub-contract method', () => {
    // ipcMain.handle throws "Attempted to register a second handler" at app
    // load if two contract methods ever map to one channel.
    const channelToMethods = new Map<string, string[]>();
    for (const contract of subContracts) {
      for (const [method, definition] of Object.entries(contract)) {
        const owners = channelToMethods.get(definition.channel) ?? [];
        owners.push(method);
        channelToMethods.set(definition.channel, owners);
      }
    }
    expect([...channelToMethods.entries()].filter(([, owners]) => owners.length > 1)).toEqual([]);
  });

  test('union contract covers exactly the sub-contract methods', () => {
    expect(Object.keys(coworkContract).sort()).toEqual(
      [...new Set(subContracts.flatMap(contract => Object.keys(contract)))].sort(),
    );
  });

  test('todo and workbench channels are disjoint from cowork', () => {
    const coworkChannels = new Set(Object.values(coworkContract).map(method => method.channel));
    for (const [name, contract] of [
      ['todo', todoContract],
      ['workbenchTask', workbenchTaskContract],
    ] as const) {
      for (const [method, definition] of Object.entries(contract)) {
        expect(coworkChannels.has(definition.channel), `${name}.${method}`).toBe(false);
      }
    }
  });
});

// --- Session lifecycle (start/continue) ---------------------------------------

/** Image attachment as built by useCoworkPromptSubmission with a real disk path. */
const base64Image = {
  name: 'screenshot.png',
  mimeType: 'image/png',
  base64Data: 'iVBORw0KGgo=',
  path: '/home/user/projects/calculator/screenshot.png',
};

/** Clipboard image: dataUrl extracted, no real path (inline: pseudo-paths dropped). */
const clipboardImage = {
  name: 'pasted.png',
  mimeType: 'image/png',
  base64Data: 'iVBORw0KGgo=',
};

const fileAttachment = {
  name: 'spec.md',
  path: '/home/user/projects/calculator/spec.md',
  extension: 'MD',
};

test('startSession accepts the CoworkView payload shape', () => {
  // src/renderer/components/cowork/CoworkView.tsx handleStartSession
  expect(
    coworkSessionLifecycleContract.startSession.args.safeParse([
      {
        prompt: 'Build a calculator',
        title: 'Calculator',
        cwd: '/home/user/projects/calculator',
        systemPrompt: 'You are a frontend engineer.',
        mode: 'work',
        activeSkillIds: ['docx'],
        workspaceId: 'workspace-1',
        agentId: 'main',
        expertIds: ['expert-1'],
        goalMode: true,
        modelOverride: 'qwen3:32b',
        permissionMode: 'ask',
        imageAttachments: [base64Image, clipboardImage],
        fileAttachments: [fileAttachment],
      },
    ]).success,
  ).toBe(true);
});

test('startSession rejects an image attachment without inline bytes', () => {
  // The composer always sends base64Data; zod strips `path`, so a path-only row
  // would reach persistCoworkImageAttachments empty and be dropped silently.
  expect(
    coworkSessionLifecycleContract.startSession.args.safeParse([
      {
        prompt: 'Analyze this',
        imageAttachments: [{ name: 'chart.png', mimeType: 'image/png', path: '/tmp/chart.png' }],
      },
    ]).success,
  ).toBe(false);
});

test('startSession rejects an image-only submission with no payload', () => {
  // hasCoworkSubmissionContent: neither visible prompt nor a usable image.
  expect(
    coworkSessionLifecycleContract.startSession.args.safeParse([
      { prompt: '   ', imageAttachments: [{ name: 'x.png', mimeType: 'image/png' }] },
    ]).success,
  ).toBe(false);
});

test('continueSession accepts the CoworkView payload shape', () => {
  // src/renderer/components/cowork/CoworkView.tsx handleContinueSession
  expect(
    coworkSessionLifecycleContract.continueSession.args.safeParse([
      {
        sessionId: 'session-1',
        prompt: 'Add keyboard support',
        systemPrompt: 'You are a frontend engineer.',
        activeSkillIds: ['docx'],
        expertIds: [],
        permissionMode: 'allowAll',
        goalMode: false,
        imageAttachments: [clipboardImage],
        fileAttachments: [fileAttachment],
      },
    ]).success,
  ).toBe(true);
});

test('session result envelope accepts a sanitized session row', () => {
  const session = {
    id: 'session-1',
    title: 'Calculator',
    status: 'running',
    mode: 'work',
    pinned: false,
    pinOrder: null,
    cwd: '/home/user/projects/calculator',
    systemPrompt: 'You are a frontend engineer.',
    modelOverride: '',
    executionMode: 'auto',
    activeSkillIds: ['docx'],
    workspaceId: 'workspace-1',
    agentId: 'main',
    source: 'manual',
    experts: [
      {
        expertId: 'expert-1',
        packageId: 'pkg-1',
        expertName: 'Frontend Expert',
        source: 'expert-package',
        promptSnapshot: '...',
        skillIds: ['docx'],
        capabilityPolicy: {},
        contentHash: 'abc123',
        createdAt: 1770000000000,
      },
    ],
    messages: [
      { id: 'msg-1', type: 'user', content: 'Build', timestamp: 1770000000000, sequence: 1 },
    ],
    messagesOffset: 0,
    totalMessages: 1,
    artifacts: [
      {
        id: 'art-1',
        messageId: 'msg-2',
        toolCallId: null,
        runId: null,
        type: 'html',
        title: 'Calculator',
        content: '<html></html>',
        source: 'codeblock',
        role: 'deliverable',
        declared: true,
        createdAt: 1770000000000,
      },
    ],
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
  };
  expect(
    coworkSessionLifecycleContract.startSession.result.safeParse({
      success: true,
      session,
    }).success,
  ).toBe(true);
});

// --- Session admin -------------------------------------------------------------

test('getSession accepts both real arities', () => {
  // coworkService.loadSession sends only the id
  expect(coworkSessionAdminContract.getSession.args.safeParse(['session-1']).success).toBe(true);
  // RunSessionModal passes messageLimit: null for the full history
  expect(
    coworkSessionAdminContract.getSession.args.safeParse(['session-1', { messageLimit: null }])
      .success,
  ).toBe(true);
  expect(
    coworkSessionAdminContract.getSession.args.safeParse(['session-1', { messageLimit: 50 }])
      .success,
  ).toBe(true);
});

test('listSessions accepts the sidebar filters', () => {
  // coworkService.loadSessions / listSessionsForWorkspacePreview
  expect(
    coworkSessionAdminContract.listSessions.args.safeParse([
      { limit: 50, offset: 0, workspaceId: 'workspace-1', mode: 'work' },
    ]).success,
  ).toBe(true);
  expect(
    coworkSessionAdminContract.listSessions.args.safeParse([
      { limit: 20, offset: 40, agentId: 'main', sources: ['scheduled'] },
    ]).success,
  ).toBe(true);
  expect(coworkSessionAdminContract.listSessions.args.safeParse([]).success).toBe(true);
  expect(coworkSessionAdminContract.listSessions.args.safeParse([{ mode: 'pair' }]).success).toBe(
    false,
  );
});

test('saveSession accepts the imported transcript row', () => {
  // coworkService.saveChatSession forwards the whole renderer CoworkSession;
  // main stores extra row fields verbatim (passthrough).
  expect(
    coworkSessionAdminContract.saveSession.args.safeParse([
      {
        id: 'import-1',
        title: 'Imported chat',
        status: 'completed',
        mode: 'chat',
        cwd: '/home/user',
        systemPrompt: '',
        modelOverride: '',
        executionMode: 'auto',
        activeSkillIds: [],
        agentId: 'main',
        workspaceId: 'workspace-1',
        messages: [{ id: 'm1', type: 'user', content: 'hi', timestamp: 1770000000000 }],
        extraField: 'kept',
      },
    ]).success,
  ).toBe(true);
});

test('compactSession result accepts every CoworkCompactFailure shape', () => {
  const result = coworkSessionAdminContract.compactSession.result;
  expect(result.safeParse({ success: true, queued: true }).success).toBe(true);
  expect(result.safeParse({ success: true, queued: false, cancelled: true }).success).toBe(true);
  expect(result.safeParse({ success: false, reason: 'noSession' }).success).toBe(true);
  expect(result.safeParse({ success: false, reason: 'busy' }).success).toBe(true);
  expect(result.safeParse({ success: false, reason: 'made_up' }).success).toBe(false);
});

// --- Queue ----------------------------------------------------------------------

test('enqueuePendingMessage accepts the submit-pipeline payload', () => {
  // coworkQueueService.enqueue always sends base64-carrying images
  expect(
    coworkQueueContract.enqueuePendingMessage.args.safeParse([
      {
        sessionId: 'session-1',
        text: 'Also add tests',
        imageAttachments: [clipboardImage],
        fileAttachments: [fileAttachment],
        skillIds: ['docx'],
      },
    ]).success,
  ).toBe(true);
});

test('enqueuePendingMessage rejects whitespace-only text', () => {
  expect(
    coworkQueueContract.enqueuePendingMessage.args.safeParse([
      { sessionId: 'session-1', text: '   ' },
    ]).success,
  ).toBe(false);
});

test('queue result items accept both stored and inline image forms', () => {
  // slimQueuedMessagesForIpc: persisted rows keep path, inline rows keep
  // base64Data with an empty path.
  const item = {
    id: 'q-1',
    text: 'Also add tests',
    delivery: 'followUp',
    createdAt: 1770000000000,
    status: 'pending',
    imageAttachments: [
      { name: 'a.png', mimeType: 'image/png', path: '/userData/cowork-images/s1/a.png' },
      { name: 'b.png', mimeType: 'image/png', path: '', base64Data: 'iVBORw0KGgo=' },
    ],
    fileAttachments: [fileAttachment],
    skillIds: ['docx'],
  };
  expect(
    coworkQueueContract.listPendingMessages.result.safeParse({
      success: true,
      items: [item],
    }).success,
  ).toBe(true);
  expect(
    coworkQueueContract.steerPendingMessage.args.safeParse([{ sessionId: 's', itemId: '' }])
      .success,
  ).toBe(false);
});

// --- Config ---------------------------------------------------------------------

test('setConfig accepts every field the renderer sends', () => {
  // coworkService.updateConfig / CoworkView chat-skill auto-allow
  expect(
    coworkConfigContract.setConfig.args.safeParse([
      {
        workingDirectory: '/home/user/projects',
        executionMode: 'auto',
        permissionMode: 'allowAll',
        permissionModeBySession: { 'session-1': 'allowAll' },
        embeddingEnabled: true,
        embeddingProvider: 'openai',
        embeddingModel: 'text-embedding-3-small',
        embeddingLocalModelPath: '',
        embeddingVectorWeight: 0.5,
        embeddingRemoteBaseUrl: 'https://api.example.com/v1',
        embeddingRemoteApiKey: 'sk-...',
        codemodeEnabled: true,
        mcpNativeBridge: false,
      },
    ]).success,
  ).toBe(true);
  // deleteSession cleanup sends only the per-session map
  expect(
    coworkConfigContract.setConfig.args.safeParse([{ permissionModeBySession: {} }]).success,
  ).toBe(true);
  expect(coworkConfigContract.setConfig.args.safeParse([{ permissionMode: 'yolo' }]).success).toBe(
    false,
  );
});

test('getConfig result requires the full config row main always returns', () => {
  const config = {
    workingDirectory: '/home/user',
    systemPrompt: '',
    executionMode: 'local',
    permissionMode: 'ask',
    permissionModeBySession: { 'session-1': 'ask' },
    embeddingEnabled: false,
    embeddingProvider: 'local',
    embeddingModel: 'bge-m3',
    embeddingLocalModelPath: '',
    embeddingVectorWeight: 0.5,
    embeddingRemoteBaseUrl: '',
    embeddingRemoteApiKey: '',
    codemodeEnabled: false,
    mcpNativeBridge: false,
  };
  expect(coworkConfigContract.getConfig.result.safeParse({ success: true, config }).success).toBe(
    true,
  );
  expect(
    coworkConfigContract.getConfig.result.safeParse({
      success: true,
      config: { ...config, permissionModeBySession: undefined },
    }).success,
  ).toBe(false);
});

// --- Export / permission ---------------------------------------------------------

test('export methods accept the capture payloads', () => {
  const rect = { x: 0, y: 0, width: 800, height: 600 };
  expect(
    coworkExportContract.exportResultImage.args.safeParse([{ rect, defaultFileName: 'result.png' }])
      .success,
  ).toBe(true);
  expect(coworkExportContract.captureImageChunk.args.safeParse([{ rect }]).success).toBe(true);
  expect(
    coworkExportContract.saveResultImage.args.safeParse([{ pngBase64: 'iVBORw0KGgo=' }]).success,
  ).toBe(true);
  expect(
    coworkExportContract.exportSessionText.args.safeParse([
      { content: '# Export', defaultFileName: 'session', fileExtension: 'md' },
    ]).success,
  ).toBe(true);
});

test('respondToPermission accepts both real decision shapes', () => {
  // CoworkPermissionModal approve/deny + AskUserQuestionCard builders
  expect(
    coworkExportContract.respondToPermission.args.safeParse([
      { requestId: 'req-1', result: { behavior: 'allow', updatedInput: { command: 'ls' } } },
    ]).success,
  ).toBe(true);
  expect(
    coworkExportContract.respondToPermission.args.safeParse([
      { requestId: 'req-1', result: { behavior: 'deny', message: 'Permission denied' } },
    ]).success,
  ).toBe(true);
  expect(
    coworkExportContract.respondToPermission.args.safeParse([
      { requestId: 'req-1', result: { behavior: 'maybe' } },
    ]).success,
  ).toBe(false);
});

// --- Run snapshot / stream ---------------------------------------------------------

test('getRunSnapshot result accepts a full tracker snapshot', () => {
  // PiRunStateTracker.snapshot() always emits phase/confirmedAt/lastProgressAt.
  expect(
    coworkRunSnapshotContract.getRunSnapshot.result.safeParse({
      success: true,
      snapshot: {
        sessionId: 'session-1',
        runId: 'run-1',
        sequence: 3,
        phase: 'tool',
        running: true,
        startedAt: 1770000000000,
        confirmedAt: 1770000000500,
        lastProgressAt: 1770000000400,
        toolName: 'Bash',
        preview: 'Bash npm test',
      },
      running: true,
    }).success,
  ).toBe(true);
  // Oversized-id short-circuit: only `success` is set.
  expect(
    coworkRunSnapshotContract.getRunSnapshot.result.safeParse({ success: false }).success,
  ).toBe(true);
});

test('stream contract accepts the recovery invocations', () => {
  expect(coworkPiStreamContract.getRuntimeSnapshots.args.safeParse(['session-1']).success).toBe(
    true,
  );
  expect(coworkPiStreamContract.getRuntimeSnapshots.args.safeParse([]).success).toBe(true);
  expect(coworkPiStreamContract.requestStreamResync.args.safeParse(['session-1']).success).toBe(
    true,
  );
});

// --- Workspaces ---------------------------------------------------------------------

test('workspace methods accept the manager payloads', () => {
  // workspaceService create/update flows
  expect(
    workspaceContract.createWorkspace.args.safeParse([
      { path: '/home/user/projects/new', name: 'New Project' },
    ]).success,
  ).toBe(true);
  expect(
    workspaceContract.ensureWorkspace.args.safeParse([{ path: '/home/user/projects/new' }]).success,
  ).toBe(true);
  expect(workspaceContract.renameWorkspace.args.safeParse(['workspace-1', 'Renamed']).success).toBe(
    true,
  );
  expect(
    workspaceContract.updateWorkspace.args.safeParse([
      {
        id: 'workspace-1',
        name: 'Renamed',
        primaryPath: '/home/user/projects/renamed',
        folders: ['/home/user/projects/renamed/sub'],
      },
    ]).success,
  ).toBe(true);
  expect(workspaceContract.deleteWorkspace.args.safeParse(['workspace-1']).success).toBe(true);
});

// --- Workbench task -------------------------------------------------------------------

/** Resume payload from CoworkView taskResume.resume (attachments filtered to base64). */
test('workbench resume accepts the interruption resume payload', () => {
  expect(
    workbenchTaskContract.resume.args.safeParse([
      {
        taskId: 'task-1',
        amendment: 'Also handle edge cases',
        skillIds: ['docx'],
        expertIds: ['expert-1'],
        goalMode: true,
        imageAttachments: [{ name: 'err.png', mimeType: 'image/png', base64Data: 'iVBORw0KGgo=' }],
        fileAttachments: [{ name: 'log.txt', path: '/tmp/log.txt', extension: 'TXT' }],
      },
    ]).success,
  ).toBe(true);
  expect(workbenchTaskContract.resume.args.safeParse([{ amendment: 'no task' }]).success).toBe(
    false,
  );
});

test('workbench respondToApproval accepts the decision payload', () => {
  expect(
    workbenchTaskContract.respondToApproval.args.safeParse([
      { approvalId: 'appr-1', approved: true },
    ]).success,
  ).toBe(true);
  expect(
    workbenchTaskContract.respondToApproval.args.safeParse([
      { approvalId: 'appr-1', approved: false, reason: 'Wrong file' },
    ]).success,
  ).toBe(true);
  expect(
    workbenchTaskContract.respondToApproval.args.safeParse([{ approvalId: '', approved: true }])
      .success,
  ).toBe(false);
});

// --- Todo -------------------------------------------------------------------------------

test('todo list accepts the view filters the renderer sends', () => {
  expect(
    todoContract.list.args.safeParse([{ view: 'my_day', referenceDate: '2026-10-18' }]).success,
  ).toBe(true);
  expect(
    todoContract.list.args.safeParse([{ view: 'all', listId: 'list-1', query: 'report' }]).success,
  ).toBe(true);
  expect(todoContract.list.args.safeParse([{ view: 'someday' }]).success).toBe(false);
});

test('todo create and update pin the partial-update semantics', () => {
  expect(
    todoContract.create.args.safeParse([
      {
        title: 'Ship the contract migration',
        note: 'verify preload tests',
        important: true,
        dueAt: 1770000000000,
        remindAt: null,
        listId: 'list-1',
        myDayDate: '2026-10-18',
      },
    ]).success,
  ).toBe(true);
  // Partial update: only the keys present are applied, unknown keys reject.
  expect(todoContract.update.args.safeParse([{ todoId: 'todo-1', completed: true }]).success).toBe(
    false,
  );
  expect(
    todoContract.update.args.safeParse([{ todoId: 'todo-1', status: 'completed' }]).success,
  ).toBe(true);
  expect(todoContract.update.args.safeParse([{ todoId: 'todo-1', title: '   ' }]).success).toBe(
    false,
  );
});

test('todo step update keeps the order guard', () => {
  expect(
    todoContract.updateStep.args.safeParse([{ id: 'step-1', completed: true, order: 2 }]).success,
  ).toBe(true);
  expect(todoContract.updateStep.args.safeParse([{ id: 'step-1', order: -1 }]).success).toBe(false);
  expect(todoContract.updateStep.args.safeParse([{ id: 'step-1', order: 1.5 }]).success).toBe(
    false,
  );
});
