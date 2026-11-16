import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { cn } from '@shared/lib/utils';
import { ChevronDown } from 'lucide-react';
import type * as React from 'react';

export interface StepsProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  children: React.ReactNode;
}

/**
 * Collapsible timeline group inspired by prompt-kit Steps / ChainOfThought.
 * Aggregates consecutive read-only exploration steps cleanly with a subtle
 * vertical guide line.
 */
export function Steps({
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  children,
}: StepsProps) {
  return (
    <Collapsible
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      className={cn('group/steps min-w-0 text-sm', className)}
    >
      {children}
    </Collapsible>
  );
}

export interface StepsTriggerProps extends React.ComponentProps<typeof CollapsibleTrigger> {
  leftIcon?: React.ReactNode;
  trailing?: React.ReactNode;
}

export function StepsTrigger({
  children,
  className,
  leftIcon,
  trailing,
  ...props
}: StepsTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        'theme-chat-tool-trigger group flex min-h-8 w-full cursor-pointer items-center justify-between gap-2 text-left text-sm text-muted-foreground',
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {leftIcon ? <span className="shrink-0">{leftIcon}</span> : null}
        <span className="min-w-0 truncate">{children}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {trailing}
        <ChevronDown className="theme-chat-tool-chevron size-4" />
      </span>
    </CollapsibleTrigger>
  );
}

export function StepsContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <CollapsibleContent className={cn('overflow-hidden pt-1', className)}>
      <div className="ml-2 flex min-w-0 flex-col gap-1 border-l border-border pl-3">{children}</div>
    </CollapsibleContent>
  );
}

export function StepsItem({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0 py-0.5 text-xs text-muted-foreground', className)}>{children}</div>
  );
}
