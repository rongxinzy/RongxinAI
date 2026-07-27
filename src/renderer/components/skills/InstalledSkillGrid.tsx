import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import { Switch } from '@shared/components/ui/switch';
import { MessageCircle, Puzzle } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { resolveSkillIconUrl } from '../../services/skillIcon';
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
          className="group relative gap-0 border border-border ring-0 transition-[transform,box-shadow,background-color] duration-200 ease-out hover:z-10 hover:scale-[1.02] hover:bg-muted hover:shadow-md"
        >
          {!batchMode && (
            <button
              type="button"
              aria-label={skill.displayName || resolveName(skill.id, skill.name)}
              className="absolute inset-0 z-0 rounded-[inherit] focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              onClick={() => onSelect(skill)}
            />
          )}
          <CardHeader className="pointer-events-none relative z-10 grid-cols-[minmax(0,1fr)_auto] gap-3 p-0">
            <div className="pointer-events-none flex min-w-0 items-center gap-2 self-center">
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
              <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted">
                {skill.iconUrl ? (
                  <img src={resolveSkillIconUrl(skill.iconUrl)} alt="" className="size-8 object-contain" />
                ) : (
                  <Puzzle className="size-5 text-muted-foreground" />
                )}
              </div>
              <div className="min-w-0">
                <CardTitle className="truncate">
                  {skill.displayName || resolveName(skill.id, skill.name)}
                </CardTitle>
                <CardDescription className="truncate">
                  {skill.displayDescription ||
                    skillService.getLocalizedSkillDescription(
                      skill.id,
                      skill.name,
                      skill.description,
                    )}
                </CardDescription>
              </div>
            </div>
            <div className="pointer-events-none flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100">
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

        </Card>
      ))}
    </div>
  );
}
