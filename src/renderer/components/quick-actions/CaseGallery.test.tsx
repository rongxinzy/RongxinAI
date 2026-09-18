// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { LocalizedPrompt } from '../../types/quickAction';
import CaseGallery from './CaseGallery';

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

  test('keeps the tiles dense enough to shrink the gallery to four columns', () => {
    const { container } = render(<CaseGallery prompts={prompts} onPromptSelect={vi.fn()} />);
    const grid = container.querySelector('.grid');

    expect(grid).toHaveClass('grid-cols-2');
    expect(grid).toHaveClass('sm:grid-cols-3');
    expect(grid).toHaveClass('lg:grid-cols-4');
  });

  test('keeps every caption to one line so the rows stay even', () => {
    render(<CaseGallery prompts={prompts} onPromptSelect={vi.fn()} />);
    const label = screen.getByText('案例甲');
    const description = screen.getByText('甲的描述');

    expect(label).toHaveClass('truncate');
    expect(description).toHaveClass('line-clamp-1');
  });

  test('omits the description row when a case has none', () => {
    render(<CaseGallery prompts={[prompts[1]]} onPromptSelect={vi.fn()} />);

    expect(screen.queryByText('甲的描述')).not.toBeInTheDocument();
    expect(screen.queryByText('乙的描述')).not.toBeInTheDocument();
  });

  test('selects a case and reports its prompt text', () => {
    const onPromptSelect = vi.fn();
    render(<CaseGallery prompts={prompts} onPromptSelect={onPromptSelect} />);
    fireEvent.click(screen.getByText('案例甲'));

    expect(onPromptSelect).toHaveBeenCalledWith('prompt-a');
    expect(hoisted.dispatch).toHaveBeenCalledWith(expect.objectContaining({ payload: 'case-a' }));
  });

  test('marks the persisted selection as pressed', () => {
    hoisted.selectedPromptId = 'case-c';
    render(<CaseGallery prompts={prompts} onPromptSelect={vi.fn()} />);

    expect(screen.getByText('案例丙').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('案例甲').closest('button')).toHaveAttribute('aria-pressed', 'false');
  });
});
