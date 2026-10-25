import { useEffect, useState } from 'react';
import { Field, FieldLabel, FieldDescription, FieldGroup } from '@shared/components/ui/field';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@shared/components/ui/select';
import { desktopPetBuiltin } from '../../../../shared/desktopPet/catalog';
import { RELEASED_DESKTOP_PETS } from '../../../../shared/desktopPet/availability';

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
        {RELEASED_DESKTOP_PETS.length > 1 ? (
          <Field>
            <FieldLabel htmlFor="desktop-pet-character">
              {i18nService.t('desktopPetCharacter')}
            </FieldLabel>
            <FieldDescription>{i18nService.t('desktopPetCharacterDescription')}</FieldDescription>
            <Select
              value={settings?.characterId ?? ''}
              disabled={!settings || saving}
              onValueChange={value => {
                const character = desktopPetBuiltin(value ?? '');
                if (character) void update({ characterId: character.id });
              }}
            >
              <SelectTrigger id="desktop-pet-character" className="w-full">
                <SelectValue>
                  {i18nService.t(
                    desktopPetBuiltin(settings?.characterId ?? '')?.nameKey ??
                      'desktopPetCharacterXiaoyuan',
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {RELEASED_DESKTOP_PETS.map(character => (
                  <SelectItem key={character.id} value={character.id}>
                    {i18nService.t(character.nameKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        ) : null}
        <SettingsToggleRow
          labelHeadingLevel={3}
          label={i18nService.t('desktopPetEnabled')}
          description={i18nService.t('desktopPetEnabledDescription')}
          checked={settings?.enabled ?? false}
          disabled={!settings || saving}
          onCheckedChange={enabled => update({ enabled })}
        />
        <SettingsToggleRow
          labelHeadingLevel={3}
          label={i18nService.t('desktopPetDoNotDisturb')}
          description={i18nService.t('desktopPetDoNotDisturbDescription')}
          checked={settings?.doNotDisturb ?? false}
          disabled={!settings || saving}
          onCheckedChange={doNotDisturb => update({ doNotDisturb })}
        />
        <SettingsToggleRow
          labelHeadingLevel={3}
          label={i18nService.t('desktopPetHideInFullscreen')}
          description={i18nService.t('desktopPetHideInFullscreenDescription')}
          checked={settings?.hideInFullscreen ?? true}
          disabled={!settings || saving}
          onCheckedChange={hideInFullscreen => update({ hideInFullscreen })}
        />
        <SettingsToggleRow
          labelHeadingLevel={3}
          label={i18nService.t('desktopPetRoaming')}
          description={i18nService.t('desktopPetRoamingDescription')}
          checked={settings?.roaming ?? true}
          disabled={!settings || saving}
          onCheckedChange={roaming => update({ roaming })}
        />
        <SettingsToggleRow
          labelHeadingLevel={3}
          label={i18nService.t('desktopPetChatter')}
          description={i18nService.t('desktopPetChatterDescription')}
          checked={settings?.chatter ?? true}
          disabled={!settings || saving}
          onCheckedChange={chatter => update({ chatter })}
        />
      </FieldGroup>
    </section>
  );
}
