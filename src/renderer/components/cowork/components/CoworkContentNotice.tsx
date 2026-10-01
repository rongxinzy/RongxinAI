import { Alert, AlertDescription } from '@shared/components/ui/alert';
import { i18nService } from '../../../services/i18n';

export function CoworkContentNotice({ truncated }: { truncated?: unknown }) {
  return truncated ? (
    <Alert role="note">
      <AlertDescription>{i18nService.t('coworkContentTruncated')}</AlertDescription>
    </Alert>
  ) : null;
}
