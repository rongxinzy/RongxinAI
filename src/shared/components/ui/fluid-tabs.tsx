'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '@shared/lib/utils';
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
  y: number;
  height: number;
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
  const listRef = useRef<HTMLDivElement | null>(null);
  const [indicator, setIndicator] = useState<IndicatorGeometry | null>(null);

  const measure = useCallback(() => {
    const list = listRef.current;
    const activeTab = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!activeTab) return;
    const next = {
      x: activeTab.offsetLeft,
      width: activeTab.offsetWidth,
      y: activeTab.offsetTop,
      height: activeTab.offsetHeight,
    };
    setIndicator(prev =>
      prev &&
      prev.x === next.x &&
      prev.width === next.width &&
      prev.y === next.y &&
      prev.height === next.height
        ? prev
        : next,
    );
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
    list.querySelectorAll<HTMLElement>('[role="tab"]').forEach(tab => observer.observe(tab));
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
        data-size={size}
        activateOnFocus
        aria-label={ariaLabel}
        className={cn(
          'theme-fluid-list relative inline-flex items-center gap-0.5 select-none',
          listClassName,
        )}
      >
        {indicator ? (
          <span
            aria-hidden="true"
            className="theme-fluid-indicator pointer-events-none absolute top-0 left-0 z-0"
            style={{
              width: indicator.width,
              height: indicator.height,
              transform: `translate(${indicator.x}px, ${indicator.y}px)`,
            }}
          />
        ) : null}
        {items.map(item => {
          const isActive = item.value === value;
          return (
            <TabsPrimitive.Tab
              key={item.value}
              value={item.value}
              className={cn(
                'theme-fluid-tab group relative z-10 flex min-w-16 cursor-pointer items-center justify-center whitespace-nowrap',
                !isActive && inactiveTabClassName,
              )}
            >
              {showInactiveHoverIndicator ? (
                <span
                  aria-hidden="true"
                  data-fluid-tabs-hover-indicator="true"
                  className="theme-fluid-hover-indicator pointer-events-none absolute inset-0"
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
