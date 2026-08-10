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

export interface FluidTabsProps<Value extends string> {
  'aria-label': string;
  className?: string;
  items: readonly FluidTabItem<Value>[];
  onValueChange: (value: Value) => void;
  value: Value;
}

export function FluidTabs<Value extends string>({
  'aria-label': ariaLabel,
  className,
  items,
  onValueChange,
  value,
}: FluidTabsProps<Value>) {
  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={nextValue => onValueChange(nextValue as Value)}
      className={cn('inline-flex', className)}
    >
      <TabsPrimitive.List
        activateOnFocus
        aria-label={ariaLabel}
        className="relative inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted/80 p-1 select-none"
      >
        {items.map(item => {
          const isActive = item.value === value;
          return (
            <TabsPrimitive.Tab
              key={item.value}
              value={item.value}
              className={cn(
                'relative z-10 flex h-7 min-w-16 cursor-pointer items-center justify-center rounded-md px-3 text-sm leading-5 font-normal whitespace-nowrap outline-none transition-colors duration-100',
                'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-muted',
                isActive
                  ? 'font-semibold text-foreground'
                  : 'font-normal text-muted-foreground opacity-50 hover:text-foreground',
              )}
            >
              {isActive ? (
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
