// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import { clearDraftAttachments, type DraftAttachment } from '../../store/slices/coworkSlice';
import { WorkMode } from '../../store/workMode/constants';
import CoworkPromptInput from './CoworkPromptInput';

type Dispatcher = { mock: { calls: [unknown][] } };

const toastMessages = (dispatch: Dispatcher): string[] =>
  dispatch.mock.calls
    .map(([event]) => event as Event)
    .filter(event => event.type === 'app:showToast')
    .map(event => (event as CustomEvent<{ message?: string }>).detail?.message ?? '');

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  state: {
    cowork: {
      draftPrompts: { __home__: '' },
      draftAttachments: {} as Record<string, DraftAttachment[]>,
      currentSession: null,
    },
    agent: { currentAgentId: 'main', agents: [] },
    model: {
      availableModels: [],
      defaultSelectedModel: { id: 'test-model', name: 'Test Model', providerKey: 'test' },
      selectedModelByAgent: {},
    },
    skill: { activeSkillIds: [], skills: [] },
    quickAction: { actions: [], selectedActionId: null },
    workMode: { mode: '' as WorkMode },
  },
}));

vi.mock('react-redux', () => ({
  useDispatch: () => fixture.dispatch,
  useSelector: (selector: (state: RootState) => unknown) =>
    selector(fixture.state as unknown as RootState),
}));
vi.mock('../../services/config', () => ({
  configService: { getConfig: () => ({ shortcuts: { sendMessage: 'Enter' } }) },
}));
vi.mock('../../services/skill', () => ({
  skillService: { loadSkills: async () => [], onSkillsChanged: () => () => {} },
}));
vi.mock('../../services/agent', () => ({ agentService: { updateAgent: async () => {} } }));
vi.mock('../../services/cowork', () => ({ coworkService: { updateSessionModel: async () => {} } }));
vi.mock('../mcp/ActiveMcpBadge', () => ({ default: () => null }));
vi.mock('./ActiveExpertBadge', () => ({ default: () => null }));
vi.mock('./CoworkInlineAttachments', () => ({ CoworkInlineAttachments: () => null }));
vi.mock('./ContextUsageIndicator', () => ({ ContextUsageIndicator: () => null }));
vi.mock('./SessionStatsLine', () => ({ SessionStatsLine: () => null }));
vi.mock('./CoworkModelPicker', () => ({ CoworkModelPicker: () => null }));
vi.mock('./FolderSelectorPopover', () => ({ default: () => null }));
vi.mock('./PermissionModeMenu', () => ({ default: () => null }));
vi.mock('./PromptPlusMenu', () => ({ default: () => null }));
vi.mock('./ResumeTaskContextBadge', () => ({ ResumeTaskContextBadge: () => null }));

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.state.cowork.draftPrompts.__home__ = '';
  fixture.state.cowork.draftAttachments = {};
  fixture.state.workMode.mode = WorkMode.Chat;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const submit = async (form: HTMLFormElement, count = 1) => {
  await act(async () => {
    for (let index = 0; index < count; index++) fireEvent.submit(form);
  });
};

test.each(['', ' \t\n', '\u200b\u200d\ufeff'])(
  'does not forward visually empty text %j',
  async prompt => {
    fixture.state.cowork.draftPrompts.__home__ = prompt;
    const onSubmit = vi.fn();
    const view = render(<CoworkPromptInput onSubmit={onSubmit} />);
    await submit(view.container.querySelector('form')!);
    expect(onSubmit).not.toHaveBeenCalled();
  },
);

test('rapid form submits forward the captured draft only once', async () => {
  fixture.state.cowork.draftPrompts.__home__ = 'hello';
  const onSubmit = vi.fn(async (_prompt: string) => true);
  const view = render(<CoworkPromptInput onSubmit={onSubmit} />);
  await submit(view.container.querySelector('form')!, 3);
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0]?.[0]).toBe('hello');
});

test('holds the lock through asynchronous submission and permits a retry after rejection', async () => {
  let finish: (accepted: boolean) => void = () => {};
  const onSubmit = vi.fn(
    (_prompt: string) =>
      new Promise<boolean>(resolve => {
        finish = resolve;
      }),
  );
  const view = render(<CoworkPromptInput onSubmit={onSubmit} />);
  const form = view.container.querySelector('form')!;
  const editor = view.container.querySelector<HTMLElement>('[contenteditable="true"]')!;
  editor.textContent = 'retry me';
  fireEvent.input(editor);
  await submit(form);
  await submit(form);
  expect(onSubmit).toHaveBeenCalledOnce();
  await act(async () => finish(false));
  expect(view.container.querySelector('[contenteditable="true"]')?.textContent).toBe('retry me');
  await submit(form);
  expect(onSubmit).toHaveBeenCalledTimes(2);
  await act(async () => finish(true));
});

