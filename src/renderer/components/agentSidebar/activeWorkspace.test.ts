import { describe, expect, test } from 'vitest';

import { CoworkSessionSource } from '../../../shared/cowork/constants';
import type { CoworkSessionSummary } from '../../types/cowork';
import { isProjectWorkspaceActive, isSectionWorkspaceActive } from './activeWorkspace';

const session = (overrides: Partial<CoworkSessionSummary>): CoworkSessionSummary =>
  ({
    id: 'session-1',
    workspaceId: 'ws-1',
    source: CoworkSessionSource.Manual,
    ...overrides,
  }) as CoworkSessionSummary;

describe('isSectionWorkspaceActive', () => {
  test('lights up the project section for an ordinary session', () => {
    const current = session({});

    expect(isSectionWorkspaceActive(current, 'ws-1', false)).toBe(true);
    expect(isSectionWorkspaceActive(current, 'ws-1', true)).toBe(false);
  });

  test('lights up the automation section for a scheduled session', () => {
    const current = session({ source: CoworkSessionSource.Scheduled });

    expect(isSectionWorkspaceActive(current, 'ws-1', true)).toBe(true);
    expect(isSectionWorkspaceActive(current, 'ws-1', false)).toBe(false);
  });

  test('ignores other folders and a missing current session', () => {
    const current = session({});

    expect(isSectionWorkspaceActive(current, 'ws-2', false)).toBe(false);
    expect(isSectionWorkspaceActive(null, 'ws-1', false)).toBe(false);
    expect(isSectionWorkspaceActive(undefined, 'ws-1', true)).toBe(false);
  });
});

describe('isProjectWorkspaceActive', () => {
  test('highlights the picked project folder without any open session', () => {
    expect(isProjectWorkspaceActive(null, 'ws-1', 'ws-1')).toBe(true);
    expect(isProjectWorkspaceActive(null, 'ws-2', 'ws-1')).toBe(false);
  });

  test('highlights the folder of an ordinary open session', () => {
    expect(isProjectWorkspaceActive(session({}), 'ws-1', 'ws-1')).toBe(true);
  });

  test('yields to the automation section for a scheduled session', () => {
    const scheduled = session({ source: CoworkSessionSource.Scheduled });

    expect(isProjectWorkspaceActive(scheduled, 'ws-1', 'ws-1')).toBe(false);
    expect(isSectionWorkspaceActive(scheduled, 'ws-1', true)).toBe(true);
  });
});
