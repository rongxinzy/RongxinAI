import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import { RotateCcw, X } from 'lucide-react';

import { i18nService } from '../../services/i18n';

export const ResumeTaskContextBadge = ({ onCancel }: { onCancel: () => void }) => (
  <div className="flex min-w-0 items-center gap-1">
    <Badge variant="secondary" className="min-w-0 gap-1">
      <RotateCcw className="shrink-0" />
      <span className="truncate">{i18nService.t('coworkResumeTaskContext')}</span>
    </Badge>
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      aria-label={i18nService.t('coworkCancelTaskResume')}
      onClick={onCancel}
    >
      <X />
    </Button>
  </div>
);
