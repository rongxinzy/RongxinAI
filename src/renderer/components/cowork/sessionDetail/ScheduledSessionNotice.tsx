import { Button } from '@shared/components/ui/button';
import { FieldDescription } from '@shared/components/ui/field';
import { i18nService } from '../../../services/i18n';

/** Task-owned conversations expose their history without an interactive composer. */
export function ScheduledSessionNotice({
  isRunning,
  onStop,
}: {
  isRunning: boolean;
  onStop: () => void;
}) {
  return (
    <div
      className="mx-auto flex w-full max-w-4xl shrink-0 items-center gap-3 px-4 py-3"
      data-scheduled-session-readonly
    >
      <FieldDescription className="min-w-0 flex-1">
        {i18nService.t('scheduledTasksRunRecordReadOnly')}
      </FieldDescription>
      {isRunning && (
        <Button variant="ghost" onClick={onStop}>
          {i18nService.t('scheduledTasksStop')}
        </Button>
      )}
    </div>
  );
}
