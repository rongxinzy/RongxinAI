import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import { Card } from '@shared/components/ui/card';
import { Switch } from '@shared/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@shared/components/ui/avatar';
import { MessageCircle } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { getSkillInitial, resolveSkillIconUrl } from '../../services/skillIcon';
import type { Skill } from '../../types/skill';
import { isCoreSkill } from '@shared/skills/constants';

interface InstalledSkillGridProps {
  skills: Skill[];
  readOnly?: boolean;
  onSelect: (skill: Skill) => void;
  onToggle: (skillId: string) => void;
  onTrySkill?: (skillId: string) => void;
  resolveName: (id: string, fallback: string) => string;
  selectedIds: Set<string>;
  onSelectToggle: (skillId: string) => void;
  batchMode?: boolean;
}

export function InstalledSkillGrid({
  skills,
  readOnly,
  onSelect,
  onToggle,
  onTrySkill,
  resolveName,
  selectedIds,
  onSelectToggle,
  batchMode = false,
}: InstalledSkillGridProps) {
  if (skills.length === 0) return null;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {skills.map(skill => {
        const name = skill.displayName || resolveName(skill.id, skill.name);
        const description =
          skill.displayDescription ||
          skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description);

        return (
          <Card
            key={skill.id}
            size="sm"
            className="theme-page-installed-skill-grid-card-1 group relative flex-row items-center"
          >
            {!batchMode && (
              <Button
                type="button"
                variant="ghost"
                aria-label={name}
                className="theme-page-installed-skill-grid-button-1 absolute inset-0 z-0"
                onClick={() => onSelect(skill)}
              />
            )}

            <div className="pointer-events-none relative z-10 flex min-w-0 flex-1 items-center gap-2">
              {batchMode && (
                <Checkbox
                  className="pointer-events-auto"
                  checked={selectedIds.has(skill.id)}
                  aria-label={skill.name}
                  onPointerDown={event => event.stopPropagation()}
                  onClick={event => event.stopPropagation()}
                  onCheckedChange={() => onSelectToggle(skill.id)}
                />
              )}
              <SkillIcon skill={skill} />
              <SkillText name={name} description={description} />
            </div>

            <div className="pointer-events-none relative z-10 flex shrink-0 items-center gap-1.5 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100">
              {skill.enabled && onTrySkill && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={i18nService.t('skillGoToConversation')}
                  title={i18nService.t('skillGoToConversation')}
                  onClick={() => onTrySkill(skill.id)}
                >
                  <MessageCircle />
                </Button>
              )}
              <Switch
                checked={skill.enabled}
                disabled={readOnly || isCoreSkill(skill.id)}
                title={isCoreSkill(skill.id) ? i18nService.t('skillCoreAlwaysOn') : undefined}
                aria-label={
                  skill.enabled
                    ? i18nService.t('skillBatchDisable')
                    : i18nService.t('skillBatchEnable')
                }
                onCheckedChange={() => onToggle(skill.id)}
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}

function SkillIcon({ skill }: { skill: Skill }) {
  return (
    <Avatar className="size-10 shrink-0 rounded-xl bg-muted">
      {skill.iconUrl && (
        <AvatarImage
          src={resolveSkillIconUrl(skill.iconUrl)}
          alt=""
          className="m-auto size-8 rounded-lg object-contain"
        />
      )}
      <AvatarFallback className="rounded-lg text-xl font-semibold text-muted-foreground">
        {getSkillInitial(skill.displayName || skill.name)}
      </AvatarFallback>
    </Avatar>
  );
}

function SkillText({ name, description }: { name: string; description: string }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-foreground">{name}</p>
      <p className="truncate text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
