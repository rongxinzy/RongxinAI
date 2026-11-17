// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, test, vi } from 'vitest';

import {
  CoworkPermissionBehavior,
  CoworkPermissionOrigin,
} from '../../../../shared/cowork/constants';
import { i18nService } from '../../../services/i18n';
import type { CoworkPermissionRequest } from '../../../types/cowork';
import { setPersistentToggleNamespace } from '../../cowork/hooks/usePersistentToggle';
import type { ReasoningTurnPart, ToolGroupTurnPart, ToolTurnPart } from '../model/types';
import { ToolGroupView } from './ToolGroupView';

vi.mock('@shared/components/conversation', async importOriginal => {
  const actual = await importOriginal<typeof import('@shared/components/conversation')>();
  return {
    ...actual,
    DiffPreview: () => createElement('div', null, 'Proposed diff'),
    SourcePills: () => null,
  };
});

i18nService.setLanguage('zh', { persist: false });

const makeReasoning = (id: string, content: string, isStreaming = false): ReasoningTurnPart => ({
  kind: 'reasoning',
  id: `reasoning:${id}`,
  message: { id, type: 'assistant', content, timestamp: 100, metadata: { isThinking: true } },
  isStreaming,
  isComplete: !isStreaming,
});

const makeTool = (id: string, overrides: Partial<ToolTurnPart> = {}): ToolTurnPart => ({
  kind: 'tool',
  id: `tool:${id}`,
  toolCallId: id,
  toolName: 'read',
  category: 'file-read',
  readOnly: true,
  input: { path: 'src/message.tsx' },
  phase: 'output-available',
  output: 'ok',
  isError: false,
  ...overrides,
});

describe('ToolGroupView', () => {
  test('renders collapsed by default with latest step summary and expands on click', () => {
    setPersistentToggleNamespace('group-default-collapsed');
    const group: ToolGroupTurnPart = {
      kind: 'tool_group',
      id: 'group:r1',
      parts: [
        makeReasoning('r1', 'Inspecting components'),
        makeTool('t1', { toolName: 'read', input: { path: 'DESIGN.md' } }),
        makeTool('t2', {
          toolName: 'bash',
          category: 'shell',
          readOnly: false,
          input: { command: 'git status' },
        }),
      ],
      hasError: false,
      hasApproval: false,
    };

    render(createElement(ToolGroupView, { group }));
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveTextContent('Bash');
    expect(trigger).toHaveTextContent('git status');
    expect(trigger).toHaveTextContent('3 步');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('DESIGN.md')).toBeVisible();
  });

  test('prioritizes currently running step in header while settled steps follow', () => {
    setPersistentToggleNamespace('group-active-step');
    const group: ToolGroupTurnPart = {
      kind: 'tool_group',
      id: 'group:active',
      parts: [
        makeTool('t1', { toolName: 'read', input: { path: 'a.ts' }, phase: 'output-available' }),
        makeTool('t2', {
          toolName: 'bash',
          category: 'shell',
          readOnly: false,
          input: { command: 'bun run test' },
          phase: 'running',
        }),
        makeTool('t3', { toolName: 'read', input: { path: 'done.ts' }, phase: 'output-available' }),
      ],
      hasError: false,
      hasApproval: false,
    };

    render(createElement(ToolGroupView, { group }));
    const trigger = screen.getByRole('button');
    expect(trigger).toHaveTextContent(i18nService.t('coworkExecutionCommand'));
    expect(trigger).toHaveTextContent('bun run test');
    expect(trigger).toHaveTextContent(i18nService.t('codingAgentToolRunning'));
  });

  test('forces group open when any tool inside fails', () => {
    setPersistentToggleNamespace('group-error-open');
    const group: ToolGroupTurnPart = {
      kind: 'tool_group',
      id: 'group:err',
      parts: [
        makeReasoning('r1', 'Running checks'),
        makeTool('t1', {
          toolName: 'bash',
          category: 'shell',
          readOnly: false,
          input: { command: 'npm test' },
          phase: 'output-error',
          isError: true,
          output: 'Exit code 1',
        }),
      ],
      hasError: true,
      hasApproval: false,
    };

    render(createElement(ToolGroupView, { group }));
    const groupTrigger = screen.getAllByRole('button')[0];
    expect(groupTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(groupTrigger).toHaveAttribute('data-tool-state', 'output-error');
    expect(groupTrigger).toHaveTextContent(i18nService.t('codingAgentToolFailed'));
    expect(screen.getAllByText('npm test')).toHaveLength(2);
    expect(screen.getByText(i18nService.t('codingAgentReasoningComplete'))).toBeVisible();
  });

  test('forces group open and forwards permission callbacks when approval is requested', () => {
    setPersistentToggleNamespace('group-approval-open');
    (window as unknown as { electron?: { platform: string } }).electron = { platform: 'darwin' };
    const permission: CoworkPermissionRequest = {
      requestId: 'req-1',
      sessionId: 's1',
      toolName: 'bash',
      toolUseId: 't-pending',
      toolInput: { command: 'rm -rf dist' },
      origin: CoworkPermissionOrigin.PiWorkbench,
    };
    const group: ToolGroupTurnPart = {
      kind: 'tool_group',
      id: 'group:approval',
      parts: [
        makeReasoning('r1', 'Preparing cleanup'),
        makeTool('t-pending', {
          toolName: 'bash',
          category: 'shell',
          readOnly: false,
          input: { command: 'rm -rf dist' },
          phase: 'approval-requested',
          pendingPermission: permission,
        }),
      ],
      hasError: false,
      hasApproval: true,
    };
    const onRespondToPermission = vi.fn();

    render(createElement(ToolGroupView, { group, onRespondToPermission }));
    const groupTrigger = screen.getAllByRole('button')[0];
    expect(groupTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(groupTrigger).toHaveAttribute('data-tool-state', 'approval-requested');

    fireEvent.click(screen.getByRole('button', { name: i18nService.t('coworkApprove') }));
    expect(onRespondToPermission).toHaveBeenCalledWith({
      behavior: CoworkPermissionBehavior.Allow,
      updatedInput: permission.toolInput,
    });
  });
});
