import { cn } from '@shared/lib/utils';

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
}

/**
 * Subtle right-edge jump rail rendered for long sessions (>= 6 turns).
 */
export function TurnNavigator({
  items,
  activeTurnId,
  onSelectTurn,
  className,
}: TurnNavigatorProps) {
  if (items.length < 6) return null;

  return (
    <nav
      aria-label="Conversation turns"
      className={cn('hidden xl:flex flex-col items-end gap-1.5 py-2 pr-1.5 select-none', className)}
    >
      {items.map(item => {
        const isActive = activeTurnId === item.id;
        return (
          <button
            key={item.id}
            type="button"
            title={item.label}
            aria-label={item.label}
            onClick={() => onSelectTurn(item.id, item.index)}
            className={cn(
              'group flex h-2.5 cursor-pointer items-center justify-end px-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xs',
            )}
          >
            <span
              className={cn(
                'h-0.5 rounded-full transition-[width,background-color] duration-150',
                isActive
                  ? 'w-4 bg-foreground'
                  : 'w-2 bg-muted-foreground/40 group-hover:w-3.5 group-hover:bg-foreground/70',
                item.state === 'approval' && 'w-3.5 bg-warning',
                item.state === 'error' && 'w-3.5 bg-destructive',
                item.state === 'streaming' && 'w-4 bg-primary',
              )}
            />
          </button>
        );
      })}
    </nav>
  );
}
