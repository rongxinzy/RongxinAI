import { Message, MessageContent } from '@shared/components/ai-elements/message';
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
import { CoworkInlineAttachments, type CoworkInlineAttachment } from '../CoworkInlineAttachments';
import { findChatSkillShortcut } from '../../chat/constants';
import { CopyButton, ReEditButton } from './CopyButton';

const getMessageModelLabel = (metadata?: CoworkMessageMetadata | null): string | null => {
  const model = typeof metadata?.model === 'string' ? metadata.model.trim() : '';
  if (!model) return null;
  return model.includes('/') ? model.split('/').pop() || model : model;
};

const hasFocusWithin = (element: HTMLElement): boolean =>
  document.activeElement instanceof Node && element.contains(document.activeElement);

const IMAGE_ATTACHMENT_EXTENSION = /\.(?:png|jpe?g|gif|webp|bmp|svg|tiff?|ico|avif)$/i;
const LEGACY_INPUT_FILE_LABELS = ['输入文件', 'Input Files'] as const;
const LEGACY_INPUT_FILE_PREFIX = new RegExp(
  `^(?:${LEGACY_INPUT_FILE_LABELS.join('|')})\\s*[:：]\\s*`,
);

const isAbsoluteLocalPath = (value: string): boolean =>
  value.startsWith('/') || value.startsWith('\\\\') || /^[a-z]:[\\/]/i.test(value);

const getFileAttachmentFromPath = (path: string): CoworkFileAttachment | null => {
  const normalizedPath = path.trim();
  if (!isAbsoluteLocalPath(normalizedPath)) return null;
  const name = normalizedPath.split(/[\\/]/).pop() || normalizedPath;
  const extensionIndex = name.lastIndexOf('.');
  return {
    name,
    path: normalizedPath,
    extension: extensionIndex >= 0 ? name.slice(extensionIndex + 1).toUpperCase() : 'FILE',
    isImage: IMAGE_ATTACHMENT_EXTENSION.test(name),
  };
};

const getPromptAttachmentFallbacks = (content: string): CoworkFileAttachment[] => {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .flatMap(line => {
      const match = LEGACY_INPUT_FILE_PREFIX.exec(line);
      if (!match) return [];
      const attachment = getFileAttachmentFromPath(line.slice(match[0].length));
      return attachment ? [attachment] : [];
    });
};

const removePromptAttachmentFallbacks = (content: string): string => {
  return content
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => {
      const match = LEGACY_INPUT_FILE_PREFIX.exec(line);
      if (!match) return true;
      return getFileAttachmentFromPath(line.slice(match[0].length)) === null;
    })
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
};

export const UserBubble: React.FC<{
  message: CoworkMessage;
  skills: Skill[];
  onReEdit?: (message: CoworkMessage) => void;
}> = React.memo(({ message, skills, onReEdit }) => {
  'use memo';

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
  const fileAttachments = useMemo(() => {
    const persisted = ((message.metadata as CoworkMessageMetadata)?.fileAttachments ??
      []) as CoworkFileAttachment[];
    const knownPaths = new Set(persisted.map(file => file.path));
    const fallbacks = getPromptAttachmentFallbacks(message.content || '').filter(
      file => !knownPaths.has(file.path),
    );
    return [...persisted, ...fallbacks];
  }, [message.content, message.metadata]);
  const textContent = useMemo(() => {
    const contentWithoutFallbacks = removePromptAttachmentFallbacks(displayContent);
    if (fileAttachments.length === 0) return contentWithoutFallbacks;
    const filePaths = new Set(fileAttachments.map(file => file.path));
    return contentWithoutFallbacks
      .split(/\r?\n/)
      .filter(line => !Array.from(filePaths).some(path => line.includes(path)))
      .join('\n')
      .replace(/^\n+|\n+$/g, '');
  }, [displayContent, fileAttachments]);
  const inlineAttachments = useMemo<CoworkInlineAttachment[]>(
    () => [
      ...imageAttachments.map((image, index) => ({
        path: `inline:${message.id}:${index}`,
        name: image.name,
        isImage: true,
        mediaType: image.mimeType,
        dataUrl: `data:${image.mimeType};base64,${image.base64Data}`,
      })),
      ...fileAttachments,
    ],
    [fileAttachments, imageAttachments, message.id],
  );
  const hasTextContent = Boolean(textContent.trim()) || messageSkills.length > 0;

  return (
    <div
      className="w-full py-2 focus:outline-none"
      tabIndex={0}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onBlur={handleBlur}
    >
      <div className="mx-auto flex w-full max-w-5xl min-w-[320px] flex-col items-end pl-4">
        {inlineAttachments.length > 0 && (
          <CoworkInlineAttachments
            attachments={inlineAttachments}
            className="mb-2 ml-auto max-w-full justify-end"
            onOpenImage={setExpandedImage}
          />
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
          className={`flex items-center gap-2 mt-1 text-xs text-muted-foreground select-none transition-opacity duration-200 justify-end ${isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          aria-hidden={!isHovered}
        >
          <span>{formatMessageDateTime(message.timestamp)}</span>
          {modelLabel && <span className="opacity-70">{modelLabel}</span>}
          <CopyButton content={message.content} visible={isHovered} />
          {onReEdit && <ReEditButton visible={isHovered} onClick={() => onReEdit(message)} />}
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
  const label = shortcut ? i18nService.t(shortcut.labelKey) : skill.displayName || skill.name;
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
