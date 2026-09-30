// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { PlatformRegistry } from '@shared/platform';

import { i18nService } from '../../services/i18n';
import type { QQInstanceConfig } from '../../types/im';
import QQInstanceSettings from './QQInstanceSettings';

const instance: QQInstanceConfig = {
  instanceId: 'qq-1',
  instanceName: 'QQ Bot',
  workspaceId: 'default',
  enabled: false,
  appId: '',
  appSecret: '',
  dmPolicy: 'open',
  allowFrom: [],
  groupPolicy: 'open',
  groupAllowFrom: [],
  historyLimit: 20,
  markdownSupport: true,
  imageServerBaseUrl: '',
  debug: false,
};

afterEach(() => {
  vi.restoreAllMocks();
});

test('opens the QQ Open Platform bot console from the setup guide', () => {
  const openExternal = vi.fn().mockResolvedValue(undefined);
  window.electron = { shell: { openExternal } } as unknown as typeof window.electron;

  render(
    <QQInstanceSettings
      instance={instance}
      instanceStatus={undefined}
      onConfigChange={vi.fn()}
      onSave={vi.fn().mockResolvedValue(undefined)}
      onRename={vi.fn()}
      onDelete={vi.fn()}
      onToggleEnabled={vi.fn()}
      onTestConnectivity={vi.fn()}
      testingPlatform={null}
      connectivityResults={{}}
    />,
  );

  fireEvent.click(screen.getByText(i18nService.t('imQQConfigLink')));

  expect(PlatformRegistry.guideUrl('qq')).toBe('https://q.qq.com/#/apps');
  expect(openExternal).toHaveBeenCalledWith('https://q.qq.com/#/apps');
});
