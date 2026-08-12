'use client';

import { File } from 'lucide-react';
import React from 'react';
import type { BundledLanguage } from 'shiki';

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
  normalizeCodeLanguage,
} from './code-block';

/**
 * Replaces Streamdown's native `<pre>` with ai-elements CodeBlock
 * when it contains a fenced code block (pre > code[class*="language-"]).
 * Plain `<pre>` elements pass through unchanged.
 *
 * Tries two detection paths:
 * 1. Streamdown HAST `node` prop (Streamdown v2.4)
 * 2. React `children` element (Streamdown v2.5+ fallback)
 */
export const AiPre: React.FC<React.ComponentProps<'pre'> & { node?: any }> = ({
  node,
  children,
  ...props
}) => {
  let lang: BundledLanguage | null = null;
  let rawText = '';

  // Path 1: Streamdown HAST node (v2.4)
  const codeNode: any = (node as any)?.children?.find?.((c: any) => c?.tagName === 'code');
  if (codeNode) {
    const className: string =
      (Array.isArray(codeNode.properties?.className)
        ? codeNode.properties.className.join(' ')
        : '') ?? '';
    const match = /language-([\w-]+)/.exec(className);
    if (match) {
      lang = normalizeCodeLanguage(match[1]);
      rawText =
        (Array.isArray(codeNode.children)
          ? codeNode.children.map((c: any) => c?.value ?? '').join('')
          : '') ?? '';
    }
  }

  // Path 2: React children (Streamdown v2.5+ fallback)
  if (!lang) {
    const codeChild = React.Children.toArray(children).find(
      c => React.isValidElement(c) && (c.type as any) === 'code',
    ) as
      | React.ReactElement<{
          className?: string;
          children?: React.ReactNode;
          dangerouslySetInnerHTML?: { __html: string };
        }>
      | undefined;
    if (codeChild?.props?.className) {
      const match = /language-([\w-]+)/.exec(codeChild.props.className);
      if (match) {
        lang = normalizeCodeLanguage(match[1]);
        // Prefer dangerouslySetInnerHTML (Streamdown prerendered HTML), fallback to children extraction
        if (codeChild.props.dangerouslySetInnerHTML?.__html) {
          const tmp = document.createElement('div');
          tmp.innerHTML = codeChild.props.dangerouslySetInnerHTML.__html;
          rawText = tmp.textContent || '';
        } else {
          rawText = extractTextContent(codeChild.props.children);
        }
      }
    }
  }

  if (!lang) return <pre {...props}>{children}</pre>;

  rawText = rawText.replace(/\n$/, '');

  return (
    <CodeBlock code={rawText} language={lang} showLineNumbers>
      <CodeBlockHeader>
        <CodeBlockTitle>
          <File size={14} />
          <span className="font-mono text-xs text-muted-foreground">{lang}</span>
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton />
        </CodeBlockActions>
      </CodeBlockHeader>
    </CodeBlock>
  );
};

/** Recursively extract text from React children (string, array, nested elements). */
function extractTextContent(children: React.ReactNode): string {
  if (typeof children === 'string') return children;
  if (Array.isArray(children)) return children.map(extractTextContent).join('');
  if (React.isValidElement(children)) {
    return extractTextContent((children.props as any)?.children);
  }
  return '';
}
