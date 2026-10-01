// @vitest-environment jsdom
import {
  CoworkMessageType,
  CoworkDisplayItemType,
  CoworkPermissionOrigin,
  CoworkPermissionBehavior,
} from '../../../../shared/cowork/constants';
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { i18nService } from '../../../services/i18n';
import type { ToolGroupItem } from '../helpers/messageGrouping';
import { setPersistentToggleNamespace } from '../hooks/usePersistentToggle';
import { ToolCard } from './ToolCard';

vi.mock('@shared/components/ai-elements/code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => createElement('pre', null, code),
}));
i18nService.setLanguage('zh', { persist: false });
const group = (id: string, output = 'ok', isError = false): ToolGroupItem => ({
  type: CoworkDisplayItemType.ToolGroup,
  toolUse: {
    id,
    type: CoworkMessageType.ToolUse,
    content: '',
    timestamp: 1,
    metadata: { toolName: 'bash', toolInput: { command: 'pwd' } },
  },
  toolResult: {
    id: `${id}-result`,
    type: CoworkMessageType.ToolResult,
    content: output,
    timestamp: 2,
    metadata: { isError },
  },
});

test('caps long output until explicitly expanded and preserves the full result for export', () => {
  setPersistentToggleNamespace('long-output');
  const fixture = group(
    'long',
    Array.from({ length: 250 }, (_, index) => `line ${index + 1}`).join('\n'),
  );
  const { rerender } = render(createElement(ToolCard, { group: fixture }));
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText(/line 1 line 2/).textContent).toContain('line 200');
  expect(screen.getByText(/line 1 line 2/).textContent).not.toContain('line 201');
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkToolResultShowAll') }));
  expect(screen.getByText(/line 1 line 2/).textContent).toContain('line 250');
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkToolResultCollapse') }));
  rerender(createElement(ToolCard, { group: fixture, forceExpand: true }));
  expect(screen.getByText(/line 1 line 2/).textContent).toContain('line 250');
});

test('retains expansion across virtualization remounts and result arrival', () => {
  setPersistentToggleNamespace('persist-expansion');
  const fixture = group('persistent');
  const { unmount, rerender } = render(
    createElement(ToolCard, { group: { ...fixture, toolResult: undefined } }),
  );
  fireEvent.click(screen.getByRole('button'));
  rerender(createElement(ToolCard, { group: fixture }));
  expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  unmount();
  render(createElement(ToolCard, { group: fixture }));
  expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('ok')).toBeVisible();
});

test('redacts parameter and result display without changing the source data', () => {
  setPersistentToggleNamespace('display-redaction');
  const fixture = group('redacted', 'secret result');
  fixture.toolUse.metadata!.toolInput = { command: 'secret command' };
  render(
    createElement(ToolCard, {
      group: fixture,
      mapDisplayText: value => value.replaceAll('secret', 'hidden'),
    }),
  );
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('hidden command')).toBeVisible();
  expect(screen.getByText(/"command": "hidden command"/)).toBeVisible();
  expect(screen.getByText('hidden result')).toBeVisible();
  expect(fixture.toolUse.metadata!.toolInput).toEqual({ command: 'secret command' });
});

test('shows an error once and keeps detailed output available', () => {
  setPersistentToggleNamespace('tool-error');
  render(createElement(ToolCard, { group: group('error', 'permission refused', true) }));
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getAllByText('permission refused')).toHaveLength(1);
});

test('exports a previously folded tool with the full output', () => {
  setPersistentToggleNamespace('closed-export');
  const fixture = group(
    'closed-export',
    Array.from({ length: 250 }, (_, index) => `export ${index + 1}`).join('\n'),
  );
  render(createElement(ToolCard, { group: fixture, forceExpand: true }));
  expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/export 1 export 2/).textContent).toContain('export 250');
});

test('keeps the path visible while a read result remains folded', () => {
  setPersistentToggleNamespace('folded-path');
  const fixture = group('folded-path', 'file content');
  fixture.toolUse.metadata = { toolName: 'read', toolInput: { path: '/workspace/src/main.ts' } };
  render(createElement(ToolCard, { group: fixture }));
  expect(screen.getByText('/workspace/src/main.ts')).toBeVisible();
  expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('file content')).toBeNull();
});

test('opens approval details and sends the original input when allowed', () => {
  setPersistentToggleNamespace('approval');
  const fixture = group('approval');
  const input = { command: 'secret command' };
  fixture.toolUse.metadata!.toolInput = input;
  const onRespond = vi.fn();
  render(
    createElement(ToolCard, {
      group: { ...fixture, toolResult: undefined },
      mapDisplayText: value => value.replaceAll('secret', 'hidden'),
      pendingPermission: {
        origin: CoworkPermissionOrigin.PiWorkbench,
        sessionId: 'approval-session',
        requestId: 'approval-request',
        toolName: 'bash',
        toolInput: input,
      },
      onRespondToPermission: onRespond,
    }),
  );
  const header = screen.getByRole('button', { name: /Bash/ });
  expect(header).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(header);
  expect(header).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkDeny') }));
  expect(onRespond).toHaveBeenLastCalledWith({
    behavior: CoworkPermissionBehavior.Deny,
    message: 'Permission denied',
  });
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkApprove') }));
  expect(onRespond).toHaveBeenLastCalledWith({
    behavior: CoworkPermissionBehavior.Allow,
    updatedInput: input,
  });
});
