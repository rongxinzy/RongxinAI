// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import { DEFAULT_IM_CONFIG } from '../../../types/im';
import { ChannelsPage } from './ChannelsPage';

vi.mock('react-redux', () => ({
  useDispatch: () => vi.fn(),
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      im: { config: DEFAULT_IM_CONFIG, status: {}, isLoading: false },
      workspace: { workspaces: [] },
    }),
}));

vi.mock('../../../services/i18n', () => ({
  i18nService: { t: (key: string) => key },
}));

vi.mock('../../../services/im', () => ({
  imService: {
    init: async () => undefined,
    destroy: () => undefined,
    loadStatus: async () => undefined,
    updateConfig: async () => undefined,
  },
}));

vi.mock('../../../services/skill', () => ({
  skillService: { getSkillConfig: async () => null },
}));

vi.mock('../../im/imSettings/useIMConnectivity', () => ({
  useIMConnectivity: () => ({
    testingPlatform: null,
    connectivityResults: {},
    connectivityFailures: {},
    connectivityModalPlatform: null,
    setConnectivityModalPlatform: vi.fn(),
    handleConnectivityTest: vi.fn(),
  }),
}));

vi.mock('../email/EmailSettingsPage', () => ({
  EmailSettingsPage: () => <div data-testid="email-panel" />,
}));

describe('ChannelsPage', () => {
  test('renders 6 active channels without Discord or Telegram and opens Sheet on click', () => {
    render(<ChannelsPage onAskAi={vi.fn()} />);

    for (const label of ['weixin', 'wecom', 'dingtalk', 'feishu', 'qq', 'emailSettings']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText(/discord/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/telegram/i)).not.toBeInTheDocument();

    const configureButtons = screen.getAllByRole('button', { name: /^(configure|edit)$/ });
    fireEvent.click(configureButtons[5]);
    expect(screen.getByTestId('email-panel')).toBeInTheDocument();
  });
});
