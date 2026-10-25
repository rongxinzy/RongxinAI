// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';

import {
  MemoryDeliveryStatus,
  MemoryKind,
  MemoryLifecycleStatus,
  MemoryScope,
  MemorySensitivity,
  MemorySourceKind,
  type ManagedMemoryRecord,
} from '../../../../shared/memory';
import { i18nService } from '../../../services/i18n';
import { showAppInfoToast, showAppSuccessToast } from '../../../services/toastNotification';
import { store } from '../../../store';
import { setCurrentWorkspaceId, setWorkspaces } from '../../../store/slices/workspaceSlice';
import { ManagedMemorySettings } from './ManagedMemorySettings';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  resolveSessionTitles: vi.fn(),
  confirmCandidate: vi.fn(),
  forget: vi.fn(),
}));

vi.mock('../../../services/memory', () => ({
  memoryService: {
    list: mocks.list,
    resolveSessionTitles: mocks.resolveSessionTitles,
    confirmCandidate: mocks.confirmCandidate,
    forget: mocks.forget,
  },
}));
vi.mock('../../../services/toastNotification', () => ({
  showAppErrorToast: vi.fn(),
  showAppInfoToast: vi.fn(),
  showAppSuccessToast: vi.fn(),
}));

const workspace = {
  id: 'project',
  name: 'Project',
  path: '/project',
  isHidden: false,
  createdAt: 1,
  updatedAt: 1,
};

function record(id: string, overrides: Partial<ManagedMemoryRecord> = {}): ManagedMemoryRecord {
  return {
    id,
    memoryId: 1,
    projectId: workspace.id,
    scope: MemoryScope.Project,
    sessionId: `session-${id}`,
    sourceKind: MemorySourceKind.Explicit,
    taskId: null,
    runId: null,
    artifactId: null,
    approvalId: null,
    status: MemoryLifecycleStatus.NeedsReview,
    title: `Title ${id}`,
    content: `Content ${id}`,
    kind: MemoryKind.Decision,
    topicKey: null,
    importance: 0.8,
    confidence: 0.9,
    sensitivity: MemorySensitivity.Normal,
    expiresAt: null,
    supersededBy: null,
    promotedFromLinkId: null,
    promotionSourceProjectId: null,
    promotionSourceSessionId: null,
    createdAt: '2026-08-18T01:00:00.000Z',
    updatedAt: '2026-08-18T01:00:00.000Z',
    deliveryStatus: MemoryDeliveryStatus.Completed,
    deliveryError: null,
    ...overrides,
  };
}

const projectRecord = record('project');
const sessionRecord = record('session', {
  scope: MemoryScope.Session,
  kind: MemoryKind.SessionSummary,
});
const dateOptions: Intl.DateTimeFormatOptions = { dateStyle: 'medium', timeStyle: 'short' };
const englishDate = new Intl.DateTimeFormat('en-US', dateOptions).format(
  new Date(projectRecord.updatedAt),
);
const chineseDate = new Intl.DateTimeFormat('zh-CN', dateOptions).format(
  new Date(projectRecord.updatedAt),
);

// jsdom lacks the animation query used by the real detail dialog's ScrollArea.
const originalGetAnimations = Object.getOwnPropertyDescriptor(Element.prototype, 'getAnimations');
beforeAll(() => {
  Object.defineProperty(Element.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  });
});
afterAll(() => {
  if (originalGetAnimations)
    Object.defineProperty(Element.prototype, 'getAnimations', originalGetAnimations);
  else Reflect.deleteProperty(Element.prototype, 'getAnimations');
});

beforeEach(() => {
  vi.clearAllMocks();
  i18nService.setLanguage('en', { persist: false });
  mocks.list.mockResolvedValue([projectRecord, sessionRecord]);
  mocks.resolveSessionTitles.mockResolvedValue([]);
  mocks.forget.mockResolvedValue(true);
  store.dispatch(setWorkspaces([workspace]));
  store.dispatch(setCurrentWorkspaceId(workspace.id));
});

afterEach(() => {
  cleanup();
  i18nService.setLanguage('en', { persist: false });
  vi.restoreAllMocks();
});

