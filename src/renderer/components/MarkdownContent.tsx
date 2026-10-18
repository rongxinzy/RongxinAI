import 'katex/dist/katex.min.css';
import 'katex/contrib/mhchem';

import { Button } from '@shared/components/ui/button';
import { FileText, Folder } from 'lucide-react';
import React, { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
// @ts-ignore
import rehypeKatex from 'rehype-katex';
// @ts-ignore
import remarkGfm from 'remark-gfm';
// @ts-ignore
import remarkMath from 'remark-math';

import { i18nService } from '../services/i18n';
import { showAppToast } from '../services/toastNotification';
import { isLocalPathCandidate, useResolvedLocalPath } from '../services/useResolvedLocalPath';
import CodeBlock from './CodeBlock';

const SAFE_URL_PROTOCOLS = new Set(['http', 'https', 'mailto', 'tel', 'file']);

const encodeFileUrl = (url: string): string => {
  const encoded = encodeURI(url);
  return encoded.replace(/\(/g, '%28').replace(/\)/g, '%29');
};

const encodeFileUrlDestination = (dest: string): string => {
  const trimmed = dest.trim();
  if (!/^<?file:\/\//i.test(trimmed)) {
    return dest;
  }

  let core = trimmed;
  let prefix = '';
  let suffix = '';
  if (core.startsWith('<') && core.endsWith('>')) {
    prefix = '<';
    suffix = '>';
    core = core.slice(1, -1);
  }

  const encoded = encodeFileUrl(core);
  return dest.replace(trimmed, `${prefix}${encoded}${suffix}`);
};

const findMarkdownLinkEnd = (input: string, start: number): number => {
  let depth = 1;
  for (let i = start; i < input.length; i += 1) {
    const char = input[i];
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '(') {
      depth += 1;
      continue;
    }
    if (char === ')') {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
    if (char === '\n') {
      return -1;
    }
  }
  return -1;
};

const encodeFileUrlsInMarkdown = (content: string): string => {
  if (!content.includes('file://')) {
    return content;
  }

  let result = '';
  let cursor = 0;
  while (cursor < content.length) {
    const openIndex = content.indexOf('](', cursor);
    if (openIndex === -1) {
      result += content.slice(cursor);
      break;
    }

    result += content.slice(cursor, openIndex + 2);
    const destStart = openIndex + 2;
    const destEnd = findMarkdownLinkEnd(content, destStart);
    if (destEnd === -1) {
      result += content.slice(destStart);
      break;
    }

    const dest = content.slice(destStart, destEnd);
    result += encodeFileUrlDestination(dest);
    result += ')';
    cursor = destEnd + 1;
  }
  return result;
};

/**
 * Normalize multi-line display math blocks for remark-math compatibility.
 * remark-math treats $$ like code fences: opening $$ must be on its own line,
 * and closing $$ must also be on its own line.
 * LLMs often output $$content\n...\ncontent$$ which breaks parsing and corrupts
 * all subsequent markdown. This function normalizes such blocks.
 */
const normalizeDisplayMath = (content: string): string => {
  return content.replace(/\$\$([\s\S]+?)\$\$/g, (match, inner) => {
    if (!inner.includes('\n')) {
      return match;
    }
    return `$$\n${inner.trim()}\n$$`;
  });
};

const safeUrlTransform = (url: string): string => {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;

  const match = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!match) {
    return trimmed;
  }

  const protocol = match[1].toLowerCase();
  if (SAFE_URL_PROTOCOLS.has(protocol)) {
    return trimmed;
  }

  return '';
};

const getHrefProtocol = (href: string): string | null => {
  const trimmed = href.trim();
  const match = trimmed.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!match) return null;
  return match[1].toLowerCase();
};

const isExternalHref = (href: string): boolean => {
  const protocol = getHrefProtocol(href);
  if (!protocol) return false;
  return protocol !== 'file';
};

const openExternalViaDefaultBrowser = async (url: string): Promise<boolean> => {
  const openExternal = (window as any)?.electron?.shell?.openExternal;
  if (typeof openExternal !== 'function') {
    return false;
  }

  try {
    const result = await openExternal(url);
    return !!result?.success;
  } catch (error) {
    console.error('Failed to open external link with system browser:', url, error);
    return false;
  }
};

const openExternalViaAnchorFallback = (url: string): void => {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
};

const dispatchAppToast = (message: string): void => {
  showAppToast(message);
};

