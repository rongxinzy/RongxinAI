import { reportAppError, type AppErrorLogLevel } from './appErrorText';
import { showAppToast as dispatchAppToast } from './toastNotification';

export { showAppToast } from './toastNotification';

/**
 * Surface an error through the shared prompt: the raw detail goes to the app
 * log, the user sees the normalized Chinese copy at the top centre.
 * Diagnostic severity does not change the error presentation of the toast.
 */
export function showAppError(
  error: unknown,
  fallbackKey?: string,
  tag?: string,
  logLevel?: AppErrorLogLevel,
): string {
  const message = reportAppError(error, fallbackKey, tag, logLevel);
  dispatchAppToast(message, { isError: true });
  return message;
}
