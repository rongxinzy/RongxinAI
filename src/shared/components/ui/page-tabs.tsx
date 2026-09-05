import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { cn } from '@shared/lib/utils';
import { motion, useReducedMotion } from 'motion/react';
import React, { useId } from 'react';

export interface PageTabItem<Value extends string> {
  value: Value;
  label: React.ReactNode;
  /** Optional trailing content, e.g. a count Badge. */
  badge?: React.ReactNode;
  disabled?: boolean;
}

interface PageTabsProps<Value extends string> {
  value: Value;
  items: readonly PageTabItem<Value>[];
  /** Change handler for standalone usage. Unused in bare mode. */
  onValueChange?: (value: Value) => void;
  /** Fires on every trigger press, including the already-active tab. */
  onItemClick?: (value: Value) => void;
  /**
   * Bare mode renders only the tab list, for embedding inside an existing
   * shadcn `Tabs` root (which then owns state, keyboard nav, and the
   * tab-to-tabpanel ARIA linkage). Standalone mode (default) brings its own
   * root for pages without TabsContent.
   */
  bare?: boolean;
  className?: string;
}

/**
 * Unified underline tabs (the single tab implementation for the app). The
 * active indicator is one element shared across triggers via layoutId, so
 * switching tabs slides it with a transform-only spring: no layout
 * measurement per frame, fully GPU-composited. State is expressed with text
 * color only, never color blocks, per DESIGN.md.
 */
export function PageTabs<Value extends string>({
  value,
  items,
  onValueChange,
  onItemClick,
  bare = false,
  className,
}: PageTabsProps<Value>) {
  const prefersReducedMotion = useReducedMotion();
  // Multiple PageTabs instances can coexist on one page (e.g. filter rows);
  // the layoutId must be unique per instance or indicators would cross-animate.
  const instanceId = useId();

  const list = (
    <TabsList variant="line" className={cn('theme-page-tabs-list gap-0', bare && className)}>
      {items.map(item => (
        <TabsTrigger
          key={item.value}
          value={item.value}
          disabled={item.disabled}
          onClick={() => onItemClick?.(item.value)}
          className="theme-page-tabs-trigger relative flex-none after:hidden"
        >
          {item.label}
          {item.badge}
          {item.value === value ? (
            <motion.span
              layoutId={`page-tabs-indicator-${instanceId}`}
              className="theme-page-tabs-indicator absolute inset-x-1 -bottom-px"
              transition={
                prefersReducedMotion
                  ? { duration: 0 }
                  : { type: 'spring', stiffness: 500, damping: 40, mass: 0.8 }
              }
              aria-hidden="true"
            />
          ) : null}
        </TabsTrigger>
      ))}
    </TabsList>
  );

  if (bare) return list;

  return (
    <Tabs
      value={value}
      onValueChange={next => onValueChange?.(next as Value)}
      className={cn('w-fit gap-0', className)}
    >
      {list}
    </Tabs>
  );
}
