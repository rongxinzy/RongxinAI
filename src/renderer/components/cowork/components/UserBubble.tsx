import { Message, MessageContent } from '@shared/components/ai-elements/message';
import React, { useMemo, useState } from 'react';
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

  const [expandedImage, setExpandedImage] = useState<ImagePreviewSource | null>(null);
  const modelLabel = getMessageModelLabel(message.metadata);
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
    // Vision cards already render from imageAttachments; skip same-name prompt
    // "输入文件:" fallbacks (path differs after disk persist, so match by name).
    const visionImageNames = new Set(imageAttachments.map(image => image.name));
    const fallbacks = getPromptAttachmentFallbacks(message.content || '').filter(
      file =>
        !knownPaths.has(file.path) && !(file.isImage && visionImageNames.has(file.name)),
    );
    return [...persisted, ...fallbacks];
  }, [imageAttachments, message.content, message.metadata]);
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
        path: image.path || `inline:${message.id}:${index}`,
        name: image.name,
        isImage: true,
        mediaType: image.mimeType,
        // Prefer disk path preview; only fall back to inline base64 for legacy rows.
        ...(!image.path && image.base64Data
          ? { dataUrl: `data:${image.mimeType};base64,${image.base64Data}` }
          : {}),
      })),
      ...fileAttachments,
    ],
    [fileAttachments, imageAttachments, message.id],
  );
  const hasTextContent = Boolean(textContent.trim()) || messageSkills.length > 0;

  return (
    <div className="w-full py-2 focus:outline-none" tabIndex={0}>
      {/* 2026/09/20 lixiang  与 TurnBlock 对齐加宽（issue #805） */}
      <div className="mx-auto flex w-full max-w-6xl min-w-[320px] flex-col items-end pl-4">
        {hasTextContent && (
          <Message from="user" className="ml-auto items-end">
            <MessageContent className="theme-message-cowork-user">
              {/* 2026/09/17 lixiang  skill与正文同一文本流，避免左右分栏 */}
              <div className="whitespace-pre-wrap wrap-break-word">
                {messageSkills.map(skill => (
                  <MessageSkillSummary key={skill.id} skill={skill} />
                ))}
                <span className="cowork-message mx-0.5">{textContent}</span>
              </div>
            </MessageContent>
          </Message>
        )}

        {inlineAttachments.length > 0 && (
          <CoworkInlineAttachments
            attachments={inlineAttachments}
            className="mt-2 ml-auto max-w-full justify-end"
            onOpenImage={setExpandedImage}
          />
        )}

        {/* 2026/09/17 lixiang  操作区放在正文与附件之后并常显，参考豆包 */}
        <div className="mt-1 flex items-center justify-end gap-2 text-xs text-muted-foreground select-none">
          <span>{formatMessageDateTime(message.timestamp)}</span>
          {modelLabel && <span className="opacity-70">{modelLabel}</span>}
          <CopyButton content={message.content} visible />
          {onReEdit && <ReEditButton visible onClick={() => onReEdit(message)} />}
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
    // 2026/09/17 lixiang  气泡内 skill 以行内 token 样式展示，跟输入框 skill 胶囊一致
    <span className="theme-surface-skill-token mx-0.5 inline-flex h-6 max-w-40 select-none items-center gap-1 align-baseline px-2 text-sm leading-none">
      {skill.iconUrl ? (
        <img
          src={resolveSkillIconUrl(skill.iconUrl)}
          alt=""
          className="size-3.5 shrink-0 object-contain"
        />
      ) : ShortcutIcon ? (
        <ShortcutIcon className="theme-surface-skill-fallback size-3.5 shrink-0" />
      ) : (
        <PlusMenuSkillsIcon className="theme-surface-skill-fallback size-3.5 shrink-0" />
      )}
      <span className="truncate">{label}</span>
    </span>
  );
};
