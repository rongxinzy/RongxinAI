// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import {
  CodingLaneStatus,
  type CodingRoomSnapshot,
  type CodingWorkspaceSummary,
} from '../../../shared/codingAgent';
import { CodingWorkspaceSidebar, type CodingSidebarSelection } from './CodingWorkspaceSidebar';

vi.mock('../../services/i18n', () => ({ i18nService: { t: (key: string) => key } }));
vi.mock('./CodingWorkspaceDialog', () => ({ CodingWorkspaceDialog: () => null }));
const motionSettings = vi.hoisted(() => ({ reduced: true }));
const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron');
vi.mock('motion/react', async importOriginal => {
  const original = await importOriginal<typeof import('motion/react')>();
  return { ...original, useReducedMotion: () => motionSettings.reduced };
});
afterEach(() => {
  motionSettings.reduced = true;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalElectron) Object.defineProperty(window, 'electron', originalElectron);
  else Reflect.deleteProperty(window, 'electron');
});

function workspace(id: string): CodingWorkspaceSummary {
  return {
    id,
    name: id,
    primaryRoot: `/projects/${id}`,
    defaultProfileId: '',
    sources: [],
    activeSessionId: `${id}-session`,
    sessions: [
      {
        id: `${id}-session`,
        workspaceId: id,
        missionId: `${id}-mission`,
        parentSessionId: null,
        title: `${id} session`,
        profileId: '',
        sourceRoot: `/projects/${id}`,
        status: CodingLaneStatus.Completed,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  };
}

function setup() {
  const workspaces = [workspace('SwarmMind'), workspace('WorkspaceBeta')];
  const listWorkspaces = vi.fn(async () => ({ success: true, workspaces }));
  let notify: () => void = () => undefined;
  const onChanged = vi.fn((callback: (snapshot: CodingRoomSnapshot) => void) => {
    notify = () =>
      callback({
        room: {
          id: 'room',
          name: 'room',
          workspaceRoot: '/projects/SwarmMind',
          defaultProfileId: '',
          activeMissionId: null,
          activeLaneId: null,
        },
        profiles: [],
        missions: [],
        lanes: [],
        assignments: [],
        events: [],
        elicitations: [],
      });
    return () => undefined;
  });
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      codingAgent: {
        listWorkspaces,
        listProfiles: async () => ({ success: true, profiles: [] }),
        onChanged,
      },
    },
  });
  const onSelectionChange = vi.fn();
  const Harness = () => {
    const [selection, setSelection] = useState<CodingSidebarSelection>({
      workspaceId: 'SwarmMind',
      workspaceRoot: '/projects/SwarmMind',
      laneId: 'SwarmMind-session',
      draft: null,
    });
    return createElement(CodingWorkspaceSidebar, {
      selection,
      onSelectionChange: next => {
        onSelectionChange(next);
        setSelection(next);
      },
    });
  };
  const view = render(createElement(Harness));
  return { ...view, onSelectionChange, listWorkspaces, refresh: () => notify() };
}

