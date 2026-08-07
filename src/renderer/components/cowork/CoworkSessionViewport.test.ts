// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import CoworkSessionViewport from './CoworkSessionViewport';

const mocks = vi.hoisted(() => ({
  state: {
    cowork: {
      currentSession: null as { id: string } | null,
      loadingSessionId: null as string | null,
    },
  },
}));

vi.mock('react-redux', () => ({
  useSelector: (selector: (state: typeof mocks.state) => unknown) => selector(mocks.state),
}));

vi.mock('@shared/components/ui/spinner', () => ({
  Spinner: () => React.createElement('div', { 'data-testid': 'session-spinner' }),
}));

vi.mock('./CoworkSessionDetail', () => ({
  default: () => React.createElement('div', { 'data-testid': 'session-detail' }),
}));

beforeEach(() => {
  mocks.state.cowork.currentSession = null;
  mocks.state.cowork.loadingSessionId = null;
});

test('keeps the current detail tree mounted while another session loads', () => {
  mocks.state.cowork.currentSession = { id: 'session-a' };
  mocks.state.cowork.loadingSessionId = 'session-b';

  const view = render(
    React.createElement(CoworkSessionViewport, {
      sessionId: 'session-b',
      onContinue: () => undefined,
      onStop: () => undefined,
    }),
  );

  const retainedDetail = screen.getByTestId('session-detail');
  expect(retainedDetail.parentElement).toHaveAttribute('inert');
  expect(retainedDetail.parentElement?.parentElement).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByTestId('session-spinner')).not.toBeInTheDocument();

  mocks.state.cowork.currentSession = { id: 'session-b' };
  mocks.state.cowork.loadingSessionId = null;
  view.rerender(
    React.createElement(CoworkSessionViewport, {
      sessionId: 'session-b',
      onContinue: () => undefined,
      onStop: () => undefined,
    }),
  );

  expect(screen.getByTestId('session-detail')).toBe(retainedDetail);
  expect(retainedDetail.parentElement).not.toHaveAttribute('inert');
  expect(retainedDetail.parentElement?.parentElement).toHaveAttribute('aria-busy', 'false');
});

test('uses a loading state only when no previous session can be retained', () => {
  mocks.state.cowork.loadingSessionId = 'session-b';

  render(
    React.createElement(CoworkSessionViewport, {
      sessionId: 'session-b',
      onContinue: () => undefined,
      onStop: () => undefined,
    }),
  );

  expect(screen.getByTestId('session-spinner')).toBeInTheDocument();
  expect(screen.queryByTestId('session-detail')).not.toBeInTheDocument();
});
