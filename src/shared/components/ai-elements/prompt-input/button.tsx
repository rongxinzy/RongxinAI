// @ts-nocheck — third-party ai-elements component; @base-ui/react v1.6 type mismatch with ai-elements v1.9 (openDelay/closeDelay on PreviewCard, BaseUIEvent vs Event)
'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { InputGroupButton } from '@shared/components/ui/input-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@shared/components/ui/tooltip';
import { cn } from '@shared/lib/utils';
import { PlusIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Children } from 'react';

type PromptInputButtonTooltip =
  | string
  | {
      content: ReactNode;
      shortcut?: string;
      side?: ComponentProps<typeof TooltipContent>['side'];
    };

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton> & {
  tooltip?: PromptInputButtonTooltip;
};

export const PromptInputButton = ({
  variant = 'ghost',
  className,
  size,
  tooltip,
  ...props
}: PromptInputButtonProps) => {
  const newSize = size ?? (Children.count(props.children) > 1 ? 'sm' : 'icon-sm');

  const button = (
    <InputGroupButton
      className={cn(className)}
      size={newSize}
      type="button"
      variant={variant}
      {...props}
    />
  );

  if (!tooltip) {
    return button;
  }

  const tooltipContent = typeof tooltip === 'string' ? tooltip : tooltip.content;
  const shortcut = typeof tooltip === 'string' ? undefined : tooltip.shortcut;
  const side = typeof tooltip === 'string' ? 'top' : (tooltip.side ?? 'top');

  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      <TooltipContent side={side}>
        {tooltipContent}
        {shortcut && <span className="ml-2 text-muted-foreground">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
};

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>;
export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => (
  <DropdownMenu {...props} />
);

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps;

export const PromptInputActionMenuTrigger = ({
  className,
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => (
  <DropdownMenuTrigger render={<PromptInputButton className={className} {...props} />}>
    {children ?? <PlusIcon className="size-4" />}
  </DropdownMenuTrigger>
);

export type PromptInputActionMenuContentProps = ComponentProps<typeof DropdownMenuContent>;
export const PromptInputActionMenuContent = ({
  className,
  ...props
}: PromptInputActionMenuContentProps) => (
  <DropdownMenuContent align="start" className={cn(className)} {...props} />
);

export type PromptInputActionMenuItemProps = ComponentProps<typeof DropdownMenuItem>;
export const PromptInputActionMenuItem = ({
  className,
  ...props
}: PromptInputActionMenuItemProps) => <DropdownMenuItem className={cn(className)} {...props} />;

// Note: Actions that perform side-effects (like opening a file dialog)
// are provided in opt-in modules (e.g., prompt-input-attachments).