test('collapsing a workspace does not switch away from the selected session', async () => {
  const { onSelectionChange } = setup();
  const folder = await screen.findByRole('treeitem', { name: 'WorkspaceBeta' });
  fireEvent.click(folder);
  expect(folder).toHaveAttribute('aria-expanded', 'false');
  expect(onSelectionChange).not.toHaveBeenCalled();
  expect(screen.getByRole('treeitem', { name: 'SwarmMind session' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('all folders stay collapsed when workspace data refreshes', async () => {
  const { listWorkspaces, refresh } = setup();
  const swarm = await screen.findByRole('treeitem', { name: 'SwarmMind' });
  const beta = screen.getByRole('treeitem', { name: 'WorkspaceBeta' });
  fireEvent.click(swarm);
  fireEvent.click(beta);
  act(refresh);
  await vi.waitFor(() => expect(listWorkspaces.mock.calls.length).toBeGreaterThan(1));
  await act(async () => undefined);
  expect(screen.getByRole('treeitem', { name: 'SwarmMind' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  expect(screen.getByRole('treeitem', { name: 'WorkspaceBeta' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
});

test('reopening a folder reveals its sessions without switching the current session', async () => {
  const { onSelectionChange } = setup();
  const folder = await screen.findByRole('treeitem', { name: 'WorkspaceBeta' });
  fireEvent.click(folder);
  fireEvent.click(folder);
  expect(await screen.findByRole('treeitem', { name: 'WorkspaceBeta session' })).toBeVisible();
  expect(onSelectionChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('treeitem', { name: 'WorkspaceBeta session' }));
  expect(onSelectionChange).toHaveBeenLastCalledWith({
    workspaceId: 'WorkspaceBeta',
    workspaceRoot: '/projects/WorkspaceBeta',
    laneId: 'WorkspaceBeta-session',
    draft: null,
  });
});

test('rapid collapse and reopen cancels the pending removal of the session group', async () => {
  motionSettings.reduced = false;
  setup();
  const folder = await screen.findByRole('treeitem', { name: 'WorkspaceBeta' });
  fireEvent.click(folder);
  fireEvent.click(folder);
  await act(async () => new Promise(resolve => setTimeout(resolve, 250)));
  expect(folder).toHaveAttribute('aria-expanded', 'true');
  const session = screen.getByRole('treeitem', { name: 'WorkspaceBeta session' });
  expect(session.closest('[role="group"]')).toHaveAttribute('aria-hidden', 'false');
  expect(session.closest('.grid')).toHaveClass('opacity-100');
});

test('enabling reduced motion during a collapse completes the pending collapse', async () => {
  motionSettings.reduced = false;
  const { refresh } = setup();
  const folder = await screen.findByRole('treeitem', { name: 'WorkspaceBeta' });
  fireEvent.click(folder);
  motionSettings.reduced = true;
  act(refresh);
  await act(async () => undefined);
  await act(async () => new Promise(resolve => setTimeout(resolve, 250)));
  expect(screen.queryByText('WorkspaceBeta session')).toBeNull();
});

test('reopening a folder still completes when animation frames are suspended', async () => {
  motionSettings.reduced = false;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  setup();
  const folder = await screen.findByRole('treeitem', { name: 'WorkspaceBeta' });
  fireEvent.click(folder);
  await act(async () => new Promise(resolve => setTimeout(resolve, 250)));
  fireEvent.click(folder);
  await act(async () => new Promise(resolve => setTimeout(resolve, 100)));
  expect(screen.getByRole('treeitem', { name: 'WorkspaceBeta session' }).closest('.grid')).toHaveClass(
    'opacity-100',
  );
});

test('a pending refresh cannot change selection after the sidebar unmounts', async () => {
  const { listWorkspaces, refresh, unmount, onSelectionChange } = setup();
  await screen.findByRole('treeitem', { name: 'SwarmMind' });
  let complete: (value: Awaited<ReturnType<typeof listWorkspaces>>) => void = () => undefined;
  const pending = new Promise<Awaited<ReturnType<typeof listWorkspaces>>>(resolve => {
    complete = resolve;
  });
  listWorkspaces.mockImplementationOnce(() => pending);
  act(refresh);
  unmount();
  await act(async () => {
    complete({ success: true, workspaces: [] });
    await pending;
  });
  expect(onSelectionChange).not.toHaveBeenCalled();
});
vi.mock('@shared/components/ui/destructive-confirm-dialog', () => ({
  DestructiveConfirmDialog: ({ open, onConfirm }: { open: boolean; onConfirm: () => void }) =>
    open ? createElement('button', { onClick: onConfirm }, 'confirm-remove') : null,
}));

test('delayed deletion preserves a later workspace selection', async () => {
  const { onSelectionChange } = setup();
  await screen.findByRole('treeitem', { name: 'SwarmMind' });
  let finish: (value: { success: boolean; workspaces: CodingWorkspaceSummary[] }) => void = () =>
    undefined;
  const pending = new Promise<{ success: boolean; workspaces: CodingWorkspaceSummary[] }>(
    resolve => {
      finish = resolve;
    },
  );
  window.electron.codingAgent.deleteSession = vi.fn(() => pending);
  fireEvent.click(screen.getAllByRole('button', { name: 'codingSessionRemove' })[0]);
  fireEvent.click(screen.getByRole('button', { name: 'confirm-remove' }));
  fireEvent.click(screen.getByRole('treeitem', { name: 'WorkspaceBeta session' }));
  await act(async () => undefined);
  await act(async () => {
    finish({
      success: true,
      workspaces: [
        { ...workspace('SwarmMind'), sessions: [], activeSessionId: null },
        workspace('WorkspaceBeta'),
      ],
    });
    await pending;
  });
  expect(onSelectionChange).toHaveBeenLastCalledWith({
    workspaceId: 'WorkspaceBeta',
    workspaceRoot: '/projects/WorkspaceBeta',
    laneId: 'WorkspaceBeta-session',
    draft: null,
  });
});
