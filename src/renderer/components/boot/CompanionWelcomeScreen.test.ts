// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CompanionWelcomeScreen } from './CompanionWelcomeScreen';

vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));

let media: MediaQueryList;
beforeEach(() => {
  vi.useFakeTimers();
  const target = new EventTarget();
  media = Object.assign(target, { matches: false }) as MediaQueryList;
  vi.stubGlobal('matchMedia', () => media);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('welcomes with accessible artwork and real readiness, without a minimum presentation time', () => {
  const complete = vi.fn();
  const screen = render(
    createElement(CompanionWelcomeScreen, { exiting: false, onExitComplete: complete }),
  );
  expect(screen.getByRole('heading').textContent).toBe('welcomeCompanionsTitle');
  expect(screen.getByRole('img').getAttribute('alt')).toBe('welcomeCompanionsAlt');
  expect(screen.getByRole('status').textContent).toBe('welcomeCompanionsPreparing');
  act(() => vi.advanceTimersByTime(10_000));
  expect(complete).not.toHaveBeenCalled();
  screen.rerender(
    createElement(CompanionWelcomeScreen, { exiting: true, onExitComplete: complete }),
  );
  expect(screen.getByRole('status').textContent).toBe('welcomeCompanionsReady');
  act(() => vi.advanceTimersByTime(200));
  expect(complete).toHaveBeenCalledOnce();
});

test('image loading failure cannot hold initialization or repeat the exit callback', () => {
  const first = vi.fn();
  const latest = vi.fn();
  const screen = render(
    createElement(CompanionWelcomeScreen, { exiting: true, onExitComplete: first }),
  );
  fireEvent.error(screen.getByRole('img'));
  expect(screen.queryByRole('img')).toBeNull();
  screen.rerender(createElement(CompanionWelcomeScreen, { exiting: true, onExitComplete: latest }));
  act(() => vi.advanceTimersByTime(200));
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledOnce();
  screen.rerender(
    createElement(CompanionWelcomeScreen, { exiting: false, onExitComplete: latest }),
  );
  screen.rerender(createElement(CompanionWelcomeScreen, { exiting: true, onExitComplete: latest }));
  act(() => vi.advanceTimersByTime(200));
  expect(latest).toHaveBeenCalledOnce();
});

test('a bootstrap failure exits to the error view without claiming readiness', () => {
  const complete = vi.fn();
  const screen = render(
    createElement(CompanionWelcomeScreen, {
      exiting: true,
      failed: true,
      onExitComplete: complete,
    }),
  );
  expect(screen.getByRole('status').textContent).toBe('welcomeCompanionsFailed');
  act(() => vi.advanceTimersByTime(200));
  expect(complete).toHaveBeenCalledOnce();
});

test('reduced motion can end a pending transition immediately and unmount cancels work', () => {
  const complete = vi.fn();
  const screen = render(
    createElement(CompanionWelcomeScreen, { exiting: true, onExitComplete: complete }),
  );
  act(() => {
    Object.assign(media, { matches: true });
    media.dispatchEvent(new Event('change'));
  });
  act(() => vi.advanceTimersByTime(0));
  expect(complete).toHaveBeenCalledOnce();
  screen.unmount();
  const cancelled = vi.fn();
  const second = render(
    createElement(CompanionWelcomeScreen, { exiting: true, onExitComplete: cancelled }),
  );
  second.unmount();
  act(() => vi.runAllTimers());
  expect(cancelled).not.toHaveBeenCalled();
});
