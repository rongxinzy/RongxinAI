import { Button } from '@shared/components/ui/button';
import { Checkbox } from '@shared/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import { Switch } from '@shared/components/ui/switch';
import { Ellipsis, MessageCircle, Pin, Puzzle, Trash2 } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import type { Skill } from '../../types/skill';

interface InstalledSkillGridProps {
  skills: Skill[];
  readOnly?: boolean;
  onSelect: (skill: Skill) => void;
  onToggle: (skillId: string) => void;
  onUninstall: (skill: Skill) => void;
  onTogglePin: (skillId: string) => void;
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
  onUninstall,
  onTogglePin,
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
          role="button"
          tabIndex={0}
          className="group cursor-pointer gap-3 border border-border ring-0 transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={event => {
            const target = event.target as HTMLElement;
            if (target.closest('button, [role="switch"], [data-slot="switch"]')) return;
            onSelect(skill);
          }}
          onKeyDown={event => {
            const target = event.target as HTMLElement;
            if (target.closest('button, [role="switch"], [data-slot="switch"]')) return;
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onSelect(skill);
            }
          }}
        >
          <CardHeader className="grid-cols-[minmax(0,1fr)_auto] gap-3 p-0">
            <div className="flex min-w-0 items-center gap-2">
              {batchMode && (
                <Checkbox
                  checked={selectedIds.has(skill.id)}
                  aria-label={skill.name}
                  onClick={event => event.stopPropagation()}
                  onCheckedChange={() => onSelectToggle(skill.id)}
                />
              )}
              <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                {skill.iconUrl ? (
                  <img src={skill.iconUrl} alt="" className="size-6 object-contain" />
                ) : (
                  <Puzzle className="size-4 text-muted-foreground" />
                )}
              </div>
              <CardTitle className="truncate">
                {skill.displayName || resolveName(skill.id, skill.name)}
              </CardTitle>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={i18nService.t('skillActions')}
                        onClick={event => event.stopPropagation()}
                      >
                        <Ellipsis />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      disabled={!onTrySkill}
                      onClick={() => onTrySkill?.(skill.id)}
                    >
                      <MessageCircle />
                      {i18nService.t('skillGoToConversation')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      disabled={skill.isBuiltIn}
                      onClick={() => onUninstall(skill)}
                    >
                      <Trash2 />
                      {i18nService.t('skillUninstall')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={i18nService.t(skill.pinned ? 'skillUnpin' : 'skillPin')}
                  onClick={event => {
                    event.stopPropagation();
                    onTogglePin(skill.id);
                  }}
                >
                  <Pin className={skill.pinned ? 'fill-current' : undefined} />
                </Button>
              </div>
              <div
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

          <CardContent className="flex flex-col gap-3 p-0">
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
