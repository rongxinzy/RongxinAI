import { Button } from '@shared/components/ui/button';
import { DialogTitle } from '@shared/components/ui/dialog';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { X } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import type { Skill } from '../../types/skill';
import Modal from '../common/Modal';
import MarkdownContent from '../MarkdownContent';

interface SkillDocumentDialogProps {
  skill: Skill;
  content: string;
  isLoading: boolean;
  onClose: () => void;
}

const getMetadataEntries = (skill: Skill): Array<[string, string]> => {
  return [
    ['name', skill.displayName || skill.name],
    ['description', skill.displayDescription || skill.description],
    ...(skill.displayAuthor ? [['author', skill.displayAuthor] as [string, string]] : []),
    ...(skill.displayLicense ? [['license', skill.displayLicense] as [string, string]] : []),
    ...Object.entries(skill.metadataFields ?? {}),
  ];
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
  content,
  isLoading,
  onClose,
}: SkillDocumentDialogProps) {
  return (
    <Modal
      onClose={onClose}
      overlayClassName="bg-black/10 backdrop-blur-none"
      className="flex h-[min(38rem,calc(100dvh-4rem))] w-full max-w-3xl flex-col gap-0 rounded-xl border border-border bg-surface p-0 shadow-lg sm:max-w-3xl"
    >
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
        <div className="min-w-0">
          <DialogTitle className="truncate text-base font-semibold text-foreground">
            {skill.displayName || skill.name}
          </DialogTitle>
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
          <div className="my-6 border-t border-border" />
          <section aria-label="SKILL.md">
            <div className="mb-4 text-sm font-semibold text-foreground">SKILL.md</div>
            {isLoading ? (
              <div className="py-8 text-sm text-muted-foreground">{i18nService.t('loading')}</div>
            ) : content ? (
              <MarkdownContent content={content} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description)}
              </p>
            )}
          </section>
        </div>
      </ScrollArea>

    </Modal>
  );
}
