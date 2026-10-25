import React, { useCallback, useEffect, useState } from 'react';

import { Button } from '@shared/components/ui/button';
import type { StrataCatalogEntry, StrataStatusSnapshot } from '../../../../shared/strata/types';
import { i18nService } from '../../../services/i18n';
import { showAppErrorToast, showAppInfoToast } from '../../../services/toastNotification';

export const StrataCatalogPanel: React.FC = () => {
  const [bundled, setBundled] = useState(false);
  const [catalog, setCatalog] = useState<StrataCatalogEntry[]>([]);
  const [status, setStatus] = useState<StrataStatusSnapshot | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.electron.strata
      .isBundled()
      .then(value => {
        if (!cancelled) setBundled(value);
        if (!value) return null;
        return window.electron.strata.catalog();
      })
      .then(entries => {
        if (entries && !cancelled) setCatalog(entries);
      })
      .catch(() => {
        if (!cancelled) setBundled(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!bundled) return undefined;
    return window.electron.strata.onStatusChanged(next => {
      setStatus(next as StrataStatusSnapshot);
    });
  }, [bundled]);

  const refreshStatus = useCallback(async () => {
    const next = await window.electron.strata.status();
    setStatus(next);
  }, []);

  useEffect(() => {
    if (bundled) void refreshStatus();
  }, [bundled, refreshStatus]);

  const handleStart = useCallback(async (entry: StrataCatalogEntry) => {
    setBusyId(entry.id);
    try {
      const next = await window.electron.strata.start({ catalogId: entry.id });
      setStatus(next);
      showAppInfoToast(i18nService.t('strataStartRequested'));
    } catch (error) {
      showAppErrorToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleStop = useCallback(async () => {
    setBusyId('__stop__');
    try {
      const next = await window.electron.strata.stop();
      setStatus(next);
    } catch (error) {
      showAppErrorToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }, []);

  if (!bundled) return null;

  return (
    <section className="flex flex-col gap-3 px-4 pb-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold">{i18nService.t('strataCatalogTitle')}</h2>
        <p className="text-sm text-muted-foreground">{i18nService.t('strataCatalogSubtitle')}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {catalog.map(entry => (
          <li
            key={entry.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{entry.displayName}</div>
              <div className="text-xs text-muted-foreground">
                {i18nService
                  .t('strataCatalogHardwareGate')
                  .replace('{ram}', String(entry.hardware.minSystemRamGb))
                  .replace('{vram}', String(entry.hardware.minVramGb))
                  .replace('{disk}', String(entry.hardware.minDiskGb))}
              </div>
            </div>
            <Button size="sm" disabled={busyId !== null} onClick={() => void handleStart(entry)}>
              {i18nService.t('strataCatalogStart')}
            </Button>
          </li>
        ))}
      </ul>
      {status?.status === 'running' ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          onClick={() => void handleStop()}
        >
          {i18nService.t('strataCatalogStop')}
        </Button>
      ) : null}
    </section>
  );
};
