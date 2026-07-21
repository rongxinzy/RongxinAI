import { Message, MessageContent } from '@shared/components/ai-elements/message';
import { Button } from '@shared/components/ui/button';
import React, { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type {
  CoworkImageAttachment,
  CoworkMessage,
  CoworkMessageMetadata,
} from '../../../types/cowork';
import type { Skill } from '../../../types/skill';
import { formatMessageDateTime } from '../../../utils/tokenFormat';
import { parseUserMessageForDisplay } from '../../../utils/userMessageDisplay';
import ImagePreviewModal, { type ImagePreviewSource } from '../ImagePreviewModal';

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
}> = React.memo(({ message, skills, onReEdit: _onReEdit }) => {
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
  const imageAttachments = ((message.metadata as CoworkMessageMetadata)?.imageAttachments ??
    []) as CoworkImageAttachment[];

  return (
    <div
      className="py-2 px-4 focus:outline-none"
      tabIndex={0}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
      onBlur={handleBlur}
    >
      <div className="max-w-5xl min-w-[320px] mx-auto">
        <Message from="user" className="ml-auto items-end">
          <MessageContent className="px-4 py-3 rounded-2xl rounded-br-md bg-primary/10 dark:bg-primary/15 text-sm text-foreground leading-relaxed whitespace-pre-wrap wrap-break-word">
            {displayContent}
          </MessageContent>
        </Message>

        {imageAttachments.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-end mt-2">
            {imageAttachments.map((img, idx) => (
              <Button
                key={idx}
                variant="ghost"
                className="block max-w-[200px] rounded-lg overflow-hidden border border-border hover:border-primary/50 p-0"
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
                  className="max-h-32 object-cover"
                />
              </Button>
            ))}
          </div>
        )}

        <div
          className={`flex items-center gap-2 mt-1 text-[11px] text-muted-foreground select-none transition-opacity duration-200 justify-end ${isHovered ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          aria-hidden={!isHovered}
        >
          {messageSkills.length > 0 && (
            <div className="flex items-center gap-1">
              {messageSkills.map(skill => (
                <span
                  key={skill.id}
                  className="px-1.5 py-0.5 text-[10px] rounded bg-surface-raised text-muted-foreground"
                >
                  {skill.name}
                </span>
              ))}
            </div>
          )}
          <span>{formatMessageDateTime(message.timestamp)}</span>
          {modelLabel && <span className="opacity-70">{modelLabel}</span>}
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
