import { BACKGROUND_CONTEXT as context } from '@earendil-works/chord/context';
import {
  InboxDoc,
  UserEntry,
  type Conversation,
  type EntryRecord,
} from '@earendil-works/pi-durable';
import { z } from 'zod';
import { CompanionImageEntry } from '../../shared/companion/images.js';
import {
  COMPANION_MAX_ATTACHMENTS,
  COMPANION_MAX_ATTACHMENT_NAME_LENGTH,
} from '../../shared/companion/attachments.js';

const metadata = z.object({
  attachments: z
    .array(
      z.object({ id: z.uuid(), name: z.string().min(1).max(COMPANION_MAX_ATTACHMENT_NAME_LENGTH) }),
    )
    .max(COMPANION_MAX_ATTACHMENTS),
});

export function isCompanionUserEntry(entry: EntryRecord): boolean {
  return UserEntry.is(entry) || entry.kind === CompanionImageEntry.User;
}

export function companionImageMetadata(entry: EntryRecord) {
  return entry.kind === CompanionImageEntry.User
    ? metadata.safeParse(entry.data).data?.attachments
    : undefined;
}

function hasImages(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      block => block && typeof block === 'object' && 'type' in block && block.type === 'image',
    )
  );
}

/** Native context and inbox include older and not-yet-placed images; the 32-message UI page does not. */
export async function companionNeedsImages(conversation: Conversation): Promise<boolean> {
  const queued = await conversation.commit(
    async tx =>
      (await tx.doc(InboxDoc, conversation.id)).items.some(
        item => 'content' in item && hasImages(item.content),
      ),
    context,
  );
  if (queued) return true;
  return (await conversation.context(context)).messages.some(message => hasImages(message.content));
}