test('does not send or clear the draft when the only inline image cannot be parsed', async () => {
  fixture.state.cowork.draftAttachments.__home__ = [
    { path: 'inline:broken.png', name: 'broken.png', isImage: true, dataUrl: 'invalid-data-url' },
  ];
  const onSubmit = vi.fn();
  const windowDispatch = vi.spyOn(window, 'dispatchEvent');
  const view = render(<CoworkPromptInput onSubmit={onSubmit} />);
  await submit(view.container.querySelector('form')!);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(
    fixture.dispatch.mock.calls.some(([action]) => action.type === clearDraftAttachments.type),
  ).toBe(false);
  expect(toastMessages(windowDispatch)).toEqual([i18nService.t('imageReadError')]);
});

test('allows a valid image without text', async () => {
  fixture.state.cowork.draftAttachments.__home__ = [
    {
      path: 'inline:example.png',
      name: 'example.png',
      isImage: true,
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
    },
  ];
  const onSubmit = vi.fn();
  const view = render(<CoworkPromptInput onSubmit={onSubmit} />);
  await submit(view.container.querySelector('form')!);
  expect(onSubmit).toHaveBeenCalledWith(
    '',
    [{ name: 'example.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' }],
    undefined,
    [],
    false,
  );
});

test('prevents another submit while an image is being read asynchronously', async () => {
  fixture.state.cowork.draftAttachments.__home__ = [
    { path: 'D:/example.png', name: 'example.png', isImage: true },
  ];
  let finish: (result: { success: boolean; dataUrl: string }) => void = () => {};
  const read = vi.fn(
    () =>
      new Promise<{ success: boolean; dataUrl: string }>(resolve => {
        finish = resolve;
      }),
  );
  const original = Object.getOwnPropertyDescriptor(window, 'electron');
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { dialog: { readFileAsDataUrl: read } },
  });
  try {
    const onSubmit = vi.fn();
    const view = render(<CoworkPromptInput onSubmit={onSubmit} />);
    const form = view.container.querySelector('form')!;
    await submit(form, 2);
    expect(read).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => finish({ success: true, dataUrl: 'data:image/png;base64,aW1hZ2U=' }));
    expect(onSubmit).toHaveBeenCalledOnce();
  } finally {
    if (original) Object.defineProperty(window, 'electron', original);
    else Reflect.deleteProperty(window, 'electron');
  }
});

test('forwards the disk path alongside base64 for path-based image submissions', async () => {
  fixture.state.cowork.draftAttachments.__home__ = [
    { path: 'D:/example.png', name: 'example.png', isImage: true },
  ];
  const read = vi.fn(async () => ({
    success: true,
    dataUrl: 'data:image/png;base64,aW1hZ2U=',
  }));
  const original = Object.getOwnPropertyDescriptor(window, 'electron');
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: { dialog: { readFileAsDataUrl: read } },
  });
  try {
    const onSubmit = vi.fn();
    const view = render(<CoworkPromptInput onSubmit={onSubmit} />);
    await submit(view.container.querySelector('form')!);
    expect(onSubmit).toHaveBeenCalledOnce();
    // 模型仍通过正文拿到文件路径(seedream 等 --image 场景),base64 走附件通道,
    // 同时携带 path 供气泡侧把两处识别为同一张图。
    expect(onSubmit.mock.calls[0]?.[0]).toContain('D:/example.png');
    expect(onSubmit.mock.calls[0]?.[1]).toEqual([
      {
        name: 'example.png',
        mimeType: 'image/png',
        base64Data: 'aW1hZ2U=',
        path: 'D:/example.png',
      },
    ]);
  } finally {
    if (original) Object.defineProperty(window, 'electron', original);
    else Reflect.deleteProperty(window, 'electron');
  }
});

test('preserves attachment-only file submissions as file-path prompts', async () => {
  fixture.state.cowork.draftAttachments.__home__ = [
    { path: 'D:/notes.txt', name: 'notes.txt', isImage: false },
  ];
  const onSubmit = vi.fn();
  const view = render(<CoworkPromptInput onSubmit={onSubmit} />);
  await submit(view.container.querySelector('form')!);
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0]?.[0]).toContain('D:/notes.txt');
});

test.each(['', ' \t', '\u200b'])(
  'does not synthesize a file label for an empty attachment path %j',
  path => {
    fixture.state.cowork.draftAttachments.__home__ = [{ path, name: 'notes.txt', isImage: false }];
    const onSubmit = vi.fn();
    const windowDispatch = vi.spyOn(window, 'dispatchEvent');
    const view = render(<CoworkPromptInput onSubmit={onSubmit} />);
    return submit(view.container.querySelector('form')!).then(() => {
      expect(onSubmit).not.toHaveBeenCalled();
      expect(toastMessages(windowDispatch)).toEqual([i18nService.t('coworkSubmitEmptyContent')]);
    });
  },
);

test('keeps the explicit task-resume action available without an amendment', async () => {
  const onSubmit = vi.fn();
  const view = render(<CoworkPromptInput onSubmit={onSubmit} resumeTaskActive />);
  await submit(view.container.querySelector('form')!, 2);
  expect(onSubmit).toHaveBeenCalledOnce();
  expect(onSubmit.mock.calls[0]?.[0]).toBe('');
});
