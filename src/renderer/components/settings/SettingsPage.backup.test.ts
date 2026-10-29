// @vitest-environment jsdom
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { defaultConfig } from '../../config';
import { configService } from '../../services/config';
import { showAppToast } from '../../services/toastNotification';
import SettingsPage from './SettingsPage';

vi.mock('react-redux', () => ({ useSelector: () => ({ workingDirectory: '/workspace' }) }));
vi.mock('../../services/config', () => ({
  configService: { reload: vi.fn(), updateConfig: vi.fn() },
}));
vi.mock('../../services/theme', () => ({
  themeService: { getStyle: () => 'zenith', setStyle: vi.fn(), setTheme: vi.fn() },
}));
vi.mock('../../services/i18n', () => ({
  i18nService: { t: (key: string) => key, subscribe: () => () => {}, getLanguage: () => 'en' },
}));
vi.mock('../../services/cowork', () => ({ coworkService: { updateConfig: vi.fn() } }));
vi.mock('../../services/toastNotification', () => ({ showAppToast: vi.fn() }));
vi.mock('../../services/errorNormalization', () => ({ reportError: (message: string) => message }));
vi.mock('./useSettingsTabs', () => ({ useSettingsTabs: () => ({ groups: [], tabs: [] }) }));
vi.mock('../PageHeader', () => ({ default: () => null }));
vi.mock('../enterprise/EnterpriseSettingsPage', () => ({ EnterpriseSettingsPage: () => null }));
vi.mock('./about/AboutSettingsPanel', () => ({ default: () => null }));
vi.mock('./AISphereSettings', () => ({ AISphereSettings: () => null }));
vi.mock('./appearance/AppearanceSettingsPanel', () => ({ AppearanceSettingsPanel: () => null }));
vi.mock('./email/EmailSettingsPage', () => ({ EmailSettingsPage: () => null }));
vi.mock('./im/ImSettingsPanel', () => ({ default: () => null }));
vi.mock('./memory/ManagedMemorySettings', () => ({ ManagedMemorySettings: () => null }));
vi.mock('./model/ModelSettingsPanel', () => ({ default: () => null }));
vi.mock('./shortcuts/ShortcutsSettingsPanel', () => ({ default: () => null }));
vi.mock('./general/GeneralLanguageField', () => ({ GeneralLanguageField: () => null }));
vi.mock('./general/DesktopPetSettingsSection', () => ({ DesktopPetSettingsSection: () => null }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(configService.reload).mockResolvedValue({
    ...defaultConfig,
    sqliteAutoBackupEnabled: false,
  });
  vi.mocked(configService.updateConfig).mockResolvedValue(undefined);
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      enterprise: { renderer: { settingsPages: async () => [] } },
      autoLaunch: { get: async () => ({ enabled: false }) },
      preventSleep: { get: async () => ({ enabled: false }) },
      cowork: { getConfig: async () => ({ config: {} }) },
    },
  });
});

const backupSwitch = () => screen.getByRole('switch', { name: 'sqliteAutoBackupEnabled' });
const openSettings = () => render(React.createElement(SettingsPage, { onClose: vi.fn() }));

test('disables backup until loaded and while saving, then restores its saved state on failure', async () => {
  let reject!: (error: Error) => void;
  vi.mocked(configService.updateConfig).mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  openSettings();
  expect(backupSwitch()).toHaveAttribute('aria-disabled', 'true');
  await waitFor(() => expect(backupSwitch()).not.toHaveAttribute('aria-disabled', 'true'));
  fireEvent.click(backupSwitch());
  expect(backupSwitch()).toBeChecked();
  expect(backupSwitch()).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(backupSwitch());
  expect(configService.updateConfig).toHaveBeenCalledTimes(1);
  await act(async () => {
    reject(new Error('disk full'));
  });
  expect(backupSwitch()).not.toBeChecked();
  expect(backupSwitch()).not.toHaveAttribute('aria-disabled', 'true');
  expect(showAppToast).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'settingsSaveFailed', isError: true }),
  );

  fireEvent.click(backupSwitch());
  await waitFor(() => expect(backupSwitch()).not.toHaveAttribute('aria-disabled', 'true'));
  expect(backupSwitch()).toBeChecked();
  expect(configService.updateConfig).toHaveBeenLastCalledWith({ sqliteAutoBackupEnabled: true });
});

test('reports each failed retry even while the previous error toast is visible', async () => {
  vi.mocked(configService.updateConfig).mockRejectedValue(new Error('disk full'));
  openSettings();
  await waitFor(() => expect(backupSwitch()).not.toHaveAttribute('aria-disabled', 'true'));
  for (const attempts of [1, 2]) {
    fireEvent.click(backupSwitch());
    await waitFor(() => expect(backupSwitch()).not.toHaveAttribute('aria-disabled', 'true'));
    expect(backupSwitch()).not.toBeChecked();
    expect(showAppToast).toHaveBeenCalledTimes(attempts);
  }
});

test('restores enabled backup after a failed disable without changing other settings', async () => {
  vi.mocked(configService.reload).mockResolvedValue({
    ...defaultConfig,
    sqliteAutoBackupEnabled: true,
  });
  vi.mocked(configService.updateConfig).mockRejectedValueOnce(new Error('disk full'));
  openSettings();
  await waitFor(() => expect(backupSwitch()).not.toHaveAttribute('aria-disabled', 'true'));
  fireEvent.click(backupSwitch());
  await waitFor(() => expect(backupSwitch()).toBeChecked());
  expect(configService.updateConfig).toHaveBeenCalledExactlyOnceWith({
    sqliteAutoBackupEnabled: false,
  });
});

test('allows Close during a save and reloads the saved value on reopening', async () => {
  let saved = false;
  let complete!: () => void;
  vi.mocked(configService.updateConfig).mockImplementationOnce(async () => {
    await new Promise<void>(resolve => {
      complete = resolve;
    });
    saved = true;
  });
  vi.mocked(configService.reload).mockImplementation(async () => ({
    ...defaultConfig,
    sqliteAutoBackupEnabled: saved,
  }));
  const close = vi.fn();
  const view = render(React.createElement(SettingsPage, { onClose: close }));
  await waitFor(() => expect(backupSwitch()).not.toHaveAttribute('aria-disabled', 'true'));
  fireEvent.click(backupSwitch());
  fireEvent.click(screen.getByRole('button', { name: 'close' }));
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  await act(async () => {
    complete();
  });
  openSettings();
  await waitFor(() => expect(backupSwitch()).not.toHaveAttribute('aria-disabled', 'true'));
  expect(backupSwitch()).toBeChecked();
});
