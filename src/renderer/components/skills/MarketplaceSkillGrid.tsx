import { Button } from '@shared/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { cn } from '@shared/lib/utils';
import { Download, Puzzle } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import { resolveLocalizedText } from '../../services/skill';
import type { MarketplaceSkill } from '../../types/skill';

interface MarketplaceSkillGridProps {
  skills: MarketplaceSkill[];
  installedSkillIds: ReadonlySet<string>;
  installedSkillNames: ReadonlySet<string>;
  isInstallingSkillId: string | null;
  readOnly?: boolean;
  onSelect: (skill: MarketplaceSkill) => void;
  onInstall: (skill: MarketplaceSkill) => void;
  installProgress: number;
}

export function MarketplaceSkillGrid({
  skills,
  installedSkillIds,
  installedSkillNames,
  isInstallingSkillId,
  readOnly,
  onSelect,
  onInstall,
  installProgress,
}: MarketplaceSkillGridProps) {
  if (skills.length === 0) {
    return (
      <Empty className="min-h-48 border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Puzzle />
          </EmptyMedia>
          <EmptyTitle>{i18nService.t('skillMarketplaceEmpty')}</EmptyTitle>
          <EmptyDescription>{i18nService.t('skillMarketplaceEmptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {skills.map(skill => {
        const normalizedName = skill.name
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '-');
        const isInstalled =
          installedSkillIds.has(skill.id) || installedSkillNames.has(normalizedName);
        const isInstalling = isInstallingSkillId === skill.id;

        return (
          <Card
            key={skill.id}
            size="sm"
            role="button"
            tabIndex={0}
            className={cn(
              'relative gap-3 overflow-hidden transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
              isInstallingSkillId && !isInstalling
                ? 'pointer-events-none opacity-50'
                : 'cursor-pointer hover:bg-muted',
            )}
            onClick={() => onSelect(skill)}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(skill);
              }
            }}
          >
            <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-3 p-0">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Puzzle className="size-4 text-muted-foreground" />
                </div>
                <CardTitle className="truncate">{skill.name}</CardTitle>
              </div>
              {isInstalled ? (
                <span className="text-xs text-muted-foreground">
                  {i18nService.t('skillAlreadyInstalled')}
                </span>
              ) : (
                !readOnly &&
                skill.installSource && (
                  <Button
                    type="button"
                    size="xs"
                    disabled={isInstalling}
                    onClick={event => {
                      event.stopPropagation();
                      onInstall(skill);
                    }}
                  >
                    <Download data-icon="inline-start" />
                    {isInstalling
                      ? i18nService.t('skillInstalling')
                      : i18nService.t('skillInstall')}
                  </Button>
                )
              )}
            </CardHeader>

            <CardContent className="flex flex-col gap-3 p-0">
              <CardDescription className="line-clamp-2">
                {resolveLocalizedText(skill.description)}
              </CardDescription>
              {isInstalling && (
                <div className="absolute left-8 right-24 top-[42%] z-20 -translate-y-1/2">
                  <div className="mb-1 text-center text-xs font-medium text-foreground">
                    {installProgress}%
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${installProgress}%` }}
                    />
                  </div>
                </div>
              )}
              {isInstalling && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 right-20 z-10 bg-background/25 backdrop-blur-[2px]"
                />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
