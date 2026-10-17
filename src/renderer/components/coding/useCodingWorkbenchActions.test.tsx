// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, test, vi } from 'vitest';

import {
  CodingAgentDriverKind,
  CodingAgentProfileStatus,
  CodingLaneStatus,
  CodingPermissionOutcome,
  type CodingAgentConfigOption,
  type CodingAgentLane,
  type CodingAgentProfile,
  type CodingRoomSnapshot,
} from '../../../shared/codingAgent';
import type { CodingSessionDraft } from './CodingWorkspaceSidebar';
import {
  useCodingLaneActions,
  useCodingLanePreparation,
  useCodingProfileActions,
  useCodingPromptSubmit,
} from './useCodingWorkbenchActions';

const originalElectron = Object.getOwnPropertyDescriptor(window, 'electron');

interface ElectronMock {
  calls: { channel: string; input: unknown }[];
  results: Record<string, unknown>;
}

const buildLane = (overrides: Partial<CodingAgentLane> = {}): CodingAgentLane => ({
  id: 'lane-1',
  missionId: 'mission-1',
  profileId: 'profile-1',
  modelOverride: null,
  sourceRoot: '/w',
  executionRoot: '/w',
  configOptions: [],
  availableCommands: [],
  localSessionId: 'local-1',
  remoteSessionId: null,
  status: CodingLaneStatus.Idle,
  draft: '',
  scrollPosition: 0,
  pendingRecoveryPrompt: null,
  pendingRecoveryContext: null,
  ...overrides,
});

const buildSnapshot = (): CodingRoomSnapshot => ({
  room: {
    id: 'room-1',
    name: 'room',
    workspaceRoot: '/w',
    defaultProfileId: 'profile-1',
    activeMissionId: 'mission-1',
    activeLaneId: 'lane-1',
  },
  profiles: [],
  missions: [],
  lanes: [buildLane()],
  assignments: [],
  elicitations: [],
  events: [],
});

const buildProfile = (overrides: Partial<CodingAgentProfile> = {}): CodingAgentProfile => ({
  id: 'profile-1',
  name: 'profile',
  description: '',
  driverKind: CodingAgentDriverKind.Acp,
  status: CodingAgentProfileStatus.Ready,
  capabilities: {
    supportsLoadSession: false,
    supportsResumeSession: false,
    supportsPlans: false,
    supportsPermissions: true,
    supportsFilesystem: true,
    supportsTerminal: false,
    supportsConfigOptions: false,
    supportsUsage: false,
    supportsElicitation: false,
  },
  authMethods: [],
  command: null,
  args: [],
  environment: {},
  isBuiltin: false,
  ...overrides,
});

const draftSession: CodingSessionDraft = {
  id: 'draft-1',
  workspaceId: 'ws-1',
  sourceRoot: '/w/main',
  profileId: 'profile-2',
  modelOverride: null,
  sources: [{ id: 'source-1', workspaceId: 'ws-1', path: '/w/main', isPrimary: true }],
};

function mockElectron(mock: ElectronMock) {
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      codingAgent: new Proxy(
        {},
        {
          get: (_target, channel: string) => {
            return (input: unknown) => {
              mock.calls.push({ channel, input });
              const handler = mock.results[channel];
              if (typeof handler === 'function') return handler(input);
              return Promise.resolve(handler ?? { success: true });
            };
          },
        },
      ),
    },
  });
}

afterEach(() => {
  if (originalElectron) Object.defineProperty(window, 'electron', originalElectron);
  else Reflect.deleteProperty(window, 'electron');
});

const renderLaneActions = (
  overrides: {
    draftSession?: CodingSessionDraft | null;
    activeLane?: CodingAgentLane | null;
    results?: ElectronMock['results'];
    onSnapshot?: (snapshot: CodingRoomSnapshot | null) => void;
    onLaneSelected?: (laneId: string) => void;
    onPreview?: (preview: string | null) => void;
    onApplyConflict?: (conflict: string | null) => void;
  } = {},
) => {
  const mock: ElectronMock = { calls: [], results: overrides.results ?? {} };
  const laneActionState = {
    overrides: {} as Record<string, string>,
    options: [
      { id: 'think', name: 'Think', type: 'select', currentValue: 'off' },
    ] as CodingAgentConfigOption[],
  };
  mockElectron(mock);
  const view = renderHook(() =>
    useCodingLaneActions({
      workspaceRoot: '/w',
      activeLane: overrides.activeLane ?? buildLane(),
      activeElicitation: null,
      recoveryLane: null,
      draftSession: overrides.draftSession ?? null,
      setSnapshot: value => {
        const next = typeof value === 'function' ? value(null) : value;
        if (overrides.onSnapshot) overrides.onSnapshot(next);
      },
      setDraftConfigOptions: update => {
        laneActionState.options =
          typeof update === 'function'
            ? (update as (current: CodingAgentConfigOption[]) => CodingAgentConfigOption[])(
                laneActionState.options,
              )
            : (update as typeof laneActionState.options);
      },
      setDraftConfigOverrides: update => {
        Object.assign(
          laneActionState.overrides,
          typeof update === 'function' ? update(laneActionState.overrides) : update,
        );
      },
      setLaneChangePreview: value => {
        const next = typeof value === 'function' ? value(null) : value;
        overrides.onPreview?.(next);
      },
      setApplyConflict: value => {
        const next = typeof value === 'function' ? value(null) : value;
        overrides.onApplyConflict?.(next);
      },
      onLaneSelected: laneId => overrides.onLaneSelected?.(laneId),
    }),
  );
  return { laneActionState, mock, view };
};

