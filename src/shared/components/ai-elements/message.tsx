'use client';

import { cn } from '@shared/lib/utils';
import type { UIMessage } from 'ai';
import type { HTMLAttributes } from 'react';

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage['role'];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      'group flex w-full flex-col gap-2',
      from === 'user' ? 'is-user ml-auto max-w-[85%] justify-end' : 'is-assistant max-w-full',
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
  <div
    className={cn(
      'theme-message-body is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden',
      'group-[.is-user]:ml-auto',
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
