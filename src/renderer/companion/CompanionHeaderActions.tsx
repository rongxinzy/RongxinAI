import { PanelsTopLeft, X } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import type { CompanionWindowApi, CompanionProfile } from '../../shared/companion/types';
import { i18nService } from '../services/i18n';

export function CompanionHeaderActions({
  api,
}: {
  api?: CompanionWindowApi;
  profile?: CompanionProfile;
  visible: boolean;
}) {
  const t = (key: string) => i18nService.t(key);
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('companionWorkbench')}
        onClick={() => void api?.openWorkbench()}
      >
        <PanelsTopLeft strokeWidth={1.75} />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('companionHide')}
        onClick={() => void api?.hide()}
      >
        <X strokeWidth={1.75} />
      </Button>
    </>
  );
}