test('prepares ACP lanes without a remote session on open', async () => {
  const mock: ElectronMock = {
    calls: [],
    results: { prepareLane: { success: true, snapshot: buildSnapshot() } },
  };
  mockElectron(mock);
  const { result } = renderHook(() => {
    const [snapshot, setSnapshot] = useState<CodingRoomSnapshot | null>(null);
    useCodingLanePreparation({
      workspaceRoot: '/w',
      activeLaneId: 'lane-1',
      activeRemoteSessionId: null,
      activeDriverKind: CodingAgentDriverKind.Acp,
      setSnapshot,
    });
    return snapshot;
  });

  await waitFor(() =>
    expect(mock.calls).toEqual([
      { channel: 'prepareLane', input: { workspaceRoot: '/w', laneId: 'lane-1' } },
    ]),
  );
  await waitFor(() => expect(result.current).toEqual(buildSnapshot()));
});

test('skips preparation when the ACP lane already has a remote session', () => {
  const mock: ElectronMock = { calls: [], results: {} };
  mockElectron(mock);
  renderHook(() =>
    useCodingLanePreparation({
      workspaceRoot: '/w',
      activeLaneId: 'lane-1',
      activeRemoteSessionId: 'remote-1',
      activeDriverKind: CodingAgentDriverKind.Acp,
      setSnapshot: () => undefined,
    }),
  );

  expect(mock.calls).toHaveLength(0);
});

test('re-projects config for built-in lanes on every open', async () => {
  const mock: ElectronMock = { calls: [], results: {} };
  mockElectron(mock);
  renderHook(() =>
    useCodingLanePreparation({
      workspaceRoot: '/w',
      activeLaneId: 'lane-1',
      activeRemoteSessionId: 'remote-1',
      activeDriverKind: CodingAgentDriverKind.Builtin,
      setSnapshot: () => undefined,
    }),
  );

  await waitFor(() => expect(mock.calls.map(call => call.channel)).toEqual(['prepareLane']));
});

test('discoverAgents reloads the queue for a running ACP lane', async () => {
  const load = vi.fn();
  const mock: ElectronMock = {
    calls: [],
    results: { discoverAgents: { success: true, snapshot: buildSnapshot() } },
  };
  mockElectron(mock);
  const { result } = renderHook(() =>
    useCodingProfileActions({
      workspaceRoot: '/w',
      activeLane: buildLane({ status: CodingLaneStatus.Running }),
      activeProfile: buildProfile({ driverKind: CodingAgentDriverKind.Acp }),
      codingQueue: { load } as never,
      setSnapshot: () => undefined,
      setManagerProfiles: () => undefined,
    }),
  );

  let ok = false;
  await act(async () => {
    ok = await result.current.discoverAgents();
  });
  expect(ok).toBe(true);
  expect(load).toHaveBeenCalledWith('lane-1');
});

test('changeConfigOption tracks overrides locally while the session is a draft', async () => {
  const { laneActionState, mock, view } = renderLaneActions({ draftSession });

  await act(async () => {
    await view.result.current.changeConfigOption('think', 'on');
  });

  expect(mock.calls).toHaveLength(0);
  expect(laneActionState.overrides).toEqual({ think: 'on' });
  expect(laneActionState.options[0]).toMatchObject({ id: 'think', currentValue: 'on' });
});

test('changeConfigOption goes through the lane API once the lane exists', async () => {
  const { mock, view } = renderLaneActions();

  await act(async () => {
    await view.result.current.changeConfigOption('think', true);
  });

  expect(mock.calls).toEqual([
    {
      channel: 'setLaneConfigOption',
      input: {
        workspaceRoot: '/w',
        option: { laneId: 'lane-1', configId: 'think', value: true },
      },
    },
  ]);
});

test('applyLaneChanges surfaces conflicts as an apply-conflict dialog', async () => {
  const previews: (string | null)[] = [];
  const conflicts: (string | null)[] = [];
  const { view } = renderLaneActions({
    results: {
      applyLaneChanges: {
        success: false,
        conflict: true,
        error: new Error('merge conflict'),
      },
    },
    onPreview: value => previews.push(value),
    onApplyConflict: value => conflicts.push(value),
  });

  await act(async () => {
    await view.result.current.applyLaneChanges();
  });

  expect(previews).toEqual([null]);
  expect(conflicts).toEqual([expect.stringContaining('merge conflict') as string]);
});

