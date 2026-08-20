import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  getAttachmentLabel,
  getMediaCategory,
  type AttachmentData,
} from '@shared/components/ai-elements/attachments';
import { cn } from '@shared/lib/utils';
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
  const mediaCategory = getMediaCategory(data);
  const label = getAttachmentLabel(data);
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
    <AttachmentHoverCard>
      <AttachmentHoverCardTrigger
        closeDelay={100}
        delay={200}
        render={
          <Attachment
            data={data}
            onClick={canOpenImage ? openImage : undefined}
            onKeyDown={canOpenImage ? handleKeyDown : undefined}
            onRemove={onRemove ? () => onRemove(attachment.path) : undefined}
            role={canOpenImage ? 'button' : undefined}
            tabIndex={canOpenImage ? 0 : undefined}
            title={attachment.path}
          >
            <div className="relative size-5 shrink-0">
              <div
                className={cn(
                  'absolute inset-0',
                  onRemove && 'transition-opacity duration-150 group-hover:opacity-0',
                )}
              >
                <AttachmentPreview />
              </div>
              <AttachmentRemove
                className="absolute inset-0 duration-150"
                label={i18nService.t('coworkAttachmentRemove')}
              />
            </div>
            <AttachmentInfo />
          </Attachment>
        }
      />
      <AttachmentHoverCardContent align="start">
        <div className="flex max-w-80 flex-col gap-3">
          {mediaCategory === 'image' && data.type === 'file' && data.url && (
            <div className="flex max-h-96 w-80 items-center justify-center overflow-hidden rounded-md border border-border">
              <img
                alt={label}
                className="max-h-96 max-w-full object-contain"
                height={384}
                src={data.url}
                width={320}
              />
            </div>
          )}
          <div className="flex min-w-0 flex-col gap-1 px-0.5">
            <h4 className="truncate text-sm font-semibold leading-none">{label}</h4>
            {data.mediaType && (
              <p className="truncate font-mono text-xs text-muted-foreground">{data.mediaType}</p>
            )}
          </div>
        </div>
      </AttachmentHoverCardContent>
    </AttachmentHoverCard>
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
