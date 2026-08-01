'use client';

import { cn } from '@shared/lib/utils';
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { mermaid } from '@streamdown/mermaid';
import type { ComponentProps } from 'react';
import React from 'react';
import { Streamdown } from 'streamdown';

import { AiPre } from './streamdown-code-block';

const richPlugins = { cjk, code, math, mermaid };

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
    {...props}
  />
);

export default RichMessageResponse;
