// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { LocalizedPrompt } from '../../types/quickAction';
import CaseGallery from './CaseGallery';

vi.mock('../../services/i18n', () => ({
  i18nService: {
    t: (key: string) => key,
    getLanguage: () => 'zh',
    subscribe: () => () => {},
  },
}));
vi.mock('./casePreviewSources', () => ({ loadCasePreview: async () => null }));

const hoisted = vi.hoisted(() => ({
  selectedPromptId: null as string | null,
  dispatch: vi.fn(),
}));

vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ quickAction: { selectedPromptId: hoisted.selectedPromptId } }),
  useDispatch: () => hoisted.dispatch,
}));

const prompts: LocalizedPrompt[] = [
  { id: 'case-a', label: '案例甲', description: '甲的描述', prompt: 'prompt-a' },
  { id: 'case-b', label: '案例乙', prompt: 'prompt-b', preview: './case-previews/case-b.webp' },
  { id: 'case-c', label: '案例丙', prompt: 'prompt-c', preview: './case-previews/case-c.webp' },
];

beforeEach(() => {
  hoisted.selectedPromptId = null;
  hoisted.dispatch.mockClear();
});

describe('CaseGallery', () => {
  test('renders one card per case', () => {
    render(<CaseGallery prompts={prompts} onPromptSelect={vi.fn()} />);

    expect(screen.getByText('案例甲')).toBeInTheDocument();
    expect(screen.getByText('案例乙')).toBeInTheDocument();
    expect(screen.getByText('案例丙')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  test('renders a preview image only for cases that declare one', () => {
    const { container } = render(<CaseGallery prompts={prompts} onPromptSelect={vi.fn()} />);
    const images = container.querySelectorAll('img');

    expect(images).toHaveLength(2);
    expect(images[0]).toHaveAttribute('src', './case-previews/case-b.webp');
  });

  test('reserves the thumbnail slot at the preview aspect ratio', () => {
    const { container } = render(<CaseGallery prompts={prompts} onPromptSelect={vi.fn()} />);
    const media = container.querySelector('.theme-page-case-gallery-media');
    const image = media?.querySelector('img');

    expect(media).toHaveClass('aspect-[8/5]');
    expect(image).toHaveAttribute('loading', 'lazy');
  });

  test('keeps the gallery aligned with the four-column prompt width', () => {
    const { container } = render(<CaseGallery prompts={prompts} onPromptSelect={vi.fn()} />);
    const grid = container.querySelector('.grid');

    expect(grid).toHaveClass('grid-cols-1');
    expect(grid).toHaveClass('sm:grid-cols-2');
    expect(grid).toHaveClass('md:grid-cols-3');
    expect(grid).toHaveClass('lg:grid-cols-4');
  });

  test('keeps every caption to one line so the rows stay even', () => {
    render(<CaseGallery prompts={prompts} onPromptSelect={vi.fn()} />);
    const label = screen.getByText('案例甲');

    expect(label).toHaveClass('truncate');
    expect(screen.queryByText('甲的描述')).not.toBeInTheDocument();
    expect(label.closest('button')).toHaveAttribute('title', '甲的描述');
  });

  test('announces each tile as a dialog trigger', () => {
    render(<CaseGallery prompts={prompts} onPromptSelect={vi.fn()} />);

    expect(screen.getByText('案例甲').closest('button')).toHaveAttribute('aria-haspopup', 'dialog');
  });

  test('falls back to the label when a case has no description', () => {
    render(<CaseGallery prompts={[prompts[1]]} onPromptSelect={vi.fn()} />);

    expect(screen.getByText('案例乙').closest('button')).toHaveAttribute('title', '案例乙');
  });

  test('previews without changing the draft, then applies only on explicit use', async () => {
    const onPromptSelect = vi.fn();
    render(<CaseGallery prompts={prompts} onPromptSelect={onPromptSelect} />);
    fireEvent.click(screen.getByText('案例甲'));

    expect(onPromptSelect).not.toHaveBeenCalled();
    expect(hoisted.dispatch).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /caseUseExample/ }));

    await waitFor(() => expect(onPromptSelect).toHaveBeenCalledWith('prompt-a'));
    expect(onPromptSelect).toHaveBeenCalledTimes(1);
    expect(hoisted.dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: 'case-a' }));
  });

  test('closing the preview keeps the applied case and the draft untouched', () => {
    const onPromptSelect = vi.fn();
    render(<CaseGallery prompts={prompts} onPromptSelect={onPromptSelect} />);
    fireEvent.click(screen.getByText('案例甲'));
    fireEvent.click(screen.getByRole('button', { name: 'close' }));

    expect(onPromptSelect).not.toHaveBeenCalled();
    expect(hoisted.dispatch).not.toHaveBeenCalled();
    expect(screen.getByText('案例甲').closest('button')).not.toHaveAttribute('data-selected');
  });

  /**
   * 卡片是对话框触发器，选中态不能再走 aria-pressed（读屏会当成开关按钮）：
   * data-selected 供主题 recipe 描边，aria-current 供读屏播报。
   */
  test('marks the persisted selection as current', () => {
    hoisted.selectedPromptId = 'case-c';
    render(<CaseGallery prompts={prompts} onPromptSelect={vi.fn()} />);

    const selectedCase = screen.getByText('案例丙').closest('button');
    expect(selectedCase).toHaveAttribute('data-selected', 'true');
    expect(selectedCase).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('案例甲').closest('button')).not.toHaveAttribute('aria-current');
  });
});
