// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';

import Toast from './Toast';

afterEach(cleanup);

test('renders the message with the neutral info icon and no backing disc', () => {
  const { container } = render(<Toast message="无法获取模型列表" />);

  expect(screen.getByText('无法获取模型列表')).toBeDefined();
  const icon = container.querySelector('.lucide-info');
  expect(icon).not.toBeNull();
  // 信息档不加底盘：Info 自带圆环，加底盘会变成同心双环。
  expect(container.querySelector('.bg-primary-muted')).toBeNull();
  expect(icon?.getAttribute('stroke-width')).toBe('2');
});

test('keeps the filled red disc for errors and the filled green disc for successes', () => {
  const error = render(<Toast message="操作失败" isError />);
  expect(error.container.querySelector('.lucide-x')).not.toBeNull();
  expect(error.container.querySelector('.bg-destructive')).not.toBeNull();
  cleanup();

  const success = render(<Toast message="已保存" isSuccess />);
  expect(success.container.querySelector('.lucide-check')).not.toBeNull();
  expect(success.container.querySelector('.bg-success')).not.toBeNull();
});
