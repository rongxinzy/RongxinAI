import { expect, test } from 'vitest';

import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  type CodingAgentProfile,
  type CodingWorkspaceSummary,
} from '../../../shared/codingAgent';
import {
  buildCodingSessionDraftSelection,
  resolveDefaultSessionSourceRoot,
  resolveReadyDefaultProfileId,
} from './codingSessionDraft';

const workspace: CodingWorkspaceSummary = {
  id: 'workspace-1',
  name: 'Workspace',
  primaryRoot: '/workspace/main',
  defaultProfileId: 'opencode',
  sources: [
    { id: 'source-1', workspaceId: 'workspace-1', path: '/workspace/primary', isPrimary: true },
    { id: 'source-2', workspaceId: 'workspace-1', path: '/workspace/secondary', isPrimary: false },
  ],
  sessions: [],
  activeSessionId: null,
};

const buildProfile = (id: string, status: CodingAgentProfileStatus): CodingAgentProfile => ({
  id,
  name: id,
  description: '',
  driverKind: CodingAgentDriverKind.Acp,
  status,
  capabilities: {
    supportsLoadSession: false,
    supportsResumeSession: false,
    supportsPlans: false,
    supportsPermissions: false,
    supportsFilesystem: false,
    supportsTerminal: false,
    supportsConfigOptions: false,
    supportsUsage: false,
    supportsElicitation: false,
  },
  authMethods: [],
  command: null,
  args: [],
  environment: {},
  isBuiltin: false,
});

test('uses the first source folder as the default session root', () => {
  expect(resolveDefaultSessionSourceRoot(workspace)).toBe('/workspace/primary');
  expect(resolveDefaultSessionSourceRoot({ ...workspace, sources: [] })).toBe('/workspace/main');
});

test('accepts the default agent only while it is ready', () => {
  expect(
    resolveReadyDefaultProfileId(
      [buildProfile('opencode', CodingAgentProfileStatus.Ready)],
      'opencode',
    ),
  ).toBe('opencode');
  expect(
    resolveReadyDefaultProfileId(
      [buildProfile('opencode', CodingAgentProfileStatus.NeedsAuth)],
      'opencode',
    ),
  ).toBeNull();
  expect(resolveReadyDefaultProfileId([], 'opencode')).toBeNull();
});

test('builds a draft selection for the given agent and source folder', () => {
  const selection = buildCodingSessionDraftSelection(workspace, 'opencode');

  expect(selection.workspaceId).toBe('workspace-1');
  expect(selection.workspaceRoot).toBe('/workspace/main');
  expect(selection.laneId).toBeNull();
  expect(selection.draft).toMatchObject({
    workspaceId: 'workspace-1',
    sourceRoot: '/workspace/primary',
    profileId: 'opencode',
    modelOverride: null,
  });
  expect(selection.draft?.sources).toEqual(workspace.sources);
});

test('honours an explicit source root and generates a unique draft id', () => {
  const first = buildCodingSessionDraftSelection(workspace, 'opencode', '/workspace/secondary');
  const second = buildCodingSessionDraftSelection(workspace, 'opencode', '/workspace/secondary');

  expect(first.draft?.sourceRoot).toBe('/workspace/secondary');
  expect(first.draft?.id).toBeTruthy();
  expect(first.draft?.id).not.toBe(second.draft?.id);
});
