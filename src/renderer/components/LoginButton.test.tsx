// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { EnterpriseSessionResult } from '../../shared/enterpriseSession';
import LoginButton from './LoginButton';

const getCommunityUser = vi.fn();
const onCommunityCallback = vi.fn(() => () => undefined);
const communityLogout = vi.fn();
const sessionGateEntrypoint = vi.fn();
const enterpriseSnapshot = vi.fn();
const enterpriseLogout = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      auth: {
        getCommunityUser,
        onCommunityCallback,
        communityLogin: vi.fn(),
        communityLogout,
      },
      enterprise: {
        renderer: { sessionGateEntrypoint },
        session: {
          snapshot: enterpriseSnapshot,
          login: vi.fn(),
          changePassword: vi.fn(),
          logout: enterpriseLogout,
        },
      },
    },
  });
});

describe('LoginButton account isolation', () => {
  test('keeps the community account behavior when no enterprise module is active', async () => {
    sessionGateEntrypoint.mockResolvedValue(null);
    getCommunityUser.mockResolvedValue({
      success: true,
      user: { id: 'community-1', email: 'community@example.com' },
    });

    render(<LoginButton onShowSettings={vi.fn()} />);

    expect(await screen.findByText('community@example.com')).toBeInTheDocument();
    expect(getCommunityUser).toHaveBeenCalledOnce();
    expect(onCommunityCallback).toHaveBeenCalledOnce();
    expect(enterpriseSnapshot).not.toHaveBeenCalled();
  });

  test('ignores a persisted community login and uses only the enterprise identity', async () => {
    sessionGateEntrypoint.mockResolvedValue('zhiyuan-enterprise-ui://renderer/index.html');
    enterpriseSnapshot.mockResolvedValue(authenticated());
    enterpriseLogout.mockResolvedValue({ ok: true, snapshot: { status: 'signed-out' } });

    render(<LoginButton onShowSettings={vi.fn()} />);

    const accountButton = await screen.findByRole('button', { name: 'Enterprise User' });
    expect(getCommunityUser).not.toHaveBeenCalled();
    expect(onCommunityCallback).not.toHaveBeenCalled();
    expect(screen.queryByText('community@example.com')).not.toBeInTheDocument();

    fireEvent.click(accountButton);
    expect(screen.getByText('Enterprise Organization')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: '退出登录' }));

    expect(enterpriseLogout).toHaveBeenCalledOnce();
    expect(communityLogout).not.toHaveBeenCalled();
  });
});

function authenticated(): EnterpriseSessionResult {
  return {
    ok: true,
    snapshot: {
      status: 'authenticated',
      identity: {
        user: { id: 'enterprise-user-1', displayName: 'Enterprise User' },
        enterprise: { id: 'enterprise-1', name: 'Enterprise Organization' },
        roles: ['user'],
        sessionExpiresAt: '2026-09-03T00:00:00Z',
        passwordChangeRequired: false,
      },
    },
  };
}
