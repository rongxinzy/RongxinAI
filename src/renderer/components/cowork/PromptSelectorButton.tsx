import { PromptInputButton } from '@shared/components/ai-elements/prompt-input';
import { cn } from '@shared/lib/utils';
import { ChevronDown } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';

type PromptSelectorButtonProps = Omit<
  ComponentProps<typeof PromptInputButton>,
  'children' | 'size' | 'variant'
> & {
  label: string;
  icon: ReactNode;
  compact?: boolean;
};

/** Shared trigger geometry; callers own menu state and selection behavior. */
export function PromptSelectorButton({
  label,
  icon,
  compact = false,
  className,
  ...props
}: PromptSelectorButtonProps) {
  return (
    <PromptInputButton
      {...props}
      variant="prompt-selector"
      size="sm"
      aria-label={label}
      className={cn('min-w-0 max-w-48 gap-1.5', className)}
    >
      <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
      {!compact && <span className="min-w-0 truncate">{label}</span>}
      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
    </PromptInputButton>
  );
}
