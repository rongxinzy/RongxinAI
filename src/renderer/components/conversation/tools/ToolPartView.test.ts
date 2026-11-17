// @vitest-environment jsdom
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import type { ToolTurnPart } from '../model/types';
import { ToolPartView } from './ToolPartView';

vi.mock('@shared/components/conversation', () => ({
  DiffPreview: () => createElement('div', null, 'Proposed diff'),
  SourcePills: () => null,
}));

test.each(['edit', 'write'])(
  '%s keeps the failure detail visible alongside the proposed diff',
  toolName => {
    const part: ToolTurnPart = {
      kind: 'tool',
      id: `tool-${toolName}`,
      toolCallId: 'call-1',
      toolName,
      category: 'file-write',
      readOnly: false,
      phase: 'output-error',
      isError: true,
      input: { path: 'report.txt', oldText: 'before', newText: 'after', content: 'after' },
      output: 'EACCES: permission denied',
    };
    render(createElement(ToolPartView, { part, forceExpand: true }));
    expect(screen.getByText('Proposed diff')).toBeVisible();
    expect(screen.getByText('EACCES: permission denied')).toBeVisible();
  },
);

test('shell failures and empty error payloads stay visible cleanly', () => {
  const shellFail: ToolTurnPart = {
    kind: 'tool',
    id: 'tool-bash-fail',
    toolCallId: 'call-bash-fail',
    toolName: 'bash',
    category: 'shell',
    readOnly: false,
    phase: 'output-error',
    isError: true,
    input: { command: 'npm test' },
    output: 'Command failed with exit code 1',
  };
  const emptyFail: ToolTurnPart = {
    kind: 'tool',
    id: 'tool-empty-fail',
    toolCallId: 'call-empty-fail',
    toolName: 'bash',
    category: 'shell',
    readOnly: false,
    phase: 'output-error',
    isError: true,
    input: { command: 'false' },
    output: '',
  };

  const view = render(createElement(ToolPartView, { part: shellFail, forceExpand: true }));
  expect(view.container.textContent).toContain('Command failed with exit code 1');

  view.rerender(createElement(ToolPartView, { part: emptyFail, forceExpand: true }));
  expect(
    view.container.querySelectorAll('[role="alert"], [data-slot="tool-output"]').length,
  ).toBeGreaterThanOrEqual(0);
  expect(view.container.textContent).toMatch(/error|失败|No error details/i);
});

test('renders python_execute code as a Python code block instead of raw escaped JSON', () => {
  const pythonFail: ToolTurnPart = {
    kind: 'tool',
    id: 'tool-python-fail',
    toolCallId: 'call-python-fail',
    toolName: 'python_execute',
    category: 'python',
    readOnly: false,
    phase: 'output-error',
    isError: true,
    input: { code: 'import math\nprint(math.pi)', timeoutMs: 60000 },
    output: 'ENOENT: job-runner.exe missing',
  };

  const view = render(createElement(ToolPartView, { part: pythonFail, forceExpand: true }));
  expect(view.container.textContent).toContain('import math');
  expect(view.container.textContent).toContain('print(math.pi)');
  expect(view.container.textContent).not.toContain('"timeoutMs"');
  expect(view.container.textContent).toContain('ENOENT: job-runner.exe missing');
});
