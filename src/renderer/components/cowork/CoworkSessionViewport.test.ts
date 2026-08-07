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

vi.mock('@shared/components/ui/skeleton', () => ({
  Skeleton: () => React.createElement('div', { 'data-testid': 'session-skeleton' }),
}));

vi.mock('./CoworkSessionDetail', () => ({
  default: ({
    displayedSessionId,
    isSessionSwitching,
  }: {
    displayedSessionId: string;
    isSessionSwitching: boolean;
  }) =>
    React.createElement('div', {
      'data-testid': 'session-detail',
      'data-displayed-session-id': displayedSessionId,
      'data-session-switching': String(isSessionSwitching),
    }),
}));

beforeEach(() => {
  mocks.state.cowork.currentSession = null;
  mocks.state.cowork.loadingSessionId = null;
});

test('keeps the detail shell mounted while its conversation switches sessions', () => {
  mocks.state.cowork.currentSession = { id: 'session-a' };
  mocks.state.cowork.loadingSessionId = 'session-b';

  render(
    React.createElement(CoworkSessionViewport, {
      sessionId: 'session-b',
      onContinue: () => undefined,
      onStop: () => undefined,
    }),
  );

  const detail = screen.getByTestId('session-detail');
  expect(detail).toHaveAttribute('data-displayed-session-id', 'session-b');
  expect(detail).toHaveAttribute('data-session-switching', 'true');
  expect(screen.queryByTestId('session-skeleton')).not.toBeInTheDocument();
});

test('renders the target session as soon as its data is ready', () => {
  mocks.state.cowork.currentSession = { id: 'session-b' };
  mocks.state.cowork.loadingSessionId = 'session-b';

  render(
    React.createElement(CoworkSessionViewport, {
      sessionId: 'session-b',
      onContinue: () => undefined,
      onStop: () => undefined,
    }),
  );

  expect(screen.getByTestId('session-detail')).toBeInTheDocument();
  expect(screen.getByTestId('session-detail')).toHaveAttribute('data-session-switching', 'false');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByTestId('session-skeleton')).not.toBeInTheDocument();
});

test('renders the current session when no switch is pending', () => {
  mocks.state.cowork.currentSession = { id: 'session-b' };

  render(
    React.createElement(CoworkSessionViewport, {
      sessionId: 'session-b',
      onContinue: () => undefined,
      onStop: () => undefined,
    }),
  );

  expect(screen.getByTestId('session-detail')).toBeInTheDocument();
  expect(screen.getByTestId('session-detail')).toHaveAttribute('data-session-switching', 'false');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('uses the same loading skeleton when there is no previous session', () => {
  mocks.state.cowork.loadingSessionId = 'session-b';

  render(
    React.createElement(CoworkSessionViewport, {
      sessionId: 'session-b',
      onContinue: () => undefined,
      onStop: () => undefined,
    }),
  );

  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getAllByTestId('session-skeleton')).not.toHaveLength(0);
  expect(screen.queryByTestId('session-detail')).not.toBeInTheDocument();
});
