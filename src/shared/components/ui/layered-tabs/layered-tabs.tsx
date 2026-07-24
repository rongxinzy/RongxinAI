import { Separator } from '@shared/components/ui/separator';
import { TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { cn } from '@shared/lib/utils';
import { motion, useReducedMotion } from 'motion/react';
import React from 'react';

import {
  LayeredTabsSeparatorEdge,
  type LayeredTabsSeparatorEdge as LayeredTabsSeparatorEdgeType,
} from './constants';

export interface LayeredTabItem<Value extends string> {
  value: Value;
  label: React.ReactNode;
  disabled?: boolean;
}

export interface LayeredTabsListProps<Value extends string> {
  value: Value;
  items: readonly LayeredTabItem<Value>[];
  separatorEdge?: LayeredTabsSeparatorEdgeType;
  showSeparator?: boolean;
  className?: string;
  contentClassName?: string;
  listClassName?: string;
}

interface LayeredTabsEdgeStyles {
  root: string;
  content: string;
  list: string;
  trigger: string;
  surface: string;
  activeSurface: string;
  text: string;
  separator: string;
  shadowClip: string;
}

const EDGE_STYLES: Record<LayeredTabsSeparatorEdgeType, LayeredTabsEdgeStyles> = {
  [LayeredTabsSeparatorEdge.Top]: {
    root: 'items-start',
    content: 'items-start',
    list: 'items-start',
    trigger: 'rounded-t-none rounded-b-lg',
    surface: 'top-0 rounded-b-lg',
    activeSurface: 'border-t-0',
    text: 'top-0',
    separator: 'top-0',
    shadowClip: '[clip-path:inset(0_-8px_-8px_-8px)]',
  },
  [LayeredTabsSeparatorEdge.Bottom]: {
    root: 'items-end',
    content: 'items-end',
    list: 'items-end',
    trigger: 'rounded-t-lg rounded-b-none',
    surface: 'bottom-0 rounded-t-lg',
    activeSurface: 'border-b-0',
    text: 'bottom-0',
    separator: 'bottom-0',
    shadowClip: '[clip-path:inset(-8px_-8px_0_-8px)]',
  },
};

export function getLayeredTabMetrics(index: number, activeIndex: number, itemCount: number) {
  const depth = Math.min(Math.abs(index - activeIndex), 2);
  const isActive = index === activeIndex;

  return {
    depth,
    isActive,
    isThirdLayer: depth === 2,
    zIndex: isActive ? itemCount + 1 : itemCount - depth,
    height: isActive ? 40 : depth === 2 ? 27.5 : 32,
    width: depth === 2 ? '86%' : '100%',
    textScale: isActive ? 1 : depth === 2 ? 0.75 : 0.875,
  } as const;
}

function LayeredTabsTrigger<Value extends string>({
  item,
  index,
  activeIndex,
  itemCount,
  edgeStyles,
  prefersReducedMotion,
}: {
  item: LayeredTabItem<Value>;
  index: number;
  activeIndex: number;
  itemCount: number;
  edgeStyles: LayeredTabsEdgeStyles;
  prefersReducedMotion: boolean | null;
}) {
  const metrics = getLayeredTabMetrics(index, activeIndex, itemCount);
  const isFirstTab = index === 0;
  const motionTransition = prefersReducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 420, damping: 34, mass: 0.8 };
  const colorTransition = { duration: prefersReducedMotion ? 0 : 0.2, ease: 'easeOut' as const };

  return (
    <TabsTrigger
      value={item.value}
      disabled={item.disabled}
      style={{ zIndex: metrics.zIndex, boxShadow: metrics.isActive ? 'none' : undefined }}
      className={cn(
        'group relative h-10 min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm font-medium text-muted-foreground transition-colors duration-200 ease-out hover:text-foreground',
        edgeStyles.trigger,
        'data-active:z-10 data-active:bg-transparent data-active:font-semibold data-active:text-muted-foreground data-active:shadow-none data-active:hover:bg-transparent data-active:hover:text-muted-foreground dark:data-active:bg-transparent',
        isFirstTab ? 'rounded-l-lg' : '-ml-4',
      )}
    >
      <motion.span
        className={cn(
          'pointer-events-none absolute border border-border transition-colors duration-200',
          edgeStyles.surface,
          metrics.isActive && cn('z-20 bg-card', edgeStyles.activeSurface),
          !metrics.isActive && !metrics.isThirdLayer && 'bg-secondary',
          !metrics.isThirdLayer && cn('shadow-md', edgeStyles.shadowClip),
          metrics.isThirdLayer && 'bg-surface-tertiary shadow-none',
        )}
        animate={{ height: metrics.height, width: metrics.width }}
        style={{ left: isFirstTab ? 'auto' : 0, right: isFirstTab ? 0 : 'auto' }}
        transition={{ height: motionTransition, width: colorTransition }}
        aria-hidden="true"
      />
      <motion.span
        className={cn(
          'absolute z-30 inline-flex min-w-0 items-center justify-center gap-1.5 truncate text-base leading-none',
          edgeStyles.text,
        )}
        animate={{
          height: metrics.height,
          scale: metrics.textScale,
          width: metrics.width,
        }}
        style={{ left: isFirstTab ? 'auto' : 0, right: isFirstTab ? 0 : 'auto' }}
        transition={{ height: motionTransition, scale: colorTransition, width: colorTransition }}
      >
        {item.label}
      </motion.span>
    </TabsTrigger>
  );
}

export function LayeredTabsList<Value extends string>({
  value,
  items,
  separatorEdge = LayeredTabsSeparatorEdge.Top,
  showSeparator = true,
  className,
  contentClassName,
  listClassName,
}: LayeredTabsListProps<Value>) {
  const prefersReducedMotion = useReducedMotion();
  const edgeStyles = EDGE_STYLES[separatorEdge];
  const activeIndex = Math.max(
    0,
    items.findIndex(item => item.value === value),
  );

  return (
    <div className={cn('relative flex w-full shrink-0', edgeStyles.root, className)}>
      {showSeparator ? (
        <Separator className={cn('absolute inset-x-0 z-0 w-auto', edgeStyles.separator)} />
      ) : null}
      <div
        className={cn(
          'relative z-10 mx-auto flex w-full max-w-2xl px-4',
          edgeStyles.content,
          contentClassName,
        )}
      >
        <div className="relative flex w-full min-w-0 flex-1">
          <div className="min-w-0 flex-1" />
          <TabsList
            className={cn(
              'relative flex h-10 w-72 max-w-full gap-0 rounded-none bg-transparent p-0 shadow-none',
              edgeStyles.list,
              listClassName,
            )}
          >
            {items.map((item, index) => (
              <LayeredTabsTrigger
                key={item.value}
                item={item}
                index={index}
                activeIndex={activeIndex}
                itemCount={items.length}
                edgeStyles={edgeStyles}
                prefersReducedMotion={prefersReducedMotion}
              />
            ))}
          </TabsList>
          <div className="min-w-0 flex-1" />
        </div>
      </div>
    </div>
  );
}
