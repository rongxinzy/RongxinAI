import { Button } from '@shared/components/ui/button';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { FileText, X } from 'lucide-react';
import { useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { Skill } from '../../types/skill';
import MarkdownContent from '../MarkdownContent';

interface SkillDocumentDialogProps {
  skill: Skill;
  onClose: () => void;
}

const getMetadataEntries = (skill: Skill): Array<[string, string]> => {
  const primaryEntries: Array<[string, string]> = [
    ['name', skill.displayName || skill.name],
    ['description', skill.displayDescription || skill.description],
    ...(skill.displayAuthor ? [['author', skill.displayAuthor] as [string, string]] : []),
    ...(skill.displayLicense ? [['license', skill.displayLicense] as [string, string]] : []),
  ];
  const primaryKeys = new Set(primaryEntries.map(([key]) => key.toLowerCase()));
  const extraEntries = Object.entries(skill.metadataFields ?? {}).filter(
    ([key]) => !primaryKeys.has(key.toLowerCase()),
  );
  return [...primaryEntries, ...extraEntries];
};

const METADATA_LABEL_KEYS: Record<string, string> = {
  name: 'skillMetadataName',
  description: 'skillMetadataDescription',
  author: 'skillMetadataAuthor',
  license: 'skillMetadataLicense',
};

const getMetadataLabel = (key: string): string => {
  const translationKey = METADATA_LABEL_KEYS[key.toLowerCase()];
  return translationKey ? i18nService.t(translationKey) : key;
};

export function SkillDocumentDialog({
  skill,
  onClose,
}: SkillDocumentDialogProps) {
  const [showSkillContent, setShowSkillContent] = useState(false);
  const [skillContent, setSkillContent] = useState('');
  const [isLoadingSkillContent, setIsLoadingSkillContent] = useState(false);
  const [skillContentError, setSkillContentError] = useState(false);

  const handleToggleSkillContent = async () => {
    if (showSkillContent) {
      setShowSkillContent(false);
      return;
    }
    setShowSkillContent(true);
    if (skillContent || isLoadingSkillContent) return;

    setIsLoadingSkillContent(true);
    setSkillContentError(false);
    try {
      const result = await window.electron.skills.getContent(skill.id);
      if (result.success) {
        setSkillContent(result.content || '');
      } else {
        setSkillContentError(true);
      }
    } catch {
      setSkillContentError(true);
    } finally {
      setIsLoadingSkillContent(false);
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/10 p-4">
      <section className="flex h-[min(38rem,calc(100%-2rem))] w-full max-w-3xl flex-col gap-0 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-foreground">
            {skill.displayName || skill.name}
          </h2>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={i18nService.t('close')}
          onClick={onClose}
        >
          <X />
        </Button>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto max-w-3xl px-8 py-6">
          <dl className="m-0 grid gap-4 text-sm leading-6">
            {getMetadataEntries(skill)
              .filter(([key]) => key.toLowerCase() !== 'skillmd')
              .map(([key, value]) => (
                <div key={key}>
                  <dt className="font-medium text-muted-foreground">{getMetadataLabel(key)}:</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words text-foreground">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 border-t border-border pt-4">
              <Button type="button" variant="outline" size="sm" onClick={handleToggleSkillContent}>
                <FileText data-icon="inline-start" />
                {i18nService.t(showSkillContent ? 'skillHideSkillMd' : 'skillViewSkillMd')}
              </Button>
              {showSkillContent && (
                <section className="mt-4 border-t border-border pt-4">
                  {isLoadingSkillContent ? (
                    <div className="py-4 text-sm text-muted-foreground">
                      {i18nService.t('loading')}
                    </div>
                  ) : skillContentError ? (
                    <p className="text-sm text-destructive">
                      {i18nService.t('skillContentUnavailable')}
                    </p>
                  ) : skillContent ? (
                    <MarkdownContent content={skillContent} />
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      {i18nService.t('skillContentUnavailable')}
                    </p>
                  )}
                </section>
              )}
            </div>
          </div>
        </ScrollArea>
      </section>
    </div>
  );
}
