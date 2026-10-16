'use client';

import { cn } from '@shared/lib/utils';
import { cjk } from '@streamdown/cjk';
import type { UIMessage } from 'ai';
import type { ComponentProps, HTMLAttributes } from 'react';

import React, { memo } from 'react';

import { Streamdown, type StreamdownProps } from 'streamdown';

import {
  getLoadedRichMessageResponse,
  hasRichMessageContent,
  loadRichMessageResponse,
} from './richMessageResponseLoader';
import { LinkSafetyModal } from './linkSafetyModal';

// Code/math/mermaid plugins (and their Shiki/KaTeX/Mermaid runtimes) load
// on demand when the content actually needs them (issue #141).
const RichMessageResponse = React.lazy(loadRichMessageResponse);

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage['role'];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      'group flex w-full max-w-[95%] flex-col gap-2',
      from === 'user' ? 'is-user ml-auto justify-end' : 'is-assistant',
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

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const basePlugins = { cjk };

// 2026/09/15 lixiang  Streamdown 内置外链确认弹窗内联渲染在消息 DOM 中，会被祖先的
// transform/overflow/contain 劫持定位导致只见模糊遮罩不见弹窗内容；改用 portal 到 body 的自定义弹窗
const linkSafety: StreamdownProps['linkSafety'] = {
  enabled: true,
  renderModal: props => <LinkSafetyModal {...props} />,
};

export const MessageResponse = memo(
  ({ className, children, ...props }: MessageResponseProps) => {
    const base = (
      <Streamdown
        className={cn('size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
        plugins={basePlugins}
        linkSafety={linkSafety}
        {...props}
      >
        {children}
      </Streamdown>
    );
    const text = typeof children === 'string' ? children : '';
    if (!hasRichMessageContent(text)) {
      return base;
    }
    const LoadedRichMessageResponse = getLoadedRichMessageResponse();
    if (LoadedRichMessageResponse) {
      return (
        <LoadedRichMessageResponse className={className} {...props} linkSafety={linkSafety}>
          {children}
        </LoadedRichMessageResponse>
      );
    }
    return (
      <React.Suspense fallback={base}>
        <RichMessageResponse className={className} {...props} linkSafety={linkSafety}>
          {children}
        </RichMessageResponse>
      </React.Suspense>
    );
  },
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children && nextProps.isAnimating === prevProps.isAnimating,
);

MessageResponse.displayName = 'MessageResponse';
