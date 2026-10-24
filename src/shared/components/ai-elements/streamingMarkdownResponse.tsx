/**
 * Cowork streaming — render entry (single downstream throttle for Markdown cost).
 *
 * Flow: Pi delta → translator → coalescer → IPC → LiveTextStore → **this file** (Streamdown stable blocks + plain tail).
 * While streaming: parse only closed prefix; growing tail is plain text (no per-token Shiki/Markdown).
 *
 * Invariants: one render-side throttle; finalized messages use full StaticMarkdownBlock.
 * History: per-token full Markdown parse caused renderer jank; full-snapshot IPC (#1115) caused O(N²) main→renderer bytes.
 *
 * **禁止**流式期间对每个 token 全量 Markdown 重解析；**禁止**依赖 IPC 全文快照驱动本组件更新。
 * Architecture: docs/architecture/streaming.md
 */
import { MessageResponse } from '@shared/components/ai-elements/message';
import { useStreamingTextSegments } from '@shared/components/ai-elements/streamingText';

import type { StreamingTextSegments } from '@shared/components/ai-elements/streamingText';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { StreamdownContext } from 'streamdown';

import {
  isLocalPathCandidate,
  useResolvedLocalPath,
} from '../../../renderer/services/useResolvedLocalPath';

const EXTERNAL_LINK_PATTERN = /^(https?|mailto|tel):/i;

const isExternalHref = (href: string): boolean => EXTERNAL_LINK_PATTERN.test(href);

const nodeToText = (children: ReactNode): string =>
  Array.isArray(children)
    ? children.map(child => (typeof child === 'string' ? child : '')).join('')
    : typeof children === 'string'
      ? children
      : '';

type AnchorProps = ComponentProps<'a'> & { node?: unknown };
type InlineCodeProps = ComponentProps<'code'> & { node?: unknown };

/** 打开本地文件：失败时退回在文件夹中显示（issue #805）。 */
const openLocalPath = async (filePath: string): Promise<void> => {
  try {
    const openResult = await window.electron.shell.openPath(filePath);
    if (openResult?.success) return;
    const revealResult = await window.electron.shell.showItemInFolder(filePath);
    if (!revealResult?.success) {
      console.error(
        '[Cowork] Failed to open local path:',
        filePath,
        openResult?.error ?? revealResult?.error,
      );
    }
  } catch (error) {
    console.error('[Cowork] Failed to open local path:', filePath, error);
  }
};

const LocalPathButton = ({ filePath, children }: { filePath: string; children: ReactNode }) => (
  <button
    type="button"
    className="theme-surface-markdown-link cursor-pointer break-all appearance-none bg-transparent p-0 text-left font-inherit"
    title={filePath}
    data-local-path={filePath}
    onClick={(event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      void openLocalPath(filePath);
    }}
  >
    {children}
  </button>
);

/**
 * Inline code 候选：内容整体是单行 path-looking 字符串才询问主进程；
 * 解析成功渲染为可点按钮，失败保持普通 inline code 外观。
 */
const LocalAwareInlineCode = ({
  children,
  cwd,
  enabled,
  ...props
}: InlineCodeProps & { cwd: string | undefined; enabled: boolean }) => {
  const text = nodeToText(children);
  const resolved = useResolvedLocalPath(isLocalPathCandidate(text) ? text : null, cwd, enabled);
  if (resolved) {
    return (
      <LocalPathButton filePath={resolved}>
        <code {...props}>{children}</code>
      </LocalPathButton>
    );
  }
  return <code {...props}>{children}</code>;
};

/**
 * 链接候选：href 非 http(s)/mailto/tel（含 file:// 与相对路径）时询问主进程；
 * 解析成功作为本地文件打开，否则交给 Streamdown linkSafety / 普通锚点。
 */
