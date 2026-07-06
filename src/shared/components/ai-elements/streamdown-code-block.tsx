"use client";

import { File } from "lucide-react";
import React from "react";
import type { BundledLanguage } from "shiki";

import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockTitle,
} from "./code-block";

/**
 * Replaces Streamdown's native `<pre>` with ai-elements CodeBlock
 * when it contains a fenced code block (pre > code[class*="language-"]).
 * Plain `<pre>` elements pass through unchanged.
 *
 * Use as: <Streamdown components={{ pre: AiPre }} ... />
 */
export const AiPre: React.FC<React.ComponentProps<"pre"> & { node?: any }> = ({
  node,
  children,
  ...props
}) => {
  // Streamdown passes the HAST element via ExtraProps.node
  const codeNode: any = (node as any)?.children?.find?.((c: any) => c?.tagName === "code");
  if (!codeNode) return <pre {...props}>{children}</pre>;

  const className: string =
    (Array.isArray(codeNode.properties?.className)
      ? codeNode.properties.className.join(" ")
      : "") ?? "";
  const match = /language-([\w-]+)/.exec(className);
  if (!match) return <pre {...props}>{children}</pre>;

  const lang = match[1].toLowerCase() as BundledLanguage;
  const textValues: string = (Array.isArray(codeNode.children)
    ? codeNode.children.map((c: any) => c?.value ?? "").join("")
    : "") ?? "";
  const rawText = textValues.replace(/\n$/, "");

  return (
    <CodeBlock code={rawText} language={lang}>
      <CodeBlockHeader>
        <CodeBlockTitle>
          <File size={14} />
          <span className="font-mono text-xs text-muted-foreground">{match[1]}</span>
        </CodeBlockTitle>
        <CodeBlockActions>
          <CodeBlockCopyButton />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent
        code={rawText}
        language={lang}
        showLineNumbers={false}
      />
    </CodeBlock>
  );
};
