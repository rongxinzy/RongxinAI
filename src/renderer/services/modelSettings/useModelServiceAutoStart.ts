import { useCallback, useEffect, useRef, useState } from 'react';
import type { MagpieStatus } from '../../../shared/magpie/types';

export interface UseModelServiceAutoStartResult {
  status: MagpieStatus | null;
  isStarting: boolean;
  startError: string | null;
  refreshStatus: () => Promise<MagpieStatus | null>;
  retryStart: () => Promise<MagpieStatus | null>;
}

export function useModelServiceAutoStart(): UseModelServiceAutoStartResult {
  const [status, setStatus] = useState<MagpieStatus | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const attemptedAutoStartRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refreshStatus = useCallback(async (): Promise<MagpieStatus | null> => {
    if (!window.electron?.magpie?.status) return null;
    try {
      const next = await window.electron.magpie.status();
      if (mountedRef.current) {
        setStatus(next);
        if (next.state === 'running') {
          setIsStarting(false);
          setStartError(null);
        } else if (next.state === 'failed') {
          setIsStarting(false);
          setStartError(next.error || 'service_down');
        }
      }
      return next;
    } catch (error) {
      if (mountedRef.current) {
        setStartError(error instanceof Error ? error.message : String(error));
      }
      return null;
    }
  }, []);

  const retryStart = useCallback(async (): Promise<MagpieStatus | null> => {
    if (!window.electron?.magpie?.start) return null;
    setIsStarting(true);
    setStartError(null);
    try {
      const next = await window.electron.magpie.start();
      if (mountedRef.current) {
        setStatus(next);
        setIsStarting(next.state === 'starting');
        if (next.state === 'failed') {
          setStartError(next.error || 'service_down');
        }
      }
      return next;
    } catch (error) {
      if (mountedRef.current) {
        setIsStarting(false);
        setStartError(error instanceof Error ? error.message : String(error));
      }
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      const current = await refreshStatus();
      if (!active || !current) return;
      if (current.state === 'stopped' && current.enabled && !attemptedAutoStartRef.current) {
        attemptedAutoStartRef.current = true;
        await retryStart();
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, [refreshStatus, retryStart]);

  return {
    status,
    isStarting,
    startError,
    refreshStatus,
    retryStart,
  };
}
