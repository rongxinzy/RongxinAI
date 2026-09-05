// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { MarketplaceModel } from '../../../../shared/marketplace';
import { MarketplaceModelCard } from './MarketplaceModelCard';

function makeModel(overrides: Partial<MarketplaceModel> = {}): MarketplaceModel {
  return {
    source: 'modelscope-gguf',
    id: 'alpha',
    repoId: 'acme/alpha-GGUF',
    name: 'Alpha',
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

function renderCard(
  model: MarketplaceModel = makeModel(),
  overrides: Partial<Parameters<typeof MarketplaceModelCard>[0]> = {},
) {
  const props = {
    model,
    loading: false,
    isDownloadActive: false,
    onInstall: vi.fn(),
    onOpenDownload: vi.fn(),
    ...overrides,
  };
  return { ...render(<MarketplaceModelCard {...props} />), props };
}

describe('MarketplaceModelCard', () => {
  beforeEach(() => {
    (window as unknown as { electron?: unknown }).electron = {
      llamacpp: { cancelInstall: vi.fn() },
      shell: { openExternal: vi.fn().mockResolvedValue({ success: true }) },
    };
  });

  test.each([
    ['excellent', '推荐运行', 'text-success'],
    ['good', '适合运行', 'text-muted-foreground'],
    ['limited', '性能受限', 'text-warning'],
    ['unsupported', '暂不适配', 'text-destructive'],
    ['unknown', '待检测', 'text-muted-foreground'],
  ] as const)('renders the %s device-fit state with its visual treatment', (status, label, tone) => {
    renderCard(makeModel({ fit: { status } }));

    const statusLabel = screen.getByText(label);
    expect(statusLabel.parentElement).toHaveClass(tone);
  });
  test('renders the display name and an enabled install button for verified models', () => {
    renderCard(makeModel({ name: 'Alpha Model', repoId: 'acme/Alpha Model-GGUF' }));

    expect(screen.getByText('Alpha Model')).toBeInTheDocument();
    const installButton = screen.getByRole('button', { name: /安装/ });
    expect(installButton).toBeEnabled();
  });

  test('moves the ModelScope link to the model title', async () => {
    const user = userEvent.setup();
    const detailUrl = 'https://modelscope.cn/models/acme/Alpha-Model';
    renderCard(makeModel({ name: 'Alpha Model', repoId: 'acme/Alpha Model-GGUF', detailUrl }));

    const titleLink = screen.getByRole('link', { name: 'Alpha Model' });
    expect(titleLink).toHaveAttribute('href', detailUrl);
    expect(screen.queryByRole('button', { name: /魔搭链接/ })).not.toBeInTheDocument();

    await user.click(titleLink);
    expect(
      (window as unknown as { electron: { shell: { openExternal: ReturnType<typeof vi.fn> } } })
        .electron.shell.openExternal,
    ).toHaveBeenCalledWith(detailUrl);
  });

  test('pending models offer verify-and-install instead of a dead button', async () => {
    // Listing-only catalogue records carry no file metadata yet; the button
    // stays actionable so the install flow can hydrate the model on demand.
    const user = userEvent.setup();
    const onInstall = vi.fn();
    const model = makeModel({ metadataStatus: 'pending', files: [] });

    renderCard(model, { onInstall });

    const verifyButton = screen.getByRole('button', { name: /校验并安装|Verify & install/ });
    expect(verifyButton).toBeEnabled();

    await user.click(verifyButton);
    expect(onInstall).toHaveBeenCalledWith(expect.objectContaining({ repoId: model.repoId }));
  });
  test('opens the download sidebar from an active download card', async () => {
    const user = userEvent.setup();
    const onOpenDownload = vi.fn();
    renderCard(makeModel(), { isDownloadActive: true, onOpenDownload });

    await user.click(screen.getByRole('button', { name: /下载中|Downloading/ }));

    expect(onOpenDownload).toHaveBeenCalledOnce();
    expect(screen.queryByText('42%')).not.toBeInTheDocument();
  });

  test('offers a quantization selector when a repo ships multiple GGUF files', async () => {
    // unsloth-style repos bundle several quantizations of one model as files
    // under a single repo; the card must let the user pick which one installs.
    const user = userEvent.setup();
    const onInstall = vi.fn();
    const model = makeModel({
      filePath: 'model-Q4_K_M.gguf',
      files: [
        {
          path: 'model-Q4_K_M.gguf',
          quantization: 'Q4_K_M',
          sizeBytes: 4_683_073_248,
          isRecommended: true,
          downloadUrl: 'https://example.com/q4.gguf',
          sha256: 'b'.repeat(64),
        },
        {
          path: 'model-Q5_K_M.gguf',
          quantization: 'Q5_K_M',
          sizeBytes: 5_444_830_944,
          downloadUrl: 'https://example.com/q5.gguf',
          sha256: 'c'.repeat(64),
        },
      ],
    });
    renderCard(model, { onInstall });

    // The selector shows the recommended file first.
    expect(screen.getByRole('combobox', { name: '选择量化版本' })).toHaveTextContent('Q4_K_M');

    await user.click(screen.getByRole('combobox', { name: '选择量化版本' }));
    await user.click(await screen.findByRole('option', { name: /Q5_K_M/ }));

    await user.click(screen.getByRole('button', { name: /安装/ }));
    expect(onInstall).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'model-Q5_K_M.gguf' }),
    );
  });

  test('shows the quantization selector for single-file repos', () => {
    renderCard(makeModel());
    const selector = screen.getByRole('combobox', { name: '选择量化版本' });
    expect(selector).toBeInTheDocument();
  });

  test('split-only repos are installable and install the first part', async () => {
    // QwQ-32B-style repo: a single quantization sharded across many parts.
    const user = userEvent.setup();
    const onInstall = vi.fn();
    const model = makeModel({
      filePath: 'qwq-32b-fp16-00001-of-00017.gguf',
      files: [
        {
          path: 'qwq-32b-fp16-00001-of-00017.gguf',
          sizeBytes: 3_900_000_000,
          isRecommended: true,
          downloadUrl: 'https://example.com/p1.gguf',
          sha256: 'd'.repeat(64),
        },
        {
          path: 'qwq-32b-fp16-00002-of-00017.gguf',
          sizeBytes: 3_900_000_000,
          downloadUrl: 'https://example.com/p2.gguf',
          sha256: 'e'.repeat(64),
        },
      ],
    });
    renderCard(model, { onInstall });

    // A single split variant has nothing to choose, but it must be installable
    // (previously such repos were dropped entirely as "pending").
    const selector = screen.getByRole('combobox', { name: '选择量化版本' });
    expect(selector).toBeInTheDocument();
    const installButton = screen.getByRole('button', { name: /安装/ });
    expect(installButton).toBeEnabled();

    await user.click(installButton);
    expect(onInstall).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: 'qwq-32b-fp16-00001-of-00017.gguf' }),
    );
  });
});
