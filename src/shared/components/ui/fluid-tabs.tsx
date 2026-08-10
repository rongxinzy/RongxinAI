'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '@shared/lib/utils';
import { motion } from 'motion/react';
import type React from 'react';

/**
 * Fluid segmented-tab interaction for compact filter controls.
 */

export interface FluidTabItem<Value extends string> {
  label: React.ReactNode;
  value: Value;
}

export const FluidTabsSize = {
  Small: 'sm',
  Default: 'default',
} as const;

export type FluidTabsSize = (typeof FluidTabsSize)[keyof typeof FluidTabsSize];

export interface FluidTabsProps<Value extends string> {
  'aria-label': string;
  className?: string;
  inactiveTabClassName?: string;
  listClassName?: string;
  showInactiveHoverIndicator?: boolean;
  size?: FluidTabsSize;
  items: readonly FluidTabItem<Value>[];
  onValueChange: (value: Value) => void;
  value: Value;
}

export function FluidTabs<Value extends string>({
  'aria-label': ariaLabel,
  className,
  inactiveTabClassName,
  listClassName,
  showInactiveHoverIndicator = false,
  size = FluidTabsSize.Small,
  items,
  onValueChange,
  value,
}: FluidTabsProps<Value>) {
  const sizeClasses = size === FluidTabsSize.Default
    ? { list: 'h-10', tab: 'h-8' }
    : { list: 'h-9', tab: 'h-7' };

  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={nextValue => onValueChange(nextValue as Value)}
      className={cn('inline-flex', className)}
    >
      <TabsPrimitive.List
        activateOnFocus
        aria-label={ariaLabel}
        className={cn('relative inline-flex items-center gap-0.5 rounded-lg bg-muted/80 p-1 select-none', sizeClasses.list, listClassName)}
      >
        {items.map(item => {
          const isActive = item.value === value;
          return (
            <TabsPrimitive.Tab
              key={item.value}
              value={item.value}
              className={cn(
                'group relative z-10 flex min-w-16 cursor-pointer items-center justify-center rounded-md px-3 text-sm leading-5 font-medium whitespace-nowrap outline-none transition-colors duration-100',
                sizeClasses.tab,
                'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-muted',
                isActive
                  ? 'font-medium text-foreground'
                  : cn('font-medium text-muted-foreground opacity-50 hover:text-foreground', inactiveTabClassName),
              )}
            >
              {!isActive && showInactiveHoverIndicator ? (
                <span
                  aria-hidden="true"
                  data-fluid-tabs-hover-indicator="true"
                  className="pointer-events-none absolute inset-0 rounded-md border border-border-subtle bg-surface shadow-md opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              ) : isActive ? (
                <motion.span
                  aria-hidden="true"
                  layoutId="fluid-tabs-active-indicator"
                  transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
                  className="pointer-events-none absolute inset-0 rounded-md border border-border-subtle bg-surface shadow-md"
                />
              ) : null}
              <span className="relative z-10">{item.label}</span>
            </TabsPrimitive.Tab>
          );
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