const LocalAwareAnchor = ({
  href,
  children,
  className,
  cwd,
  enabled,
  ...props
}: AnchorProps & { cwd: string | undefined; enabled: boolean }) => {
  const hrefValue = typeof href === 'string' ? href.trim() : '';
  const candidate = hrefValue && !isExternalHref(hrefValue) ? hrefValue : null;
  const resolved = useResolvedLocalPath(candidate, cwd, enabled);
  const { linkSafety } = useContext(StreamdownContext);
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (resolved) {
    return <LocalPathButton filePath={resolved}>{children}</LocalPathButton>;
  }

  // 外链：复用 Streamdown linkSafety（确认弹窗）
  if (linkSafety?.enabled && href) {
    const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      if (linkSafety.onLinkCheck && (await linkSafety.onLinkCheck(href))) {
        window.open(href, '_blank', 'noreferrer');
        return;
      }
      setConfirmOpen(true);
    };
    const modalProps = {
      url: href,
      isOpen: confirmOpen,
      onClose: () => setConfirmOpen(false),
      onConfirm: () => {
        window.open(href, '_blank', 'noreferrer');
      },
    };
    return (
      <>
        <button
          type="button"
          className={
            className ??
            'wrap-anywhere appearance-none text-left font-medium text-primary underline'
          }
          data-streamdown="link"
          onClick={handleClick}
        >
          {children}
        </button>
        {linkSafety.renderModal ? linkSafety.renderModal(modalProps) : null}
      </>
    );
  }

  return (
    <a {...props} href={href} className={className}>
      {children}
    </a>
  );
};

const StaticMarkdownBlock = memo(function StaticMarkdownBlock({
  content,
  cwd,
  enabled,
}: {
  content: string;
  cwd: string | undefined;
  enabled: boolean;
}) {
  const components = useMemo(
    () => ({
      a: (props: AnchorProps) => <LocalAwareAnchor {...props} cwd={cwd} enabled={enabled} />,
      inlineCode: (props: InlineCodeProps) => (
        <LocalAwareInlineCode {...props} cwd={cwd} enabled={enabled} />
      ),
    }),
    [cwd, enabled],
  );
  return <MessageResponse components={components}>{content}</MessageResponse>;
});

const LARGE_STREAMING_TAIL_CHARACTERS = 32_768;
const LARGE_STREAMING_TAIL_UPDATE_MS = 48;

const useStreamingTailContent = (content: string, sourceContent: string): string => {
  const [visibleContent, setVisibleContent] = useState(content);
  const previousContentRef = useRef({ tail: content, source: sourceContent });
  const lastUpdateAtRef = useRef(0);
  const previous = previousContentRef.current;
  const isRewrite =
    !sourceContent.startsWith(previous.source) || !content.startsWith(previous.tail);

  useEffect(() => {
    previousContentRef.current = { tail: content, source: sourceContent };
    if (isRewrite || content.length < LARGE_STREAMING_TAIL_CHARACTERS) {
      lastUpdateAtRef.current = 0;
      setVisibleContent(content);
      return;
    }
    const elapsed = performance.now() - lastUpdateAtRef.current;
    const timer = window.setTimeout(
      () => {
        lastUpdateAtRef.current = performance.now();
        setVisibleContent(content);
      },
      Math.max(0, LARGE_STREAMING_TAIL_UPDATE_MS - elapsed),
    );
    return () => window.clearTimeout(timer);
  }, [content, sourceContent, isRewrite]);

  return isRewrite || content.length < LARGE_STREAMING_TAIL_CHARACTERS ? content : visibleContent;
};

/** 流式尾段：纯文本，不做 Markdown/Shiki 重解析。 */
const StreamingPlainTail = ({
  content,
  sourceContent,
}: {
  content: string;
  sourceContent: string;
}) => {
  const visibleContent = useStreamingTailContent(content, sourceContent);
  return (
    <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{visibleContent}</div>
  );
};

export const StreamingMarkdownResponse = ({
  content,
  isStreaming,
  cwd,
}: {
  content: string;
  isStreaming: boolean;
  cwd?: string;
}) => {
  const { committed, tail }: StreamingTextSegments = useStreamingTextSegments(content, isStreaming);

  // 流结束后整段走完整 Markdown（含代码高亮 / 本地路径解析）。
  if (!isStreaming) {
    return <StaticMarkdownBlock content={content} cwd={cwd} enabled />;
  }

  // 流式中：只对已闭合的稳定块跑 Streamdown；正在增长的 tail 用纯文本。
  // 否则每个 token + 逐字 reveal 都会重解析 Markdown，16G 机器上易把渲染进程拖到「未响应」。
  if (!committed && !tail) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {committed ? (
        // 流式中的已提交块不发本地路径 IPC，流结束后统一解析。
        <StaticMarkdownBlock content={committed} cwd={cwd} enabled={false} />
      ) : null}
      {tail ? <StreamingPlainTail content={tail} sourceContent={content} /> : null}
    </div>
  );
};
