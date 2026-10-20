import type { ReactNode } from 'react';

import { i18nService } from '../../services/i18n';
import { resolveHomeGreetingLead } from '../../utils/homeGreeting';
import { PromptPanel, QuickActionBar } from '../quick-actions';
import type { LocalizedQuickAction } from '../../types/quickAction';

interface HomeStudioProps {
  header: ReactNode;
  composer: ReactNode;
  quickActions: LocalizedQuickAction[];
  selectedAction: LocalizedQuickAction | undefined;
  onActionSelect: (actionId: string) => void;
  onPromptSelect: (prompt: string) => void;
}

/**
 * Quiet Studio home. The idle stage is a centered column (greeting, caption,
 * input island, pills) with the footnote pinned to the panel. Opening a case
 * gallery replaces that stage with a fixed composer and an independent scroll
 * region, so cases never paint a second background behind the greeting.
 */
export function HomeStudio({
  header,
  composer,
  quickActions,
  selectedAction,
  onActionSelect,
  onPromptSelect,
}: HomeStudioProps) {
  const lead = i18nService.t(resolveHomeGreetingLead());
  const intent = i18nService.t('coworkHomeGreetingIntent');
  // Chinese leads already end with an ideographic comma; English needs a space.
  const greeting = `${lead}${lead.endsWith(',') ? ' ' : ''}${intent}`;

  return (
    <div
      data-page-canvas
      className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-background"
    >
      {header}
      {selectedAction ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pt-6">{composer}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-3xl flex-col px-6 pt-4 pb-8">
              <PromptPanel action={selectedAction} onPromptSelect={onPromptSelect} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-12">
            <div className="mb-8 flex w-full max-w-3xl flex-col items-center text-center">
              <h1 className="theme-home-greeting whitespace-nowrap">{greeting}</h1>
              <p className="theme-home-caption mt-2 max-w-3xl text-balance">
                {i18nService.t('coworkHomeSubtitle')}
              </p>
            </div>
            <div className="w-full max-w-3xl">{composer}</div>
            <div className="@container mt-5 w-full">
              <QuickActionBar actions={quickActions} onActionSelect={onActionSelect} />
            </div>
          </div>
          <p className="theme-home-footnote shrink-0 px-4 pb-3 text-center">
            {i18nService.t('coworkHomeFootnote')}
          </p>
        </div>
      )}
    </div>
  );
}
