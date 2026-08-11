import { Message, MessageContent } from '@shared/components/ai-elements/message';
import { Button } from '@shared/components/ui/button';
import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type {
  CoworkImageAttachment,
  CoworkFileAttachment,
  CoworkMessage,
  CoworkMessageMetadata,
} from '../../../types/cowork';
import { i18nService } from '../../../services/i18n';
import { resolveSkillIconUrl } from '../../../services/skillIcon';
import { PlusMenuSkillsIcon } from '../plusMenuIcons';
import type { Skill } from '../../../types/skill';
import { formatMessageDateTime } from '../../../utils/tokenFormat';
import { parseUserMessageForDisplay } from '../../../utils/userMessageDisplay';
import ImagePreviewModal, { type ImagePreviewSource } from '../ImagePreviewModal';
import { findChatSkillShortcut } from '../../chat/constants';
import { CopyButton, ReEditButton } from './CopyButton';
import FileTypeIcon from '../../icons/fileTypes/FileTypeIcon';

const getMessageModelLabel = (metadata?: CoworkMessageMetadata | null): string | null => {
  const model = typeof metadata?.model === 'string' ? metadata.model.trim() : '';
  if (!model) return null;
  return model.includes('/') ? model.split('/').pop() || model : model;
};

const hasFocusWithin = (element: HTMLElement): boolean =>
  document.activeElement instanceof Node && element.contains(document.activeElement);

export const UserBubble: React.FC<{
  message: CoworkMessage;
  skills: Skill[];
  onReEdit?: (message: CoworkMessage) => void;
}> = React.memo(({ message, skills, onReEdit }) => {
  const [isHovered, setIsHovered] = useState(false);
  const [expandedImage, setExpandedImage] = useState<ImagePreviewSource | null>(null);
  const modelLabel = getMessageModelLabel(message.metadata);
  const handleBlur = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setIsHovered(false);
  }, []);
  const handleMouseLeave = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (hasFocusWithin(event.currentTarget)) return;
    setIsHovered(false);
  }, []);
  const displayContent = useMemo(
    () => parseUserMessageForDisplay(message.content || ''),
    [message.content],
  );
  const messageSkillIds = (message.metadata as CoworkMessageMetadata)?.skillIds || [];
  const messageSkills = messageSkillIds
    .map(id => skills.find(s => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);
  const imageAttachments = useMemo(
    () =>
      ((message.metadata as CoworkMessageMetadata)?.imageAttachments ??
        []) as CoworkImageAttachment[],
    [message.metadata],
  );
  const fileAttachments = useMemo(
    () =>
      ((message.metadata as CoworkMessageMetadata)?.fileAttachments ??
        []) as CoworkFileAttachment[],
    [message.metadata],
  );
  const textContent = useMemo(() => {
    if (fileAttachments.length === 0) return displayContent;
    const filePaths = new Set(fileAttachments.map(file => file.path));
    return displayContent
      .split(/\r?\n/)
      .filter(line => !Array.from(filePaths).some(path => line.includes(path)))
      .join('\n')
      .replace(/^\n+|\n+$/g, '');
  }, [displayContent, fileAttachments]);
  const hasTextContent = Boolean(textContent.trim()) || messageSkills.length > 0;

  return (
    <div
      className="w-full py-2 px-4 focus:outline-none"
      tabIndex={0}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onBlur={handleBlur}
    >
      <div className="mx-auto flex w-full max-w-5xl min-w-[320px] flex-col items-end">
        {imageAttachments.length > 0 && (
          <div className="ml-auto mb-2 flex w-fit max-w-full flex-wrap justify-end gap-2">
            {imageAttachments.map((img, idx) => (
              <Button
                key={idx}
                variant="ghost"
                className="block h-auto w-auto min-h-0 shrink-0 cursor-zoom-in rounded-lg p-0 shadow-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-primary/50"
                onClick={() =>
                  setExpandedImage({
                    src: `data:${img.mimeType};base64,${img.base64Data}`,
                    alt: img.name,
                    name: img.name,
                  })
                }
              >
                <img
                  src={`data:${img.mimeType};base64,${img.base64Data}`}
                  alt={img.name || 'image'}
                  className="block h-40 w-auto max-w-80 rounded-lg border border-border object-contain"
                />
              </Button>
            ))}
          </div>
        )}

        {fileAttachments.length > 0 && (
          <div className="ml-auto mb-2 flex w-fit max-w-full flex-wrap justify-end gap-2">
            {fileAttachments.map(file => (
              <div
                key={file.path}
                className="flex h-20 w-64 shrink-0 items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised px-4"
                title={file.path}
              >
                <FileTypeIcon fileName={file.name} className="h-12 w-12 shrink-0" />
                <div className="min-w-0">
                  <div className="truncate text-base text-foreground">{file.name}</div>
                  <div className="truncate text-sm text-muted-foreground">{file.extension}</div>
                </div>
              </div>
            ))}
          </div>
        )}

        {hasTextContent && (
          <Message from="user" className="ml-auto items-end">
            <MessageContent className="px-4 py-3 rounded-2xl rounded-br-md bg-primary/10 dark:bg-primary/15 text-sm text-foreground leading-relaxed whitespace-pre-wrap wrap-break-word">
              <div className="flex flex-wrap items-center gap-1.5 whitespace-normal">
                {messageSkills.map(skill => (
                  <MessageSkillSummary key={skill.id} skill={skill} />
                ))}
                <span className="whitespace-pre-wrap wrap-break-word">{textContent}</span>
              </div>
            </MessageContent>
          </Message>
        )}

        <div
          className={`flex items-center gap-2 mt-1 text-[11px] text-muted-foreground select-none transition-opacity duration-200 justify-end ${isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          aria-hidden={!isHovered}
        >
          <span>{formatMessageDateTime(message.timestamp)}</span>
          {modelLabel && <span className="opacity-70">{modelLabel}</span>}
          <CopyButton content={message.content} visible={isHovered} />
          {onReEdit && (
            <ReEditButton visible={isHovered} onClick={() => onReEdit(message)} />
          )}
        </div>
      </div>
      {expandedImage &&
        createPortal(
          <ImagePreviewModal image={expandedImage} onClose={() => setExpandedImage(null)} />,
          document.body,
        )}
    </div>
  );
});

const MessageSkillSummary: React.FC<{ skill: Skill }> = ({ skill }) => {
  const shortcut = findChatSkillShortcut(skill.id);
  const label = shortcut
    ? i18nService.t(shortcut.labelKey)
    : skill.displayName || skill.name;
  const ShortcutIcon = shortcut?.icon;

  return (
    <span className="inline-flex max-w-40 items-center gap-1 rounded-md bg-background px-1.5 py-1 text-sm text-foreground">
      {skill.iconUrl ? (
        <img
          src={resolveSkillIconUrl(skill.iconUrl)}
          alt=""
          className="size-3.5 shrink-0 object-contain"
        />
      ) : ShortcutIcon ? (
        <ShortcutIcon className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <PlusMenuSkillsIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
};
