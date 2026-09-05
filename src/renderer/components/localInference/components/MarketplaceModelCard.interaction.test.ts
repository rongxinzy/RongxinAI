// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { MarketplaceCapability, type MarketplaceModel } from '../../../../shared/marketplace';
import { MarketplaceModelCard } from './MarketplaceModelCard';

const model: MarketplaceModel = {
  source: 'modelscope-gguf',
  id: 'qwen',
  repoId: 'Qwen/Qwen3-8B-GGUF',
  name: 'Qwen3-8B',
  description: '',
  tags: [],
  sizes: ['8B'],
  recommendedTag: 'Q4_K_M',
  capability: MarketplaceCapability.Chat,
  installed: false,
  metadataStatus: 'verified',
  fit: { status: 'excellent' },
  filePath: 'model-Q4_K_M.gguf',
  files: ['Q4_K_M', 'Q5_K_M'].map((quantization, index) => ({
    path: `model-${quantization}.gguf`,
    sizeBytes: (index + 1) * 1024 ** 3,
    sha256: 'a'.repeat(64),
    downloadUrl: 'https://example.com/model.gguf',
    isRecommended: index === 0,
    quantization,
  })),
};

afterEach(() => document.documentElement.classList.remove('dark'));

test('details open with the keyboard, retain metadata, and return focus on Escape', async () => {
  const user = userEvent.setup();
  render(
    createElement(MarketplaceModelCard, {
      model,
      loading: false,
      isDownloadActive: false,
      onInstall: vi.fn(),
      onOpenDownload: vi.fn(),
    }),
  );
  const trigger = screen.getByRole('button', { name: '详细信息' });
  trigger.focus();
  await user.keyboard('{Enter}');
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getByText(model.repoId)).toBeVisible();
  expect(within(dialog).getByText('Q4_K_M')).toBeVisible();
  expect(within(dialog).getByText('1.0 GB')).toBeVisible();
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
});

test('keeps selected variant across theme and loading updates and installs that file', async () => {
  const user = userEvent.setup();
  const onInstall = vi.fn();
  const props = {
    model,
    loading: false,
    isDownloadActive: false,
    onInstall,
    onOpenDownload: vi.fn(),
  };
  const { rerender } = render(createElement(MarketplaceModelCard, props));
  await user.click(screen.getByRole('combobox', { name: '选择量化版本' }));
  await user.click(await screen.findByRole('option', { name: /Q5_K_M/ }));
  document.documentElement.classList.add('dark');
  rerender(createElement(MarketplaceModelCard, { ...props, loading: true }));
  const install = screen.getByRole('button', { name: '安装' });
  expect(install).toBeDisabled();
  await user.click(install);
  expect(onInstall).not.toHaveBeenCalled();
  rerender(createElement(MarketplaceModelCard, props));
  expect(screen.getByRole('combobox')).toHaveTextContent('Q5_K_M');
  await user.click(screen.getByRole('button', { name: '安装' }));
  expect(onInstall).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ filePath: 'model-Q5_K_M.gguf' }),
  );
});

test('download details remain available while another operation is loading', async () => {
  const user = userEvent.setup();
  const onOpenDownload = vi.fn();
  const onInstall = vi.fn();
  render(
    createElement(MarketplaceModelCard, {
      model,
      loading: true,
      isDownloadActive: true,
      onInstall,
      onOpenDownload,
    }),
  );
  await user.click(screen.getByRole('button', { name: '下载中' }));
  expect(onOpenDownload).toHaveBeenCalledOnce();
  expect(onInstall).not.toHaveBeenCalled();
});
