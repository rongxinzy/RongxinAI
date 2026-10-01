import { MessageResponse } from '@shared/components/ai-elements/message';
import { useStreamingTextSegments } from '@shared/components/ai-elements/streamingText';

import type { StreamingTextSegments } from '@shared/components/ai-elements/streamingText';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';
import { useContext, useEffect, useMemo, useState } from 'react';
import { StreamdownContext } from 'streamdown';

import {
  isLikelyLocalFilePath,
  linkifyLocalPathsInMarkdown,
  parseLocalPathHref,
  resolveOpenableLocalPath,
} from '../helpers/localFilePathLinks';

type AnchorProps = ComponentProps<'a'> & { node?: unknown };

const LocalAwareAnchor = ({
  href,
  children,
  className,
  resolveLocalFilePath,
  skipPathExistsCheck = false,
  ...props
}: AnchorProps & {
  resolveLocalFilePath?: (href: string, text: string) => string | null;
  /** 流式输出时跳过 pathExists IPC，避免每个 token 打主进程把 UI 拖死。 */
  skipPathExistsCheck?: boolean;
}) => {
  const text = Array.isArray(children)
    ? children.map(child => (typeof child === 'string' ? child : '')).join('')
    : typeof children === 'string'
      ? children
      : '';
  const localPath = resolveOpenableLocalPath(href, text, resolveLocalFilePath);
  const syntheticPath = !localPath && href ? parseLocalPathHref(href) : null;
  const candidatePath = localPath ?? syntheticPath;
  const { linkSafety } = useContext(StreamdownContext);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // null = 检查中：先当普通文本，避免 1.42GB / 不存在文件误高亮
  const [exists, setExists] = useState<boolean | null>(
    candidatePath && !skipPathExistsCheck ? null : false,
  );

  useEffect(() => {
    let cancelled = false;
    if (!candidatePath || skipPathExistsCheck) {
      setExists(false);
      return;
    }
    setExists(null);
    const pathExists = window.electron?.shell?.pathExists;
    // preload 未重建时 API 可能尚不存在，避免同步抛错打崩页面
    if (typeof pathExists !== 'function') {
      setExists(false);
      return;
    }
    void pathExists(candidatePath)
      .then(result => {
        if (!cancelled) setExists(Boolean(result?.success && result.exists));
      })
      .catch(() => {
        if (!cancelled) setExists(false);
      });
    return () => {
      cancelled = true;
    };
  }, [candidatePath, skipPathExistsCheck]);

  // 2026/09/20 lixiang  仅磁盘上存在的文件才主题色+下划线+可点（issue #805）
  if (candidatePath && exists === true) {
    const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        const openResult = await window.electron.shell.openPath(candidatePath);
        if (openResult?.success) return;
        const revealResult = await window.electron.shell.showItemInFolder(candidatePath);
        if (!revealResult?.success) {
          console.error(
            '[Cowork] Failed to open local path:',
            candidatePath,
            openResult?.error ?? revealResult?.error,
          );
        }
      } catch (error) {
        console.error('[Cowork] Failed to open local path:', candidatePath, error);
      }
    };
    return (
      <button
        type="button"
        className="theme-surface-markdown-link cursor-pointer break-all appearance-none bg-transparent p-0 text-left font-inherit"
        title={candidatePath}
        data-local-path={candidatePath}
        onClick={handleClick}
      >
        {children}
      </button>
    );
  }

  if (candidatePath) {
    // 检查中或不存在：保持纯文本，不套链接样式
    return <span className="break-all">{children}</span>;
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

const renderMessage = (
  content: string,
  resolveLocalFilePath?: (href: string, text: string) => string | null,
  skipPathExistsCheck = false,
): ReactNode => {
  const linkified = linkifyLocalPathsInMarkdown(content);
  return (
    <MessageResponse
      components={{
        a: (props: AnchorProps) => (
          <LocalAwareAnchor
            {...props}
            resolveLocalFilePath={resolveLocalFilePath}
            skipPathExistsCheck={skipPathExistsCheck}
          />
        ),
      }}
    >
      {linkified}
    </MessageResponse>
  );
};

/** 流式尾段：纯文本，不做 Markdown/Shiki 重解析。 */
const StreamingPlainTail = ({ content }: { content: string }) => (
  <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{content}</div>
);

export const StreamingMarkdownResponse = ({
  content,
  isStreaming,
  resolveLocalFilePath,
}: {
  content: string;
  isStreaming: boolean;
  resolveLocalFilePath?: (href: string, text: string) => string | null;
}) => {
  const { committed, tail }: StreamingTextSegments = useStreamingTextSegments(content, isStreaming);
  const resolve = useMemo(() => resolveLocalFilePath, [resolveLocalFilePath]);

  // 流结束后整段走完整 Markdown（含代码高亮 / 本地路径检查）。
  if (!isStreaming) {
    return <>{renderMessage(content, resolve)}</>;
  }

  // 流式中：只对已闭合的稳定块跑 Streamdown；正在增长的 tail 用纯文本。
  // 否则每个 token + 逐字 reveal 都会重解析 Markdown，16G 机器上易把渲染进程拖到「未响应」。
  if (!committed && !tail) {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      {committed ? renderMessage(committed, resolve, true) : null}
      {tail ? <StreamingPlainTail content={tail} /> : null}
    </div>
  );
};

export { isLikelyLocalFilePath };
