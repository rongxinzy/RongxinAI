// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import QuickActionBar from './QuickActionBar';

afterEach(cleanup);

const mockActions = [
  {
    id: 'slides',
    label: '制作幻灯片',
    icon: 'Presentation',
    color: '#000000',
    skillMapping: 'slides',
    prompts: [],
  },
  {
    id: 'data',
    label: '分析数据',
    icon: 'ChartColumn',
    color: '#000000',
    skillMapping: 'data',
    prompts: [],
  },
  {
    id: 'web',
    label: '搭建网站',
    icon: 'Globe',
    color: '#000000',
    skillMapping: 'web',
    prompts: [],
  },
];

test('renders quick action buttons and calls onActionSelect', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();

  render(<QuickActionBar actions={mockActions} onActionSelect={onSelect} />);

  expect(screen.getByRole('button', { name: '制作幻灯片' })).toBeDefined();
  expect(screen.getByRole('button', { name: '分析数据' })).toBeDefined();
  expect(screen.getByRole('button', { name: '搭建网站' })).toBeDefined();

  await user.click(screen.getByRole('button', { name: '制作幻灯片' }));
  expect(onSelect).toHaveBeenCalledWith('slides');
});

test('returns null when actions is empty', () => {
  const { container } = render(<QuickActionBar actions={[]} onActionSelect={vi.fn()} />);
  expect(container.firstChild).toBeNull();
});

test('applies single-line desktop centering flex layout classes', () => {
  const { container } = render(<QuickActionBar actions={mockActions} onActionSelect={vi.fn()} />);
  const gridContainer = container.querySelector('.grid');
  expect(gridContainer).not.toBeNull();
  expect(gridContainer?.className).toContain('xl:flex');
  expect(gridContainer?.className).toContain('xl:items-center');
  expect(gridContainer?.className).toContain('xl:justify-center');
  expect(gridContainer?.className).not.toContain('@4xl');
});
