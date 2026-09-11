import { expect, test } from 'vitest';

import {
  CodingEventKind,
  CodingPermissionOutcome,
  type CodingEvent,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import {
  CodingPermissionOptionKind,
  CodingPermissionResolution,
  codingPermissionOptionLabel,
  getCodingPermissionResolution,
  findPendingCodingPermission,
  formatCodingPermissionInput,
  parseCodingPermission,
  resolveCodingPermissionActions,
  type CodingPermissionOption,
} from './codingPermission';

const makeEvent = (payload: Record<string, unknown>): CodingEvent => ({
  id: 'event-1',
  laneId: 'lane-1',
  sequence: 1,
  kind: CodingEventKind.Permission,
  payload,
  createdAt: 1,
});

test('parses builtin permission details nested under request', () => {
  expect(
    parseCodingPermission(
      makeEvent({
        request: {
          toolName: 'Bash',
          toolInput: { command: 'npm test' },
        },
      }),
    ),
  ).toEqual({
    toolName: 'Bash',
    toolKind: null,
    toolInput: { command: 'npm test' },
    options: [],
  });
});

test('parses ACP options and ignores malformed entries', () => {
  expect(
    parseCodingPermission(
      makeEvent({
        toolCall: { title: 'Edit file', input: { path: 'src/App.tsx' } },
        options: [
          {
            optionId: 'allow-once',
            name: 'Allow once',
            kind: 'allow_once',
            description: 'Approve this operation.',
          },
          { optionId: 'missing-name' },
          'invalid',
        ],
      }),
    ),
  ).toEqual({
    toolName: 'Edit file',
    toolKind: null,
    toolInput: { path: 'src/App.tsx' },
    options: [
      {
        optionId: 'allow-once',
        name: 'Allow once',
        kind: 'allow_once',
        description: 'Approve this operation.',
      },
    ],
  });
});

test('parses ACP standard tool title, kind, and raw input fields', () => {
  expect(
    parseCodingPermission(
      makeEvent({
        toolCall: {
          title: 'Run command',
          kind: 'execute',
          rawInput: { command: 'npm test' },
        },
        options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
      }),
    ),
  ).toEqual({
    toolName: 'Run command',
    toolKind: 'execute',
    toolInput: { command: 'npm test' },
    options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }],
  });
});

test('formats request input for a readable permission preview', () => {
  expect(formatCodingPermissionInput({ command: 'npm test' })).toBe(
    ['{', '  "command": "npm test"', '}'].join('\n'),
  );
  expect(formatCodingPermissionInput(null)).toBe('');
});

test('localizes generic option labels instead of echoing the agent wording', () => {
  i18nService.setLanguage('zh', { persist: false });

  expect(
    codingPermissionOptionLabel({
      optionId: 'allow-always',
      name: 'Always Allow',
      kind: CodingPermissionOptionKind.AllowAlways,
    }),
  ).toBe('本会话允许');
  expect(
    codingPermissionOptionLabel({
      optionId: 'allow-once',
      name: 'Allow',
      kind: CodingPermissionOptionKind.AllowOnce,
    }),
  ).toBe('允许一次');
  expect(
    codingPermissionOptionLabel({
      optionId: 'reject-once',
      name: 'Deny',
      kind: CodingPermissionOptionKind.RejectOnce,
    }),
  ).toBe('拒绝本次');
  expect(
    codingPermissionOptionLabel({ optionId: 'reject', name: 'Deny', kind: null }),
  ).toBe('拒绝本次');
  expect(
    codingPermissionOptionLabel({
      optionId: 'allow-command',
      name: 'Allow Commands Starting With cmd /c echo',
      kind: CodingPermissionOptionKind.AllowAlways,
    }),
  ).toBe('Allow Commands Starting With cmd /c echo');

  i18nService.setLanguage('en', { persist: false });
  expect(
    codingPermissionOptionLabel({
      optionId: 'allow-always',
      name: 'Always Allow',
      kind: CodingPermissionOptionKind.AllowAlways,
    }),
  ).toBe('Allow for session');
});

const option = (
  optionId: string,
  name: string,
  kind: string | null,
): CodingPermissionOption => ({ optionId, name, kind });

test('folds agent options into a primary action, a secondary action and a menu', () => {
  const actions = resolveCodingPermissionActions([
    option('reject-once', 'Reject once', CodingPermissionOptionKind.RejectOnce),
    option('allow-once', 'Allow once', CodingPermissionOptionKind.AllowOnce),
    option('allow-always', 'Allow for session', CodingPermissionOptionKind.AllowAlways),
  ]);

  expect(actions.primary).toMatchObject({
    outcome: CodingPermissionOutcome.Selected,
    optionId: 'allow-once',
  });
  expect(actions.secondary).toMatchObject({
    outcome: CodingPermissionOutcome.Selected,
    optionId: 'reject-once',
  });
  expect(actions.more).toEqual([
    option('allow-always', 'Allow for session', CodingPermissionOptionKind.AllowAlways),
  ]);
});

test('keeps custom command scopes in the menu with their agent-provided names', () => {
  const customScope = option(
    'allow-command',
    'Allow Commands Starting With cmd /c echo',
    CodingPermissionOptionKind.AllowAlways,
  );
  const actions = resolveCodingPermissionActions([
    option('allow-once', 'Allow once', CodingPermissionOptionKind.AllowOnce),
    customScope,
    option('reject-once', 'Reject once', CodingPermissionOptionKind.RejectOnce),
  ]);

  expect(actions.primary).toMatchObject({ optionId: 'allow-once' });
  expect(actions.secondary).toMatchObject({ optionId: 'reject-once' });
  expect(actions.more).toEqual([customScope]);
});

