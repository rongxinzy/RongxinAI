import { X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@shared/components/ui/button';

import { i18nService } from '../../../renderer/services/i18n';

/**
 * 2026/09/15 lixiang  自定义外链确认弹窗（替换 Streamdown 内置的 link-safety-modal）。
 * Streamdown 自带弹窗内联渲染在消息 DOM 内（未用 portal），而消息容器上的
 * `animate-message-in` 动画以 fill-mode: both 持久保留 transform、外层还有 overflow-hidden 与
 * contain-[layout_style_paint]（App.tsx），二者分别劫持 position:fixed 的包含块、裁剪弹窗卡片，
 * 导致点击链接只看到模糊遮罩而看不到弹窗内容。此组件通过 createPortal 挂载到 document.body
 * 绕开全部祖先影响；经 Streamdown 的 linkSafety.renderModal 扩展点接入，拦截行为保持不变。
 */
export const LinkSafetyModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  url: string;
}> = ({ isOpen, onClose, onConfirm, url }) => {
  const [isCopied, setIsCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) setIsCopied(false);
  }, [isOpen]);

  if (!isOpen || typeof document === 'undefined') return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setIsCopied(true);
    } catch {
      // Clipboard unavailable — leave the URL visible so the user can copy manually.
    }
  };

  // 2026/09/15 lixiang  Streamdown 的 onConfirm 只负责打开链接不关弹窗（内置弹窗是自己追加 onClose 的），
  // 这里与其保持一致：确认打开后同步关闭弹窗。
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px]"
      data-streamdown="link-safety-modal"
      onClick={onClose}
    >
      <div
        className="relative mx-4 flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-background p-6 shadow-lg"
        onClick={event => event.stopPropagation()}
        role="presentation"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="absolute top-4 right-4"
          onClick={onClose}
          aria-label={i18nService.t('close')}
          title={i18nService.t('close')}
        >
          <X className="size-4" />
        </Button>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 font-semibold text-lg text-foreground">
            <span>{i18nService.t('linkSafetyOpenExternalTitle')}</span>
          </div>
          <p className="text-muted-foreground text-sm">
            {i18nService.t('linkSafetyOpenExternalWarning')}
          </p>
        </div>

        <div className="max-h-32 overflow-y-auto rounded-md bg-muted p-3 font-mono text-sm break-all text-foreground">
          {url}
        </div>

        {/* 2026/09/15 lixiang  复制/打开按钮同行等宽排列，弹窗留出横向内边距防止按钮溢出 */}
        <div className="flex w-full gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={handleCopy}
          >
            {isCopied
              ? i18nService.t('linkSafetyCopied')
              : i18nService.t('linkSafetyCopyLink')}
          </Button>
          <Button
            type="button"
            variant="default"
            className="flex-1"
            onClick={handleConfirm}
          >
            {i18nService.t('linkSafetyConfirmOpen')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
