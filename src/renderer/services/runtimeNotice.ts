import { getUserErrorI18nKey, type CoworkErrorKind } from '../../common/coworkError';
import type { RuntimeRetryNotice } from '../../common/runtimeNotice';
import { i18nService } from './i18n';
import { showAppToast } from './appToast';

/**
 * Mirror a runtime retry notice to the shared top prompt.
 *
 * Pi retries a failed attempt before the turn is reported, so without this the
 * user watches a turn that looks frozen while the model keeps answering with an
 * error. The notice names the classified reason (API key, quota, server error)
 * and disappears on its own; the final failure still lands as the turn error.
 */
export const startRuntimeNoticeListener = (): (() => void) =>
  window.electron.runtimeNotices.onNotice((notice: RuntimeRetryNotice) => {
    const reason = i18nService.t(getUserErrorI18nKey(notice.kind as CoworkErrorKind));
    showAppToast(i18nService.t('runtimeRetryNotice').replace('{reason}', reason), {
      isError: true,
    });
  });
