import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Spinner } from '@shared/components/ui/spinner';
import { Download, MessageCircle } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import { ExpertAvatar } from './expertAvatars';

export interface PresetExpertSummary {
  name: string;
  displayName: { en: string; zh: string };
  profession: { en: string; zh: string };
  displayDescription: { en: string; zh: string };
  categoryId: string;
  tags: Array<{ en: string; zh: string }>;
  quickPrompts: Array<{ en: string; zh: string }>;
  workflow: string[];
  path: string;
}

interface ExpertDetailDialogProps {
  expert: PresetExpertSummary | null;
  isInstalling: boolean;
  isInstalled: boolean;
  onClose: () => void;
  onInstall: (expert: PresetExpertSummary) => void | Promise<void>;
  onChat: () => void;
}

export function ExpertDetailDialog({
  expert,
  isInstalling,
  isInstalled,
  onClose,
  onInstall,
  onChat,
}: ExpertDetailDialogProps) {
  if (!expert) return null;

  const isZh = i18nService.getLanguage() === 'zh';
  const displayName = isZh ? expert.displayName.zh : expert.displayName.en;
  const workScope = isZh ? expert.displayDescription.zh : expert.displayDescription.en;
  const workflow = expert.workflow ?? [];

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="theme-control-sizing-4 flex max-h-[min(720px,calc(100vh-2rem))] w-[min(640px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden">
        <DialogHeader className="theme-part-expert-detail-dialog-dialog-header-1 flex-row items-center">
          <ExpertAvatar name={expert.name} label={displayName} />
          <div className="min-w-0">
            <DialogTitle className="theme-part-expert-detail-dialog-dialog-title-1 truncate">
              {displayName}
            </DialogTitle>
            <DialogDescription className="sr-only">{workScope}</DialogDescription>
          </div>
        </DialogHeader>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 px-6 py-5">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">
                {i18nService.t('expertWorkScope')}
              </h3>
              <p className="text-sm leading-6 text-muted-foreground">{workScope}</p>
            </section>

            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-foreground">
                {i18nService.t('expertWorkflow')}
              </h3>
              {workflow.length > 0 ? (
                <ol className="flex flex-col gap-3">
                  {workflow.map((step, index) => (
                    <li key={`${index}-${step}`} className="flex items-start gap-3 text-sm">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="pt-0.5 text-foreground">{step}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {i18nService.t('expertWorkflowUnavailable')}
                </p>
              )}
            </section>
          </div>
        </ScrollArea>

        <DialogFooter className="theme-part-expert-detail-dialog-dialog-footer-1 m-0">
          <Button
            type="button"
            disabled={isInstalling}
            onClick={() => (isInstalled ? onChat() : void onInstall(expert))}
          >
            {isInstalling ? (
              <Spinner data-icon="inline-start" />
            ) : isInstalled ? (
              <MessageCircle data-icon="inline-start" />
            ) : (
              <Download data-icon="inline-start" />
            )}
            {isInstalling
              ? i18nService.t('expertInstalling')
              : isInstalled
                ? i18nService.t('expertGoToConversation')
                : i18nService.t('expertInstall')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
