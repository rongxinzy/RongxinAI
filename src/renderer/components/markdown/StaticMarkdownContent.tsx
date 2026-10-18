/**
 * 静态（非流式）Markdown 渲染：Streamdown 单一管线。
 *
 * 与 cowork 流式链路（StreamingMarkdownResponse，docs/architecture/streaming.md）共用
 * Streamdown + ai-elements 代码块（shiki）+ KaTeX 数学 + 本地文件链接解析，静态表面
 * （artifacts Markdown、Skill 文档、coding 预览、activity/failure 摘要）统一走本组件。
 * 旧 react-markdown 管线（MarkdownContent.tsx）已删除。
 *
 * 本地链接语义（issue #805）：候选交主进程 `shell.resolveLocalPath` 判定；`file://` 前缀
 * 在进入解析器前剥掉（Streamdown 的 sanitize 只放行 http(s)/mailto/tel 与相对路径，
 * 带 scheme 的 file URL 会被过滤掉），剥掉后的裸路径与相对路径候选走同一解析链。
 */
import { cjk } from '@streamdown/cjk';
import { code } from '@streamdown/code';
import { math } from '@streamdown/math';
import { Button } from '@shared/components/ui/button';
import { FileText, Folder } from 'lucide-react';
import React, { Suspense, lazy, useMemo } from 'react';
import { Streamdown, type StreamdownProps } from 'streamdown';

import { i18nService } from '../../services/i18n';
import { showAppToast } from '../../services/toastNotification';
import { isLocalPathCandidate, useResolvedLocalPath } from '../../services/useResolvedLocalPath';
import { toLocalfileUrl } from '../../utils/localfileUrl';
import { zhiyuanShikiThemes } from './shikiThemes';

// KaTeX 样式与 mhchem 宏随富渲染模块按需加载（与 chat 的 richMessageResponse 同策略）。
const RichStaticMarkdown = lazy(() => import('./richStaticMarkdown'));

/** 外链协议：与 StreamingMarkdownResponse 的 EXTERNAL_LINK_PATTERN 保持一致。 */
const EXTERNAL_LINK_PATTERN = /^(https?|mailto|tel):/i;

const isExternalHref = (href: string): boolean => EXTERNAL_LINK_PATTERN.test(href);

/** 打开本地文件：主进程判定存在才走到这里，失败回落到在文件夹中显示。 */
const openLocalPath = async (filePath: string): Promise<void> => {
  try {
    const openResult = await window.electron.shell.openPath(filePath);
    if (openResult?.success) return;
    const revealResult = await window.electron.shell.showItemInFolder(filePath);
    if (!revealResult?.success) {
      console.error(
        '[StaticMarkdown] Failed to open local path:',
        filePath,
        openResult?.error ?? revealResult?.error,
      );
    }
  } catch (error) {
    console.error('[StaticMarkdown] Failed to open local path:', error);
  }
};

const revealInFolder = async (filePath: string): Promise<void> => {
  try {
    const result = await window.electron.shell.showItemInFolder(filePath);
    if (!result?.success) {
      console.error('[StaticMarkdown] Failed to show item in folder:', filePath, result?.error);
      showAppToast(i18nService.t('showInFolderFailed'));
    }
  } catch (error) {
    console.error('[StaticMarkdown] Failed to show item in folder:', error);
    showAppToast(i18nService.t('showInFolderFailed'));
  }
};

type AnchorProps = React.ComponentProps<'a'>;

/**
 * 链接：本地路径候选（相对/绝对/file:// 剥壳后）解析成功渲染为可点开文件；
 * 外链交给 Streamdown linkSafety（外链确认弹窗）；其余保持普通锚点。
 */
const LocalAwareAnchor = ({
  cwd,
  restrictLocalFileLinks,
  showRevealInFolderAction,
  ...props
}: AnchorProps & {
  cwd: string | undefined;
  restrictLocalFileLinks: boolean;
  showRevealInFolderAction: boolean;
}) => {
  const hrefValue = typeof props.href === 'string' ? props.href.trim() : '';
  const external = !!hrefValue && isExternalHref(hrefValue);
  const candidate = hrefValue && !external ? hrefValue : null;
  const resolved = useResolvedLocalPath(
    candidate && isLocalPathCandidate(candidate) ? candidate : null,
    cwd,
    true,
  );

  if (resolved) {
    return (
      <span className="group inline-flex max-w-full items-center gap-1 align-baseline">
        <a
          href={resolved}
          className="theme-surface-markdown-link cursor-pointer inline-flex items-center gap-1"
          title={resolved}
          data-local-path={resolved}
          onClick={event => {
            event.preventDefault();
            void openLocalPath(resolved);
          }}
        >
          {props.children}
          <FileText className="h-3.5 w-3.5 inline" />
        </a>
        {showRevealInFolderAction && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="theme-page-markdown-content-button-1 inline-flex items-center justify-center pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto"
            title={i18nService.t('showInFolder')}
            aria-label={i18nService.t('showInFolder')}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              void revealInFolder(resolved);
            }}
          >
            <Folder className="h-3.5 w-3.5" />
          </Button>
        )}
      </span>
    );
  }

  // 受限视图（coding 预览）里，路径样但未解析到文件的链接降级为纯文本。
  if (!external && restrictLocalFileLinks && candidate && isLocalPathCandidate(candidate)) {
    return <span className="text-muted-foreground">{props.children}</span>;
  }

  return <a {...props} />;
};

