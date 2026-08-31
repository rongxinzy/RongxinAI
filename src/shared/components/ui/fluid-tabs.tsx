'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '@shared/lib/utils';
import { useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';

/**
 * Fluid segmented-tab interaction for compact filter controls.
 *
 * The active pill is a single absolutely positioned element whose position and
 * width are measured from the active tab (via aria-selected) and animated with
 * a 200ms ease-out CSS transition — no shared-element layout measurement, so
 * parent re-renders and grid reloads can never make it flicker or jump.
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

interface IndicatorGeometry {
  x: number;
  width: number;
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
  const prefersReducedMotion = useReducedMotion();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<IndicatorGeometry | null>(null);

  const measure = useCallback(() => {
    const list = listRef.current;
    const activeTab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!activeTab) return;
    const next = { x: activeTab.offsetLeft, width: activeTab.offsetWidth };
    setIndicator(prev => (prev && prev.x === next.x && prev.width === next.width ? prev : next));
  }, []);

  // Re-measure whenever the active tab changes (value drives a new aria-selected).
  useLayoutEffect(() => {
    measure();
  }, [measure, value]);

  // Re-measure when the list or the active tab resizes (window resize, font or
  // label changes), so the pill tracks the tab instead of drifting.
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    const activeTab = list.querySelector<HTMLElement>('[aria-selected="true"]');
    if (activeTab) observer.observe(activeTab);
    return () => observer.disconnect();
  }, [measure, value]);

  return (
    <TabsPrimitive.Root
      value={value}
      onValueChange={nextValue => onValueChange(nextValue as Value)}
      className={cn('inline-flex', className)}
    >
      <TabsPrimitive.List
        ref={listRef}
        activateOnFocus
        aria-label={ariaLabel}
        className={cn('relative inline-flex items-center gap-0.5 rounded-lg bg-muted/80 p-1 select-none', sizeClasses.list, listClassName)}
      >
        {indicator ? (
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute top-1 bottom-1 left-0 z-0 rounded-md border border-border-subtle bg-surface shadow-md',
              // Balanced glide (project --ease-smooth), not easeOutExpo: an
              // aggressive ease-out covers ~40% of the distance in the first
              // frame and then crawls, which reads as a jump, not a slide.
              !prefersReducedMotion && 'transition-[transform,width] duration-200 ease-(--ease-smooth)',
            )}
            style={{ width: indicator.width, transform: `translateX(${indicator.x}px)` }}
          />
        ) : null}
        {items.map(item => {
          const isActive = item.value === value;
          return (
            <TabsPrimitive.Tab
              key={item.value}
              value={item.value}
              className={cn(
                'group relative z-10 flex min-w-16 cursor-pointer items-center justify-center rounded-md px-3 text-sm leading-5 font-medium whitespace-nowrap outline-none transition-[color,opacity] duration-150 ease-out',
                sizeClasses.tab,
                'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-muted',
                isActive
                  ? 'font-medium text-foreground'
                  : cn('font-medium text-muted-foreground opacity-50 hover:text-foreground', inactiveTabClassName),
              )}
            >
              {showInactiveHoverIndicator ? (
                <span
                  aria-hidden="true"
                  data-fluid-tabs-hover-indicator="true"
                  className={cn(
                    'pointer-events-none absolute inset-0 rounded-md border border-border-subtle bg-surface shadow-md opacity-0 transition-opacity duration-150',
                    // Keep mounted on activation so it fades out instead of
                    // vanishing in one frame (reads as a flash under the
                    // arriving active pill).
                    !isActive && 'group-hover:opacity-100 group-focus-visible:opacity-100',
                  )}
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
