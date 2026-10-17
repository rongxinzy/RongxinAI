// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { CodingLaneStatus, type CodingAgentLane } from '../../../shared/codingAgent';
import { useCodingConversationDraft } from './useCodingConversationDraft';

const lane = (id: string, draft: string): CodingAgentLane => ({
  id,
  missionId: 'mission-1',
  profileId: 'profile-1',
  modelOverride: null,
  sourceRoot: '/w',
  executionRoot: '/w',
  configOptions: [],
  availableCommands: [],
  localSessionId: 'local-1',
  remoteSessionId: null,
  status: CodingLaneStatus.Idle,
  draft,
  scrollPosition: 0,
  pendingRecoveryPrompt: null,
  pendingRecoveryContext: null,
});

const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron');

function setup(
  initialLane: CodingAgentLane = lane('lane-1', 'persisted draft'),
  initialDraftSessionId: string | null = null,
) {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      codingAgent: {
        saveLaneView: vi.fn(async () => ({ success: true })),
      },
    },
  });
  const eventStreamRef = { current: null as HTMLDivElement | null };
  const view = renderHook(
    ({ lane, draftSessionId }: { lane: CodingAgentLane | null; draftSessionId: string | null }) =>
      useCodingConversationDraft({
        workspaceRoot: '/w',
        activeLane: lane,
        draftSession: draftSessionId ? ({ id: draftSessionId } as never) : null,
        eventStreamRef,
        onClearAttachments,
      }),
    { initialProps: { lane: initialLane, draftSessionId: initialDraftSessionId } },
  );
  return { eventStreamRef, view };
}

afterEach(() => {
  if (originalElectron) Object.defineProperty(window, 'electron', originalElectron);
  else Reflect.deleteProperty(window, 'electron');
});

let clearAttachmentsCalls = 0;
const onClearAttachments = () => {
  clearAttachmentsCalls += 1;
};

test('falls back to the lane draft persisted in the snapshot', () => {
  const { view } = setup();
  expect(view.result.current.prompt).toBe('persisted draft');
});

test('tracks the local draft per lane and switches with the lane', () => {
  const { view } = setup(lane('lane-1', 'persisted draft'), null);

  act(() => view.result.current.setDraftState({ laneId: 'lane-1', value: 'typing' }));
  expect(view.result.current.prompt).toBe('typing');

  act(() => view.result.current.setDraftState({ laneId: 'lane-2', value: 'stale lane' }));
  expect(view.result.current.prompt).toBe('persisted draft');

  act(() => view.rerender({ lane: lane('lane-2', 'other lane'), draftSessionId: null }));
  expect(view.result.current.prompt).toBe('stale lane');
});

test('prefers the new-session draft and resets it per draft session', () => {
  const { view } = setup(lane('lane-1', 'persisted draft'), null);

  act(() => view.result.current.setDraftState({ laneId: 'lane-1', value: 'lane text' }));
  act(() => view.result.current.setNewSessionDraftState({ id: 'draft-a', value: 'session text' }));

  act(() => view.rerender({ lane: lane('lane-1', 'persisted draft'), draftSessionId: 'draft-a' }));
  expect(view.result.current.prompt).toBe('session text');

  act(() => view.rerender({ lane: lane('lane-1', 'persisted draft'), draftSessionId: 'draft-b' }));
  expect(view.result.current.prompt).toBe('');
});

test('re-editing a message seeds the draft, clears attachments and focuses the composer', () => {
  clearAttachmentsCalls = 0;
  const { view } = setup(lane('lane-1', 'persisted draft'), null);
  const focusKeyBefore = view.result.current.composerFocusRequestKey;

  act(() => view.result.current.reEditUserMessage('edited content'));

  expect(view.result.current.prompt).toBe('edited content');
  expect(clearAttachmentsCalls).toBe(1);
  expect(view.result.current.composerFocusRequestKey).toBe(focusKeyBefore + 1);
});

test('persists draft and scroll saves (debounced) with the current prompt text', () => {
  vi.useFakeTimers();
  const saveLaneView = vi.fn(async (_input: { workspaceRoot: string; view: unknown }) => ({
    success: true,
  }));
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { codingAgent: { saveLaneView } },
  });
  const stream = document.createElement('div');
  const viewport = document.createElement('div');
  viewport.className = 'coding-conversation-scroll';
  viewport.scrollTop = 480;
  stream.appendChild(viewport);
  document.body.appendChild(stream);
  const view = renderHook(() =>
    useCodingConversationDraft({
      workspaceRoot: '/w',
      activeLane: lane('lane-1', 'persisted draft'),
      draftSession: null,
      eventStreamRef: { current: stream },
      onClearAttachments: () => undefined,
    }),
  );

  act(() => view.result.current.saveDraft('lane-1', 'typed text'));
  act(() => view.result.current.saveScrollPosition('lane-1', 120));
  expect(saveLaneView).not.toHaveBeenCalled();

  // Debounced: only the latest save survives the timer window.
  act(() => {
    vi.advanceTimersByTime(300);
  });
  expect(saveLaneView).toHaveBeenCalledTimes(2);
  const calls = saveLaneView.mock.calls.map(
    call => call[0]?.view as { laneId: string; draft: string; scrollPosition: number },
  );
  expect(calls).toContainEqual({
    laneId: 'lane-1',
    draft: 'typed text',
    scrollPosition: 480,
  });
  expect(calls).toContainEqual({
    laneId: 'lane-1',
    draft: 'persisted draft',
    scrollPosition: 120,
  });
  vi.useRealTimers();
});
