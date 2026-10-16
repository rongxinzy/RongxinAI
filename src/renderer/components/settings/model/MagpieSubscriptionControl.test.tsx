// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MagpieSubscriptionControl } from './MagpieSubscriptionControl';
vi.mock('../../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
const api = { setSubscriptionAccounts: vi.fn(), status: vi.fn() };
const off = { state: 'running' as const, version: '1', subscriptionAccountsEnabled: false };
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, 'electron', { configurable: true, value: { magpie: api } });
  api.status.mockResolvedValue(off);
});
afterEach(cleanup);
test('mount, open and cancel never authorize account discovery', async () => {
  render(<MagpieSubscriptionControl status={off} disabled={false} onStatusChange={vi.fn()} />);
  expect(api.setSubscriptionAccounts).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'magpieSubscriptionsEnable' }));
  expect(await screen.findByText('magpieSubscriptionsEnableConsent')).toBeTruthy();
  expect(screen.getByText('magpieSubscriptionsRestartNotice')).toBeTruthy();
  expect(api.setSubscriptionAccounts).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
  expect(api.setSubscriptionAccounts).not.toHaveBeenCalled();
});
test('confirmation calls the exact toggle once while pending and reports authoritative status', async () => {
  let resolve!: (value: typeof off) => void;
  api.setSubscriptionAccounts.mockImplementation(
    () =>
      new Promise(r => {
        resolve = r;
      }),
  );
  const onStatusChange = vi.fn(),
    onBusyChange = vi.fn();
  render(
    <MagpieSubscriptionControl
      status={off}
      disabled={false}
      onStatusChange={onStatusChange}
      onBusyChange={onBusyChange}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'magpieSubscriptionsEnable' }));
  const button = await screen.findByRole('button', { name: 'magpieSubscriptionsConfirm' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(api.setSubscriptionAccounts).toHaveBeenCalledTimes(1);
  expect(api.setSubscriptionAccounts).toHaveBeenCalledWith(true);
  expect(onStatusChange).not.toHaveBeenCalled();
  await act(async () => resolve({ ...off, subscriptionAccountsEnabled: true }));
  expect(onStatusChange).toHaveBeenCalledWith({ ...off, subscriptionAccountsEnabled: true });
  expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
});
test('disable has the same restart confirmation and does not request deleting credentials', async () => {
  api.setSubscriptionAccounts.mockResolvedValue(off);
  render(
    <MagpieSubscriptionControl
      status={{ ...off, subscriptionAccountsEnabled: true }}
      disabled={false}
      onStatusChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'magpieSubscriptionsDisable' }));
  expect(await screen.findByText('magpieSubscriptionsDisableConsent')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'magpieSubscriptionsConfirm' }));
  await waitFor(() => expect(api.setSubscriptionAccounts).toHaveBeenCalledWith(false));
});
test('failed restart stays visible and does not claim an enabled connection', async () => {
  api.setSubscriptionAccounts.mockResolvedValue({ ...off, state: 'failed' });
  const onStatusChange = vi.fn();
  render(
    <MagpieSubscriptionControl status={off} disabled={false} onStatusChange={onStatusChange} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'magpieSubscriptionsEnable' }));
  fireEvent.click(await screen.findByRole('button', { name: 'magpieSubscriptionsConfirm' }));
  await screen.findByRole('alert');
  expect(screen.getByText('magpieSubscriptionsOff')).toBeTruthy();
  expect(onStatusChange).toHaveBeenCalledWith({ ...off, state: 'failed' });
});
