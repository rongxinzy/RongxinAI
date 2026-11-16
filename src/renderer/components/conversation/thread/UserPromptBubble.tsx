import { Message, MessageContent } from '@shared/components/ai-elements/message';
import { MessageActions } from '@shared/components/conversation';
import { Button } from '@shared/components/ui/button';
import { Check, Copy, Pencil } from 'lucide-react';
import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { i18nService } from '../../../services/i18n';
import { resolveSkillIconUrl } from '../../../services/skillIcon';
import type {
  CoworkFileAttachment,
  CoworkImageAttachment,
  CoworkMessage,
  CoworkMessageMetadata,
} from '../../../types/cowork';
import type { Skill } from '../../../types/skill';
import { formatMessageDateTime } from '../../../utils/tokenFormat';
import { parseUserMessageForDisplay } from '../../../utils/userMessageDisplay';
import { findChatSkillShortcut } from '../../chat/constants';
import {
  CoworkInlineAttachments,
  type CoworkInlineAttachment,
} from '../../cowork/CoworkInlineAttachments';
import ImagePreviewModal, { type ImagePreviewSource } from '../../cowork/ImagePreviewModal';
import { PlusMenuSkillsIcon } from '../../cowork/plusMenuIcons';

interface UserPromptBubbleProps {
  message: CoworkMessage;
  skills: Skill[];
  onReEdit?: (message: CoworkMessage) => void;
}

const getShortModelLabel = (metadata?: CoworkMessageMetadata | null): string | null => {
  const model = typeof metadata?.model === 'string' ? metadata.model.trim() : '';
  if (!model) return null;
  return model.includes('/') ? model.split('/').pop() || model : model;
};

const MessageSkillPill: React.FC<{ skill: Skill }> = ({ skill }) => {
  const shortcut = findChatSkillShortcut(skill.id);
  const label = shortcut ? i18nService.t(shortcut.labelKey) : skill.displayName || skill.name;
  const ShortcutIcon = shortcut?.icon;

  return (
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

export const UserPromptBubble: React.FC<UserPromptBubbleProps> = React.memo(
  ({ message, skills, onReEdit }) => {
    const [copied, setCopied] = useState(false);
    const [expandedImage, setExpandedImage] = useState<ImagePreviewSource | null>(null);

    const metadata = message.metadata as CoworkMessageMetadata | undefined;
    const modelLabel = getShortModelLabel(metadata);
    const displayContent = useMemo(
      () => parseUserMessageForDisplay(message.content || ''),
      [message.content],
    );

    const messageSkills = useMemo(() => {
      const ids = metadata?.skillIds ?? [];
      return ids
        .map(id => skills.find(skill => skill.id === id))
        .filter((skill): skill is Skill => skill !== undefined);
    }, [metadata?.skillIds, skills]);

    const inlineAttachments = useMemo<CoworkInlineAttachment[]>(() => {
      const images = (metadata?.imageAttachments ?? []) as CoworkImageAttachment[];
      const files = (metadata?.fileAttachments ?? []) as CoworkFileAttachment[];
      return [
        ...images.map((image, index) => ({
          path: image.path || `inline:${message.id}:${index}`,
          name: image.name,
          isImage: true,
          mediaType: image.mimeType,
          ...(!image.path && image.base64Data
            ? { dataUrl: `data:${image.mimeType};base64,${image.base64Data}` }
            : {}),
        })),
        ...files,
      ];
    }, [message.id, metadata?.fileAttachments, metadata?.imageAttachments]);

    const textContent = useMemo(() => {
      const attachedPaths = new Set(inlineAttachments.map(item => item.path).filter(Boolean));
      if (attachedPaths.size === 0) return displayContent;
      return displayContent
        .split(/\r?\n/)
        .filter(line => !Array.from(attachedPaths).some(path => line.includes(path)))
        .join('\n')
        .replace(/^\n+|\n+$/g, '');
    }, [displayContent, inlineAttachments]);

    const handleCopy = useCallback(async () => {
      try {
        await navigator.clipboard.writeText(message.content || '');
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      } catch {
        // Ignore clipboard denial in non-focused environments.
      }
    }, [message.content]);

    const hasTextOrSkill = Boolean(textContent.trim()) || messageSkills.length > 0;

    return (
      <div data-export-role="user-message" className="group/turn w-full py-2 focus:outline-none">
        <div className="mx-auto flex w-full max-w-4xl min-w-[320px] flex-col items-end">
          {hasTextOrSkill && (
            <Message from="user" className="ml-auto items-end">
              <MessageContent className="theme-message-cowork-user">
                <div className="whitespace-pre-wrap wrap-break-word">
                  {messageSkills.map(skill => (
                    <MessageSkillPill key={skill.id} skill={skill} />
                  ))}
                  {textContent ? (
                    <span className="cowork-message mx-0.5">{textContent}</span>
                  ) : null}
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

          <MessageActions
            align="end"
            meta={
              <>
                <span>{formatMessageDateTime(message.timestamp)}</span>
                {modelLabel ? <span className="opacity-70">{modelLabel}</span> : null}
              </>
            }
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={i18nService.t('copy')}
              title={i18nService.t('copy')}
              onClick={() => void handleCopy()}
            >
              {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
            </Button>
            {onReEdit ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={i18nService.t('coworkReEdit')}
                title={i18nService.t('coworkReEdit')}
                onClick={() => onReEdit(message)}
              >
                <Pencil className="size-3.5" />
              </Button>
            ) : null}
          </MessageActions>
        </div>

        {expandedImage &&
          createPortal(
            <ImagePreviewModal image={expandedImage} onClose={() => setExpandedImage(null)} />,
            document.body,
          )}
      </div>
    );
  },
);

UserPromptBubble.displayName = 'UserPromptBubble';
