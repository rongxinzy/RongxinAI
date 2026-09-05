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
      className={cn(
        'flex size-full flex-col overflow-hidden rounded-xl! bg-popover p-1 text-popover-foreground',
        className,
      )}
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
        className={cn('top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0', className)}
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
        className={cn(
          'h-12 w-full shrink-0 border-0 bg-transparent px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground',
          className,
        )}
        {...props}
      />
    );
  }
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup
        className="h-8! rounded-lg! border-input/30 bg-surface-raised shadow-none! *:data-[slot=input-group-addon]:pl-2!"
        data-slot="command-input-group"
      >
        <CommandPrimitive.Input
          data-slot="input-group-control"
          className={cn(
            'w-full text-sm outline-hidden bg-transparent disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-0 focus:border-0',
            className,
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 opacity-50" />
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
        'no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none',
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
      className={cn('py-6 text-center text-sm text-muted-foreground', className)}
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
      className={cn(
        'overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
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
      className={cn('-mx-1 h-px bg-border', className)}
      {...props}
    />
  );
}

function CommandItem({
  className,
  children,
  variant = 'default',
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item> & { variant?: 'default' | 'palette' }) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 hover:bg-muted hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 hover:*:[svg]:text-foreground",
        variant === 'palette' &&
          'h-8 in-data-[slot=dialog-content]:rounded-full! data-[selected=true]:bg-muted data-[selected=true]:text-foreground',
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
      className={cn(
        'ml-auto text-xs tracking-widest text-muted-foreground group-data-selected/command-item:text-foreground',
        className,
      )}
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
