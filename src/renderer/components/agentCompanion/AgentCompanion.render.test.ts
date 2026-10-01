// @vitest-environment jsdom
import { createElement } from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { i18nService } from '../../services/i18n';
import { WorkingIndicator } from '../cowork/components/WorkingIndicator';
import { AgentCompanion } from './AgentCompanion';
import { AgentCompanionState } from './constants';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('skips companion rendering during 100 unchanged parent updates', () => {
  const translate = vi.spyOn(i18nService, 't');
  const view = render(createElement(AgentCompanion, { state: AgentCompanionState.Thinking }));
  const initialCalls = translate.mock.calls.length;
  for (let index = 0; index < 100; index += 1) {
    view.rerender(createElement(AgentCompanion, { state: AgentCompanionState.Thinking }));
  }
  expect(translate.mock.calls.length).toBe(initialCalls);
  view.rerender(createElement(AgentCompanion, { state: AgentCompanionState.Completed }));
  expect(view.getByRole('img').getAttribute('aria-label')).toBe(
    i18nService.t('agentCompanionCompletedLabel'),
  );
});

test('updates the memoized accessible label on language changes', () => {
  const originalLanguage = i18nService.getLanguage();
  const view = render(createElement(AgentCompanion, { state: AgentCompanionState.Thinking }));
  const image = view.getByRole('img');
  const originalLabel = image.getAttribute('aria-label');
  try {
    act(() => i18nService.setLanguage(originalLanguage === 'zh' ? 'en' : 'zh', { persist: false }));
    expect(view.getByRole('img')).toBe(image);
    expect(image.getAttribute('aria-label')).not.toBe(originalLabel);
  } finally {
    act(() => i18nService.setLanguage(originalLanguage, { persist: false }));
  }
});

test('waiting ticks update elapsed text without rendering the companion again', () => {
  vi.useFakeTimers();
  const translate = vi.spyOn(i18nService, 't');
  const view = render(createElement(WorkingIndicator));
  const companionCalls = () =>
    translate.mock.calls.filter(([key]) => key === 'agentCompanionThinkingLabel').length;
  const initialCalls = companionCalls();
  for (let second = 0; second < 9; second += 1) {
    act(() => vi.advanceTimersByTime(1000));
  }
  expect(
    view.getByText(i18nService.t('coworkWorkingElapsed').replace('{seconds}', '9')),
  ).toBeTruthy();
  expect(companionCalls()).toBe(initialCalls);
  view.unmount();
  const callsAfterUnmount = translate.mock.calls.length;
  act(() => vi.advanceTimersByTime(5000));
  expect(translate.mock.calls.length).toBe(callsAfterUnmount);
});
