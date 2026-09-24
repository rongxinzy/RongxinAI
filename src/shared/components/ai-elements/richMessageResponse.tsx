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
import { streamdownChatControls } from './streamdownChatControls';

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
  components,
  ...props
}) => (
  <Streamdown
    className={cn('size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0', className)}
    plugins={richPlugins}
    // 2026/09/20 lixiang  合并而非覆盖：否则调用方 components.a 会丢掉 pre:AiPre，代码块按钮掉出标题栏
    components={{ pre: AiPre, ...components }}
    {...props}
    linkSafety={linkSafety}
    controls={streamdownChatControls}
  />
);

export default RichMessageResponse;
