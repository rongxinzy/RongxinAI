'use client';

import { cn } from '@shared/lib/utils';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import type { ComponentProps } from 'react';
import React from 'react';
import { Streamdown, type StreamdownProps } from 'streamdown';

import { AiPre } from './streamdown-code-block';
import { LinkSafetyModal } from './linkSafetyModal';

const richPlugins = { cjk, code, math, mermaid };

// 2026/09/15 lixiang  外链确认弹窗换为 portal 到 body 的自定义弹窗，避免被消息祖先节点裁剪（见 linkSafetyModal.tsx）
const linkSafety: StreamdownProps['linkSafety'] = {
  enabled: true,
  renderModal: props => <LinkSafetyModal {...props} />,
};

/**
 * Full Streamdown pipeline with code/math/mermaid plugins. This module is
 * loaded on demand so the plain-text first paint never pays for the Shiki,
 * KaTeX and Mermaid runtimes (issue #141).
 */
const RichMessageResponse: React.FC<ComponentProps<typeof Streamdown>> = ({
  className,
  ...props
}) => (
  <Streamdown
    className={cn('size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
    plugins={richPlugins}
    components={{ pre: AiPre }}
    linkSafety={linkSafety}
    {...props}
  />
);

export default RichMessageResponse;
