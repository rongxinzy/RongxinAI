// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { beforeEach, expect, test, vi } from 'vitest';

import {
  ActivityErrorCode,
  ActivitySource,
  ActivityStatus,
} from '../../../shared/activity/constants';
import type { ActivityRun } from '../../../shared/activity/types';
import { i18nService } from '../../services/i18n';
import activityReducer, { hydrateRuns } from '../../store/slices/activitySlice';
import ActivityView from './ActivityView';

const t = (key: string): string => i18nService.t(key);

const run = (overrides: Partial<ActivityRun>): ActivityRun => ({
  id: 'run-1',
  source: ActivitySource.Channel,
  status: ActivityStatus.Running,
  startedAt: 1,
  updatedAt: 1,
  ...overrides,
});

const renderView = (runs: readonly ActivityRun[], onShowScheduledTasks?: () => void) => {
  const store = configureStore({ reducer: { activity: activityReducer } });
  store.dispatch(hydrateRuns([...runs]));
  return render(
    <Provider store={store}>
      <ActivityView onShowScheduledTasks={onShowScheduledTasks} />
    </Provider>,
  );
};

const selectStatus = async (from: string, to: string) => {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: t(from) }));
  await user.click(await screen.findByRole('menuitemradio', { name: t(to) }));
};

beforeEach(() => {
  i18nService.setLanguage('zh', { persist: false });
  Object.defineProperty(window, 'electron', {
    configurable: true,
    value: {
      platform: 'linux',
      window: {
        isMaximized: () => Promise.resolve(false),
        onStateChanged: () => () => undefined,
        minimize: vi.fn(),
        toggleMaximize: vi.fn(),
        close: vi.fn(),
        showSystemMenu: vi.fn(),
      },
    },
  });
});

test('offers a scheduled-task entry point when there is no run at all', () => {
  const onShowScheduledTasks = vi.fn();
  renderView([], onShowScheduledTasks);

  expect(screen.getByText(t('activityEmpty'))).toBeInTheDocument();
  fireEvent.click(screen.getByText(t('activityEmptyAction')));
  expect(onShowScheduledTasks).toHaveBeenCalledTimes(1);
});

test('clears the source filter from the empty state instead of dead-ending the page', () => {
  renderView([
    run({
      id: 'ok',
      source: ActivitySource.Channel,
      status: ActivityStatus.Running,
      replyPreview: '回复内容',
      updatedAt: 2,
    }),
  ]);

  fireEvent.click(screen.getByRole('tab', { name: t('activityTriggerCron') }));
  expect(screen.getByText(t('activityFilterEmpty'))).toBeInTheDocument();
  expect(screen.getByText(t('activityFilterClear'))).toBeInTheDocument();

  fireEvent.click(screen.getByText(t('activityFilterClear')));
  expect(screen.getByText('回复内容')).toBeInTheDocument();
});

test('returns to every run through the status menu', async () => {
  renderView([
    run({ id: 'failed', status: ActivityStatus.Failed, errorMessage: '接口超时', updatedAt: 2 }),
    run({ id: 'ok', status: ActivityStatus.Completed, replyPreview: '回复内容', updatedAt: 1 }),
  ]);

  await selectStatus('activityAllStatuses', 'activityStatusFailed');
  expect(screen.getByText('接口超时')).toBeInTheDocument();
  expect(screen.queryByText('回复内容')).toBeNull();

  await selectStatus('activityStatusFailed', 'activityAllStatuses');
  expect(screen.getByText('回复内容')).toBeInTheDocument();
});

test('localizes an interrupted run instead of showing the persisted marker', () => {
  renderView([
    run({
      id: 'interrupted',
      status: ActivityStatus.Failed,
      errorMessage: ActivityErrorCode.Interrupted,
      updatedAt: 5,
    }),
  ]);

  expect(screen.getByText(t('activityErrorInterrupted'))).toBeInTheDocument();
  expect(screen.queryByText(ActivityErrorCode.Interrupted)).toBeNull();
});

test('shows the completed run reply preview', () => {
  renderView([
    run({ id: 'running', platform: 'weixin', updatedAt: 3 }),
    run({
      id: 'done',
      status: ActivityStatus.Completed,
      replyPreview: '已经处理好了',
      updatedAt: 2,
    }),
  ]);

  expect(screen.getByText('已经处理好了')).toBeInTheDocument();
});
