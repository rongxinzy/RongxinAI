// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  type CodingAgentProfile,
  type CodingWorkspaceSummary,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import { CodingSessionSetupDialog } from './CodingSessionSetupDialog';

const workspace: CodingWorkspaceSummary = {
  id: 'workspace-1',
  name: 'Workspace',
  primaryRoot: '/workspace',
  defaultProfileId: 'opencode',
  sources: [{ id: 'source-1', workspaceId: 'workspace-1', path: '/workspace', isPrimary: true }],
  sessions: [],
  activeSessionId: null,
};

const profiles: CodingAgentProfile[] = [
  {
    id: 'opencode',
    name: 'OpenCode',
    description: 'External coding agent',
    driverKind: CodingAgentDriverKind.Acp,
    status: CodingAgentProfileStatus.Ready,
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
    command: '/usr/local/bin/opencode',
    args: ['acp'],
    environment: {},
    isBuiltin: false,
  },
];

test('preselects the workspace default when that Agent is ready', () => {
  i18nService.setLanguage('zh', { persist: false });
  render(
    <CodingSessionSetupDialog
      workspace={workspace}
      profiles={profiles}
      onCancel={() => {}}
      onManageAgents={() => {}}
      onSubmit={() => {}}
    />,
  );

  expect(screen.getByText('OpenCode')).toBeTruthy();
  expect(screen.getByRole('button', { name: '确认' })).toBeEnabled();
});
