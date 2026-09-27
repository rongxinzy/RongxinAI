// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { LocalizedQuickAction } from '../../types/quickAction';
import PromptPanel from './PromptPanel';

const hoisted = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock('react-redux', () => ({
  useSelector: (selector: (state: unknown) => unknown) =>
    selector({ quickAction: { selectedPromptId: null } }),
  useDispatch: () => hoisted.dispatch,
}));

const action: LocalizedQuickAction = {
  id: 'deep-research',
  label: '深度调研',
  icon: 'Telescope',
  color: '#3b82f6',
  skillMapping: 'deep-research',
  prompts: [
    { id: 'case-a', label: '案例甲', description: '甲的描述', prompt: 'prompt-a' },
    { id: 'case-b', label: '案例乙', prompt: 'prompt-b' },
  ],
};

beforeEach(() => {
  hoisted.dispatch.mockClear();
});

describe('PromptPanel', () => {
  test('renders the case cards of the selected category', () => {
    render(<PromptPanel action={action} onPromptSelect={vi.fn()} />);

    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('案例甲')).toBeInTheDocument();
  });

  /**
   * The category bar button already carries the category name, so repeating it as a
   * heading over the grid is noise. The panel must go straight to the cases.
   */
  test('does not repeat the category name above the grid', () => {
    render(<PromptPanel action={action} onPromptSelect={vi.fn()} />);

    expect(screen.queryByText(action.label)).not.toBeInTheDocument();
  });

  /**
   * 案例面板与上方输入框同宽（max-w-3xl），四列网格才能和输入框对齐；
   * 分类条留在更宽的列里，不受这个宽度约束。
   */
  test('matches the composer width so the grid lines up with the input', () => {
    const { container } = render(<PromptPanel action={action} onPromptSelect={vi.fn()} />);

    expect(container.firstChild).toHaveClass('mx-auto', 'w-full', 'max-w-3xl');
  });
});
