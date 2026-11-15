import { Checkbox } from '@shared/components/ui/checkbox';
import { Switch } from '@shared/components/ui/switch';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { MAGPIE_REDACT_KINDS } from '../../../../shared/magpie/preferences';
import { i18nService } from '../../../services/i18n';
import { useModelServiceAutoStart } from '../../../services/modelSettings/useModelServiceAutoStart';
import { MagpieListEditor } from '../model/MagpiePreferenceControls';
import { useMagpiePreferences } from '../model/useMagpiePreferences';

export function PrivacyPage() {
  const { status } = useModelServiceAutoStart();
  const running = status?.state === 'running';
  const { preferences, loading, saving, update } = useMagpiePreferences(running);

  const disabled = !preferences || loading || saving;
  const redactPersonal = Boolean(preferences?.redactPersonal);

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-medium text-foreground">
            {i18nService.t('privacyRedactSectionTitle')}
          </h3>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {i18nService.t('privacyPageDescription')}
          </p>
        </div>

        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-4 px-4 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">
                {i18nService.t('privacyRedactSecretsLabel')}
              </div>
              <div className="text-xs text-muted-foreground">
                {i18nService.t('privacyRedactSecretsHint')}
              </div>
            </div>
            <Switch
              checked={Boolean(preferences?.redact)}
              disabled={disabled}
              aria-label={i18nService.t('privacyRedactSecretsLabel')}
              onCheckedChange={redact => void update({ redact })}
            />
          </div>

          <div className="space-y-3 px-4 py-3.5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  {i18nService.t('privacyRedactPersonalLabel')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {i18nService.t('privacyRedactPersonalHint')}
                </div>
              </div>
              <Switch
                checked={redactPersonal}
                disabled={disabled}
                aria-label={i18nService.t('privacyRedactPersonalLabel')}
                onCheckedChange={next => void update({ redactPersonal: next })}
              />
            </div>

            {redactPersonal && preferences && (
              <details className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-muted-foreground select-none hover:text-foreground">
                  <ChevronDown className="size-3.5" />
                  <span>{i18nService.t('magpieRedactKinds')}</span>
                </summary>
                <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-border pt-3 sm:grid-cols-2">
                  {MAGPIE_REDACT_KINDS.map(kind => {
                    const checked = preferences.redactKinds[kind.id] ?? kind.defaultOn;
                    return (
                      <label
                        key={kind.id}
                        className="flex cursor-pointer items-start gap-2.5 rounded p-1.5 hover:bg-background/60"
                      >
                        <Checkbox
                          checked={checked}
                          disabled={disabled}
                          onCheckedChange={next => {
                            void update({
                              redactKinds: {
                                ...preferences.redactKinds,
                                [kind.id]: Boolean(next),
                              },
                            });
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium text-foreground">
                            {i18nService.t(`magpieRedactKind_${kind.id}`)}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {i18nService.t(`magpieRedactKindHint_${kind.id}`)}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </details>
            )}
          </div>

          <div className="px-4 py-3.5">
            <details className="text-sm">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-foreground select-none">
                <ChevronDown className="size-4 text-muted-foreground" />
                <span>{i18nService.t('magpieRedactWords')}</span>
              </summary>
              <div className="mt-3 space-y-2">
                <p className="text-xs text-muted-foreground">
                  {i18nService.t('privacyRedactCustomHint')}
                </p>
                {preferences && (
                  <MagpieListEditor
                    values={preferences.redactWords}
                    placeholder={i18nService.t('magpieRedactWordsPlaceholder')}
                    disabled={disabled}
                    onChange={(redactWords: string[]) => void update({ redactWords })}
                  />
                )}
              </div>
            </details>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-base font-medium text-foreground">
          {i18nService.t('privacyNetworkSectionTitle')}
        </h3>
        <div className="flex items-start gap-3 rounded-lg border border-border bg-card px-4 py-3.5 text-sm">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="space-y-1">
            <div className="font-medium text-foreground">
              {i18nService.t('privacyServiceSectionTitle')}
            </div>
            <p className="text-xs text-muted-foreground">
              {i18nService.t('magpieNetworkHostManaged')}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
