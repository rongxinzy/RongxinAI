// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { CodingEventKind, type CodingEvent } from '../../../shared/codingAgent';
import { CodingErrorMessage } from '../../../shared/codingAgent/errors';
import { i18nService } from '../../services/i18n';
import { useTurnFailureToast } from './useTurnFailureToast';

const makeEvent = (
  id: string,
  sequence: number,
  kind: CodingEventKind,
  payload: Record<string, unknown> = {},
): CodingEvent => ({ id, laneId: 'lane-1', sequence, kind, payload, createdAt: 0 });

const captureToasts = () => {
  const seen: string[] = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ message: string } | string>).detail;
    seen.push(typeof detail === 'string' ? detail : detail.message);
  };
  window.addEventListener('app:showToast', listener);
  return { seen, stop: () => window.removeEventListener('app:showToast', listener) };
};

beforeEach(() => i18nService.setLanguage('zh', { persist: false }));
afterEach(() => i18nService.setLanguage('zh', { persist: false }));

describe('coding turn failure prompt', () => {
  test('ignores failures that already exist when a lane is rendered', () => {
    const toasts = captureToasts();
    try {
      renderHook(() =>
        useTurnFailureToast([makeEvent('e1', 1, CodingEventKind.TurnFailed, { error: 'boom' })]),
      );
      expect(toasts.seen).toEqual([]);
    } finally {
      toasts.stop();
    }
  });

  test('announces a failure that happened while the coding view was closed', () => {
    const toasts = captureToasts();
    const lane = 'lane-late';
    const history = [
      { ...makeEvent('l1', 1, CodingEventKind.Message, { content: 'hi' }), laneId: lane },
    ];
    try {
      // The lane is observed once while the view is open…
      const first = renderHook((events: CodingEvent[]) => useTurnFailureToast(events), {
        initialProps: history,
      });
      expect(toasts.seen).toEqual([]);
      first.unmount();

      // …then the view goes away, the turn fails, and the view comes back.
      const failure: CodingEvent = {
        ...makeEvent('l2', 2, CodingEventKind.TurnFailed, {
          error: CodingErrorMessage.AgentNoOutputTimeout,
        }),
        laneId: lane,
      };
      renderHook((events: CodingEvent[]) => useTurnFailureToast(events), {
        initialProps: [...history, failure],
      });

      expect(toasts.seen).toEqual([i18nService.t('codingErrorAgentNoOutputTimeout')]);
    } finally {
      toasts.stop();
    }
  });

  test('announces a new failure once, with the translated text', () => {
    const toasts = captureToasts();
    const history = [makeEvent('e1', 1, CodingEventKind.Message, { content: 'hi' })];
    try {
      const { rerender } = renderHook((events: CodingEvent[]) => useTurnFailureToast(events), {
        initialProps: history,
      });
      const failure = makeEvent('e2', 2, CodingEventKind.TurnFailed, {
        error: CodingErrorMessage.AgentNoOutput,
      });
      rerender([...history, failure]);

      expect(toasts.seen).toEqual([i18nService.t('codingErrorAgentNoOutput')]);

      // A re-render with the same events must not repeat the prompt.
      rerender([...history, failure]);
      expect(toasts.seen).toHaveLength(1);
    } finally {
      toasts.stop();
    }
  });
});