type ImageProps = React.ComponentProps<'img'> & {
  onImageClick?: (image: { src: string; alt?: string | null }) => void;
};

/**
 * 图片：file:// 与绝对路径经 `localfile://` 受控协议加载（主进程校验扩展名与
 * 敏感路径），支持点击放大预览。
 */
const LocalAwareImage = ({ onImageClick, ...props }: ImageProps) => {
  const src = typeof props.src === 'string' ? toLocalfileUrl(props.src) : props.src;
  return (
    <img
      {...props}
      src={src}
      className={`max-w-full max-h-96 object-contain rounded-xl my-4${
        onImageClick && src ? ' cursor-pointer hover:opacity-90 transition-opacity' : ''
      }`}
      onClick={
        onImageClick && src ? () => onImageClick({ src, alt: props.alt }) : undefined
      }
    />
  );
};

export interface StaticMarkdownContentProps {
  content: string;
  className?: string;
  cwd?: string;
  restrictLocalFileLinks?: boolean;
  showRevealInFolderAction?: boolean;
  onImageClick?: (image: { src: string; alt?: string | null }) => void;
}

const stripFileScheme = (destination: string): string => {
  const trimmed = destination.trim();
  const match = /^file:\/{2,3}(\/\/)?(.*)$/.exec(trimmed);
  return match ? (match[2] ?? '') : destination;
};

/**
 * Markdown 预处理：
 * 1. `file://` 链接目标 URL 编码（括号等字符会截断 markdown 目标解析）；
 * 2. 剥掉 `file://` scheme —— Streamdown sanitize 只放行 http(s)/mailto/tel/相对路径，
 *    剥壳后的裸路径候选由 LocalAwareAnchor 经主进程解析。
 */
const preprocessMarkdown = (content: string): string => {
  if (!content.includes('](file:')) return content;

  let result = '';
  let cursor = 0;
  while (cursor < content.length) {
    const openIndex = content.indexOf('](file:', cursor);
    if (openIndex === -1) {
      result += content.slice(cursor);
      break;
    }
    const destStart = openIndex + 2;
    let depth = 1;
    let destEnd = -1;
    for (let i = destStart; i < content.length; i += 1) {
      const char = content[i];
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
          destEnd = i;
          break;
        }
      }
      if (char === '\n') {
        break;
      }
    }
    if (destEnd === -1) {
      result += content.slice(cursor);
      break;
    }

    const destination = content.slice(destStart, destEnd);
    const stripped = stripFileScheme(destination);
    const encoded = stripped ? encodeURI(stripped).replace(/\(/g, '%28').replace(/\)/g, '%29') : '';
    result += content.slice(cursor, destStart) + encoded;
    cursor = destEnd;
  }
  return result;
};

// 外链确认弹窗 portal 到 body（与 chat 的 LinkSafetyModal 同一扩展点）。
const linkSafety: StreamdownProps['linkSafety'] = {
  enabled: true,
  renderModal: () => null,
};

const basePlugins = { cjk };

const StaticMarkdownContent: React.FC<StaticMarkdownContentProps> = ({
  content,
  className = '',
  cwd,
  restrictLocalFileLinks = false,
  showRevealInFolderAction = false,
  onImageClick,
}) => {
  const processed = useMemo(() => preprocessMarkdown(content), [content]);

  const components = useMemo(
    () => ({
      a: (props: AnchorProps) => (
        <LocalAwareAnchor
          {...props}
          cwd={cwd}
          restrictLocalFileLinks={restrictLocalFileLinks}
          showRevealInFolderAction={showRevealInFolderAction}
        />
      ),
      img: (props: React.ComponentProps<'img'>) => (
        <LocalAwareImage {...props} onImageClick={onImageClick} />
      ),
    }),
    [cwd, restrictLocalFileLinks, showRevealInFolderAction, onImageClick],
  );

  const needsRichRuntime = /```|~~~|\$\$/.test(processed);

  const body = (
    <Streamdown
      className={`markdown-content text-sm leading-[23px] ${className}`}
      mode="static"
      animated={false}
      parseIncompleteMarkdown={false}
      shikiTheme={zhiyuanShikiThemes}
      codeBlockMaxHeight={0}
      tableMaxHeight={0}
      linkSafety={undefined}
      components={components}
    >
      {processed}
    </Streamdown>
  );

  if (!needsRichRuntime) {
    return <div className={className ? undefined : undefined}>{body}</div>;
  }

  return (
    <Suspense fallback={body}>
      <RichStaticMarkdown
        className={`markdown-content text-sm leading-[23px] ${className}`}
        processed={processed}
        components={components}
      />
    </Suspense>
  );
};

export default StaticMarkdownContent;
