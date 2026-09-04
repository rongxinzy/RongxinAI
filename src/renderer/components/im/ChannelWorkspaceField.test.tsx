// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import React from 'react';
import { describe, expect, test, vi } from 'vitest';
import type { Workspace } from '@shared/workspace';
import { ChannelWorkspaceField } from './ChannelWorkspaceField';

const workspaces: Workspace[] = [
  { id: 'ws-main', name: '主工作区', path: 'C:/main', isHidden: false, pinned: false, createdAt: 1, updatedAt: 1 },
  { id: 'ws-sandbox', name: '沙盒', path: 'C:/sandbox', isHidden: true, pinned: false, createdAt: 1, updatedAt: 1 },
  { id: 'ws-proj', name: '项目 A', path: 'C:/proj', isHidden: false, pinned: false, createdAt: 1, updatedAt: 1 },
];

function renderField(workspaceId: string, onChange = vi.fn()) {
  render(
    <ChannelWorkspaceField accountId="acc-1" workspaceId={workspaceId} workspaces={workspaces} onChange={onChange} />,
  );
  return onChange;
}

describe('ChannelWorkspaceField', () => {
  test('shows folder name instead of workspace id', () => {
    renderField('ws-proj');
    expect(screen.getByRole('combobox')).toHaveTextContent('项目 A');
    expect(screen.getByRole('combobox')).not.toHaveTextContent('ws-proj');
  });

  test('shows picked folder name', async () => {
    const user = userEvent.setup();
    function ControlledField() {
      const [currentId, setCurrentId] = React.useState('ws-main');
      return (
        <ChannelWorkspaceField
          accountId="acc-1"
          workspaceId={currentId}
          workspaces={workspaces}
          onChange={setCurrentId}
        />
      );
    }
    render(<ControlledField />);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByText('项目 A'));
    expect(screen.getByRole('combobox')).toHaveTextContent('项目 A');
    expect(screen.getByRole('combobox')).not.toHaveTextContent('ws-proj');
  });

  test('shows the name of a hidden workspace that is already selected', () => {
    renderField('ws-sandbox');
    expect(screen.getByRole('combobox')).toHaveTextContent('沙盒');
    expect(screen.getByRole('combobox')).not.toHaveTextContent('ws-sandbox');
  });

  test('does not offer hidden workspaces in the popup', async () => {
    const user = userEvent.setup();
    renderField('ws-main');
    await user.click(screen.getByRole('combobox'));
    expect(await screen.findByText('项目 A')).toBeInTheDocument();
    expect(screen.queryByText('沙盒')).toBeNull();
  });
});
