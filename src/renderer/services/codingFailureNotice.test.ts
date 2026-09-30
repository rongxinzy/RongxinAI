// @vitest-environment jsdom

import { afterEach, expect, test, vi } from 'vitest';
import {
  CodingEventKind,
  CodingErrorMessage,
  type CodingRoomSnapshot,
  type CodingRoomEventDelta,
  type CodingEvent,
} from '../../shared/codingAgent';
import { startCodingFailureNoticeListener, observeCodingTurnFailures } from './codingFailureNotice';
import { i18nService } from './i18n';

afterEach(() => vi.restoreAllMocks());

test('shows background failures immediately without mounting the coding page and deduplicates history', () => {
  const previous = window.electron;
  let emit: ((snapshot: CodingRoomSnapshot) => void) | undefined;
  let emitDelta: ((delta: CodingRoomEventDelta) => void) | undefined;
  const dispose = vi.fn();
  const disposeDelta = vi.fn();
  window.electron = {
    ...previous,
    codingAgent: {
      ...previous?.codingAgent,
      onChanged: callback => {
        emit = callback;
        return dispose;
      },
      onEventDelta: callback => {
        emitDelta = callback;
        return disposeDelta;
      },
    },
  } as typeof window.electron;
  const toasts: string[] = [];
  const listener = (event: Event) =>
    toasts.push((event as CustomEvent<{ message: string }>).detail.message);
  window.addEventListener('app:showToast', listener);
  i18nService.setLanguage('zh', { persist: false });
  const unsubscribe = startCodingFailureNoticeListener();
  const failure: CodingEvent = {
    id: 'background-failure',
    laneId: 'background-lane',
    sequence: 2,
    kind: CodingEventKind.TurnFailed,
    payload: { error: CodingErrorMessage.AgentNoOutputTimeout },
    createdAt: Date.now(),
  };
  try {
    // A new lane first appears in a live push while the user is on another page.
    emitDelta!({ workspaceRoot: 'background-workspace', events: [failure] });
    expect(toasts).toEqual([i18nService.t('codingErrorAgentNoOutputTimeout')]);
    emit!({ events: [failure] } as CodingRoomSnapshot);
    observeCodingTurnFailures([failure]);
    expect(toasts).toHaveLength(1);
    unsubscribe();
    expect(dispose).toHaveBeenCalledOnce();
    expect(disposeDelta).toHaveBeenCalledOnce();
  } finally {
    window.removeEventListener('app:showToast', listener);
    window.electron = previous;
  }
});

test('does not replay old failures when an unseen workspace publishes its history', () => {
  const previous = window.electron;
  let emit: ((snapshot: CodingRoomSnapshot) => void) | undefined;
  window.electron = {
    ...previous,
    codingAgent: {
      ...previous?.codingAgent,
      onChanged: callback => {
        emit = callback;
        return () => undefined;
      },
      onEventDelta: () => () => undefined,
    },
  } as typeof window.electron;
  const listener = vi.fn();
  window.addEventListener('app:showToast', listener);
  const unsubscribe = startCodingFailureNoticeListener();
  try {
    const events: CodingEvent[] = [
      {
        id: 'old-failure',
        laneId: 'old-background-lane',
        sequence: 1,
        kind: CodingEventKind.TurnFailed,
        payload: { error: 'old failure' },
        createdAt: 0,
      },
    ];
    emit!({ events } as CodingRoomSnapshot);
    expect(listener).not.toHaveBeenCalled();
  } finally {
    unsubscribe();
    window.removeEventListener('app:showToast', listener);
    window.electron = previous;
  }
});
