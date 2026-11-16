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
