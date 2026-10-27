// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  CompanionWelcomeScreen,
  WELCOME_EXIT_DURATION_MS,
  WELCOME_MIN_DISPLAY_MS,
} from './CompanionWelcomeScreen';

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

test('welcomes with accessible artwork, holds for the minimum display window on fast init, and fades out smoothly', () => {
  const complete = vi.fn();
  const screen = render(
    createElement(CompanionWelcomeScreen, { exiting: false, onExitComplete: complete }),
  );
  expect(screen.getByRole('heading').textContent).toBe('welcomeCompanionsTitle');
  expect(screen.getByRole('img').getAttribute('alt')).toBe('welcomeCompanionsAlt');
  expect(screen.getByRole('status').textContent).toBe('welcomeCompanionsPreparing');
  act(() => vi.advanceTimersByTime(100));
  screen.rerender(
    createElement(CompanionWelcomeScreen, { exiting: true, onExitComplete: complete }),
  );
  expect(screen.getByRole('status').textContent).toBe('welcomeCompanionsReady');
  expect(screen.getByTestId('companion-welcome').hasAttribute('data-ending-style')).toBe(false);
  act(() => vi.advanceTimersByTime(WELCOME_MIN_DISPLAY_MS - 100));
  expect(screen.getByTestId('companion-welcome').hasAttribute('data-ending-style')).toBe(true);
  expect(complete).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(WELCOME_EXIT_DURATION_MS));
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
  act(() => vi.advanceTimersByTime(WELCOME_MIN_DISPLAY_MS));
  act(() => vi.advanceTimersByTime(WELCOME_EXIT_DURATION_MS));
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledOnce();
  screen.rerender(
    createElement(CompanionWelcomeScreen, { exiting: false, onExitComplete: latest }),
  );
  screen.rerender(createElement(CompanionWelcomeScreen, { exiting: true, onExitComplete: latest }));
  act(() => vi.advanceTimersByTime(WELCOME_EXIT_DURATION_MS));
  expect(latest).toHaveBeenCalledOnce();
});

test('a bootstrap failure exits to the error view without waiting for the minimum display window', () => {
  const complete = vi.fn();
  const screen = render(
    createElement(CompanionWelcomeScreen, {
      exiting: true,
      failed: true,
      onExitComplete: complete,
    }),
  );
  expect(screen.getByRole('status').textContent).toBe('welcomeCompanionsFailed');
  act(() => vi.advanceTimersByTime(WELCOME_EXIT_DURATION_MS));
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
