import { useEffect, useState } from 'react';
import { FieldGroup } from '@shared/components/ui/field';

import type { DesktopPetSettings } from '../../../../shared/desktopPet/types';
import { i18nService } from '../../../services/i18n';
import { showAppError } from '../../../services/appToast';
import { SettingsToggleRow } from '../../common/SettingsToggleRow';

export function DesktopPetSettingsSection() {
  const [settings, setSettings] = useState<DesktopPetSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let changed = false;
    const unsubscribe = window.electron.desktopPet.onSettingsChanged(next => {
      changed = true;
      if (active) setSettings(next);
    });
    void window.electron.desktopPet
      .getSettings()
      .then(next => {
        if (active && !changed) setSettings(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const update = async (patch: Partial<DesktopPetSettings>) => {
    setSaving(true);
    try {
      setSettings(await window.electron.desktopPet.setSettings(patch));
    } catch {
      showAppError(i18nService.t('settingsSaveFailed'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="flex flex-col gap-4" aria-label={i18nService.t('desktopPetSettingsTitle')}>
      <h2 className="text-base font-semibold text-foreground">
        {i18nService.t('desktopPetSettingsTitle')}
      </h2>
      {failed ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {i18nService.t('settingsLoadFailed')}
        </p>
      ) : null}
      <FieldGroup className="gap-4">
        <SettingsToggleRow
          label={i18nService.t('desktopPetEnabled')}
          description={i18nService.t('desktopPetEnabledDescription')}
          checked={settings?.enabled ?? false}
          disabled={!settings || saving}
          onCheckedChange={enabled => update({ enabled })}
        />
        <SettingsToggleRow
          label={i18nService.t('desktopPetDoNotDisturb')}
          description={i18nService.t('desktopPetDoNotDisturbDescription')}
          checked={settings?.doNotDisturb ?? false}
          disabled={!settings || saving}
          onCheckedChange={doNotDisturb => update({ doNotDisturb })}
        />
        <SettingsToggleRow
          label={i18nService.t('desktopPetHideInFullscreen')}
          description={i18nService.t('desktopPetHideInFullscreenDescription')}
          checked={settings?.hideInFullscreen ?? true}
          disabled={!settings || saving}
          onCheckedChange={hideInFullscreen => update({ hideInFullscreen })}
        />
      </FieldGroup>
    </section>
  );
}
