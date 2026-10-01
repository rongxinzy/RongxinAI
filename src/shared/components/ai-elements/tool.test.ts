// @vitest-environment jsdom
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { i18nService } from '../../../renderer/services/i18n';
import { ToolState } from './constants';
import { Tool, ToolContent, ToolHeader, ToolOutput } from './tool';

vi.mock('./code-block', () => ({
  CodeBlock: ({ code }: { code: string }) => createElement('pre', null, code),
}));

test('keeps the command readable while details are folded and exposes the controlled toggle', () => {
  i18nService.setLanguage('zh', { persist: false });
  const onOpenChange = vi.fn();
  const header = createElement(ToolHeader, {
    type: 'dynamic-tool',
    toolName: 'bash',
    state: ToolState.OutputAvailable,
    summary: 'pwd',
    statusAtEnd: true,
  });
  render(
    createElement(
      Tool,
      { open: false, onOpenChange },
      header,
      createElement(ToolContent, null, 'sensitive detailed output'),
    ),
  );
  expect(screen.getByText('pwd')).toBeVisible();
  expect(screen.queryByText('sensitive detailed output')).toBeNull();
  fireEvent.click(screen.getByRole('button'));
  expect(onOpenChange.mock.calls[0][0]).toBe(true);
});

test('localizes failed and denied statuses and honors a provider status label', () => {
  i18nService.setLanguage('zh', { persist: false });
  const header = (
    state: typeof ToolState.OutputError | typeof ToolState.OutputDenied,
    statusLabel?: string,
  ) =>
    createElement(
      Tool,
      null,
      createElement(ToolHeader, { type: 'dynamic-tool', toolName: 'test', state, statusLabel }),
    );
  const { rerender } = render(header(ToolState.OutputError));
  expect(screen.getByText(i18nService.t('codingAgentToolFailed'))).toBeVisible();
  rerender(header(ToolState.OutputDenied));
  expect(screen.getByText(i18nService.t('codingAgentPermissionRejected'))).toBeVisible();
  rerender(header(ToolState.OutputError, 'Provider failure'));
  expect(screen.getByText('Provider failure')).toBeVisible();
});

test('preserves multiline output and displays a tool error only once', () => {
  const { rerender } = render(
    createElement(ToolOutput, { output: 'first\nsecond', errorText: undefined }),
  );
  expect(screen.getByText('first second').textContent).toBe('first\nsecond');
  rerender(createElement(ToolOutput, { output: undefined, errorText: 'command refused' }));
  expect(screen.getAllByText('command refused')).toHaveLength(1);
});
