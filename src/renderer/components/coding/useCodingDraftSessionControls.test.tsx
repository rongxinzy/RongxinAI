// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { CodingAgentDriverKind } from '../../../shared/codingAgent';
import { useCodingDraftSessionControls } from './useCodingDraftSessionControls';

const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron');
afterEach(() => {
  if (originalElectron) Object.defineProperty(window, 'electron', originalElectron);
  else Reflect.deleteProperty(window, 'electron');
});

function setup() {
  const getProfileConfigOptions = vi.fn(async () => ({
    success: true,
    configOptions: [{ id: 'think', name: 'Think', type: 'select', currentValue: 'off' }],
  }));
  const getProfileAvailableCommands = vi.fn(async () => ({
    success: true,
    commands: [{ name: '/plan', description: 'Plan the work' }],
  }));
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      codingAgent: {
        getProfileConfigOptions,
        getProfileAvailableCommands,
      },
    },
  });
  return { getProfileAvailableCommands, getProfileConfigOptions };
}

test('projects config options and commands for a built-in draft profile', async () => {
  setup();
  const view = renderHook(
    ({ sessionId }: { sessionId: string | undefined }) =>
      useCodingDraftSessionControls({
        draftSessionId: sessionId,
        draftProfileId: 'profile-1',
        activeDriverKind: CodingAgentDriverKind.Builtin,
      }),
    { initialProps: { sessionId: 'draft-1' } },
  );

  await waitFor(() => expect(view.result.current.draftConfigOptions).toHaveLength(1));
  await waitFor(() => expect(view.result.current.draftAvailableCommands).toHaveLength(1));
  expect(view.result.current.draftConfigOptions[0]?.id).toBe('think');
  expect(view.result.current.draftAvailableCommands[0]?.name).toBe('/plan');
});

test('clears overrides and does not fetch for non-builtin drafts', async () => {
  const { getProfileAvailableCommands, getProfileConfigOptions } = setup();
  const view = renderHook(() =>
    useCodingDraftSessionControls({
      draftSessionId: 'draft-1',
      draftProfileId: 'profile-1',
      activeDriverKind: CodingAgentDriverKind.Acp,
    }),
  );

  act(() => view.result.current.setDraftConfigOverrides({ think: 'on' }));
  act(() => view.rerender());

  expect(view.result.current.draftConfigOptions).toEqual([]);
  expect(view.result.current.draftAvailableCommands).toEqual([]);
  expect(getProfileConfigOptions).not.toHaveBeenCalled();
  expect(getProfileAvailableCommands).not.toHaveBeenCalled();
});

test('resets tracked overrides when the draft session changes', async () => {
  setup();
  const view = renderHook(
    ({ sessionId }: { sessionId: string | undefined }) =>
      useCodingDraftSessionControls({
        draftSessionId: sessionId,
        draftProfileId: 'profile-1',
        activeDriverKind: CodingAgentDriverKind.Builtin,
      }),
    { initialProps: { sessionId: 'draft-1' } },
  );

  await waitFor(() => expect(view.result.current.draftConfigOptions).toHaveLength(1));
  act(() => view.result.current.setDraftConfigOverrides({ think: 'on' }));
  expect(view.result.current.draftConfigOverrides).toEqual({ think: 'on' });

  act(() => view.rerender({ sessionId: 'draft-2' }));
  await waitFor(() => expect(view.result.current.draftConfigOverrides).toEqual({}));
});
