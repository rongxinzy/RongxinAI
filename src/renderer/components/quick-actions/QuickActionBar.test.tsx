// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';

import type { LocalizedQuickAction } from '../../types/quickAction';
import QuickActionBar from './QuickActionBar';

afterEach(cleanup);

const mockActions = [
  {
    id: 'pptx',
    label: '制作幻灯片',
    icon: 'Presentation',
    color: '#000000',
    skillMapping: 'presentation-studio',
    prompts: [],
  },
  {
    id: 'data-analysis',
    label: '分析数据',
    icon: 'ChartColumn',
    color: '#000000',
    skillMapping: 'data-analysis',
    prompts: [],
  },
  {
    id: 'web',
    label: '搭建网站',
    icon: 'Globe',
    color: '#000000',
    skillMapping: 'web-development',
    prompts: [],
  },
] satisfies LocalizedQuickAction[];

test('renders quick action buttons and calls onActionSelect', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();

  render(<QuickActionBar actions={mockActions} onActionSelect={onSelect} />);

  expect(screen.getByRole('button', { name: '制作幻灯片' })).toBeDefined();
  expect(screen.getByRole('button', { name: '分析数据' })).toBeDefined();
  expect(screen.getByRole('button', { name: '搭建网站' })).toBeDefined();

  await user.click(screen.getByRole('button', { name: '制作幻灯片' }));
  expect(onSelect).toHaveBeenCalledWith('pptx');
});

test('returns null when actions is empty', () => {
  const { container } = render(<QuickActionBar actions={[]} onActionSelect={vi.fn()} />);
  expect(container.firstChild).toBeNull();
});

test('opens the remaining actions from the suggestions menu', async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const actions = [...mockActions, { ...mockActions[0], id: 'docs', label: '撰写文档' }];
  render(<QuickActionBar actions={actions} onActionSelect={onSelect} />);
  expect(screen.getByRole('button', { name: '撰写文档' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '搭建网站' })).toBeNull();
  await user.click(screen.getByRole('button', { name: /更多建议|More suggestions/ }));
  await user.click(await screen.findByRole('menuitem', { name: '搭建网站' }));
  expect(onSelect).toHaveBeenCalledWith('web');
});