test('selectLane notifies the caller after a successful switch', async () => {
  const selected: string[] = [];
  const snapshots: (CodingRoomSnapshot | null)[] = [];
  const { mock, view } = renderLaneActions({
    results: { selectLane: { success: true, snapshot: buildSnapshot() } },
    onSnapshot: snapshot => snapshots.push(snapshot),
    onLaneSelected: laneId => selected.push(laneId),
  });

  await act(async () => {
    await view.result.current.selectLane('lane-2');
  });

  expect(mock.calls.map(call => call.channel)).toEqual(['selectLane']);
  expect(selected).toEqual(['lane-2']);
  expect(snapshots).toHaveLength(1);
});

test('respondToPermission forwards the chosen outcome and option', async () => {
  const { mock, view } = renderLaneActions();

  await act(async () => {
    await view.result.current.respondToPermission(
      'req-1',
      CodingPermissionOutcome.Selected,
      'opt-a',
    );
  });

  expect(mock.calls).toEqual([
    {
      channel: 'respondPermission',
      input: {
        workspaceRoot: '/w',
        response: {
          requestId: 'req-1',
          outcome: CodingPermissionOutcome.Selected,
          optionId: 'opt-a',
        },
      },
    },
  ]);
});

const renderPromptSubmit = ({
  prompt = 'fix the build',
  activeLane = null as CodingAgentLane | null,
  draftSession: draft = null as CodingSessionDraft | null,
  attachments = [] as { name: string; path: string }[],
  overrides = {} as Record<string, string>,
  results = {} as ElectronMock['results'],
} = {}) => {
  const mock: ElectronMock = { calls: [], results };
  mockElectron(mock);
  const created: string[] = [];
  const drafts: { laneId: string; value: string }[] = [];
  const attachmentSets: { name: string; path: string }[][] = [];
  const newSessionDrafts: { id: string; value: string }[] = [];
  const view = renderHook(() =>
    useCodingPromptSubmit({
      workspaceRoot: '/w',
      prompt,
      activeLane,
      activeProfile: null,
      draftSession: draft,
      defaultSelectedModel: { id: 'model-1', name: 'model' },
      promptAttachments: attachments,
      draftConfigOverrides: overrides,
      isCurrentWorkspace: () => true,
      setSnapshot: () => undefined,
      setDraftState: value => {
        drafts.push(typeof value === 'function' ? value({ laneId: '', value: '' }) : value);
      },
      setNewSessionDraftState: value => {
        newSessionDrafts.push(typeof value === 'function' ? value({ id: '', value: '' }) : value);
      },
      setPromptAttachments: value => {
        const next = typeof value === 'function' ? value([]) : value;
        attachmentSets.push(next as typeof attachments);
      },
      clearPendingDraftSave: () => undefined,
      onSessionCreated: laneId => created.push(laneId),
    }),
  );
  return { attachmentSets, created, drafts, mock, newSessionDrafts, view };
};

test('sendPrompt creates the session for a draft with overrides and attachments', async () => {
  const { created, mock, newSessionDrafts, view, attachmentSets } = renderPromptSubmit({
    draftSession,
    attachments: [{ name: 'a.ts', path: '/w/a.ts' }],
    overrides: { think: 'on' },
    results: {
      startSession: {
        success: true,
        snapshot: {
          ...buildSnapshot(),
          room: { ...buildSnapshot().room, activeLaneId: 'lane-9' },
        },
      },
    },
  });

  await act(async () => {
    await view.result.current.sendPrompt();
  });

  expect(mock.calls.map(call => call.channel)).toEqual(['startSession']);
  expect(mock.calls[0]?.input).toEqual({
    workspaceId: 'ws-1',
    sourceRoot: '/w/main',
    profileId: 'profile-2',
    modelOverride: undefined,
    prompt: 'fix the build',
    attachments: [{ name: 'a.ts', path: '/w/a.ts' }],
    configOptionOverrides: { think: 'on' },
  });
  expect(created).toEqual(['lane-9']);
  expect(newSessionDrafts).toEqual([{ id: '', value: '' }]);
  expect(attachmentSets).toEqual([[]]);
  expect(view.result.current.isSubmitting).toBe(false);
});

test('sendPrompt ignores empty prompts', async () => {
  const { mock, view } = renderPromptSubmit({ prompt: '   ', activeLane: buildLane() });

  await act(async () => {
    await view.result.current.sendPrompt();
  });
  expect(mock.calls).toHaveLength(0);
});

test('sendPrompt sends turns for an existing lane with the chosen delivery', async () => {
  const { drafts, mock, view } = renderPromptSubmit({
    prompt: 'steer it',
    activeLane: buildLane(),
    results: { prompt: { success: true, snapshot: buildSnapshot() } },
  });

  await act(async () => {
    await view.result.current.sendPrompt('steer');
  });

  expect(mock.calls.map(call => call.channel)).toEqual(['prompt', 'saveLaneView']);
  expect(mock.calls[0]?.input).toEqual({
    workspaceRoot: '/w',
    prompt: { laneId: 'lane-1', prompt: 'steer it', delivery: 'steer' },
  });
  expect(mock.calls[1]?.input).toEqual({
    workspaceRoot: '/w',
    view: { laneId: 'lane-1', draft: '', scrollPosition: 0 },
  });
  expect(drafts).toEqual([{ laneId: 'lane-1', value: '' }]);
});