const createMarkdownComponents = (
  sessionCwd: string | undefined,
  showRevealInFolderAction = false,
  onImageClick?: (image: { src: string; alt?: string | null }) => void,
  restrictLocalFileLinks = false,
) => ({
  p: ({ node: _node, className: _className, children, ...props }: any) => (
    <p
      className="my-1 first:mt-0 last:mb-0 leading-[23px] text-foreground/90 wrap-break-word"
      {...props}
    >
      {children}
    </p>
  ),
  strong: ({ node: _node, className: _className, children, ...props }: any) => (
    <strong className="font-semibold text-foreground" {...props}>
      {children}
    </strong>
  ),
  h1: ({ node: _node, className: _className, children, ...props }: any) => (
    <h1 className="text-2xl font-semibold mt-6 mb-3 text-foreground" {...props}>
      {children}
    </h1>
  ),
  h2: ({ node: _node, className: _className, children, ...props }: any) => (
    <h2 className="text-xl font-semibold mt-5 mb-2 text-foreground" {...props}>
      {children}
    </h2>
  ),
  h3: ({ node: _node, className: _className, children, ...props }: any) => (
    <h3 className="text-lg font-semibold mt-4 mb-2 text-foreground" {...props}>
      {children}
    </h3>
  ),
  ul: ({ node: _node, className: _className, children, ...props }: any) => (
    <ul className="list-disc pl-5 my-1.5 text-foreground/90" {...props}>
      {children}
    </ul>
  ),
  ol: ({ node: _node, className: _className, children, ...props }: any) => (
    <ol className="list-decimal pl-6 my-1.5 text-foreground/90" {...props}>
      {children}
    </ol>
  ),
  li: ({ node: _node, className: _className, children, ...props }: any) => (
    <li className="my-0.5 leading-[23px] text-foreground/90 wrap-break-word" {...props}>
      {children}
    </li>
  ),
  blockquote: ({ node: _node, className: _className, children, ...props }: any) => (
    <blockquote
      className="border-l-4 border-primary pl-4 py-1 my-2 bg-surface-raised/30 rounded-r-lg text-foreground/90"
      {...props}
    >
      {children}
    </blockquote>
  ),
  pre: ({ node: _node, className: _className, children }: any) => <>{children}</>,
  code: CodeBlock,
  table: ({ node: _node, className: _className, children, ...props }: any) => (
    <div className="my-4 overflow-x-auto rounded-xl border border-border">
      <table className="border-collapse w-full" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ node: _node, className: _className, children, ...props }: any) => (
    <thead className="bg-surface-raised" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ node: _node, className: _className, children, ...props }: any) => (
    <tbody className="divide-y divide-border" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ node: _node, className: _className, children, ...props }: any) => (
    <tr className="divide-x divide-border" {...props}>
      {children}
    </tr>
  ),
  th: ({ node: _node, className: _className, children, ...props }: any) => (
    <th className="px-4 py-2 text-left font-semibold text-foreground" {...props}>
      {children}
    </th>
  ),
  td: ({ node: _node, className: _className, children, ...props }: any) => (
    <td className="px-4 py-2 text-foreground/90" {...props}>
      {children}
    </td>
  ),
  img: ({ node: _node, className: _className, src, alt, ...props }: any) => {
    let resolvedSrc = src;
    if (typeof src === 'string') {
      if (src.startsWith('file://')) {
        resolvedSrc = src.replace(/^file:\/\//, 'localfile://');
      } else if (src.startsWith('/') && !src.startsWith('//')) {
        resolvedSrc = `localfile://${src}`;
      }
    }
    return (
      <img
        className={`max-w-full max-h-96 object-contain rounded-xl my-4${onImageClick ? ' cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
        src={resolvedSrc}
        alt={alt}
        onClick={
          onImageClick && resolvedSrc ? () => onImageClick({ src: resolvedSrc, alt }) : undefined
        }
        {...props}
      />
    );
  },
  hr: ({ node: _node, ...props }: any) => <hr className="my-5 border-border" {...props} />,
  a: ({ node: _node, href, className: _className, children, ...props }: any) => {
    if (typeof href === 'string' && href.startsWith('#artifact-')) {
      return null;
    }

    const hrefValue = typeof href === 'string' ? href.trim() : '';
    const isExternalLink = !!hrefValue && isExternalHref(hrefValue);
    const candidate = hrefValue && !isExternalLink ? hrefValue : null;

    return (
      <LocalAwareMarkdownAnchor
        candidate={candidate}
        cwd={sessionCwd}
        restrictLocalFileLinks={restrictLocalFileLinks}
        showRevealInFolderAction={showRevealInFolderAction}
        hrefValue={hrefValue}
        isExternalLink={isExternalLink}
        {...props}
      >
        {children}
      </LocalAwareMarkdownAnchor>
    );
  },
});

interface LocalAwareMarkdownAnchorProps {
  candidate: string | null;
  cwd: string | undefined;
  restrictLocalFileLinks: boolean;
  showRevealInFolderAction: boolean;
  hrefValue: string;
  isExternalLink: boolean;
  children?: React.ReactNode;
}

/**
 * 本地文件链接：由主进程 `shell.resolveLocalPath` 判定是否存在（issue #805）；
 * 解析失败时按 restrictLocalFileLinks 降级为纯文本或普通锚点。
 */
const LocalAwareMarkdownAnchor: React.FC<LocalAwareMarkdownAnchorProps> = ({
  candidate,
  cwd,
  restrictLocalFileLinks,
  showRevealInFolderAction,
  hrefValue,
  isExternalLink,
  children,
  ...props
}) => {
  const resolved = useResolvedLocalPath(
    candidate && isLocalPathCandidate(candidate) ? candidate : null,
    cwd,
    true,
  );

  if (resolved) {
    const isDirectoryLink = false;
    const shouldShowRevealInFolderAction = showRevealInFolderAction && !isDirectoryLink;

    const handleClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
      e.preventDefault();
      try {
        const result = await window.electron.shell.openPath(resolved);
        if (result?.success) {
          return;
        }
        console.error('Failed to open file:', resolved, result?.error);
      } catch (error) {
        console.error('Failed to open file:', resolved, error);
      }
    };

    const handleRevealInFolder = async (e: React.MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const result = await window.electron.shell.showItemInFolder(resolved);
        if (!result?.success) {
          console.error('Failed to show item in folder:', resolved, result?.error);
          dispatchAppToast(i18nService.t('showInFolderFailed'));
        }
      } catch (error) {
        console.error('Failed to show item in folder:', resolved, error);
        dispatchAppToast(i18nService.t('showInFolderFailed'));
      }
    };

    return (
      <span className="group inline-flex max-w-full items-center gap-1 align-baseline">
        <a
          href={resolved}
          onClick={handleClick}
          className="theme-surface-markdown-link cursor-pointer inline-flex items-center gap-1"
          title={resolved}
          data-local-path={resolved}
          {...props}
        >
          {children}
          <FileText className="h-3.5 w-3.5 inline" />
        </a>
        {shouldShowRevealInFolderAction && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={handleRevealInFolder}
            className="theme-page-markdown-content-button-1 inline-flex items-center justify-center pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto"
            title={i18nService.t('showInFolder')}
            aria-label={i18nService.t('showInFolder')}
          >
            <Folder className="h-3.5 w-3.5" />
          </Button>
        )}
      </span>
    );
  }

  // 受限视图（coding 预览）里，路径样但未解析到文件的链接降级为纯文本；
  // 页内锚点等非路径 href 保持普通锚点。
  if (!isExternalLink && restrictLocalFileLinks && candidate && isLocalPathCandidate(candidate)) {
    return <span className="text-muted-foreground">{children}</span>;
  }

  if (isExternalLink) {
    const handleExternalClick = async (e: React.MouseEvent<HTMLAnchorElement>) => {
      const openExternal = (window as any)?.electron?.shell?.openExternal;
      if (typeof openExternal !== 'function') {
        return;
      }

      e.preventDefault();
      const opened = await openExternalViaDefaultBrowser(hrefValue);
      if (!opened) {
        openExternalViaAnchorFallback(hrefValue);
      }
    };

    return (
      <a
        href={hrefValue}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleExternalClick}
        className="theme-surface-markdown-link"
        {...props}
      >
        {children}
      </a>
    );
  }

  return (
    <a
      href={hrefValue}
      target="_blank"
      rel="noopener noreferrer"
      className="theme-surface-markdown-link"
      {...props}
    >
      {children}
    </a>
  );
};

interface MarkdownContentProps {
  content: string;
  className?: string;
  cwd?: string;
  restrictLocalFileLinks?: boolean;
  showRevealInFolderAction?: boolean;
  onImageClick?: (image: { src: string; alt?: string | null }) => void;
}

const MarkdownContent: React.FC<MarkdownContentProps> = ({
  content,
  className = '',
  cwd,
  restrictLocalFileLinks = false,
  showRevealInFolderAction = false,
  onImageClick,
}) => {
  const components = useMemo(
    () =>
      createMarkdownComponents(cwd, showRevealInFolderAction, onImageClick, restrictLocalFileLinks),
    [cwd, showRevealInFolderAction, onImageClick, restrictLocalFileLinks],
  );
  const normalizedContent = useMemo(
    () => normalizeDisplayMath(encodeFileUrlsInMarkdown(content)),
    [content],
  );
  return (
    <div className={`markdown-content text-sm leading-[23px] ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={safeUrlTransform}
        components={components}
      >
        {normalizedContent}
      </ReactMarkdown>
    </div>
  );
};

export default MarkdownContent;
