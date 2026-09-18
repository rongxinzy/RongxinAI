/**
 * 全局提示（app:showToast）严重级别与文案加工的唯一判定入口。
 *
 * 调用方可以用 isError / isSuccess 显式声明级别；文案启发式只作为两者都没声明时的兜底。
 * 显式声明必须优先，否则「已测试 14 个模型：1 个连接成功，13 个未通过连接测试」这类
 * 中性汇报会因为文案里出现「失败」二字被反向升级成红色的操作失败提示。
 * 判定顺序：isError（含 false）→ 显式 isSuccess（含 false）→ 文案启发式。
 */

import { normalizeError } from './errorNormalization';

export interface ToastNotificationOptions {
  autoClose?: boolean;
  durationMs?: number;
  isError?: boolean;
  isSuccess?: boolean;
  onClose?: () => void;
  /**
   * 文案已经是给用户看的成稿（i18n 文案或调用方已经归一化过），不要再走 normalizeError，
   * 否则「保存记忆失败」会被加工成「操作失败：保存记忆失败」。
   */
  skipErrorNormalization?: boolean;
}

export type ToastNotificationDetail = string | ({ message: string } & ToastNotificationOptions);

export interface ResolvedToastNotification {
  message: string;
  options: ToastNotificationOptions;
}

const LIKELY_ERROR_TEXT_PATTERN =
  /(failed|failure|error|unable|cannot|could not|invalid|denied|timeout|timed out|not found|失败|错误|无法|不允许|超时|拒绝|不存在)/i;

export function isLikelyErrorNotification(message: string): boolean {
  return LIKELY_ERROR_TEXT_PATTERN.test(message);
}

/**
 * 返回 null 表示这条事件没有可展示的内容。
 * 消息归一化（normalizeError）仍由 App.showToast 统一处理，这里只决定级别。
 */
export function resolveToastNotification(
  detail: ToastNotificationDetail | null | undefined,
): ResolvedToastNotification | null {
  if (!detail) return null;
  if (typeof detail === 'string') {
    return isLikelyErrorNotification(detail)
      ? { message: detail, options: { isError: true } }
      : { message: detail, options: {} };
  }

  // 显式声明的级别永远优先：isError 说得最直接，其次是 isSuccess——哪怕显式写 false，
  // 也代表调用方已经表过态（这是中性汇报，不是失败），不该再被文案启发式反向升级成红色错误。
  // 两者都没写时才允许文案启发式兜底。
  const isError =
    detail.isError ??
    (detail.isSuccess === undefined && isLikelyErrorNotification(detail.message));
  const { message, ...options } = detail;
  return { message, options: isError ? { ...options, isError: true } : options };
}

/**
 * 派发全局提示的唯一入口。App 里的 Toast 是唯一渲染者（DESIGN.md「全局提示与错误文案」），
 * 组件不要直接使用 sonner 的 toast：共享宿主没有挂载时，调用会被静默丢弃，用户什么也看不到。
 */
export function showAppToast(detail: ToastNotificationDetail): void {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail }));
}

/** 决定最终展示给用户的文案：只有声明为错误且没有跳过归一化时才走 normalizeError。 */
export function resolveToastMessage(
  message: string,
  options: ToastNotificationOptions,
): string {
  return options.isError && !options.skipErrorNormalization ? normalizeError(message) : message;
}

/** 错误提示：显式红色。文案由调用方保证是成稿（i18n 文案或已经过 normalizeError）。 */
export function showAppErrorToast(message: string): void {
  showAppToast({ message, isError: true, skipErrorNormalization: true });
}

/**
 * 中性信息提示：显式声明「这既不是成功也不是失败」，避免正文里的「无法 / 失败 / 无效」
 * 被文案启发式升级成红色错误提示（拉取模型列表失败这类只读探测就属于这一档）。
 */
export function showAppInfoToast(message: string): void {
  showAppToast({ message, isError: false, isSuccess: false });
}

/** 成功提示：显式绿色，避免文案里出现「失败」等字样时被判定成错误。 */
export function showAppSuccessToast(message: string): void {
  showAppToast({ message, isSuccess: true });
}
