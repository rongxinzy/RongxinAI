// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { MARKETPLACE_PAGE_SIZE } from '../constants';
import { i18nService } from '../../../services/i18n';

import type { MarketplaceModel, MarketplaceSearchParams } from '../../../../shared/marketplace';
import { MarketplacePanel } from './MarketplacePanel';

function makeModel(repoName: string, overrides: Partial<MarketplaceModel> = {}): MarketplaceModel {
  const repoId = `acme/${repoName}-GGUF`;
  return {
    source: 'modelscope-gguf',
    id: repoName,
    repoId,
    name: repoName,
    description: '',
    tags: [],
    sizes: ['1.1B'],
    recommendedTag: 'Q4_K_M',
    capability: 'chat',
    installed: false,
    metadataStatus: 'verified',
    fit: { status: 'excellent', reason: 'fits' },
    score: {
      stars: 4.5,
      value: 4.5,
      confidence: 'B',
      taskQuality: 0.8,
      deviceFit: 0.8,
      runtimeCompatibility: 0.8,
      trust: 0.8,
      community: 0.8,
      reasons: [],
      scoreVersion: 'test',
    },
    files: [
      {
        path: 'model.gguf',
        isRecommended: true,
        downloadUrl: 'https://example.com/model.gguf',
        sha256: 'a'.repeat(64),
        sizeBytes: 1024,
        quantization: 'Q4_K_M',
      },
    ],
    filePath: 'model.gguf',
    downloads: 100,
    runtime: {
      format: 'gguf',
      status: 'verified',
      ggufFilesVerified: true,
      sha256Verified: true,
      chatTemplate: 'documented',
      toolCalling: 'documented',
      mmproj: 'not-required',
      source: 'modelscope-file-api',
      observedAt: '2026-01-01',
      reasons: [],
    },
    ...overrides,
  };
}

function renderPanel(overrides: Partial<Parameters<typeof MarketplacePanel>[0]> = {}) {
  const props = {
    loading: false,
    models: [] as MarketplaceModel[],
    hasSearched: false,
    marketplaceLoading: false,
    marketplaceError: null,
    hasNextPage: false,
    installedModelPathMap: new Map(),
    hardwareSummary: undefined,
    hardwareSummaryReady: false,
    onQueryChange: vi.fn(),
    onSearch: vi.fn(),
    onInstall: vi.fn(),
    onOpenDownloadPanel: vi.fn(),
    ...overrides,
  };
  return { ...render(<MarketplacePanel {...props} />), props };
}

const lastSearchCall = (onSearch: ReturnType<typeof vi.fn>) =>
  onSearch.mock.calls.at(-1)?.[0] as MarketplaceSearchParams;

