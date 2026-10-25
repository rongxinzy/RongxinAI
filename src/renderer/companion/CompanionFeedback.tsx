import { Button } from '@shared/components/ui/button';
import { CompanionRequestState } from '../../shared/companion/constants';
import type { CompanionConversation } from '../../shared/companion/types';
import { i18nService } from '../services/i18n';

interface Props {
  conversation?: CompanionConversation;
  taskMode: boolean;
  error: string | null;
  reload(): Promise<void>;
}

/** A reply's native outcome survives refresh, hiding and restart; explicit stop is quiet. */
export function CompanionFeedback({ conversation, taskMode, error, reload }: Props) {
  const state = !taskMode && !conversation?.pending ? conversation?.lastReply?.state : undefined;
  const failure = state === CompanionRequestState.Unanswered ? 'companionFailed' : null;
  const message = error ?? failure;
  const t = (key: string) => i18nService.t(key);
  if (message)
    return (
      <div role="alert" className="flex items-center justify-between gap-3">
        <span className="theme-home-caption">{t(message)}</span>
        {error && !error.startsWith('companionFile') ? (
          <Button variant="ghost" size="sm" onClick={() => void reload()}>
            {t('companionRefresh')}
          </Button>
        ) : null}
      </div>
    );
  return state === CompanionRequestState.Stopped ? (
    <p role="status" className="theme-home-caption">
      {t('companionReplyStopped')}
    </p>
  ) : null;
}
