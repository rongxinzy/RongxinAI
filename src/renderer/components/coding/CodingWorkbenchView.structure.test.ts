import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CodingWorkbenchView.tsx', import.meta.url)),
  'utf8',
);

test('renders the controlled manager dialog without duplicating the sidebar icon', () => {
  expect(source).toContain('<CodingAgentManager');
  expect(source).toContain('onOpenChange={onAgentManagerOpenChange}');
  expect(source).not.toContain('<Settings2 />');
});

test('renders the manager before a workspace or snapshot is available', () => {
  const managerElementIndex = source.indexOf('const agentManagerElement');
  expect(managerElementIndex).toBeGreaterThan(-1);
  expect(managerElementIndex).toBeLessThan(source.indexOf('if (!workspaceRoot)'));
  // Empty, loading/error and loaded states all render the dialog.
  expect(source.match(/\{agentManagerElement\}/g) ?? []).toHaveLength(3);
  // Profiles load independently of the room snapshot.
  expect(source).toContain('codingAgent.listProfiles()');
});

test('floats the approval card over the composer slot like work mode', () => {
  const composerIndex = source.indexOf('<CodingComposer');
  const overlayIndex = source.indexOf('<CodingPermissionOverlay');
  expect(composerIndex).toBeGreaterThan(-1);
  expect(overlayIndex).toBeGreaterThan(composerIndex);
  expect(source).toContain('permission={activePermission}');
});
