// @vitest-environment jsdom
import { createElement } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import {
  CodingAgentCheckFailure,
  CodingAgentCheckPhase,
  CodingAgentDriverKind,
  CodingAgentEnvironmentKey,
  CodingAgentManagedAdapterId,
  CodingAgentProfileStatus,
  type CodingAgentProfile,
} from '../../../shared/codingAgent';
import { i18nService } from '../../services/i18n';
import {
  CodingAgentConnectionRow,
  type CodingAgentConnectionRowProps,
} from './CodingAgentConnectionRow';

const profile: CodingAgentProfile = {
  id: 'codex',
  name: 'Codex',
  description: 'Uses the local configuration.',
  driverKind: CodingAgentDriverKind.Acp,
  status: CodingAgentProfileStatus.Ready,
  capabilities: {
    supportsLoadSession: false,
    supportsResumeSession: false,
    supportsPlans: false,
    supportsPermissions: false,
    supportsFilesystem: false,
    supportsTerminal: false,
    supportsConfigOptions: false,
    supportsUsage: false,
    supportsElicitation: false,
  },
  command: '/usr/bin/node',
  args: [],
  authMethods: [],
  isBuiltin: false,
  environment: {
    [CodingAgentEnvironmentKey.ManagedAdapterId]: CodingAgentManagedAdapterId.Codex,
    [CodingAgentEnvironmentKey.CodexPath]: '/a/long/installation/path/codex',
    [CodingAgentEnvironmentKey.ManagedAdapterVersion]: '1.6.2',
  },
};
const props = (
  overrides: Partial<CodingAgentConnectionRowProps> = {},
): CodingAgentConnectionRowProps => ({
  profile,
  onProbe: vi.fn(async () => true),
  onTrust: vi.fn(async () => true),
  ...overrides,
});
beforeEach(() => i18nService.setLanguage('zh', { persist: false }));

test('ready tools can be rechecked and disclose local configuration and the full path', async () => {
  render(createElement(CodingAgentConnectionRow, props()));
  expect(screen.getByRole('button', { name: '重新检测' })).toBeEnabled();
  expect(screen.getByText('使用本机工具的账号和模型配置。')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '查看连接详情' }));
  expect(await screen.findByText('/a/long/installation/path/codex')).toBeVisible();
  expect(screen.getByText('连接适配器版本：1.6.2')).toBeVisible();
});

test('repeated clicks launch one check and a rejected request has persistent inline feedback', async () => {
  let rejectCheck: (error: Error) => void = () => {};
  const onProbe = vi.fn(
    () =>
      new Promise<boolean>((_resolve, reject) => {
        rejectCheck = reject;
      }),
  );
  render(createElement(CodingAgentConnectionRow, props({ onProbe })));
  const button = screen.getByRole('button', { name: '重新检测' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(onProbe).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '检测中…' })).toBeDisabled();
  await act(async () => rejectCheck(new Error('transport disconnected')));
  expect(screen.getByRole('alert')).toHaveTextContent('连接未完成');
  expect(screen.getByRole('button', { name: '重新检测' })).toBeEnabled();
});

test.each([
  [CodingAgentCheckFailure.Authentication, '需要登录或有效凭据'],
  [CodingAgentCheckFailure.Startup, '工具启动失败'],
  [CodingAgentCheckFailure.Protocol, '连接协议不兼容'],
  [CodingAgentCheckFailure.Timeout, '连接请求超时'],
  [CodingAgentCheckFailure.NoReply, '模型没有返回内容'],
])('shows an actionable failure for %s', (failure, message) => {
  render(
    createElement(
      CodingAgentConnectionRow,
      props({
        profile: {
          ...profile,
          status: CodingAgentProfileStatus.Unavailable,
          connectionCheck: { phase: CodingAgentCheckPhase.Failed, failure, checkedAt: Date.now() },
        },
      }),
    ),
  );
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.getByText(/最近检测/)).toBeInTheDocument();
});

test('live model phase updates and theme rerenders preserve expanded details', async () => {
  const initial = props();
  const view = render(createElement(CodingAgentConnectionRow, initial));
  fireEvent.click(screen.getByRole('button', { name: '查看连接详情' }));
  document.documentElement.classList.add('dark');
  view.rerender(
    createElement(CodingAgentConnectionRow, {
      ...initial,
      profile: { ...profile, connectionCheck: { phase: CodingAgentCheckPhase.ModelReply } },
    }),
  );
  expect(screen.getByRole('status')).toHaveTextContent('正在等待模型回复');
  expect(screen.getByRole('button', { name: '检测中…' })).toBeDisabled();
  expect(await screen.findByText('/a/long/installation/path/codex')).toBeVisible();
  document.documentElement.classList.remove('dark');
});

test('success accurately states the scope of verification', () => {
  render(
    createElement(
      CodingAgentConnectionRow,
      props({
        profile: {
          ...profile,
          connectionCheck: { phase: CodingAgentCheckPhase.Complete, checkedAt: Date.now() },
        },
      }),
    ),
  );
  expect(screen.getByRole('status')).toHaveTextContent('文件操作和工具执行尚未验证');
});

test('untrusted commands cannot be checked until trust is confirmed', () => {
  render(
    createElement(
      CodingAgentConnectionRow,
      props({ profile: { ...profile, status: CodingAgentProfileStatus.Untrusted } }),
    ),
  );
  expect(screen.queryByRole('button', { name: '检测连接' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '确认信任' })).toBeEnabled();
});

test.each([1, 2])(
  'authentication stays in the local CLI when %s login methods are advertised',
  count => {
    const onProbe = vi.fn(async () => true);
    render(
      createElement(
        CodingAgentConnectionRow,
        props({
          onProbe,
          profile: {
            ...profile,
            status: CodingAgentProfileStatus.NeedsAuth,
            authMethods: Array.from({ length: count }, (_, index) => ({
              id: `login-${index}`,
              name: `Login ${index}`,
            })),
          },
        }),
      ),
    );
    expect(screen.queryByRole('button', { name: '登录' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('连接检测失败');
    expect(screen.getByRole('alert')).toHaveTextContent(
      '请在本机工具中完成账号和模型配置后重新检测',
    );
    fireEvent.click(screen.getByRole('button', { name: '检测连接' }));
    expect(onProbe).toHaveBeenCalledWith(profile.id);
  },
);

test('persisted unavailable agents show failure instead of claiming they were never checked', () => {
  render(
    createElement(
      CodingAgentConnectionRow,
      props({
        profile: { ...profile, status: CodingAgentProfileStatus.Unavailable },
      }),
    ),
  );
  expect(screen.getByRole('alert')).toHaveTextContent('连接检测失败');
  expect(screen.getByRole('alert')).toHaveTextContent('连接未完成');
  expect(screen.queryByText(/尚未验证连接/)).not.toBeInTheDocument();
});
