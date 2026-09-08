import { expect, test } from 'vitest';

import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import {
  CodingPermissionOptionKind,
  CodingPermissionResolution,
  getCodingPermissionResolution,
  isCommandAllowPermissionOption,
  isGenericCodingPermissionOption,
  findPendingCodingPermission,
  formatCodingPermissionInput,
  parseCodingPermission,
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

test('keeps custom permission scopes distinct from generic options', () => {
  expect(
    isCommandAllowPermissionOption({
      optionId: 'allow-command',
      name: 'Allow Commands Starting With cmd /c echo',
      kind: CodingPermissionOptionKind.AllowAlways,
    }),
  ).toBe(true);
  expect(
    isGenericCodingPermissionOption({
      optionId: 'allow-session',
      name: 'Allow for Session',
      kind: CodingPermissionOptionKind.AllowAlways,
    }),
  ).toBe(true);
  expect(
    isGenericCodingPermissionOption({
      optionId: 'allow-command',
      name: 'Allow Commands Starting With cmd /c echo',
      kind: CodingPermissionOptionKind.AllowAlways,
    }),
  ).toBe(false);
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
