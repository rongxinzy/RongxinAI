// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, expect, test, vi } from 'vitest';

import type {
  MarketplaceModel,
  MarketplaceSearchParams,
} from '../../../../shared/marketplace';
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
    query: '',
    installedModelPathMap: new Map(),
    installProgress: {},
    hardwareSummary: undefined,
    hardwareSummaryReady: false,
    onOpenInstalled: vi.fn(),
    onQueryChange: vi.fn(),
    onSearch: vi.fn(),
    onInstall: vi.fn(),
    totalCount: undefined,
    nextPageNumber: undefined,
    contentViewportRef: { current: null },
    ...overrides,
  };
  return { ...render(<MarketplacePanel {...props} />), props };
}

const lastSearchCall = (onSearch: ReturnType<typeof vi.fn>) =>
  onSearch.mock.calls.at(-1)?.[0] as MarketplaceSearchParams;

describe('MarketplacePanel result grid and count consistency', () => {
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
    renderPanel({ hasSearched: true, models, totalCount: 3 });

    // Count must equal the rendered cards — never the raw server total.
    expect(screen.getByText('共 3 个结果')).toBeInTheDocument();
    expect(screen.getAllByText('安装')).toHaveLength(3);
  });

  test('shows the server total so the count stays consistent with pagination', () => {
    // Pagination spans ceil(total/pageSize) pages, so the count must be the
    // server total, not the current page's card count — otherwise "共 2 个
    // 结果" would sit next to "第 1 / 1403 页".
    const models = [makeModel('alpha'), makeModel('beta')];
    renderPanel({ hasSearched: true, models, totalCount: 7 });

    expect(screen.getByText('共 7 个结果')).toBeInTheDocument();
    expect(screen.getAllByText('安装')).toHaveLength(2);
  });

  test('empty grid shows empty state without a misleading server total', () => {
    // Regression: server reported 7 matches but every model was filtered out
    // (installed/unsupported). The panel must not print "共 7 个结果" over an
    // empty grid — it should show the empty state instead.
    renderPanel({ hasSearched: true, models: [], totalCount: 7 });

    expect(screen.queryByText(/共 7 个结果/)).not.toBeInTheDocument();
    expect(screen.getByText('没有找到匹配的模型')).toBeInTheDocument();
  });

  test('installed models are excluded from the grid while the total stays intact', () => {
    const models = [
      makeModel('alpha'),
      makeModel('beta', { installed: true, installedPath: '/models/beta.gguf' }),
    ];
    renderPanel({ hasSearched: true, models, totalCount: 2 });

    // The server reported 2 matches; one is installed, so only one card shows.
    expect(screen.getByText('共 2 个结果')).toBeInTheDocument();
    expect(screen.getAllByText('安装')).toHaveLength(1);
  });

  test('renders a card grid skeleton while loading, not a centered spinner', () => {
    const { container } = renderPanel({ hasSearched: true, marketplaceLoading: true });

    // The skeleton mirrors the grid: several card-shaped placeholders.
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(3);
    // The old centered spinner fallback must be gone.
    expect(screen.queryByText('加载中')).not.toBeInTheDocument();
  });

  test('skips server pages that yield no installable cards', () => {
    const onSearch = vi.fn();
    renderPanel({
      hasSearched: true,
      models: [],
      totalCount: 24,
      nextPageNumber: 2,
      onSearch,
    });

    expect(lastSearchCall(onSearch)).toEqual(expect.objectContaining({ pageNumber: 2 }));
  });

  test('pagination shows page summary and fetches the next page', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    renderPanel({
      hasSearched: true,
      models: [makeModel('alpha')],
      totalCount: 24,
      onSearch,
    });

    // pageSize is 8, so 24 models span 3 pages.
    expect(screen.getByText('第 1 / 3 页')).toBeInTheDocument();

    const nextButton = screen.getByRole('button', { name: '下一页' });
    expect(nextButton).toBeEnabled();
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled();

    await user.click(nextButton);
    expect(lastSearchCall(onSearch)).toEqual(expect.objectContaining({ pageNumber: 2 }));
  });
});

describe('MarketplacePanel search and filters', () => {
  test('submitting a query triggers a search from page 1', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    // A controlled wrapper so typing actually updates the query prop.
    const ControlledPanel = () => {
      const [query, setQuery] = React.useState('');
      return (
        <MarketplacePanel
          loading={false}
          models={[]}
          hasSearched
          marketplaceLoading={false}
          marketplaceError={null}
          query={query}
          installedModelPathMap={new Map()}
          installProgress={{}}
          hardwareSummaryReady={false}
          onOpenInstalled={vi.fn()}
          onQueryChange={setQuery}
          onSearch={onSearch}
          onInstall={vi.fn()}
          contentViewportRef={{ current: null }}
        />
      );
    };
    render(<ControlledPanel />);

    await user.type(screen.getByPlaceholderText('搜索模型，如 qwen3、deepseek-r1...'), 'qwen3');
    await user.click(screen.getByRole('button', { name: '搜索' }));

    expect(lastSearchCall(onSearch)).toEqual(
      expect.objectContaining({ query: 'qwen3', pageNumber: 1 }),
    );
  });

  test('empty state clear button resets to featured recommendations', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    const onQueryChange = vi.fn();
    renderPanel({ hasSearched: true, models: [], onSearch, onQueryChange });

    await user.click(screen.getByRole('button', { name: '清除筛选' }));

    expect(onQueryChange).toHaveBeenCalledWith('');
    expect(lastSearchCall(onSearch)).toEqual(
      expect.objectContaining({ query: '', featuredOnly: true }),
    );
  });

  test('empty state offers an unrestricted view instead of a dead end', async () => {
    // When "可运行" yields no cards, the empty state must offer browsing the
    // whole catalogue rather than leaving the user stuck.
    const user = userEvent.setup();
    const onSearch = vi.fn();
    renderPanel({ hasSearched: true, models: [], onSearch });

    await user.click(screen.getByRole('button', { name: /不限适配/ }));

    expect(lastSearchCall(onSearch)).toEqual(
      expect.objectContaining({ fit: 'all', featuredOnly: false }),
    );
  });

  test('switching the fit filter to "不限" re-searches the whole catalogue', async () => {
    // The reported regression: choosing the unrestricted fit ("不限") stayed on
    // the curated featured list (7 models, one page) instead of browsing the
    // full catalogue. "不限" must drop featuredOnly and list everything.
    const user = userEvent.setup();
    const onSearch = vi.fn();
    renderPanel({ hasSearched: true, models: [makeModel('alpha')], onSearch });

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: '不限' }));

    expect(lastSearchCall(onSearch)).toEqual(
      expect.objectContaining({ fit: 'all', featuredOnly: false }),
    );
  });

  test('hides the stale result count while a new search is loading', () => {
    // The reported flicker: while the skeleton is showing, the count still
    // displayed the previous page's 7 models, then the fresh result rendered.
    const models = [makeModel('alpha')];
    renderPanel({
      hasSearched: true,
      models,
      totalCount: 11222,
      marketplaceLoading: true,
    });

    expect(screen.queryByText(/共 \d+ 个结果/)).not.toBeInTheDocument();
  });
});
