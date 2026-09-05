// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

import PageHeader from './PageHeader';

vi.mock('../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('./window/WindowTitleBar', () => ({
  default: () => createElement('div', { 'data-testid': 'window-controls' }),
}));
beforeEach(() => {
  window.electron = { platform: 'darwin' } as typeof window.electron;
});

test('preserves custom content state and shell callbacks when navigation visibility changes', async () => {
  const user = userEvent.setup();
  const onToggleSidebar = vi.fn();
  const onNewChat = vi.fn();
  function Draft() {
    const [value, setValue] = useState('');
    return createElement('input', {
      'aria-label': 'workspace name',
      value,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => setValue(event.target.value),
    });
  }
  const props = {
    title: 'Task',
    leftContent: createElement(Draft),
    onToggleSidebar,
    onNewChat,
    updateBadge: createElement('span', null, 'Update'),
  };
  const view = render(createElement(PageHeader, { ...props, isSidebarCollapsed: false }));
  await user.type(screen.getByRole('textbox'), 'Keep draft');
  view.rerender(createElement(PageHeader, { ...props, isSidebarCollapsed: true }));
  expect(screen.getByRole('textbox')).toHaveValue('Keep draft');
  await user.click(screen.getByRole('button', { name: 'expand' }));
  await user.click(screen.getByRole('button', { name: 'newChat' }));
  expect(onToggleSidebar).toHaveBeenCalledTimes(1);
  expect(onNewChat).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Update')).toBeTruthy();
  expect(screen.getAllByTestId('window-controls')).toHaveLength(1);
  view.rerender(createElement(PageHeader, { ...props, isSidebarCollapsed: false }));
  expect(screen.queryByRole('button', { name: 'expand' })).toBeNull();
  expect(screen.getByRole('textbox')).toHaveValue('Keep draft');
});