test('orders the menu with long-term grants first and destructive scopes last', () => {
  const actions = resolveCodingPermissionActions([
    option('reject-always', 'Always reject', CodingPermissionOptionKind.RejectAlways),
    option('allow-command', 'Allow Commands Starting With ls', null),
    option('allow-prefix', 'Allow Commands Starting With pwd', null),
    option('allow-always', 'Allow for session', CodingPermissionOptionKind.AllowAlways),
    option('allow-once', 'Allow once', CodingPermissionOptionKind.AllowOnce),
    option('reject-once', 'Reject once', CodingPermissionOptionKind.RejectOnce),
  ]);

  expect(actions.more.map(candidate => candidate.optionId)).toEqual([
    'allow-always',
    'allow-command',
    'allow-prefix',
    'reject-always',
  ]);
});

test('ranks a kind-less long-term grant above other scopes', () => {
  const actions = resolveCodingPermissionActions([
    option('allow-once', 'Allow', CodingPermissionOptionKind.AllowOnce),
    option('reject-once', 'Deny', CodingPermissionOptionKind.RejectOnce),
    option('allow-prefix', 'Allow Commands Starting With pwd', null),
    option('allow-always', 'Always Allow', null),
  ]);

  expect(actions.more.map(candidate => candidate.optionId)).toEqual([
    'allow-always',
    'allow-prefix',
  ]);
});

test('selects without an option id only when the agent offered no options', () => {
  const builtin = resolveCodingPermissionActions([]);
  expect(builtin.primary).toEqual({ outcome: CodingPermissionOutcome.Selected, option: null });
  expect(builtin.secondary).toEqual({
    outcome: CodingPermissionOutcome.Cancelled,
    option: null,
  });
  expect(builtin.more).toEqual([]);

  const withOptions = resolveCodingPermissionActions([
    option('allow-once', 'Allow once', CodingPermissionOptionKind.AllowOnce),
    option('reject-once', 'Reject once', CodingPermissionOptionKind.RejectOnce),
  ]);
  expect(withOptions.primary?.outcome).toBe(CodingPermissionOutcome.Selected);
  expect(withOptions.primary?.optionId).toBe('allow-once');
  expect(withOptions.secondary.outcome).toBe(CodingPermissionOutcome.Selected);
  expect(withOptions.secondary.optionId).toBe('reject-once');
});

test('cancels the request when the agent offered no rejection option', () => {
  const actions = resolveCodingPermissionActions([
    option('allow-once', 'Allow once', CodingPermissionOptionKind.AllowOnce),
  ]);

  expect(actions.primary).toMatchObject({
    outcome: CodingPermissionOutcome.Selected,
    optionId: 'allow-once',
  });
  expect(actions.secondary).toEqual({
    outcome: CodingPermissionOutcome.Cancelled,
    option: null,
  });
});

test('never spends one option on both footer actions', () => {
  const actions = resolveCodingPermissionActions([
    option('allow-always', 'Allow for session', CodingPermissionOptionKind.AllowAlways),
    option('reject-always', 'Always reject', CodingPermissionOptionKind.RejectAlways),
  ]);

  expect(actions.primary?.optionId).toBe('allow-always');
  expect(actions.secondary.optionId).toBe('reject-always');
  expect(actions.more).toEqual([]);
});

test('falls back to a rejection option when no allow option is offered', () => {
  const actions = resolveCodingPermissionActions([
    option('reject-once', 'Reject once', CodingPermissionOptionKind.RejectOnce),
    option('reject-always', 'Always reject', CodingPermissionOptionKind.RejectAlways),
  ]);

  expect(actions.primary).toBeNull();
  expect(actions.secondary.optionId).toBe('reject-once');
  expect(actions.more).toEqual([
    option('reject-always', 'Always reject', CodingPermissionOptionKind.RejectAlways),
  ]);
});

test('finds only permissions that have not been resolved by a later tool call', () => {
  const permission = makeEvent({ requestId: 'approval-1' });
  const resolved = {
    ...permission,
    sequence: 2,
    payload: { permissionRequestId: 'approval-1', permissionOutcome: 'selected' },
    kind: CodingEventKind.ToolCall,
  } satisfies CodingEvent;

  expect(findPendingCodingPermission([permission])).toBe(permission);
  expect(findPendingCodingPermission([permission, resolved])).toBeNull();
});

test('classifies permission responses without treating every selection as approval', () => {
  const permission = makeEvent({
    requestId: 'approval-1',
    options: [
      { optionId: 'allow', name: 'Allow once', kind: CodingPermissionOptionKind.AllowOnce },
      { optionId: 'reject', name: 'Reject once', kind: CodingPermissionOptionKind.RejectOnce },
    ],
  });
  expect(getCodingPermissionResolution(permission)).toBe(CodingPermissionResolution.Pending);
  expect(
    getCodingPermissionResolution({
      ...permission,
      payload: { ...permission.payload, permissionOutcome: 'selected', optionId: 'allow' },
    }),
  ).toBe(CodingPermissionResolution.Approved);
  expect(
    getCodingPermissionResolution({
      ...permission,
      payload: { ...permission.payload, permissionOutcome: 'selected', optionId: 'reject' },
    }),
  ).toBe(CodingPermissionResolution.Rejected);
  expect(
    getCodingPermissionResolution({
      ...permission,
      payload: { ...permission.payload, permissionOutcome: 'cancelled' },
    }),
  ).toBe(CodingPermissionResolution.Rejected);
});
