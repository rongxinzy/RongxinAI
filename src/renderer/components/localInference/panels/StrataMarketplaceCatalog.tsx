import { Alert, AlertDescription, AlertTitle } from '@shared/components/ui/alert';
import { Separator } from '@shared/components/ui/separator';
import { useEffect, useState } from 'react';

import type { StrataCatalogEntry } from '../../../../shared/strata/types';
import { i18nService } from '../../../services/i18n';
import { formatBytes } from '../utils/progress';

export function StrataMarketplaceCatalog() {
  const [models, setModels] = useState<StrataCatalogEntry[]>();
  useEffect(() => {
    let active = true;
    void window.electron.strata.catalog().then(
      entries => {
        if (active) setModels(entries.filter(entry => entry.marketplaceVariants?.length));
      },
      () => {
        if (active) setModels([]);
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      <Alert>
        <AlertTitle>{i18nService.t('marketplaceCatalogStrata')}</AlertTitle>
        <AlertDescription>{i18nService.t('marketplaceCatalogStrataDescription')}</AlertDescription>
      </Alert>
      {models?.length ? (
        <ul className="flex flex-col gap-3">
          {models.map(model => (
            <li key={model.id} className="flex min-w-0 flex-col gap-2">
              <h3>{model.displayName}</h3>
              <ul className="flex flex-col gap-1">
                {model.marketplaceVariants?.map(variant => (
                  <li key={variant.label} className="flex min-w-0 flex-wrap gap-x-2 gap-y-1">
                    <span>{variant.label}</span>
                    <span>
                      {formatBytes(variant.files.reduce((sum, file) => sum + file.bytes, 0))}
                    </span>
                    <span className="break-all">
                      {[...new Set(variant.files.map(file => file.repoId))].join(' · ')}
                    </span>
                  </li>
                ))}
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
