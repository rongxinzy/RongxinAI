import { PanelsTopLeft, X } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { COMPANION_NAME_KEYS, CompanionSurface } from '../../shared/companion/constants';
import type { CompanionWindowApi, CompanionProfile } from '../../shared/companion/types';
import { i18nService } from '../services/i18n';
import { CompanionMemoryDialog } from './CompanionMemoryDialog';

export function CompanionHeaderActions({
  api,
  profile,
  surface,
  visible,
}: {
  api?: CompanionWindowApi;
  profile?: CompanionProfile;
  surface: CompanionSurface;
  visible: boolean;
}) {
  const t = (key: string) => i18nService.t(key);
  return (
    <>
      {visible && profile ? (
        <CompanionMemoryDialog
          key={profile.petId}
          api={api}
          petId={profile.petId}
          name={t(COMPANION_NAME_KEYS[profile.personaId])}
        />
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('companionWorkbench')}
        onClick={() => void api?.openWorkbench()}
      >
        <PanelsTopLeft strokeWidth={1.75} />
      </Button>
      {surface === CompanionSurface.Quick ? (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('companionHide')}
          onClick={() => void api?.hide()}
        >
          <X strokeWidth={1.75} />
        </Button>
      ) : null}
    </>
  );
}
