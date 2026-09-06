import { Avatar, AvatarFallback, AvatarImage } from '@shared/components/ui/avatar';
import { Button } from '@shared/components/ui/button';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Switch } from '@shared/components/ui/switch';
import { MessageCircle, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { i18nService } from '../../services/i18n';
import { getSkillInitial, resolveSkillIconUrl } from '../../services/skillIcon';
import type { Skill } from '../../types/skill';
import { isCoreSkill } from '@shared/skills/constants';
import MarkdownContent from '../MarkdownContent';

interface SkillDocumentDialogProps {
  skill: Skill;
  readOnly?: boolean;
  onClose: () => void;
  onToggle: (skillId: string) => void;
  onTrySkill?: (skillId: string) => void;
  onRequestDelete: (skill: Skill) => void;
}

const METADATA_LABEL_KEYS: Record<string, string> = {
  name: 'skillMetadataName',
  description: 'skillMetadataDescription',
  author: 'skillMetadataAuthor',
  license: 'skillMetadataLicense',
};

const SKILL_CONTENT_CHUNK_SIZE = 7000;
const SKILL_CONTENT_CHUNK_DELAY_MS = 16;

const getMetadataLabel = (key: string): string => {
  const translationKey = METADATA_LABEL_KEYS[key.toLowerCase()];
  return translationKey ? i18nService.t(translationKey) : key;
};

const getMetadataEntries = (skill: Skill): Array<[string, string]> => {
  const primaryEntries: Array<[string, string]> = [
    ['name', skill.displayName || skill.name],
    ['description', skill.displayDescription || skill.description],
    ...(skill.displayAuthor ? [['author', skill.displayAuthor] as [string, string]] : []),
    ...(skill.displayLicense ? [['license', skill.displayLicense] as [string, string]] : []),
  ];
  const primaryKeys = new Set(primaryEntries.map(([key]) => key.toLowerCase()));
  return [
    ...primaryEntries,
    ...Object.entries(skill.metadataFields ?? {}).filter(
      ([key]) => !primaryKeys.has(key.toLowerCase()),
    ),
  ];
};

export function SkillDocumentDialog({
  skill,
  readOnly,
  onClose,
  onToggle,
  onTrySkill,
  onRequestDelete,
}: SkillDocumentDialogProps) {
  const [skillContent, setSkillContent] = useState(skill.prompt || '');
  const [isLoadingSkillContent, setIsLoadingSkillContent] = useState(!skill.prompt);
  const [skillContentError, setSkillContentError] = useState(false);
  const [isContentReady, setIsContentReady] = useState(false);

  useEffect(() => {
    let active = true;
    const inlineContent = skill.prompt?.trim() || '';
    setSkillContent(inlineContent.slice(0, SKILL_CONTENT_CHUNK_SIZE));
    setSkillContentError(false);
    setIsLoadingSkillContent(!inlineContent);
    setIsContentReady(Boolean(inlineContent));

    if (inlineContent) {
      let offset = Math.min(SKILL_CONTENT_CHUNK_SIZE, inlineContent.length);
      const appendInlineChunk = () => {
        if (!active || offset >= inlineContent.length) return;
        const nextOffset = Math.min(offset + SKILL_CONTENT_CHUNK_SIZE, inlineContent.length);
        setSkillContent(current => current + inlineContent.slice(offset, nextOffset));
        offset = nextOffset;
        if (offset < inlineContent.length) {
          window.setTimeout(appendInlineChunk, SKILL_CONTENT_CHUNK_DELAY_MS);
        }
      };
      if (offset < inlineContent.length) {
        window.setTimeout(appendInlineChunk, SKILL_CONTENT_CHUNK_DELAY_MS);
      }
      return () => {
        active = false;
      };
    }

    setIsLoadingSkillContent(true);

    const loadSkillContent = async () => {
      try {
        const result = await window.electron.skills.getContent(skill.id);
        if (!active) return;
        if (result.success) {
          const content = result.content || '';
          setSkillContent(content.slice(0, SKILL_CONTENT_CHUNK_SIZE));
          setIsContentReady(true);
          let offset = SKILL_CONTENT_CHUNK_SIZE;
          const appendChunk = () => {
            if (!active || offset >= content.length) return;
            const nextOffset = Math.min(offset + SKILL_CONTENT_CHUNK_SIZE, content.length);
            const chunk = content.slice(offset, nextOffset);
            setSkillContent(current => current + chunk);
            offset = nextOffset;
            if (offset < content.length) {
              window.setTimeout(appendChunk, SKILL_CONTENT_CHUNK_DELAY_MS);
            }
          };
          if (content.length > SKILL_CONTENT_CHUNK_SIZE) {
            window.setTimeout(appendChunk, SKILL_CONTENT_CHUNK_DELAY_MS);
          }
        } else {
          setSkillContentError(true);
        }
      } catch {
        if (active) setSkillContentError(true);
      } finally {
        if (active) setIsLoadingSkillContent(false);
      }
    };

    void loadSkillContent();
    return () => {
      active = false;
    };
  }, [skill.id, skill.prompt]);

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/10 p-4"
      onPointerDown={event => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flex h-[min(32rem,calc(100%-3rem))] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar className="theme-scene-skill-document-avatar">
              {skill.iconUrl && (
                <AvatarImage
                  src={resolveSkillIconUrl(skill.iconUrl)}
                  alt=""
                  className="object-contain"
                />
              )}
              <AvatarFallback className="theme-scene-skill-document-fallback">
                {getSkillInitial(skill.displayName || skill.name)}
              </AvatarFallback>
            </Avatar>
            <h2 className="truncate text-base font-semibold text-foreground">
              {skill.displayName || skill.name}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Switch
              checked={skill.enabled}
              disabled={readOnly || isCoreSkill(skill.id)}
              title={isCoreSkill(skill.id) ? i18nService.t('skillCoreAlwaysOn') : undefined}
              aria-label={skill.displayName || skill.name}
              onCheckedChange={() => onToggle(skill.id)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={i18nService.t('close')}
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="flex min-w-0 flex-col gap-5 px-8 py-5">
            <dl className="grid gap-4 text-sm leading-6">
              {getMetadataEntries(skill)
                .filter(([key]) => key.toLowerCase() !== 'skillmd')
                .map(([key, value]) => (
                  <div key={key}>
                    <dt className="font-medium text-muted-foreground">{getMetadataLabel(key)}:</dt>
                    <dd className="mt-1 whitespace-pre-wrap break-words text-foreground">
                      {value}
                    </dd>
                  </div>
                ))}
            </dl>

            <section className="min-w-0">
              {isLoadingSkillContent ? (
                <div className="py-3 text-sm text-muted-foreground">{i18nService.t('loading')}</div>
              ) : skillContentError || !skillContent ? (
                <p className="text-sm text-muted-foreground">
                  {i18nService.t('skillContentUnavailable')}
                </p>
              ) : isContentReady ? (
                <MarkdownContent content={skillContent} />
              ) : (
                <div className="py-3 text-sm text-muted-foreground">{i18nService.t('loading')}</div>
              )}
            </section>
          </div>
        </ScrollArea>

        <footer className="flex shrink-0 items-center justify-between px-6 pb-5 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={readOnly}
            className="theme-page-skill-document-dialog-button-1"
            onClick={() => onRequestDelete(skill)}
          >
            <Trash2 data-icon="inline-start" />
            {i18nService.t('skillUninstall')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!onTrySkill}
            onClick={() => onTrySkill?.(skill.id)}
          >
            <MessageCircle data-icon="inline-start" />
            {i18nService.t('skillUseNow')}
          </Button>
        </footer>
      </section>
    </div>
  );
}
