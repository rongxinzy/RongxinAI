import { cn } from '@shared/lib/utils';
import { Button } from '@shared/components/ui/button';

export interface TurnNavigatorItem {
  id: string;
  index: number;
  label: string;
  state?: 'idle' | 'streaming' | 'approval' | 'error';
}

export interface TurnNavigatorProps {
  items: TurnNavigatorItem[];
  activeTurnId?: string | null;
  onSelectTurn: (turnId: string, index: number) => void;
  className?: string;
  label?: string;
}

/**
 * Subtle right-edge jump rail rendered for long sessions (>= 6 turns).
 */
export function TurnNavigator({
  items,
  activeTurnId,
  onSelectTurn,
  className,
  label = 'Conversation turns',
}: TurnNavigatorProps) {
  if (items.length < 6) return null;

  return (
    <nav
      aria-label={label}
      className={cn(
        'hidden xl:flex max-h-full flex-col items-end gap-1 overflow-y-auto py-2 select-none',
        className,
      )}
    >
      {items.map(item => {
        const isActive = activeTurnId === item.id;
        return (
          <Button
            variant="ghost"
            size="icon"
            key={item.id}
            type="button"
            title={item.label}
            aria-label={item.label}
            onClick={() => onSelectTurn(item.id, item.index)}
            aria-current={isActive ? 'step' : undefined}
            data-turn-state={item.state}
          >
            <span className="theme-conversation-turn-marker" />
          </Button>
        );
      })}
    </nav>
  );
}
