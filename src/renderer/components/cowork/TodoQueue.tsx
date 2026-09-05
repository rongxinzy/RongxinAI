import { QueueItem, QueueItemContent, type QueueTodo } from '@shared/components/ai-elements/queue';
import { Button } from '@shared/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@shared/components/ui/collapsible';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import { Circle, CircleAlert, CircleCheck } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';

interface TodoQueueProps {
  isDismissing?: boolean;
  todos: QueueTodo[];
}

/**
 * Renders one anchored surface that morphs from a compact todo summary into
 * the complete list without moving the prompt input.
 */
export function TodoQueue({ isDismissing = false, todos }: TodoQueueProps) {
  const [isOpen, setIsOpen] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isDismissing) setIsOpen(false);
  }, [isDismissing]);

  if (todos.length === 0) return null;

  const completed = todos.filter(t => t.status === 'completed').length;
  const total = todos.length;
  const isComplete = completed === total;
  const title = i18nService.t('coworkTodosTitle');
  const motionDuration = prefersReducedMotion ? 0 : 0.22;

  const renderIndicator = (todo: QueueTodo) => {
    if (todo.status === 'in_progress') {
      return <Spinner className="size-4 shrink-0 text-muted-foreground" />;
    }
    if (todo.status === 'blocked') {
      return (
        <CircleAlert
          aria-label={i18nService.t('coworkTodoBlocked')}
          className="size-4 shrink-0 text-muted-foreground"
        />
      );
    }
    if (todo.status === 'completed') {
      return <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;
    }
    return <Circle aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />;
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        'absolute bottom-2 left-1/2 z-30 max-w-[calc(100vw-3rem)] -translate-x-1/2 transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none',
        isDismissing && 'pointer-events-none translate-y-1 opacity-0',
      )}
    >
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <div
          className={cn(
            'overflow-hidden rounded-xl border border-border bg-background shadow-md transition-[width] duration-200 ease-out motion-reduce:transition-none',
            isOpen ? 'w-80 max-w-[90vw]' : 'w-48 max-w-[calc(100vw-3rem)]',
          )}
        >
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-todo-queue-trigger="true"
                className="theme-control-sizing-9 w-full"
              >
                {isComplete ? (
                  <CircleCheck data-icon="inline-start" className="text-muted-foreground" />
                ) : (
                  <Spinner data-icon="inline-start" className="text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
                  {title}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  {completed}/{total}
                </span>
              </Button>
            }
          />
          <CollapsibleContent className="max-h-64 overflow-hidden [&[hidden]:not([hidden='until-found'])]:hidden">
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: motionDuration, ease: 'easeOut' }}
              className="px-2 pb-2"
            >
              <ScrollArea className="max-h-64 [&_[data-slot=scroll-area-viewport]]:max-h-64">
                <ul>
                  {todos.map(todo => (
                    <QueueItem key={todo.id} className="px-2 py-1.5">
                      <div className="flex items-center gap-2">
                        {renderIndicator(todo)}
                        <div className="min-w-0 flex-1">
                          <QueueItemContent
                            completed={todo.status === 'completed'}
                            className="line-clamp-none"
                          >
                            {todo.title}
                          </QueueItemContent>
                          {todo.description && (
                            <p className="text-xs text-muted-foreground">{todo.description}</p>
                          )}
                        </div>
                      </div>
                    </QueueItem>
                  ))}
                </ul>
              </ScrollArea>
            </motion.div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}
