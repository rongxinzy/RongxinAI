import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import { Progress } from '@shared/components/ui/progress';
import { Separator } from '@shared/components/ui/separator';
import { useEffect, useId, useState } from 'react';

import { StrataInstallPhase } from '../../../../shared/strata/constants';
import {
  StrataServiceStatus,
  type StrataCatalogEntry,
  type StrataInstallState,
  type StrataStatusSnapshot,
  type StrataVariantRef,
} from '../../../../shared/strata/types';
import { i18nService } from '../../../services/i18n';
import { formatBytes } from '../utils/progress';

function matches(ref: StrataVariantRef | undefined, catalogId: string, launchId: string) {
  return ref?.catalogId === catalogId && ref.launchId === launchId;
}

export function StrataMarketplaceCatalog() {
  const rowId = useId();
  const [models, setModels] = useState<StrataCatalogEntry[]>();
  const [bundled, setBundled] = useState(false);
  const [installation, setInstallation] = useState<StrataInstallState>({ installed: [] });
  const [service, setService] = useState<StrataStatusSnapshot>();
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const job = installation.job;
  const installing =
    job?.phase === StrataInstallPhase.Downloading || job?.phase === StrataInstallPhase.Verifying;

  useEffect(() => {
    let active = true;
    const strata = window.electron.strata;
    const unsubscribe = strata.onStatusChanged(status => {
      if (active) setService(status);
    });
    void strata.catalog().then(
      entries => {
        if (active) setModels(entries.filter(entry => entry.marketplaceVariants?.length));
      },
      () => {
        if (active) setModels([]);
      },
    );
    void Promise.all([strata.isBundled(), strata.installState(), strata.status()]).then(
      ([available, state, status]) => {
        if (!active) return;
        setBundled(available);
        setInstallation(state);
        setService(status);
      },
      () => {
        if (active) setActionError(i18nService.t('marketplaceCatalogStrataUnavailable'));
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!installing) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const state = await window.electron.strata.installState();
        if (active) setInstallation(state);
      } catch {
        if (active) setActionError(i18nService.t('marketplaceCatalogStrataUnavailable'));
      } finally {
        if (active) timer = setTimeout(poll, 750);
      }
    };
    timer = setTimeout(poll, 750);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [installing]);

  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setActionError('');
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <Alert>
        <AlertTitle>{i18nService.t('marketplaceCatalogStrata')}</AlertTitle>
        <AlertDescription>{i18nService.t('marketplaceCatalogStrataDescription')}</AlertDescription>
      </Alert>
      {actionError ? (
        <p role="alert" className="break-words">
          {actionError}
        </p>
      ) : null}
      {service?.status === StrataServiceStatus.Error && service.error ? (
        <p role="alert" className="break-words">
          {service.error}
        </p>
      ) : null}
      {service?.status === StrataServiceStatus.Starting ? (
        <p role="status">{i18nService.t('marketplaceCatalogStrataStarting')}</p>
      ) : null}
      {models?.length ? (
        <ul className="flex flex-col gap-3">
          {models.map(model => (
            <li key={model.id} className="flex min-w-0 flex-col gap-2">
              <h3>{model.displayName}</h3>
              <ul className="flex flex-col gap-1">
                {model.marketplaceVariants?.map(variant => {
                  const ref = { catalogId: model.id, launchId: variant.launchId };
                  const rowJob = matches(job, model.id, variant.launchId) ? job : undefined;
                  const installed = installation.installed.some(item =>
                    matches(item, model.id, variant.launchId),
                  );
                  const running =
                    service?.status === StrataServiceStatus.Running &&
                    service.activeModelId === model.id &&
                    service.activeLaunchId === variant.launchId;
                  return (
                    <li key={variant.launchId} className="flex min-w-0 flex-col gap-1">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-1 flex-col">
                          <div className="flex flex-wrap gap-x-2">
                            <span id={`${rowId}-${model.id}-${variant.launchId}`}>
                              {variant.label}
                            </span>
                            <span>
                              {formatBytes(
                                variant.files.reduce((sum, file) => sum + file.bytes, 0),
                              )}
                            </span>
                            {installed ? (
                              <span>{i18nService.t('marketplaceInstalled')}</span>
                            ) : null}
                          </div>
                          <span className="break-all">
                            {[...new Set(variant.files.map(file => file.repoId))].join(' · ')}
                          </span>
                        </div>
                        {bundled ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            className="shrink-0"
                            aria-describedby={`${rowId}-${model.id}-${variant.launchId}`}
                            disabled={pending || (installing && !rowJob && !installed)}
                            onClick={() =>
                              void run(async () => {
                                const strata = window.electron.strata;
                                if (running) setService(await strata.stop());
                                else if (installed) setService(await strata.start(ref));
                                else {
                                  if (rowJob && installing) await strata.cancelInstall(ref);
                                  else await strata.install(ref);
                                  setInstallation(await strata.installState());
                                }
                              })
                            }
                          >
                            {i18nService.t(
                              running
                                ? 'strataCatalogStop'
                                : installed
                                  ? 'strataCatalogStart'
                                  : rowJob && installing
                                    ? 'marketplaceCancel'
                                    : 'marketplaceInstall',
                            )}
                          </Button>
                        ) : null}
                      </div>
                      {rowJob && installing ? (
                        <>
                          <span role="status">
                            {i18nService.t(
                              rowJob.phase === StrataInstallPhase.Verifying
                                ? 'marketplaceDownloadStageVerification'
                                : 'marketplaceDownloadInProgress',
                            )}
                            {' · '}
                            {formatBytes(rowJob.completed)} / {formatBytes(rowJob.total)}
                          </span>
                          <Progress
                            aria-label={variant.label}
                            value={(100 * rowJob.completed) / rowJob.total}
                          />
                        </>
                      ) : null}
                      {rowJob?.phase === StrataInstallPhase.Failed ? (
                        <p role="alert" className="break-words">
                          {i18nService.t('marketplaceInstallFailed')}
                          {' · '}
                          {rowJob.error}
                        </p>
                      ) : null}
                      {rowJob?.phase === StrataInstallPhase.Cancelled ? (
                        <span role="status">{i18nService.t('marketplacePullCancelled')}</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              <Separator />
            </li>
          ))}
        </ul>
      ) : (
        <p role="status">
          {i18nService.t(
            models ? 'marketplaceCatalogStrataUnavailable' : 'marketplaceCatalogStrataLoading',
          )}
        </p>
      )}
    </section>
  );
}
