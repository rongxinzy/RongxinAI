import { useCallback, useEffect, useRef, useState } from 'react';
import Toast from '../components/Toast';
import { TOAST_DEFAULT_DURATION_MS, TOAST_MAX_DURATION_MS } from '../services/errorNormalization';
import {
  resolveToastMessage,
  resolveToastNotification,
  type ToastNotificationDetail,
  type ToastNotificationOptions,
} from '../services/toastNotification';

/** Own the app toast subscription, timer and close callback as one lifecycle. */
export function useAppToastDisplay() {
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isToastError, setIsToastError] = useState(false);
  const [isToastSuccess, setIsToastSuccess] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const toastOnCloseRef = useRef<(() => void) | null>(null);
  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastMessage(null);
    setIsToastError(false);
    setIsToastSuccess(false);
    const onClose = toastOnCloseRef.current;
    toastOnCloseRef.current = null;
    onClose?.();
  }, []);

  const showToast = useCallback(
    (message: string, options: ToastNotificationOptions = {}) => {
      const {
        autoClose = true,
        durationMs = TOAST_DEFAULT_DURATION_MS,
        isError = false,
        isSuccess = false,
        onClose = null,
      } = options;
      setToastMessage(resolveToastMessage(message, options));
      setIsToastError(isError);
      setIsToastSuccess(isSuccess);
      toastOnCloseRef.current = onClose;
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (autoClose) {
        toastTimerRef.current = window.setTimeout(
          dismissToast,
          Math.min(Math.max(durationMs, 0), TOAST_MAX_DURATION_MS),
        );
      } else {
        toastTimerRef.current = null;
      }
    },
    [dismissToast],
  );

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      toastOnCloseRef.current = null;
    };
  }, []);

  // Listen for toast events from child components
  useEffect(() => {
    const handler = (e: Event) => {
      const resolved = resolveToastNotification((e as CustomEvent<ToastNotificationDetail>).detail);
      if (!resolved) return;
      showToast(resolved.message, resolved.options);
    };
    window.addEventListener('app:showToast', handler);
    return () => window.removeEventListener('app:showToast', handler);
  }, [showToast]);

  return toastMessage ? (
    <Toast message={toastMessage} isError={isToastError} isSuccess={isToastSuccess} />
  ) : null;
}
