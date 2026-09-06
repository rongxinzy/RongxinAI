import { Avatar, AvatarFallback, AvatarImage } from '@shared/components/ui/avatar';
import { Button } from '@shared/components/ui/button';
import { Card } from '@shared/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import { Progress } from '@shared/components/ui/progress';
import { cn } from '@shared/lib/utils';
import { Download } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import { PlusMenuSkillsIcon } from '../cowork/plusMenuIcons';
import { resolveLocalizedText } from '../../services/skill';
import { getSkillInitial, resolveSkillIconUrl } from '../../services/skillIcon';
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
  isDetailOpen?: boolean;
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
  isDetailOpen = false,
}: MarketplaceSkillGridProps) {
  if (skills.length === 0) {
    return (
      <Empty className="min-h-48 border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PlusMenuSkillsIcon />
          </EmptyMedia>
          <EmptyTitle>{i18nService.t('skillMarketplaceEmpty')}</EmptyTitle>
          <EmptyDescription>{i18nService.t('skillMarketplaceEmptyDescription')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
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
            className={cn(
              'theme-page-marketplace-skill-grid-card-variant-1 group relative flex-row items-center',
              isInstallingSkillId &&
                !isInstalling &&
                'theme-page-marketplace-skill-grid-card-variant-2 pointer-events-none',
            )}
          >
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={Boolean(isInstallingSkillId && !isInstalling)}
              className="theme-page-marketplace-skill-grid-button-1 min-w-0 flex-1 shrink justify-start text-left whitespace-normal"
              onClick={() => onSelect(skill)}
            >
              <Avatar className="theme-scene-skill-avatar shrink-0">
                {skill.iconUrl && (
                  <AvatarImage
                    src={resolveSkillIconUrl(skill.iconUrl)}
                    alt=""
                    className="m-auto size-8 rounded-lg object-contain"
                  />
                )}
                <AvatarFallback className="theme-scene-skill-fallback">
                  {getSkillInitial(skill.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{skill.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {resolveLocalizedText(skill.description)}
                </p>
              </div>
            </Button>

            <div className="flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
                    onClick={() => onInstall(skill)}
                  >
                    <Download data-icon="inline-start" />
                    {isInstalling
                      ? i18nService.t('skillInstalling')
                      : i18nService.t('skillInstall')}
                  </Button>
                )
              )}
            </div>

            {isInstalling && !isDetailOpen && (
              <Progress
                value={installProgress}
                aria-label={`${i18nService.t('skillInstalling')} ${installProgress}%`}
                className="theme-scene-skill-progress absolute bottom-0 left-0 w-full gap-0"
              />
            )}
          </Card>
        );
      })}
    </div>
  );
}
