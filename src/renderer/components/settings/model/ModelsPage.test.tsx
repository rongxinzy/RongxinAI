// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { AISphere, AISphereStatus } from '../../../../shared/aisphere';
import type {
  MagpieModelCatalog,
  MagpieProviderSummary,
  MagpieSaveProviderInput,
} from '../../../../shared/magpie/types';
import { showAppToast } from '../../../services/toastNotification';
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
const mockAisphereConnect = vi.fn();
const mockAisphereRefresh = vi.fn();
const mockAisphereDisconnect = vi.fn();
const mockStatus = vi.fn();
const mockStart = vi.fn();
const mockSaveProvider = vi.fn();
let savedProvider: MagpieProviderSummary | null = null;
let savedCatalog: MagpieModelCatalog;

async function openFirstProviderWizard() {
  render(<ModelsPage />);
  await waitFor(() => expect(mockStatus).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button', { name: /DeepSeek/i }));
  fireEvent.change(screen.getByPlaceholderText('magpieProviderKeyPlaceholder'), {
    target: { value: 'sk-test' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'providerWizardNext' }));
}

function connectToOrganization(address: string) {
  fireEvent.click(screen.getByRole('button', { name: 'modelsZeroOrgAction' }));
  fireEvent.change(screen.getByLabelText('aisphereAddress'), { target: { value: address } });
  fireEvent.click(screen.getByRole('button', { name: 'aisphereConnect' }));
}

function saveWizard() {
  fireEvent.click(screen.getByRole('button', { name: 'providerWizardSaveAndEnable' }));
}

async function expectWizardClosed() {
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(mockSaveProvider).toHaveBeenCalledOnce();
}

describe('ModelsPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockAvailableModels = [];
    mockDefaultSelectedModel = null;
    savedProvider = null;
    savedCatalog = {
      status: { state: 'running', version: '1.0.0' },
      models: [],
      defaultModelId: null,
    };
    mockStatus.mockResolvedValue({ state: 'running', version: '1.0.0' });
    mockStart.mockResolvedValue({ state: 'running', version: '1.0.0' });
    mockSaveProvider.mockImplementation(async (input: MagpieSaveProviderInput) => {
      const id = input.id ?? 'created-provider';
      savedProvider = { ...input, id, off: false, hasKey: Boolean(input.key) };
      savedCatalog.models = input.models.map(model => ({ id: `${id}/${model}`, owned_by: id }));
      return [savedProvider];
    });
    refreshMagpieModels.mockImplementation(async () => savedCatalog);
    selectMagpieDefaultModel.mockImplementation(async (id: string) => {
      if (!savedCatalog.models.some(model => model.id === id)) {
        throw new Error('The selected model is unavailable');
      }
      savedCatalog.defaultModelId = id;
      return savedCatalog;
    });
    mockProviders.mockResolvedValue([]);
    mockAisphereStatus.mockResolvedValue({ status: AISphereStatus.Unconfigured, address: '' });
    mockAisphereConnect.mockResolvedValue({
      status: AISphereStatus.Ready,
      address: 'https://org.test',
    });
    mockAisphereRefresh.mockResolvedValue({
      status: AISphereStatus.Ready,
      address: 'https://org.test',
    });
    mockAisphereDisconnect.mockResolvedValue({ status: AISphereStatus.Unconfigured, address: '' });

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        magpie: {
          status: () => mockStatus(),
          start: () => mockStart(),
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
          saveProvider: (input: MagpieSaveProviderInput) => mockSaveProvider(input),
          testProvider: async () => ({ ok: true }),
          setSubscriptionAccounts: async () => ({ state: 'running', version: '1.0.0' }),
        },
        managedProviders: {
          aisphereSnapshot: () => mockAisphereStatus(),
          aisphereConnect: (address: string) => mockAisphereConnect(address),
          aisphereRefresh: () => mockAisphereRefresh(),
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

  test('does not auto-start model service when stopped and never enabled', async () => {
    const startSpy = vi.fn().mockResolvedValue({ state: 'running', version: '1.0.0' });
    (
      window.electron.magpie as unknown as {
        status: () => Promise<unknown>;
        start: () => Promise<unknown>;
      }
    ).status = vi.fn().mockResolvedValue({ state: 'stopped', enabled: false, version: '1.0.0' });
    (window.electron.magpie as unknown as { start: () => Promise<unknown> }).start = startSpy;

    render(<ModelsPage showLocalModelsEntry={false} />);

    await waitFor(() => expect(screen.getByText('modelsZeroTitle')).toBeInTheDocument());
    expect(startSpy).not.toHaveBeenCalled();
    expect(screen.queryByText('magpieGatewayStartFailedHint')).not.toBeInTheDocument();
  });

  test.each(['connect', 'refresh'])('loads organization models after explicit %s', async action => {
    const model = { id: `${AISphere.HostProviderPrefix}test/org-gpt`, name: 'Org GPT' };
    const connected = {
      status: AISphereStatus.Ready,
      address: 'https://org.test',
      models: [model],
    };
    mockStatus.mockResolvedValue({ state: 'stopped', enabled: false, version: '1.0.0' });
    mockAisphereConnect.mockImplementation(async () => {
      mockAisphereStatus.mockResolvedValue(connected);
      return connected;
    });
    mockAisphereRefresh.mockResolvedValue(connected);
    if (action === 'refresh') mockAisphereStatus.mockResolvedValue(connected);

    let finishStart!: (status: MagpieModelCatalog['status']) => void;
    mockStart.mockImplementation(
      () =>
        new Promise(resolve => {
          finishStart = resolve;
        }),
    );
    refreshMagpieModels.mockImplementation(async () => {
      if (savedCatalog.status.enabled) {
        mockAvailableModels = [model];
        mockDefaultSelectedModel = model;
      }
      return savedCatalog;
    });

    render(<ModelsPage />);
    await waitFor(() => expect(refreshMagpieModels).toHaveBeenCalled());
    expect(mockStart).not.toHaveBeenCalled();
    if (action === 'connect') {
      connectToOrganization(connected.address);
      await waitFor(() => expect(mockAisphereConnect).toHaveBeenCalledWith(connected.address));
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'modelsOrgBannerRefresh' }));
      await waitFor(() => expect(mockAisphereRefresh).toHaveBeenCalledOnce());
    }
    await waitFor(() => expect(mockStart).toHaveBeenCalledOnce());
    expect(screen.queryByText(model.name)).not.toBeInTheDocument();
    if (action === 'connect') {
      const refresh = screen.getByRole('button', { name: 'modelsOrgBannerRefresh' });
      await act(async () => fireEvent.click(refresh));
      expect(mockAisphereRefresh).toHaveBeenCalledOnce();
      expect(mockStart).toHaveBeenCalledOnce();
    }
    savedCatalog.status = { state: 'running', enabled: true, version: '1.0.0' };
    await act(async () => finishStart(savedCatalog.status));
    expect(await screen.findByText(model.name)).toBeInTheDocument();
  });

  test('refreshes the organization without restarting an enabled, running service', async () => {
    const connected = { status: AISphereStatus.Ready, address: 'https://org.test', models: [] };
    mockAisphereStatus.mockResolvedValue(connected);
    mockAisphereRefresh.mockResolvedValue(connected);
    mockStatus.mockResolvedValue({ state: 'running', enabled: true, version: '1.0.0' });

    render(<ModelsPage />);
    const refresh = await screen.findByRole('button', { name: 'modelsOrgBannerRefresh' });
    await act(async () => fireEvent.click(refresh));
    expect(mockAisphereRefresh).toHaveBeenCalledOnce();
    expect(mockStart).not.toHaveBeenCalled();
  });

  test('shows the existing start retry when an organization binds but local startup fails', async () => {
    mockStatus.mockResolvedValue({ state: 'stopped', enabled: false, version: '1.0.0' });
    mockAisphereStatus
      .mockResolvedValueOnce({ status: AISphereStatus.Unconfigured, address: '' })
      .mockResolvedValue({ status: AISphereStatus.Ready, address: 'https://org.test', models: [] });
    mockStart.mockRejectedValueOnce(new Error('startup failed'));

    render(<ModelsPage />);
    await waitFor(() => expect(refreshMagpieModels).toHaveBeenCalledOnce());
    connectToOrganization('https://org.test');
    expect(await screen.findByText('magpieGatewayStartFailedHint')).toBeInTheDocument();
    expect(screen.getByText('modelsOrgBannerTitle')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'providerErrRetry' }));
    await waitFor(() =>
      expect(screen.queryByText('magpieGatewayStartFailedHint')).not.toBeInTheDocument(),
    );
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  test('starts a never-enabled service before saving the first provider', async () => {
    mockStatus.mockResolvedValue({ state: 'stopped', enabled: false, version: '1.0.0' });
    let finishStart!: (status: MagpieModelCatalog['status']) => void;
    mockStart.mockImplementation(
      () =>
        new Promise(resolve => {
          finishStart = resolve;
        }),
    );

    await openFirstProviderWizard();
    expect(mockStart).not.toHaveBeenCalled();
    saveWizard();
    await waitFor(() => expect(mockStart).toHaveBeenCalledOnce());
    expect(mockSaveProvider).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'providerWizardSaveAndEnable' })).toBeDisabled();

    finishStart({ state: 'running', enabled: true, version: '1.0.0' });
    await expectWizardClosed();
    expect(selectMagpieDefaultModel).toHaveBeenCalledWith(`${savedProvider?.id}/deepseek-chat`);
  });

  test('selects the saved provider catalog id and closes after persistence', async () => {
    await openFirstProviderWizard();
    saveWizard();
    await expectWizardClosed();
    expect(mockStart).not.toHaveBeenCalled();
    expect(selectMagpieDefaultModel).toHaveBeenCalledExactlyOnceWith(
      `${savedProvider?.id}/deepseek-chat`,
    );
    expect(showAppToast).toHaveBeenCalledWith('savedSuccessfully');
  });

  test('keeps the first saved provider visible when a pre-save startup refresh finishes later', async () => {
    mockStatus.mockResolvedValue({ state: 'stopped', enabled: false, version: '1.0.0' });
    let finishOldRead!: (providers: MagpieProviderSummary[]) => void;
    mockProviders.mockResolvedValueOnce([]).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishOldRead = resolve;
        }),
    );
    let finishSave!: () => void;
    const pendingSave = new Promise<void>(resolve => {
      finishSave = resolve;
    });
    const persistProvider = mockSaveProvider.getMockImplementation()!;
    mockSaveProvider.mockImplementation(async (input: MagpieSaveProviderInput) => {
      await pendingSave;
      return persistProvider(input);
    });

    await openFirstProviderWizard();
    saveWizard();
    await waitFor(() => expect(mockProviders).toHaveBeenCalledTimes(2));
    await act(async () => finishSave());
    await expectWizardClosed();
    expect(screen.getByRole('switch', { name: 'DeepSeek' })).toBeChecked();

    await act(async () => finishOldRead([]));
    expect(screen.getByRole('switch', { name: 'DeepSeek' })).toBeChecked();
    expect(mockSaveProvider).toHaveBeenCalledOnce();
  });

  test('uses a bare catalog id only when it belongs to the newly saved provider', async () => {
    await openFirstProviderWizard();
    refreshMagpieModels.mockImplementation(async () => ({
      ...savedCatalog,
      models: [{ id: 'deepseek-chat', owned_by: savedProvider?.id }],
    }));
    selectMagpieDefaultModel.mockResolvedValue(savedCatalog);
    saveWizard();
    await expectWizardClosed();
    expect(selectMagpieDefaultModel).toHaveBeenCalledExactlyOnceWith('deepseek-chat');
  });

  test('does not select another provider model with the same raw id', async () => {
    await openFirstProviderWizard();
    refreshMagpieModels.mockImplementation(async () => ({
      ...savedCatalog,
      models: [{ id: 'deepseek-chat', owned_by: 'another-provider' }, ...savedCatalog.models],
    }));
    saveWizard();
    await expectWizardClosed();
    expect(selectMagpieDefaultModel).toHaveBeenCalledExactlyOnceWith(
      `${savedProvider?.id}/deepseek-chat`,
    );
  });

  test('prefers the owned canonical id when the catalog also contains an owned bare alias', async () => {
    await openFirstProviderWizard();
    refreshMagpieModels.mockImplementation(async () => ({
      ...savedCatalog,
      models: [{ id: 'deepseek-chat', owned_by: savedProvider?.id }, ...savedCatalog.models],
    }));
    saveWizard();
    await expectWizardClosed();
    expect(selectMagpieDefaultModel).toHaveBeenCalledExactlyOnceWith(
      `${savedProvider?.id}/deepseek-chat`,
    );
    expect(showAppToast).toHaveBeenCalledWith('savedSuccessfully');
  });

  test('closes with a follow-up notice when only another provider has the selected model', async () => {
    await openFirstProviderWizard();
    refreshMagpieModels.mockImplementation(async () => ({
      ...savedCatalog,
      models: [{ id: 'deepseek-chat', owned_by: 'another-provider' }],
    }));
    saveWizard();
    await expectWizardClosed();
    expect(selectMagpieDefaultModel).not.toHaveBeenCalled();
    expect(showAppToast).toHaveBeenCalledWith({
      message: 'providerWizardSavedSetupIncomplete',
      isError: false,
    });
    expect(showAppToast).not.toHaveBeenCalledWith('savedSuccessfully');
  });

  test('leaves the current default unchanged when set-as-default is unchecked', async () => {
    await openFirstProviderWizard();
    fireEvent.click(screen.getByRole('checkbox', { name: 'providerWizardSetDefaultModel' }));
    saveWizard();
    await expectWizardClosed();
    expect(selectMagpieDefaultModel).not.toHaveBeenCalled();
  });

  test('keeps the form on startup failure and retries without losing the key', async () => {
    mockStatus.mockResolvedValue({ state: 'stopped', enabled: false, version: '1.0.0' });
    mockStart.mockRejectedValueOnce(new Error('startup failed'));
    await openFirstProviderWizard();
    saveWizard();
    await waitFor(() =>
      expect(showAppToast).toHaveBeenCalledWith({
        message: 'saveFailed',
        isError: true,
      }),
    );
    expect(mockSaveProvider).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    saveWizard();
    await expectWizardClosed();
    expect(mockSaveProvider).toHaveBeenCalledWith(expect.objectContaining({ key: 'sk-test' }));
    expect(mockStart).toHaveBeenCalledTimes(2);
  });

  test('keeps the form on persistence failure and allows a successful retry', async () => {
    mockSaveProvider.mockRejectedValueOnce(new Error('write failed'));
    await openFirstProviderWizard();
    saveWizard();
    await waitFor(() =>
      expect(showAppToast).toHaveBeenCalledWith({
        message: 'saveFailed',
        isError: true,
      }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(selectMagpieDefaultModel).not.toHaveBeenCalled();

    saveWizard();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockSaveProvider).toHaveBeenCalledTimes(2);
    expect(mockSaveProvider).toHaveBeenLastCalledWith(expect.objectContaining({ key: 'sk-test' }));
  });

  test.each(['catalog', 'selection'])(
    'closes after persistence when the %s follow-up fails without creating duplicates',
    async failure => {
      await openFirstProviderWizard();
      if (failure === 'catalog') {
        refreshMagpieModels.mockRejectedValue(new Error('catalog unavailable'));
      } else {
        selectMagpieDefaultModel.mockRejectedValue(new Error('selection unavailable'));
      }
      saveWizard();
      await expectWizardClosed();
      expect(showAppToast).toHaveBeenCalledWith({
        message: 'providerWizardSavedSetupIncomplete',
        isError: false,
      });
      expect(showAppToast).not.toHaveBeenCalledWith('savedSuccessfully');
    },
  );
});
