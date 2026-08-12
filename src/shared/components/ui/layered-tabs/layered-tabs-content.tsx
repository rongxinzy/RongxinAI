import { TabsContent } from '@shared/components/ui/tabs';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import React from 'react';

const contentVariants = {
  enter: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? 28 : -28,
  }),
  center: {
    opacity: 1,
    x: 0,
  },
  exit: (direction: number) => ({
    opacity: 0,
    x: direction > 0 ? -28 : 28,
  }),
};

interface LayeredTabsContentProps<Value extends string> {
  value: Value;
  activeValue: Value;
  direction: number;
  className?: string;
  contentClassName?: string;
  keepMounted?: boolean;
  children: React.ReactNode;
}

export function LayeredTabsContent<Value extends string>({
  value,
  activeValue,
  direction,
  className,
  contentClassName,
  keepMounted = true,
  children,
}: LayeredTabsContentProps<Value>) {
  const prefersReducedMotion = useReducedMotion();

  return (
    <TabsContent value={value} keepMounted={keepMounted} className={className}>
      <AnimatePresence initial={false} custom={direction} mode="wait">
        {activeValue === value && (
          <motion.div
            key={value}
            custom={direction}
            variants={contentVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              duration: prefersReducedMotion ? 0 : 0.22,
              ease: 'easeOut',
            }}
            className={contentClassName}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </TabsContent>
  );
}
