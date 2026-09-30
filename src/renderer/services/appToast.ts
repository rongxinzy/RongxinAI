import { reportAppError } from './appErrorText';

/**
 * Repeating the same sentence is noise, not news: periodic paths (a git refresh
 * on every streamed event, a sidebar reload on every snapshot, a window focus)
 * must not re-announce a failure the user already saw.
 */
const REPEAT_WINDOW_MS = 5_000;
const lastShownAt = new Map<string, number>();

export interface AppToastOptions {
  isError?: boolean;
  isSuccess?: boolean;
  autoClose?: boolean;
  durationMs?: number;
}

/**
 * Single entry point for the app-wide prompt.
 *
 * DESIGN.md「全局提示与错误文案」keeps one component for system prompts —
 * `src/renderer/components/Toast.tsx`, rendered by App at the top centre — and
 * requires cross-page notices to dispatch `app:showToast`. Features must not
 * build their own toast container or paint their own red lines.
 */
export function showAppToast(message: string, options: AppToastOptions = {}): void {
  const text = message.trim();
  if (!text) return;
  const now = Date.now();
  const last = lastShownAt.get(text);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return;
  lastShownAt.set(text, now);
  for (const [seen, at] of lastShownAt) {
    if (now - at >= REPEAT_WINDOW_MS) lastShownAt.delete(seen);
  }
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: { message: text, ...options } }));
}

/**
 * Surface an error through the shared prompt: the raw detail goes to the app
 * log, the user sees the normalized Chinese copy at the top centre.
 */
export function showAppError(error: unknown, fallbackKey?: string, tag?: string): string {
  const message = reportAppError(error, fallbackKey, tag);
  showAppToast(message, { isError: true });
  return message;
}