describe('MarketplacePanel result grid', () => {
  test('first visit does not auto-search (delegated to the recommendations hook)', () => {
    // The panel is presentation-only; the parent's useMarketplaceRecommendations
    // owns the first featured load. The panel must not fire its own request,
    // which would race the hook's and clobber the result with different params.
    const onSearch = vi.fn();
    renderPanel({ hasSearched: false, onSearch });

    expect(onSearch).not.toHaveBeenCalled();
  });

  test('renders one card per installable model', () => {
    const models = [makeModel('alpha'), makeModel('beta'), makeModel('gamma')];
    renderPanel({ hasSearched: true, models });

    expect(screen.getAllByText('安装')).toHaveLength(3);
  });

  test('renders every model returned in the current cloud page', () => {
    const models = Array.from({ length: MARKETPLACE_PAGE_SIZE + 2 }, (_, index) =>
      makeModel(`model-${index}`),
    );
    renderPanel({ hasSearched: true, models });

    expect(screen.getAllByText('安装')).toHaveLength(MARKETPLACE_PAGE_SIZE + 2);
  });

  test('keeps the model result viewport scrollable while pagination stays outside it', () => {
    const { container } = renderPanel({
      hasSearched: true,
      models: [makeModel('alpha')],
      totalCount: MARKETPLACE_PAGE_SIZE * 2,
      hasNextPage: true,
    });
    const viewport = container.querySelector('.overflow-y-auto');
    const pagination = screen.getByText(/1\s*\/\s*2/);

    expect(viewport).toHaveClass('overflow-x-hidden', 'scrollbar-gutter-stable');
    expect(viewport).not.toContainElement(pagination);
  });

  test('uses the same constrained viewport for the loading skeleton', () => {
    const { container } = renderPanel({ hasSearched: true, marketplaceLoading: true });
    const viewport = container.querySelector('.overflow-y-auto');

    expect(viewport).toHaveClass('overflow-x-hidden', 'scrollbar-gutter-stable');
  });

  test('does not render the server result count in the header', () => {
    const models = Array.from({ length: MARKETPLACE_PAGE_SIZE }, (_, index) =>
      makeModel(`model-${index}`),
    );
    renderPanel({ hasSearched: true, models, totalCount: 3318 });

    expect(screen.queryByText(/3318/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /\u5b89\u88c5/ })).toHaveLength(
      MARKETPLACE_PAGE_SIZE,
    );
  });
  test('does not render a rendered card count in the header', () => {
    const models = [makeModel('alpha'), makeModel('beta')];
    renderPanel({ hasSearched: true, models });

    expect(screen.getAllByText('安装')).toHaveLength(2);
  });

  test('empty grid shows empty state without a misleading server total', () => {
    // Regression: server reported 7 matches but every model was filtered out
    // (installed/unsupported). The panel must not print "共 7 个模型" over an
    // empty grid — it should show the empty state instead.
    renderPanel({ hasSearched: true, models: [] });

    expect(screen.queryByText(/共 7 个模型/)).not.toBeInTheDocument();
    expect(screen.getByText(i18nService.t('marketplaceNoModels'))).toBeInTheDocument();
  });

  test('empty search results hide upstream 503 warnings and show the no-model state', () => {
    renderPanel({
      hasSearched: true,
      models: [],
      marketplaceError: 'Model catalog failed: HTTP 503',
    });

    expect(screen.getByText(i18nService.t('marketplaceNoModels'))).toBeInTheDocument();
    expect(screen.queryByText('搜索受限')).not.toBeInTheDocument();
    expect(screen.queryByText(/503/)).not.toBeInTheDocument();
  });

  test('fit=all keeps installed models in the grid', () => {
    const models = [
      makeModel('alpha'),
      makeModel('beta', { installed: true, installedPath: '/models/beta.gguf' }),
    ];
    renderPanel({ hasSearched: true, models });

    expect(screen.getAllByText('安装')).toHaveLength(2);
  });

  test('does not render persistent next-step actions for installed models', () => {
    renderPanel({
      hasSearched: true,
      models: [makeModel('beta', { installed: true, installedPath: '/models/beta.gguf' })],
    });

    expect(screen.queryByText('已安装，下一步')).not.toBeInTheDocument();
    expect(screen.queryByText('立即运行')).not.toBeInTheDocument();
  });

  test('renders a card grid skeleton while loading, not a centered spinner', () => {
    const { container } = renderPanel({ hasSearched: true, marketplaceLoading: true });

    // The skeleton mirrors the grid: several card-shaped placeholders.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
    // The old centered spinner fallback must be gone.
    expect(screen.queryByText('加载中')).not.toBeInTheDocument();
  });

  test('keeps existing model cards visible while changing pages', () => {
    const { container } = renderPanel({
      hasSearched: true,
      marketplaceLoading: true,
      models: [makeModel('alpha')],
    });

    expect(container.querySelectorAll('[data-marketplace-model-card="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });
  test('clicking next page fetches the next cloud page', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const models = Array.from({ length: MARKETPLACE_PAGE_SIZE }, (_, index) =>
      makeModel('model-' + index),
    );
    renderPanel({
      hasSearched: true,
      models,
      totalCount: MARKETPLACE_PAGE_SIZE * 2,
      hasNextPage: true,
      onSearch,
    });

    expect(screen.getByText(/1\s*\/\s*2/)).toBeInTheDocument();
    const nextButton = screen.getByRole('button', {
      name: /next|\u4e0b\u4e00\u9875|\u4e0b\u4e00\u9875/,
    });
    expect(nextButton).toBeEnabled();

    await user.click(nextButton);
    expect(screen.getByText(/2\s*\/\s*2/)).toBeInTheDocument();
    expect(lastSearchCall(onSearch)).toEqual(
      expect.objectContaining({
        pageNumber: 2,
        limit: MARKETPLACE_PAGE_SIZE,
      }),
    );
  });
});

describe('MarketplacePanel search and filters', () => {
  test('submitting a query triggers a search from page 1', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    // The panel owns the draft query state, so no controlled wrapper is needed.
    renderPanel({ hasSearched: true, onSearch });

    await user.type(screen.getByPlaceholderText('搜索模型，如 qwen3、deepseek-r1...'), 'qwen3');
    await user.click(screen.getByRole('button', { name: '搜索' }));

    expect(lastSearchCall(onSearch)).toEqual(expect.objectContaining({ query: 'qwen3' }));
  });

  test('empty state clear button resets to featured recommendations', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const onQueryChange = vi.fn();
    renderPanel({ hasSearched: true, models: [], onSearch, onQueryChange });

    await user.click(screen.getByRole('button', { name: '清除筛选' }));

    expect(onQueryChange).toHaveBeenCalledWith('');
    expect(lastSearchCall(onSearch)).toEqual(
      expect.objectContaining({ query: '', featuredOnly: false }),
    );
  });

  test('all models show the device fit selector', () => {
    renderPanel({ hasSearched: true, models: [makeModel('alpha')] });

    expect(screen.getByRole('combobox', { name: '\u8bbe\u5907\u9002\u914d' })).toBeInTheDocument();
  });

  test('unselected task tabs provide a hover indicator and stronger text', () => {
    renderPanel({ hasSearched: true, models: [makeModel('alpha')] });

    const chatTab = screen.getByRole('tab', { name: '\u5bf9\u8bdd' });
    expect(screen.getByRole('tablist', { name: '\u4efb\u52a1\u7c7b\u578b' })).toHaveClass(
      'border',
      'border-border-subtle',
    );
    expect(chatTab).toHaveClass('theme-fluid-tab', 'hover:opacity-100');
    expect(chatTab.querySelector('[data-fluid-tabs-hover-indicator="true"]')).toHaveClass(
      'theme-fluid-hover-indicator',
    );
  });

  test('switching the fit filter to "不限" re-searches the whole catalogue', async () => {
    // The reported regression: choosing the unrestricted fit ("不限") stayed on
    // the curated featured list (7 models, one page) instead of browsing the
    // full catalogue. "不限" must drop featuredOnly and list everything.
    const user = userEvent.setup();
    const onSearch = vi.fn();
    renderPanel({ hasSearched: true, models: [makeModel('alpha')], onSearch });

    const fitSelector = screen.getByRole('combobox', { name: '\u8bbe\u5907\u9002\u914d' });
    await user.click(fitSelector);
    await user.click(await screen.findByRole('option', { name: '\u53ef\u8fd0\u884c' }));
    await user.click(fitSelector);
    await user.click(await screen.findByRole('option', { name: '\u4e0d\u9650' }));

    expect(lastSearchCall(onSearch)).toEqual(
      expect.objectContaining({ fit: 'all', featuredOnly: false }),
    );
  });

  test('opens the device-fit selector below its trigger', async () => {
    const user = userEvent.setup();
    renderPanel({ hasSearched: true, models: [makeModel('alpha')] });

    await user.click(screen.getByRole('combobox', { name: '\u8bbe\u5907\u9002\u914d' }));

    expect(document.querySelector('[data-slot="select-content"]')).toHaveAttribute(
      'data-side',
      'bottom',
    );
  });

  test('all models keep the local fit filter available', () => {
    renderPanel({ hasSearched: true, models: [makeModel('alpha')] });

    expect(screen.getByRole('combobox', { name: '\u8bbe\u5907\u9002\u914d' })).toBeEnabled();
  });

  test('renders localized hardware summary with an integer-width separator', () => {
    const previousLanguage = i18nService.getLanguage();
    i18nService.setLanguage('en', { persist: false });

    try {
      const { container } = renderPanel({
        hasSearched: true,
        models: [makeModel('alpha')],
        hardwareSummaryReady: true,
        hardwareSummary: {
          totalVramMiB: 8192,
          freeVramMiB: 7000,
          gpuCount: 1,
          gpuNames: ['NVIDIA RTX 4060'],
          systemMemoryMiB: 65536,
          freeSystemMemoryMiB: 48000,
          isDualGpu: false,
        },
      });

      expect(screen.getByText('GPU: 1 · 8GB RTX 4060')).toBeInTheDocument();
      expect(screen.getByText('Memory: 64GB')).toBeInTheDocument();
      expect(container.querySelector('[data-slot="separator"]')).toHaveClass('w-px');
    } finally {
      i18nService.setLanguage(previousLanguage, { persist: false });
    }
  });

  test('hides the stale result count while a new search is loading', () => {
    // The reported flicker: while the skeleton is showing, the count still
    // displayed the previous page's 7 models, then the fresh result rendered.
    const models = [makeModel('alpha')];
    renderPanel({
      hasSearched: true,
      models,
      marketplaceLoading: true,
    });

    expect(screen.queryByText(/共 \d+ 个模型/)).not.toBeInTheDocument();
  });
});
