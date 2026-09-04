import { Shimmer } from '@shared/components/ai-elements/shimmer';

import { i18nService } from '../../services/i18n';

/** Shown only while a coding agent has not produced its first turn event. */
export const CodingAgentWorkingIndicator = () => (
  <div className="flex flex-col gap-2 animate-fade-in" role="status" aria-live="polite">
    <div className="flex items-center gap-2">
      <span className="size-1.5 shrink-0 rounded-full bg-primary" />
      <Shimmer duration={1.5} className="text-sm">
        {i18nService.t('codingAgentWaiting')}
      </Shimmer>
    </div>
  </div>
);
