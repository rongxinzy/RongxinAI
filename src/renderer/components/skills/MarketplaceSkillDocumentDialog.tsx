import { Avatar, AvatarFallback, AvatarImage } from '@shared/components/ui/avatar';
import { Button } from '@shared/components/ui/button';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { CheckCircle, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { resolveLocalizedText } from '../../services/skill';
import { getSkillInitial, resolveSkillIconUrl } from '../../services/skillIcon';
import type { MarketplaceSkill } from '../../types/skill';
import MarkdownContent from '../MarkdownContent';

interface MarketplaceSkillDocumentDialogProps {
  skill: MarketplaceSkill;
  readOnly?: boolean;
  isInstalling: boolean;
  onClose: () => void;
  onInstall: (skill: MarketplaceSkill) => void;
  isInstalled: boolean;
}

export function MarketplaceSkillDocumentDialog({
  skill,
  readOnly,
  isInstalling,
  onClose,
  onInstall,
  isInstalled,
}: MarketplaceSkillDocumentDialogProps) {
  const [skillContent, setSkillContent] = useState('');
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [skillContentError, setSkillContentError] = useState(false);
  const [isContentReady, setIsContentReady] = useState(false);

  useEffect(() => {
    let active = true;
    setSkillContent('');
    setIsLoadingContent(true);
    setSkillContentError(false);
    setIsContentReady(false);
    const fetchContent = window.electron.skills.fetchMarketplaceContent;
    if (typeof fetchContent !== 'function') {
      setIsLoadingContent(false);
      setSkillContentError(true);
      return () => {
        active = false;
      };
    }
    Promise.resolve()
      .then(() => fetchContent(skill.id))
      .then(result => {
        if (!active) return;
        setSkillContent(result.success ? result.content || '' : '');
        setIsLoadingContent(false);
        window.setTimeout(() => {
          if (active) setIsContentReady(true);
        }, 50);
      })
      .catch(() => {
        if (active) {
          setIsLoadingContent(false);
          setSkillContentError(true);
        }
      });
    return () => {
      active = false;
    };
  }, [skill.id]);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/10 p-4"
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flex h-[min(32rem,calc(100%-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
        <header className="flex h-14 shrink-0 items-center justify-between px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="theme-scene-skill-document-avatar">
              {skill.iconUrl && <AvatarImage src={resolveSkillIconUrl(skill.iconUrl)} alt="" className="object-contain" />}
              <AvatarFallback className="theme-scene-skill-document-fallback">
                {getSkillInitial(skill.name)}
              </AvatarFallback>
            </Avatar>
            <h2 className="truncate text-base font-semibold text-foreground">
              {skill.name}
            </h2>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={i18nService.t('close')} onClick={onClose}>
            <X />
          </Button>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto max-w-3xl px-8 py-6">
            <p className="break-words text-sm text-muted-foreground">
              {resolveLocalizedText(skill.description)}
            </p>

            <dl className="mt-6 grid gap-4 text-sm leading-6">
              {skill.version && (
                <div>
                  <dt className="font-medium text-muted-foreground">
                    {i18nService.t('skillDetailVersion')}:
                  </dt>
                  <dd className="mt-1 text-foreground">v{skill.version}</dd>
                </div>
              )}
              {skill.source?.from && (
                <div>
                  <dt className="font-medium text-muted-foreground">
                    {i18nService.t('skillDetailSource')}:
                  </dt>
                  <dd className="mt-1 text-foreground">
                    {skill.source.from}
                    {skill.source.author ? ` · ${skill.source.author}` : ''}
                  </dd>
                </div>
              )}
              {skill.source?.url && (
                <div>
                  <dt className="font-medium text-muted-foreground">URL:</dt>
                  <dd className="mt-1 break-all text-foreground">
                    <Button
                      type="button"
                      variant="link"
                      className="theme-control-sizing-4 theme-control-content-height min-w-0 justify-start whitespace-normal text-left"
                      onClick={() => window.electron.shell.openExternal(skill.source.url)}
                    >
                      {skill.source.url}
                    </Button>
                  </dd>
                </div>
              )}
            </dl>
            <section className="mt-6 min-w-0">
              {isLoadingContent ? (
                <div className="py-3 text-sm text-muted-foreground">{i18nService.t('loading')}</div>
              ) : skillContent && isContentReady ? (
                <MarkdownContent content={skillContent} />
              ) : skillContentError ? (
                <p className="text-sm text-muted-foreground">
                  {i18nService.t('skillContentUnavailable')}
                </p>
              ) : null}
            </section>
          </div>
        </ScrollArea>

        <div className="flex shrink-0 items-center justify-end gap-4 px-6 pb-6 pt-4">
          {isInstalled ? (
            <div className="flex items-center justify-center gap-1.5 rounded-xl bg-green-500/10 py-2.5 text-sm font-medium text-green-600 dark:text-green-400">
              <CheckCircle className="h-4 w-4" />
              {i18nService.t('skillAlreadyInstalled')}
            </div>
          ) : !readOnly && skill.installSource ? (
            <Button type="button" size="sm" onClick={() => onInstall(skill)} disabled={isInstalling}>
              <Plus data-icon="inline-start" />
              {isInstalling
                ? i18nService.t('skillInstalling')
                : i18nService.t('skillInstallSkill')}
            </Button>
          ) : null}
        </div>
      </section>
    </div>
  );
}
