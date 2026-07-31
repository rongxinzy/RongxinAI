'use client';

import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from '@shared/lib/utils';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Fluid segmented-tab interaction inspired by Fluid Functionalism Tabs.
 * Original component Copyright (c) 2026 Micka Touillaud, MIT License.
 * https://www.fluidfunctionalism.com/docs/tabs
 */

interface TabRect {
  height: number;
  left: number;
  top: number;
  width: number;
}

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

function rectsMatch(current: readonly TabRect[], next: readonly TabRect[]) {
  return (
    current.length === next.length &&
    current.every(
      (rect, index) =>
        rect.height === next[index]?.height &&
        rect.left === next[index]?.left &&
        rect.top === next[index]?.top &&
        rect.width === next[index]?.width,
    )
  );
}

export function FluidTabs<Value extends string>({
  'aria-label': ariaLabel,
  className,
  items,
  onValueChange,
  value,
}: FluidTabsProps<Value>) {
  const listRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef(new Map<Value, HTMLElement>());
  const itemsRef = useRef(items);
  const [rects, setRects] = useState<TabRect[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const itemKey = items.map(item => item.value).join('\u0000');
  itemsRef.current = items;

  const measureTabs = useCallback(() => {
    const list = listRef.current;
    if (!list) return;

    const listRect = list.getBoundingClientRect();
    const nextRects = itemsRef.current.map(item => {
      const tabRect = tabRefs.current.get(item.value)?.getBoundingClientRect();
      return {
        height: tabRect?.height ?? 0,
        left: (tabRect?.left ?? listRect.left) - listRect.left,
        top: (tabRect?.top ?? listRect.top) - listRect.top,
        width: tabRect?.width ?? 0,
      };
    });

    setRects(current => (rectsMatch(current, nextRects) ? current : nextRects));
  }, []);

  useLayoutEffect(() => {
    measureTabs();
    const list = listRef.current;
    if (!list) return;

    const observer = new ResizeObserver(measureTabs);
    observer.observe(list);
    tabRefs.current.forEach(tab => observer.observe(tab));
    return () => observer.disconnect();
  }, [itemKey, measureTabs]);

  const activeIndex = Math.max(
    0,
    items.findIndex(item => item.value === value),
  );
  const activeRect = rects[activeIndex];
  const hoverRect = hoveredIndex === null ? undefined : rects[hoveredIndex];
  const transition = prefersReducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.8 };

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;

    itemsRef.current.forEach((item, index) => {
      const tabRect = tabRefs.current.get(item.value)?.getBoundingClientRect();
      if (!tabRect) return;
      const distance = Math.abs(event.clientX - (tabRect.left + tabRect.width / 2));
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    setHoveredIndex(closestIndex >= 0 ? closestIndex : null);
  }, []);

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
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoveredIndex(null)}
        className="relative inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted/80 p-1 select-none"
      >
        {activeRect && (
          <motion.div
            aria-hidden="true"
            initial={false}
            animate={{
              height: activeRect.height,
              left: activeRect.left,
              opacity: hoveredIndex !== null && hoveredIndex !== activeIndex ? 0.86 : 1,
              top: activeRect.top,
              width: activeRect.width,
            }}
            transition={transition}
            className="pointer-events-none absolute rounded-md border border-border-subtle bg-surface shadow-subtle"
          />
        )}

        <AnimatePresence>
          {hoverRect && hoveredIndex !== activeIndex && (
            <motion.div
              aria-hidden="true"
              initial={{
                height: activeRect?.height ?? hoverRect.height,
                left: activeRect?.left ?? hoverRect.left,
                opacity: 0,
                top: activeRect?.top ?? hoverRect.top,
                width: activeRect?.width ?? hoverRect.width,
              }}
              animate={{
                height: hoverRect.height,
                left: hoverRect.left,
                opacity: 1,
                top: hoverRect.top,
                width: hoverRect.width,
              }}
              exit={{ opacity: 0 }}
              transition={transition}
              className="pointer-events-none absolute rounded-md bg-foreground/5"
            />
          )}
        </AnimatePresence>

        {items.map((item, index) => {
          const isActive = item.value === value;
          const isHighlighted = isActive || hoveredIndex === index;
          return (
            <TabsPrimitive.Tab
              key={item.value}
              ref={node => {
                if (node) tabRefs.current.set(item.value, node);
                else tabRefs.current.delete(item.value);
              }}
              value={item.value}
              className={cn(
                'relative z-10 flex h-7 min-w-16 cursor-pointer items-center justify-center rounded-md px-3 text-[13px] whitespace-nowrap outline-none transition-colors duration-100',
                'focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-1 focus-visible:ring-offset-muted',
                isHighlighted ? 'text-foreground' : 'text-muted-foreground',
                isActive && 'font-semibold',
              )}
            >
              {item.label}
            </TabsPrimitive.Tab>
          );
        })}
      </TabsPrimitive.List>
    </TabsPrimitive.Root>
  );
}
