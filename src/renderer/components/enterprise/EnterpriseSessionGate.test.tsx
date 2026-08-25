// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { EnterpriseSessionResult } from '../../../shared/enterpriseSession';
import { EnterpriseSessionGate } from './EnterpriseSessionGate';
import { publishEnterpriseSessionResult } from '../../services/enterpriseSessionEvents';

const sessionGateEntrypoint = vi.fn<() => Promise<string | null>>();
const snapshot = vi.fn<() => Promise<EnterpriseSessionResult>>();

vi.mock('../window/WindowTitleBar', () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      platform: 'linux',
      enterprise: {
        renderer: { sessionGateEntrypoint },
        session: {
          snapshot,
          login: vi.fn(),
          changePassword: vi.fn(),
          logout: vi.fn(),
        },
      },
    },
  });
});

describe('EnterpriseSessionGate', () => {
  test('keeps community startup unchanged without an enterprise renderer', async () => {
    sessionGateEntrypoint.mockResolvedValue(null);
    snapshot.mockResolvedValue(unavailable());

    render(
      <EnterpriseSessionGate>
        <div>community application</div>
      </EnterpriseSessionGate>,
    );

    expect(await screen.findByText('community application')).toBeInTheDocument();
  });

  test('renders the sandboxed module gate for a signed-out session', async () => {
    sessionGateEntrypoint.mockResolvedValue('zhiyuan-enterprise-ui://renderer/index.html');
    snapshot.mockResolvedValue({ ok: true, snapshot: { status: 'signed-out' } });

    render(
      <EnterpriseSessionGate>
        <div>application</div>
      </EnterpriseSessionGate>,
    );

    const frame = await screen.findByTitle('Zhiyuan');
    expect(frame).toHaveAttribute('sandbox', 'allow-forms allow-scripts');
    expect(frame).toHaveAttribute('src', 'zhiyuan-enterprise-ui://renderer/index.html');
    expect(screen.queryByText('application')).not.toBeInTheDocument();
  });

  test('enters the application for an authenticated session without required password change', async () => {
    sessionGateEntrypoint.mockResolvedValue('zhiyuan-enterprise-ui://renderer/index.html');
    snapshot.mockResolvedValue(authenticated(false));

    render(
      <EnterpriseSessionGate>
        <div>application</div>
      </EnterpriseSessionGate>,
    );

    expect(await screen.findByText('application')).toBeInTheDocument();
    expect(screen.queryByTitle('Zhiyuan')).not.toBeInTheDocument();
  });

  test('keeps the gate open while a password change is required', async () => {
    sessionGateEntrypoint.mockResolvedValue('zhiyuan-enterprise-ui://renderer/index.html');
    snapshot.mockResolvedValue(authenticated(true));

    render(
      <EnterpriseSessionGate>
        <div>application</div>
      </EnterpriseSessionGate>,
    );

    await waitFor(() => expect(screen.getByTitle('Zhiyuan')).toBeInTheDocument());
    expect(screen.queryByText('application')).not.toBeInTheDocument();
  });

  test('reopens the gate when a settings page signs out', async () => {
    sessionGateEntrypoint.mockResolvedValue('zhiyuan-enterprise-ui://renderer/index.html');
    snapshot.mockResolvedValue(authenticated(false));

    render(
      <EnterpriseSessionGate>
        <div>application</div>
      </EnterpriseSessionGate>,
    );
    expect(await screen.findByText('application')).toBeInTheDocument();

    act(() => publishEnterpriseSessionResult({ ok: true, snapshot: { status: 'signed-out' } }));

    expect(await screen.findByTitle('Zhiyuan')).toBeInTheDocument();
    expect(screen.queryByText('application')).not.toBeInTheDocument();
  });
});

function unavailable(): EnterpriseSessionResult {
  return {
    ok: false,
    error: { code: 'UNAVAILABLE', message: 'Enterprise session is unavailable.' },
  };
}

function authenticated(passwordChangeRequired: boolean): EnterpriseSessionResult {
  return {
    ok: true,
    snapshot: {
      status: 'authenticated',
      identity: {
        user: { id: 'user-1', displayName: 'Administrator' },
        enterprise: { id: 'enterprise-1', name: 'Zhiyuan' },
        roles: ['admin'],
        sessionExpiresAt: '2026-08-24T12:00:00Z',
        passwordChangeRequired,
      },
    },
  };
}
