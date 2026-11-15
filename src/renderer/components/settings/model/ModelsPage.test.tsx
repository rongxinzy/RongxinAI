// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AISphereStatus } from '../../../../shared/aisphere';
import { ModelsPage } from './ModelsPage';

let mockAvailableModels: Array<{ id: string; name: string; providerKey?: string }> = [];
let mockDefaultSelectedModel: { id: string; name: string; providerKey?: string } | null = null;

vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({
      model: {
        availableModels: mockAvailableModels,
        defaultSelectedModel: mockDefaultSelectedModel,
      },
    }),
}));

vi.mock('../../../services/i18n', () => ({
  i18nService: { t: (key: string) => key, getLanguage: () => 'zh' },
}));

const refreshMagpieModels = vi.fn().mockResolvedValue(undefined);
const selectMagpieDefaultModel = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../services/availableModels', () => ({
  refreshMagpieModels: () => refreshMagpieModels(),
  selectMagpieDefaultModel: (id: string) => selectMagpieDefaultModel(id),
}));

vi.mock('../../../services/toastNotification', () => ({
  showAppToast: vi.fn(),
}));

const mockProviders = vi.fn();
const mockAisphereStatus = vi.fn();
const mockAisphereDisconnect = vi.fn();

describe('ModelsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAvailableModels = [];
    mockDefaultSelectedModel = null;
    mockProviders.mockResolvedValue([]);
    mockAisphereStatus.mockResolvedValue({ status: AISphereStatus.Unconfigured, address: '' });
    mockAisphereDisconnect.mockResolvedValue({ status: AISphereStatus.Unconfigured, address: '' });

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        magpie: {
          status: async () => ({ state: 'running', version: '1.0.0' }),
          start: async () => ({ state: 'running', version: '1.0.0' }),
          providers: () => mockProviders(),
          preferences: async () => ({
            proxy: '',
            bareModelIDs: false,
            redactPersonal: false,
            redactKinds: [],
            redactWords: [],
            disabledModels: [],
            visionModels: [],
            visionEfforts: [],
            searchChoices: [],
            imageGenModels: [],
            thinkingModel: '',
            thinkingEffort: '',
            fastModel: '',
            visionModel: '',
            vision: '',
            visionEffort: '',
            searcher: '',
            imageGen: '',
          }),
          updatePreferences: async () => ({}),
          setProviderEnabled: async () => [],
          deleteProvider: async () => [],
          saveProvider: async () => [],
          testProvider: async () => ({ ok: true }),
          setSubscriptionAccounts: async () => ({ state: 'running', version: '1.0.0' }),
        },
        managedProviders: {
          aisphereSnapshot: () => mockAisphereStatus(),
          aisphereConnect: async () => ({
            status: AISphereStatus.Ready,
            address: 'https://org.test',
          }),
          aisphereRefresh: async () => ({
            status: AISphereStatus.Ready,
            address: 'https://org.test',
          }),
          aisphereDisconnect: () => mockAisphereDisconnect(),
          policy: async () => ({ managedModelsOnly: false }),
          onChanged: () => () => {},
        },
        appInfo: { relaunch: vi.fn() },
      },
    });
  });

  test('renders guided zero state when no models or providers exist', async () => {
    const onOpenLocalModels = vi.fn();
    render(<ModelsPage onOpenLocalModels={onOpenLocalModels} />);

    await waitFor(() => expect(screen.getByText('modelsZeroTitle')).toBeInTheDocument());
    expect(screen.getByText('DeepSeek')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'modelsZeroLocalAction' }));
    expect(onOpenLocalModels).toHaveBeenCalledOnce();
  });

  test('renders organization banner, paused personal provider badge, and supports disconnect', async () => {
    mockAvailableModels = [{ id: 'org-gpt', name: 'Org GPT', providerKey: 'aisphere' }];
    mockDefaultSelectedModel = mockAvailableModels[0];
    mockProviders.mockResolvedValue([
      {
        id: 'deepseek',
        name: 'DeepSeek',
        api: 'openai-completions',
        baseUrl: 'https://api.deepseek.com/v1',
        models: ['deepseek-chat'],
        hasKey: true,
        source: 'user',
      },
    ]);
    mockAisphereStatus.mockResolvedValue({
      status: AISphereStatus.Ready,
      address: 'https://org.example.com',
      models: [{ id: 'org-gpt', name: 'Org GPT' }],
    });

    render(<ModelsPage />);

    await waitFor(() => expect(screen.getByText('modelsOrgBannerTitle')).toBeInTheDocument());
    expect(screen.getByText('modelsOrgPausedHint')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'modelsOrgBannerDisconnect' }));
    await waitFor(() => expect(mockAisphereDisconnect).toHaveBeenCalledOnce());
  });
});
