// @ts-nocheck — third-party ai-elements component; @base-ui/react v1.6 type mismatch with ai-elements v1.9 (openDelay/closeDelay on PreviewCard, BaseUIEvent vs Event)
'use client';

import { InputGroupButton } from '@shared/components/ui/input-group';
import { Spinner } from '@shared/components/ui/spinner';
import { cn } from '@shared/lib/utils';
import type { ChatStatus } from 'ai';
import { ArrowUpIcon, SquareIcon, XIcon } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useCallback } from 'react';

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus;
  onStop?: () => void;
};

export const PromptInputSubmit = ({
  className,
  variant = 'default',
  size = 'icon-sm',
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const isGenerating = status === 'submitted' || status === 'streaming';

  // Circular send button: arrow nudges up on hover, the disc scales down on
  // press. Transform/opacity only, so the interaction stays on the compositor
  // and never triggers layout or React re-renders.
  let Icon = (
    <ArrowUpIcon className="size-4 transition-transform duration-150 ease-out group-hover/button:-translate-y-0.5 group-active/button:translate-y-0 motion-reduce:transform-none motion-reduce:transition-none" />
  );

  if (status === 'submitted') {
    Icon = <Spinner />;
  } else if (status === 'streaming') {
    Icon = <SquareIcon className="size-4" />;
  } else if (status === 'error') {
    Icon = <XIcon className="size-4" />;
  }

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>) => {
      if (isGenerating && onStop) {
        e.preventDefault();
        onStop();
        return;
      }
      onClick?.(e);
    },
    [isGenerating, onStop, onClick],
  );

  return (
    <InputGroupButton
      aria-label={isGenerating ? 'Stop' : 'Submit'}
      className={cn('theme-input-submit', className)}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? 'button' : 'submit'}
      variant={variant}
      {...props}
    >
      {children ?? Icon}
    </InputGroupButton>
  );
};
