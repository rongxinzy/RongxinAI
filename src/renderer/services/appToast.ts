import { reportAppError } from './appErrorText';
import { showAppToast as dispatchAppToast } from './toastNotification';

export { showAppToast } from './toastNotification';

/**
 * Surface an error through the shared prompt: the raw detail goes to the app
 * log, the user sees the normalized Chinese copy at the top centre.
 */
export function showAppError(error: unknown, fallbackKey?: string, tag?: string): string {
  const message = reportAppError(error, fallbackKey, tag);
  dispatchAppToast(message, { isError: true });
  return message;
}
