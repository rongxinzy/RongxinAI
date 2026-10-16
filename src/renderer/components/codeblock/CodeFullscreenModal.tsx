import { closeSearchPanel, openSearchPanel, searchPanelOpen } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { Check, Copy, Search, WrapText } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { i18nService } from '../../services/i18n';
import { CodeMirrorEditor } from './CodeMirrorEditor';
import { CodeBlockTooltip, HeaderButton } from './headerControls';
import { useLanguageSupport } from './hooks';

// ---------------------------------------------------------------------------
// Fullscreen modal
// ---------------------------------------------------------------------------

interface CodeFullscreenModalProps {
  code: string;
  lang: string | null;
  isDark: boolean;
  onClose: () => void;
}

export const CodeFullscreenModal: React.FC<CodeFullscreenModalProps> = ({
  code,
  lang,
  isDark,
  onClose,
}) => {
  const [wrap, setWrap] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const viewRef = useRef<EditorView | null>(null);
  const copyTimeoutRef = useRef<number | null>(null);
  const langSupport = useLanguageSupport(lang);

  // Close on Escape
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setIsCopied(true);
      if (copyTimeoutRef.current != null) window.clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = window.setTimeout(() => setIsCopied(false), 1500);
    } catch (err) {
      console.error('Failed to copy in fullscreen modal:', err);
    }
  }, [code]);

  const handleToggleSearch = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    if (searchPanelOpen(view.state)) {
      closeSearchPanel(view);
    } else {
      openSearchPanel(view);
      view.focus();
    }
  }, []);

  const handleViewReady = useCallback((view: EditorView | null) => {
    viewRef.current = view;
  }, []);

  const t = (key: string) => i18nService.t(key as any);

  return createPortal(
    <div
      // 2026/09/16 lixiang  代码预览全屏遮罩复用公共 modal-backdrop
      className="modal-backdrop fixed inset-0 z-200 flex flex-col"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Modal container */}
      <div
        className="theme-surface-code-preview flex flex-col m-8 overflow-hidden"
        style={{ flex: 1, minHeight: 0, backgroundColor: 'var(--zy-component-editor-background)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="bg-surface-raised px-4 py-2 flex items-center justify-between border-b border-border shrink-0">
          <span className="font-mono text-xs text-muted-foreground opacity-70">
            {lang ?? 'code'}
          </span>
          <div className="flex items-center gap-0.5">
            <CodeBlockTooltip
              content={searchOpen ? t('codeBlockSearchClose') : t('codeBlockSearch')}
            >
              <HeaderButton
                onClick={handleToggleSearch}
                ariaLabel={searchOpen ? t('codeBlockSearchClose') : t('codeBlockSearch')}
                active={searchOpen}
              >
                <Search className="h-4 w-4" />
              </HeaderButton>
            </CodeBlockTooltip>
            <CodeBlockTooltip content={wrap ? t('codeBlockWordWrapOff') : t('codeBlockWordWrap')}>
              <HeaderButton
                onClick={() => setWrap(v => !v)}
                ariaLabel={wrap ? t('codeBlockWordWrapOff') : t('codeBlockWordWrap')}
                active={wrap}
              >
                <WrapText className="h-4 w-4" />
              </HeaderButton>
            </CodeBlockTooltip>
            <CodeBlockTooltip content={t('copyToClipboard')}>
              <HeaderButton onClick={handleCopy} ariaLabel={t('copyToClipboard')}>
                {isCopied ? (
                  <Check className="h-4 w-4 text-success" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </HeaderButton>
            </CodeBlockTooltip>
            {/* Divider */}
            <span className="w-px h-4 bg-border mx-1" />
            {/* Close */}
            <CodeBlockTooltip content={t('codeBlockFullscreenExit')}>
              <HeaderButton onClick={onClose} ariaLabel={t('codeBlockFullscreenExit')}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </HeaderButton>
            </CodeBlockTooltip>
          </div>
        </div>
        {/* Modal body — scrollable editor */}
        <div className="flex-1 overflow-auto">
          <CodeMirrorEditor
            doc={code}
            isDark={isDark}
            wrap={wrap}
            langSupport={langSupport}
            onViewReady={handleViewReady}
            onSearchOpenChange={setSearchOpen}
          />
        </div>
      </div>
    </div>,
    document.body,
  );
};
