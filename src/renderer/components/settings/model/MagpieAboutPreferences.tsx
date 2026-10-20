import type { MagpiePreferences } from '../../../../shared/magpie/preferences';
import { i18nService } from '../../../services/i18n';

export function MagpieAboutPreferences({ preferences }: { preferences: MagpiePreferences }) {
  const displayDataDir = preferences.dataDir
    ? preferences.dataDir.replace(/([/\\.]|\b)magpie(?=[/\\.]|$)/gi, '$1model-service')
    : '—';
  const rows = [
    [i18nService.t('aboutVersion'), preferences.version || '—'],
    [i18nService.t('magpieDataDirectory'), displayDataDir],
    [i18nService.t('magpieGatewayAddress'), preferences.gateway || '—'],
  ] as const;
  return (
    <div className="flex flex-col gap-6">
      <p className="max-w-prose text-sm text-muted-foreground">
        {i18nService.t('magpieAboutHint')}
      </p>
      <dl className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
          >
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-all text-sm sm:text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
