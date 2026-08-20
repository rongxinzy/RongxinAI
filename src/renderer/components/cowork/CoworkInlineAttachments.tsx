import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  type AttachmentData,
} from '@shared/components/ai-elements/attachments';
import type { KeyboardEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { i18nService } from '../../services/i18n';

export interface CoworkInlineAttachment {
  path: string;
  name: string;
  isImage?: boolean;
  dataUrl?: string;
  mediaType?: string;
}

interface CoworkInlineAttachmentsProps {
  attachments: readonly CoworkInlineAttachment[];
  className?: string;
  onRemove?: (path: string) => void;
  onOpenImage?: (image: { src: string; alt: string; name: string }) => void;
}

interface CoworkInlineAttachmentItemProps {
  attachment: CoworkInlineAttachment;
  onRemove?: (path: string) => void;
  onOpenImage?: CoworkInlineAttachmentsProps['onOpenImage'];
}

const getDataUrlMediaType = (dataUrl?: string | null): string | null => {
  if (!dataUrl) return null;
  return /^data:([^;,]+)[;,]/.exec(dataUrl)?.[1] ?? null;
};

const CoworkInlineAttachmentItem = ({
  attachment,
  onRemove,
  onOpenImage,
}: CoworkInlineAttachmentItemProps) => {
  const [resolvedDataUrl, setResolvedDataUrl] = useState<string | null>(attachment.dataUrl ?? null);

  useEffect(() => {
    setResolvedDataUrl(attachment.dataUrl ?? null);
    if (attachment.dataUrl || !attachment.isImage) {
      return;
    }

    let cancelled = false;
    void window.electron.dialog
      .readFileAsDataUrl(attachment.path)
      .then(result => {
        if (!cancelled && result.success && result.dataUrl) {
          setResolvedDataUrl(result.dataUrl);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [attachment.dataUrl, attachment.isImage, attachment.path]);

  const data = useMemo<AttachmentData>(
    () => ({
      type: 'file',
      id: attachment.path,
      filename: attachment.name,
      mediaType:
        attachment.mediaType ??
        getDataUrlMediaType(resolvedDataUrl) ??
        (attachment.isImage ? 'image/*' : 'application/octet-stream'),
      url: resolvedDataUrl ?? '',
    }),
    [attachment, resolvedDataUrl],
  );
  const canOpenImage = Boolean(attachment.isImage && resolvedDataUrl && onOpenImage);
  const openImage = () => {
    if (!canOpenImage || !resolvedDataUrl) return;
    onOpenImage?.({ src: resolvedDataUrl, alt: attachment.name, name: attachment.name });
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openImage();
  };

  return (
    <Attachment
      data={data}
      onClick={canOpenImage ? openImage : undefined}
      onKeyDown={canOpenImage ? handleKeyDown : undefined}
      onRemove={onRemove ? () => onRemove(attachment.path) : undefined}
      role={canOpenImage ? 'button' : undefined}
      tabIndex={canOpenImage ? 0 : undefined}
      title={attachment.path}
    >
      <AttachmentPreview />
      <AttachmentInfo />
      <AttachmentRemove label={i18nService.t('coworkAttachmentRemove')} />
    </Attachment>
  );
};

export const CoworkInlineAttachments = ({
  attachments,
  className,
  onRemove,
  onOpenImage,
}: CoworkInlineAttachmentsProps) => (
  <Attachments className={className} variant="inline">
    {attachments.map(attachment => (
      <CoworkInlineAttachmentItem
        key={attachment.path}
        attachment={attachment}
        onRemove={onRemove}
        onOpenImage={onOpenImage}
      />
    ))}
  </Attachments>
);
