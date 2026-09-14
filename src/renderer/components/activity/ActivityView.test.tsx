// @vitest-environment jsdom

import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

/** The trigger filter is the first tab list of the page, the status filter the second. */
const statusTabs = (): HTMLElement => screen.getAllByRole('tablist')[1];

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

test('clears both filters from the empty state instead of dead-ending the page', () => {
  renderView([
    run({ id: 'ok', status: ActivityStatus.Completed, replyPreview: '回复内容', updatedAt: 2 }),
  ]);

  fireEvent.click(within(statusTabs()).getByText(t('activityStatusFailed')));
  expect(screen.getByText(t('activityFilterEmpty'))).toBeInTheDocument();
  expect(screen.getByText(t('activityFilterClear'))).toBeInTheDocument();

  fireEvent.click(screen.getByText(t('activityFilterClear')));
  expect(screen.getByText('回复内容')).toBeInTheDocument();
});

test('returns to every run through the explicit all segment', () => {
  renderView([
    run({ id: 'failed', status: ActivityStatus.Failed, errorMessage: '接口超时', updatedAt: 2 }),
    run({ id: 'ok', status: ActivityStatus.Completed, replyPreview: '回复内容', updatedAt: 1 }),
  ]);

  fireEvent.click(within(statusTabs()).getByText(t('activityStatusFailed')));
  expect(screen.getByText('接口超时')).toBeInTheDocument();
  expect(screen.queryByText('回复内容')).toBeNull();

  fireEvent.click(within(statusTabs()).getByText(t('activityFilterAll')));
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

test('shows the trigger text until the run has a reply', () => {
  renderView([
    run({ id: 'running', platform: 'weixin', inputPreview: '帮我看下今天的日志', updatedAt: 3 }),
    run({
      id: 'done',
      status: ActivityStatus.Completed,
      inputPreview: '帮我处理一下',
      replyPreview: '已经处理好了',
      updatedAt: 2,
    }),
  ]);

  expect(screen.getByText('帮我看下今天的日志')).toBeInTheDocument();
  expect(screen.getByText('已经处理好了')).toBeInTheDocument();
  expect(screen.queryByText('帮我处理一下')).toBeNull();
});