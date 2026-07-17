import { Button } from '@shared/components/ui/button';
import { FileImage, X } from 'lucide-react';
import React, { useEffect,useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { DraftAttachment } from '../../store/slices/coworkSlice';
import FileTypeIcon from '../icons/fileTypes/FileTypeIcon';
import { getFileTypeInfo } from '../icons/fileTypes/index';

interface AttachmentCardProps {
  attachment: DraftAttachment;
  onRemove: (path: string) => void;
}

/**
 * Renders a single attachment as a card.
 * - Image attachments: 64×64 thumbnail with overlay file name
 * - Non-image attachments: horizontal card with file-type icon + name + type label
 */
const AttachmentCard: React.FC<AttachmentCardProps> = ({ attachment, onRemove }) => {
  if (attachment.isImage) {
    return <ImageCard attachment={attachment} onRemove={onRemove} />;
  }
  return <FileCard attachment={attachment} onRemove={onRemove} />;
};

// ── Image thumbnail card ──────────────────────────────────────────

const ImageCard: React.FC<AttachmentCardProps> = ({ attachment, onRemove }) => {
  const [thumbUrl, setThumbUrl] = useState<string | null>(attachment.dataUrl ?? null);
  const [imgError, setImgError] = useState(false);
  const [loading, setLoading] = useState(!attachment.dataUrl);

  // If no dataUrl, try loading via IPC
  useEffect(() => {
    if (attachment.dataUrl) {
      setThumbUrl(attachment.dataUrl);
      setLoading(false);
      return;
    }
    if (!attachment.path || attachment.path.startsWith('inline:')) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await window.electron.dialog.readFileAsDataUrl(attachment.path);
        if (!cancelled && result.success && result.dataUrl) {
          setThumbUrl(result.dataUrl);
        }
      } catch {
        // ignore – will show fallback icon
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [attachment.dataUrl, attachment.path]);

  const showFallback = imgError || (!thumbUrl && !loading);

  return (
    <div
      className="group relative h-16 w-16 shrink-0 rounded-lg border dark:border-claude-darkBorder border-claude-border overflow-hidden bg-claude-surface dark:bg-claude-darkSurface"
      title={attachment.path}
    >
      {/* Thumbnail or fallback */}
      {loading ? (
        <div className="flex h-full w-full items-center justify-center">
          <FileImage className="h-6 w-6 text-blue-400 animate-pulse" />
        </div>
      ) : showFallback ? (
        <div className="flex h-full w-full items-center justify-center">
          <FileImage className="h-6 w-6 text-blue-400" />
        </div>
      ) : (
        <img
          src={thumbUrl!}
          alt={attachment.name}
          className="h-full w-full object-cover"
          onError={() => setImgError(true)}
          draggable={false}
        />
      )}

      {/* File name overlay at bottom */}
      <div className="absolute inset-x-0 bottom-0 bg-black/50 px-1 py-0.5">
        <span className="block truncate text-[10px] leading-tight text-white">
          {attachment.name}
        </span>
      </div>

      {/* Delete button — top-right, visible on hover */}
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute top-0.5 right-0.5 hidden group-hover:flex bg-black/60 hover:bg-black/80 text-white"
        onClick={() => onRemove(attachment.path)}
        aria-label={i18nService.t('coworkAttachmentRemove')}
        title={i18nService.t('coworkAttachmentRemove')}
      >
        <X className="h-2.5 w-2.5" />
      </Button>
    </div>
  );
};

// ── Non-image file card ───────────────────────────────────────────

const FileCard: React.FC<AttachmentCardProps> = ({ attachment, onRemove }) => {
  const { label } = getFileTypeInfo(attachment.name);

  return (
    <div
      className="group relative flex h-16 w-40 shrink-0 items-center gap-2 rounded-lg border dark:border-claude-darkBorder border-claude-border bg-claude-surface dark:bg-claude-darkSurface px-2"
      title={attachment.path}
    >
      {/* File type icon */}
      <FileTypeIcon fileName={attachment.name} className="h-8 w-8 shrink-0" />

      {/* File name + type label */}
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <span className="truncate text-xs font-medium dark:text-claude-darkText text-claude-text">
          {attachment.name}
        </span>
        <span className="text-[10px] dark:text-claude-darkTextSecondary text-claude-textSecondary">
          {label}
        </span>
      </div>

      {/* Delete button — top-right, visible on hover */}
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={() => onRemove(attachment.path)}
        aria-label={i18nService.t('coworkAttachmentRemove')}
        title={i18nService.t('coworkAttachmentRemove')}
      >
        <X className="h-2.5 w-2.5" />
      </Button>
    </div>
  );
};

export default AttachmentCard;
