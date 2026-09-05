import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { InputGroup, InputGroupAddon } from '@shared/components/ui/input-group';
import { cn } from '@shared/lib/utils';
import { Command as CommandPrimitive } from 'cmdk';
import { SearchIcon } from 'lucide-react';
import * as React from 'react';

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn('theme-command flex size-full flex-col overflow-hidden', className)}
      {...props}
    />
  );
}

function CommandDialog({
  title = 'Command Palette',
  description = 'Search for a command to run...',
  children,
  className,
  showCloseButton = false,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, 'children'> & {
  title?: string;
  description?: string;
  className?: string;
  showCloseButton?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          'theme-page-command-dialog-content-variant-1 top-1/3 translate-y-0 overflow-hidden',
          className,
        )}
        showCloseButton={showCloseButton}
      >
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & { variant?: 'default' | 'palette' }) {
  if (variant === 'palette') {
    return (
      <CommandPrimitive.Input
        data-slot="command-palette-input"
        className={cn('theme-command-palette-input w-full shrink-0', className)}
        {...props}
      />
    );
  }
  return (
    <div data-slot="command-input-wrapper" className="theme-piece-size-command-1">
      <InputGroup className="theme-command-input-group" data-slot="command-input-group">
        <CommandPrimitive.Input
          data-slot="input-group-control"
          className={cn('theme-command-input w-full disabled:cursor-not-allowed', className)}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="theme-piece-size-command-2 theme-command-search-icon shrink-0" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        'theme-command-list no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto',
        className,
      )}
      {...props}
    />
  );
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('theme-piece-size-command-3 theme-command-empty text-center', className)}
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn('theme-piece-size-command-4 theme-command-group overflow-hidden', className)}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('theme-piece-size-command-5 theme-command-separator -mx-1', className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item> & {
  variant?: 'default' | 'palette' | 'selector';
}) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'theme-command-item group/command-item relative flex cursor-default items-center select-none data-[disabled=true]:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0',
        variant === 'selector' && 'theme-command-item-selector',
        variant === 'palette' && 'theme-command-item-palette',
        className,
      )}
      {...props}
    >
      {children}
    </CommandPrimitive.Item>
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn('theme-command-shortcut ml-auto tracking-widest', className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};
