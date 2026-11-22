import { Button } from '@shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Ellipsis } from 'lucide-react';
import { i18nService } from '../../services/i18n';
import type { LocalizedQuickAction } from '../../types/quickAction';

interface QuickActionBarProps {
  actions: LocalizedQuickAction[];
  onActionSelect: (actionId: string) => void;
}

const featuredIds = new Set(['pptx', 'data-analysis', 'docs']);

export default function QuickActionBar({ actions, onActionSelect }: QuickActionBarProps) {
  if (!actions.length) return null;
  const featured = [
    ...actions.filter(action => featuredIds.has(action.id)),
    ...actions.filter(action => !featuredIds.has(action.id)),
  ].slice(0, 3);
  const remaining = actions.filter(action => !featured.includes(action));
  return (
    <div className="mx-auto flex w-full flex-wrap items-center justify-center gap-x-2">
      {featured.map(action => (
        <Button
          key={action.id}
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onActionSelect(action.id)}
        >
          {action.label}
        </Button>
      ))}
      {remaining.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={i18nService.t('homeMoreSuggestions')}
                title={i18nService.t('homeMoreSuggestions')}
              />
            }
          >
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {remaining.map(action => (
              <DropdownMenuItem key={action.id} onClick={() => onActionSelect(action.id)}>
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
