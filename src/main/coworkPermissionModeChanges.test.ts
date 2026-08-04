import { test, expect } from 'vitest';

import { CoworkPermissionMode } from '../shared/cowork/constants';
import { getChangedSessionPermissionModes } from './coworkPermissionModeChanges';

test('returns only the session whose permission mode changed', () => {
  expect(
    getChangedSessionPermissionModes(
      { 'session-a': CoworkPermissionMode.Ask, 'session-b': CoworkPermissionMode.AllowAll },
      { 'session-a': CoworkPermissionMode.AllowAll, 'session-b': CoworkPermissionMode.AllowAll },
      CoworkPermissionMode.Ask,
    ),
  ).toEqual([['session-a', CoworkPermissionMode.AllowAll]]);
});

test('restores the fallback mode when a session override is removed', () => {
  expect(
    getChangedSessionPermissionModes(
      { 'session-a': CoworkPermissionMode.AllowAll },
      {},
      CoworkPermissionMode.Ask,
    ),
  ).toEqual([['session-a', CoworkPermissionMode.Ask]]);
});
