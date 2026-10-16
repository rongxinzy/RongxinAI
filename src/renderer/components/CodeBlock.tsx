import { closeSearchPanel, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { Button } from '@shared/components/ui/button';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Maximize2,
  Search,
  WrapText,
} from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { i18nService } from '../services/i18n';
import { CodeFullscreenModal } from './codeblock/CodeFullscreenModal';
import { CodeMirrorEditor } from './codeblock/CodeMirrorEditor';
import { CODE_BLOCK_CHAR_LIMIT, CODE_BLOCK_LINE_LIMIT } from './codeblock/constants';
import { parseDiff } from './codeblock/diff';
import { DiffView } from './codeblock/DiffView';
import { CodeBlockTooltip, HeaderButton } from './codeblock/headerControls';
import { useIsDark, useLanguageSupport } from './codeblock/hooks';
import { inferFileExtension } from './codeblock/language';

// ---------------------------------------------------------------------------
// Main CodeBlock component
// ---------------------------------------------------------------------------

interface CodeBlockProps {
  node?: any;
  className?: string;
  children?: React.ReactNode;
  inline?: boolean;
  [key: string]: any;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ node, className, children, ...props }) => {
  const normalizedClassName = Array.isArray(className) ? className.join(' ') : className || '';
  const match = /language-([\w-]+)/.exec(normalizedClassName);
  const hasPosition = node?.position?.start?.line != null && node?.position?.end?.line != null;
  const isInline =
    typeof props.inline === 'boolean'
      ? props.inline
      : hasPosition
        ? node.position.start.line === node.position.end.line
        : !match;

  const codeText = Array.isArray(children) ? children.join('') : String(children);
  const trimmedCodeText = codeText.replace(/\n$/, '');

  const rawLang = match ? match[1].toLowerCase() : null;

  // Detect diff blocks: ```diff or ```diff:typescript
  const isDiffBlock = rawLang === 'diff' || rawLang?.startsWith('diff:') === true;
  const diffInnerLang = isDiffBlock && rawLang!.includes(':') ? rawLang!.split(':')[1] : null;

  const shouldUseCodeMirror =
    !isInline &&
    match &&
    trimmedCodeText.length <= CODE_BLOCK_CHAR_LIMIT &&
    trimmedCodeText.split('\n').length <= CODE_BLOCK_LINE_LIMIT;

  // For diff blocks, parse original vs modified
  const diffParsed = useMemo(() => {
    if (!isDiffBlock || !shouldUseCodeMirror) return null;
    return parseDiff(trimmedCodeText);
  }, [isDiffBlock, shouldUseCodeMirror, trimmedCodeText]);

  // Resolve language for syntax highlight
  const syntaxLangName = isDiffBlock ? diffInnerLang : rawLang;
  const langSupport = useLanguageSupport(shouldUseCodeMirror ? syntaxLangName : null);

  const [isCopied, setIsCopied] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const copyTimeoutRef = useRef<number | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const isDark = useIsDark();

  useEffect(
    () => () => {
      if (copyTimeoutRef.current != null) window.clearTimeout(copyTimeoutRef.current);
    },
    [],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(trimmedCodeText);
      setIsCopied(true);
      if (copyTimeoutRef.current != null) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setIsCopied(false), 1500);
    } catch (error) {
      console.error('Failed to copy code block: ', error);
    }
  }, [trimmedCodeText]);

  const savedTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (savedTimeoutRef.current != null) window.clearTimeout(savedTimeoutRef.current);
    },
    [],
  );

  const handleSave = useCallback(() => {
    try {
      const ext = inferFileExtension(rawLang);
      const fileName = `code.${ext}`;
      const blob = new Blob([trimmedCodeText], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setIsSaved(true);
      if (savedTimeoutRef.current != null) window.clearTimeout(savedTimeoutRef.current);
      savedTimeoutRef.current = window.setTimeout(() => setIsSaved(false), 1500);
    } catch (error) {
      console.error('Failed to save code block: ', error);
    }
  }, [trimmedCodeText, rawLang]);

  const handleToggleSearch = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const isOpen = searchPanelOpen(view.state);
    if (isOpen) {
      closeSearchPanel(view);
    } else {
      openSearchPanel(view);
      view.focus();
    }
    // searchOpen state is synced by the updateListener in useCodeMirrorView
  }, []);

  const handleToggleCollapse = useCallback(() => {
    setCollapsed(v => !v);
  }, []);

  const handleViewReady = useCallback((view: EditorView | null) => {
    viewRef.current = view;
  }, []);

  // -------------------------------------------------------------------------
  // Inline code
  // -------------------------------------------------------------------------
  if (isInline) {
    const inlineClassName = [
      'inline bg-transparent px-0.5 text-[0.92em] font-mono font-medium text-foreground',
      normalizedClassName,
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <code className={inlineClassName} {...props}>
        {children}
      </code>
    );
  }

  // -------------------------------------------------------------------------
  // No-language plain block
  // -------------------------------------------------------------------------
  if (!match) {
    return (
      <div className="my-2 relative group">
        <div className="overflow-x-auto rounded-lg border border-border-subtle bg-editor-background text-sm leading-6">
          <CodeBlockTooltip
            content={i18nService.t('copyToClipboard')}
            className="absolute top-2 right-2 z-10 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity duration-200"
          >
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleCopy}
              className="theme-page-code-block-button-1 inline-flex items-center justify-center transform-gpu"
              aria-label={i18nService.t('copyToClipboard')}
            >
              {isCopied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            </Button>
          </CodeBlockTooltip>
          <code className="block px-4 py-3 font-mono text-editor-foreground whitespace-pre">
            {trimmedCodeText}
          </code>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Language code block header
  // -------------------------------------------------------------------------
  const displayLang = isDiffBlock ? (diffInnerLang ? `diff · ${diffInnerLang}` : 'diff') : match[1];

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-border-subtle bg-surface-raised/40 relative">
      {/* Fullscreen modal */}
      {fullscreen && (
        <CodeFullscreenModal
          code={trimmedCodeText}
          lang={rawLang}
          isDark={isDark}
          onClose={() => setFullscreen(false)}
        />
      )}
      {/* Header */}
      <div className="bg-surface-raised/70 border-b border-border-subtle px-3.5 py-1.5 text-xs text-muted-foreground font-medium flex items-center justify-between">
        <span className="font-mono opacity-70">{displayLang}</span>
        <div className="flex items-center gap-0.5">
          {/* Collapse / expand the entire code body */}
          <CodeBlockTooltip
            content={
              collapsed ? i18nService.t('codeBlockExpand') : i18nService.t('codeBlockCollapse')
            }
          >
            <HeaderButton
              onClick={handleToggleCollapse}
              ariaLabel={
                collapsed ? i18nService.t('codeBlockExpand') : i18nService.t('codeBlockCollapse')
              }
              active={collapsed}
            >
              {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </HeaderButton>
          </CodeBlockTooltip>
          {/* Search toggle - only for regular code blocks (not diff) */}
          {!isDiffBlock && (
            <CodeBlockTooltip
              content={
                searchOpen
                  ? i18nService.t('codeBlockSearchClose')
                  : i18nService.t('codeBlockSearch')
              }
            >
              <HeaderButton
                onClick={handleToggleSearch}
                ariaLabel={
                  searchOpen
                    ? i18nService.t('codeBlockSearchClose')
                    : i18nService.t('codeBlockSearch')
                }
                active={searchOpen}
              >
                <Search className="h-4 w-4" />
              </HeaderButton>
            </CodeBlockTooltip>
          )}
          {/* Word wrap toggle */}
          <CodeBlockTooltip
            content={
              wrap ? i18nService.t('codeBlockWordWrapOff') : i18nService.t('codeBlockWordWrap')
            }
          >
            <HeaderButton
              onClick={() => setWrap(v => !v)}
              ariaLabel={
                wrap ? i18nService.t('codeBlockWordWrapOff') : i18nService.t('codeBlockWordWrap')
              }
              active={wrap}
            >
              <WrapText className="h-4 w-4" />
            </HeaderButton>
          </CodeBlockTooltip>
          {/* Fullscreen expand */}
          <CodeBlockTooltip content={i18nService.t('codeBlockFullscreen')}>
            <HeaderButton
              onClick={() => setFullscreen(true)}
              ariaLabel={i18nService.t('codeBlockFullscreen')}
            >
              <Maximize2 className="h-4 w-4" />
            </HeaderButton>
          </CodeBlockTooltip>
          {/* Copy */}
          <CodeBlockTooltip content={i18nService.t('copyToClipboard')}>
            <HeaderButton onClick={handleCopy} ariaLabel={i18nService.t('copyToClipboard')}>
              {isCopied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
            </HeaderButton>
          </CodeBlockTooltip>
          {/* Save to file */}
          <CodeBlockTooltip content={i18nService.t('saveToFile')}>
            <HeaderButton onClick={handleSave} ariaLabel={i18nService.t('saveToFile')}>
              {isSaved ? (
                <Check className="h-4 w-4 text-success" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </HeaderButton>
          </CodeBlockTooltip>
        </div>
      </div>

      {/* Body - hidden when collapsed */}
      {!collapsed &&
        (shouldUseCodeMirror ? (
          isDiffBlock && diffParsed ? (
            <DiffView
              original={diffParsed.original}
              modified={diffParsed.modified}
              langSupport={langSupport}
              isDark={isDark}
              wrap={wrap}
            />
          ) : (
            <CodeMirrorEditor
              doc={trimmedCodeText}
              isDark={isDark}
              wrap={wrap}
              langSupport={langSupport}
              onViewReady={handleViewReady}
              onSearchOpenChange={setSearchOpen}
            />
          )
        ) : (
          <div className="m-0 overflow-x-auto bg-editor-background text-sm leading-6">
            <code className="block px-4 py-3 font-mono text-editor-foreground whitespace-pre">
              {trimmedCodeText}
            </code>
          </div>
        ))}
    </div>
  );
};

export default CodeBlock;
