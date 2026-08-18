// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import type { MarketplaceModel } from '../../../../shared/marketplace';
import { MarketplaceDownloadSidebar } from './MarketplaceDownloadSidebar';

function makeModel(): MarketplaceModel {
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
    files: [
      {
        path: 'model-Q4_K_M.gguf',
        isRecommended: true,
        quantization: 'Q4_K_M',
        sizeBytes: 1024,
      },
    ],
    filePath: 'model-Q4_K_M.gguf',
  };
}

describe('MarketplaceDownloadSidebar', () => {
  test('shows pulling while waiting for the first main-process progress event', () => {
    render(
      <MarketplaceDownloadSidebar
        visible
        model={makeModel()}
        onClose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('拉取中')).toBeInTheDocument();
    expect(screen.queryByText('准备下载')).not.toBeInTheDocument();
  });

  test('shows the active download stage and lets the user cancel the active model', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <MarketplaceDownloadSidebar
        visible
        model={makeModel()}
        progress={{
          phase: 'downloading-progress',
          completed: 512,
          total: 1024,
          percent: 50,
          speed: 256,
        }}
        onClose={vi.fn()}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText('下载模型')).toBeInTheDocument();
    expect(screen.getByText('校验完整性')).toBeInTheDocument();
    expect(screen.getByText('准备就绪')).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '取消安装' }));

    expect(onCancel).toHaveBeenCalledWith('acme/alpha-GGUF');
  });

  test('marks every stage complete after the download has finished', () => {
    render(
      <MarketplaceDownloadSidebar
        visible
        model={makeModel()}
        progress={{ phase: 'done', percent: 100 }}
        onClose={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('校验完成')).toBeInTheDocument();
    expect(screen.getByText('已安装')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取消安装' })).not.toBeInTheDocument();
  });
});
