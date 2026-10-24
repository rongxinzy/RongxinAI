// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { FluidTabs } from './fluid-tabs';

afterEach(cleanup);
test('disabled segmented tabs cannot change a request being admitted', () => {
  const change = vi.fn();
  const props = {
    'aria-label': 'Intent',
    value: 'chat',
    disabled: true,
    onValueChange: change,
    items: [
      { value: 'chat', label: 'Chat' },
      { value: 'task', label: 'Task' },
    ],
  };
  const view = render(createElement(FluidTabs, props));
  expect(view.getByRole('tab', { name: 'Task' }).getAttribute('aria-disabled')).toBe('true');
  fireEvent.click(view.getByRole('tab', { name: 'Task' }));
  expect(change).not.toHaveBeenCalled();
  view.rerender(createElement(FluidTabs, { ...props, disabled: false }));
  fireEvent.click(view.getByRole('tab', { name: 'Task' }));
  expect(change).toHaveBeenCalledWith('task');
});
