/**
 * Full-featured static Markdown pipeline: Streamdown with code (Shiki via
 * AiPre header + copy button) and math (KaTeX incl. mhchem) plugins. Loaded on
 * demand so plain-prose surfaces never pay for the Shiki/KaTeX runtimes
 * (issue #141, same strategy as chat's richMessageResponse).
 */
import 'katex/dist/katex.min.css';
import 'katex/contrib/mhchem';

import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { AiPre } from '@shared/components/ai-elements/streamdown-code-block';
import React from 'react';
import { Streamdown, type StreamdownProps } from 'streamdown';

const richPlugins = { code, math };

const RichStaticMarkdown: React.FC<
  Omit<StreamdownProps, 'children'> & {
    processed: string;
    components: StreamdownProps['components'];
  }
> = ({ processed, components, ...props }) => (
  <Streamdown plugins={richPlugins} components={{ pre: AiPre, ...components }} {...props}>
    {processed}
  </Streamdown>
);

export default RichStaticMarkdown;
