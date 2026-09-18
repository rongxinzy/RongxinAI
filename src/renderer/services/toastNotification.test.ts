// @vitest-environment jsdom

import { expect, test } from 'vitest';

import {
  isLikelyErrorNotification,
  resolveToastMessage,
  resolveToastNotification,
  showAppErrorToast,
  showAppInfoToast,
  showAppSuccessToast,
  showAppToast,
} from './toastNotification';

test('treats error wording in a plain string detail as an error', () => {
  expect(resolveToastNotification('保存失败')).toEqual({
    message: '保存失败',
    options: { isError: true },
  });
  expect(resolveToastNotification('已复制')).toEqual({ message: '已复制', options: {} });
});

test('keeps an explicit non-error severity for structured details', () => {
  // Regression guard: the model connectivity report says "未通过连接测试" but is not a failed
  // operation, so the caller's explicit isError: false must win over the text heuristic.
  expect(
    resolveToastNotification({
      message: '已测试 14 个模型：1 个连接成功，13 个未通过连接测试',
      isError: false,
      isSuccess: false,
    }),
  ).toEqual({
    message: '已测试 14 个模型：1 个连接成功，13 个未通过连接测试',
    options: { isError: false, isSuccess: false },
  });
});

test('treats an explicit isSuccess: false as a declared neutral level', () => {
  // 调用方写了 isSuccess: false 就已经表过态：这是中性汇报，不是失败。
  // 文案启发式只能在 isError / isSuccess 都没声明时兜底，不能反向覆盖显式声明。
  // 这里的文案必须真的命中启发式（含「失败」），否则测不出优先级。
  expect(
    resolveToastNotification({ message: '已测试 120 个模型：119 个失败', isSuccess: false }),
  ).toEqual({ message: '已测试 120 个模型：119 个失败', options: { isSuccess: false } });
});

test('falls back to the text heuristic when a structured detail declares no severity', () => {
  expect(resolveToastNotification({ message: '导出失败' })).toEqual({
    message: '导出失败',
    options: { isError: true },
  });
});

test('does not flag a structured detail explicitly marked as success', () => {
  expect(resolveToastNotification({ message: '删除失败记录已清理', isSuccess: true })).toEqual({
    message: '删除失败记录已清理',
    options: { isSuccess: true },
  });
});

test('resolves to null when there is nothing to show', () => {
  expect(resolveToastNotification(undefined)).toBeNull();
  expect(resolveToastNotification('')).toBeNull();
});

test('detects error wording in both languages', () => {
  expect(isLikelyErrorNotification('request timed out')).toBe(true);
  expect(isLikelyErrorNotification('Auth token expired')).toBe(false);
  expect(isLikelyErrorNotification('模型不存在')).toBe(true);
  expect(isLikelyErrorNotification('连接成功')).toBe(false);
});

test('showAppToast dispatches the shared app:showToast event', () => {
  const details: unknown[] = [];
  const listener = (event: Event) => details.push((event as CustomEvent<unknown>).detail);
  window.addEventListener('app:showToast', listener);

  showAppToast({ message: '无法获取模型列表', isError: true });

  window.removeEventListener('app:showToast', listener);
  expect(details).toEqual([{ message: '无法获取模型列表', isError: true }]);
});

test('showAppToast also carries plain string details', () => {
  const details: unknown[] = [];
  const listener = (event: Event) => details.push((event as CustomEvent<unknown>).detail);
  window.addEventListener('app:showToast', listener);

  showAppToast('已复制');

  window.removeEventListener('app:showToast', listener);
  expect(details).toEqual(['已复制']);
});

test('showAppErrorToast keeps curated wording instead of prefixing it again', () => {
  const details: unknown[] = [];
  const listener = (event: Event) => details.push((event as CustomEvent<unknown>).detail);
  window.addEventListener('app:showToast', listener);

  showAppErrorToast('保存记忆失败');

  window.removeEventListener('app:showToast', listener);
  expect(details).toEqual([
    { message: '保存记忆失败', isError: true, skipErrorNormalization: true },
  ]);
});

test('showAppSuccessToast declares success so failure wording cannot flip it', () => {
  const details: unknown[] = [];
  const listener = (event: Event) => details.push((event as CustomEvent<unknown>).detail);
  window.addEventListener('app:showToast', listener);

  showAppSuccessToast('删除失败记录已清理');

  window.removeEventListener('app:showToast', listener);
  expect(details).toEqual([{ message: '删除失败记录已清理', isSuccess: true }]);
});

test('showAppInfoToast stays neutral even when the wording looks like an error', () => {
  const details: unknown[] = [];
  const listener = (event: Event) => details.push((event as CustomEvent<unknown>).detail);
  window.addEventListener('app:showToast', listener);

  showAppInfoToast('无法获取模型列表');

  window.removeEventListener('app:showToast', listener);
  expect(details).toEqual([{ message: '无法获取模型列表', isError: false, isSuccess: false }]);
  // 走一遍 App 的判定：显式声明压住文案启发式，最终仍是中性提示。
  expect(resolveToastNotification({ message: '无法获取模型列表', isError: false, isSuccess: false }))
    .toEqual({
      message: '无法获取模型列表',
      options: { isError: false, isSuccess: false },
    });
});

test('resolveToastMessage only normalizes errors that did not opt out', () => {
  expect(resolveToastMessage('Widget could not be loaded', { isError: true })).toBe(
    '操作失败：Widget could not be loaded',
  );
  expect(
    resolveToastMessage('保存记忆失败', { isError: true, skipErrorNormalization: true }),
  ).toBe('保存记忆失败');
  expect(resolveToastMessage('保存记忆失败', { isSuccess: true })).toBe('保存记忆失败');
});

test('the App path shows curated error text as-is and only prefixes raw errors', () => {
  const toApp = (detail: Parameters<typeof resolveToastNotification>[0]) => {
    const resolved = resolveToastNotification(detail);
    if (!resolved) return null;
    return resolveToastMessage(resolved.message, resolved.options);
  };

  // 走 showAppErrorToast 的成稿文案原样展示。
  expect(toApp({ message: '保存记忆失败', isError: true, skipErrorNormalization: true })).toBe(
    '保存记忆失败',
  );
  // 直接派发纯字符串（历史写法）会按文案判定成错误，再被补上「操作失败：」。
  expect(toApp('保存记忆失败')).toBe('操作失败：保存记忆失败');
  // 未加工的原始错误由归一化兜底并补前缀。
  expect(toApp({ message: 'Window could not be saved', isError: true })).toBe(
    '操作失败：Window could not be saved',
  );
});
