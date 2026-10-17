import { Input } from '@shared/components/ui/input';
import { Switch } from '@shared/components/ui/switch';
import { useEffect, useState } from 'react';

import {
  MAGPIE_REDACT_KINDS,
  type MagpiePreferences,
  type MagpiePreferencesPatch,
} from '../../../../shared/magpie/preferences';
import { i18nService } from '../../../services/i18n';
import { MagpiePreferenceRow } from './MagpiePreferenceControls';

export function MagpiePrivacyPreferences({
  preferences,
  saving,
  update,
}: {
  preferences: MagpiePreferences;
  saving: boolean;
  update: (patch: MagpiePreferencesPatch) => Promise<boolean>;
}) {
  const [words, setWords] = useState(preferences.redactWords.join(', '));
  useEffect(() => setWords(preferences.redactWords.join(', ')), [preferences.redactWords]);
  const commitWords = () => {
    const next = words
      .split(/[,，\n]/)
      .map(word => word.trim())
      .filter(Boolean);
    if (next.join(', ') !== preferences.redactWords.join(', ')) {
      void update({ redactWords: next });
    }
  };
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">{i18nService.t('magpieRedactSection')}</h2>
        <MagpiePreferenceRow
          title={i18nService.t('magpieRedactSecrets')}
          description={i18nService.t('magpieRedactSecretsHint')}
          control={
            <Switch
              aria-label={i18nService.t('magpieRedactSecrets')}
              checked={preferences.redact}
              disabled={saving}
              onCheckedChange={redact => void update({ redact })}
            />
          }
        />
        <MagpiePreferenceRow
          title={i18nService.t('magpieRedactPersonal')}
          description={i18nService.t('magpieRedactPersonalHint')}
          control={
            <Switch
              aria-label={i18nService.t('magpieRedactPersonal')}
              checked={preferences.redactPersonal}
              disabled={saving}
              onCheckedChange={redactPersonal => void update({ redactPersonal })}
            />
          }
        />
        {preferences.redactPersonal ? (
          <div className="flex flex-col gap-4">
            {MAGPIE_REDACT_KINDS.map(kind => {
              const checked = preferences.redactKinds[kind.id] ?? kind.defaultOn;
              const label = i18nService.t(`magpieRedactKind_${kind.id}`);
              return (
                <div key={kind.id} className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{label}</p>
                    <p className="text-sm text-muted-foreground">
                      {i18nService.t(`magpieRedactKindHint_${kind.id}`)}
                    </p>
                  </div>
                  <Switch
                    aria-label={label}
                    checked={checked}
                    disabled={saving}
                    onCheckedChange={enabled =>
                      void update({
                        redactKinds: { ...preferences.redactKinds, [kind.id]: enabled },
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        ) : null}
        <MagpiePreferenceRow
          title={i18nService.t('magpieRedactWords')}
          description={i18nService.t('magpieRedactWordsHint')}
          control={
            <Input
              className="w-full lg:w-80"
              value={words}
              placeholder={i18nService.t('magpieRedactWordsPlaceholder')}
              aria-label={i18nService.t('magpieRedactWords')}
              disabled={saving}
              onChange={event => setWords(event.target.value)}
              onBlur={commitWords}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitWords();
                }
              }}
            />
          }
        />
      </section>
    </div>
  );
}
