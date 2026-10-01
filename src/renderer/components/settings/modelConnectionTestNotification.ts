import { TOAST_MAX_DURATION_MS } from '../../services/errorNormalization';
import { i18nService } from '../../services/i18n';
import type { ToastNotificationOptions } from '../../services/toastNotification';

export interface ProviderModelConnectionTestSummary {
  readonly total: number;
  readonly successCount: number;
  /** 全部不通时附带首个失败原因，避免只剩笼统摘要、看不出是鉴权还是网络问题。 */
  readonly firstFailureMessage?: string;
}

export interface ProviderModelConnectionTestNotification extends ToastNotificationOptions {
  message: string;
}

/** 超过这个模型数才值得挂进度提示，小列表秒完反而会闪一下。 */
export const MODEL_CONNECTION_TEST_PROGRESS_MIN_TOTAL = 10;

/** 进度提示的刷新间隔：Toast 最多显示 3 秒，按这个节奏续期既不会消失也不会频繁重渲染。 */
export const MODEL_CONNECTION_TEST_PROGRESS_INTERVAL_MS = 1_500;

export function shouldReportProviderModelConnectionTestProgress(total: number): boolean {
  return total > MODEL_CONNECTION_TEST_PROGRESS_MIN_TOTAL;
}

export interface ProviderModelConnectionTestProgress {
  readonly total: number;
  readonly tested: number;
}

/**
 * 模型很多时（如 Qwen 上百个模型）整批连通性测试会跑很久，过程中只有列表里的状态点，
 * 用户看不到任何反馈。这里用中性信息提示持续汇报进度，结束时由结果汇总提示替换。
 */
export function buildProviderModelConnectionTestProgressNotification(
  progress: ProviderModelConnectionTestProgress,
): ProviderModelConnectionTestNotification {
  const message = i18nService
    .t('modelConnectionTestProgress')
    .replace('{tested}', String(progress.tested))
    .replace('{total}', String(progress.total));

  return {
    message,
    isError: false,
    isSuccess: false,
    autoClose: true,
    durationMs: TOAST_MAX_DURATION_MS,
  };
}

/**
 * 探测模型列表成功后自动跑的连通性测试，按结果分三档：
 * - 全部连通：成功提示，说明这份配置可用。
 * - 部分连通：中性信息提示。用户主动执行的是「拉取模型列表」且已成功，
 *   失败的只是部分模型，单个模型的通断由列表里的状态点表达。
 * - 全部不通：错误提示。这次操作没有拿到任何可用结果，多半是端点或凭据问题，
 *   属于 DESIGN.md 里「没做成的操作」。
 */
export function buildProviderModelConnectionTestNotification(
  summary: ProviderModelConnectionTestSummary,
): ProviderModelConnectionTestNotification {
  const failureCount = summary.total - summary.successCount;

  if (failureCount === 0) {
    const message = i18nService
      .t('modelConnectionTestSuccessSummary')
      .replace('{success}', String(summary.successCount));
    return { message, isError: false, isSuccess: true, autoClose: true };
  }

  if (failureCount === summary.total) {
    // 文案按 errorNormalization 的「操作失败：原因」契约拼，避免被归一化二次改写。
    const reason = i18nService
      .t('modelConnectionTestAllFailed')
      .replace('{total}', String(summary.total));
    const detail = summary.firstFailureMessage?.trim();
    const separator = i18nService.getLanguage() === 'zh' ? '：' : ': ';
    return {
      message: detail
        ? `${i18nService.t('operationFailed')}${separator}${reason}（${detail}）`
        : `${i18nService.t('operationFailed')}${separator}${reason}`,
      isError: true,
      isSuccess: false,
      autoClose: true,
      durationMs: TOAST_MAX_DURATION_MS,
    };
  }

  const message = i18nService
    .t('modelConnectionTestSummary')
    .replace('{total}', String(summary.total))
    .replace('{success}', String(summary.successCount))
    .replace('{failure}', String(failureCount));

  return {
    message,
    isError: false,
    isSuccess: false,
    autoClose: true,
    // 结果汇报比普通提示需要更长的阅读时间，使用 DESIGN.md 允许的最长时长。
    durationMs: TOAST_MAX_DURATION_MS,
  };
}
