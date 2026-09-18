import { expect, test } from 'vitest';

import { normalizeError } from '../../services/errorNormalization';
import { resolveToastNotification } from '../../services/toastNotification';
import {
  buildProviderModelConnectionTestNotification,
  buildProviderModelConnectionTestProgressNotification,
  MODEL_CONNECTION_TEST_PROGRESS_MIN_TOTAL,
  shouldReportProviderModelConnectionTestProgress,
} from './modelConnectionTestNotification';

test('reports a mixed connectivity result as a neutral info toast', () => {
  const notification = buildProviderModelConnectionTestNotification({ total: 14, successCount: 1 });

  expect(notification.message).toBe('已测试 14 个模型：1 个连接成功，13 个未通过连接测试');
  expect(notification.isError).toBe(false);
  expect(notification.isSuccess).toBe(false);
});

test('reports an all-failed connectivity result as an error toast', () => {
  const notification = buildProviderModelConnectionTestNotification({ total: 3, successCount: 0 });

  expect(notification.message).toBe('操作失败：3 个模型全部未通过连接测试');
  expect(notification.isError).toBe(true);
  expect(notification.isSuccess).toBe(false);
});

test('the all-failed report keeps its wording through error normalization', () => {
  const notification = buildProviderModelConnectionTestNotification({ total: 3, successCount: 0 });

  // 错误提示会先过 normalizeError，已经写成「操作失败：原因摘要」的文案必须原样返回，
  // 否则会被再包一层「操作失败：」。
  expect(normalizeError(notification.message)).toBe('操作失败：3 个模型全部未通过连接测试');
  expect(resolveToastNotification(notification)).toEqual({
    message: '操作失败：3 个模型全部未通过连接测试',
    options: { isError: true, isSuccess: false, autoClose: true, durationMs: 3000 },
  });
});

test('a single working model already makes the batch a neutral report', () => {
  const notification = buildProviderModelConnectionTestNotification({ total: 3, successCount: 1 });

  expect(notification.message).toBe('已测试 3 个模型：1 个连接成功，2 个未通过连接测试');
  expect(notification.isError).toBe(false);
  expect(notification.isSuccess).toBe(false);
});

test('reports a fully connected provider as a success toast', () => {
  const notification = buildProviderModelConnectionTestNotification({ total: 2, successCount: 2 });

  expect(notification.message).toBe('2 个模型连接成功');
  expect(notification.isError).toBe(false);
  expect(notification.isSuccess).toBe(true);
});

test('the auto-test report reaches the toast host as a neutral notification', () => {
  const notification = buildProviderModelConnectionTestNotification({ total: 14, successCount: 1 });

  // This is exactly the payload the Settings page dispatches through app:showToast.
  expect(resolveToastNotification(notification)).toEqual({
    message: '已测试 14 个模型：1 个连接成功，13 个未通过连接测试',
    options: { isError: false, isSuccess: false, autoClose: true, durationMs: 3000 },
  });
});

test('reports batch progress as a neutral notification that replaces itself', () => {
  const notification = buildProviderModelConnectionTestProgressNotification({ tested: 12, total: 120 });

  expect(notification.message).toBe('正在测试模型 12/120…');
  expect(notification.isError).toBe(false);
  expect(notification.isSuccess).toBe(false);
  // 进度提示必须能自动续期又不会卡在屏幕上：每 1.5 秒重新派发一次。
  expect(notification.autoClose).toBe(true);
  expect(notification.durationMs).toBe(3000);
});

test('the progress report also reaches the toast host as a neutral notification', () => {
  const notification = buildProviderModelConnectionTestProgressNotification({ tested: 0, total: 120 });

  expect(resolveToastNotification(notification)).toEqual({
    message: '正在测试模型 0/120…',
    options: { isError: false, isSuccess: false, autoClose: true, durationMs: 3000 },
  });
});

test('only large batches are worth a progress notification', () => {
  expect(MODEL_CONNECTION_TEST_PROGRESS_MIN_TOTAL).toBe(10);
  expect(
    shouldReportProviderModelConnectionTestProgress(MODEL_CONNECTION_TEST_PROGRESS_MIN_TOTAL),
  ).toBe(false);
  expect(
    shouldReportProviderModelConnectionTestProgress(MODEL_CONNECTION_TEST_PROGRESS_MIN_TOTAL + 1),
  ).toBe(true);
});
