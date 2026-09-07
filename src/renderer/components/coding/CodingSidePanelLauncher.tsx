import { Button } from '@shared/components/ui/button';
import { FileDiff, FolderOpen } from 'lucide-react';

import { i18nService } from '../../services/i18n';

interface CodingSidePanelLauncherProps {
  onOpenFiles: () => void;
  onOpenReview: () => void;
}

export const CodingSidePanelLauncher = ({
  onOpenFiles,
  onOpenReview,
}: CodingSidePanelLauncherProps) => (
  <div className="flex h-full min-h-0 flex-col">
    <div className="flex flex-col gap-2 p-3">
      <Button type="button" variant="navigation" size="navigation" className="gap-2" onClick={onOpenReview}>
        <FileDiff />
        {i18nService.t('codingAgentReview')}
      </Button>
      <Button type="button" variant="navigation" size="navigation" className="gap-2" onClick={onOpenFiles}>
        <FolderOpen />
        {i18nService.t('codingAgentFiles')}
      </Button>
    </div>
  </div>
);