test('editor drafts skip record lists without freezing language, filters, busy or records', async () => {
  const NativeDateTimeFormat = Intl.DateTimeFormat;
  const format = vi.fn();
  const dateTimeFormat = vi
    .spyOn(Intl, 'DateTimeFormat')
    .mockImplementation(function DateTimeFormat(locales, options) {
      const formatter = new NativeDateTimeFormat(locales, options);
      const nativeFormat = formatter.format;
      Object.defineProperty(formatter, 'format', {
        value: (date: Date) => {
          format(date);
          return nativeFormat(date);
        },
      });
      return formatter;
    });
  render(
    <Provider store={store}>
      <ManagedMemorySettings workingDirectory={workspace.path} />
    </Provider>,
  );
  await screen.findByText(projectRecord.content);
  await screen.findByText(sessionRecord.content);
  expect(screen.getAllByText(englishDate)).toHaveLength(2);
  expect(dateTimeFormat.mock.calls.filter(call => call[0] === 'en-US')).toHaveLength(1);

  format.mockClear();
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('managedMemoryCreate') }));
  fireEvent.change(screen.getByLabelText(i18nService.t('managedMemoryFieldTitle')), {
    target: { value: 'Draft title' },
  });
  fireEvent.change(screen.getByLabelText(i18nService.t('managedMemoryFieldContent')), {
    target: { value: 'Draft content' },
  });
  expect(format).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('cancel') }));

  act(() => i18nService.setLanguage('zh', { persist: false }));
  expect(screen.getAllByText(chineseDate)).toHaveLength(2);
  expect(screen.queryByText(englishDate)).toBeNull();
  expect(dateTimeFormat.mock.calls.filter(call => call[0] === 'zh-CN')).toHaveLength(1);

  fireEvent.change(
    screen.getByRole('searchbox', { name: i18nService.t('managedMemorySearchPlaceholder') }),
    { target: { value: 'no matching memory' } },
  );
  expect(screen.queryByText(projectRecord.content)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: i18nService.t('managedMemoryFilterClear') }));
  expect(screen.getByText(projectRecord.content)).toBeTruthy();

  let resolveConfirm: (() => void) | undefined;
  mocks.confirmCandidate.mockImplementation(
    () =>
      new Promise<void>(resolve => {
        resolveConfirm = resolve;
      }),
  );
  mocks.list.mockResolvedValueOnce([
    { ...projectRecord, title: 'Confirmed project' },
    sessionRecord,
  ]);
  const confirm = screen.getByRole('button', { name: i18nService.t('managedMemoryConfirm') });
  fireEvent.click(confirm);
  expect(confirm).toBeDisabled();
  await act(async () => resolveConfirm?.());
  await screen.findByText('Confirmed project');
  expect(dateTimeFormat.mock.calls.filter(call => call[0] === 'en-US')).toHaveLength(1);
  expect(dateTimeFormat.mock.calls.filter(call => call[0] === 'zh-CN')).toHaveLength(1);
});

test('discarding an unconfirmed entry neither claims it was remembered nor approves it', async () => {
  const candidate = record('candidate', { memoryId: null });
  mocks.list.mockResolvedValue([candidate]);
  render(
    <Provider store={store}>
      <ManagedMemorySettings workingDirectory={workspace.path} />
    </Provider>,
  );
  fireEvent.click(await screen.findByText(candidate.title));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: i18nService.t('managedMemoryMoreActions'),
    }),
  );
  fireEvent.click(
    await screen.findByRole('menuitem', { name: i18nService.t('managedMemoryRejectCandidate') }),
  );
  const confirmation = screen.getByRole('dialog', {
    name: i18nService.t('managedMemoryRejectTitle'),
  });
  expect(screen.queryByText(i18nService.t('managedMemoryForgetTitle'))).toBeNull();
  fireEvent.click(
    within(confirmation).getByRole('button', {
      name: i18nService.t('managedMemoryRejectCandidate'),
    }),
  );
  await waitFor(() => expect(mocks.forget).toHaveBeenCalledWith(candidate.id, false));
  expect(mocks.confirmCandidate).not.toHaveBeenCalled();
});

test('queued deletion is reported as pending instead of a completed deletion', async () => {
  const active = record('active', { status: MemoryLifecycleStatus.Active });
  mocks.list.mockResolvedValue([active]);
  mocks.forget.mockResolvedValue(false);
  render(
    <Provider store={store}>
      <ManagedMemorySettings workingDirectory={workspace.path} />
    </Provider>,
  );
  fireEvent.click(await screen.findByText(active.title));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: i18nService.t('managedMemoryMoreActions'),
    }),
  );
  fireEvent.click(await screen.findByRole('menuitem', { name: i18nService.t('delete') }));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: i18nService.t('managedMemoryHardDelete'),
    }),
  );
  await waitFor(() =>
    expect(showAppInfoToast).toHaveBeenCalledWith(i18nService.t('managedMemorySyncPending')),
  );
  expect(mocks.forget).toHaveBeenCalledWith(active.id, true);
  expect(showAppSuccessToast).not.toHaveBeenCalled();
});

test('sync failures show a localized explanation without exposing runtime paths', async () => {
  const failed = record('failed', {
    deliveryStatus: MemoryDeliveryStatus.Pending,
    deliveryError: 'HTTP 404 for DELETE /observations/123?hard=true at /private/runtime/cache',
  });
  mocks.list.mockResolvedValue([failed]);
  render(
    <Provider store={store}>
      <ManagedMemorySettings workingDirectory={workspace.path} />
    </Provider>,
  );
  fireEvent.click(await screen.findByText(failed.title));
  const dialog = screen.getByRole('dialog');
  expect(
    within(dialog).getByText(i18nService.t('managedMemorySyncErrorDescription')),
  ).toBeVisible();
  expect(dialog.textContent).not.toContain('/observations');
  expect(dialog.textContent).not.toContain('/private/runtime');
  act(() => i18nService.setLanguage('zh', { persist: false }));
  expect(
    within(dialog).getByText(i18nService.t('managedMemorySyncErrorDescription')),
  ).toBeVisible();
});
