import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import { Switch } from '@shared/components/ui/switch';
import { MessageCircle, Puzzle } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import type { Skill } from '../../types/skill';

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
  if (skills.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {skills.map(skill => (
        <Card
          key={skill.id}
          size="sm"
          className="group relative gap-3 border border-border ring-0 transition-[transform,box-shadow,background-color] duration-200 ease-out hover:z-10 hover:scale-[1.02] hover:bg-muted hover:shadow-md"
        >
          {!batchMode && (
            <button
              type="button"
              aria-label={skill.displayName || resolveName(skill.id, skill.name)}
              className="absolute inset-0 z-0 rounded-[inherit] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => onSelect(skill)}
            />
          )}
          <CardHeader className="relative z-10 grid-cols-[minmax(0,1fr)_auto] gap-3 p-0">
            <div className="pointer-events-none flex min-w-0 items-center gap-2">
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
              <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {skill.iconUrl ? (
                  <img src={skill.iconUrl} alt="" className="size-8 object-contain" />
                ) : (
                  <Puzzle className="size-4 text-muted-foreground" />
                )}
              </div>
              <CardTitle className="truncate">
                {skill.displayName || resolveName(skill.id, skill.name)}
              </CardTitle>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-skill-action
                disabled={!onTrySkill}
                onPointerDownCapture={event => {
                  // Start navigation before the card's click handler can open the metadata dialog.
                  event.preventDefault();
                  event.stopPropagation();
                  onTrySkill?.(skill.id);
                }}
                onClickCapture={event => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onKeyDownCapture={event => {
                  event.stopPropagation();
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onTrySkill?.(skill.id);
                  }
                }}
              >
                <MessageCircle data-icon="inline-start" />
                {i18nService.t('skillGoToConversation')}
              </Button>
              <div
                data-skill-toggle
                onPointerDown={event => event.stopPropagation()}
                onClick={event => event.stopPropagation()}
                onKeyDown={event => event.stopPropagation()}
              >
                <Switch
                  checked={skill.enabled}
                  disabled={readOnly}
                  onCheckedChange={() => onToggle(skill.id)}
                />
              </div>
            </div>
          </CardHeader>

          <CardContent className="pointer-events-none relative z-10 flex flex-col gap-3 p-0">
            <CardDescription className="line-clamp-2">
              {skill.displayDescription ||
                skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description)}
            </CardDescription>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
